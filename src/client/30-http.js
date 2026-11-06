		/* ------------------------------------------------------------------ */
		/* 主机接口：全部走同源 fetch，路径固定 /dsh-incident-studio/api/*     */
		/* ------------------------------------------------------------------ */

		const API_BASE = '/dsh-incident-studio/api';

		/**
		 * 统一的 JSON 请求。
		 * @param path API 子路径，例如 '/state'。
		 * @param options.method 方法，默认 GET。
		 * @param options.body 可序列化对象。
		 * @param options.signal 取消信号。
		 * @returns {Promise<{ok: boolean, value?: any, code?: string, message?: string}>}
		 */
		async function api(path, options) {
			const opts = options ?? {};
			const init = { method: opts.method ?? 'GET', headers: {} };
			if (opts.body !== undefined) {
				init.headers['content-type'] = 'application/json';
				init.body = JSON.stringify(opts.body);
			}
			if (opts.signal !== undefined) init.signal = opts.signal;
			let response;
			try {
				response = await fetch(`${API_BASE}${path}`, init);
			} catch (error) {
				return { ok: false, code: 'network', message: String(error?.message ?? error) };
			}
			let payload = null;
			try {
				payload = await response.json();
			} catch {
				payload = null;
			}
			if (payload === null) {
				return { ok: false, code: `http-${response.status}`, message: `HTTP ${response.status}` };
			}
			if (payload.ok !== true) {
				return { ok: false, code: payload.code ?? `http-${response.status}`, message: payload.message ?? t('err.generic') };
			}
			return { ok: true, value: payload.value };
		}

		const API = {
			state: () => api('/state'),
			profiles: {
				load: () => api('/profiles'),
				save: (document) => api('/profiles', { method: 'POST', body: document }),
			},
			probe: (path, sessionId) => api('/probe', { method: 'POST', body: { path, sessionId } }),
			start: (payload) => api('/start', { method: 'POST', body: payload }),
			stop: () => api('/stop', { method: 'POST', body: {} }),
			events: (since) => api(`/events?since=${encodeURIComponent(String(since))}`),
			input: (since) => api(`/input?since=${encodeURIComponent(String(since))}`),
			marker: (label) => api('/marker', { method: 'POST', body: { label } }),
			artifact: (name, data) => api('/artifact', { method: 'POST', body: { name, data } }),
			bundle: (payload) => api('/bundle', { method: 'POST', body: payload }),
			incidents: (sessionId) => api(`/incidents?sessionId=${encodeURIComponent(String(sessionId ?? ''))}`),
			open: (target, sessionId) => api('/open', { method: 'POST', body: { path: target, sessionId } }),
			captureSources: () => api('/capture/sources'),
			captureStart: (payload) => api('/capture/start', { method: 'POST', body: payload }),
			captureFrames: (since) => api(`/capture/frames?since=${encodeURIComponent(String(since))}`),
			captureStop: () => api('/capture/stop', { method: 'POST', body: {} }),
		};

		/**
		 * 自检回执：把「客户端跑到哪一步」告诉主机（主机落到 client-boot.json）。
		 *
		 * 只发一次、失败静默——它不该影响任何主流程，但排查「插件到底加载了没有」
		 * 时是唯一不依赖 devtools 的证据。
		 * @param stage 阶段名：apply / seat / panel。
		 * @param detail 可选细节。
		 */
		function beacon(stage, detail) {
			try {
				const payload = {
					stage,
					href: typeof location === 'undefined' ? '' : String(location.href).slice(0, 300),
					userAgent: typeof navigator === 'undefined' ? '' : String(navigator.userAgent ?? '').slice(0, 300),
					detail: detail ?? undefined,
				};
				void fetch(`${API_BASE}/client-boot`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(payload),
					keepalive: true,
				}).catch(() => {});
			} catch {
				/* 自检失败不影响功能 */
			}
		}

		/**
		 * 一次性的自检：把「宿主状态 + 采集能力」回报给主机。
		 *
		 * 面板第一次挂载时跑一次。它回答的是排查时最先要问的三个问题：
		 * 同源接口通不通、宿主是什么平台、桌面抓帧能不能列出窗口/屏幕。
		 * @returns 无（结果走 beacon，失败也不影响面板）
		 */
		async function runSelfTest() {
			const state = await API.state();
			if (!state.ok) {
				beacon('selftest-failed', { code: state.code ?? '', message: state.message ?? '' });
				return;
			}
			let captureSources;
			try {
				const sources = await API.captureSources();
				captureSources = sources.ok
					? {
						available: sources.value?.available === true,
						screens: Array.isArray(sources.value?.screens) ? sources.value.screens.length : 0,
						windows: Array.isArray(sources.value?.windows) ? sources.value.windows.length : 0,
						reason: sources.value?.reason ?? '',
					}
					: { available: false, error: sources.message ?? sources.code ?? '' };
			} catch (error) {
				captureSources = { available: false, error: String(error?.message ?? error) };
			}
			beacon('selftest', {
				platform: state.value?.platform ?? '',
				native: state.value?.capture?.native === true,
				mode: state.value?.capture?.mode ?? '',
				nativeReason: state.value?.capture?.nativeReason ?? '',
				artifactsDirName: state.value?.artifactsDirName ?? '',
				profileCount: Array.isArray(state.value?.profiles?.profiles) ? state.value.profiles.profiles.length : 0,
				captureSources,
			});
		}

		/** 把 Blob 读成 base64（不带 data: 前缀）。 */		function blobToBase64(blob) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => {
					const text = String(reader.result ?? '');
					const comma = text.indexOf(',');
					resolve(comma === -1 ? text : text.slice(comma + 1));
				};
				reader.onerror = () => reject(reader.error ?? new Error('read failed'));
				reader.readAsDataURL(blob);
			});
		}

		/** 写入剪贴板（失败静默，调用方自己给提示）。 */
		async function copyText(text) {
			try {
				await navigator.clipboard.writeText(text);
				return true;
			} catch {
				return false;
			}
		}
