// tools/vendor-gifenc.mjs — 把 node_modules/gifenc 的 ESM 构建转成可内联的 IIFE 片段。
//
// 为什么需要：DSH 客户端插件是一个单文件 bundle（window.__ModuleLoader__.load），
// 不能 import 外部模块，也不能用 ESM 语法。gifenc 只发布 ESM/UMD 两种产物，
// 这里把 ESM 的 `export{...}` 尾巴改写成 `return {...}`，外面套一层 IIFE。
//
// 用法：node tools/vendor-gifenc.mjs  →  生成 src/vendor/gifenc.js
// 升级：npm i --no-save gifenc@<version> 后重跑本脚本，并更新下面的版本号注释。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const esmPath = resolve(projectRoot, 'node_modules/gifenc/dist/gifenc.esm.js');
const licensePath = resolve(projectRoot, 'node_modules/gifenc/LICENSE.md');
const outPath = resolve(projectRoot, 'src/vendor/gifenc.js');

/** 需要暴露的导出名（其余如 default / nearestColor 用不到，剔除以减体积）。 */
const WANTED = new Set(['GIFEncoder', 'quantize', 'applyPalette', 'prequantize']);

const source = readFileSync(esmPath, 'utf8');
const exportIndex = source.lastIndexOf('export{');
if (exportIndex < 0) throw new Error('gifenc 产物里找不到 export{ —— 版本结构变了，需要手工处理');

const body = source.slice(0, exportIndex);
const closing = source.indexOf('}', exportIndex);
const spec = source.slice(exportIndex + 'export{'.length, closing);

const pairs = spec
	.split(',')
	.map((entry) => entry.trim())
	.filter((entry) => entry !== '')
	.map((entry) => {
		const match = /^(\S+)\s+as\s+(\S+)$/.exec(entry);
		return match === null ? [entry, entry] : [match[2], match[1]];
	});

const exported = pairs.filter(([publicName]) => WANTED.has(publicName));
if (exported.length !== WANTED.size) {
	throw new Error(`gifenc 导出的名字对不上：拿到 ${exported.map(([name]) => name).join(', ')}`);
}

let version = 'unknown';
try {
	const gifencPackage = JSON.parse(readFileSync(resolve(projectRoot, 'node_modules/gifenc/package.json'), 'utf8'));
	if (typeof gifencPackage.version === 'string') version = gifencPackage.version;
} catch {
	/* 版本号只是注释，读不到不影响生成 */
}

const license = readFileSync(licensePath, 'utf8')
	.split('\n')
	.map((line) => `// ${line}`)
	.join('\n');

const output = `// 本文件由 tools/vendor-gifenc.mjs 自动生成，不要手工编辑。
// 来源：gifenc@${version}（https://github.com/mattdesl/gifenc），MIT 许可，原文如下。
${license}
//
// 只保留 GIFEncoder / quantize / applyPalette / prequantize，供现场取证台在浏览器内
// 把截取区间编码成动图 GIF（不依赖任何外部程序）。
const GIFENC = (function () {
${body}
return { ${exported.map(([publicName, localName]) => `${publicName}: ${localName}`).join(', ')} };
})();
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, output, 'utf8');
console.log(`已生成 ${outPath}（gifenc@${version}，${(output.length / 1024).toFixed(1)} KB）`);
