// test/live-capture.mjs — 真机抓帧验证（会短暂截屏，默认不跑）。
//
// 这条测试不是普通回归：它真的用 GDI 助手抓约 1.2 秒屏幕（320px 宽、约 3–8 张），
// 检查帧是合法 JPEG、时间戳递增、临时目录收干净，然后立刻删掉所有帧。
// 需要图形桌面、Windows PowerShell；CI 或锁屏环境会跳过。
//
// 用法：node test/live-capture.mjs
//   想看细节加 --keep（保留最后一帧到临时目录并打印路径）

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { apply } from '../index.js';
import { ok, equal, summarize, sleep } from './harness.mjs';

const keep = process.argv.includes('--keep');

/** 假 cordis 上下文（只实现本插件用到的面）。 */
function createFakeContext(routes, cwd) {
	return {
		effect(fn) {
			const dispose = fn();
			return () => dispose?.();
		},
		webServer: {
			register(route) {
				routes.push(route);
				return () => {};
			},
		},
		sessions: { get: (id) => ({ id, header: { cwd } }) },
		connection: { requestRejection: () => undefined },
		logger: { info() {}, warn() {}, error() {} },
		get() {
			return undefined;
		},
	};
}

/** 起一个只认已注册路由的最小服务器。 */
async function startServer(routes) {
	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const route = routes.find((item) => item.path === url.pathname);
		if (route === undefined) {
			res.writeHead(404).end();
			return;
		}
		Promise.resolve(route.handler(req, res)).catch((error) => {
			if (!res.headersSent) res.writeHead(500).end(String(error));
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/** JSON 请求。 */
async function call(base, routePath, method, body) {
	const init = { method: method ?? 'GET', headers: {} };
	if (body !== undefined) {
		init.headers['content-type'] = 'application/json';
		init.body = JSON.stringify(body);
	}
	const response = await fetch(`${base}${routePath}`, init);
	const payload = await response.json().catch(() => null);
	return { status: response.status, payload };
}

const workdir = await mkdtemp(path.join(os.tmpdir(), 'dshis-live-'));
const previousHome = process.env.DSH_HOME;
process.env.DSH_HOME = path.join(workdir, 'dsh-home');

const logPath = path.join(workdir, 'game.log');
await writeFile(logPath, 'boot: ok\n', 'utf8');
// 先把上次可能残留的临时帧目录清掉，这样"停止后为空"才是本次的结论
const scratchRoot = path.join(os.tmpdir(), 'dsh-incident-studio');
await rm(scratchRoot, { recursive: true, force: true }).catch(() => {});

const routes = [];
const ctx = createFakeContext(routes, workdir);
apply(ctx, {});
const { server, base } = await startServer(routes);

try {
	const state = await call(base, '/dsh-incident-studio/api/state');
	const mode = state.payload?.value?.capture?.mode;
	console.log(`宿主抓帧模式：${mode}（native=${state.payload?.value?.capture?.native}，原因=${state.payload?.value?.capture?.nativeReason || '无'}）`);
	equal(mode, 'gdi', '这台机器上应当退回 GDI 抓屏（插件宿主拿不到 desktopCapturer）');

	const sources = await call(base, '/dsh-incident-studio/api/capture/sources');
	equal(sources.payload?.value?.available, true, 'GDI 模式下采集源可用');
	equal(sources.payload?.value?.mode, 'gdi', '采集源报告 gdi 模式');
	equal(sources.payload?.value?.screens?.length, 1, 'GDI 提供一个合成屏幕源');

	const started = await call(base, '/dsh-incident-studio/api/start', 'POST', {
		t0: Date.now(),
		sessionId: 'live',
		sources: [{ id: 'log-a', kind: 'file', label: '日志', path: logPath }],
	});
	equal(started.payload?.ok, true, '录制会话已开始');

	const captureStart = await call(base, '/dsh-incident-studio/api/capture/start', 'POST', { sourceId: 'gdi:virtual', fps: 4, width: 320, quality: 55 });
	equal(captureStart.payload?.ok, true, 'GDI 抓帧已启动');
	equal(captureStart.payload?.value?.mode, 'gdi', '抓帧响应报告 gdi');

	// 抓一小段
	await sleep(1400);
	const frames = await call(base, '/dsh-incident-studio/api/capture/frames?since=0');
	const list = frames.payload?.value?.frames ?? [];
	ok(list.length >= 3, `抓到至少 3 帧（实际 ${list.length}）`);
	const walls = list.map((frame) => frame.wall);
	const ascending = walls.every((wall, index) => index === 0 || wall > walls[index - 1]);
	ok(ascending, '帧时间戳严格递增（文件名即抓帧时刻）');
	const firstBytes = Buffer.from(list[0].jpeg, 'base64');
	equal(firstBytes[0], 0xff, 'JPEG 首字节 FF');
	equal(firstBytes[1], 0xd8, 'JPEG 次字节 D8');
	const totalBytes = list.reduce((sum, frame) => sum + Buffer.from(frame.jpeg, 'base64').length, 0);
	console.log(`  ${list.length} 帧，合计 ${(totalBytes / 1024).toFixed(1)} KB，单帧约 ${Math.round(totalBytes / list.length / 1024)} KB`);

	const captureStatus = frames.payload?.value?.capture ?? {};
	eqNumber(captureStatus.captured, list.length, '状态里的 captured 与取到的帧数一致');

	if (keep) {
		const keepPath = path.join(workdir, 'keep-first.jpg');
		await writeFile(keepPath, firstBytes);
		console.log(`  已保留首帧：${keepPath}`);
	}

	const captureStop = await call(base, '/dsh-incident-studio/api/capture/stop', 'POST', {});
	equal(captureStop.payload?.ok, true, 'GDI 抓帧已停止');
	// 停止是异步的：等助手退出 + 清临时目录，最多 5 秒
	const scratch = path.join(os.tmpdir(), 'dsh-incident-studio');
	let leftover = [];
	for (let attempt = 0; attempt < 20; attempt += 1) {
		await sleep(250);
		try {
			leftover = await readdir(scratch);
		} catch {
			leftover = [];
		}
		if (leftover.length === 0) break;
	}
	equal(leftover.length, 0, `停止后临时帧目录已清理（残留 ${leftover.length} 项）`);

	await call(base, '/dsh-incident-studio/api/stop', 'POST', {});
} finally {
	await new Promise((resolve) => server.close(resolve));
	if (previousHome === undefined) delete process.env.DSH_HOME;
	else process.env.DSH_HOME = previousHome;
	if (keep) console.log(`（保留模式：临时目录 ${workdir} 未删除）`);
	else await rm(workdir, { recursive: true, force: true }).catch(() => {});
}

/** 只比较数字相等（避免 -0 / 类型差异）。 */
function eqNumber(actual, expected, label) {
	equal(Number(actual), Number(expected), label);
}

const passed = summarize('GDI 真机抓帧验证');
if (!passed) process.exitCode = 1;
