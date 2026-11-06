// test/input.test.mjs — 输入记录（键鼠）回归：纯函数、假助手全链路、发布物件形状。
//
// 这一套不碰真实的键鼠：真机验证单独跑 `node test/live-input.mjs`。
// 这里用「假的 PowerShell 助手」验证主机侧的解析、按住时长、归档与清理。

import { mkdtemp, mkdir, readFile, writeFile, appendFile, rm, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { __internals } from '../index.js';
import { equal, ok, contains, notContains, lengthOf, sleep } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/**
 * 造一个假助手进程：按脚本往 -Out 写行，看到 -StopFile 就补一行 stop 并退出。
 * @param options.readyLine ready 行。
 * @param options.events 事件行数组（会在 startDelay 之后写入）。
 * @param options.onStop 停止时追加的行。
 * @param options.exitCode 退出码。
 */
function createFakeSpawn(options = {}) {
	const captured = { commands: [], args: [], spawnCount: 0 };
	let poll = null;
	const spawnImpl = (command, args) => {
		captured.spawnCount += 1;
		captured.commands.push(command);
		captured.args.push(args.slice());
		const outFile = args[args.indexOf('-Out') + 1];
		const stopFile = args[args.indexOf('-StopFile') + 1];
		let exitHandler = null;
		let exitCode = null;
		const child = {
			get exitCode() {
				return exitCode;
			},
			kill() {
				finish(1);
			},
			once(name, handler) {
				if (name === 'exit') exitHandler = handler;
				return child;
			},
			unref() {},
		};
		const finish = (code) => {
			if (exitCode !== null) return;
			exitCode = code;
			if (typeof exitHandler === 'function') exitHandler(code);
		};
		void (async () => {
			await mkdir(dirname(outFile), { recursive: true });
			if (typeof options.readyLine === 'string') {
				await appendFile(outFile, `${options.readyLine}\n`, 'utf8');
			}
			for (const line of options.events ?? []) {
				await appendFile(outFile, `${line}\n`, 'utf8');
				if (Number.isFinite(options.gapMs)) await sleep(options.gapMs);
			}
			if (options.exitCode !== undefined) finish(options.exitCode);
		})();
		poll = setInterval(() => {
			if (!existsSync(stopFile)) return;
			clearInterval(poll);
			poll = null;
			void (async () => {
				if (typeof options.onStop === 'string') await appendFile(outFile, `${options.onStop}\n`, 'utf8').catch(() => {});
				finish(options.stopExitCode ?? 0);
			})();
		}, 5);
		if (typeof poll.unref === 'function') poll.unref();
		return child;
	};
	return { spawnImpl, captured };
}

/** 一行 ready（助手真实格式）。 */
function readyLine(overrides = {}) {
	return JSON.stringify({
		t: 1700000000000,
		k: 'ready',
		v: 1,
		mode: 'poll',
		pollMs: 20,
		keys: 108,
		scope: 'target',
		targets: ['remains'],
		exclude: 4242,
		trailHz: 0,
		compileMs: 120,
		cached: 1,
		ps: '5.1',
		...overrides,
	});
}

/** 一行键/鼠标事件。 */
function eventLine(fields) {
	return JSON.stringify({ k: 'key', d: 1, vk: 87, ...fields });
}

/** 跑输入记录相关的全部断言。 */
export async function run() {
	const {
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
		renderBundleMarkdown,
		normalizeProfile,
		normalizeProfilesDocument,
		InputRecorder,
		MAX_INPUT_EVENTS,
	} = __internals;

	// ------------------------- 配置规整 -------------------------
	const defaults = normalizeInputConfig({});
	equal(defaults.enabled, true, '输入默认开启');
	equal(defaults.scope, 'target', '默认只记目标进程前台时');
	equal(defaults.targets, '', '默认没有目标进程');
	equal(defaults.pollMs, 20, '默认采样间隔 20ms');
	equal(defaults.trailHz, 0, '默认不记指针轨迹');

	equal(normalizeInputTargets('Remains.exe, Foo.EXE; bar baz'), 'remains,foo,bar,baz', '目标进程名规整：去 .exe、小写、拆分隔符');
	equal(normalizeInputTargets(['A.exe', 'a', 'B']), 'a,b', '目标进程去重');
	equal(normalizeInputTargets('  ,   ,'), '', '空目标串');
	lengthOf(inputTargetsList('a,b'), 2, '目标串转数组');
	lengthOf(inputTargetsList(''), 0, '空目标串转空数组');
	equal(normalizeInputConfig({ pollMs: 5 }).pollMs, 10, '采样间隔下限夹紧');
	equal(normalizeInputConfig({ pollMs: 999 }).pollMs, 200, '采样间隔上限夹紧');
	equal(normalizeInputConfig({ trailHz: 99 }).trailHz, 15, '指针轨迹上限夹紧');
	equal(normalizeInputConfig({ scope: 'everything' }).scope, 'target', '未知范围回落 target');
	equal(normalizeInputConfig({ scope: 'all' }).scope, 'all', 'all 范围保留');
	equal(normalizeInputConfig({ enabled: false }).enabled, false, '可以关掉输入');

	equal(chooseInputMode('win32'), 'powershell', 'Windows 用 PowerShell 助手');
	equal(chooseInputMode('linux'), 'none', '非 Windows 没有输入能力');

	// ------------------------- 行解析 -------------------------
	const ready = parseInputRecord(readyLine());
	equal(ready.kind, 'ready', '解析 ready');
	equal(ready.keys, 108, 'ready 带键位数量');
	equal(ready.cached, true, 'ready 带缓存标志');
	equal(parseInputRecord(JSON.stringify({ t: 1, k: 'stop', why: 'stopfile', keys: 3, clicks: 1 })).kind, 'stop', '解析 stop');
	equal(parseInputRecord(JSON.stringify({ t: 1, k: 'error', msg: 'boom' })).message, 'boom', '解析 error');
	equal(parseInputRecord(JSON.stringify({ t: 1, k: 'stop' })).summary.keys, 0, 'stop 缺字段补 0');

	const keyDown = parseInputRecord(JSON.stringify({ t: 1790000000123, k: 'key', vk: 87, name: 'W', d: 1 }));
	equal(keyDown.kind, 'key', '解析按键');
	equal(keyDown.down, true, '按下标记');
	equal(keyDown.wall, 1790000000123, '保留墙钟时间');
	const keyUp = parseInputRecord(JSON.stringify({ t: 1790000000500, k: 'key', vk: 87, name: 'W', d: 0 }));
	equal(keyUp.down, false, '抬起标记');

	const button = parseInputRecord(JSON.stringify({ t: 1, k: 'btn', vk: 1, name: 'MouseLeft', d: 1, x: 812, y: 640 }));
	equal(button.kind, 'button', '鼠标事件归到 button');
	equal(button.x, 812, '鼠标事件带坐标');
	equal(button.y, 640, '鼠标事件带坐标 y');

	const focus = parseInputRecord(JSON.stringify({ t: 1, k: 'focus', in: 1, pid: 9, proc: 'Remains' }));
	equal(focus.kind, 'focus', '解析前台切换');
	equal(focus.inScope, true, '前台切换带是否在范围');

	const reset = parseInputRecord(JSON.stringify({ t: 1, k: 'reset', keys: ['W', 'Space'] }));
	lengthOf(reset.keys, 2, '解析失焦释放');

	equal(parseInputRecord(JSON.stringify({ t: 1, k: 'move', x: 5, y: 6 })).x, 5, '解析指针轨迹');
	equal(parseInputRecord('not json'), null, '坏行返回 null');
	equal(parseInputRecord(''), null, '空行返回 null');
	equal(parseInputRecord(JSON.stringify({ k: 'key', name: 'W', d: 1 })), null, '缺时间戳的行丢弃');
	equal(parseInputRecord(JSON.stringify({ t: 1, k: 'mystery' })), null, '未知类型返回 null');
	equal(parseInputRecord(JSON.stringify({ t: 1, k: 'key', d: 1 })), null, '缺键名的按键丢弃');

	// ------------------------- 文本 -------------------------
	equal(inputEventText({ kind: 'key', name: 'Space', down: true }), 'Space ↓', '按键按下文本');
	equal(inputEventText({ kind: 'key', name: 'Space', down: false, ms: 140 }), 'Space ↑ (0.14s)', '按键抬起带按住时长');
	equal(inputEventText({ kind: 'button', name: 'MouseLeft', down: true, x: 10, y: 20 }), 'MouseLeft ↓ @10,20', '鼠标按下带坐标');
	equal(inputEventText({ kind: 'button', name: 'MouseLeft', down: false, ms: 90 }), 'MouseLeft ↑ (0.09s)', '鼠标抬起带时长');
	equal(inputEventText({ kind: 'focus', inScope: true, proc: 'remains' }), 'focus: remains', '前台事件文本');
	equal(inputEventText({ kind: 'focus', inScope: false, proc: 'other' }), 'blur: other', '失焦事件文本');
	equal(inputEventText({ kind: 'reset', keys: ['W', 'Space'] }), 'blur-release: W, Space', '失焦释放文本');
	equal(inputEventText({ kind: 'move', x: 3, y: 4 }), '3,4', '指针轨迹文本');
	equal(formatInputDuration(1234), '1.23s', '时长格式化');

	// ------------------------- 打点锚点 -------------------------
	const anchorInputs = [
		{ seq: 0, kind: 'focus', inScope: true, proc: 'remains', relMs: 100, wall: 100, text: 'focus: remains' },
		{ seq: 1, kind: 'key', name: 'W', down: true, relMs: 1000, wall: 1000, text: 'W ↓' },
		{ seq: 2, kind: 'key', name: 'W', down: false, relMs: 1400, wall: 1400, ms: 400, text: 'W ↑ (0.40s)' },
		{ seq: 3, kind: 'key', name: 'Space', down: true, relMs: 1800, wall: 1800, text: 'Space ↓' },
	];
	const anchor = findInputAnchor(anchorInputs, 1920);
	equal(anchor.name, 'Space', '锚点取最近按下的键');
	equal(anchor.deltaMs, 120, '锚点记下离打点多远');
	equal(findInputAnchor(anchorInputs, 1600).name, 'W', '锚点跳过抬起事件，找按下');
	equal(findInputAnchor(anchorInputs, 9000), null, '太久以前不锚');
	equal(findInputAnchor([], 100), null, '没有输入时不锚');
	contains(formatInputAnchor(anchor), 'Space ↓', '锚点描述带键名');
	contains(formatInputAnchor(anchor), '0.12s 前', '锚点描述带时间差');

	// ------------------------- 统计 -------------------------
	const stats = summarizeInputs([
		{ relMs: 0, kind: 'focus', inScope: true, proc: 'remains' },
		{ relMs: 100, kind: 'key', name: 'W', down: true },
		{ relMs: 500, kind: 'key', name: 'W', down: false },
		{ relMs: 600, kind: 'key', name: 'W', down: true },
		{ relMs: 900, kind: 'key', name: 'W', down: false },
		{ relMs: 950, kind: 'button', name: 'MouseLeft', down: true, x: 1, y: 2 },
		{ relMs: 1050, kind: 'button', name: 'MouseLeft', down: false },
		{ relMs: 1100, kind: 'key', name: 'Space', down: true },
		{ relMs: 1200, kind: 'reset', keys: ['Space'] },
	]);
	equal(stats.keyDowns, 3, '统计按下次数');
	equal(stats.keyUps, 2, '统计抬起次数');
	equal(stats.clicks, 1, '统计点击次数');
	equal(stats.focus, 1, '统计前台切换');
	equal(stats.resets, 1, '统计失焦释放');
	equal(stats.perKey[0].name, 'W', '按得最多的键');
	equal(stats.perKey[0].downs, 2, '按键次数');
	equal(stats.perKey[0].ms, 700, '按键累计按住时长');
	equal(stats.holds[0].name, 'W', '最长按住是 W');
	equal(stats.holds[0].ms, 400, '按住时长 400ms');
	equal(stats.holds.length, 3, '三次完整的按住都记下来（失焦释放那次不算）');
	ok(stats.holds.every((hold) => hold.name !== 'Space'), '失焦释放的半次不计入按住时长');
	equal(stats.firstRel, 0, '统计首条时间');
	equal(stats.lastRel, 1200, '统计末条时间');

	lengthOf(sliceInputs(anchorInputs, 1000, 1800), 3, '区间切片含首尾');

	// ------------------------- Markdown -------------------------
	const config = { enabled: true, scope: 'target', targets: 'remains', pollMs: 20, trailHz: 0 };
	const inputMd = renderInputMarkdown({
		inputs: anchorInputs,
		config,
		markers: [{ relMs: 1900, label: '问题点', anchor: { kind: 'key', name: 'Space', relMs: 1800, deltaMs: 100 } }],
	}).join('\n');
	contains(inputMd, '## 输入记录', 'bundle 有输入段');
	contains(inputMd, '间隔 20ms', 'bundle 写明采样间隔');
	contains(inputMd, 'remains', 'bundle 写明目标进程');
	contains(inputMd, '不记录任何文字内容', 'bundle 写明隐私边界');
	contains(inputMd, '打点前后的输入', 'bundle 有打点窗口');
	contains(inputMd, '前一条输入：Space ↓ 0.10s 前', 'bundle 带打点锚点');
	contains(inputMd, '完整输入流', 'bundle 有完整输入流');
	contains(inputMd, 'Space ↓', 'bundle 列出按键');

	const emptyMd = renderInputMarkdown({ inputs: [], config }).join('\n');
	contains(emptyMd, '没有记录到键鼠事件', '没有输入时也写一段说明');
	const measuredMd = renderInputMarkdown({ inputs: anchorInputs, config, measuredHz: 31.4 }).join('\n');
	contains(measuredMd, '实测约 31 Hz', 'bundle 用助手报告的实测采样率');

	const bigInputs = Array.from({ length: 10 }, (_, index) => ({ relMs: index * 10, kind: 'key', name: 'W', down: index % 2 === 0 }));
	const cappedMd = renderInputMarkdown({ inputs: bigInputs, config, fullLimit: 4 }).join('\n');
	contains(cappedMd, '这里只列前 4 条', '完整输入流按上限截断');
	contains(cappedMd, 'input.jsonl', '截断时指向原始文件');

	// ------------------------- bundle 组装 -------------------------
	const bundle = renderBundleMarkdown({
		title: 'T',
		fromRel: 0,
		toRel: 2000,
		events: [{ seq: 0, src: 'log', level: 'info', text: 'hello', relMs: 10, pre: false, marker: '' }],
		inputInfo: '按键 3 次按下',
		inputLines: ['## 输入记录', '', '- 测试行'],
	});
	contains(bundle, '**输入记录**：按键 3 次按下', '一句话统计进头部');
	contains(bundle, '- 测试行', '输入段插进纪要');
	ok(bundle.indexOf('事件流') < bundle.indexOf('## 输入记录'), '输入段排在事件流之后');

	// ------------------------- profile 带上输入配置 -------------------------
	const profile = normalizeProfile({ id: 'p', name: 'n', input: { targets: 'Remains.exe', scope: 'all' } });
	equal(profile.input.targets, 'remains', 'profile 保存目标进程');
	equal(profile.input.scope, 'all', 'profile 保存记录范围');
	const doc = normalizeProfilesDocument({ profiles: [{ id: 'p', input: { trailHz: 5 } }] });
	equal(doc.profiles[0].input.trailHz, 5, 'profiles 文档保留输入设置');

	// ------------------------- InputRecorder + 假助手 -------------------------
	const workdir = await mkdtemp(path.join(os.tmpdir(), 'dshis-input-test-'));
	try {
		const outDir = path.join(workdir, 'scratch', 'in');
		const stopFile = path.join(workdir, 'scratch', 'stop');
		const archivePath = path.join(workdir, 'incident', 'input.jsonl');
		const t0 = 1700000000000;
		const fake = createFakeSpawn({
			readyLine: readyLine({ t: t0 + 100 }),
			events: [
				eventLine({ t: t0 + 200, k: 'focus', in: 1, pid: 99, proc: 'remains' }),
				eventLine({ t: t0 + 300, vk: 87, name: 'W', d: 1 }),
				eventLine({ t: t0 + 700, vk: 87, name: 'W', d: 0 }),
				eventLine({ t: t0 + 800, k: 'btn', vk: 1, name: 'MouseLeft', d: 1, x: 400, y: 300 }),
				eventLine({ t: t0 + 900, k: 'btn', vk: 1, name: 'MouseLeft', d: 1, x: 401, y: 301 }),
			],
			onStop: eventLine({ t: t0 + 1200, k: 'stop', why: 'stopfile', keys: 1, clicks: 2 }),
		});
		const emitted = [];
		const recorder = new InputRecorder({
			id: 'rec-1',
			t0,
			config: { enabled: true, scope: 'target', targets: 'Remains.exe', pollMs: 20 },
			scriptPath: path.join(root, 'tools', 'record-input.ps1'),
			outDir,
			stopFile,
			archivePath,
			excludePid: 4242,
			spawnImpl: fake.spawnImpl,
			startDelayMs: 30,
			emit: (event) => emitted.push(event),
		});
		await recorder.start();
		const args = fake.captured.args[0];
		equal(fake.captured.commands[0], 'powershell.exe', '用 powershell 启动助手');
		contains(args.join(' '), '-File', '助手参数带 -File');
		contains(args.join(' '), '-PollMs 20', '助手参数带采样间隔');
		contains(args.join(' '), '-Targets remains', '助手参数带目标进程');
		contains(args.join(' '), '-ExcludePid 4242', '助手参数带要排除的宿主进程');
		contains(args.join(' '), '-ExcludeNames', '助手参数带要排除的宿主进程名');
		contains(args.join(' '), '-StopFile', '助手参数带停止文件');

		await sleep(80);
		await recorder.pump();
		const status = recorder.status();
		equal(status.ready, true, '收到 ready 后状态为就绪');
		equal(status.armed, true, '助手已拉起');
		equal(status.counts.keys, 1, '统计到 1 次按键');
		equal(status.counts.clicks, 2, '统计到 2 次鼠标按下');
		equal(status.counts.focus, 1, '统计到 1 次前台切换');
		lengthOf(status.heldButtons, 1, '状态里带着按住的鼠标键');
		const wUp = emitted.find((event) => event.kind === 'key' && event.down === false);
		equal(wUp.ms, 400, '抬起事件带上按住时长');
		equal(emitted[0].text, 'focus: remains', '事件带显示文本');
		equal(recorder.status().lastEvent.name, 'MouseLeft', '状态记录最后一条事件');

		await recorder.stop();
		equal(existsSync(archivePath), true, '停止时把原始 JSONL 归档到取证目录');
		const archived = await readFile(archivePath, 'utf8');
		contains(archived, '"k":"ready"', '归档保留 ready 行');
		contains(archived, '"k":"stop"', '归档保留 stop 行');
		equal(existsSync(outDir), false, '停止后清掉临时目录');
		equal(recorder.status().running, false, '停止后 running 为假');

		// 录制对象：relMs 与 seq
		const { Recording } = __internals;
		const recording = new Recording({ id: 'r2', t0: 1000, sources: [], cwd: workdir, inputConfig: {} });
		const stored = recording.addInput({ kind: 'key', name: 'A', down: true, wall: 1500, text: 'A ↓' });
		equal(stored.seq, 0, '输入事件带自增 seq');
		equal(stored.relMs, 500, '输入事件换算成相对时间');
		equal(recording.snapshot().inputCount, 1, '快照带输入条数');
		equal(recording.snapshot().input.events, 0, '没有助手时输入快照也有形状');
		ok(MAX_INPUT_EVENTS >= 1000, '输入事件上限至少 1000');

		const anchorFromRecording = new Recording({ id: 'r3', t0: 0, sources: [], cwd: workdir, inputConfig: {} });
		anchorFromRecording.addInput({ kind: 'key', name: 'F', down: true, wall: 900, text: 'F ↓' });
		const found = anchorFromRecording.inputAnchor(1000);
		equal(found.name, 'F', '录制对象能按墙钟找到锚点');
		equal(found.deltaMs, 100, '锚点时间差按录制起点换算');

		// 助手报错：状态里能看见
		const failing = createFakeSpawn({
			readyLine: JSON.stringify({ t: 1, k: 'error', msg: 'interop unavailable: denied' }),
		});
		const failingRecorder = new InputRecorder({
			id: 'rec-2',
			t0: 0,
			config: { enabled: true, scope: 'all' },
			scriptPath: path.join(root, 'tools', 'record-input.ps1'),
			outDir: path.join(workdir, 'scratch2', 'in'),
			stopFile: path.join(workdir, 'scratch2', 'stop'),
			archivePath: '',
			spawnImpl: failing.spawnImpl,
			startDelayMs: 20,
		});
		await failingRecorder.start();
		await sleep(40);
		await failingRecorder.pump();
		contains(failingRecorder.status().error, 'interop unavailable', '助手报错进状态');
		await failingRecorder.stop();
	} finally {
		await rm(workdir, { recursive: true, force: true }).catch(() => {});
	}

	// ------------------------- 发布物件形状 -------------------------
	const ps1Path = path.join(root, 'tools', 'record-input.ps1');
	const csPath = path.join(root, 'tools', 'input-interop.cs');
	ok(existsSync(ps1Path), 'record-input.ps1 在仓库里');
	ok(existsSync(csPath), 'input-interop.cs 在仓库里');
	for (const [file, filePath] of [['record-input.ps1', ps1Path], ['input-interop.cs', csPath]]) {
		const bytes = readFileSync(filePath);
		equal(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, false, `${file} 不带 BOM`);
		let nonAscii = 0;
		for (const byte of bytes) if (byte > 126) nonAscii += 1;
		equal(nonAscii, 0, `${file} 全是 ASCII（Windows PowerShell 5.1 按 ANSI 读脚本）`);
		ok((await stat(filePath)).size > 500, `${file} 非空`);
	}
	const ps1Text = readFileSync(ps1Path, 'utf8');
	for (const flag of ['-Out', '-StopFile', '-PollMs', '-MaxSeconds', '-Scope', '-Targets', '-ExcludePid', '-ExcludeNames', '-TrailHz', '-Probe', '-SelfTest']) {
		contains(ps1Text, flag, `record-input.ps1 支持 ${flag}`);
	}
	contains(ps1Text, 'input-interop.cs', '助手从输入互操作源码编译');
	notContains(ps1Text, 'SetWindowsHookEx', '助手不装键盘钩子（不用 keylogger 那套）');
	contains(ps1Text, 'GetAsyncKeyState', '助手用状态轮询');
	const csText = readFileSync(csPath, 'utf8');
	contains(csText, 'public static class InputInterop', '互操作类是稳定名字');
	contains(csText, 'ReadState()', '互操作暴露批量读状态');
	contains(csText, 'ForegroundPid()', '互操作暴露前台进程');
	contains(csText, 'MouseButtonStart', '互操作标出鼠标键起点');
	contains(csText, 'GetSystemTimePreciseAsFileTime', '互操作用精确时钟');
	const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
	ok(Array.isArray(manifest.files) && manifest.files.includes('tools'), 'files 白名单包含 tools（助手要随包发布）');
}
