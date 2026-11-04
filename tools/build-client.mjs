// tools/build-client.mjs — 把 src/client/*.js 拼成单文件浏览器 bundle client.js。
//
// DSH 的客户端插件必须是「一个文件 + window.__ModuleLoader__.load(...)」，
// 不能 import 兄弟模块；这里按固定顺序拼接源码片段，并把 gifenc 的 IIFE 片段
// 插到需要它的位置。改完 src/client 下的文件后重跑本脚本。
//
// 用法：node tools/build-client.mjs [--check]

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const srcDir = resolve(projectRoot, 'src/client');
const outPath = resolve(projectRoot, 'client.js');

/** 拼接顺序：先声明（head）→ 常量与工具 → 采集中间层 → 导出 → UI → 入口收尾。 */
const PARTS = [
	'00-head.js',
	'10-i18n.js',
	'20-css.js',
	'30-http.js',
	'40-pure.js',
	'50-capture.js',
	'@vendor/gifenc.js',
	'60-export.js',
	'70-ui-parts.js',
	'72-ui-settings.js',
	'75-ui-panel.js',
	'90-tail.js',
];

const chunks = [];
for (const part of PARTS) {
	if (part === '@vendor/gifenc.js') {
		const vendorPath = resolve(projectRoot, 'src/vendor/gifenc.js');
		if (!existsSync(vendorPath)) {
			console.error('缺少 src/vendor/gifenc.js —— 先运行 node tools/vendor-gifenc.mjs');
			process.exit(1);
		}
		chunks.push(readFileSync(vendorPath, 'utf8').replace(/\s+$/, ''));
		continue;
	}
	const filePath = resolve(srcDir, part);
	if (!existsSync(filePath)) {
		console.error(`缺少源码片段：${filePath}`);
		process.exit(1);
	}
	chunks.push(readFileSync(filePath, 'utf8').replace(/\s+$/, ''));
}

const output = `${chunks.join('\n\n')}\n`;

if (process.argv.includes('--check')) {
	if (!existsSync(outPath)) {
		console.error('client.js 还不存在');
		process.exit(1);
	}
	const current = readFileSync(outPath, 'utf8');
	if (current !== output) {
		console.error('client.js 与源码不一致，请重新生成');
		process.exit(1);
	}
	console.log('client.js 与源码一致');
	process.exit(0);
}

writeFileSync(outPath, output, 'utf8');

// 语法自检：只解析不执行，能挡住拼接处的括号/逗号错误。
const check = spawnSync(process.execPath, ['--check', outPath], { encoding: 'utf8' });
if (check.status !== 0) {
	console.error('语法检查失败：');
	console.error(check.stderr ?? '');
	process.exit(1);
}

const lines = output.split('\n').length;
console.log(`已生成 client.js（${lines} 行，${(output.length / 1024).toFixed(1)} KB）`);
