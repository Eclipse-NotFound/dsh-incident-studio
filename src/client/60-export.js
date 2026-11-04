		/* ------------------------------------------------------------------ */
		/* 产物导出：把帧 + 标注烧进图片，编码关键帧条带与动图                 */
		/* ------------------------------------------------------------------ */

		/** 标注框的主色。 */
		const ANNOTATION_COLOR = '#ff2d55';

		/** canvas → Blob。 */
		function canvasToBlob(canvas, type, quality) {
			return new Promise((resolve) => {
				if (typeof canvas.toBlob !== 'function') {
					resolve(null);
					return;
				}
				canvas.toBlob((blob) => resolve(blob), type, quality);
			});
		}

		/**
		 * 在画布上画标注框（归一化坐标 0..1）。
		 * @param context 2D 上下文。
		 * @param width 画布宽。
		 * @param height 画布高。
		 * @param annotations 标注数组 [{id, rect:{x,y,w,h}}]。
		 * @param activeId 当前选中的标注 id（画粗一点）。
		 */
		function drawAnnotations(context, width, height, annotations, activeId) {
			if (!Array.isArray(annotations) || annotations.length === 0) return;
			const scale = Math.max(1, Math.round(Math.min(width, height) / 220));
			annotations.forEach((annotation, index) => {
				const rect = annotation.rect ?? {};
				const x = clampNumber(rect.x ?? 0, 0, 1) * width;
				const y = clampNumber(rect.y ?? 0, 0, 1) * height;
				const w = clampNumber(rect.w ?? 0, 0, 1) * width;
				const hh = clampNumber(rect.h ?? 0, 0, 1) * height;
				if (w < 3 || hh < 3) return;
				const isActive = annotation.id === activeId;
				context.save();
				context.lineWidth = Math.max(2, scale * (isActive ? 1.6 : 1));
				context.strokeStyle = ANNOTATION_COLOR;
				context.setLineDash(isActive ? [scale * 6, scale * 4] : []);
				context.strokeRect(x, y, w, hh);
				context.setLineDash([]);
				// 左上角的编号徽标
				const badge = Math.max(14, scale * 7);
				context.fillStyle = ANNOTATION_COLOR;
				context.fillRect(x, Math.max(0, y - badge), badge, badge);
				context.fillStyle = '#fff';
				context.font = `600 ${Math.round(badge * 0.7)}px ui-sans-serif,system-ui,sans-serif`;
				context.textBaseline = 'middle';
				context.textAlign = 'center';
				context.fillText(String(index + 1), x + badge / 2, Math.max(0, y - badge) + badge / 2);
				context.restore();
			});
		}

		/** 在画布左下角写一行时间戳（带半透明底板，深色画面也看得清）。 */
		function drawLabel(context, width, height, text) {
			if (typeof text !== 'string' || text === '') return;
			const scale = Math.max(1, Math.round(Math.min(width, height) / 260));
			const fontPx = Math.round(11 * scale + 2);
			context.save();
			context.font = `500 ${fontPx}px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;
			const padding = Math.round(fontPx * 0.45);
			const metrics = context.measureText(text);
			const boxWidth = metrics.width + padding * 2;
			const boxHeight = fontPx + padding * 2;
			context.fillStyle = 'rgba(0,0,0,.62)';
			context.fillRect(0, height - boxHeight, boxWidth, boxHeight);
			context.fillStyle = '#fff';
			context.textBaseline = 'middle';
			context.textAlign = 'left';
			context.fillText(text, padding, height - boxHeight / 2);
			context.restore();
		}

		/**
		 * 把一帧画进画布，叠加标注与时间标签。
		 * @returns canvas（调用方复用）。
		 */
		function composeFrame(canvas, image, options) {
			const width = Math.max(1, Math.round(options?.width ?? image.width));
			const aspect = image.height > 0 ? image.height / image.width : 0.5625;
			const height = Math.max(1, Math.round(width * aspect));
			if (canvas.width !== width) canvas.width = width;
			if (canvas.height !== height) canvas.height = height;
			const context = canvas.getContext('2d');
			context.clearRect(0, 0, width, height);
			context.drawImage(image, 0, 0, width, height);
			drawAnnotations(context, width, height, options?.annotations, options?.activeId);
			if (typeof options?.label === 'string') drawLabel(context, width, height, options.label);
			return canvas;
		}

		/**
		 * 关键帧条带：区间内等距取 N 帧横向排开，每帧带时间戳与标注。
		 *
		 * 这是给视觉模型最省 token 的「时间演化」证据：一张图里能看到从正常到
		 * 异常的变化，又保留每一拍的精确时间。
		 *
		 * @param frames 帧数组（已按区间筛过，升序）。
		 * @param options.count 取几帧（默认 6）。
		 * @param options.cellWidth 单帧宽度（默认 320）。
		 * @returns PNG Blob；没有帧时返回 null。
		 */
		async function buildFrameStrip(frames, options) {
			const list = Array.isArray(frames) ? frames : [];
			if (list.length === 0) return null;
			const count = clampNumber(options?.count ?? 6, 1, 12);
			const cellWidth = clampNumber(options?.cellWidth ?? 320, 160, 640);
			const indices = pickEvenIndices(list.length, count);
			const t0 = Number.isFinite(options?.t0) ? options.t0 : 0;
			const annotations = options?.annotations ?? [];
			const cells = [];
			let cellHeight = 0;
			for (const index of indices) {
				const frame = list[index];
				let image;
				try {
					image = await loadImage(frameUrl(frame));
				} catch {
					continue;
				}
				const cell = document.createElement('canvas');
				composeFrame(cell, image, {
					width: cellWidth,
					annotations,
					label: formatRel(frameRel(frame, t0)),
				});
				cellHeight = Math.max(cellHeight, cell.height);
				cells.push(cell);
			}
			if (cells.length === 0) return null;
			const gap = 2;
			const strip = document.createElement('canvas');
			strip.width = cellWidth * cells.length + gap * (cells.length - 1);
			strip.height = cellHeight;
			const context = strip.getContext('2d');
			context.fillStyle = '#0b0b0d';
			context.fillRect(0, 0, strip.width, strip.height);
			cells.forEach((cell, index) => {
				context.drawImage(cell, index * (cellWidth + gap), 0);
			});
			return canvasToBlob(strip, 'image/png');
		}

		/**
		 * 动图：把区间内的帧按目标帧率重采样，编码成 GIF。
		 *
		 * 首帧定全局调色板（屏幕录制配色稳定，共用一张表体积小、闪烁少）。
		 *
		 * @param frames 帧数组（已按区间筛过，升序）。
		 * @param options.maxWidth 输出宽度（默认 480）。
		 * @param options.delayMs 每帧间隔（默认取来源帧间隔）。
		 * @param options.maxFrames 帧数上限（默认 80）。
		 * @returns GIF Blob；没有帧时返回 null。
		 */
		async function buildGif(frames, options) {
			const list = Array.isArray(frames) ? frames : [];
			if (list.length === 0) return null;
			const encoderFactory = typeof GIFENC !== 'undefined' ? GIFENC : undefined;
			if (encoderFactory === undefined) return null;
			const maxWidth = clampNumber(options?.maxWidth ?? 480, 160, 960);
			const maxFrames = clampNumber(options?.maxFrames ?? 80, 2, 200);
			const indices = pickEvenIndices(list.length, Math.min(maxFrames, list.length));
			// 帧间隔：用实际帧间隔的中位数，最少 40ms。
			let delayMs = Number.isFinite(options?.delayMs) ? options.delayMs : 0;
			if (delayMs <= 0) {
				const gaps = [];
				for (let index = 1; index < list.length; index += 1) {
					const gap = list[index].wall - list[index - 1].wall;
					if (Number.isFinite(gap) && gap > 0) gaps.push(gap);
				}
				gaps.sort((left, right) => left - right);
				delayMs = gaps.length > 0 ? Math.round(gaps[Math.floor(gaps.length / 2)]) : 160;
			}
			delayMs = clampNumber(delayMs, 40, 1000);
			const canvas = document.createElement('canvas');
			const gif = encoderFactory.GIFEncoder();
			let palette = null;
			let written = 0;
			for (const index of indices) {
				const frame = list[index];
				let image;
				try {
					image = await loadImage(frameUrl(frame));
				} catch {
					continue;
				}
				composeFrame(canvas, image, { width: maxWidth, annotations: options?.annotations });
				const context = canvas.getContext('2d');
				const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
				const indexed = encoderFactory.applyPalette(data, palette ?? (palette = encoderFactory.quantize(data, 128)), 'rgb565');
				gif.writeFrame(indexed, canvas.width, canvas.height, {
					palette: written === 0 ? palette : undefined,
					first: written === 0,
					delay: delayMs,
					repeat: 0,
				});
				written += 1;
				if (typeof options?.onProgress === 'function') options.onProgress(written, indices.length);
			}
			if (written === 0) return null;
			gif.finish();
			return new Blob([gif.bytesView()], { type: 'image/gif' });
		}
