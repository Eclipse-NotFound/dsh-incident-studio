// test/export.test.mjs — 产物编码回归测试（用最小的 Canvas/Image 桩件）。
//
// 目的：真正跑一遍 composeFrame / buildFrameStrip / buildGif 这条链路，
// 特别是 gifenc 的用法（首帧全局调色板、delay、bytesView），以及条带图的拼装
// 尺寸。像素内容用桩件代替（Node 里没有 Canvas2D），但编码出的字节是真的 GIF。

import { equal, ok, contains } from './harness.mjs';
import { loadClient } from './pure.test.mjs';

/** 一个会记录调用的 2D 上下文桩件。 */
function createContext2D(canvas) {
	const calls = [];
	return {
		calls,
		canvas,
		fillStyle: '#000',
		strokeStyle: '#000',
		lineWidth: 1,
		font: '10px sans-serif',
		textBaseline: 'alphabetic',
		textAlign: 'start',
		clearRect(...args) {
			calls.push(['clearRect', ...args]);
		},
		fillRect(...args) {
			calls.push(['fillRect', ...args]);
		},
		strokeRect(...args) {
			calls.push(['strokeRect', ...args]);
		},
		setLineDash(pattern) {
			calls.push(['setLineDash', pattern.length]);
		},
		drawImage(...args) {
			calls.push(['drawImage', args[0]?.width ?? 0, args[0]?.height ?? 0]);
		},
		fillText(...args) {
			calls.push(['fillText', ...args]);
		},
		measureText(text) {
			return { width: String(text).length * 6 };
		},
		getImageData(x, y, width, height) {
			// 给出一块有变化的像素，让量化器有东西可做。
			const data = new Uint8ClampedArray(width * height * 4);
			for (let index = 0; index < width * height; index += 1) {
				const offset = index * 4;
				data[offset] = (index * 7) % 256;
				data[offset + 1] = (index * 13) % 256;
				data[offset + 2] = (index * 29) % 256;
				data[offset + 3] = 255;
			}
			return { data, width, height };
		},
		save() {},
		restore() {},
	};
}

/** 造一个 canvas 桩件。 */
function createCanvas() {
	const canvas = {
		width: 0,
		height: 0,
		_context: null,
		getContext() {
			if (canvas._context === null) canvas._context = createContext2D(canvas);
			return canvas._context;
		},
		toBlob(callback, type) {
			// 用一个带 PNG 魔法头的假 Blob，够验证“有没有产出”。
			const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, canvas.width & 0xff, canvas.height & 0xff]);
			callback(new Blob([bytes], { type: type ?? 'image/png' }));
		},
	};
	return canvas;
}

/** 在全局装好最小的浏览器桩件，返回卸载函数与创建过的画布。 */
function installDomStubs() {
	const previous = {
		document: globalThis.document,
		Image: globalThis.Image,
	};
	const canvases = [];
	const originalCreate = globalThis.URL?.createObjectURL;
	const originalRevoke = globalThis.URL?.revokeObjectURL;
	globalThis.URL = globalThis.URL ?? {};
	globalThis.URL.createObjectURL = () => `blob:mock-${canvases.length}`;
	globalThis.URL.revokeObjectURL = () => {};

	globalThis.document = {
		createElement(tag) {
			if (tag !== 'canvas') throw new Error(`桩件只支持 canvas，收到 ${tag}`);
			const canvas = createCanvas();
			canvases.push(canvas);
			return canvas;
		},
	};

	globalThis.Image = class MockImage {
		constructor() {
			this.width = 0;
			this.height = 0;
			this.onload = null;
			this.onerror = null;
			this._src = '';
		}

		set src(value) {
			this._src = value;
			// 960x540 的模拟画面
			this.width = 960;
			this.height = 540;
			Promise.resolve().then(() => this.onload?.());
		}

		get src() {
			return this._src;
		}
	};

	return {
		canvases,
		restore() {
			globalThis.document = previous.document;
			globalThis.Image = previous.Image;
			globalThis.URL.createObjectURL = originalCreate;
			globalThis.URL.revokeObjectURL = originalRevoke;
		},
	};
}

/** 跑产物导出的断言。需要访问内部函数，所以通过 __pure 之外的入口暴露。 */
export async function run() {
	const exported = await loadClient();
	const build = exported.__export;
	if (build === undefined) throw new Error('缺少 __export 测试出口（见 src/client/90-tail.js）');
	const dom = installDomStubs();
	const { restore } = dom;
	try {
		const t0 = 1700000000000;
		const frames = [];
		for (let index = 0; index < 24; index += 1) {
			frames.push({ seq: index + 1, wall: t0 + index * 160, blob: new Blob([new Uint8Array([index])], { type: 'image/jpeg' }) });
		}
		const annotations = [
			{ id: 'a1', rect: { x: 0.4, y: 0.3, w: 0.1, h: 0.12 }, note: '角色悬空' },
			{ id: 'a2', rect: { x: 0.7, y: 0.6, w: 0.08, h: 0.08 }, note: '' },
		];

		// --- 关键帧条带 ---
		dom.canvases.length = 0;
		const strip = await build.buildFrameStrip(frames, { count: 4, cellWidth: 200, t0, annotations });
		ok(strip !== null && strip.size > 0, `条带图生成了（${strip?.size ?? 0} 字节）`);
		equal(strip.type, 'image/png', '条带图是 PNG');
		const stripCanvas = dom.canvases.reduce((widest, canvas) => (canvas.width > widest.width ? canvas : widest), { width: 0 });
		equal(stripCanvas.width, 200 * 4 + 2 * 3, '条带宽度＝单元数×单元宽＋间隔');

		// --- 动图 ---
		const gif = await build.buildGif(frames, { maxWidth: 240, annotations, maxFrames: 12 });
		ok(gif !== null, '动图生成了');
		equal(gif.type, 'image/gif', '动图是 GIF');
		const bytes = new Uint8Array(await gif.arrayBuffer());
		ok(bytes.length > 100, `GIF 有实际内容（${bytes.length} 字节）`);
		const header = String.fromCharCode(...bytes.slice(0, 6));
		equal(header, 'GIF89a', 'GIF 文件头正确');
		equal(bytes[bytes.length - 1], 0x3b, 'GIF 以 trailer(0x3b) 结尾');
		// 帧数：GIF 里每个图片描述符以 0x2C 开头；这里只粗查数量下限。
		let imageDescriptors = 0;
		for (let index = 0; index < bytes.length - 1; index += 1) {
			if (bytes[index] === 0x2c && bytes[index + 1] === 0x00) imageDescriptors += 1;
		}
		ok(imageDescriptors >= 6, `GIF 里至少有 6 个帧块（粗查 ${imageDescriptors}）`);

		// --- 边界 ---
		equal(await build.buildFrameStrip([], { count: 4 }), null, '没有帧时条带返回 null');
		equal(await build.buildGif([], {}), null, '没有帧时动图返回 null');

		// --- 标注绘制（不只不抛错，还要画到画布上） ---
		const canvas = createCanvas();
		build.composeFrame(canvas, { width: 960, height: 540 }, { width: 240, annotations });
		equal(canvas.width, 240, 'composeFrame 按目标宽度设置画布');
		equal(canvas.height, 135, 'composeFrame 保持画面宽高比');
		const strokeCalls = canvas.getContext('2d').calls.filter((call) => call[0] === 'strokeRect');
		equal(strokeCalls.length, 2, '两个标注框都画出来了');
		ok(Math.abs(strokeCalls[0][1] - 0.4 * 240) < 0.001, '标注框 x 按归一化比例换算');
	} finally {
		restore();
	}
}
