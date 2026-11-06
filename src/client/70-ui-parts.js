		/* ------------------------------------------------------------------ */
		/* UI 零件                                                             */
		/* ------------------------------------------------------------------ */

		/**
		 * 从 slot props 里尽力取出会话 id（不同 slot 给的字段不同）。
		 * @returns 会话 id 或 null。
		 */
		function readSessionId(props) {
			const candidates = [props?.sessionId, props?.session?.id, props?.scope?.sessionId, props?.tab?.sessionId, props?.conversation?.sessionId];
			for (const candidate of candidates) {
				if (typeof candidate === 'string' && candidate !== '') return candidate;
			}
			return null;
		}

		/** 按钮。 */
		function Btn(props) {
			const classes = ['dshis-btn'];
			if (props.kind === 'primary') classes.push('primary');
			if (props.kind === 'danger') classes.push('danger');
			if (props.kind === 'ghost') classes.push('ghost');
			if (props.small === true) classes.push('sm');
			const title = typeof props.title === 'string' ? props.title : undefined;
			return h(
				'button',
				{
					type: 'button',
					className: classes.join(' '),
					title,
					disabled: props.disabled === true,
					onClick: props.onClick,
				},
				props.children,
			);
		}

		/** 一行提示条。 */
		function Notice(props) {
			const notice = props.notice;
			if (notice === null || notice === undefined) return null;
			return h('div', { className: `dshis-notice ${notice.level === 'err' ? 'err' : 'ok'}` }, notice.text);
		}

		/** 日志源状态点。 */
		function SourceChip(props) {
			const source = props.source;
			const status = props.status;
			let state = 'idle';
			let label = '';
			if (status !== null && status !== undefined) {
				if (status.error) {
					state = 'error';
					label = status.error;
				} else if (status.started !== false) {
					state = 'ok';
					label = `${status.lines ?? 0} 行`;
				}
			}
			const color = state === 'ok' ? (source.color ?? '#6aa9ff') : (state === 'error' ? '#d1242f' : '#9aa0a6');
			return h(
				'span',
				{ className: 'dshis-chip', title: `${source.path || '未配置路径'}${label !== '' ? `\n${label}` : ''}` },
				h('span', { className: 'dshis-dot', style: { background: color } }),
				h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, source.label),
				state === 'ok' ? h('span', { className: 'dshis-badge' }, label) : null,
				state === 'error' ? h('span', { className: 'dshis-badge', style: { color: '#d1242f' } }, '!') : null,
			);
		}

		/**
		 * 事件列表。
		 * @param props.events 已筛选的事件。
		 * @param props.activeRel 当前播放头（用于高亮最接近的一行）。
		 * @param props.onSeek 点击某行时把播放头移过去。
		 */
		function EventList(props) {
			const events = props.events ?? [];
			const onSeek = props.onSeek;
			if (events.length === 0) return h('div', { className: 'dshis-empty' }, t('review.events.empty'));
			// 只渲染尾部 400 行，长会话也不会卡。
			const start = Math.max(0, events.length - 400);
			const visible = events.slice(start);
			return h(
				'div',
				{ className: 'dshis-col', style: { gap: '1px' } },
				visible.map((event) => {
					const level = event.level ?? classifyLevel(event.text);
					const classes = ['dshis-event', `is-${level}`];
					if (event.pre === true) classes.push('is-pre');
					if ((event.marker ?? '') !== '') classes.push('is-marker');
					if (props.activeRel !== undefined && Math.abs(event.relMs - props.activeRel) < 260) classes.push('is-active');
					return h(
						'div',
						{
							key: `${event.seq}-${event.relMs}`,
							className: classes.join(' '),
							onClick: () => onSeek?.(event.relMs),
							title: '跳到这一行对应的画面',
						},
						h('span', { className: 'dshis-event-time' }, formatRel(event.relMs)),
						h('span', { className: 'dshis-event-src' }, event.src),
						h('span', { className: 'dshis-event-text' }, event.text),
						event.anchor ? h('span', { className: 'dshis-muted' }, `⤷ ${describeAnchor(event.anchor)}`) : null,
					);
				}),
			);
		}

		/**
		 * 输入事件列表（复看态）：键/鼠标/前台切换，点一条跳到对应画面。
		 * @param props.inputs 已按区间筛过的输入事件。
		 * @param props.onSeek 点击某条时把播放头移过去。
		 */
		function InputList(props) {
			const inputs = Array.isArray(props.inputs) ? props.inputs : [];
			const onSeek = props.onSeek;
			if (inputs.length === 0) return h('div', { className: 'dshis-empty' }, t('review.input.empty'));
			// 只渲染尾部 300 条：一场游戏下来的按键数可能上千。
			const start = Math.max(0, inputs.length - 300);
			const visible = inputs.slice(start);
			return h(
				'div',
				{ className: 'dshis-input-list' },
				visible.map((event, index) =>
					h(
						'div',
						{
							key: Number.isFinite(event?.seq) ? `in-${event.seq}` : `in-${start + index}`,
							className: 'dshis-event is-input',
							onClick: () => onSeek?.(event.relMs),
							title: t('review.input.seek'),
						},
						h('span', { className: 'dshis-event-time' }, formatRel(event.relMs)),
						h('span', { className: 'dshis-event-src' }, inputSymbol(event.kind)),
						h('span', { className: 'dshis-event-text' }, event.text ?? ''),
					),
				),
				start > 0 ? h('div', { className: 'dshis-muted' }, `… 前面还有 ${start} 条`) : null,
			);
		}

		/**
		 * 录制态的输入读数：就绪与否、按住了哪些键、多少次键鼠。
		 * @param props.input 录制快照里的 input 状态。
		 */
		function InputHud(props) {
			const input = props.input;
			if (input === null || input === undefined) return null;
			if (input.error) {
				return h(
					'div',
					{ className: 'dshis-input-hud' },
					h('span', { className: 'dshis-badge', style: { color: '#d1242f' } }, t('rec.input.error', { msg: input.error })),
				);
			}
			if (input.enabled === false) {
				return h('div', { className: 'dshis-input-hud' }, h('span', { className: 'dshis-muted' }, t('rec.input.off')));
			}
			if (typeof input.reason === 'string' && input.reason !== '') {
				return h('div', { className: 'dshis-input-hud' }, h('span', { className: 'dshis-muted' }, `${t('rec.input')}：${input.reason}`));
			}
			const ready = input.ready === true;
			const counts = input.counts ?? {};
			const held = [...(input.held ?? []), ...(input.heldButtons ?? [])];
			return h(
				'div',
				{ className: 'dshis-input-hud' },
				h('span', { className: 'dshis-badge' }, ready ? `⌨ ${t('rec.input.ready')}` : t('rec.input.arming')),
				ready && held.length > 0 ? h('span', { className: 'dshis-muted' }, `${t('rec.input.held')}：`) : null,
				ready ? held.map((name) => h('span', { key: name, className: 'dshis-key is-down' }, name)) : null,
				ready ? h('span', { className: 'dshis-muted' }, t('rec.input.keys', { n: counts.keys ?? 0 })) : null,
				ready ? h('span', { className: 'dshis-muted' }, t('rec.input.clicks', { n: counts.clicks ?? 0 })) : null,
				ready && (counts.focus ?? 0) > 0 ? h('span', { className: 'dshis-muted' }, `▸ ${counts.focus}`) : null,
			);
		}

		/**
		 * 画面区：帧预览 + 标注画布。
		 *
		 * 标注画布用归一化坐标（0..1），所以面板宽度、放大模式、导出尺寸
		 * 三种情况下画出来的位置都一致。
		 */
		function Stage(props) {
			const { frame, t0, annotations, activeId, onAddAnnotation, onSelectAnnotation, big, onToggleBig, statusText, children } = props;
			const canvasRef = useRef(null);
			const [drag, setDrag] = useState(null);
			const [size, setSize] = useState({ width: 0, height: 0 });

			// 画布分辨率跟随显示尺寸，保证在高分屏上不发虚。
			useEffect(() => {
				const canvas = canvasRef.current;
				if (canvas === null) return undefined;
				const update = () => {
					const rect = canvas.getBoundingClientRect();
					setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
				};
				update();
				const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
				observer?.observe(canvas);
				window.addEventListener('resize', update);
				return () => {
					observer?.disconnect();
					window.removeEventListener('resize', update);
				};
			}, [frame, big]);

			// 重绘标注层
			useEffect(() => {
				const canvas = canvasRef.current;
				if (canvas === null) return;
				if (size.width > 0 && canvas.width !== size.width) canvas.width = size.width;
				if (size.height > 0 && canvas.height !== size.height) canvas.height = size.height;
				const context = canvas.getContext('2d');
				context.clearRect(0, 0, canvas.width, canvas.height);
				const all = Array.isArray(annotations) ? annotations.slice() : [];
				if (drag !== null) {
					all.push({ id: 'dragging', rect: normalizeDrag(drag) });
				}
				drawAnnotations(context, canvas.width, canvas.height, all, activeId ?? (drag !== null ? 'dragging' : undefined));
			}, [annotations, activeId, drag, size, frame]);

			const pointFromEvent = (event) => {
				const canvas = canvasRef.current;
				if (canvas === null) return null;
				const rect = canvas.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) return null;
				return {
					x: clampNumber((event.clientX - rect.left) / rect.width, 0, 1),
					y: clampNumber((event.clientY - rect.top) / rect.height, 0, 1),
				};
			};

			const onPointerDown = (event) => {
				if (frame === null || frame === undefined) return;
				const point = pointFromEvent(event);
				if (point === null) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture?.(event.pointerId);
				setDrag({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
			};

			const onPointerMove = (event) => {
				if (drag === null) return;
				const point = pointFromEvent(event);
				if (point === null) return;
				setDrag({ x0: drag.x0, y0: drag.y0, x1: point.x, y1: point.y });
			};

			const onPointerUp = () => {
				if (drag === null) return;
				const rect = normalizeDrag(drag);
				setDrag(null);
				if (rect.w < 0.02 || rect.h < 0.02) {
					// 点击而非框选：选中落点处最近的标注。
					const hit = findAnnotationAt(annotations, rect.x + rect.w / 2, rect.y + rect.h / 2);
					onSelectAnnotation?.(hit?.id ?? null);
					return;
				}
				onAddAnnotation?.(rect);
			};

			const imageSrc = frame === null || frame === undefined ? '' : frameUrl(frame);

			return h(
				'div',
				{ className: `dshis-stage${big === true ? ' is-big' : ''}` },
				frame === null || frame === undefined
					? h('div', { className: 'dshis-muted', style: { padding: '24px 12px', textAlign: 'center' } }, statusText ?? t('rec.noFrame'))
					: h('img', { src: imageSrc, alt: '', draggable: false }),
				frame !== null && frame !== undefined
					? h('canvas', {
						ref: canvasRef,
						className: 'dshis-overlay',
						onPointerDown,
						onPointerMove,
						onPointerUp,
						onPointerCancel: onPointerUp,
					})
					: null,
				h(
					'div',
					{ className: 'dshis-stage-bar' },
					children,
					h('span', { className: 'dshis-grow' }),
					big === true
						? h(Btn, { small: true, onClick: onToggleBig }, t('btn.big.off'))
						: h(Btn, { small: true, onClick: onToggleBig }, t('btn.big')),
				),
			);
		}

		/** 拖拽两点 → 归一化矩形。 */
		function normalizeDrag(drag) {
			const x = Math.min(drag.x0, drag.x1);
			const y = Math.min(drag.y0, drag.y1);
			return { x, y, w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) };
		}

		/** 命中测试：点落在哪个标注框里（从后往前，最新的优先）。 */
		function findAnnotationAt(annotations, x, y) {
			const list = Array.isArray(annotations) ? annotations : [];
			for (let index = list.length - 1; index >= 0; index -= 1) {
				const rect = list[index].rect ?? {};
				if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return list[index];
			}
			return undefined;
		}
