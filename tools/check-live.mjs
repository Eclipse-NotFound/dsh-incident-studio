// tools/check-live.mjs — 检查本插件在「正在运行的 DSH」里的实际生效状态。
//
// 它读三样东西（都不需要登录凭据）：
//   1. /plugins/events 的模块图快照 —— 客户端半侧有没有被发布、rev 是多少；
//   2. 图上给出的 bundle URL —— 服务端实际下发的脚本是否就是本地这一份；
//   3. %USERPROFILE%/.dsh/storages/dsh-incident-studio/client-boot.json ——
//      浏览器端跑到哪一步（apply / seat / panel）。
//
// 用法：node tools/check-live.mjs [--port 65240] [--fetch]

import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : Number(process.env.DSH_PORT ?? 65240);
const wantFetch = args.includes('--fetch');

/** 读模块图快照（SSE 连接的第一帧）。 */
function readGraph(basePort) {
	return new Promise((resolve, reject) => {
		const request = http.get({ host: '127.0.0.1', port: basePort, path: '/plugins/events', headers: { accept: 'text/event-stream' } }, (response) => {
			if (response.statusCode !== 200) {
				response.resume();
				reject(new Error(`/plugins/events 返回 ${response.statusCode}`));
				return;
			}
			let buffer = '';
			response.setEncoding('utf8');
			response.on('data', (chunk) => {
				buffer += chunk;
				const match = buffer.match(/data: (\{"type":"graph".*)/);
				if (match === null) return;
				clearTimeout(timer);
				response.destroy();
				try {
					resolve(JSON.parse(match[1]).graph);
				} catch (error) {
					reject(error);
				}
			});
		});
		const timer = setTimeout(() => {
			request.destroy();
			reject(new Error('等模块图超时'));
		}, 8000);
		request.on('error', reject);
	});
}

/** 取一个相对 URL 的文本。 */
function fetchText(basePort, relativePath) {
	return new Promise((resolve, reject) => {
		http.get({ host: '127.0.0.1', port: basePort, path: `/${relativePath}` }, (response) => {
			const chunks = [];
			response.on('data', (chunk) => chunks.push(chunk));
			response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
		}).on('error', reject);
	});
}

/** 主机侧某条路由是否存在：403 是我们处理器自己的拒绝，404 才是没注册。 */
function probeRoute(basePort, routePath, method) {
	return new Promise((resolve) => {
		const payload = method === 'POST' ? '{}' : null;
		const headers = payload === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) };
		const request = http.request({ host: '127.0.0.1', port: basePort, path: routePath, method, headers, agent: false }, (response) => {
			response.resume();
			response.on('end', () => resolve(response.statusCode));
		});
		request.on('error', () => resolve(-1));
		request.setTimeout(5000, () => {
			request.destroy();
			resolve(-1);
		});
		if (payload === null) request.end();
		else request.end(payload);
	});
}

const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');
const beaconPath = path.join(dshHome, 'storages', 'dsh-incident-studio', 'client-boot.json');
const routes = [
	['GET', '/dsh-incident-studio/api/state'],
	['POST', '/dsh-incident-studio/api/start'],
	['GET', '/dsh-incident-studio/api/events?since=0'],
	['GET', '/dsh-incident-studio/api/input?since=0'],
	['GET', '/dsh-incident-studio/api/capture/sources'],
	['GET', '/dsh-incident-studio/api/incidents'],
	['GET', '/dsh-incident-studio/api/client-boot'],
	['GET', '/dsh-incident-studio/api/definitely-missing'],
];

/** 待处理项计数。 */
let problems = 0;

console.log(`== 主机路由（403 = 已注册且按设计拒绝外部请求；404 = 没注册）==`);
for (const [method, routePath] of routes) {
	const status = await probeRoute(port, routePath, method);
	const expected = routePath.endsWith('definitely-missing') ? 404 : 403;
	const okStatus = status === expected;
	if (!okStatus) problems += 1;
	console.log(`  ${okStatus ? 'OK  ' : 'FAIL'} ${method.padEnd(4)} ${status.toString().padStart(4)}  ${routePath}`);
}

console.log(`\n== 客户端模块图 ==`);
let entry = null;
try {
	const graph = await readGraph(port);
	console.log(`  release ${graph.release?.version} (${graph.release?.commit})  rev ${graph.rev}`);
	console.log(`  条目总数 ${graph.entries.length}`);
	entry = graph.entries.find((item) => item.id === 'dsh-incident-studio') ?? null;
	if (entry === null) {
		problems += 1;
		console.log('  FAIL 图里没有 dsh-incident-studio —— 客户端半侧没发布');
	} else {
		console.log(`  OK   entry ${entry.id}  rev ${entry.rev}`);
		console.log(`       url ${entry.url}`);
	}
} catch (error) {
	problems += 1;
	console.log(`  FAIL 读不到模块图：${error.message}`);
}

if (entry !== null && wantFetch) {
	console.log(`\n== 服务端下发的 bundle ==`);
	try {
		const result = await fetchText(port, entry.url);
		console.log(`  HTTP ${result.status}  ${result.text.length} 字节`);
		if (result.status !== 200) {
			problems += 1;
		} else {
			const served = createHash('sha256').update(result.text).digest('hex');
			const localRaw = await readFile(path.join(projectRoot, 'client.js'), 'utf8');
			const local = createHash('sha256').update(localRaw).digest('hex');
			// 服务端下发的 body = 我们的脚本 + 一行 source-map trailer，
			// 所以判等用「完整包含」而不是整串比较。
			const matches = result.text.includes(localRaw.trimEnd());
			console.log(`  sha256 服务端 ${served.slice(0, 16)}  本地 ${local.slice(0, 16)}（服务端多一行 map trailer，属正常）`);
			console.log(`  ${matches ? 'OK  ' : 'WARN'} 服务端下发的正文${matches ? '就是' : '不等于'}本地 client.js`);
			if (!matches) problems += 1;
			console.log(`  beacon 代码在包里：${result.text.includes('client-boot') ? '是' : '否'}`);
			console.log(`  侧边栏注册在包里：${result.text.includes('sidebar.right.pane.tab') ? '是' : '否'}`);
			console.log(`  输入记录 UI 在包里：${result.text.includes('/input?since=') ? '是' : '否'}`);
		}
	} catch (error) {
		problems += 1;
		console.log(`  FAIL 拉不到 bundle：${error.message}`);
	}
}

console.log(`\n== 宿主抓帧能力（capture-capability.json）==`);
try {
	const capabilityPath = path.join(dshHome, 'storages', 'dsh-incident-studio', 'capture-capability.json');
	const capability = JSON.parse(await readFile(capabilityPath, 'utf8'));
	console.log(`  ${capability.at}  platform=${capability.platform}  electron=${capability.electron}  mode=${capability.mode || '(旧版宿主没写)'}`);
	if (capability.electron === true) {
		console.log(`  OK   屏幕 ${capability.screenCount} 个 / 窗口 ${capability.windowCount} 个（只数数量，不抓像素）`);
	} else if (capability.mode === 'gdi') {
		console.log('  OK   原生抓帧不可用，已启用 Windows GDI 抓屏助手');
	} else {
		problems += 1;
		console.log(`  FAIL 没有任何抓帧能力：${capability.reason || capability.error || '未知原因'}`);
	}
} catch (error) {
	problems += 1;
	console.log(`  FAIL 还没有能力回执（${error.code ?? error.message}）`);
}

console.log(`\n== 宿主输入记录能力（input-capability.json）==`);
try {
	const capabilityPath = path.join(dshHome, 'storages', 'dsh-incident-studio', 'input-capability.json');
	const capability = JSON.parse(await readFile(capabilityPath, 'utf8'));
	console.log(`  ${capability.at}  platform=${capability.platform}  mode=${capability.mode}  available=${capability.available}`);
	if (capability.available === true) {
		console.log(`  OK   助手可用：${capability.keys} 键位，PowerShell ${capability.ps || '?'}，探测耗时 ${capability.elapsedMs}ms`);
	} else {
		problems += 1;
		console.log(`  FAIL 输入助手不可用：${capability.reason || capability.error || '未知原因'}`);
	}
} catch (error) {
	problems += 1;
	console.log(`  FAIL 还没有输入能力回执（${error.code ?? error.message}）——宿主可能还没重载新版本`);
}

console.log(`\n== 浏览器端回执（client-boot.json）==`);
try {
	const info = await stat(beaconPath);
	const document = JSON.parse(await readFile(beaconPath, 'utf8'));
	console.log(`  文件 ${beaconPath}（${info.size} 字节，${info.mtime.toLocaleString('zh-CN')}）`);
	for (const [stage, value] of Object.entries(document.stages ?? {})) {
		console.log(`  ${stage.padEnd(8)} ${value.at}${value.href ? `  ${value.href}` : ''}`);
	}
	if (document.stages?.panel === undefined) {
		console.log('  提示：还没有 panel 阶段——说明面板没被打开过（打开右侧栏的「现场取证台」即可）');
	}
} catch (error) {
	console.log(`  还没有回执（${error.code ?? error.message}）`);
	console.log('  说明浏览器端还没跑过这一版 bundle：刷新一次 DSH 页面即可。');
	problems += 1;
}

console.log(`\n结论：${problems === 0 ? '全部通过' : `${problems} 项待处理`}`);
process.exitCode = problems === 0 ? 0 : 1;
