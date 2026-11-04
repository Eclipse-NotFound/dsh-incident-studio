// test/harness.mjs — 极简断言与统计（不引第三方测试框架）。

/** 全局统计。 */
export const stats = { passed: 0, failed: 0, failures: [] };

/**
 * 断言真值。
 * @param value 待检查值。
 * @param label 断言说明。
 */
export function ok(value, label) {
	if (value === true || (value !== false && value !== null && value !== undefined && value !== 0 && value !== '')) {
		stats.passed += 1;
		return;
	}
	stats.failed += 1;
	stats.failures.push(`${label}（期望真值，实际 ${JSON.stringify(value)}）`);
}

/**
 * 断言相等。
 * @param actual 实际值。
 * @param expected 期望值。
 * @param label 断言说明。
 */
export function equal(actual, expected, label) {
	if (Object.is(actual, expected)) {
		stats.passed += 1;
		return;
	}
	stats.failed += 1;
	stats.failures.push(`${label}（期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}）`);
}

/**
 * 断言包含。
 * @param haystack 被搜索的文本。
 * @param needle 子串。
 * @param label 断言说明。
 */
export function contains(haystack, needle, label) {
	if (typeof haystack === 'string' && haystack.includes(needle)) {
		stats.passed += 1;
		return;
	}
	stats.failed += 1;
	stats.failures.push(`${label}（文本里找不到 ${JSON.stringify(needle)}）`);
}

/** 断言不包含。 */
export function notContains(haystack, needle, label) {
	if (typeof haystack === 'string' && !haystack.includes(needle)) {
		stats.passed += 1;
		return;
	}
	stats.failed += 1;
	stats.failures.push(`${label}（文本里不该出现 ${JSON.stringify(needle)}）`);
}

/** 断言数组长度。 */
export function lengthOf(list, expected, label) {
	equal(Array.isArray(list) ? list.length : -1, expected, label);
}

/** 打印一份小结并返回是否全绿。 */
export function summarize(title) {
	const total = stats.passed + stats.failed;
	if (stats.failed === 0) {
		console.log(`✔ ${title}：${total} 项断言全部通过`);
		return true;
	}
	console.log(`✘ ${title}：${stats.passed}/${total} 通过，${stats.failed} 项失败`);
	for (const failure of stats.failures) console.log(`   · ${failure}`);
	return false;
}

/** 等一会儿（跟随类断言需要让出事件循环）。 */
export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
