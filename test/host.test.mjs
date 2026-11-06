// test/host.test.mjs — 主机端回归测试：纯函数 + 真实 HTTP 路由全链路。

import http from 'node:http';
import { mkdtemp, writeFile, appendFile, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apply, __internals } from '../index.js';
import { equal, ok, contains, notContains, lengthOf, sleep } from './harness.mjs';

/**
 * 造一个够用的假 cordis 上下文：只实现本插件用到的面。
 * @param routes 收集注册的路由。
 * @param cwd 会话工作目录。
 */
function createFakeContext(routes, cwd) {
	const disposers = [];
	const context = {
		effect(fn) {
			const dispose = fn();
			if (typeof dispose === 'function') disposers.push(dispose);
			return () => dispose?.();
		},
		webServer: {
			register(route) {
				routes.push(route);
				return () => {
					const index = routes.indexOf(route);
					if (index >= 0) routes.splice(index, 1);
				};
			},
		},
		sessions: {
			get(id) {
				return { id, header: { cwd } };
			},
		},
		connection: {
			// 模拟 DSH 的 CSRF 闸门：带会话凭据（这里用约定 header 代表）就放行，
			// 否则返回一个拒绝对象——外部进程没有凭据，只能走 ingest token。
			requestRejection(req) {
				return req.headers['x-dsh-trusted'] === 'yes' ? undefined : { reason: 'csrf' };
			},
		},
		logger: { info() {}, warn() {}, error() {} },
		get() {
			return undefined;
		},
		disposeAll() {
			for (const dispose of disposers) {
				try {
					dispose();
				} catch {
					/* 忽略 */
				}
			}
		},
	};
	return context;
}

/** 起一个只认这些路由的最小 http 服务器。 */
async function startServer(routes) {
	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const route = routes.find((item) => item.kind === 'exact' && item.path === url.pathname);
		if (route === undefined) {
			res.writeHead(404, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ ok: false, code: 'not-found' }));
			return;
		}
		Promise.resolve(route.handler(req, res)).catch((error) => {
			if (!res.headersSent) {
				res.writeHead(500, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ ok: false, message: String(error) }));
			}
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	return { server, base: `http://127.0.0.1:${address.port}` };
}

/** 发一个 JSON 请求。trusted=false 时模拟不带会话凭据的外部进程。 */
async function call(base, routePath, options) {
	const init = { method: options?.method ?? 'GET', headers: {} };
	if (options?.trusted !== false) init.headers['x-dsh-trusted'] = 'yes';
	if (options?.body !== undefined) {
		init.headers['content-type'] = 'application/json';
		init.body = JSON.stringify(options.body);
	}
	if (options?.headers !== undefined) Object.assign(init.headers, options.headers);
	const response = await fetch(`${base}${routePath}`, init);
	const payload = await response.json().catch(() => null);
	return { status: response.status, payload };
}

/** 跑主机端全部断言。 */
export async function run() {
	// ------------------------- 纯函数 -------------------------
	equal(__internals.formatRelMs(0), '00:00.000', 'formatRelMs 零点');
	equal(__internals.formatRelMs(61234), '01:01.234', 'formatRelMs 一分一秒');
	equal(__internals.formatRelMs(-250), '-00:00.250', 'formatRelMs 负数');
	equal(__internals.classifyLevel('ReferenceError: x'), 'error', 'classifyLevel error');
	equal(__internals.classifyLevel('[warn] slow'), 'warn', 'classifyLevel warn');
	equal(__internals.classifyLevel('tick 200'), 'info', 'classifyLevel info');
	equal(__internals.looksBinary('abc\u0000def'), true, 'looksBinary 检出 NUL');
	equal(__internals.looksBinary('正常中文日志 ok'), false, 'looksBinary 中文正常');
	equal(__internals.safeSlug('clip: 1/2?'), 'clip-1-2', 'safeSlug 清洗非法字符');
	equal(__internals.safeSlug('', 'fallback'), 'fallback', 'safeSlug 空值回落');
	equal(__internals.isInsidePath('D:\\a', 'D:\\a\\b\\c.txt'), true, 'isInsidePath 子路径');
	equal(__internals.isInsidePath('D:\\a', 'D:\\b\\c.txt'), false, 'isInsidePath 外部路径');
	equal(__internals.isInsidePath('D:\\a', 'D:\\a'), true, 'isInsidePath 自身');

	// 抓帧模式选择：有 desktopCapturer 用原生，Windows 上退回 GDI，其它平台没有
	equal(__internals.chooseCaptureMode({ available: true }, 'win32'), 'native', '有 Electron 能力时用原生抓帧');
	equal(__internals.chooseCaptureMode({ available: false }, 'win32'), 'gdi', 'Windows 上没有原生能力时退回 GDI');
	equal(__internals.chooseCaptureMode({ available: false }, 'linux'), 'none', '非 Windows 且无原生能力时不可用');
	equal(__internals.chooseCaptureMode(undefined, 'win32'), 'gdi', '能力未知时 Windows 仍可退回 GDI');

	const split = __internals.splitBufferLines(Buffer.from('one\ntwo\nthr', 'utf8'), '');
	equal(split.lines.length, 2, 'splitBufferLines 只切完整行');
	equal(split.carry, 'thr', 'splitBufferLines 保留残行');
	const split2 = __internals.splitBufferLines(Buffer.from('ee\nfour\n', 'utf8'), split.carry);
	equal(split2.lines[0], 'three', 'splitBufferLines 残行与后续拼接');
	equal(split2.carry, '', 'splitBufferLines 结尾无残行');

	const doc = __internals.normalizeProfilesDocument({ profiles: [{ sources: [{ path: '  x.log  ', kind: '???' }] }] });
	lengthOf(doc.profiles, 1, 'normalizeProfilesDocument 保留 profile');
	equal(doc.profiles[0].sources[0].path, 'x.log', 'normalizeProfilesDocument 去空格');
	equal(doc.profiles[0].sources[0].kind, 'file', 'normalizeProfilesDocument 未知 kind 回落 file');
	lengthOf(__internals.normalizeProfilesDocument(null).profiles, 0, 'normalizeProfilesDocument 空输入');

	const markdown = __internals.renderBundleMarkdown({
		title: 'T',
		description: '现象描述',
		fromRel: 1000,
		toRel: 2000,
		events: [{ seq: 0, src: 'log-a', level: 'error', text: 'boom', relMs: 1500, pre: false, marker: '' }],
		annotations: [{ rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, note: '悬空' }],
		artifacts: [{ kind: 'image', name: 'frames.png', path: '/tmp/frames.png', label: '条带' }],
		sources: [{ id: 'log-a', label: '日志 A', path: '/tmp/a.log' }],
		markers: [{ relMs: 1500, label: '问题点' }],
		captureInfo: '桌面抓帧 6fps',
	});
	contains(markdown, '# T', '纪要标题');
	contains(markdown, '现象描述', '纪要包含描述');
	contains(markdown, '00:01.000', '纪要包含区间起点');
	contains(markdown, 'boom', '纪要包含日志行');
	contains(markdown, '悬空', '纪要包含标注说明');
	contains(markdown, 'frames.png', '纪要包含图像链接');
	contains(markdown, '桌面抓帧 6fps', '纪要包含采集方式');

	// ------------------------- 路由全链路 -------------------------
	const workdir = await mkdtemp(path.join(os.tmpdir(), 'dshis-test-'));
	const logPath = path.join(workdir, 'game.log');
	await writeFile(logPath, 'boot: ok\nRConnect: init\npre-roll line\n', 'utf8');
	// 隔离 profiles.json，避免写到真实 ~/.dsh
	const previousHome = process.env.DSH_HOME;
	process.env.DSH_HOME = path.join(workdir, 'dsh-home');

	const routes = [];
	const ctx = createFakeContext(routes, workdir);
	apply(ctx, { inputProbe: false });
	ok(routes.length >= 10, `注册了足够多的路由（实际 ${routes.length}）`);
	const { server, base } = await startServer(routes);

	try {
		// 启动即写的抓帧能力回执：纯 Node 宿主应为 electron:false
		await sleep(120);
		const capabilityPath = path.join(process.env.DSH_HOME, 'storages', 'dsh-incident-studio', 'capture-capability.json');
		const capability = JSON.parse(await readFile(capabilityPath, 'utf8'));
		equal(capability.electron, false, '能力回执记录纯 Node 宿主没有 Electron');
		ok(typeof capability.platform === 'string' && capability.platform !== '', '能力回执记录平台');
		ok(!('windowTitles' in capability), '能力回执不记窗口标题');
		const state = await call(base, '/dsh-incident-studio/api/state');
		equal(state.payload.ok, true, 'GET /state 成功');
		ok(typeof state.payload.value.ingestToken === 'string' && state.payload.value.ingestToken.length === 32, 'state 带 ingest token');
		equal(state.payload.value.capture.native, false, '纯 Node 宿主没有原生抓帧');
		equal(state.payload.value.recording, null, 'state 初始没有录制');
		const token = state.payload.value.ingestToken;

		const saved = await call(base, '/dsh-incident-studio/api/profiles', {
			method: 'POST',
			body: {
				version: 1,
				activeId: 'p1',
				profiles: [{ id: 'p1', name: '测试配置', sources: [{ id: 'log-a', kind: 'file', label: '日志 A', path: logPath }] }],
			},
		});
		equal(saved.payload.ok, true, 'POST /profiles 保存成功');
		const reloaded = await call(base, '/dsh-incident-studio/api/profiles');
		equal(reloaded.payload.value.profiles[0].name, '测试配置', 'GET /profiles 读回保存内容');

		const probe = await call(base, '/dsh-incident-studio/api/probe', { method: 'POST', body: { path: logPath, sessionId: 's1' } });		equal(probe.payload.ok, true, 'POST /probe 返回成功');
		equal(probe.payload.value.ok, true, 'probe 确认文件存在');
		const probeMissing = await call(base, '/dsh-incident-studio/api/probe', { method: 'POST', body: { path: path.join(workdir, 'nope.log') } });
		equal(probeMissing.payload.value.ok, false, 'probe 报告缺失文件');

		const t0 = Date.now();
		const started = await call(base, '/dsh-incident-studio/api/start', {
			method: 'POST',
			body: { t0, sessionId: 's1', profileId: 'p1', sources: [{ id: 'log-a', kind: 'file', label: '日志 A', path: logPath }] },
		});
		equal(started.payload.ok, true, 'POST /start 成功');
		const recordingId = started.payload.value.recording.id;
		ok(typeof recordingId === 'string' && recordingId.length > 8, 'start 返回录制 id');

		await sleep(400);
		const first = await call(base, '/dsh-incident-studio/api/events?since=0');
		const preRoll = first.payload.value.events.filter((event) => event.pre === true);
		ok(preRoll.length >= 3, `pre-roll 抓到了历史尾部（${preRoll.length} 行）`);
		const bootLine = first.payload.value.events.find((event) => event.text.includes('boot: ok'));
		ok(bootLine !== undefined && bootLine.relMs <= 0, 'pre-roll 行的相对时间是负的');
		let cursor = first.payload.value.cursor;

		await appendFile(logPath, 'ReferenceError: chest state mismatch\nRConnect: tick 400\n', 'utf8');
		await sleep(700);
		const second = await call(base, `/dsh-incident-studio/api/events?since=${cursor}`);
		const fresh = second.payload.value.events;
		ok(fresh.length >= 2, `增量取到新写入的行（${fresh.length} 行）`);
		const errorLine = fresh.find((event) => event.text.includes('ReferenceError'));
		ok(errorLine !== undefined, '新行里能定位到错误行');
		equal(errorLine.level, 'error', '错误行被标为 error');
		ok(errorLine.relMs >= 0, '新行的相对时间非负');

		const marker = await call(base, '/dsh-incident-studio/api/marker', { method: 'POST', body: { label: '问题点' } });
		equal(marker.payload.ok, true, 'POST /marker 成功');
		equal(marker.payload.value.event.marker, '问题点', '打点事件带标签');

		const denied = await call(base, '/dsh-incident-studio/api/ingest', { method: 'POST', body: { text: 'x' }, trusted: false });
		equal(denied.status, 403, '外部进程没有 token 的 ingest 被拒');
		const ingested = await call(base, '/dsh-incident-studio/api/ingest', {
			method: 'POST',
			body: { text: '来自模组的事件', src: 'mod' },
			headers: { 'x-incident-token': token },
			trusted: false,
		});
		equal(ingested.payload.ok, true, '外部进程带 token 的 ingest 成功');
		equal(ingested.payload.value.event.src, 'mod', 'ingest 事件保留来源');
		const pageIngest = await call(base, '/dsh-incident-studio/api/ingest', { method: 'POST', body: { text: '面板自己推的事件' } });
		equal(pageIngest.payload.ok, true, '同源面板的 ingest 无需 token');

		const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
		const artifact = await call(base, '/dsh-incident-studio/api/artifact', {
			method: 'POST',
			body: { name: 'frames.png', data: pngBytes.toString('base64') },
		});
		equal(artifact.payload.ok, true, 'POST /artifact 成功');
		const artifactPath = artifact.payload.value.path;
		ok(artifactPath.startsWith(workdir), '产物落在会话工作目录里');
		const artifactInfo = await stat(artifactPath);
		equal(artifactInfo.size, pngBytes.length, '产物字节数一致');

		const stopped = await call(base, '/dsh-incident-studio/api/stop', { method: 'POST', body: {} });
		equal(stopped.payload.ok, true, 'POST /stop 成功');
		equal(stopped.payload.value.recording.recording, false, '停止后状态为未录制');

		const eventsForBundle = [
			{ seq: 0, src: 'log-a', level: 'error', text: 'ReferenceError: chest state mismatch', relMs: 900 },
			{ seq: 1, src: 'marker', level: 'info', text: '【打点】问题点', relMs: 1000, marker: '问题点' },
		];
		const bundle = await call(base, '/dsh-incident-studio/api/bundle', {
			method: 'POST',
			body: {
				title: '捡箱子后悬空',
				description: '捡起箱子后角色浮空',
				fromRel: 0,
				toRel: 2000,
				events: eventsForBundle,
				annotations: [{ rect: { x: 0.4, y: 0.3, w: 0.1, h: 0.1 }, note: '角色悬空', atRel: 1000 }],
				artifacts: [{ kind: 'image', name: 'frames.png', path: artifactPath, label: '关键帧条带' }],
				profileName: '测试配置',
			},
		});
		equal(bundle.payload.ok, true, 'POST /bundle 成功');
		const markdownPath = bundle.payload.value.markdownPath;
		ok(markdownPath.endsWith('bundle.md'), '返回 bundle.md 路径');
		const written = await readFile(markdownPath, 'utf8');
		contains(written, '捡起箱子后角色浮空', '落盘纪要包含描述');
		contains(written, 'ReferenceError: chest state mismatch', '落盘纪要包含日志行');
		contains(written, '角色悬空', '落盘纪要包含标注');
		contains(written, '关键帧条带', '落盘纪要包含图像标签');
		contains(written, '测试配置', '落盘纪要包含配置名');
		const json = JSON.parse(await readFile(bundle.payload.value.jsonPath, 'utf8'));
		equal(json.title, '捡箱子后悬空', 'bundle.json 记录标题');
		lengthOf(json.events, 2, 'bundle.json 记录事件');

		const incidents = await call(base, '/dsh-incident-studio/api/incidents?sessionId=s1');
		equal(incidents.payload.ok, true, 'GET /incidents 成功');
		ok(incidents.payload.value.items.some((item) => item.id === recordingId), '取证列表里能找到本次录制');

		const outside = await call(base, '/dsh-incident-studio/api/open', { method: 'POST', body: { path: 'C:\\Windows\\notepad.exe', sessionId: 's1' } });
		equal(outside.status, 403, '不允许打开取证目录之外的路径');

		// 客户端自检回执：两次不同阶段应合并进同一份 JSON
		const bootA = await call(base, '/dsh-incident-studio/api/client-boot', {
			method: 'POST',
			body: { stage: 'apply', href: 'http://127.0.0.1/x', userAgent: 'test-agent' },
		});
		equal(bootA.payload.ok, true, 'client-boot(apply) 写入成功');
		const bootB = await call(base, '/dsh-incident-studio/api/client-boot', {
			method: 'POST',
			body: { stage: 'panel', detail: { sessionId: 's1' } },
		});
		equal(bootB.payload.ok, true, 'client-boot(panel) 写入成功');
		const bootDoc = JSON.parse(await readFile(path.join(process.env.DSH_HOME, 'storages', 'dsh-incident-studio', 'client-boot.json'), 'utf8'));
		equal(bootDoc.stages.apply.userAgent, 'test-agent', 'client-boot 记下 apply 阶段');
		ok(typeof bootDoc.stages.panel.at === 'string', 'client-boot 记下 panel 阶段时间');
		equal(bootDoc.stages.panel.detail.sessionId, 's1', 'client-boot 保留阶段细节');
		ok(Array.isArray(bootDoc.history) && bootDoc.history.length === 2, 'client-boot 保留阶段历史');

		// ------------------------- 输入记录 -------------------------
		const stateInput = await call(base, '/dsh-incident-studio/api/state');
		equal(
			stateInput.payload?.value?.input?.mode,
			process.platform === 'win32' ? 'powershell' : 'none',
			'state 报告输入记录模式',
		);
		equal(stateInput.payload?.value?.input?.defaults?.pollMs, 20, 'state 带输入默认采样间隔');
		const inputList = await call(base, '/dsh-incident-studio/api/input?since=0');
		equal(inputList.payload?.ok, true, '/input 路由可用');
		lengthOf(inputList.payload?.value?.inputs, 0, '没配目标进程时不会记录输入');
		contains(
			String(inputList.payload?.value?.input?.reason ?? ''),
			'目标进程',
			'输入快照说明为什么没记（缺目标进程）',
		);
		const markerWithoutInput = await call(base, '/dsh-incident-studio/api/marker', { method: 'POST', body: { label: '无输入' } });
		equal(markerWithoutInput.payload?.value?.anchor ?? null, null, '没有输入时打点不带锚点');
		const bundleWithInput = await call(base, '/dsh-incident-studio/api/bundle', {
			method: 'POST',
			body: { title: '输入段检查', description: 'd', fromRel: 0, toRel: 1000, events: [] },
		});
		equal(bundleWithInput.payload?.ok, true, '带输入段的取证包写入成功');
		contains(bundleWithInput.payload?.value?.markdown ?? '', '## 输入记录', '纪要里有输入段');
		contains(bundleWithInput.payload?.value?.markdown ?? '', '没有记录键鼠输入', '没记输入时写明原因');
	} finally {
		await new Promise((resolve) => server.close(resolve));
		ctx.disposeAll();
		if (previousHome === undefined) delete process.env.DSH_HOME;
		else process.env.DSH_HOME = previousHome;
		await rm(workdir, { recursive: true, force: true }).catch(() => {});
	}
}
