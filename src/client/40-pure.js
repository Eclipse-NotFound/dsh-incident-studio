		/* ------------------------------------------------------------------ */
		/* 纯函数（无 DOM、无副作用；同时通过 __pure 暴露给本地测试）          */
		/* ------------------------------------------------------------------ */

		/**
		 * 把毫秒偏移格式化成 00:12.345。
		 * @param ms 相对毫秒（可为负，表示录制前）。
		 * @returns 时钟样式文本。
		 */
		function formatRel(ms) {
			const value = Number.isFinite(ms) ? ms : 0;
			const sign = value < 0 ? '-' : '';
			const abs = Math.abs(Math.round(value));
			const minutes = Math.floor(abs / 60000);
			const seconds = Math.floor((abs % 60000) / 1000);
			const millis = abs % 1000;
			return `${sign}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
		}

		/** 秒数格式化成 4.4s。 */
		function formatSeconds(ms) {
			return `${(Math.max(0, ms) / 1000).toFixed(1)}${t('unit.s')}`;
		}

		/** 字节数的可读形式。 */
		function humanBytes(bytes) {
			const value = Number(bytes);
			if (!Number.isFinite(value) || value < 0) return '—';
			if (value < 1024) return `${Math.round(value)} B`;
			if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
			return `${(value / 1024 / 1024).toFixed(1)} MB`;
		}

		/** 数值夹取。 */
		function clampNumber(value, min, max) {
			const n = Number.isFinite(value) ? value : min;
			return Math.min(max, Math.max(min, n));
		}

		/**
		 * 事件级别分类（与主机端同一套规则，供本地筛选兜底）。
		 * @param text 一行文本。
		 * @returns 'error' | 'warn' | 'info'。
		 */
		function classifyLevel(text) {
			const line = String(text ?? '');
			if (/#(?:1[0-9]{3}|2[0-9]{3})\b/.test(line)) return 'error';
			if (/\b(?:error|exception|fatal|failed|failure|traceback)\b/i.test(line)) return 'error';
			if (/\b[A-Za-z]+(?:Error|Exception)\b/.test(line)) return 'error';
			if (/\b(?:warn|warning|deprecated|retry|timed out)\b/i.test(line)) return 'warn';
			return 'info';
		}

		/** 帧相对录制起点的时间。 */
		function frameRel(frame, t0) {
			if (frame === null || frame === undefined) return 0;
			return Math.round(frame.wall - t0);
		}

		/**
		 * 在帧序列里找最接近 relMs 的一帧。
		 * @returns 下标；空序列返回 -1。
		 */
		function nearestFrameIndex(frames, relMs, t0) {
			if (!Array.isArray(frames) || frames.length === 0) return -1;
			let best = 0;
			let bestDistance = Infinity;
			for (let index = 0; index < frames.length; index += 1) {
				const distance = Math.abs(frameRel(frames[index], t0) - relMs);
				if (distance < bestDistance) {
					bestDistance = distance;
					best = index;
				}
			}
			return best;
		}

		/** 取区间内的帧（闭区间）。 */
		function framesInRange(frames, fromRel, toRel, t0) {
			if (!Array.isArray(frames)) return [];
			return frames.filter((frame) => {
				const rel = frameRel(frame, t0);
				return rel >= fromRel && rel <= toRel;
			});
		}

		/**
		 * 按区间 / 级别 / 关键词筛事件。
		 * @param events 全量事件。
		 * @param options 过滤条件。
		 * @returns 过滤后的事件（保持时间序）。
		 */
		function selectEvents(events, options) {
			const list = Array.isArray(events) ? events : [];
			const from = Number.isFinite(options?.fromRel) ? options.fromRel : -Infinity;
			const to = Number.isFinite(options?.toRel) ? options.toRel : Infinity;
			const onlyProblems = options?.onlyProblems === true;
			const query = typeof options?.query === 'string' ? options.query.trim().toLowerCase() : '';
			return list.filter((event) => {
				if (Number.isFinite(event?.relMs) && (event.relMs < from || event.relMs > to)) return false;
				const level = event?.level ?? classifyLevel(event?.text);
				if (onlyProblems && level !== 'error' && level !== 'warn' && (event?.marker ?? '') === '') return false;
				if (query !== '' && !String(event?.text ?? '').toLowerCase().includes(query)) return false;
				return true;
			});
		}

		/**
		 * 从 n 个里等距取 count 个下标（含首尾）。
		 * @returns 下标数组。
		 */
		function pickEvenIndices(total, count) {
			const n = Math.max(0, Math.floor(total));
			const c = Math.max(1, Math.floor(count));
			if (n <= 0) return [];
			if (n <= c) return Array.from({ length: n }, (_, index) => index);
			if (c === 1) return [0];
			const result = [];
			for (let index = 0; index < c; index += 1) result.push(Math.round((index * (n - 1)) / (c - 1)));
			return Array.from(new Set(result));
		}

		/* ------------------------- 输入记录（纯函数） ------------------------- */

		/**
		 * 输入事件按区间筛选（闭区间）。
		 * @param inputs 输入事件。
		 * @param fromRel 起点。
		 * @param toRel 终点。
		 * @returns 区间内的事件。
		 */
		function filterInputs(inputs, fromRel, toRel) {
			const list = Array.isArray(inputs) ? inputs : [];
			const from = Number.isFinite(fromRel) ? fromRel : -Infinity;
			const to = Number.isFinite(toRel) ? toRel : Infinity;
			return list.filter((event) => {
				const rel = Number.isFinite(event?.relMs) ? event.relMs : 0;
				return rel >= from && rel <= to;
			});
		}

		/**
		 * 输入事件计数（复看态头部与递交正文共用）。
		 * @param inputs 输入事件。
		 * @returns {{keys:number,clicks:number,focus:number,moves:number,resets:number,total:number}}
		 */
		function countInputs(inputs) {
			const list = Array.isArray(inputs) ? inputs : [];
			const counts = { keys: 0, clicks: 0, focus: 0, moves: 0, resets: 0, total: list.length };
			for (const event of list) {
				if (event === null || typeof event !== 'object') continue;
				if (event.kind === 'key' && event.down === true) counts.keys += 1;
				else if (event.kind === 'button' && event.down === true) counts.clicks += 1;
				else if (event.kind === 'focus') counts.focus += 1;
				else if (event.kind === 'move') counts.moves += 1;
				else if (event.kind === 'reset') counts.resets += 1;
			}
			return counts;
		}

		/** 输入事件在列表里的符号（键/鼠标/前台/轨迹/失焦释放）。 */
		function inputSymbol(kind) {
			if (kind === 'key') return '⌨';
			if (kind === 'button') return '🖱';
			if (kind === 'focus') return '▸';
			if (kind === 'move') return '·';
			if (kind === 'reset') return '⤺';
			return '•';
		}

		/**
		 * 打点锚点的一句话（面板与递交正文共用）。
		 * @param anchor 主机给的锚点。
		 * @returns 空串（没有锚点）或「前一条输入：Space ↓ 0.12s 前」。
		 */
		function describeAnchor(anchor) {
			if (anchor === null || typeof anchor !== 'object' || typeof anchor.name !== 'string') return '';
			const delta = Number.isFinite(anchor.deltaMs) ? (anchor.deltaMs / 1000).toFixed(2) : '0.00';
			const where = anchor.kind === 'button' && Number.isFinite(anchor.x) ? ` @${anchor.x},${anchor.y}` : '';
			return t('review.input.anchor', { name: `${anchor.name} ↓`, where, delta });
		}

		/**
		 * 输入摘要的一句话：「3 按键 · 1 点击」。
		 * @param inputs 输入事件。
		 * @returns 摘要文本。
		 */
		function inputSummaryText(inputs) {
			const counts = countInputs(inputs);
			const parts = [
				t('rec.input.keys', { n: counts.keys }),
				t('rec.input.clicks', { n: counts.clicks }),
			];
			if (counts.focus > 0) parts.push(`${counts.focus} ▸`);
			return parts.join(' · ');
		}

		/**
		 * 长日志的抽样：错误、打点、区间两个端点优先，其余等距补足。
		 * @param events 已按区间筛过的事件。
		 * @param limit 上限行数。
		 * @returns 精简后的事件（按时间序）。
		 */
		function sampleEventsForPrompt(events, limit) {
			const list = Array.isArray(events) ? events : [];
			const cap = Math.max(4, Math.floor(limit ?? 80));
			if (list.length <= cap) return list.slice();
			const priority = new Set();
			for (let index = 0; index < list.length; index += 1) {
				const event = list[index];
				const level = event?.level ?? classifyLevel(event?.text);
				if (level === 'error' || (event?.marker ?? '') !== '') priority.add(index);
			}
			// 两端各保留一条，让模型知道切片的边界。
			priority.add(0);
			priority.add(list.length - 1);
			const ordered = Array.from(priority).sort((left, right) => left - right);
			if (ordered.length >= cap) return ordered.slice(0, cap).map((index) => list[index]);
			const selected = new Set(ordered);
			const rest = [];
			for (let index = 0; index < list.length; index += 1) if (!selected.has(index)) rest.push(index);
			const picks = pickEvenIndices(rest.length, cap - selected.size);
			for (const pick of picks) selected.add(rest[pick]);
			return Array.from(selected).sort((left, right) => left - right).map((index) => list[index]);
		}

		/**
		 * 组装给 Agent 的正文（填进 composer 的那段）。
		 * 保持紧凑：完整明细在 bundle.md，这里给结论 + 证据 + 可读的日志切片。
		 * @returns Markdown 文本。
		 */
		function buildDeliveryText(input) {
			const {
				title = '',
				description = '',
				bundlePath = '',
				dir = '',
				fromRel = 0,
				toRel = 0,
				events = [],
				annotations = [],
				artifacts = [],
				frameCount = 0,
				lineLimit = 80,
				inputInfo = '',
			} = input ?? {};
			const lines = [];
			lines.push(`## 现场取证：${title !== '' ? title : '未命名'}`, '');
			lines.push(`**现象**：${description.trim() !== '' ? description.trim() : '（未填写，请看图像与日志）'}`);
			lines.push('');
			lines.push(`**区间**：\`${formatRel(fromRel)}\` → \`${formatRel(toRel)}\`（${formatSeconds(Math.max(0, toRel - fromRel))}，${frameCount} 帧同轴）`);
			if (dir !== '') lines.push(`**取证目录**：\`${dir}\``);
			if (bundlePath !== '') lines.push(`**完整纪要**：\`${bundlePath}\`（全部事件行、标注坐标与产物清单）`);
			lines.push('');

			const images = (Array.isArray(artifacts) ? artifacts : []).filter((item) => item.kind === 'image' || item.kind === 'animation');
			if (images.length > 0) {
				lines.push('**图像证据**：');
				for (const item of images) lines.push(`- ${item.label ?? item.name}：\`${item.path}\`${item.caption ? `（${item.caption}）` : ''}`);
				lines.push('');
			}

			if (annotations.length > 0) {
				lines.push('**画面标注**：');
				annotations.forEach((annotation, index) => {
					const rect = annotation.rect ?? {};
					const note = typeof annotation.note === 'string' && annotation.note.trim() !== '' ? annotation.note.trim() : '（未写说明）';
					lines.push(`- 框 #${index + 1}：${note}（归一化 x=${rect.x?.toFixed(3)}, y=${rect.y?.toFixed(3)}, w=${rect.w?.toFixed(3)}, h=${rect.h?.toFixed(3)}，出现于 ${formatRel(annotation.atRel ?? fromRel)}）`);
				});
				lines.push('');
			}

			if (inputInfo !== '') {
				lines.push(`**键鼠输入**：${inputInfo}`);
				lines.push('');
			}

			if (events.length > 0) {
				const sampled = sampleEventsForPrompt(events, lineLimit);
				lines.push(`**日志切片**（区间内 ${events.length} 行，这里保留 ${sampled.length} 行：错误/打点优先）：`, '');
				lines.push('```log');
				for (const event of sampled) {
					const time = formatRel(event.relMs);
					if (typeof event.marker === 'string' && event.marker !== '') {
						// 打点行只写一次标签：text 本身就是「【打点】…」，再套前缀只是噪音
						const anchor = describeAnchor(event.anchor);
						lines.push(`[${time}] ⚑ ${event.marker}${anchor === '' ? '' : `（${anchor}）`}${event.pre ? '（录制前）' : ''}`);
						continue;
					}
					lines.push(`[${time}] (${event.src})${event.pre ? ' (录制前)' : ''} ${event.text}`);
				}
				lines.push('```', '');
			}

			lines.push('请结合上面的画面证据与日志切片，判断问题的成因，并指出需要改动的代码位置。');
			return lines.join('\n');
		}
