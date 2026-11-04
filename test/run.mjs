// test/run.mjs — 一次跑完主机端与客户端回归测试。
//
// 用法：node test/run.mjs
// 前置：node tools/build-client.mjs（客户端测试跑的是真正会发布的 client.js）

import { summarize, stats } from './harness.mjs';

let fatal = null;

async function runHost() {
	const { run } = await import('./host.test.mjs');
	await run();
}

async function runPure() {
	const { run } = await import('./pure.test.mjs');
	await run();
}

async function runClientApply() {
	const { run } = await import('./client-apply.test.mjs');
	await run();
}

async function runExport() {
	const { run } = await import('./export.test.mjs');
	await run();
}

async function runCapture() {
	const { run } = await import('./capture.test.mjs');
	await run();
}

async function runDom() {
	const { run } = await import('./dom.test.mjs');
	await run();
}

const startedAt = Date.now();
try {
	await runHost();
} catch (error) {
	fatal = `主机端测试异常退出：${error?.stack ?? error}`;
	stats.failed += 1;
	stats.failures.push(fatal);
}

try {
	await runPure();
} catch (error) {
	fatal = `客户端纯函数测试异常退出：${error?.stack ?? error}`;
	stats.failed += 1;
	stats.failures.push(fatal);
}

try {
	await runClientApply();
} catch (error) {
	fatal = `客户端集成测试异常退出：${error?.stack ?? error}`;
	stats.failed += 1;
	stats.failures.push(fatal);
}

try {
	await runExport();
} catch (error) {
	fatal = `产物编码测试异常退出：${error?.stack ?? error}`;
	stats.failed += 1;
	stats.failures.push(fatal);
}

try {
	await runCapture();
} catch (error) {
	fatal = `采集链路测试异常退出：${error?.stack ?? error}`;
	stats.failed += 1;
	stats.failures.push(fatal);
}

try {
	await runDom();
} catch (error) {
	fatal = `DOM 交互测试异常退出：${error?.stack ?? error}`;
	stats.failed += 1;
	stats.failures.push(fatal);
}

const passed = summarize('dsh-incident-studio 回归测试');
console.log(`耗时 ${Date.now() - startedAt} ms`);
if (!passed) process.exitCode = 1;
