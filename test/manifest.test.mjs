// test/manifest.test.mjs — 包清单与发布物件的形状检查。
//
// 这条测试的由来：`package.json` 曾被 Windows PowerShell 的
// `Set-Content -Encoding utf8` 写出 UTF-8 BOM，于是插件市场读清单时报
// `Unexpected token ' ', "{…" is not valid JSON`——BOM 不是合法 JSON 前缀。
// 任何发布物都不该带 BOM，这里把这条钉死。

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { equal, ok, contains } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

/** 读成字节，判断是否以 UTF-8 BOM 开头。 */
function hasBom(relativePath) {
	const bytes = readFileSync(join(root, relativePath));
	return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

/** 跑清单形状断言。 */
export async function run() {
	// 1) 所有会被宿主/市场读的文本文件都不许带 BOM
	const textFiles = ['package.json', 'cordis.patch.yml', 'index.js', 'client.js', 'README.md', 'README.zh.md', 'CHANGELOG.md', 'LICENSE'];
	for (const file of textFiles) {
		ok(existsSync(join(root, file)), `${file} 存在`);
		equal(hasBom(file), false, `${file} 不带 UTF-8 BOM`);
	}

	// 2) package.json 能被严格 JSON.parse（市场就是这么读的）
	const packageText = readFileSync(join(root, 'package.json'), 'utf8');
	let manifest;
	try {
		manifest = JSON.parse(packageText);
		ok(true, 'package.json 是合法 JSON');
	} catch (error) {
		ok(false, `package.json 解析失败：${error.message}`);
		throw error;
	}
	equal(manifest.name, 'dsh-incident-studio', '包名');
	ok(typeof manifest.version === 'string' && /^\d+\.\d+\.\d+$/u.test(manifest.version), '版本号形状');
	equal(manifest.private, undefined, '不是 private 包（可以发布）');
	ok(typeof manifest.description === 'string' && manifest.description.length > 20, '有可读的 description');
	ok(typeof manifest.engines?.dsh === 'string' && manifest.engines.dsh.includes('0.2.1'), '声明了 engines.dsh');
	ok(manifest.repository?.url?.includes('github.com/Eclipse-NotFound/dsh-incident-studio'), 'repository 指向本仓库');
	ok(Array.isArray(manifest.keywords) && manifest.keywords.includes('dsh-plugin'), 'keywords 含 dsh-plugin');

	// 3) dsh manifest：bundle patch 必须存在，client 入口必须存在
	equal(manifest.dsh?.manifestVersion, 1, 'dsh.manifestVersion');
	equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml', 'dsh.bundle.patch 指向 cordis.patch.yml');
	equal(manifest.dsh?.client?.platform, 'web', 'dsh.client.platform 是 web');
	ok(existsSync(join(root, manifest.dsh.bundle.patch)), 'cordis.patch.yml 真的在仓库里');
	ok(existsSync(join(root, manifest.main)), 'main 入口真的在仓库里');
	ok(existsSync(join(root, 'client.js')), 'client.js 真的在仓库里');

	// 4) bundle patch 里插入的行要能被 loader 用：有 insert 列表、id 与包名一致
	const patchText = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
	contains(patchText, '- insert:', 'cordis.patch.yml 有 insert 列表');
	contains(patchText, 'name: dsh-incident-studio', 'patch 行用包名注册');
	contains(patchText, 'id: incident-studio', 'patch 行有稳定 id');

	// 5) files 白名单要覆盖运行必需的东西（否则 npm 包会缺文件）
	const files = Array.isArray(manifest.files) ? manifest.files : [];
	for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'LICENSE', 'README.md']) {
		ok(files.includes(required), `files 白名单包含 ${required}`);
	}
	for (const shipped of ['index.js', 'client.js', 'cordis.patch.yml']) {
		ok(statSync(join(root, shipped)).size > 0, `${shipped} 非空`);
	}

	// 6) 生成物与源码一致（防止发布一个旧 bundle）
	equal(hasBom('src/vendor/gifenc.js'), false, 'vendored gifenc 不带 BOM');
	contains(readFileSync(join(root, 'src/vendor/gifenc.js'), 'utf8'), 'const GIFENC = (function ()', 'vendored gifenc 是 IIFE 形态');
}
