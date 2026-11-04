		/* ------------------------------------------------------------------ */
		/* 运行时桥：把面板需要的宿主能力收敛成一个对象                        */
		/* ------------------------------------------------------------------ */

		/**
		 * 面板与宿主之间的窄接口。
		 * @param ctx 客户端 cordis 上下文。
		 * @returns {object} runtime
		 */
		function createRuntime(ctx) {
			/**
			 * 取一个服务：先试 `ctx.get(name)`，再退回直接属性访问。
			 *
			 * 两段分开 try/catch 是因为 cordis 的服务访问器在「服务还没就绪」时
			 * 可能抛错而不是返回 undefined——那样会把后面的退路也一起吞掉。
			 * @param name 服务名。
			 * @returns 服务实例或 undefined。
			 */
			const getService = (name) => {
				try {
					const viaGet = ctx.get?.(name);
					if (viaGet !== undefined && viaGet !== null) return viaGet;
				} catch {
					/* 换一条路 */
				}
				try {
					const direct = ctx[name];
					if (direct !== undefined && direct !== null) return direct;
				} catch {
					/* 两条路都不通 */
				}
				return undefined;
			};
			return {
				ctx,
				/** 当前屏幕上的会话 id（拿不到就 null）。 */
				currentSessionId() {
					try {
						const snapshot = getService('sessions')?.list?.getSnapshot?.();
						const current = snapshot?.current;
						return typeof current === 'string' ? current : null;
					} catch {
						return null;
					}
				},
				/** 打开（或聚焦）右侧取证台。@returns 'ok' | 'no-controller' | 'error:…'（便于自检回报） */
				openPanel() {
					try {
						const controller = getService('sidebarRight');
						if (controller === undefined || typeof controller.openTab !== 'function') return 'no-controller';
						controller.openTab(TAB_KIND);
						return 'ok';
					} catch (error) {
						console.warn('[dsh-incident-studio] 打开面板失败：', error);
						return `error:${String(error?.message ?? error)}`;
					}
				},
				/**
				 * 把取证正文（可带附件）填进指定会话的 composer。
				 * @param options.sessionId 目标会话。
				 * @param options.text 正文。
				 * @param options.files 要作为草稿附件登记的 File 列表。
				 * @param options.autoSend 是否直接提交。
				 * @returns {Promise<{ok: boolean, message?: string}>}
				 */
				async deliver(options) {
					const sessionId = options?.sessionId ?? null;
					const conversation = getService('conversation');
					if (conversation === undefined || conversation === null) {
						return { ok: false, message: 'conversation 服务不可用' };
					}
					if (typeof sessionId !== 'string' || sessionId === '') {
						return { ok: false, message: '没有可用会话' };
					}
					let actx;
					try {
						actx = getService('sessions')?.scope?.(sessionId);
					} catch {
						actx = undefined;
					}
					if (actx === undefined || actx === null) {
						return { ok: false, message: '会话作用域不可用' };
					}
					const input = conversation.input.for(actx);
					const files = Array.isArray(options?.files) ? options.files : [];
					let attached = 0;
					let attachRefused = false;
					if (files.length > 0) {
						try {
							const drafts = conversation.createDrafts(sessionId, files);
							const ids = drafts.map((draft) => draft.id).filter((id) => typeof id === 'string');
							if (ids.length > 0) {
								// composer 在提交中时 addAttachments 会拒绝；这时附件没进去，
								// 要如实告诉用户，而不是假装成功。
								if (input.addAttachments(ids) === false) attachRefused = true;
								else attached = ids.length;
							}
						} catch (error) {
							attachRefused = true;
							console.warn('[dsh-incident-studio] 附件登记失败：', error);
						}
					}
					input.setDraft(String(options?.text ?? ''));
					if (options?.autoSend === true) input.submit();
					return { ok: true, attached, attachRefused };
				},
			};
		}

		/**
		 * 把 tab 类型与正文座位注册进右侧栏。
		 *
		 * 注意：`sidebarRightTabs` 是服务，可能比本插件晚一点就绪，而且座位声明
		 * 早于服务提供——所以这里不依赖声明回调的时机，而是轮询到服务可用为止。
		 * @param ctx 客户端上下文。
		 * @param runtime 运行时桥。
		 * @returns 卸载函数。
		 */
		function registerSidebarSeat(ctx, runtime) {
			let disposed = false;
			let disposers = [];
			const disposeAll = () => {
				for (const dispose of disposers) {
					try {
						dispose?.();
					} catch {
						/* 重复释放无妨 */
					}
				}
				disposers = [];
			};

			const tryRegister = () => {
				if (disposed) return true;
				let tabs;
				try {
					tabs = ctx.get?.('sidebarRightTabs') ?? ctx.sidebarRightTabs;
				} catch {
					tabs = undefined;
				}
				if (tabs === undefined || tabs === null || typeof tabs.register !== 'function') return false;
				try {
					disposers.push(tabs.register({
						id: TAB_ID,
						kind: TAB_KIND,
						keepMounted: true,
						title: () => t('tab.title'),
						guide: [
							{
								id: 'incident-studio',
								order: 25,
								title: () => t('tab.title'),
								description: () => t('tab.desc'),
							},
						],
					}));
				} catch (error) {
					console.warn('[dsh-incident-studio] 注册 tab 类型失败：', error);
				}
				try {
					disposers.push(ctx.slots.inject('sidebar.right.pane.tab', () =>
						ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, (props) => h(IncidentPanel, { ...props, runtime }))));
					beacon('seat', { tab: TAB_ID });
				} catch (error) {
					console.warn('[dsh-incident-studio] 注册 tab 正文失败：', error);
					beacon('seat-failed', { message: String(error?.message ?? error) });
				}
				return true;
			};

			if (tryRegister()) return disposeAll;

			let tries = 0;
			const timer = setInterval(() => {
				tries += 1;
				if (tryRegister() || tries > 60) {
					clearInterval(timer);
					if (tries > 60) console.warn('[dsh-incident-studio] 等不到 sidebarRightTabs 服务，取证台未挂载');
				}
			}, 250);

			return () => {
				disposed = true;
				clearInterval(timer);
				disposeAll();
			};
		}

		/** 自动打开只做一次，用 localStorage 记住；失败一律静默。 */
		const AUTO_OPEN_KEY = 'dsh-incident-studio/auto-opened-v2';

		/**
		 * 首次安装后自动把面板打开一次，让人知道它在哪。
		 *
		 * 只在成功打开后记 key（失败下次重试），没有会话/控制器时不动作；
		 * 任何异常都吞掉，绝不因为"引导"影响插件本身。
		 * @param runtime 运行时桥。
		 */
		function autoOpenOnce(runtime) {
			try {
				if (typeof window === 'undefined' || window.localStorage === undefined) return;
				if (window.localStorage.getItem(AUTO_OPEN_KEY) === '1') return;
			} catch {
				return;
			}
			setTimeout(() => {
				const result = runtime.openPanel();
				beacon('auto-open', { result, sessionId: runtime.currentSessionId() ?? null });
				if (result === 'ok') {
					try {
						window.localStorage.setItem(AUTO_OPEN_KEY, '1');
					} catch {
						/* 记不住就算了，最多下次再开一次 */
					}
				}
			}, 1200);
		}

		/**
		 * 插件入口。
		 * @param ctx 客户端根上下文。
		 */
		function apply(ctx) {
			const runtime = createRuntime(ctx);

			beacon('apply', { tabId: TAB_ID, kind: TAB_KIND });
			ctx.effect(() => installStyles(), 'dsh-incident-studio: styles');
			ctx.effect(() => registerSidebarSeat(ctx, runtime), 'dsh-incident-studio: sidebar seat');
			autoOpenOnce(runtime);

			// composer 下方的紧凑入口，保证「怎么打开」永远有答案。
			ctx.effect(
				() =>
					ctx.slots.inject(LAUNCHER_SLOT, () =>
						ctx.slots.register({ name: LAUNCHER_SLOT, id: 'incident-studio:launcher', order: 60 }, (props) =>
							h(Launcher, { ...props, runtime }),
						),
					),
				'dsh-incident-studio: composer launcher',
			);
		}

		module.exports.apply = apply;
		module.exports.inject = ['slots'];
		// 纯函数出口：仅供本地回归测试（test/），运行时不被引用。
		module.exports.__runtime = createRuntime;
		// 产物编码出口：同样只给测试用（Node 里没有 Canvas，测试会塞桩件）。
		module.exports.__export = { buildFrameStrip, buildGif, composeFrame, drawAnnotations, createNativeCapture, API, runSelfTest };
		module.exports.__pure = {
			formatRel,
			formatSeconds,
			humanBytes,
			clampNumber,
			classifyLevel,
			frameRel,
			nearestFrameIndex,
			framesInRange,
			selectEvents,
			pickEvenIndices,
			sampleEventsForPrompt,
			buildDeliveryText,
			normalizeDrag,
			findAnnotationAt,
			base64ToBytes,
			TAB_ID,
			TAB_KIND,
		};
		return module.exports;
	},
});
