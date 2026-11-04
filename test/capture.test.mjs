// test/capture.test.mjs — 采集轮询与 HTTP 客户端的回归测试。
//
// 做法：把 globalThis.fetch 换成一个按路径回假数据的桩件，然后真正跑
// createNativeCapture 的 start/pull/stop 与 API.* 的错误映射。
// 覆盖的是「面板与宿主之间那层胶水」——真实浏览器里最容易悄悄坏掉的一段。

import { equal, ok, contains, sleep } from './harness.mjs';
import { loadClient } from './pure.test.mjs';

/** 造一个 Response 形状的对象。 */
function jsonResponse(payload, status) {
	return {
		ok: status === undefined || status < 400,
		status: status ?? 200,
		async json() {
			return payload;
		},
	};
}

/** 装一个按路径分派的 fetch 桩件，返回调用记录与卸载函数。 */
function installFetchStub(routes) {
	const previous = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (url, init) => {
		const entry = { url: String(url), init: init ?? {} };
		calls.push(entry);
		for (const [matcher, handler] of routes) {
			if (typeof matcher === 'string' ? entry.url.includes(matcher) : matcher.test(entry.url)) {
				return handler(entry);
			}
		}
		return jsonResponse({ ok: false, code: 'unrouted', message: `没有桩件处理 ${entry.url}` }, 500);
	};
	return {
		calls,
		restore() {
			globalThis.fetch = previous;
		},
	};
}

/** 跑采集链路断言。 */
export async function run() {
	const exported = await loadClient();
	const build = exported.__export;
	ok(build !== undefined, '导出 __export 测试出口');
	ok(typeof build.createNativeCapture === 'function', '导出 createNativeCapture');
	ok(build.API !== undefined, '导出 API');

	// -------------------- API 错误映射 --------------------
	{
		const stub = installFetchStub([
			['/api/state', () => jsonResponse({ ok: false, code: 'forbidden', message: '请求被拒绝' }, 403)],
			['/api/profiles', () => ({ ok: true, status: 200, async json() { throw new Error('不是 JSON'); } })],
		]);
		try {
			const denied = await build.API.state();
			equal(denied.ok, false, 'API.state 把 403 映射成 ok:false');
			equal(denied.code, 'forbidden', 'API.state 保留错误码');
			equal(denied.message, '请求被拒绝', 'API.state 保留错误文案');
			const broken = await build.API.profiles.load();
			equal(broken.ok, false, '响应不是 JSON 时返回 ok:false');
			contains(broken.code, 'http-200', '非 JSON 响应带上 http 状态');
		} finally {
			stub.restore();
		}
	}

	// -------------------- 原生帧采集轮询 --------------------
	{
		let poll = 0;
		const started = [];
		const stub = installFetchStub([
			['/api/capture/start', (entry) => {
				started.push(JSON.parse(entry.init.body));
				return jsonResponse({ ok: true, value: { capture: { running: true, sourceId: 'screen:0', fps: 6, frames: 0, captured: 0 } } });
			}],
			['/api/capture/frames', () => {
				poll += 1;
				const frames = poll === 1
					? [
						{ seq: 1, wall: 1000, jpeg: Buffer.from([0xff, 0xd8, 0x01]).toString('base64') },
						{ seq: 2, wall: 1160, jpeg: Buffer.from([0xff, 0xd8, 0x02]).toString('base64') },
					]
					: [];
				return jsonResponse({ ok: true, value: { frames, capture: { running: poll < 3, frames: poll, captured: poll }, t0: 1000 } });
			}],
			['/api/capture/stop', () => jsonResponse({ ok: true, value: { capture: { running: false } } })],
		]);

		const frames = [];
		const statuses = [];
		const capture = build.createNativeCapture({
			onFrame: (frame) => frames.push(frame),
			onStatus: (status) => statuses.push(status),
			intervalMs: 40,
		});
		try {
			await capture.start('screen:0');
			equal(started.length, 1, 'start 只发一次 capture/start');
			equal(started[0].sourceId, 'screen:0', 'start 带上选中的采集源 id');
			ok(statuses.length >= 1, 'start 之后收到了状态回调');
			equal(frames.length, 2, '首轮轮询拿到 2 帧');
			equal(frames[0].seq, 1, '帧保留序号');
			ok(frames[0].blob instanceof Blob, '帧被转换成 Blob');
			equal(frames[0].blob.type, 'image/jpeg', '帧 Blob 的媒体类型是 JPEG');
			equal(await frames[0].blob.arrayBuffer().then((buffer) => new Uint8Array(buffer).length), 3, '帧字节数正确');

			await sleep(140);
			ok(poll >= 3, `按 intervalMs 持续轮询（实际 ${poll} 次）`);
			equal(frames.length, 2, '后续轮询没有新增帧时不重复回调');

			await capture.stop();
			const stopIndex = stub.calls.findIndex((call) => call.url.includes('/api/capture/stop'));
			ok(stopIndex >= 0, 'stop 调用了 capture/stop');
			const frameCalls = stub.calls.map((call, index) => (call.url.includes('/api/capture/frames') ? index : -1)).filter((index) => index >= 0);
			ok(frameCalls.some((index) => index > stopIndex), '停止之后还补拉了一次（收掉最后几帧）');
			ok(frameCalls.some((index) => index < stopIndex), '停止之前先收掉已落盘的帧');
			const pollsAfterStop = poll;
			await sleep(100);
			equal(poll, pollsAfterStop, 'stop 之后不再按间隔轮询');
		} finally {
			stub.restore();
		}
	}

	// -------------------- 采集启动失败要能报错 --------------------
	{
		const stub = installFetchStub([
			['/api/capture/start', () => jsonResponse({ ok: false, code: 'no-native-capture', message: '当前宿主不支持桌面采集' }, 409)],
		]);
		const capture = build.createNativeCapture({ onFrame: () => {}, onStatus: () => {}, intervalMs: 50 });
		try {
			let message = '';
			try {
				await capture.start('screen:0');
			} catch (error) {
				message = String(error?.message ?? error);
			}
			contains(message, '不支持', '采集启动失败时把宿主原因抛给调用方');
		} finally {
			stub.restore();
		}
	}

	// -------------------- 自检回报 --------------------
	{
		const stub = installFetchStub([
			['/api/state', () => jsonResponse({
				ok: true,
				value: {
					platform: 'win32',
					artifactsDirName: '.dsh-incidents',
					profiles: { version: 1, activeId: 'default', profiles: [{ id: 'default', name: '默认', sources: [] }] },
					capture: { native: true, nativeReason: '', fps: 6, width: 960, quality: 62 },
				},
			})],
			['/api/capture/sources', () => jsonResponse({
				ok: true,
				value: { available: true, screens: [{ id: 'screen:0', name: '整个屏幕' }], windows: [{ id: 'window:1', name: 'Remains' }] },
			})],
			['/api/client-boot', (entry) => {
				const body = JSON.parse(entry.init.body);
				equal(body.stage, 'selftest', '自检回报的 stage 是 selftest');
				equal(body.detail.native, true, '自检回报原生抓帧可用');
				equal(body.detail.captureSources.screens, 1, '自检回报屏幕数量');
				equal(body.detail.captureSources.windows, 1, '自检回报窗口数量');
				equal(body.detail.profileCount, 1, '自检回报配置数量');
				return jsonResponse({ ok: true, value: { stage: 'selftest' } });
			}],
		]);
		try {
			await build.runSelfTest();
			ok(stub.calls.some((call) => call.url.includes('/api/client-boot')), '自检把结果写回主机');
		} finally {
			stub.restore();
		}
	}
}
