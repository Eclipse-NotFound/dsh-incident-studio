// test/run.mjs — 一次跑完主机端、客户端与发布物件的回归测试。
//
// 用法：node test/run.mjs
// 前置：node tools/build-client.mjs（客户端测试跑的是真正会发布的 client.js）
// 真机抓帧是单独的一条：node test/live-capture.mjs（会短暂截屏）

import { summarize, stats } from './harness.mjs';

/** 每套测试的展示名与动态导入。 */
const SUITES = [
	['主机端全链路', './host.test.mjs'],
	['输入记录', './input.test.mjs'],
	['包清单与发布物件', './manifest.test.mjs'],
	['客户端纯函数', './pure.test.mjs'],
	['客户端 apply 集成', './client-apply.test.mjs'],
	['产物编码', './export.test.mjs'],
	['采集链路', './capture.test.mjs'],
	['jsdom 交互', './dom.test.mjs'],
];

const startedAt = Date.now();
for (const [label, specifier] of SUITES) {
	try {
		const { run } = await import(specifier);
		await run();
	} catch (error) {
		stats.failed += 1;
		stats.failures.push(`${label}异常退出：${error?.stack ?? error}`);
	}
}

const passed = summarize('dsh-incident-studio 回归测试');
console.log(`耗时 ${Date.now() - startedAt} ms`);
console.log('真机抓帧（会截屏，单独跑）：node test/live-capture.mjs');
if (!passed) process.exitCode = 1;
