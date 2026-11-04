// test/dom.test.mjs — 在 jsdom 里真的把面板挂起来、点一遍。
//
// 前面几套测试分别验了纯函数、编码、票证；这一套验的是「用户真的点得到」：
//   挂载 → 待命视图 → 点开始录制 → 收到帧与日志 → 打点 → 停止
//   → 复看视图 → 填问题描述 → 点填进输入框 → composer 收到正文与附件
//
// 覆盖的是 React 副作用、轮询定时器、状态机与递交链路一起工作的样子。

import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { equal, ok, contains, sleep } from './harness.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const clientPath = resolve(here, '..', 'client.js');

/** 一个最小的 2D 上下文桩件（导出的产物编码会用到）。 */
function createContext2D() {
	return {
		fillStyle: '#000',
		strokeStyle: '#000',
		lineWidth: 1,
		font: '10px sans-serif',
		textBaseline: 'alphabetic',
		textAlign: 'start',
		save() {},
		restore() {},
		setLineDash() {},
		clearRect() {},
		fillRect() {},
		strokeRect() {},
		drawImage() {},
		fillText() {},
		measureText: (text) => ({ width: String(text).length * 6 }),
		getImageData: (x, y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4).fill(200), width, height }),
	};
}

/** 装好 jsdom 与浏览器桩件；返回卸载函数。 */
function installDom() {
	const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
		url: 'http://127.0.0.1:65240/',
		pretendToBeVisual: true,
	});
	const { window } = dom;

	// 让 bundle 与 React 看到同一套全局
	const names = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLCanvasElement', 'Node', 'Element', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'Blob', 'File', 'FileReader', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle'];
	const previous = new Map();
	for (const name of names) {
		previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		const value = name === 'window' ? window : window[name];
		if (value === undefined) continue;
		// Node 24 的 navigator 之类是 getter-only，必须用 defineProperty 覆盖
		try {
			Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
		} catch {
			/* 个别全局改不动就跳过 */
		}
	}

	// jsdom 的 navigator.language 是 en-US；插件的文案跟随它，这里钉成中文再加载 bundle。
	Object.defineProperty(window.navigator, 'language', { value: 'zh-CN', configurable: true });
	Object.defineProperty(window.navigator, 'languages', { value: ['zh-CN'], configurable: true });

	// jsdom 没有 canvas 实现：给原型挂上桩件
	const context = createContext2D();
	window.HTMLCanvasElement.prototype.getContext = () => context;
	window.HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type) {
		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, this.width & 0xff, this.height & 0xff]);
		callback(new window.Blob([bytes], { type: type ?? 'image/png' }));
	};
	window.URL.createObjectURL = () => `blob:jsdom-${Math.random().toString(36).slice(2)}`;
	window.URL.revokeObjectURL = () => {};
	// bundle 是当普通 ESM 载入的，它看到的是 Node 的全局 URL；两套都打桩。
	let objectUrlCounter = 0;
	globalThis.URL.createObjectURL = () => `blob:node-${(objectUrlCounter += 1)}`;
	globalThis.URL.revokeObjectURL = () => {};
	// 布局尺寸：jsdom 一律返回 0，标注层要靠它换算坐标
	window.Element.prototype.getBoundingClientRect = function rect() {
		return { x: 0, y: 0, left: 0, top: 0, width: 360, height: 203, right: 360, bottom: 203, toJSON() {} };
	};
	globalThis.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	window.ResizeObserver = globalThis.ResizeObserver;
	// Image：直接给一张 960×540 的假图
	globalThis.Image = class MockImage {
		constructor() {
			this.width = 960;
			this.height = 540;
			this.onload = null;
			this.onerror = null;
			this._src = '';
		}

		set src(value) {
			this._src = value;
			setTimeout(() => this.onload?.(), 0);
		}

		get src() {
			return this._src;
		}
	};

	return {
		window,
		dom,
		restore() {
			for (const [name, descriptor] of previous) {
				try {
					if (descriptor === undefined) delete globalThis[name];
					else Object.defineProperty(globalThis, name, descriptor);
				} catch {
					/* 恢复不了的忽略 */
				}
			}
			dom.window.close();
		},
	};
}

/** 造一个假宿主：按路径返回 JSON，并记录调用。 */
function createFakeHost() {
	const calls = [];
	let framesServed = false;
	let recording = null;
	/** 客户端在 /start 里送来的录制起点；帧与事件的时间都相对它。 */
	let startedT0 = 1700000000000;
	const state = {
		ingestToken: 'token-1',
		dshHome: 'C:/Users/test/.dsh',
		artifactsDirName: '.dsh-incidents',
		profiles: {
			version: 1,
			activeId: 'p1',
			profiles: [
				{
					id: 'p1',
					name: 'Remains 联机',
					note: '',
					sources: [
						{ id: 'log-a', kind: 'file', label: 'Host', color: '#6aa9ff', path: 'C:/logs/RConnect.log', enabled: true, preRoll: true },
					],
					updatedAt: '',
				},
			],
		},
		recording: null,
		now: 1700000000000,
		platform: 'win32',
		capture: { native: true, nativeReason: '', fps: 6, width: 960, quality: 62 },
	};

	globalThis.fetch = async (url, init) => {
		const text = String(url);
		const method = init?.method ?? 'GET';
		const body = init?.body === undefined ? undefined : JSON.parse(init.body);
		calls.push({ url: text, method, body });
		const respond = (payload) => ({ ok: true, status: 200, async json() { return payload; } });
		if (text.endsWith('/api/state')) return respond({ ok: true, value: { ...state, recording } });
		if (text.includes('/api/capture/sources')) {
			return respond({ ok: true, value: { available: true, screens: [{ id: 'screen:0', name: '整个屏幕' }], windows: [{ id: 'window:1', name: 'Remains' }] } });
		}
		if (text.endsWith('/api/capture/start')) return respond({ ok: true, value: { capture: { running: true, sourceId: body?.sourceId ?? 'screen:0', fps: 6, frames: 0, captured: 0 } } });
		if (text.includes('/api/capture/frames')) {
			const since = Number(new URL(text, 'http://x').searchParams.get('since') ?? '0');
			const frames = !framesServed && since === 0
				? [
					{ seq: 1, wall: startedT0 + 100, jpeg: Buffer.from([0xff, 0xd8, 1]).toString('base64') },
					{ seq: 2, wall: startedT0 + 900, jpeg: Buffer.from([0xff, 0xd8, 2]).toString('base64') },
					{ seq: 3, wall: startedT0 + 1600, jpeg: Buffer.from([0xff, 0xd8, 3]).toString('base64') },
				]
				: [];
			if (!framesServed && frames.length > 0) framesServed = true;
			return respond({ ok: true, value: { frames, capture: { running: true, sourceId: 'screen:0', fps: 6, frames: 3, captured: 3 }, t0: startedT0 } });
		}
		if (text.endsWith('/api/capture/stop')) return respond({ ok: true, value: { capture: { running: false } } });
		if (text.endsWith('/api/start')) {
			startedT0 = Number.isFinite(body?.t0) ? body.t0 : Date.now();
			recording = {
				id: 'rec-1',
				recording: true,
				t0: startedT0,
				startedAt: '2026-11-04T12:00:00.000Z',
				stoppedAt: '',
				profileId: 'p1',
				sessionId: body?.sessionId ?? '',
				cwd: 'D:/work',
				seq: 0,
				dropped: 0,
				sources: (body?.sources ?? []).map((source) => ({ ...source, status: { ok: true, started: true, lines: 0, size: 0, offset: 0, binaryDropped: 0, error: '' } })),
				capture: null,
			};
			return respond({ ok: true, value: { reused: false, recording } });
		}
		if (text.includes('/api/events?since=')) {
			const since = Number(new URL(text, 'http://x').searchParams.get('since') ?? '0');
			const events = since === 0
				? [
					{ seq: 0, src: 'log-a', level: 'info', text: 'RConnect: init', wall: 1699999999990, relMs: -10, pre: true, marker: '' },
					{ seq: 1, src: 'log-a', level: 'error', text: 'ReferenceError: chest state mismatch', wall: 1700000000900, relMs: 900, pre: false, marker: '' },
				]
				: [];
			return respond({ ok: true, value: { events, cursor: events.length, dropped: 0, recording } });
		}
		if (text.endsWith('/api/marker')) {
			return respond({ ok: true, value: { event: { seq: 2, src: 'marker', level: 'info', text: '【打点】问题点', wall: startedT0 + 1500, relMs: 1500, pre: false, marker: '问题点' }, cursor: 3 } });
		}
		if (text.endsWith('/api/stop')) {
			recording = recording === null ? null : { ...recording, recording: false, stoppedAt: '2026-11-04T12:00:05.000Z' };
			return respond({ ok: true, value: { recording } });
		}
		if (text.endsWith('/api/artifact')) {
			return respond({ ok: true, value: { path: `D:/work/.dsh-incidents/rec-1/${body?.name ?? 'a.png'}`, name: body?.name ?? 'a.png', bytes: 10, dir: 'D:/work/.dsh-incidents/rec-1' } });
		}
		if (text.endsWith('/api/bundle')) {
			return respond({
				ok: true,
				value: {
					dir: 'D:/work/.dsh-incidents/rec-1',
					markdownPath: 'D:/work/.dsh-incidents/rec-1/bundle.md',
					jsonPath: 'D:/work/.dsh-incidents/rec-1/bundle.json',
					markdown: '# 纪要',
					eventCount: Array.isArray(body?.events) ? body.events.length : 0,
					id: 'rec-1',
				},
			});
		}
		if (text.includes('/api/incidents')) return respond({ ok: true, value: { root: 'D:/work/.dsh-incidents', items: [] } });
		if (text.endsWith('/api/client-boot')) return respond({ ok: true, value: { stage: body?.stage ?? 'unknown' } });
		if (text.endsWith('/api/profiles')) return respond({ ok: true, value: state.profiles });
		return respond({ ok: false, code: 'unrouted', message: `没有桩件处理 ${text}` });
	};

	return { calls, state, setRecording: (value) => { recording = value; } };
}

/** 轮询等待条件成立。 */
async function waitFor(label, predicate, timeoutMs) {
	const deadline = Date.now() + (timeoutMs ?? 6000);
	for (;;) {
		const value = await predicate();
		if (value) return value;
		if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
		await sleep(25);
	}
}

/** 超时时把界面现状打进错误信息，省得盲猜。 */
function describeContainer(container) {
	const text = (container.textContent ?? '').replace(/\s+/g, ' ').trim();
	const buttons = [...container.querySelectorAll('button')].map((button) => button.textContent.trim()).filter(Boolean);
	return `界面文字="${text.slice(0, 300)}" 按钮=${JSON.stringify(buttons)}`;
}

/** 按文字找按钮。 */
function findButton(container, text) {
	return [...container.querySelectorAll('button')].find((button) => (button.textContent ?? '').includes(text));
}

/** 跑 DOM 级交互断言。 */
export async function run() {
	const originalFetch = globalThis.fetch;
	const dom = installDom();
	const host = createFakeHost();
	const captured = [];
	let React = null;
	let createRoot = null;
	try {
		dom.window.__ModuleLoader__ = {
			load(spec) {
				captured.push(spec);
			},
		};
		await import(`${pathToFileURL(clientPath).href}?dom=${Date.now()}`);

		// 先装全局再用 React，否则 react-dom 会绑到旧 document
		React = require('react');
		const ReactDOMClient = require('react-dom/client');
		createRoot = ReactDOMClient.createRoot;
		ok(captured.length === 1, 'client bundle 在 DOM 环境里注册了一次');
		const spec = captured[0];

		// 假客户端上下文：座位注册 + composer 递交都记下来
		const deliveryLog = { drafts: [], attached: [], draftText: '', submitted: 0 };
		const conversation = {
			input: {
				for() {
					return {
						setDraft(text) { deliveryLog.draftText = text; },
						addAttachments(ids) { deliveryLog.attached.push(...ids); return true; },
						submit() { deliveryLog.submitted += 1; },
						state: { getSnapshot: () => ({ draft: deliveryLog.draftText, draftRev: 1 }) },
						notify() {},
						focus() {},
					};
				},
			},
			createDrafts(sessionId, files) {
				deliveryLog.drafts.push({ sessionId, names: files.map((file) => file.name) });
				return files.map((file, index) => ({ id: `draft-${index + 1}`, name: file.name }));
			},
		};
		const slots = [];
		const ctx = {
			effect(fn) { const dispose = fn(); return () => dispose?.(); },
			get(name) {
				if (name === 'sidebarRightTabs') return { register: () => () => {} };
				if (name === 'sidebarRight') return { openTab() {} };
				if (name === 'conversation') return conversation;
				if (name === 'sessions') return { list: { getSnapshot: () => ({ current: 'session-1' }) }, scope: (id) => ({ sessionId: id }) };
				return undefined;
			},
			slots: {
				inject(name, factory) { return factory(); },
				register(definition, Component) { slots.push({ ...definition, Component }); return () => {}; },
			},
		};
		const exported = spec.factory((name) => {
			if (name === 'react') return React;
			return require(name);
		});
		exported.apply(ctx);
		const bodySlot = slots.find((slot) => slot.name === 'sidebar.right.pane.tab');
		ok(bodySlot !== undefined, '侧边栏正文座位已注册');

		// -------------------- 挂载 --------------------
		const container = dom.window.document.getElementById('root');
		const root = createRoot(container);
		root.render(React.createElement(bodySlot.Component, { sessionId: 'session-1' }));

		await waitFor('待命视图出现', () => (container.textContent ?? '').includes('开始录制')).catch((error) => {
			throw new Error(`${error.message}（${describeContainer(container)}）`);
		});
		// 初始数据（配置 + 采集源）是异步拉的，等它到齐再断言/点击
		await waitFor('配置加载完成', () => (container.textContent ?? '').includes('Remains 联机'));
		await waitFor('采集源列表加载完成', () => (container.textContent ?? '').includes('整个屏幕'));
		contains(container.textContent ?? '', '现场取证台', '面板标题渲染出来');
		contains(container.textContent ?? '', 'Remains 联机', '读到并显示了当前配置名');
		contains(container.textContent ?? '', 'Host', '显示了日志源名称');

		// -------------------- 开始录制 --------------------
		const startButton = findButton(container, '开始录制');
		ok(startButton !== undefined, '找得到开始录制按钮');
		startButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

		await waitFor('进入录制态', () => (container.textContent ?? '').includes('录制中'));
		const startCall = host.calls.find((call) => call.url.endsWith('/api/start'));
		ok(startCall !== undefined, '点了开始录制就调用了 /start');
		equal(startCall.body?.profileId, 'p1', '/start 带上当前配置 id');
		equal(startCall.body?.sources?.length, 1, '/start 只带启用的日志源');
		equal(startCall.body?.sessionId, 'session-1', '/start 带上会话 id');
		ok(Number.isFinite(startCall.body?.t0), '/start 带上录制起点时间');
		ok(host.calls.some((call) => call.url.endsWith('/api/capture/start')), '同时启动了桌面抓帧');

		// 帧与日志在新一轮轮询后出现
		await waitFor('收到画面帧', () => container.querySelector('img') !== null);
		const image = container.querySelector('img');
		ok(image.getAttribute('src').startsWith('blob:'), '画面用 object URL 渲染');
		await waitFor('收到日志事件', () => (container.textContent ?? '').includes('ReferenceError'));
		contains(container.textContent ?? '', '00:00.900', '日志行带相对时间');

		// -------------------- 打点 --------------------
		const markerButton = findButton(container, '打点');
		ok(markerButton !== undefined, '找得到打点按钮');
		markerButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
		await waitFor('打点被记录', () => host.calls.some((call) => call.url.endsWith('/api/marker')));

		// -------------------- 停止 --------------------
		const stopButton = findButton(container, '停止');
		ok(stopButton !== undefined, '找得到停止按钮');
		stopButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
		await waitFor('进入复看态', () => (container.textContent ?? '').includes('问题描述'), 8000);
		ok(host.calls.some((call) => call.url.endsWith('/api/capture/stop')), '停止时收掉抓帧');
		ok(host.calls.some((call) => call.url.endsWith('/api/stop')), '停止时结束录制');

		// -------------------- 填问题描述 --------------------
		const textarea = container.querySelector('textarea');
		ok(textarea !== null, '复看态有描述输入框');
		const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')?.set;
		setter.call(textarea, '捡起箱子后角色浮空');
		textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
		await sleep(30);

		// -------------------- 填进输入框 --------------------
		const deliverButton = findButton(container, '填进输入框');
		ok(deliverButton !== undefined, '找得到填进输入框按钮');
		deliverButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

		await waitFor('递交完成', () => deliveryLog.draftText !== '', 12000);
		contains(deliveryLog.draftText, '捡起箱子后角色浮空', '正文带上问题描述');
		contains(deliveryLog.draftText, 'bundle.md', '正文指向完整纪要');
		contains(deliveryLog.draftText, 'ReferenceError: chest state mismatch', '正文带上区间内的日志');
		contains(deliveryLog.draftText, '00:00.900', '正文里的日志带相对时间');
		ok(deliveryLog.drafts.length >= 1, '附件登记到了 composer');
		ok(deliveryLog.drafts[0].names.includes('frames.png'), '关键帧条带作为附件');
		const bundleCall = host.calls.find((call) => call.url.endsWith('/api/bundle'));
		ok(bundleCall !== undefined, '递交前写入了取证包');
		equal(
			Array.isArray(bundleCall.body?.events) ? bundleCall.body.events.length : -1,
			2,
			`取证包里带上区间内全部事件（区间 ${bundleCall.body?.fromRel}→${bundleCall.body?.toRel}）`,
		);
		ok(host.calls.filter((call) => call.url.endsWith('/api/artifact')).length >= 1, '生成产物上传落盘');
		equal(deliveryLog.submitted, 0, '「填进输入框」不自动发送');
		await waitFor('递交提示出现', () => (container.textContent ?? '').includes('已填进输入框'));
		contains(container.textContent ?? '', '已填进输入框', '界面给出递交成功提示');

		root.unmount();
	} finally {
		globalThis.fetch = originalFetch;
		dom.restore();
	}
}
