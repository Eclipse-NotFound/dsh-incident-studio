// dsh-incident-studio — host half（现场取证台：主机端）
//
// 把「屏幕录像」和「日志/事件流」放在同一条毫秒时间轴上：
//   · 面板按下录制时，主机记录 t0，并开始跟随用户配置的日志源（可多个）；
//   · 每个日志源是一个 FileTail：先抓一段 pre-roll（录制前的尾部内容，relMs<0），
//     之后持续跟随新写入的行，每行带 relMs = 墙钟时间 − t0；
//   · 屏幕画面走「帧序列」而不是视频容器：桌面端由主进程的 desktopCapturer
//     定时截图（JPEG），浏览器端由面板自己录 webm 再抽帧，两条路的产物都是
//     带墙钟时间戳的帧，天然和日志同一条时钟；
//   · 任何本机进程也可以 POST /ingest 直接推事件（自带 token）；
//   · 录制结束后，客户端把区间内的事件 + 关键帧条带/动图上传回来，主机把
//     bundle.md / bundle.json 落到会话工作区的 .dsh-incidents/<id>/ 下。
//
// 这里只做「采集 + 落盘」，不做渲染：动图与条带在浏览器端编码。

import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { open as openFile } from 'node:fs/promises';
import { watchFile, unwatchFile, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

const ROUTE_PREFIX = '/dsh-incident-studio/api';
const ROUTES = {
	state: `${ROUTE_PREFIX}/state`,
	profiles: `${ROUTE_PREFIX}/profiles`,
	probe: `${ROUTE_PREFIX}/probe`,
	start: `${ROUTE_PREFIX}/start`,
	stop: `${ROUTE_PREFIX}/stop`,
	events: `${ROUTE_PREFIX}/events`,
	input: `${ROUTE_PREFIX}/input`,
	marker: `${ROUTE_PREFIX}/marker`,
	ingest: `${ROUTE_PREFIX}/ingest`,
	artifact: `${ROUTE_PREFIX}/artifact`,
	bundle: `${ROUTE_PREFIX}/bundle`,
	incidents: `${ROUTE_PREFIX}/incidents`,
	open: `${ROUTE_PREFIX}/open`,
	clientBoot: `${ROUTE_PREFIX}/client-boot`,
	sources: `${ROUTE_PREFIX}/capture/sources`,
	captureStart: `${ROUTE_PREFIX}/capture/start`,
	captureFrames: `${ROUTE_PREFIX}/capture/frames`,
	captureStop: `${ROUTE_PREFIX}/capture/stop`,
};

/** 单次请求体上限：图片/动图是 base64 上传，给到 64MB。 */
const MAX_BODY_BYTES = 64 * 1024 * 1024;
/** 单次从文件读入的字节上限，避免日志暴涨时一次性吃满内存。 */
const MAX_READ_BYTES = 4 * 1024 * 1024;
/** 每个录制会话保留的事件上限（超出丢最早的，并记 dropped）。 */
const MAX_EVENTS = 40000;
/** pre-roll：录制开始时回看的历史尾部。 */
const PRE_ROLL_BYTES = 96 * 1024;
const PRE_ROLL_MAX_LINES = 800;
/** 单个日志源单轮最多处理的完整行数。 */
const MAX_LINES_PER_PASS = 4000;
/** 跟随间隔（ms）：Windows 下 watchFile 走 stat 轮询，比 fs.watch 稳。 */
const TAIL_INTERVAL_MS = 120;
/** 日志源文件还没出现时的重试间隔。 */
const MISSING_RETRY_MS = 1000;
/** 帧缓冲：最多保留多少帧、多少字节、多少秒。 */
const FRAME_MAX_COUNT = 900;
const FRAME_MAX_BYTES = 96 * 1024 * 1024;
const FRAME_MAX_AGE_MS = 5 * 60 * 1000;
/** 输入事件上限：一次录制里保留多少条键/鼠标事件（超出丢最早的）。 */
const MAX_INPUT_EVENTS = 20000;
/** 输入采样间隔（ms）：20ms ≈ 30Hz，够看清人手按键，又不吵。 */
const INPUT_DEFAULT_POLL_MS = 20;
/** 输入助手硬上限（秒）：忘了停也不会一直跑。 */
const INPUT_MAX_SECONDS = 1800;
/** 输入记录文件上限：超过就停止收（正常半小时也到不了）。 */
const INPUT_MAX_BYTES = 24 * 1024 * 1024;
/** 输入文件轮询间隔（ms）。 */
const INPUT_PUMP_MS = 200;
/** 打点锚点：找标记前多久以内的最后一条输入。 */
const INPUT_ANCHOR_WINDOW_MS = 2000;

const SOURCE_KINDS = new Set(['file', 'ingest', 'marker']);

/* ------------------------------------------------------------------ */
/* 通用小工具                                                          */
/* ------------------------------------------------------------------ */

function nowMs() {
	return Date.now();
}

/** 把毫秒偏移格式化成 00:12.345（负值带前导 -，用于 pre-roll）。 */
export function formatRelMs(ms) {
	const value = Number.isFinite(ms) ? ms : 0;
	const sign = value < 0 ? '-' : '';
	const abs = Math.abs(Math.round(value));
	const m = Math.floor(abs / 60000);
	const s = Math.floor((abs % 60000) / 1000);
	const milli = abs % 1000;
	return `${sign}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

/** 文件名 slug：中文保留，其它不安全字符换 -。 */
export function safeSlug(input, fallback = 'incident') {
	const text = String(input ?? '').trim();
	if (text === '') return fallback;
	const cleaned = text
		.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
		.replace(/\s+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^[-.]+|[-.]+$/g, '');
	return cleaned === '' ? fallback : cleaned.slice(0, 60);
}

/** 判断 child 是否落在 parent 之内（都用绝对路径比较）。 */
export function isInsidePath(parent, child) {
	const rel = path.relative(path.resolve(parent), path.resolve(child));
	return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** 日志行的级别分类：错误 / 警告 / 普通。 */
export function classifyLevel(text) {
	const line = String(text ?? '');
	// AS3/JS 的运行时错误号（#1006 #1069 #2025 …）几乎总是真错误。
	if (/#(?:1[0-9]{3}|2[0-9]{3})\b/.test(line)) return 'error';
	// 词边界匹配普通 error，同时兼容 ReferenceError / TypeError / NullPointerException 这类驼峰后缀。
	if (/\b(?:error|exception|fatal|failed|failure|traceback)\b/i.test(line)) return 'error';
	if (/\b[A-Za-z]+(?:Error|Exception)\b/.test(line)) return 'error';
	if (/\b(?:warn|warning|deprecated|retry|timed out)\b/i.test(line)) return 'warn';
	return 'info';
}

/**
 * 判断一行是不是「二进制噪音」。AS3 FileStream 追加写的日志里偶尔混入
 * 不可打印字节，直接塞给 UI 与模型都是负担，默认丢弃并计数。
 */
export function looksBinary(text) {
	const line = String(text ?? '');
	if (line.includes('\u0000')) return true;
	let unprintable = 0;
	for (let index = 0; index < line.length; index += 1) {
		const code = line.charCodeAt(index);
		if (code === 9 || code === 13) continue;
		if (code < 32 || (code >= 0x7f && code < 0xa0) || code === 0xfffd) unprintable += 1;
	}
	return line.length > 0 && unprintable / line.length > 0.3;
}

/** 把一段字节按 UTF-8 解码并切行；返回完整行与残留的不完整尾巴。 */
export function splitBufferLines(buffer, carry) {
	const text = (carry ?? '') + buffer.toString('utf8');
	const parts = text.split(/\r?\n/);
	const rest = parts.pop() ?? '';
	return { lines: parts, carry: rest };
}

/** 规整一份日志源配置。 */
export function normalizeSource(raw, index = 0) {
	const value = raw !== null && typeof raw === 'object' ? raw : {};
	const filePath = typeof value.path === 'string' ? value.path.trim() : '';
	const kind = SOURCE_KINDS.has(value.kind) ? value.kind : 'file';
	const id = typeof value.id === 'string' && value.id !== '' ? value.id : `source-${index + 1}`;
	return {
		id,
		kind,
		label: typeof value.label === 'string' && value.label !== '' ? value.label : id,
		color: typeof value.color === 'string' && value.color !== '' ? value.color : '#6aa9ff',
		path: filePath,
		enabled: value.enabled !== false,
		timeRegex: typeof value.timeRegex === 'string' ? value.timeRegex : '',
		preRoll: value.preRoll !== false,
	};
}

/** 规整一份 profile（一组日志源 + 说明）。 */
export function normalizeProfile(raw, index = 0) {
	const value = raw !== null && typeof raw === 'object' ? raw : {};
	const id = typeof value.id === 'string' && value.id !== '' ? value.id : `profile-${index + 1}`;
	const rawSources = Array.isArray(value.sources) ? value.sources : [];
	return {
		id,
		name: typeof value.name === 'string' && value.name !== '' ? value.name : id,
		note: typeof value.note === 'string' ? value.note : '',
		sources: rawSources.map((source, sourceIndex) => normalizeSource(source, sourceIndex)),
		// 每个配置带一份输入记录设置：目标进程通常是这个游戏自己。
		input: normalizeInputConfig(value.input),
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
	};
}

/** 规整整个 profiles 文档，坏数据一律降级为默认值，绝不抛错。 */
export function normalizeProfilesDocument(raw) {
	const value = raw !== null && typeof raw === 'object' ? raw : {};
	const profiles = Array.isArray(value.profiles) ? value.profiles.map(normalizeProfile) : [];
	return {
		version: 1,
		activeId: typeof value.activeId === 'string' ? value.activeId : (profiles[0]?.id ?? ''),
		profiles,
	};
}

/** 默认 profile：给还没配置过的人一个空槽位。 */
export function defaultProfiles() {
	return {
		version: 1,
		activeId: 'default',
		profiles: [
			{
				id: 'default',
				name: '默认',
				note: '在右侧填入日志文件路径，例如游戏或模组的运行日志。',
				sources: [
					{ id: 'log-a', kind: 'file', label: '日志 A', color: '#6aa9ff', path: '', enabled: true, timeRegex: '', preRoll: true },
				],
				input: normalizeInputConfig({}),
				updatedAt: '',
			},
		],
	};
}

/** 采样：从 n 个里等距取 count 个下标（含首尾）。 */
export function pickEvenIndices(total, count) {
	const n = Math.max(0, Math.floor(total));
	const c = Math.max(1, Math.floor(count));
	if (n <= 0) return [];
	if (n <= c) return Array.from({ length: n }, (_, index) => index);
	if (c === 1) return [0];
	const result = [];
	for (let index = 0; index < c; index += 1) {
		result.push(Math.round((index * (n - 1)) / (c - 1)));
	}
	return Array.from(new Set(result));
}

/* ------------------------------------------------------------------ */
/* 输入记录（键鼠状态）                                                */
/* ------------------------------------------------------------------ */

/** 时长格式化：0.14s / 1.20s。 */
export function formatInputDuration(ms) {
	const value = Number.isFinite(ms) ? Math.max(0, ms) : 0;
	return `${(value / 1000).toFixed(2)}s`;
}

/**
 * 目标进程名规整：逗号/分号分隔，去掉 .exe，转小写，去重。
 * @param raw 字符串或字符串数组。
 * @returns 规范化后的逗号分隔字符串（存配置用）。
 */
export function normalizeInputTargets(raw) {
	const pieces = Array.isArray(raw) ? raw : String(raw ?? '').split(/[,;\s]+/u);
	const seen = new Set();
	const result = [];
	for (const piece of pieces) {
		if (typeof piece !== 'string') continue;
		let value = piece.trim().toLowerCase();
		if (value.endsWith('.exe')) value = value.slice(0, -4);
		value = value.replace(/[^a-z0-9._-]+/gu, '');
		if (value === '' || seen.has(value)) continue;
		seen.add(value);
		result.push(value);
		if (result.length >= 8) break;
	}
	return result.join(',');
}

/** 目标进程字符串 → 数组。 */
export function inputTargetsList(targets) {
	const text = typeof targets === 'string' ? targets : normalizeInputTargets(targets);
	return text === '' ? [] : text.split(',').map((item) => item.trim()).filter((item) => item !== '');
}

/**
 * 规整输入记录配置。目标进程为空且范围是 target 时，真的没什么可记的，
 * 上层据此跳过启动助手。
 * @param raw 原始配置（可能来自 profiles.json 或 /start 请求体）。
 * @returns {object} 归一化配置。
 */
export function normalizeInputConfig(raw) {
	const value = raw !== null && typeof raw === 'object' ? raw : {};
	const scope = value.scope === 'all' ? 'all' : 'target';
	const pollMs = Number.isFinite(value.pollMs)
		? Math.max(10, Math.min(200, Math.round(value.pollMs)))
		: INPUT_DEFAULT_POLL_MS;
	const trailHz = Number.isFinite(value.trailHz) ? Math.max(0, Math.min(15, Math.round(value.trailHz))) : 0;
	return {
		enabled: value.enabled !== false,
		scope,
		targets: normalizeInputTargets(value.targets),
		pollMs,
		trailHz,
	};
}

/** 这台宿主能不能记输入：目前只有 Windows 上有轮询助手。 */
export function chooseInputMode(platform) {
	return platform === 'win32' ? 'powershell' : 'none';
}

/**
 * 解析输入助手写的一行 JSON。
 *
 * 助手只写「变化」，这里把每条转成与日志事件同一套时间字段；坏行返回 null，
 * 不抛错（半行、乱码、助手正在写的行都可能出现）。
 * @param rawLine 一行文本。
 * @returns {object|null} {kind, wall, ...} 或 null。
 */
export function parseInputRecord(rawLine) {
	if (typeof rawLine !== 'string' || rawLine.trim() === '') return null;
	let value;
	try {
		value = JSON.parse(rawLine);
	} catch {
		return null;
	}
	if (value === null || typeof value !== 'object') return null;
	const wall = Number(value.t);
	if (!Number.isFinite(wall) || wall <= 0) return null;
	const kind = typeof value.k === 'string' ? value.k : '';
	if (kind === 'ready') {
		return {
			kind: 'ready',
			wall,
			mode: typeof value.mode === 'string' ? value.mode : '',
			pollMs: Number.isFinite(value.pollMs) ? value.pollMs : INPUT_DEFAULT_POLL_MS,
			keys: Number.isFinite(value.keys) ? value.keys : 0,
			scope: value.scope === 'all' ? 'all' : 'target',
			targets: Array.isArray(value.targets) ? value.targets.filter((item) => typeof item === 'string') : [],
			excludePid: Number.isFinite(value.exclude) ? value.exclude : 0,
			trailHz: Number.isFinite(value.trailHz) ? value.trailHz : 0,
			compileMs: Number.isFinite(value.compileMs) ? value.compileMs : -1,
			cached: value.cached === 1 || value.cached === true,
			ps: typeof value.ps === 'string' ? value.ps : '',
		};
	}
	if (kind === 'stop') {
		return {
			kind: 'stop',
			wall,
			why: typeof value.why === 'string' ? value.why : '',
			mergedMs: Number.isFinite(value.mergedMs) ? value.mergedMs : 0,
			ticks: Number.isFinite(value.ticks) ? value.ticks : 0,
			summary: {
				keys: Number.isFinite(value.keys) ? value.keys : 0,
				clicks: Number.isFinite(value.clicks) ? value.clicks : 0,
				moves: Number.isFinite(value.moves) ? value.moves : 0,
				resets: Number.isFinite(value.resets) ? value.resets : 0,
				focus: Number.isFinite(value.focus) ? value.focus : 0,
			},
		};
	}
	if (kind === 'error') {
		return { kind: 'error', wall, message: typeof value.msg === 'string' ? value.msg : '输入助手出错' };
	}
	if (kind === 'key' || kind === 'btn') {
		const name = typeof value.name === 'string' && value.name !== '' ? value.name : '';
		if (name === '') return null;
		const event = {
			kind: kind === 'key' ? 'key' : 'button',
			wall,
			name,
			vk: Number.isFinite(value.vk) ? value.vk : 0,
			down: value.d === 1 || value.d === true,
		};
		if (event.kind === 'button') {
			event.x = Number.isFinite(value.x) ? value.x : 0;
			event.y = Number.isFinite(value.y) ? value.y : 0;
		}
		return event;
	}
	if (kind === 'focus') {
		const proc = typeof value.proc === 'string' ? value.proc : '';
		return {
			kind: 'focus',
			wall,
			inScope: value.in === 1 || value.in === true,
			pid: Number.isFinite(value.pid) ? value.pid : 0,
			proc: proc === '' ? 'other' : proc,
		};
	}
	if (kind === 'move') {
		return {
			kind: 'move',
			wall,
			x: Number.isFinite(value.x) ? value.x : 0,
			y: Number.isFinite(value.y) ? value.y : 0,
		};
	}
	if (kind === 'reset') {
		return {
			kind: 'reset',
			wall,
			keys: Array.isArray(value.keys) ? value.keys.filter((item) => typeof item === 'string') : [],
		};
	}
	return null;
}

/**
 * 输入事件的显示文本（给 UI 与 bundle 共用）。
 *
 * 键名与文本保持英文/符号：这是给模型读的，而且键位名跨语言通用；
 * 「按下/抬起」用箭头，「失焦释放」用固定英文前缀。
 * @param event 已归一化的输入事件（含可选 ms）。
 * @returns {string} 一行文本。
 */
export function inputEventText(event) {
	if (event === null || typeof event !== 'object') return '';
	const held = Number.isFinite(event.ms) && event.ms >= 0 ? ` (${formatInputDuration(event.ms)})` : '';
	switch (event.kind) {
		case 'key':
			return `${event.name} ${event.down === true ? '↓' : '↑'}${event.down === true ? '' : held}`;
		case 'button':
			if (event.down === true) return `${event.name} ↓ @${event.x},${event.y}`;
			return `${event.name} ↑${held}`;
		case 'focus':
			return event.inScope === true
				? `focus: ${event.proc}`
				: `blur: ${event.proc}`;
		case 'move':
			return `${event.x},${event.y}`;
		case 'reset':
			return `blur-release: ${(event.keys ?? []).join(', ')}`;
		default:
			return '';
	}
}

/**
 * 打点锚点：给「就在刚才」的标记找到前一条输入，回答「问题出现前我按了什么」。
 * @param inputs 已按时间排序的输入事件。
 * @param atRel 打点时刻（相对 ms）。
 * @param windowMs 最多回看多久。
 * @returns {object|null} {kind, name, relMs, deltaMs, x?, y?}。
 */
export function findInputAnchor(inputs, atRel, windowMs = INPUT_ANCHOR_WINDOW_MS) {
	const list = Array.isArray(inputs) ? inputs : [];
	const limit = Number.isFinite(windowMs) ? windowMs : INPUT_ANCHOR_WINDOW_MS;
	for (let index = list.length - 1; index >= 0; index -= 1) {
		const event = list[index];
		if (event === null || typeof event !== 'object') continue;
		if (event.kind !== 'key' && event.kind !== 'button') continue;
		if (event.down !== true) continue;
		const delta = atRel - (Number.isFinite(event.relMs) ? event.relMs : 0);
		if (delta < 0 || delta > limit) continue;
		const anchor = {
			kind: event.kind,
			name: event.name,
			relMs: event.relMs,
			deltaMs: delta,
		};
		if (event.kind === 'button') {
			anchor.x = event.x;
			anchor.y = event.y;
		}
		return anchor;
	}
	return null;
}

/** 锚点的一句话描述：`Space ↓ 0.12s 前`。 */
export function formatInputAnchor(anchor) {
	if (anchor === null || typeof anchor !== 'object' || typeof anchor.name !== 'string') return '';
	const delta = Number.isFinite(anchor.deltaMs) ? formatInputDuration(anchor.deltaMs) : '';
	const where = anchor.kind === 'button' && Number.isFinite(anchor.x) ? ` @${anchor.x},${anchor.y}` : '';
	return `${anchor.name} ↓${where}${delta === '' ? '' : ` ${delta} 前`}`;
}

/**
 * 输入统计：次数、按住的时长、最长的几次按住。
 * @param inputs 输入事件列表（区间内）。
 * @returns {object} 统计结果。
 */
export function summarizeInputs(inputs) {
	const list = Array.isArray(inputs) ? inputs : [];
	const summary = {
		total: list.length,
		keyDowns: 0,
		keyUps: 0,
		buttonDowns: 0,
		buttonUps: 0,
		clicks: 0,
		moves: 0,
		focus: 0,
		resets: 0,
		perKey: [],
		holds: [],
		firstRel: 0,
		lastRel: 0,
	};
	const perKey = new Map();
	const open = new Map();
	const holds = [];
	let counted = 0;
	for (const event of list) {
		if (event === null || typeof event !== 'object') continue;
		const rel = Number.isFinite(event.relMs) ? event.relMs : 0;
		if (counted === 0) summary.firstRel = rel;
		counted += 1;
		summary.lastRel = rel;
		if (event.kind === 'key') {
			if (event.down === true) {
				summary.keyDowns += 1;
				const bucket = perKey.get(event.name) ?? { name: event.name, downs: 0, ms: 0 };
				bucket.downs += 1;
				perKey.set(event.name, bucket);
				open.set(event.name, { relMs: rel, bucket });
			} else {
				summary.keyUps += 1;
				const started = open.get(event.name);
				if (started !== undefined) {
					const ms = Math.max(0, rel - started.relMs);
					started.bucket.ms += ms;
					open.delete(event.name);
					holds.push({ name: event.name, kind: 'key', ms, fromRel: started.relMs, toRel: rel });
				}
			}
		} else if (event.kind === 'button') {
			if (event.down === true) {
				summary.buttonDowns += 1;
				summary.clicks += 1;
				open.set(event.name, { relMs: rel, bucket: null });
			} else {
				summary.buttonUps += 1;
				const started = open.get(event.name);
				if (started !== undefined) {
					open.delete(event.name);
					const ms = Math.max(0, rel - started.relMs);
					if (ms >= 40) holds.push({ name: event.name, kind: 'button', ms, fromRel: started.relMs, toRel: rel });
				}
			}
		} else if (event.kind === 'move') {
			summary.moves += 1;
		} else if (event.kind === 'focus') {
			summary.focus += 1;
		} else if (event.kind === 'reset') {
			summary.resets += 1;
			open.clear();
		}
	}
	summary.perKey = Array.from(perKey.values()).sort((left, right) => right.downs - left.downs);
	summary.holds = holds.sort((left, right) => right.ms - left.ms).slice(0, 5);
	return summary;
}

/** 时间范围筛选（闭区间）。 */
export function sliceInputs(inputs, fromRel, toRel) {
	const list = Array.isArray(inputs) ? inputs : [];
	const from = Number.isFinite(fromRel) ? fromRel : -Infinity;
	const to = Number.isFinite(toRel) ? toRel : Infinity;
	return list.filter((event) => {
		const rel = Number.isFinite(event?.relMs) ? event.relMs : 0;
		return rel >= from && rel <= to;
	});
}

/**
 * 渲染 bundle.md 里的「输入记录」段。
 *
 * 结构：采样说明 → 统计 → 每个打点前后的小窗口 → 完整输入流（有上限）。
 * 纯函数，便于单测。
 * @param input 汇总输入。
 * @returns {string[]} Markdown 行（空数组表示没有输入可写）。
 */
export function renderInputMarkdown(input) {
	const {
		inputs = [],
		total = inputs.length,
		config = null,
		measuredHz = 0,
		markers = [],
		windowBefore = 1500,
		windowAfter = 800,
		fullLimit = 1500,
		windowLimit = 40,
	} = input ?? {};
	const lines = [];
	const summary = summarizeInputs(inputs);
	const targetList = inputTargetsList(config?.targets);
	const targetText = targetList.length > 0 ? targetList.join(', ') : '';
	const scopeText = config?.scope === 'all'
		? '所有前台窗口（本插件自身除外）'
		: (targetText === '' ? '未指定目标进程' : `前台为 ${targetText} 时`);
	// 标称间隔 + 助手实测的 tick 率（`Start-Sleep` 有 15.6ms 粒度，实测才是真的）
	const pollText = Number.isFinite(config?.pollMs)
		? `间隔 ${config.pollMs}ms${Number.isFinite(measuredHz) && measuredHz > 0 ? `，实测约 ${Math.round(measuredHz)} Hz` : ''}`
		: '间隔未知';
	if (total <= 0) {
		lines.push('## 输入记录', '');
		lines.push(`- 这段时间没有记录到键鼠事件（采样 ${pollText}，记录范围：${scopeText}）。`);
		lines.push('');
		return lines;
	}
	lines.push('## 输入记录', '');
	lines.push(`- 采样：${pollText}，只记键鼠的「变化」，不记录任何文字内容`);
	lines.push(`- 记录范围：${scopeText}${config?.trailHz > 0 ? '，含指针轨迹' : '，指针只记点击位置'}`);
	lines.push(`- 区间内 ${summary.total} 条：按键 ${summary.keyDowns} 次按下 / ${summary.keyUps} 次抬起，鼠标 ${summary.clicks} 次点击，前台切换 ${summary.focus} 次`);
	if (summary.perKey.length > 0) {
		const top = summary.perKey.slice(0, 6).map((item) => `${item.name}×${item.downs}${item.ms > 0 ? `（共 ${formatInputDuration(item.ms)}）` : ''}`);
		lines.push(`- 按得最多：${top.join('、')}`);
	}
	if (summary.holds.length > 0) {
		const longest = summary.holds.slice(0, 3).map((hold) =>
			`${hold.name} ${formatInputDuration(hold.ms)}（${formatRelMs(hold.fromRel)}→${formatRelMs(hold.toRel)}）`);
		lines.push(`- 按住最久：${longest.join('、')}`);
	}
	lines.push('');

	const realMarkers = (Array.isArray(markers) ? markers : []).filter((marker) => Number.isFinite(marker?.relMs));
	if (realMarkers.length > 0) {
		lines.push('### 打点前后的输入', '');
		for (const marker of realMarkers) {
			const from = marker.relMs - windowBefore;
			const to = marker.relMs + windowAfter;
			const slice = sliceInputs(inputs, from, to).slice(0, windowLimit);
			const anchorText = typeof marker.anchor === 'object' && marker.anchor !== null
				? formatInputAnchor(marker.anchor)
				: '';
			const head = `**\`${formatRelMs(marker.relMs)}\` ${marker.label ?? '打点'}**`;
			lines.push(anchorText === '' ? head : `${head}（前一条输入：${anchorText}）`);
			if (slice.length === 0) {
				lines.push('', '(这个窗口内没有输入事件)', '');
				continue;
			}
			lines.push('', '```input');
			for (const event of slice) {
				lines.push(`[${formatRelMs(event.relMs)}] ${inputEventText(event)}`);
			}
			lines.push('```', '');
		}
	}

	const shown = inputs.slice(0, fullLimit);
	lines.push(`### 完整输入流（区间内 ${summary.total} 条${summary.total > shown.length ? `，这里只列前 ${shown.length} 条` : ''}）`, '');
	lines.push('```input');
	for (const event of shown) lines.push(`[${formatRelMs(event.relMs)}] ${inputEventText(event)}`);
	lines.push('```', '');
	if (summary.total > shown.length) {
		lines.push(`> 其余 ${summary.total - shown.length} 条见同目录的 \`input.jsonl\`（原始行，字段与本文档一致）。`, '');
	}
	return lines;
}

/* ------------------------------------------------------------------ */
/* 日志跟随                                                            */
/* ------------------------------------------------------------------ */

/**
 * 一个文件日志源的跟随器。
 *
 * 生命周期：start() 打开文件（不存在则等待出现），先抓 pre-roll，再按
 * TAIL_INTERVAL_MS 轮询增量；每次都只读「上次 offset → 当前 size」的新字节。
 * size < offset 视为日志被清空/轮转，从 0 重新读。
 */
class FileTail {
	constructor(options) {
		this.id = options.id;
		this.filePath = options.path;
		this.t0 = options.t0;
		this.emit = options.emit;
		this.onStatus = options.onStatus;
		this.offset = 0;
		this.carry = '';
		this.size = 0;
		this.started = false;
		this.watching = false;
		this.binaryDropped = 0;
		this.lineCount = 0;
		this.error = '';
		this.preRolled = false;
		this.retryTimer = null;
	}

	status() {
		return {
			ok: this.error === '',
			started: this.started,
			size: this.size,
			offset: this.offset,
			lines: this.lineCount,
			binaryDropped: this.binaryDropped,
			error: this.error,
			preRolled: this.preRolled,
		};
	}

	async start() {
		try {
			const info = await stat(this.filePath);
			if (!info.isFile()) throw new Error('不是一个文件');
			this.size = info.size;
			this.offset = info.size;
			this.started = true;
			this.error = '';
			this.onStatus(this.status());
			await this.readPreRoll();
			this.attach();
		} catch (error) {
			this.started = false;
			this.error = `等待日志文件：${describeError(error)}`;
			this.onStatus(this.status());
			this.retryTimer = setTimeout(() => {
				this.retryTimer = null;
				void this.start();
			}, MISSING_RETRY_MS);
			if (typeof this.retryTimer.unref === 'function') this.retryTimer.unref();
		}
	}

	async readPreRoll() {
		if (this.preRolled) return;
		this.preRolled = true;
		const from = Math.max(0, this.size - PRE_ROLL_BYTES);
		if (from >= this.size) return;
		let buffer;
		try {
			const handle = await openFile(this.filePath, 'r');
			try {
				const length = this.size - from;
				buffer = Buffer.alloc(length);
				await handle.read(buffer, 0, length, from);
			} finally {
				await handle.close();
			}
		} catch {
			return;
		}
		const { lines } = splitBufferLines(buffer, '');
		const tail = lines.slice(-PRE_ROLL_MAX_LINES);
		// 历史行没有逐行时间戳，用「距离录制起点的序号」当占位偏移：
		// 越靠后越接近 0，全部 ≤ 0，UI 上标成「录制前」。
		const total = tail.length;
		tail.forEach((line, index) => {
			this.pushLine(line, { pre: true, wall: this.t0 - (total - index) });
		});
	}

	attach() {
		if (this.watching) return;
		this.watching = true;
		watchFile(this.filePath, { interval: TAIL_INTERVAL_MS, persistent: false }, () => {
			void this.pass();
		});
	}

	stop() {
		if (this.watching) {
			unwatchFile(this.filePath);
			this.watching = false;
		}
		if (this.retryTimer !== null) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
	}

	async pass() {
		let info;
		try {
			info = await stat(this.filePath);
		} catch {
			return;
		}
		if (!info.isFile()) return;
		this.size = info.size;
		if (info.size < this.offset) {
			this.offset = 0;
			this.carry = '';
		}
		if (info.size === this.offset) return;
		const to = info.size;
		let truncated = false;
		if (to - this.offset > MAX_READ_BYTES) {
			this.offset = to - MAX_READ_BYTES;
			this.carry = '';
			truncated = true;
		}
		let buffer;
		try {
			const handle = await openFile(this.filePath, 'r');
			try {
				const length = to - this.offset;
				buffer = Buffer.alloc(length);
				await handle.read(buffer, 0, length, this.offset);
			} finally {
				await handle.close();
			}
		} catch (error) {
			this.error = describeError(error);
			this.onStatus(this.status());
			return;
		}
		this.offset = to;
		this.error = '';
		if (truncated) {
			this.emit({
				src: this.id,
				level: 'warn',
				text: `[取证台] 日志一次增长超过 ${Math.round(MAX_READ_BYTES / 1024 / 1024)}MB，已跳过更早的内容`,
				wall: nowMs(),
			});
		}
		const { lines, carry } = splitBufferLines(buffer, this.carry);
		this.carry = carry;
		for (const line of lines.slice(0, MAX_LINES_PER_PASS)) this.pushLine(line, { pre: false });
		this.onStatus(this.status());
	}

	pushLine(rawLine, meta) {
		const line = rawLine.replace(/\r$/, '');
		if (line.trim() === '') return;
		if (looksBinary(line)) {
			this.binaryDropped += 1;
			return;
		}
		this.lineCount += 1;
		this.emit({
			src: this.id,
			level: classifyLevel(line),
			text: line.length > 4000 ? `${line.slice(0, 4000)}…` : line,
			wall: Number.isFinite(meta.wall) ? meta.wall : nowMs(),
			pre: meta.pre === true,
		});
	}
}

function describeError(error) {
	if (error === null || error === undefined) return '未知错误';
	if (typeof error === 'string') return error;
	if (typeof error.message === 'string' && error.message !== '') return error.message;
	return String(error);
}

/**
 * 删目录，失败重试几次。
 *
 * Windows 上刚被其他进程读过的目录会短暂锁住（EPERM/EBUSY），一次删不掉很正常；
 * 这里退让 200ms 重试，最多 6 次，仍失败就放弃——临时目录不该让停止流程卡住。
 * @param directory 绝对目录路径。
 * @returns {Promise<boolean>} 是否删掉。
 */
async function removeDirectoryWithRetry(directory) {
	for (let attempt = 0; attempt < 6; attempt += 1) {
		try {
			await rm(directory, { recursive: true, force: true });
			return true;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
	return false;
}

/* ------------------------------------------------------------------ */
/* 录屏：桌面端帧序列采集                                              */
/* ------------------------------------------------------------------ */

/**
 * 探测 Electron 能力。插件在 `dsh web`（纯 Node）里必须优雅地没有这个能力；
 * 在 Desktop 里，主进程能拿到 desktopCapturer，就能按固定帧率抓帧。
 */
async function detectElectron() {
	try {
		const require = createRequire(import.meta.url);
		let electron;
		try {
			electron = require('electron');
		} catch {
			electron = await import('electron').catch(() => undefined);
		}
		if (electron === undefined || electron === null) return { available: false, reason: '当前宿主不是 Electron' };
		const desktopCapturer = electron.desktopCapturer;
		if (desktopCapturer === undefined || typeof desktopCapturer.getSources !== 'function') {
			return { available: false, reason: 'desktopCapturer 不可用' };
		}
		return { available: true, desktopCapturer };
	} catch (error) {
		return { available: false, reason: describeError(error) };
	}
}

/**
 * 帧序列采集器：按 fps 调 desktopCapturer.getSources 取指定 source 的缩略图，
 * 编码成 JPEG 存进环形缓冲。产物是「带墙钟时间的帧」，与日志共用一条时钟。
 */
class FrameCapture {
	constructor(options) {
		this.capability = options.capability;
		this.sourceId = options.sourceId;
		this.fps = options.fps;
		this.thumbnailWidth = options.thumbnailWidth;
		this.quality = options.quality;
		this.t0 = options.t0;
		this.frames = [];
		this.seq = 0;
		this.bytes = 0;
		this.timer = null;
		this.running = false;
		this.error = '';
		this.busy = false;
		this.captured = 0;
		this.failed = 0;
	}

	get types() {
		return this.sourceId.startsWith('screen:') ? ['screen'] : ['window'];
	}

	start() {
		if (this.running) return;
		this.running = true;
		const interval = Math.max(60, Math.round(1000 / this.fps));
		this.timer = setInterval(() => {
			void this.captureOnce();
		}, interval);
		if (typeof this.timer.unref === 'function') this.timer.unref();
	}

	stop() {
		this.running = false;
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	async captureOnce() {
		// 抓帧比定时慢时跳过这一拍，避免任务堆叠。
		if (this.busy) return;
		this.busy = true;
		const wall = nowMs();
		try {
			const sources = await this.capability.desktopCapturer.getSources({
				types: this.types,
				thumbnailSize: { width: this.thumbnailWidth, height: Math.round(this.thumbnailWidth * 9 / 16) },
				fetchWindowIcons: false,
			});
			const source = sources.find((item) => String(item.id) === this.sourceId) ?? sources[0];
			if (source === undefined) throw new Error('找不到采集源（窗口可能已关闭）');
			const image = source.thumbnail;
			if (image === undefined || image.isEmpty()) throw new Error('缩略图为空');
			const jpeg = image.toJPEG(this.quality);
			if (jpeg.length === 0) throw new Error('JPEG 编码为空');
			this.push({ wall, jpeg });
			this.captured += 1;
			this.error = '';
		} catch (error) {
			this.failed += 1;
			this.error = describeError(error);
		} finally {
			this.busy = false;
		}
	}

	push(frame) {
		this.seq += 1;
		this.frames.push({ seq: this.seq, wall: frame.wall, jpeg: frame.jpeg });
		this.bytes += frame.jpeg.length;
		this.trim();
	}

	trim() {
		const oldest = nowMs() - FRAME_MAX_AGE_MS;
		while (this.frames.length > 0 && (this.frames.length > FRAME_MAX_COUNT || this.bytes > FRAME_MAX_BYTES || this.frames[0].wall < oldest)) {
			const removed = this.frames.shift();
			this.bytes -= removed.jpeg.length;
		}
	}

	status() {
		return {
			running: this.running,
			sourceId: this.sourceId,
			fps: this.fps,
			frames: this.frames.length,
			bytes: this.bytes,
			captured: this.captured,
			failed: this.failed,
			error: this.error,
			cursor: this.seq,
			firstWall: this.frames[0]?.wall ?? 0,
			lastWall: this.frames[this.frames.length - 1]?.wall ?? 0,
		};
	}

	/** 增量取帧（base64 JPEG）。 */
	framesSince(since) {
		const from = Number.isFinite(since) && since > 0 ? Math.floor(since) : 0;
		return this.frames
			.filter((frame) => frame.seq > from)
			.map((frame) => ({ seq: frame.seq, wall: frame.wall, jpeg: frame.jpeg.toString('base64') }));
	}
}

/**
 * 选抓帧模式。
 *
 * 宿主在 Electron 主进程里能拿到 `desktopCapturer`；若插件跑在 utility 进程
 * 或纯 Node 宿主里就拿不到，这时 Windows 上退回 GDI 抓屏（PowerShell 助手）。
 * @param capability detectElectron 的结果。
 * @param platform 目标平台（测试可注入）。
 * @returns 'native' | 'gdi' | 'none'
 */
export function chooseCaptureMode(capability, platform) {
	if (capability?.available === true) return 'native';
	if (platform === 'win32') return 'gdi';
	return 'none';
}

/**
 * GDI 抓帧：spawn 一个 PowerShell 助手写 JPEG，主机按目录增量收帧。
 *
 * 和 FrameCapture 暴露同一套接口（start/stop/status/framesSince），
 * 上层路由不需要知道当前用的是哪条路。
 */
class GdiFrameCapture {
	constructor(options) {
		this.id = options.id;
		this.fps = options.fps;
		this.width = options.width;
		this.quality = options.quality;
		this.t0 = options.t0;
		this.scriptPath = options.scriptPath;
		this.outDir = options.outDir;
		this.stopFile = options.stopFile;
		this.frames = [];
		this.seq = 0;
		this.bytes = 0;
		this.seen = new Set();
		this.timer = null;
		this.child = null;
		this.running = false;
		this.error = '';
		this.captured = 0;
		this.failed = 0;
		this.exited = false;
	}

	status() {
		return {
			mode: 'gdi',
			running: this.running,
			sourceId: 'gdi:virtual',
			fps: this.fps,
			frames: this.frames.length,
			bytes: this.bytes,
			captured: this.captured,
			failed: this.failed,
			error: this.error,
			cursor: this.seq,
			firstWall: this.frames[0]?.wall ?? 0,
			lastWall: this.frames[this.frames.length - 1]?.wall ?? 0,
		};
	}

	async start() {
		if (this.running) return;
		this.running = true;
		try {
			await mkdir(this.outDir, { recursive: true });
			await rm(this.stopFile, { force: true });
		} catch {
			/* 目录/停止文件清不掉时继续尝试 */
		}
		const args = [
			'-NoProfile',
			'-ExecutionPolicy', 'Bypass',
			'-File', this.scriptPath,
			'-Out', this.outDir,
			'-Fps', String(this.fps),
			'-Width', String(this.width),
			'-Quality', String(this.quality),
			'-StopFile', this.stopFile,
			'-MaxSeconds', '900',
		];
		try {
			this.child = spawn('powershell.exe', args, { windowsHide: true, stdio: 'ignore' });
			this.child.once('error', (error) => {
				this.error = describeError(error);
				this.failed += 1;
			});
			this.child.once('exit', () => {
				this.exited = true;
			});
			if (typeof this.child.unref === 'function') this.child.unref();
		} catch (error) {
			this.error = describeError(error);
			this.running = false;
			return;
		}
		this.timer = setInterval(() => {
			void this.pump();
		}, 120);
		if (typeof this.timer.unref === 'function') this.timer.unref();
		// 先等一拍，让第一帧有机会出现
		await new Promise((resolve) => setTimeout(resolve, 350));
		await this.pump();
	}

	/** 收一轮新落盘的帧：文件名就是抓帧时刻（epoch ms）。 */
	async pump() {
		let names;
		try {
			names = await readdir(this.outDir);
		} catch {
			return;
		}
		const fresh = names
			.filter((name) => name.endsWith('.jpg') && !this.seen.has(name))
			.sort();
		for (const name of fresh) {
			const absolute = path.join(this.outDir, name);
			let buffer;
			try {
				buffer = await readFile(absolute);
			} catch {
				continue;
			}
			// 只收「完整的 JPEG」：以 FFD8 开头、FFD9 结尾。助手可能正写到一半，
			// 半截帧既画不出来也会让编码后的动图花屏——留给下一拍再读。
			const complete = buffer.length >= 128 && buffer[0] === 0xff && buffer[1] === 0xd8
				&& buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
			if (!complete) continue;
			this.seen.add(name);
			// 读完就删：临时目录里不堆历史帧，磁盘占用只跟"还没被取走"的帧有关。
			void rm(absolute, { force: true }).catch(() => {});
			const wall = Number.parseInt(name.replace(/\.jpg$/u, ''), 10);
			this.seq += 1;
			this.frames.push({ seq: this.seq, wall: Number.isFinite(wall) ? wall : nowMs(), jpeg: buffer });
			this.bytes += buffer.length;
			this.captured += 1;
		}
		this.trim();
	}

	trim() {
		const countLimit = 900;
		const byteLimit = 96 * 1024 * 1024;
		while (this.frames.length > countLimit || this.bytes > byteLimit) {
			const removed = this.frames.shift();
			if (removed === undefined) break;
			this.bytes -= removed.jpeg.length;
		}
	}

	async stop() {
		this.running = false;
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
		// 再收一次，尽量不漏最后几帧
		await this.pump();
		try {
			await writeFile(this.stopFile, 'stop');
		} catch {
			/* 写不了停止文件就靠 kill */
		}
		// 给助手最多 1.2 秒优雅退出，再硬杀
		const child = this.child;
		if (child !== null && child.exitCode === null) {
			await new Promise((resolve) => {
				const timer = setTimeout(() => {
					try {
						child.kill();
					} catch {
						/* 已经退了 */
					}
					resolve();
				}, 1200);
				child.once('exit', () => {
					clearTimeout(timer);
					resolve();
				});
			});
		}
		await this.pump();
		// 连本次录制的临时目录一起删（outDir 是 <scratch>/frames，父目录只属于这次录制）。
		// Windows 上子进程刚退出时目录可能还被短暂占用，所以重试几次而不是一次失败就放弃。
		await removeDirectoryWithRetry(path.dirname(this.outDir));
	}

	framesSince(since) {
		const from = Number.isFinite(since) && since > 0 ? Math.floor(since) : 0;
		return this.frames
			.filter((frame) => frame.seq > from)
			.map((frame) => ({ seq: frame.seq, wall: frame.wall, jpeg: frame.jpeg.toString('base64') }));
	}
}

/* ------------------------------------------------------------------ */
/* 输入记录：轮询助手                                                  */
/* ------------------------------------------------------------------ */

/**
 * 键鼠输入记录器：spawn 一个 PowerShell 助手，按行读它写的 JSONL。
 *
 * 与 GdiFrameCapture 同一套路：助手写文件、主机增量读、停止文件收尾。
 * 助手只在前台窗口属于目标进程时记录（见 tools/record-input.ps1），
 * 所以这里拿到的就是「打游戏时的输入」。
 */
class InputRecorder {
	constructor(options) {
		this.id = options.id;
		this.t0 = Number.isFinite(options.t0) ? options.t0 : nowMs();
		this.config = normalizeInputConfig(options.config);
		this.scriptPath = options.scriptPath;
		this.outDir = options.outDir;
		this.outFile = path.join(this.outDir, 'input.jsonl');
		this.stopFile = options.stopFile;
		this.archivePath = typeof options.archivePath === 'string' ? options.archivePath : '';
		this.excludePid = Number.isFinite(options.excludePid) ? options.excludePid : 0;
		this.excludeNames = typeof options.excludeNames === 'string' ? options.excludeNames : '';
		this.spawnImpl = typeof options.spawnImpl === 'function' ? options.spawnImpl : spawn;
		this.emit = typeof options.emit === 'function' ? options.emit : () => {};
		/** 启动后等多久再收第一拍（给助手写 ready 的时间；测试里调小）。 */
		this.startDelayMs = Number.isFinite(options.startDelayMs) ? Math.max(1, options.startDelayMs) : 250;
		this.child = null;
		this.timer = null;
		this.running = false;
		this.armed = false;
		this.exited = false;
		this.exitCode = null;
		this.ready = false;
		this.error = '';
		this.startedAt = 0;
		this.readyAt = 0;
		this.readyInfo = null;
		this.stopInfo = null;
		this.pollMs = this.config.pollMs;
		this.offset = 0;
		this.carry = '';
		this.bytes = 0;
		this.events = 0;
		this.counts = { keys: 0, clicks: 0, focus: 0, moves: 0, resets: 0 };
		this.heldKeys = new Map();
		this.heldButtons = new Map();
		this.openHolds = new Map();
		this.lastEvent = null;
		this.measuredHz = 0;
	}

	status() {
		return {
			enabled: this.config.enabled,
			running: this.running,
			armed: this.armed,
			ready: this.ready,
			exited: this.exited,
			error: this.error,
			scope: this.config.scope,
			targets: inputTargetsList(this.config.targets),
			pollMs: this.pollMs,
			trailHz: this.config.trailHz,
			counts: { ...this.counts },
			held: Array.from(this.heldKeys.keys()),
			heldButtons: Array.from(this.heldButtons.keys()),
			events: this.events,
			bytes: this.bytes,
			measuredHz: this.measuredHz,
			lastEvent: this.lastEvent,
			readyAt: this.readyAt,
			compileMs: this.readyInfo?.compileMs ?? -1,
			cached: this.readyInfo?.cached === true,
			ps: this.readyInfo?.ps ?? '',
			stopInfo: this.stopInfo,
			archivePath: this.archivePath,
		};
	}

	async start() {
		if (this.running) return;
		this.running = true;
		this.startedAt = nowMs();
		try {
			await mkdir(this.outDir, { recursive: true });
			await rm(this.outFile, { force: true });
			await rm(this.stopFile, { force: true });
		} catch {
			/* 清不掉旧的也没关系，助手会覆盖 */
		}
		const args = [
			'-NoProfile',
			'-ExecutionPolicy', 'Bypass',
			'-File', this.scriptPath,
			'-Out', this.outFile,
			'-StopFile', this.stopFile,
			'-PollMs', String(this.config.pollMs),
			'-MaxSeconds', String(INPUT_MAX_SECONDS),
			'-Scope', this.config.scope,
			'-Targets', this.config.targets,
			'-ExcludePid', String(this.excludePid),
			'-ExcludeNames', this.excludeNames,
			'-TrailHz', String(this.config.trailHz),
		];
		try {
			this.child = this.spawnImpl('powershell.exe', args, { windowsHide: true, stdio: 'ignore' });
			this.armed = true;
			this.child?.once?.('error', (error) => {
				this.error = describeError(error);
			});
			this.child?.once?.('exit', (code) => {
				this.exited = true;
				this.exitCode = Number.isFinite(code) ? code : null;
			});
			if (typeof this.child?.unref === 'function') this.child.unref();
		} catch (error) {
			this.error = describeError(error);
			this.running = false;
			return;
		}
		this.timer = setInterval(() => {
			void this.pump();
		}, INPUT_PUMP_MS);
		if (typeof this.timer.unref === 'function') this.timer.unref();
		// 给助手一点启动时间（加载缓存程序集约 0.5s），先收第一拍
		await new Promise((resolve) => setTimeout(resolve, this.startDelayMs));
		await this.pump();
	}

	/** 读增量：只读「上次 offset → 当前 size」的新字节，按行切。 */
	async pump() {
		let info;
		try {
			info = await stat(this.outFile);
		} catch {
			return;
		}
		if (!info.isFile()) return;
		if (info.size > INPUT_MAX_BYTES) {
			if (this.error === '') this.error = `输入记录超过 ${Math.round(INPUT_MAX_BYTES / 1024 / 1024)}MB，已停止收取`;
			return;
		}
		if (info.size <= this.offset) return;
		let buffer;
		try {
			const handle = await openFile(this.outFile, 'r');
			try {
				const length = info.size - this.offset;
				buffer = Buffer.alloc(length);
				await handle.read(buffer, 0, length, this.offset);
			} finally {
				await handle.close();
			}
		} catch (error) {
			this.error = describeError(error);
			return;
		}
		this.offset = info.size;
		this.bytes += buffer.length;
		const { lines, carry } = splitBufferLines(buffer, this.carry);
		this.carry = carry;
		for (const line of lines) this.ingest(line);
	}

	/**
	 * 收一条输入行：ready/stop/error 只更新状态，其余带着按住时长转交录制。
	 * @param line JSONL 一行。
	 */
	ingest(line) {
		const record = parseInputRecord(line);
		if (record === null) return;
		if (record.kind === 'ready') {
			this.ready = true;
			this.readyAt = nowMs();
			this.readyInfo = record;
			if (Number.isFinite(record.pollMs) && record.pollMs > 0) this.pollMs = record.pollMs;
			return;
		}
		if (record.kind === 'stop') {
			this.stopInfo = record;
			// 实测采样率：助手报告的 tick 数 / 合并时长（比标称间隔诚实）
			if (record.ticks > 0 && record.mergedMs > 0) {
				this.measuredHz = Math.round((record.ticks / record.mergedMs) * 1000 * 10) / 10;
			}
			return;
		}
		if (record.kind === 'error') {
			this.error = record.message;
			return;
		}
		if (record.kind === 'key' || record.kind === 'button') {
			const slot = `${record.kind}:${record.name}`;
			const pocket = record.kind === 'key' ? this.heldKeys : this.heldButtons;
			if (record.down === true) {
				this.openHolds.set(slot, record.wall);
				pocket.set(record.name, true);
				if (record.kind === 'key') this.counts.keys += 1;
				else this.counts.clicks += 1;
			} else {
				pocket.delete(record.name);
				const started = this.openHolds.get(slot);
				if (started !== undefined) {
					record.ms = Math.max(0, Math.round(record.wall - started));
					this.openHolds.delete(slot);
				}
			}
		} else if (record.kind === 'focus') {
			this.counts.focus += 1;
		} else if (record.kind === 'move') {
			this.counts.moves += 1;
		} else if (record.kind === 'reset') {
			this.counts.resets += 1;
			this.openHolds.clear();
			this.heldKeys.clear();
			this.heldButtons.clear();
		}
		const event = { ...record, text: inputEventText(record) };
		this.events += 1;
		this.lastEvent = event;
		this.emit(event);
	}

	async stop() {
		this.running = false;
		if (this.timer !== null) {
			clearInterval(this.timer);
			this.timer = null;
		}
		await this.pump();
		try {
			await mkdir(path.dirname(this.stopFile), { recursive: true });
			await writeFile(this.stopFile, 'stop');
		} catch {
			/* 写不了停止文件就靠 kill */
		}
		const child = this.child;
		if (child !== null && child.exitCode === null) {
			await new Promise((resolve) => {
				const timer = setTimeout(() => {
					try {
						child.kill();
					} catch {
						/* 已经退了 */
					}
					resolve();
				}, 1500);
				child.once?.('exit', () => {
					clearTimeout(timer);
					resolve();
				});
			});
		}
		await this.pump();
		await this.archive();
		await removeDirectoryWithRetry(path.dirname(this.outDir));
	}

	/** 把原始 JSONL 复制到取证目录：临时目录会被删，这份是给 Agent 的原始记录。 */
	async archive() {
		if (this.archivePath === '') return;
		try {
			const raw = await readFile(this.outFile);
			await mkdir(path.dirname(this.archivePath), { recursive: true });
			await writeFile(this.archivePath, raw);
		} catch {
			/* 没有原始文件（还没写出第一行）就跳过 */
		}
	}
}

/* ------------------------------------------------------------------ */
/* 录制会话                                                            */
/* ------------------------------------------------------------------ */

/**
 * 一次录制的全部状态。主机只保存「事件 + 帧 + 产物落盘位置」。
 */
class Recording {
	constructor({ id, t0, sources, profileId, sessionId, cwd, inputConfig }) {
		this.id = id;
		this.t0 = Number.isFinite(t0) ? t0 : nowMs();
		this.startedAt = new Date(this.t0).toISOString();
		this.stoppedAt = '';
		this.sources = sources;
		this.profileId = profileId;
		this.sessionId = sessionId;
		this.cwd = cwd;
		this.events = [];
		this.seq = 0;
		this.dropped = 0;
		this.tails = new Map();
		this.statuses = new Map();
		this.recording = true;
		this.capture = null;
		this.inputs = [];
		this.inputSeq = 0;
		this.inputDropped = 0;
		this.inputRecorder = null;
		this.inputConfig = normalizeInputConfig(inputConfig);
		this.inputSkipReason = '';
	}

	addEvent(input) {
		const wall = Number.isFinite(input.wall) ? input.wall : nowMs();
		const event = {
			seq: this.seq,
			src: typeof input.src === 'string' ? input.src : 'ingest',
			level: input.level === 'error' || input.level === 'warn' ? input.level : classifyLevel(input.text ?? ''),
			text: String(input.text ?? ''),
			wall,
			relMs: Math.round(wall - this.t0),
			pre: input.pre === true,
			marker: input.marker === true ? String(input.markerLabel ?? '标记') : '',
		};
		if (input.anchor !== null && typeof input.anchor === 'object') event.anchor = input.anchor;
		this.seq += 1;
		this.events.push(event);
		if (this.events.length > MAX_EVENTS) {
			const overflow = this.events.length - MAX_EVENTS;
			this.events.splice(0, overflow);
			this.dropped += overflow;
		}
		return event;
	}

	/**
	 * 收一条输入事件（键/鼠标/前台切换），与日志事件共用同一条时钟。
	 * @param input 已归一化、带 wall 的输入事件。
	 * @returns {object} 落库后的事件（带 seq / relMs）。
	 */
	addInput(input) {
		const wall = Number.isFinite(input?.wall) ? input.wall : nowMs();
		const event = { ...input, seq: this.inputSeq, wall, relMs: Math.round(wall - this.t0) };
		this.inputSeq += 1;
		this.inputs.push(event);
		if (this.inputs.length > MAX_INPUT_EVENTS) {
			const overflow = this.inputs.length - MAX_INPUT_EVENTS;
			this.inputs.splice(0, overflow);
			this.inputDropped += overflow;
		}
		return event;
	}

	inputsSince(since) {
		const from = Number.isFinite(since) && since > 0 ? Math.max(0, Math.floor(since)) : 0;
		return this.inputs.filter((event) => event.seq >= from);
	}

	sliceInputs(fromRel, toRel) {
		return sliceInputs(this.inputs, fromRel, toRel);
	}

	/** 打点锚点：标记前 2 秒内最后一条按下的键/鼠标。 */
	inputAnchor(atWall) {
		const atRel = Math.round((Number.isFinite(atWall) ? atWall : nowMs()) - this.t0);
		return findInputAnchor(this.inputs, atRel);
	}

	/** 输入记录状态（给面板的实时读数）。 */
	inputSnapshot() {
		if (this.inputRecorder !== null) {
			return { ...this.inputRecorder.status(), count: this.inputs.length, dropped: this.inputDropped };
		}
		return {
			enabled: this.inputConfig.enabled,
			running: false,
			armed: false,
			ready: false,
			error: '',
			scope: this.inputConfig.scope,
			targets: inputTargetsList(this.inputConfig.targets),
			pollMs: this.inputConfig.pollMs,
			trailHz: this.inputConfig.trailHz,
			counts: { keys: 0, clicks: 0, focus: 0, moves: 0, resets: 0 },
			held: [],
			heldButtons: [],
			events: 0,
			bytes: 0,
			measuredHz: 0,
			lastEvent: null,
			reason: this.inputSkipReason,
			stopInfo: null,
			archivePath: '',
		};
	}

	async stopInput() {
		if (this.inputRecorder === null) return;
		try {
			await this.inputRecorder.stop();
		} catch {
			/* 收尾失败不影响别的产物 */
		}
	}

	startTails() {
		for (const source of this.sources) {
			if (source.kind !== 'file') continue;
			if (source.path === '') {
				this.statuses.set(source.id, { ok: false, error: '未配置路径', started: false, size: 0, offset: 0, lines: 0, binaryDropped: 0 });
				continue;
			}
			const tail = new FileTail({
				id: source.id,
				path: source.path,
				t0: this.t0,
				emit: (event) => {
					this.addEvent({ ...event, src: source.id });
				},
				onStatus: (status) => {
					this.statuses.set(source.id, status);
				},
			});
			this.tails.set(source.id, tail);
			void tail.start();
		}
	}

	stopTails() {
		for (const tail of this.tails.values()) tail.stop();
	}

	stopCapture() {
		if (this.capture !== null) {
			// GdiFrameCapture.stop() 是异步的（等助手退出、清临时目录）；这里不等它，
			// 调用方要么已经拿走帧，要么不再需要。
			void this.capture.stop();
		}
	}

	snapshot() {
		return {
			id: this.id,
			recording: this.recording,
			t0: this.t0,
			startedAt: this.startedAt,
			stoppedAt: this.stoppedAt,
			profileId: this.profileId,
			sessionId: this.sessionId,
			cwd: this.cwd,
			seq: this.seq,
			dropped: this.dropped,
			sources: this.sources.map((source) => ({ ...source, status: this.statuses.get(source.id) ?? null })),
			capture: this.capture?.status() ?? null,
			input: this.inputSnapshot(),
			inputCount: this.inputs.length,
			inputDropped: this.inputDropped,
		};
	}

	eventsSince(since) {
		const from = Number.isFinite(since) && since > 0 ? Math.max(0, Math.floor(since)) : 0;
		const events = this.events.filter((event) => event.seq >= from);
		return { events, cursor: this.seq, dropped: this.dropped };
	}

	slice(fromRel, toRel) {
		const from = Number.isFinite(fromRel) ? fromRel : -Infinity;
		const to = Number.isFinite(toRel) ? toRel : Infinity;
		return this.events.filter((event) => event.relMs >= from && event.relMs <= to);
	}
}

/* ------------------------------------------------------------------ */
/* 落盘：bundle.md / bundle.json                                       */
/* ------------------------------------------------------------------ */

/**
 * 生成给 Agent 读的 Markdown。纯函数，便于单测。
 * @param {object} input 汇总信息。
 * @returns {string} Markdown 文本。
 */
export function renderBundleMarkdown(input) {
	const {
		title = '现场取证',
		description = '',
		cwd = '',
		profileName = '',
		fromRel = 0,
		toRel = 0,
		events = [],
		artifacts = [],
		annotations = [],
		markers = [],
		sources = [],
		notes = [],
		captureInfo = '',
		inputInfo = '',
		inputLines = [],
	} = input ?? {};
	const lines = [];
	lines.push(`# ${title}`, '');
	lines.push(`- **取证时间**：${formatWall(new Date())}`);
	if (profileName !== '') lines.push(`- **日志配置**：${profileName}`);
	if (cwd !== '') lines.push(`- **工作目录**：\`${cwd}\``);
	lines.push(`- **区间**：\`${formatRelMs(fromRel)}\` → \`${formatRelMs(toRel)}\`（时长 ${formatRelMs(Math.max(0, toRel - fromRel))}）`);
	if (captureInfo !== '') lines.push(`- **采集方式**：${captureInfo}`);
	if (inputInfo !== '') lines.push(`- **输入记录**：${inputInfo}`);
	if (events.length > 0) lines.push(`- **区间内事件**：${events.length} 条`);
	lines.push('');

	if (description.trim() !== '') {
		lines.push('## 问题描述', '', description.trim(), '');
	}

	const images = artifacts.filter((item) => item.kind === 'image' || item.kind === 'animation');
	if (images.length > 0) {
		lines.push('## 现场图像', '');
		for (const item of images) {
			lines.push(`**${item.label ?? item.name}**${item.caption ? ` — ${item.caption}` : ''}`, '');
			lines.push(`![${item.label ?? item.name}](${item.path})`, '');
		}
	}

	const others = artifacts.filter((item) => item.kind !== 'image' && item.kind !== 'animation');
	if (others.length > 0) {
		lines.push('## 其它产物', '');
		for (const item of others) lines.push(`- \`${item.path}\`${item.caption ? ` — ${item.caption}` : ''}`);
		lines.push('');
	}

	if (annotations.length > 0) {
		lines.push('## 画面标注', '');
		const fixed = (value) => (Number.isFinite(value) ? Number(value).toFixed(3) : '0.000');
		for (const [index, annotation] of annotations.entries()) {
			const rect = annotation.rect ?? {};
			// 坐标是归一化的（0..1，相对画面宽高），保留三位小数，别四舍五入成 0
			const parts = [`区域 #${index + 1}：归一化 x=${fixed(rect.x)}, y=${fixed(rect.y)}, w=${fixed(rect.w)}, h=${fixed(rect.h)}`];
			if (typeof annotation.note === 'string' && annotation.note.trim() !== '') parts.push(`说明：${annotation.note.trim()}`);
			if (Number.isFinite(annotation.atRel)) parts.push(`出现在 ${formatRelMs(annotation.atRel)}`);
			lines.push(`- ${parts.join('；')}`);
		}
		lines.push('');
	}

	if (markers.length > 0) {
		lines.push('## 打点', '');
		for (const marker of markers) lines.push(`- \`${formatRelMs(marker.relMs)}\` ${marker.label}`);
		lines.push('');
	}

	if (sources.length > 0) {
		lines.push('## 日志源', '');
		for (const source of sources) lines.push(`- **${source.label}**（${source.id}）：\`${source.path || '实时推送'}\``);
		lines.push('');
	}

	if (events.length > 0) {
		lines.push('## 事件流（区间内）', '');
		lines.push('```log');
		for (const event of events) {
			const time = formatRelMs(event.relMs);
			if (typeof event.marker === 'string' && event.marker !== '') {
				// 打点行只写一次标签：它的 text 本身就是「【打点】…」，重复一遍只是噪音
				lines.push(`[${time}] ⚑ ${event.marker}${event.pre ? '（录制前）' : ''}`);
				continue;
			}
			lines.push(`[${time}] (${event.src})${event.pre ? ' (录制前)' : ''} ${event.text}`);
		}
		lines.push('```', '');
	}

	if (Array.isArray(inputLines) && inputLines.length > 0) {
		for (const line of inputLines) lines.push(line);
	}

	if (notes.length > 0) {
		lines.push('## 备注', '');
		for (const note of notes) lines.push(`- ${note}`);
		lines.push('');
	}

	return lines.join('\n');
}

function formatWall(date) {
	const pad = (value) => String(value).padStart(2, '0');
	const offsetMinutes = -date.getTimezoneOffset();
	const sign = offsetMinutes >= 0 ? '+' : '-';
	const absMinutes = Math.abs(offsetMinutes);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} (${sign}${pad(Math.floor(absMinutes / 60))}:${pad(absMinutes % 60)})`;
}

/* ------------------------------------------------------------------ */
/* HTTP 工具                                                           */
/* ------------------------------------------------------------------ */

function sendJson(res, status, payload) {
	const text = JSON.stringify(payload);
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
	res.end(text);
}

function ok(res, value) {
	sendJson(res, 200, { ok: true, value });
}

function fail(res, status, code, message) {
	sendJson(res, status, { ok: false, code, message });
}

async function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on('data', (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new Error(`请求体超过 ${Math.round(MAX_BODY_BYTES / 1024 / 1024)}MB`));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8');
			if (raw.trim() === '') {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(raw));
			} catch (error) {
				reject(new Error(`JSON 解析失败：${describeError(error)}`));
			}
		});
		req.on('error', reject);
	});
}

/* ------------------------------------------------------------------ */
/* 插件主体                                                            */
/* ------------------------------------------------------------------ */

/** 解析 DSH home：优先环境变量，其次 ~/.dsh。 */
function resolveDshHome() {
	const fromEnv = process.env.DSH_HOME;
	if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return path.resolve(fromEnv);
	return path.join(os.homedir(), '.dsh');
}

function profilesFilePath() {
	return path.join(resolveDshHome(), 'storages', 'dsh-incident-studio', 'profiles.json');
}

/** 浏览器端自检回执文件：插件在页面里跑到哪一步，运维时一眼可见。 */
function clientBootFilePath() {
	return path.join(resolveDshHome(), 'storages', 'dsh-incident-studio', 'client-boot.json');
}

/** 宿主抓帧能力回执：只记数量与错误，不记窗口标题、不抓像素。 */
function captureCapabilityFilePath() {
	return path.join(resolveDshHome(), 'storages', 'dsh-incident-studio', 'capture-capability.json');
}

/** 输入记录能力回执：能不能在这台机器上编译/加载键鼠互操作程序集。 */
function inputCapabilityFilePath() {
	return path.join(resolveDshHome(), 'storages', 'dsh-incident-studio', 'input-capability.json');
}

export const name = 'dsh-incident-studio';

export const inject = ['webServer', 'sessions', 'connection'];

/**
 * 插件入口。
 * @param {object} ctx cordis 上下文。
 * @param {object} config loader 行上的配置。
 */
export function apply(ctx, config) {
	const settings = config !== null && typeof config === 'object' ? config : {};
	const rootName = typeof settings.artifactsDirName === 'string' && settings.artifactsDirName !== ''
		? settings.artifactsDirName
		: '.dsh-incidents';
	const captureFps = Number.isFinite(settings.captureFps) ? Math.max(1, Math.min(15, settings.captureFps)) : 6;
	const captureWidth = Number.isFinite(settings.captureWidth) ? Math.max(320, Math.min(1920, settings.captureWidth)) : 960;
	const captureQuality = Number.isFinite(settings.captureQuality) ? Math.max(30, Math.min(95, settings.captureQuality)) : 62;
	/** 一次开机一个 ingest token：本机进程推送事件要带上它，浏览器面板从 /state 拿到。 */
	const ingestToken = randomBytes(16).toString('hex');
	/** 插件目录：tools/ 下的两个助手都从这里找。 */
	const pluginRoot = path.dirname(fileURLToPath(import.meta.url));
	const inputScriptPath = path.join(pluginRoot, 'tools', 'record-input.ps1');
	const inputInteropPath = path.join(pluginRoot, 'tools', 'input-interop.cs');
	let current = null;
	let electronCapability = null;
	let inputCapability = {
		at: '',
		platform: process.platform,
		mode: chooseInputMode(process.platform),
		available: false,
		reason: '还没探测',
		script: false,
		interop: false,
		keys: 0,
		error: '',
	};

	ctx.logger?.info?.('dsh-incident-studio: host ready');
	// 启动即探一次抓帧能力（不抓像素），结果落在 capture-capability.json。
	void probeCaptureCapability();
	// 输入助手要跑一次才算真的可用（要编译互操作程序集）；默认开，测试里关掉。
	if (settings.inputProbe !== false) void probeInputCapability();

	function resolveCwd(sessionId) {
		try {
			if (typeof sessionId === 'string' && sessionId !== '') {
				const session = ctx.sessions?.get?.(sessionId);
				const cwd = session?.header?.cwd;
				if (typeof cwd === 'string' && cwd !== '') return cwd;
			}
		} catch {
			/* 会话不可达时退回进程目录 */
		}
		return process.cwd();
	}

	async function loadProfiles() {
		try {
			return normalizeProfilesDocument(JSON.parse(await readFile(profilesFilePath(), 'utf8')));
		} catch {
			return defaultProfiles();
		}
	}

	async function saveProfiles(document) {
		const filePath = profilesFilePath();
		const normalized = normalizeProfilesDocument(document);
		normalized.profiles = normalized.profiles.map((profile) => ({ ...profile, updatedAt: new Date().toISOString() }));
		await mkdir(path.dirname(filePath), { recursive: true });
		await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
		return normalized;
	}

	function rejected(req) {
		try {
			return ctx.connection?.requestRejection?.(req) !== undefined;
		} catch {
			return false;
		}
	}

	function ingestAllowed(req) {
		try {
			if (ctx.connection?.requestRejection?.(req) === undefined) return true;
		} catch {
			/* 没有 connection 时退回 token 校验 */
		}
		const header = req.headers['x-incident-token'];
		return typeof header === 'string' && header === ingestToken;
	}

	function requireRecording(res) {
		if (current === null) {
			fail(res, 409, 'no-recording', '还没有开始录制');
			return false;
		}
		return true;
	}

	async function capability() {
		if (electronCapability === null) electronCapability = await detectElectron();
		return electronCapability;
	}

	/**
	 * 启动时探一次抓帧能力并落回执（只数数量，不抓像素、不记窗口标题）。
	 *
	 * 这条让人不必录一次屏就能回答「这台宿主到底能不能抓帧」——排查时最先要问的
	 * 就是这个。失败一律静默：探不到能力不该影响插件加载。
	 */
	async function probeCaptureCapability() {
		const document = {
			at: new Date().toISOString(),
			platform: process.platform,
			electron: false,
			mode: '',
			reason: '',
			screenCount: 0,
			windowCount: 0,
		};
		try {
			const cap = await capability();
			document.electron = cap.available === true;
			document.mode = chooseCaptureMode(cap, process.platform);
			document.reason = cap.available === true ? '' : (cap.reason ?? '');
			if (cap.available === true) {
				const sources = await cap.desktopCapturer.getSources({
					types: ['screen', 'window'],
					// 0×0 缩略图：不产生任何屏幕像素，只取源列表。
					thumbnailSize: { width: 0, height: 0 },
					fetchWindowIcons: false,
				});
				document.screenCount = sources.filter((item) => String(item.id).startsWith('screen:')).length;
				document.windowCount = sources.filter((item) => String(item.id).startsWith('window:')).length;
			}
		} catch (error) {
			document.error = describeError(error);
		}
		try {
			const filePath = captureCapabilityFilePath();
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
		} catch {
			/* 回执写不下来不影响功能 */
		}
		return document;
	}

	/**
	 * 探一次输入记录能力：真的把助手跑起来（它会编译/加载互操作程序集）。
	 *
	 * 这是唯一能回答「这台机器能不能记键鼠」的办法——只看文件在不在不够，
	 * 杀软、沙箱或不完整的 .NET 都可能让它编译失败。结果落 input-capability.json。
	 * 失败一律静默：输入记录不可用不该影响其余功能。
	 */
	async function probeInputCapability() {
		const document = {
			at: new Date().toISOString(),
			platform: process.platform,
			mode: chooseInputMode(process.platform),
			available: false,
			reason: '',
			script: existsSync(inputScriptPath),
			interop: existsSync(inputInteropPath),
			keys: 0,
			compileMs: -1,
			cached: false,
			ps: '',
			elapsedMs: 0,
			error: '',
		};
		const startedAt = nowMs();
		try {
			if (document.mode === 'none') {
				document.reason = '只有 Windows 上才有键鼠轮询助手';
			} else if (!document.script || !document.interop) {
				document.reason = `输入助手文件缺失（${document.script ? '' : 'record-input.ps1 '}${document.interop ? '' : 'input-interop.cs'}）`.trim();
			} else {
				const probeDir = path.join(os.tmpdir(), 'dsh-incident-studio', `probe-${process.pid}`);
				await mkdir(probeDir, { recursive: true });
				const probeFile = path.join(probeDir, 'probe.jsonl');
				await rm(probeFile, { force: true }).catch(() => {});
				const child = spawn('powershell.exe', [
					'-NoProfile',
					'-ExecutionPolicy', 'Bypass',
					'-File', inputScriptPath,
					'-Probe',
					'-Out', probeFile,
				], { windowsHide: true, stdio: 'ignore' });
				await new Promise((resolve) => {
					const timer = setTimeout(() => {
						try {
							child.kill();
						} catch {
							/* 已经退出 */
						}
						document.reason = '探测超时（输入助手没在 20 秒内就绪）';
						resolve();
					}, 20000);
					child.once('error', (error) => {
						clearTimeout(timer);
						document.error = describeError(error);
						resolve();
					});
					child.once('exit', () => {
						clearTimeout(timer);
						resolve();
					});
				});
				let raw = '';
				try {
					raw = await readFile(probeFile, 'utf8');
				} catch {
					raw = '';
				}
				const line = raw.split(/\r?\n/u).find((item) => item.trim() !== '') ?? '';
				const record = parseInputRecord(line);
				if (record !== null && record.kind === 'ready') {
					document.available = true;
					document.keys = record.keys;
					document.compileMs = record.compileMs;
					document.cached = record.cached;
					document.ps = record.ps;
				} else if (record !== null && record.kind === 'error') {
					document.reason = record.message;
				} else if (document.reason === '') {
					document.reason = '输入助手没有回报就绪状态';
				}
				await removeDirectoryWithRetry(probeDir);
			}
		} catch (error) {
			document.error = describeError(error);
			if (document.reason === '') document.reason = document.error;
		}
		document.elapsedMs = nowMs() - startedAt;
		inputCapability = document;
		try {
			const filePath = inputCapabilityFilePath();
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
		} catch {
			/* 回执写不下来不影响功能 */
		}
		return document;
	}

	/* ------------------------------ 路由 ------------------------------ */

	async function handleState(req, res) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		const profiles = await loadProfiles();
		const cap = await capability();
		return ok(res, {
			ingestToken,
			dshHome: resolveDshHome(),
			artifactsDirName: rootName,
			profiles,
			recording: current?.snapshot() ?? null,
			now: nowMs(),
			platform: process.platform,
			capture: {
				native: cap.available === true,
				nativeReason: cap.available === true ? '' : (cap.reason ?? ''),
				mode: chooseCaptureMode(cap, process.platform),
				fps: captureFps,
				width: captureWidth,
				quality: captureQuality,
			},
			input: {
				mode: inputCapability.mode,
				available: inputCapability.available === true,
				reason: inputCapability.reason ?? '',
				error: inputCapability.error ?? '',
				keys: inputCapability.keys ?? 0,
				probedAt: inputCapability.at ?? '',
				maxSeconds: INPUT_MAX_SECONDS,
				defaults: normalizeInputConfig({}),
			},
		});
	}

	async function handleProfiles(req, res) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		if (req.method === 'GET') return ok(res, await loadProfiles());
		if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed', '只接受 GET/POST');
		let body;
		try {
			body = await readJsonBody(req);
		} catch (error) {
			return fail(res, 400, 'bad-request', describeError(error));
		}
		try {
			return ok(res, await saveProfiles(body));
		} catch (error) {
			return fail(res, 500, 'save-failed', describeError(error));
		}
	}

	async function handleProbe(req, res) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed', '只接受 POST');
		let body;
		try {
			body = await readJsonBody(req);
		} catch (error) {
			return fail(res, 400, 'bad-request', describeError(error));
		}
		const target = typeof body?.path === 'string' ? body.path.trim() : '';
		if (target === '') return fail(res, 400, 'missing-path', '缺少 path');
		const absolute = path.isAbsolute(target) ? target : path.resolve(resolveCwd(body?.sessionId), target);
		try {
			const info = await stat(absolute);
			if (!info.isFile()) return ok(res, { ok: false, absolute, reason: 'not-a-file', message: '这个路径不是文件' });
			return ok(res, {
				ok: true,
				absolute,
				size: info.size,
				mtime: info.mtime.toISOString(),
				hint: `文件存在，${formatBytes(info.size)}，最后写入 ${info.mtime.toLocaleString('zh-CN')}`,
			});
		} catch (error) {
			return ok(res, { ok: false, absolute, reason: 'missing', message: describeError(error) });
		}
	}

	async function handleStart(req, res) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed', '只接受 POST');
		let body;
		try {
			body = await readJsonBody(req);
		} catch (error) {
			return fail(res, 400, 'bad-request', describeError(error));
		}
		if (current !== null && current.recording) {
			return ok(res, { reused: true, recording: current.snapshot() });
		}
		const cwd = resolveCwd(body?.sessionId);
		const rawSources = Array.isArray(body?.sources) ? body.sources : [];
		const sources = rawSources
			.map((source, index) => normalizeSource(source, index))
			.filter((source) => source.enabled !== false)
			.map((source) => ({
				...source,
				path: source.kind === 'file' && source.path !== ''
					? (path.isAbsolute(source.path) ? path.normalize(source.path) : path.resolve(cwd, source.path))
					: '',
			}));
		const recording = new Recording({
			id: `${timestampId()}-${randomBytes(3).toString('hex')}`,
			t0: Number.isFinite(body?.t0) ? Number(body.t0) : nowMs(),
			sources,
			profileId: typeof body?.profileId === 'string' ? body.profileId : '',
			sessionId: typeof body?.sessionId === 'string' ? body.sessionId : '',
			cwd,
			inputConfig: body?.input,
		});
		current = recording;
		recording.startTails();
		// 输入记录：只有真的记得到东西时才起助手（没目标进程又没有 all 就没意义）。
		const inputMode = chooseInputMode(process.platform);
		if (inputMode === 'none') {
			recording.inputSkipReason = '这台宿主不支持（只有 Windows 有键鼠轮询助手）';
		} else if (recording.inputConfig.enabled !== true) {
			recording.inputSkipReason = '输入记录已关闭';
		} else if (recording.inputConfig.scope !== 'all' && inputTargetsList(recording.inputConfig.targets).length === 0) {
			recording.inputSkipReason = '还没填目标进程（设置里填游戏进程名，例如 Remains）';
		} else {
			const scratch = path.join(os.tmpdir(), 'dsh-incident-studio-input', recording.id);
			const recorder = new InputRecorder({
				id: recording.id,
				t0: recording.t0,
				config: recording.inputConfig,
				scriptPath: inputScriptPath,
				outDir: path.join(scratch, 'in'),
				stopFile: path.join(scratch, 'stop'),
				archivePath: path.join(cwd, rootName, recording.id, 'input.jsonl'),
				excludePid: process.pid,
				// Electron 里窗口可能属于应用主进程而不是插件宿主；按进程名一起排除。
				excludeNames: path.basename(process.execPath, path.extname(process.execPath)).toLowerCase(),
				emit: (event) => {
					recording.addInput(event);
				},
			});
			recording.inputRecorder = recorder;
			void recorder.start();
		}
		ctx.logger?.info?.(`dsh-incident-studio: 开始录制 ${recording.id}（${sources.length} 个日志源，输入=${recording.inputRecorder === null ? `关：${recording.inputSkipReason}` : `${recording.inputConfig.scope}/${recording.inputConfig.targets}`}，cwd=${cwd}）`);
		return ok(res, { reused: false, recording: recording.snapshot() });
	}

	async function handleStop(req, res) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed', '只接受 POST');
		if (!requireRecording(res)) return undefined;
		current.recording = false;
		current.stoppedAt = new Date().toISOString();
		current.stopTails();
		// 先收输入：它要把原始 JSONL 归档到取证目录，而抓帧的临时目录会被清掉。
		try {
			await current.stopInput();
		} catch (error) {
			ctx.logger?.warn?.(`dsh-incident-studio: 停止输入记录时出错 ${describeError(error)}`);
		}
		current.stopCapture();
		ctx.logger?.info?.(`dsh-incident-studio: 停止录制 ${current.id}（${current.events.length} 条事件，${current.inputs.length} 条输入）`);
		return ok(res, { recording: current.snapshot() });
	}

	async function handleInput(req, res, url) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		if (!requireRecording(res)) return undefined;
		const since = Number.parseInt(url.searchParams.get('since') ?? '0', 10);
		return ok(res, {
			inputs: current.inputsSince(Number.isFinite(since) ? since : 0),
			cursor: current.inputSeq,
			dropped: current.inputDropped,
			total: current.inputs.length,
			input: current.inputSnapshot(),
			t0: current.t0,
		});
	}

	async function handleEvents(req, res, url) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		if (!requireRecording(res)) return undefined;
		const since = Number.parseInt(url.searchParams.get('since') ?? '0', 10);
		const snapshot = current.eventsSince(Number.isFinite(since) ? since : 0);
		return ok(res, { ...snapshot, recording: current.snapshot() });
	}

	async function handleMarker(req, res) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed', '只接受 POST');
		if (!requireRecording(res)) return undefined;
		let body;
		try {
			body = await readJsonBody(req);
		} catch (error) {
			return fail(res, 400, 'bad-request', describeError(error));
		}
		const label = typeof body?.label === 'string' && body.label.trim() !== '' ? body.label.trim() : '标记';
		// 锚点：把「打点前最后按下的键/鼠标」记进去，回答「问题出现前我做了什么」。
		const anchor = current.inputAnchor(nowMs());
		const event = current.addEvent({
			src: 'marker',
			text: `【打点】${label}`,
			level: 'info',
			marker: true,
			markerLabel: label,
			anchor,
		});
		return ok(res, { event, cursor: current.seq, anchor: anchor ?? null });
	}

	async function handleIngest(req, res) {
		if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed', '只接受 POST');
		if (!ingestAllowed(req)) return fail(res, 403, 'forbidden', '需要有效的 x-incident-token');
		if (!requireRecording(res)) return undefined;
		let body;
		try {
			body = await readJsonBody(req);
		} catch (error) {
			return fail(res, 400, 'bad-request', describeError(error));
		}
		const text = typeof body?.text === 'string' ? body.text : '';
		if (text === '') return fail(res, 400, 'missing-text', '缺少 text');
		const event = current.addEvent({
			src: typeof body?.src === 'string' && body.src !== '' ? body.src : 'ingest',
			text,
			level: typeof body?.level === 'string' ? body.level : undefined,
			wall: Number.isFinite(body?.wall) ? Number(body.wall) : undefined,
		});
		return ok(res, { event, cursor: current.seq });
	}

	async function handleArtifact(req, res) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed', '只接受 POST');
		if (!requireRecording(res)) return undefined;
		let body;
		try {
			body = await readJsonBody(req);
		} catch (error) {
			return fail(res, 413, 'payload-too-large', describeError(error));
		}
		const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
		const data = typeof body?.data === 'string' ? body.data : '';
		if (rawName === '' || data === '') return fail(res, 400, 'bad-request', '缺少 name 或 data');
		const name = safeSlug(path.basename(rawName), 'artifact');
		const directory = path.join(current.cwd, rootName, current.id);
		try {
			await mkdir(directory, { recursive: true });
			const buffer = Buffer.from(data, 'base64');
			const absolute = path.join(directory, name);
			await writeFile(absolute, buffer);
			return ok(res, { path: absolute, name, bytes: buffer.length, dir: directory });
		} catch (error) {
			return fail(res, 500, 'write-failed', describeError(error));
		}
	}

	async function handleBundle(req, res) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed', '只接受 POST');
		let body;
		try {
			body = await readJsonBody(req);
		} catch (error) {
			return fail(res, 400, 'bad-request', describeError(error));
		}
		if (current === null) return fail(res, 409, 'no-recording', '还没有开始录制');
		const directory = path.join(current.cwd, rootName, current.id);
		const title = typeof body?.title === 'string' && body.title.trim() !== '' ? body.title.trim() : '现场取证';
		const fromRel = Number.isFinite(body?.fromRel) ? Number(body.fromRel) : 0;
		const toRel = Number.isFinite(body?.toRel) ? Number(body.toRel) : fromRel;
		const artifacts = Array.isArray(body?.artifacts)
			? body.artifacts
				.filter((item) => item !== null && typeof item === 'object' && typeof item.path === 'string')
				.map((item) => ({
					kind: typeof item.kind === 'string' ? item.kind : 'file',
					path: item.path,
					name: typeof item.name === 'string' ? item.name : path.basename(item.path),
					label: typeof item.label === 'string' ? item.label : undefined,
					caption: typeof item.caption === 'string' ? item.caption : undefined,
				}))
			: [];
		const annotations = Array.isArray(body?.annotations) ? body.annotations : [];
		const events = Array.isArray(body?.events)
			? body.events
				.filter((event) => event !== null && typeof event === 'object')
				.map((event) => {
					const mapped = {
						seq: Number.isFinite(event.seq) ? event.seq : 0,
						src: typeof event.src === 'string' ? event.src : '',
						level: event.level === 'error' || event.level === 'warn' ? event.level : 'info',
						text: String(event.text ?? ''),
						relMs: Number.isFinite(event.relMs) ? event.relMs : 0,
						pre: event.pre === true,
						marker: typeof event.marker === 'string' ? event.marker : '',
					};
					// 打点锚点（前一条键鼠输入）随事件一起进纪要
					if (event.anchor !== null && typeof event.anchor === 'object') mapped.anchor = event.anchor;
					return mapped;
				})
			: current.slice(fromRel, toRel);
		const markers = events
			.filter((event) => event.marker !== '')
			.map((event) => ({ relMs: event.relMs, label: event.marker, anchor: event.anchor ?? null }));
		// 输入记录：原始 JSONL 已在停止时归档；这里只做区间切片与渲染
		const inputEvents = current.sliceInputs(fromRel, toRel);
		const inputSummary = summarizeInputs(inputEvents);
		const inputConfig = current.inputConfig;
		const inputArchive = current.inputRecorder?.archivePath ?? '';
		if (inputArchive !== '' && existsSync(inputArchive) && !artifacts.some((item) => item.path === inputArchive)) {
			artifacts.push({
				kind: 'data',
				name: 'input.jsonl',
				path: inputArchive,
				label: '输入原始记录',
				caption: '每行一个 JSON 事件（键/鼠标/前台切换），字段与 input 段一致',
			});
		}
		const inputLines = [];
		if (current.inputRecorder !== null) {
			inputLines.push(...renderInputMarkdown({
				inputs: inputEvents,
				config: inputConfig,
				measuredHz: current.inputRecorder.measuredHz,
				markers,
			}));
		} else if (inputConfig.enabled === true) {
			inputLines.push('## 输入记录', '', `- 这次没有记录键鼠输入：${current.inputSkipReason || '未启用'}。`, '');
		}
		const inputInfo = current.inputRecorder !== null
			? `按键 ${inputSummary.keyDowns} 次按下、鼠标 ${inputSummary.clicks} 次点击、前台切换 ${inputSummary.focus} 次（区间内 ${inputSummary.total} 条）`
			: '';
		const profileName = typeof body?.profileName === 'string' ? body.profileName : '';
		const markdown = renderBundleMarkdown({
			title,
			description: typeof body?.description === 'string' ? body.description : '',
			cwd: current.cwd,
			profileName,
			fromRel,
			toRel,
			events,
			artifacts,
			annotations,
			markers,
			sources: current.sources.map((source) => ({ id: source.id, label: source.label, path: source.path })),
			notes: Array.isArray(body?.notes) ? body.notes.filter((note) => typeof note === 'string') : [],
			captureInfo: typeof body?.captureInfo === 'string' ? body.captureInfo : '',
			inputInfo,
			inputLines,
		});
		try {
			await mkdir(directory, { recursive: true });
			const markdownPath = path.join(directory, 'bundle.md');
			const jsonPath = path.join(directory, 'bundle.json');
			await writeFile(markdownPath, `${markdown}\n`, 'utf8');
			await writeFile(jsonPath, `${JSON.stringify({
				version: 1,
				id: current.id,
				title,
				createdAt: new Date().toISOString(),
				sessionId: current.sessionId,
				profileId: current.profileId,
				profileName,
				cwd: current.cwd,
				fromRel,
				toRel,
				description: typeof body?.description === 'string' ? body.description : '',
				artifacts,
				annotations,
				sources: current.sources,
				events,
				markers,
				inputConfig,
				inputSummary,
				inputs: inputEvents,
				inputArtifact: inputArchive,
			}, null, 2)}\n`, 'utf8');
			ctx.logger?.info?.(`dsh-incident-studio: 写入取证包 ${markdownPath}`);
			return ok(res, {
				dir: directory,
				markdownPath,
				jsonPath,
				markdown,
				eventCount: events.length,
				id: current.id,
				inputInfo,
				inputSummary,
				inputCount: inputEvents.length,
				inputArtifact: inputArchive,
			});
		} catch (error) {
			return fail(res, 500, 'write-failed', describeError(error));
		}
	}

	async function handleIncidents(req, res, url) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		const cwd = resolveCwd(url.searchParams.get('sessionId') ?? '');
		const root = path.join(cwd, rootName);
		try {
			const entries = await readdir(root, { withFileTypes: true });
			const items = [];
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const directory = path.join(root, entry.name);
				let markdownPath = '';
				let title = '';
				let createdAt = '';
				try {
					const info = await stat(path.join(directory, 'bundle.md'));
					markdownPath = path.join(directory, 'bundle.md');
					createdAt = info.mtime.toISOString();
				} catch {
					/* 还没写 bundle 的目录也列出来 */
				}
				try {
					const meta = JSON.parse(await readFile(path.join(directory, 'bundle.json'), 'utf8'));
					title = typeof meta?.title === 'string' ? meta.title : '';
					createdAt = typeof meta?.createdAt === 'string' ? meta.createdAt : createdAt;
				} catch {
					/* 没有 meta 就用目录名 */
				}
				items.push({ id: entry.name, dir: directory, title, createdAt, markdownPath });
			}
			items.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
			return ok(res, { root, items: items.slice(0, 100) });
		} catch (error) {
			if (error?.code === 'ENOENT') return ok(res, { root, items: [] });
			return fail(res, 500, 'read-failed', describeError(error));
		}
	}

	async function handleOpen(req, res) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed', '只接受 POST');
		let body;
		try {
			body = await readJsonBody(req);
		} catch (error) {
			return fail(res, 400, 'bad-request', describeError(error));
		}
		const target = typeof body?.path === 'string' ? body.path : '';
		if (target === '') return fail(res, 400, 'missing-path', '缺少 path');
		const root = path.join(resolveCwd(body?.sessionId), rootName);
		if (!isInsidePath(root, target)) return fail(res, 403, 'outside-root', '只能打开取证目录内的文件');
		const absolute = path.resolve(target);
		try {
			await spawnDetached(process.platform === 'win32' ? 'explorer.exe' : (process.platform === 'darwin' ? 'open' : 'xdg-open'), [absolute]);
			return ok(res, { path: absolute });
		} catch (error) {
			return fail(res, 502, 'launch-failed', describeError(error));
		}
	}

	/**
	 * 浏览器端自检回执：客户端 bundle 每跑到一个阶段就回报一次。
	 *
	 * 这条路由只写一个小 JSON（storages/dsh-incident-studio/client-boot.json），
	 * 用来回答「插件在页面里到底加载了没有、面板有没有挂载」——排查客户端问题
	 * 时不用打开 devtools。
	 */
	async function handleClientBoot(req, res) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed', '只接受 POST');
		let body;
		try {
			body = await readJsonBody(req);
		} catch (error) {
			return fail(res, 400, 'bad-request', describeError(error));
		}
		const stage = typeof body?.stage === 'string' && body.stage !== '' ? body.stage : 'unknown';
		const filePath = clientBootFilePath();
		let document = {};
		try {
			document = JSON.parse(await readFile(filePath, 'utf8'));
		} catch {
			document = {};
		}
		const entry = {
			at: new Date().toISOString(),
			href: typeof body?.href === 'string' ? body.href : '',
			userAgent: typeof body?.userAgent === 'string' ? body.userAgent.slice(0, 300) : '',
			detail: body?.detail !== null && typeof body?.detail === 'object' ? body.detail : undefined,
		};
		document.stages = document.stages !== null && typeof document.stages === 'object' ? document.stages : {};
		document.stages[stage] = entry;
		const history = Array.isArray(document.history) ? document.history : [];
		history.push({ stage, at: entry.at });
		document.history = history.slice(-40);
		document.version = 1;
		try {
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
			return ok(res, { stage, at: entry.at });
		} catch (error) {
			return fail(res, 500, 'write-failed', describeError(error));
		}
	}

	/* ------------------------ 采集相关路由 ------------------------ */

	async function handleCaptureSources(req, res) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		const cap = await capability();
		const mode = chooseCaptureMode(cap, process.platform);
		if (mode === 'gdi') {
			// GDI 只能拍整个桌面（多显示器是并集），没有"选某个窗口"的概念。
			return ok(res, {
				available: true,
				mode,
				screens: [{ id: 'gdi:virtual', name: '整个桌面（GDI 抓帧）' }],
				windows: [],
			});
		}
		if (mode === 'none') return ok(res, { available: false, mode, reason: cap.reason ?? '', screens: [], windows: [] });
		/**
		 * 只取「有哪些窗口/屏幕」，不取画面。
		 *
		 * 面板用下拉框选源，不需要缩略图；用 0×0 请求可以完全不产生屏幕像素
		 * （列一次源就截一遍所有窗口既慢又没必要）。个别 Electron 版本不接受
		 * 0×0，这时退回小尺寸但**不把图像返回给客户端**。
		 */
		const listSources = async () => {
			try {
				return await cap.desktopCapturer.getSources({
					types: ['screen', 'window'],
					thumbnailSize: { width: 0, height: 0 },
					fetchWindowIcons: false,
				});
			} catch {
				return await cap.desktopCapturer.getSources({
					types: ['screen', 'window'],
					thumbnailSize: { width: 1, height: 1 },
					fetchWindowIcons: false,
				});
			}
		};
		try {
			const sources = await listSources();
			const describe = (item) => ({ id: String(item.id), name: String(item.name ?? '') });
			return ok(res, {
				available: true,
				mode: 'native',
				screens: sources.filter((item) => String(item.id).startsWith('screen:')).map(describe),
				windows: sources.filter((item) => String(item.id).startsWith('window:')).map(describe),
			});
		} catch (error) {
			return ok(res, { available: false, mode: 'native', reason: describeError(error), screens: [], windows: [] });
		}
	}

	async function handleCaptureStart(req, res) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed', '只接受 POST');
		if (!requireRecording(res)) return undefined;
		let body;
		try {
			body = await readJsonBody(req);
		} catch (error) {
			return fail(res, 400, 'bad-request', describeError(error));
		}
		const cap = await capability();
		const mode = chooseCaptureMode(cap, process.platform);
		if (mode === 'none') return fail(res, 409, 'no-native-capture', cap.reason ?? '当前宿主不支持桌面采集');
		const sourceId = typeof body?.sourceId === 'string' ? body.sourceId : '';
		if (mode === 'native' && sourceId === '') return fail(res, 400, 'missing-source', '缺少 sourceId');
		if (current.capture !== null) void current.capture.stop();
		const fps = Number.isFinite(body?.fps) ? Math.max(1, Math.min(15, body.fps)) : captureFps;
		const width = Number.isFinite(body?.width) ? Math.max(320, Math.min(1920, body.width)) : captureWidth;
		const quality = Number.isFinite(body?.quality) ? Math.max(30, Math.min(95, body.quality)) : captureQuality;

		let capture;
		if (mode === 'gdi') {
			// GDI 助手需要一个临时目录与停止文件；都按录制 id 隔离，停完就删。
			const scratch = path.join(os.tmpdir(), 'dsh-incident-studio', current.id);
			capture = new GdiFrameCapture({
				id: current.id,
				fps,
				width,
				quality,
				t0: current.t0,
				scriptPath: path.join(path.dirname(fileURLToPath(import.meta.url)), 'tools', 'grab-frames.ps1'),
				outDir: path.join(scratch, 'frames'),
				stopFile: path.join(scratch, 'stop'),
			});
		} else {
			capture = new FrameCapture({
				capability: cap,
				sourceId,
				fps,
				thumbnailWidth: width,
				quality,
				t0: current.t0,
			});
		}
		current.capture = capture;
		await capture.start();
		if (typeof capture.captureOnce === 'function') await capture.captureOnce();
		ctx.logger?.info?.(`dsh-incident-studio: 抓帧模式 ${mode}（${fps}fps / ${width}px）`);
		return ok(res, { capture: capture.status(), mode });
	}

	async function handleCaptureFrames(req, res, url) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		if (!requireRecording(res)) return undefined;
		if (current.capture === null) return ok(res, { frames: [], capture: null, t0: current.t0 });
		const since = Number.parseInt(url.searchParams.get('since') ?? '0', 10);
		return ok(res, {
			frames: current.capture.framesSince(Number.isFinite(since) ? since : 0),
			capture: current.capture.status(),
			t0: current.t0,
		});
	}

	async function handleCaptureStop(req, res) {
		if (rejected(req)) return fail(res, 403, 'forbidden', '请求被拒绝');
		if (req.method !== 'POST') return fail(res, 405, 'method-not-allowed', '只接受 POST');
		if (!requireRecording(res)) return undefined;
		// 这里等收尾做完：GDI 模式下 stop() 会再收一轮帧、等助手退出、清临时目录，
		// 面板随后那次补拉才能拿到最后几帧，否则掉尾。
		if (current.capture !== null) {
			try {
				await current.capture.stop();
			} catch (error) {
				ctx.logger?.warn?.(`dsh-incident-studio: 停止抓帧时出错 ${describeError(error)}`);
			}
		}
		return ok(res, { capture: current.capture?.status() ?? null });
	}

	/* --------------------------- 路由注册 --------------------------- */

	const routes = [
		[ROUTES.state, (req, res) => handleState(req, res)],
		[ROUTES.profiles, (req, res) => handleProfiles(req, res)],
		[ROUTES.probe, (req, res) => handleProbe(req, res)],
		[ROUTES.start, (req, res) => handleStart(req, res)],
		[ROUTES.stop, (req, res) => handleStop(req, res)],
		[ROUTES.events, (req, res, url) => handleEvents(req, res, url)],
		[ROUTES.input, (req, res, url) => handleInput(req, res, url)],
		[ROUTES.marker, (req, res) => handleMarker(req, res)],
		[ROUTES.ingest, (req, res) => handleIngest(req, res)],
		[ROUTES.artifact, (req, res) => handleArtifact(req, res)],
		[ROUTES.bundle, (req, res) => handleBundle(req, res)],
		[ROUTES.incidents, (req, res, url) => handleIncidents(req, res, url)],
		[ROUTES.open, (req, res) => handleOpen(req, res)],
		[ROUTES.clientBoot, (req, res) => handleClientBoot(req, res)],
		[ROUTES.sources, (req, res) => handleCaptureSources(req, res)],
		[ROUTES.captureStart, (req, res) => handleCaptureStart(req, res)],
		[ROUTES.captureFrames, (req, res, url) => handleCaptureFrames(req, res, url)],
		[ROUTES.captureStop, (req, res) => handleCaptureStop(req, res)],
	];

	for (const [routePath, handler] of routes) {
		ctx.effect(
			() => ctx.webServer.register({
				kind: 'exact',
				path: routePath,
				handler: async (req, res) => {
					const url = new URL(req.url ?? '/', 'http://127.0.0.1');
					try {
						await handler(req, res, url);
					} catch (error) {
						ctx.logger?.warn?.(`dsh-incident-studio: ${routePath} 处理失败 ${describeError(error)}`);
						if (!res.headersSent) fail(res, 500, 'internal-error', describeError(error));
					}
				},
			}),
			`dsh-incident-studio: route ${routePath}`,
		);
	}

	ctx.effect(() => () => {
		if (current !== null) {
			current.stopTails();
			void current.stopInput();
			current.stopCapture();
			current = null;
		}
	}, 'dsh-incident-studio: cleanup');
}

/* ------------------------------------------------------------------ */
/* 零散工具                                                            */
/* ------------------------------------------------------------------ */

function timestampId() {
	const now = new Date();
	const pad = (value) => String(value).padStart(2, '0');
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function formatBytes(bytes) {
	const value = Number(bytes);
	if (!Number.isFinite(value) || value < 0) return '未知大小';
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
	return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function spawnDetached(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { detached: true, stdio: 'ignore' });
		child.once('error', reject);
		child.once('spawn', () => {
			child.unref();
			resolve();
		});
	});
}

export const __internals = {
	formatRelMs,
	safeSlug,
	isInsidePath,
	classifyLevel,
	looksBinary,
	splitBufferLines,
	pickEvenIndices,
	renderBundleMarkdown,
	normalizeProfilesDocument,
	normalizeProfile,
	normalizeSource,
	defaultProfiles,
	chooseCaptureMode,
	normalizeInputConfig,
	normalizeInputTargets,
	inputTargetsList,
	chooseInputMode,
	parseInputRecord,
	inputEventText,
	findInputAnchor,
	formatInputAnchor,
	formatInputDuration,
	summarizeInputs,
	sliceInputs,
	renderInputMarkdown,
	InputRecorder,
	Recording,
	MAX_EVENTS,
	PRE_ROLL_BYTES,
	MAX_LINES_PER_PASS,
	FRAME_MAX_COUNT,
	FRAME_MAX_BYTES,
	MAX_INPUT_EVENTS,
	INPUT_DEFAULT_POLL_MS,
	INPUT_ANCHOR_WINDOW_MS,
};
