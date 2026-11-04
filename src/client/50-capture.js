		/* ------------------------------------------------------------------ */
		/* 采集：两条路都产出「带墙钟时间戳的帧」                              */
		/*   · 桌面端：主机用 desktopCapturer 定时抓 JPEG，面板轮询取回        */
		/*   · 浏览器端：面板自己 getDisplayMedia + MediaRecorder 录 webm，    */
		/*     停止后在本地 seek 抽帧                                          */
		/* ------------------------------------------------------------------ */

		/** data URL / base64 → 字节数组。 */
		function base64ToBytes(base64) {
			const binary = atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
			return bytes;
		}

		/** 解码一张图片。 */
		function loadImage(src) {
			return new Promise((resolve, reject) => {
				const image = new Image();
				image.onload = () => resolve(image);
				image.onerror = () => reject(new Error(`图片解码失败：${String(src).slice(0, 48)}`));
				image.src = src;
			});
		}

		/** 帧对象 → 可复用的 object URL（用完记得 revoke）。 */
		function frameUrl(frame) {
			if (frame.blob === undefined || frame.blob === null) return frame.url ?? '';
			if (typeof frame.localUrl !== 'string' || frame.localUrl === '') {
				frame.localUrl = URL.createObjectURL(frame.blob);
			}
			return frame.localUrl;
		}

		/** 释放一帧占用的 URL。 */
		function releaseFrame(frame) {
			if (typeof frame?.localUrl === 'string' && frame.localUrl !== '') {
				try {
					URL.revokeObjectURL(frame.localUrl);
				} catch {
					/* 已经释放过了 */
				}
				frame.localUrl = '';
			}
		}

		/**
		 * 桌面端帧采集：启动主机侧抓帧，并轮询增量帧。
		 *
		 * @param options.onFrame 每拿到一帧回调 ({seq, wall, blob})。
		 * @param options.onStatus 每次轮询回调主机侧状态。
		 * @param options.intervalMs 轮询间隔。
		 * @returns 控制器 {start(sourceId), stop(), pull()}
		 */
		function createNativeCapture(options) {
			const onFrame = options?.onFrame ?? (() => {});
			const onStatus = options?.onStatus ?? (() => {});
			const intervalMs = Number.isFinite(options?.intervalMs) ? options.intervalMs : 260;
			let cursor = 0;
			let timer = null;
			let busy = false;
			let running = false;

			async function pull(force) {
				if ((!running && force !== true) || busy) return;
				busy = true;
				try {
					const result = await API.captureFrames(cursor);
					if (result.ok) {
						for (const frame of result.value.frames ?? []) {
							cursor = Math.max(cursor, frame.seq);
							onFrame({
								seq: frame.seq,
								wall: frame.wall,
								blob: new Blob([base64ToBytes(frame.jpeg)], { type: 'image/jpeg' }),
							});
						}
						onStatus(result.value.capture);
					}
				} catch {
					/* 单次轮询失败不致命，下一拍再试 */
				} finally {
					busy = false;
				}
			}

			return {
				async start(sourceId) {
					const started = await API.captureStart({ sourceId });
					if (!started.ok) throw new Error(started.message ?? started.code ?? '采集启动失败');
					cursor = 0;
					running = true;
					onStatus(started.value?.capture ?? null);
					timer = setInterval(() => {
						void pull();
					}, intervalMs);
					await pull();
					return started.value?.capture ?? null;
				},
				async stop() {
					running = false;
					if (timer !== null) {
						clearInterval(timer);
						timer = null;
					}
					// 收掉已经落盘的帧
					await pull(true);
					// 主机收尾（GDI 模式下会再收一轮、等助手退出）
					await API.captureStop();
					// 收尾之后可能又多出最后几帧——再补一次，避免掉尾
					await pull(true);
				},
				pull,
			};
		}

		/** 挑一个当前浏览器支持的录像容器。 */
		function pickRecorderMime() {
			const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
			if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
			for (const candidate of candidates) {
				try {
					if (MediaRecorder.isTypeSupported(candidate)) return candidate;
				} catch {
					/* 继续试下一个 */
				}
			}
			return '';
		}

		/**
		 * 浏览器端录像：getDisplayMedia + MediaRecorder。
		 * @returns 控制器 {stream, t0, track, video, stop()}
		 */
		async function startBrowserCapture() {
			if (typeof navigator === 'undefined' || navigator.mediaDevices?.getDisplayMedia === undefined) {
				throw new Error('这个环境没有屏幕共享能力（getDisplayMedia）');
			}
			const stream = await navigator.mediaDevices.getDisplayMedia({
				video: { frameRate: 15 },
				audio: false,
			});
			const track = stream.getVideoTracks()[0];
			const mimeType = pickRecorderMime();
			const recorder = new MediaRecorder(stream, mimeType === '' ? undefined : { mimeType, videoBitsPerSecond: 2500000 });
			const chunks = [];
			recorder.addEventListener('dataavailable', (event) => {
				if (event.data !== null && event.data.size > 0) chunks.push(event.data);
			});
			recorder.start(1000);
			const t0 = Date.now();
			return {
				stream,
				track,
				recorder,
				t0,
				mimeType,
				isAlive: () => track.readyState === 'live',
				stop() {
					return new Promise((resolve) => {
						const finish = () => {
							try {
								track.stop();
							} catch {
								/* 已经停了 */
							}
							resolve(new Blob(chunks, { type: mimeType === '' ? 'video/webm' : mimeType.split(';')[0] }));
						};
						if (recorder.state === 'inactive') {
							finish();
							return;
						}
						recorder.addEventListener('stop', finish, { once: true });
						try {
							recorder.stop();
						} catch {
							finish();
						}
					});
				},
			};
		}

		/** 等一个视频元素到达某个事件。 */
		function waitForEvent(target, name, timeoutMs) {
			return new Promise((resolve, reject) => {
				let timer = null;
				const onEvent = () => {
					cleanup();
					resolve();
				};
				const onError = () => {
					cleanup();
					reject(new Error(`视频事件 ${name} 失败`));
				};
				const cleanup = () => {
					target.removeEventListener(name, onEvent);
					target.removeEventListener('error', onError);
					if (timer !== null) clearTimeout(timer);
				};
				target.addEventListener(name, onEvent);
				target.addEventListener('error', onError);
				if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
					timer = setTimeout(() => {
						cleanup();
						reject(new Error(`等待 ${name} 超时`));
					}, timeoutMs);
				}
			});
		}

		/** 把视频 seek 到指定时间并等画面就绪。 */
		async function seekVideo(video, timeSeconds) {
			const target = Math.max(0, Math.min(video.duration || 0, timeSeconds));
			if (Math.abs(video.currentTime - target) < 0.001) return;
			const done = waitForEvent(video, 'seeked', 4000);
			video.currentTime = target;
			await done;
		}

		/**
		 * 浏览器端录像抽帧：seek 到每一拍 → 画进 canvas → 编成 JPEG Blob。
		 *
		 * @param blob 录好的 webm/mp4。
		 * @param options.fps 目标帧率（越低越省内存）。
		 * @param options.maxWidth 输出宽度上限。
		 * @param options.t0 录制起点墙钟（帧的 wall = t0 + currentTime*1000）。
		 * @param options.onProgress 进度回调 (done, total)。
		 * @returns 帧数组 [{seq, wall, blob}]
		 */
		async function extractFramesFromBlob(blob, options) {
			const fps = clampNumber(options?.fps ?? 6, 1, 15);
			const maxWidth = clampNumber(options?.maxWidth ?? 960, 240, 1920);
			const t0 = Number.isFinite(options?.t0) ? options.t0 : Date.now();
			const url = URL.createObjectURL(blob);
			const video = document.createElement('video');
			video.preload = 'auto';
			video.muted = true;
			video.playsInline = true;
			video.src = url;
			const frames = [];
			try {
				await waitForEvent(video, 'loadedmetadata', 10000);
				const duration = Number.isFinite(video.duration) ? video.duration : 0;
				if (duration <= 0) return frames;
				const width = Math.max(1, Math.round(Math.min(video.videoWidth || maxWidth, maxWidth)));
				const height = Math.max(1, Math.round((video.videoHeight || 540) * (width / (video.videoWidth || width))));
				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const context = canvas.getContext('2d');
				const step = 1 / fps;
				const total = Math.max(1, Math.floor(duration * fps));
				for (let index = 0; index < total; index += 1) {
					const time = index * step;
					try {
						await seekVideo(video, time);
					} catch {
						break;
					}
					context.drawImage(video, 0, 0, width, height);
					const frameBlob = await new Promise((resolve) => canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.72));
					if (frameBlob !== null) {
						frames.push({ seq: frames.length + 1, wall: Math.round(t0 + time * 1000), blob: frameBlob });
					}
					if (typeof options?.onProgress === 'function') options.onProgress(frames.length, total);
				}
			} finally {
				video.removeAttribute('src');
				video.load?.();
				URL.revokeObjectURL(url);
			}
			return frames;
		}
