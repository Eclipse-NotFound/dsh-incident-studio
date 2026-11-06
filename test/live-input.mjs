// test/live-input.mjs — 真机键鼠助手验证（会真的跑 PowerShell 助手，默认不跑）。
//
// 这条测试不是普通回归：
//   1. `-Probe` 让助手编译/加载互操作程序集（第一次约 0.5-1s，之后走缓存）；
//   2. `-SelfTest` 用合成状态走一遍「比较状态 → 写 JSONL」的路径；
//   3. 真录 ~2.5 秒：检查 ready / focus / stop 三类行，停止文件能让它立刻退出，
//      临时目录收干净。
// 加 `--inject` 时会真的按一下左 Shift（只按 Shift，不产生任何字符），
// 用来证明「真按键确实被抓到」——不加这个开关就完全不碰你的输入。
//
// 用法：node test/live-input.mjs [--inject] [--keep]
//   需要 Windows + Windows PowerShell 5.1；其它平台直接跳过。

import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, equal, contains, lengthOf, summarize, sleep } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, '..', 'tools', 'record-input.ps1');
const keep = process.argv.includes('--keep');
const inject = process.argv.includes('--inject');

/** 起一个不留痕迹的 PowerShell：输出丢弃，只读它写的文件。 */
function startHelper(args) {
	return spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
		windowsHide: true,
		stdio: 'ignore',
	});
}

/** 等进程退出（超时则杀掉）。 */
function waitForExit(child, timeoutMs) {
	return new Promise((resolvePromise) => {
		let timer = null;
		const finish = (code) => {
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
			resolvePromise(code);
		};
		timer = setTimeout(() => {
			try {
				child.kill();
			} catch {
				/* 已经退出 */
			}
			finish(-1);
		}, timeoutMs);
		child.once('exit', (code) => finish(code ?? 0));
	});
}

/** 读 JSONL，坏行算失败。 */
async function readRecords(filePath) {
	const text = await readFile(filePath, 'utf8').catch(() => '');
	const records = [];
	for (const line of text.split(/\r?\n/u)) {
		if (line.trim() === '') continue;
		try {
			records.push(JSON.parse(line));
		} catch {
			records.push({ k: 'unparsable', raw: line.slice(0, 80) });
		}
	}
	return records;
}

/** 轮询等某一行出现。 */
async function waitForRecord(filePath, predicate, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const records = await readRecords(filePath);
		const hit = records.find(predicate);
		if (hit !== undefined) return { hit, records };
		if (Date.now() > deadline) return { hit: null, records };
		await sleep(60);
	}
}

if (process.platform !== 'win32') {
	console.log('跳过：输入助手只有 Windows 版');
} else {
	const workdir = await mkdtemp(path.join(os.tmpdir(), 'dshis-input-live-'));
	try {
		// 1) 探测模式
		const probeFile = path.join(workdir, 'probe.jsonl');
		const probeChild = startHelper(['-Probe', '-Out', probeFile]);
		const probeCode = await waitForExit(probeChild, 60000);
		equal(probeCode, 0, 'Probe 模式退出码 0');
		const probe = (await readRecords(probeFile))[0] ?? null;
		ok(probe !== null, 'Probe 写了回执行');
		if (probe !== null) {
			equal(probe.k, 'ready', 'Probe 回执是 ready 行');
			equal(probe.mode, 'probe', 'Probe 回执标了 probe 模式');
			ok(Number(probe.keys) >= 80, `键位表至少 80 个（实际 ${probe.keys}）`);
			ok(typeof probe.ps === 'string' && probe.ps !== '', '回执带 PowerShell 版本');
			ok(Number(probe.compileMs) >= 0 || probe.cached === 1, '回执说明编译耗时或命中了缓存');
			console.log(`  助手就绪：${probe.keys} 键位，PowerShell ${probe.ps}，compileMs=${probe.compileMs}，cached=${probe.cached}`);
		}

		// 2) 自检模式：合成状态走同一套 diff/emit
		const selfFile = path.join(workdir, 'selftest.jsonl');
		const selfChild = startHelper(['-SelfTest', '-Out', selfFile]);
		const selfCode = await waitForExit(selfChild, 60000);
		equal(selfCode, 0, 'SelfTest 模式退出码 0');
		const selfRecords = await readRecords(selfFile);
		ok(selfRecords.length >= 5, `自检写出足够多的行（${selfRecords.length}）`);
		equal(selfRecords[0]?.k, 'ready', '自检先写 ready');
		equal(selfRecords[1]?.k, 'focus', '自检写了前台事件');
		const selfKinds = selfRecords.map((record) => record.k);
		contains(selfKinds.join(','), 'key', '自检写了按键');
		contains(selfKinds.join(','), 'btn', '自检写了鼠标键');
		const selfReset = selfRecords.find((record) => record.k === 'reset');
		ok(selfReset !== undefined, '自检为仍然按住的鼠标键写了 reset');
		contains((selfReset?.keys ?? []).join(','), 'MouseLeft', 'reset 里列出仍按住的键');
		const selfStop = selfRecords[selfRecords.length - 1];
		equal(selfStop?.k, 'stop', '自检最后写 stop');
		equal(selfStop?.keys, 1, '自检 stop 统计按键次数');
		equal(selfStop?.clicks, 1, '自检 stop 统计点击次数');

		// 3) 真录 ~2.5 秒（-Scope all：不依赖你正在玩哪个游戏）
		const recordFile = path.join(workdir, 'record.jsonl');
		const stopFile = path.join(workdir, 'stop');
		const recordChild = startHelper([
			'-Out', recordFile,
			'-StopFile', stopFile,
			'-PollMs', '20',
			'-MaxSeconds', '60',
			'-Scope', 'all',
			'-TrailHz', '4',
		]);
		const ready = await waitForRecord(recordFile, (record) => record.k === 'ready', 30000);
		ok(ready.hit !== null, '真录模式写出了 ready');
		console.log('  真录中（约 2.5 秒）…');

		let injected = false;
		if (inject) {
			// 只按左 Shift：单独按下不产生字符，抬起就恢复。
			const injectPath = path.join(workdir, 'inject.ps1');
			const injectSource = [
				"$dll = Join-Path $env:LOCALAPPDATA 'dsh-incident-studio\\input-interop-v1.dll'",
				'if (-not (Test-Path -LiteralPath $dll)) { exit 0 }',
				'$null = [System.Reflection.Assembly]::LoadFile($dll)',
				'Add-Type -MemberDefinition \'[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);\' -Name \'Send\' -Namespace \'DshInputProbe\' -ErrorAction SilentlyContinue | Out-Null',
				'try { $null = [DshInputProbe.Send] } catch { exit 0 }',
				'[DshInputProbe.Send]::keybd_event(0xA0, 0, 0, [System.UIntPtr]::Zero)',
				'Start-Sleep -Milliseconds 140',
				'[DshInputProbe.Send]::keybd_event(0xA0, 0, 2, [System.UIntPtr]::Zero)',
				'exit 0',
			].join('\n');
			await writeFile(injectPath, `${injectSource}\n`, 'ascii');
			const injector = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', injectPath], {
				windowsHide: true,
				stdio: 'ignore',
			});
			const injectExit = await waitForExit(injector, 20000);
			injected = injectExit === 0;
			if (!injected) console.log('  注入器不可用（可能是编译被拦），跳过真按键断言');
		}

		await sleep(injected ? 900 : 2400);
		await writeFile(stopFile, 'stop');
		const recordExit = await waitForExit(recordChild, 8000);
		equal(recordExit, 0, '停止文件让助手正常退出（退出码 0）');

		const records = await readRecords(recordFile);
		ok(records.length >= 2, `真录写出了至少 2 行（实际 ${records.length}）`);
		equal(records[0]?.k, 'ready', '第一行是 ready');
		const stopRecord = records[records.length - 1];
		equal(stopRecord?.k, 'stop', '最后一行是 stop');
		equal(stopRecord?.why, 'stopfile', '停止原因记为 stopfile');
		ok(Number(stopRecord?.mergedMs) > 1000, `记录了合并时长（${stopRecord?.mergedMs}ms）`);
		ok(Number(stopRecord?.ticks) > 10, `记录了轮询 tick 数（${stopRecord?.ticks}）`);
		if (Number(stopRecord?.ticks) > 0 && Number(stopRecord?.mergedMs) > 0) {
			const measuredHz = Math.round((stopRecord.ticks / stopRecord.mergedMs) * 1000 * 10) / 10;
			console.log(`  实测采样率：${measuredHz} Hz（请求 ${20}ms 间隔）`);
			ok(measuredHz > 5, '实测采样率合理');
		}
		const focusRecords = records.filter((record) => record.k === 'focus');
		ok(focusRecords.length >= 1, '至少记录了一次前台窗口变化');
		const unparsable = records.filter((record) => record.k === 'unparsable');
		lengthOf(unparsable, 0, '所有行都是合法 JSON');
		if (inject && injected) {
			const keys = records.filter((record) => record.k === 'key' && record.name === 'LShift');
			ok(keys.length >= 2, `抓到了注入的 Shift 按下与抬起（${keys.length} 条）`);
			const down = keys.find((record) => record.d === 1);
			const up = keys.find((record) => record.d === 0);
			ok(down !== undefined && up !== undefined, '按下与抬起都在');
			if (down !== undefined && up !== undefined) {
				ok(up.t > down.t, '抬起晚于按下');
				console.log(`  注入的 Shift 被记录：按下 ${down.t} → 抬起 ${up.t}（${up.t - down.t}ms）`);
			}
		} else {
			console.log('  未开启 --inject：不碰真实键鼠，只验证接线与收尾');
		}

		// 原始文件不应该无限膨胀
		const info = await stat(recordFile);
		ok(info.size > 0, '记录文件非空');
		const perLine = info.size / Math.max(1, records.length);
		console.log(`  记录文件 ${info.size} 字节 / ${records.length} 行（约 ${Math.round(perLine)} 字节一行）`);

		if (keep) console.log(`（保留模式：临时目录 ${workdir} 未删除）`);
	} finally {
		if (!keep) await rm(workdir, { recursive: true, force: true }).catch(() => {});
	}
}

const passed = summarize('键鼠输入助手真机验证');
if (!passed) process.exitCode = 1;
