// test/pure.test.mjs — 客户端纯函数回归测试。
//
// 做法：把真正会发布的 client.js 装进一个假的 window.__ModuleLoader__，
// 取出 factory 执行（react 用真实包），然后只测 __pure 里的纯函数。
// 这样测的就是产物本身，而不是另一份副本。

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { equal, ok, contains, notContains, lengthOf } from './harness.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const clientPath = resolve(here, '..', 'client.js');

/**
 * 装载 client.js 并返回它的导出。
 * @returns {Promise<object>} 模块导出（含 __pure）。
 */
export async function loadClient() {
	const registrations = [];
	globalThis.window = {
		__ModuleLoader__: {
			load(spec) {
				registrations.push(spec);
			},
		},
	};
	await import(`${pathToFileURL(clientPath).href}?v=${Date.now()}`);
	if (registrations.length !== 1) throw new Error(`client.js 应当注册 1 次，实际 ${registrations.length}`);
	const spec = registrations[0];
	if (spec.id !== 'dsh-incident-studio') throw new Error(`注册 id 不对：${spec.id}`);
	const React = require('react');
	const exports = spec.factory((name) => {
		if (name === 'react') return React;
		return require(name);
	});
	return exports;
}

/** 跑全部客户端纯函数断言。 */
export async function run() {
	const exported = await loadClient();
	const pure = exported.__pure;
	ok(typeof exported.apply === 'function', '导出 apply 是一个函数');
	ok(Array.isArray(exported.inject), '导出 inject 是数组');
	ok(pure !== undefined, '导出 __pure 测试出口');

	// --- formatRel ---
	equal(pure.formatRel(0), '00:00.000', 'formatRel 零点');
	equal(pure.formatRel(12345), '00:12.345', 'formatRel 12.345 秒');
	equal(pure.formatRel(60000), '01:00.000', 'formatRel 一分钟');
	equal(pure.formatRel(-1500), '-00:01.500', 'formatRel 负数（录制前）');
	equal(pure.formatRel(undefined), '00:00.000', 'formatRel 非法输入回落 0');

	// --- classifyLevel ---
	equal(pure.classifyLevel('ReferenceError: boom'), 'error', 'classifyLevel 识别 error');
	equal(pure.classifyLevel('[WARN] retry'), 'warn', 'classifyLevel 识别 warn');
	equal(pure.classifyLevel('RConnect: tick 400'), 'info', 'classifyLevel 普通行');
	equal(pure.classifyLevel('Error #1069'), 'error', 'classifyLevel 识别 AS3 错误号');

	// --- clampNumber / humanBytes ---
	equal(pure.clampNumber(5, 0, 3), 3, 'clampNumber 上界');
	equal(pure.clampNumber(-5, 0, 3), 0, 'clampNumber 下界');
	equal(pure.clampNumber(Number.NaN, 7, 9), 7, 'clampNumber NaN 回落 min');
	equal(pure.humanBytes(2048), '2.0 KB', 'humanBytes KB');
	equal(pure.humanBytes(0), '0 B', 'humanBytes 零');

	// --- pickEvenIndices ---
	const even = pure.pickEvenIndices(10, 4);
	equal(JSON.stringify(even), JSON.stringify([0, 3, 6, 9]), 'pickEvenIndices 等距取 4 个');
	equal(pure.pickEvenIndices(3, 10).length, 3, 'pickEvenIndices 数量多于样本时全取');
	equal(pure.pickEvenIndices(0, 5).length, 0, 'pickEvenIndices 空输入');

	// --- 帧与区间 ---
	const t0 = 1000000;
	const frames = [
		{ seq: 1, wall: t0 - 500 },
		{ seq: 2, wall: t0 + 1000 },
		{ seq: 3, wall: t0 + 2500 },
		{ seq: 4, wall: t0 + 6000 },
	];
	equal(pure.frameRel(frames[1], t0), 1000, 'frameRel 相对时间');
	lengthOf(pure.framesInRange(frames, 0, 3000, t0), 2, 'framesInRange 闭区间');
	lengthOf(pure.framesInRange(frames, -1000, 0, t0), 1, 'framesInRange 能取到录制前的帧');
	equal(pure.nearestFrameIndex(frames, 5100, t0), 3, 'nearestFrameIndex 命中最近帧');
	equal(pure.nearestFrameIndex([], 0, t0), -1, 'nearestFrameIndex 空序列');

	// --- selectEvents ---
	const events = [
		{ seq: 0, src: 'a', level: 'info', text: 'start', relMs: 0 },
		{ seq: 1, src: 'a', level: 'error', text: 'ReferenceError: boom', relMs: 1500 },
		{ seq: 2, src: 'b', level: 'warn', text: 'slow tick', relMs: 4000 },
		{ seq: 3, src: 'marker', level: 'info', text: '【打点】问题点', relMs: 5000, marker: '问题点' },
		{ seq: 4, src: 'a', level: 'info', text: 'end', relMs: 9000 },
	];
	lengthOf(pure.selectEvents(events, { fromRel: 1000, toRel: 5000 }), 3, 'selectEvents 按区间');
	lengthOf(pure.selectEvents(events, { fromRel: 0, toRel: 9000, onlyProblems: true }), 3, 'selectEvents 只看问题（含打点）');
	lengthOf(pure.selectEvents(events, { fromRel: 0, toRel: 9000, query: 'boom' }), 1, 'selectEvents 关键词');
	lengthOf(pure.selectEvents([], {}), 0, 'selectEvents 空输入');

	// --- sampleEventsForPrompt ---
	const many = [];
	for (let index = 0; index < 200; index += 1) {
		many.push({ seq: index, src: 'a', level: index % 50 === 7 ? 'error' : 'info', text: `line ${index}`, relMs: index * 10 });
	}
	const sampled = pure.sampleEventsForPrompt(many, 20);
	ok(sampled.length <= 20, 'sampleEventsForPrompt 不超过上限');
	ok(sampled.some((event) => event.level === 'error'), 'sampleEventsForPrompt 保留错误行');
	ok(sampled[0].seq === 0, 'sampleEventsForPrompt 保留首个事件');
	ok(sampled[sampled.length - 1].seq === 199, 'sampleEventsForPrompt 保留末尾事件');
	lengthOf(pure.sampleEventsForPrompt(many.slice(0, 5), 20), 5, 'sampleEventsForPrompt 少于上限时全保留');

	// --- 标注几何 ---
	const rect = pure.normalizeDrag({ x0: 0.6, y0: 0.5, x1: 0.2, y1: 0.1 });
	equal(rect.x.toFixed(2), '0.20', 'normalizeDrag x 取小值');
	equal(rect.w.toFixed(2), '0.40', 'normalizeDrag 宽度取绝对值');
	const annotations = [
		{ id: 'a', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
		{ id: 'b', rect: { x: 0.5, y: 0.5, w: 0.3, h: 0.3 } },
	];
	equal(pure.findAnnotationAt(annotations, 0.55, 0.55)?.id, 'b', 'findAnnotationAt 命中');
	equal(pure.findAnnotationAt(annotations, 0.9, 0.05), undefined, 'findAnnotationAt 未命中');

	// --- base64ToBytes ---
	const bytes = pure.base64ToBytes('aGVsbG8=');
	equal(bytes.length, 5, 'base64ToBytes 长度');
	equal(String.fromCharCode(...bytes), 'hello', 'base64ToBytes 内容');

	// --- buildDeliveryText ---
	const delivery = pure.buildDeliveryText({
		title: '捡箱子后悬空',
		description: '在 raiders 房间捡箱子后角色浮空',
		bundlePath: 'D:\\work\\.dsh-incidents\\x\\bundle.md',
		dir: 'D:\\work\\.dsh-incidents\\x',
		fromRel: 12340,
		toRel: 16780,
		frameCount: 26,
		events,
		annotations: [{ id: 'a1', rect: { x: 0.4, y: 0.3, w: 0.1, h: 0.1 }, note: '角色悬空', atRel: 14000 }],
		artifacts: [
			{ kind: 'image', name: 'frames.png', path: 'D:\\work\\.dsh-incidents\\x\\frames.png', label: '关键帧条带' },
		],
		lineLimit: 40,
	});
	contains(delivery, '捡箱子后悬空', '交付正文带标题');
	contains(delivery, '在 raiders 房间捡箱子后角色浮空', '交付正文带现象描述');
	contains(delivery, '00:12.340', '交付正文带区间起点');
	contains(delivery, 'bundle.md', '交付正文指向完整纪要');
	contains(delivery, '关键帧条带', '交付正文列出图像证据');
	contains(delivery, '角色悬空', '交付正文带标注说明');
	contains(delivery, '```log', '交付正文带日志切片围栏');
	contains(delivery, 'ReferenceError: boom', '交付正文带日志内容');
	contains(delivery, '⚑ 问题点', '打点行用 ⚑ 标签表示');
	notContains(delivery, '[打点:问题点] 【打点】问题点', '打点行不重复写标签');
	notContains(delivery, 'undefined', '交付正文没有 undefined 漏出');

	// 空描述时给出可读的占位，而不是崩掉
	const sparse = pure.buildDeliveryText({ title: '', description: '', events: [] });
	contains(sparse, '未命名', '空标题回落为未命名');
	contains(sparse, '未填写', '空描述回落为提示');

	return exported;
}
