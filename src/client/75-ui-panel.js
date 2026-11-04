		/* ------------------------------------------------------------------ */
		/* 主面板                                                              */
		/* ------------------------------------------------------------------ */

		/**
		 * 现场取证台的主面板。
		 *
		 * 三个阶段：idle（选配置 → 开始）→ recording（打点 / 停止）→ review
		 * （圈区间 → 标注 → 生成产物 → 递交给 Agent）。
		 */
		function IncidentPanel(props) {
			const runtime = props.runtime;
			// slot props 的字段名随 slot 而异；都取不到时退回「屏幕上那个会话」。
			const sessionId = readSessionId(props) ?? runtime.currentSessionId();
			const sessionIdRef = useRef(sessionId);
			sessionIdRef.current = sessionId;

			const [boot, setBoot] = useState(null);
			const [doc, setDoc] = useState(null);
			const [saving, setSaving] = useState(false);
			const [probeState, setProbeState] = useState(null);
			const [settingsOpen, setSettingsOpen] = useState(false);

			const [phase, setPhase] = useState('idle');
			const [rec, setRec] = useState(null);
			const [startedAt, setStartedAt] = useState(0);
			const [elapsed, setElapsed] = useState(0);
			const [events, setEvents] = useState([]);
			const [frames, setFrames] = useState([]);
			const [captureStatus, setCaptureStatus] = useState(null);
			const [sourceChoices, setSourceChoices] = useState(null);
			const [chosenSourceId, setChosenSourceId] = useState('');

			const [fromRel, setFromRel] = useState(0);
			const [toRel, setToRel] = useState(0);
			const [playhead, setPlayhead] = useState(0);
			const [playing, setPlaying] = useState(false);
			const [annotations, setAnnotations] = useState([]);
			const [activeAnnotation, setActiveAnnotation] = useState(null);
			const [big, setBig] = useState(false);

			const [title, setTitle] = useState('');
			const [description, setDescription] = useState('');
			const [onlyProblems, setOnlyProblems] = useState(false);
			const [query, setQuery] = useState('');

			const [busy, setBusy] = useState('');
			const [notice, setNotice] = useState(null);
			const [artifacts, setArtifacts] = useState([]);
			const [blobs, setBlobs] = useState({});
			const [attachGif, setAttachGif] = useState(true);
			const [recent, setRecent] = useState(null);
			const [bundlePath, setBundlePath] = useState('');

			const cursorRef = useRef(0);
			const nativeRef = useRef(null);
			const browserRef = useRef(null);
			const framesRef = useRef([]);
			const stopRef = useRef(null);
			const endRelRef = useRef(0);

			const profiles = Array.isArray(doc?.profiles) ? doc.profiles : [];
			const activeProfile = profiles.find((profile) => profile.id === doc?.activeId) ?? profiles[0] ?? null;
			const t0 = Number.isFinite(rec?.t0) ? rec.t0 : startedAt;

			/* --------------------------- 数据加载 --------------------------- */

			const refreshState = useCallback(async () => {
				const result = await API.state();
				if (!result.ok) {
					setBoot({ error: result.message ?? t('err.generic') });
					return null;
				}
				setBoot({ state: result.value });
				setDoc((previous) => previous ?? cloneDocument(result.value.profiles));
				return result.value;
			}, []);

			const refreshRecent = useCallback(async () => {
				const result = await API.incidents(sessionIdRef.current ?? '');
				if (result.ok) setRecent(result.value);
			}, []);

			const refreshSources = useCallback(async () => {
				const result = await API.captureSources();
				if (!result.ok) {
					setSourceChoices({ available: false, reason: result.message ?? '', screens: [], windows: [] });
					return;
				}
				setSourceChoices(result.value);
				const first = result.value.screens?.[0] ?? result.value.windows?.[0];
				setChosenSourceId((previous) => {
					if (previous !== '') {
						const stillThere = [...(result.value.screens ?? []), ...(result.value.windows ?? [])].some((item) => item.id === previous);
						if (stillThere) return previous;
					}
					return first?.id ?? '';
				});
			}, []);

			useEffect(() => {
				beacon('panel', { sessionId: sessionId ?? null });
				void runSelfTest();
				void refreshState();
				void refreshRecent();
				void refreshSources();
			}, [refreshState, refreshRecent, refreshSources]);

			/* --------------------------- 录制计时 --------------------------- */

			useEffect(() => {
				if (phase !== 'recording') return undefined;
				const timer = setInterval(() => setElapsed(Date.now() - startedAt), 200);
				return () => clearInterval(timer);
			}, [phase, startedAt]);

			/* --------------------------- 事件轮询 --------------------------- */

			useEffect(() => {
				if (phase !== 'recording') return undefined;
				let cancelled = false;
				const tick = async () => {
					if (cancelled) return;
					const result = await API.events(cursorRef.current);
					if (cancelled || !result.ok) return;
					if (Array.isArray(result.value.events) && result.value.events.length > 0) {
						setEvents((previous) => previous.concat(result.value.events));
					}
					cursorRef.current = Number.isFinite(result.value.cursor) ? result.value.cursor : cursorRef.current;
					if (result.value.recording !== null && result.value.recording !== undefined) setRec(result.value.recording);
				};
				const timer = setInterval(() => {
					void tick();
				}, 450);
				void tick();
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [phase]);

			/* --------------------------- 帧缓冲 --------------------------- */

			const pushFrame = useCallback((frame) => {
				const list = framesRef.current;
				list.push(frame);
				if (list.length > MAX_LOCAL_FRAMES) {
					const removed = list.splice(0, list.length - MAX_LOCAL_FRAMES);
					for (const item of removed) releaseFrame(item);
				}
				setFrames(list.slice());
			}, []);

			const clearFrames = useCallback(() => {
				for (const frame of framesRef.current) releaseFrame(frame);
				framesRef.current = [];
				setFrames([]);
			}, []);

			/* --------------------------- 播放头 --------------------------- */

			useEffect(() => {
				if (!playing || phase !== 'review') return undefined;
				const timer = setInterval(() => {
					setPlayhead((previous) => Math.min(toRel, previous + 90));
				}, 90);
				return () => clearInterval(timer);
			}, [playing, phase, toRel]);

			// 到尾部自动停：不放在 setState 更新函数里（那是 React 的禁忌）。
			useEffect(() => {
				if (playing && playhead >= toRel) setPlaying(false);
			}, [playing, playhead, toRel]);

			/* --------------------------- 开始录制 --------------------------- */

			async function startRecording() {
				if (busy !== '') return;
				setNotice(null);
				setBusy('starting');
				const now = Date.now();
				try {
					const sources = (activeProfile?.sources ?? []).filter((source) => source.enabled !== false);
					const started = await API.start({
						t0: now,
						profileId: activeProfile?.id ?? '',
						sources,
						sessionId: sessionIdRef.current ?? '',
					});
					if (!started.ok) {
						setNotice({ level: 'err', text: started.message ?? t('err.generic') });
						return;
					}
					setRec(started.value.recording);
					setStartedAt(Number(started.value.recording?.t0) || now);
					setElapsed(0);
					setEvents([]);
					cursorRef.current = 0;
					clearFrames();
					setCaptureStatus(null);
					setAnnotations([]);
					setArtifacts([]);
					setBlobs({});
					setBundlePath('');
					setTitle(new Date().toLocaleString('zh-CN', { hour12: false }));
					setDescription('');
					setPhase('recording');

					const captureMode = boot?.state?.capture?.mode ?? (boot?.state?.capture?.native === true ? 'native' : 'browser');
					if (captureMode !== 'browser' && chosenSourceId !== '') {
						const controller = createNativeCapture({
							onFrame: (frame) => pushFrame(frame),
							onStatus: (status) => setCaptureStatus(status),
						});
						nativeRef.current = controller;
						await controller.start(chosenSourceId);
					} else {
						const browser = await startBrowserCapture();
						browserRef.current = browser;
						browser.track.addEventListener('ended', () => {
							void stopRef.current?.(true);
						});
						setCaptureStatus({ running: true, sourceId: 'browser', fps: 15, frames: 0, bytes: 0, captured: 0, failed: 0, error: '' });
					}
				} catch (error) {
					setNotice({ level: 'err', text: `${t('msg.captureFail')}${String(error?.message ?? error)}` });
					setPhase('idle');
					await API.stop();
				} finally {
					setBusy('');
				}
			}

			/* --------------------------- 停止录制 --------------------------- */

			async function stopRecording(fromBrowserEnded) {
				if (busy !== '') return;
				setBusy('stopping');
				setPlaying(false);
				try {
					if (nativeRef.current !== null) {
						await nativeRef.current.stop();
						nativeRef.current = null;
					}
					if (browserRef.current !== null) {
						const recorder = browserRef.current;
						browserRef.current = null;
						const blob = await recorder.stop();
						if (blob !== null && blob.size > 0) {
							setNotice({ level: 'ok', text: '正在从录像里抽帧…' });
							const extracted = await extractFramesFromBlob(blob, {
								fps: 6,
								maxWidth: 960,
								t0: recorder.t0,
								onProgress: (done, total) => setNotice({ level: 'ok', text: `抽帧 ${done}/${total}` }),
							});
							for (const frame of extracted) pushFrame(frame);
							setNotice(null);
						}
					}
					const stopped = await API.stop();
					if (stopped.ok) setRec(stopped.value.recording);

					const allFrames = framesRef.current.slice();
					const allEvents = events;
					const lastRel = allFrames.length > 0
						? frameRel(allFrames[allFrames.length - 1], Number(stopped.value?.recording?.t0 ?? t0))
						: Date.now() - startedAt;
					const firstRel = allFrames.length > 0 ? frameRel(allFrames[0], Number(stopped.value?.recording?.t0 ?? t0)) : 0;
					const markers = allEvents.filter((event) => (event.marker ?? '') !== '');
					let nextFrom = Math.max(firstRel, lastRel - 8000);
					let nextTo = lastRel;
					if (markers.length > 0) {
						const marker = markers[markers.length - 1];
						nextFrom = Math.max(firstRel, marker.relMs - 3000);
						nextTo = Math.min(lastRel, marker.relMs + 3000);
					}
					endRelRef.current = lastRel;
					setFromRel(Math.round(nextFrom));
					setToRel(Math.round(nextTo));
					setPlayhead(Math.round(nextTo));
					setPhase('review');
					if (fromBrowserEnded === true) setNotice({ level: 'ok', text: '共享已结束，已停止录制。' });
				} catch (error) {
					setNotice({ level: 'err', text: String(error?.message ?? error) });
					setPhase('review');
				} finally {
					setBusy('');
				}
			}
			stopRef.current = stopRecording;

			/* --------------------------- 打点 --------------------------- */

			async function addMarker() {
				const result = await API.marker('问题点');
				if (result.ok && result.value?.event) {
					setEvents((previous) => previous.concat([result.value.event]));
					cursorRef.current = Math.max(cursorRef.current, result.value.cursor ?? cursorRef.current);
					setNotice({ level: 'ok', text: `已打点：${formatRel(result.value.event.relMs)}` });
				}
			}

			/* --------------------------- 生成产物 --------------------------- */

			/**
			 * 生成区间产物（关键帧条带 + 动图）并上传落盘。
			 *
			 * 返回 `{ artifacts, strip, gif }`：调用方必须用**返回值**里的 blob，
			 * 不能等 `blobs` 这个 state（setState 是异步的，紧接着递交会读到旧的空对象）。
			 */
			async function buildArtifacts() {
				const inRange = framesInRange(framesRef.current, fromRel, toRel, t0);
				if (inRange.length === 0) {
					setNotice({ level: 'err', text: t('msg.needRange') });
					return null;
				}
				setBusy('exporting');
				setNotice({ level: 'ok', text: t('msg.exporting') });
				try {
					const strip = await buildFrameStrip(inRange, { count: 6, cellWidth: 340, t0, annotations });
					const gif = await buildGif(inRange, { maxWidth: 460, annotations });
					if (strip === null) {
						setNotice({ level: 'err', text: t('msg.needRange') });
						return null;
					}
					setBlobs({ strip, gif });
					const nextArtifacts = [];
					const dirStamp = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
					const stripPath = await API.artifact(`frames-${dirStamp}.png`, await blobToBase64(strip));
					if (stripPath.ok) {
						nextArtifacts.push({
							kind: 'image',
							name: `frames-${dirStamp}.png`,
							path: stripPath.value.path,
							label: '关键帧条带',
							caption: `${inRange.length} 帧中取 6 帧，含标注红框；每帧左下角是相对时间`,
						});
					}
					if (gif !== null) {
						const gifPath = await API.artifact(`clip-${dirStamp}.gif`, await blobToBase64(gif));
						if (gifPath.ok) {
							nextArtifacts.push({
								kind: 'animation',
								name: `clip-${dirStamp}.gif`,
								path: gifPath.value.path,
								label: '区间动图',
								caption: `区间 ${formatRel(fromRel)} → ${formatRel(toRel)}`,
							});
						}
					}
					setArtifacts(nextArtifacts);
					setNotice({ level: 'ok', text: t('msg.artifactReady') });
					return { artifacts: nextArtifacts, strip, gif, frameCount: inRange.length };
				} catch (error) {
					setNotice({ level: 'err', text: String(error?.message ?? error) });
					return null;
				} finally {
					setBusy('');
				}
			}

			/* --------------------------- 递交 --------------------------- */

			async function deliver(autoSend) {
				if (busy !== '') return;
				if (description.trim() === '') {
					setNotice({ level: 'err', text: t('msg.needDescription') });
					return;
				}
				setBusy('delivering');
				try {
					let current = artifacts;
					let stripBlob = blobs.strip;
					let gifBlob = blobs.gif;
					if (current.length === 0) {
						const built = await buildArtifacts();
						if (built === null) return;
						// 用返回值里的 blob：setBlobs 还没渲染，读 state 会拿到旧的空值。
						current = built.artifacts;
						stripBlob = built.strip;
						gifBlob = built.gif;
					}
					const inRange = framesInRange(framesRef.current, fromRel, toRel, t0);
					const scopedEvents = selectEvents(events, { fromRel, toRel });
					const result = await API.bundle({
						title: title.trim() !== '' ? title.trim() : '现场取证',
						description,
						fromRel,
						toRel,
						events: scopedEvents,
						annotations,
						artifacts: current,
						profileName: activeProfile?.name ?? '',
						captureInfo: captureStatus?.sourceId === 'browser'
							? '浏览器屏幕共享（本地抽帧）'
							: (captureStatus?.mode === 'gdi'
								? `GDI 抓屏 ${captureStatus?.fps ?? ''}fps`
								: `桌面抓帧 ${captureStatus?.fps ?? ''}fps`),
					});
					if (!result.ok) {
						setNotice({ level: 'err', text: result.message ?? t('err.generic') });
						return;
					}
					setBundlePath(result.value.markdownPath ?? '');
					const text = buildDeliveryText({
						title: title.trim() !== '' ? title.trim() : '现场取证',
						description,
						bundlePath: result.value.markdownPath ?? '',
						dir: result.value.dir ?? '',
						fromRel,
						toRel,
						events: scopedEvents,
						annotations,
						artifacts: current,
						frameCount: inRange.length,
					});
					const files = [];
					if (stripBlob !== undefined && stripBlob !== null) files.push(new File([stripBlob], 'frames.png', { type: 'image/png' }));
					if (attachGif === true && gifBlob !== undefined && gifBlob !== null) files.push(new File([gifBlob], 'clip.gif', { type: 'image/gif' }));
					const okDelivered = await runtime.deliver({ sessionId: sessionIdRef.current, text, files, autoSend });
					if (!okDelivered.ok) {
						const copied = await copyText(text);
						setNotice({ level: 'err', text: copied ? t('msg.noSession') : okDelivered.message });
						return;
					}
					const base = autoSend === true ? t('msg.sent') : t('msg.delivered');
					if (okDelivered.attachRefused === true) {
						setNotice({ level: 'err', text: `${base} ${t('msg.attachRefused')}` });
						return;
					}
					setNotice({ level: 'ok', text: files.length > 0 ? `${base}（${okDelivered.attached ?? 0} 个附件）` : base });
				} catch (error) {
					setNotice({ level: 'err', text: String(error?.message ?? error) });
				} finally {
					setBusy('');
				}
			}

			/* --------------------------- 设置保存 --------------------------- */

			async function saveDoc() {
				if (doc === null) return;
				setSaving(true);
				const result = await API.profiles.save(doc);
				setSaving(false);
				if (result.ok) {
					setDoc(cloneDocument(result.value));
					setNotice({ level: 'ok', text: t('btn.saved') });
					await refreshState();
				} else {
					setNotice({ level: 'err', text: result.message ?? t('err.generic') });
				}
			}

			async function probe(path) {
				if (typeof path !== 'string' || path === '') {
					setProbeState({ path, message: '先填一个路径' });
					return;
				}
				const result = await API.probe(path, sessionIdRef.current ?? '');
				setProbeState({ path, message: result.ok ? (result.value?.hint ?? result.value?.message ?? '—') : (result.message ?? '—') });
			}

			/* --------------------------- 派生数据 --------------------------- */

			const filteredEvents = useMemo(
				() => selectEvents(events, { fromRel, toRel, onlyProblems, query }),
				[events, fromRel, toRel, onlyProblems, query],
			);
			const inRangeFrames = useMemo(() => framesInRange(frames, fromRel, toRel, t0), [frames, fromRel, toRel, t0]);
			const recordingFrames = frames;
			const previewIndex = nearestFrameIndex(inRangeFrames, playhead, t0);
			const previewFrame = previewIndex >= 0 ? inRangeFrames[previewIndex] : (inRangeFrames[inRangeFrames.length - 1] ?? null);
			const liveFrame = recordingFrames.length > 0 ? recordingFrames[recordingFrames.length - 1] : null;
			const rangeMax = Math.max(endRelRef.current, toRel, 1);
			const durationText = formatRel(toRel - fromRel);

			/* --------------------------- 渲染 --------------------------- */

			const header = h(
				'div',
				{ className: 'dshis-head' },
				h('span', { className: 'dshis-head-title' }, t('title')),
				h(
					'span',
					{ className: `dshis-phase${phase === 'recording' ? ' is-rec' : ''}` },
					phase === 'idle' ? t('phase.idle') : phase === 'recording' ? `${t('phase.recording')} ${formatRel(elapsed)}` : t('phase.review'),
				),
				h('span', { className: 'dshis-grow' }),
				phase === 'review' ? h(Btn, { small: true, kind: 'ghost', onClick: () => setPhase('idle') }, t('btn.reset')) : null,
				h(Btn, { small: true, kind: 'ghost', onClick: () => setSettingsOpen((value) => !value) }, t('btn.settings')),
			);

			const settings = settingsOpen && doc !== null
				? h(
					'div',
					{ className: 'dshis-scroll', style: { flex: 'none', maxHeight: '60%' } },
					h(SettingsPanel, {
						doc,
						setDoc,
						onSave: saveDoc,
						saving,
						ingestToken: boot?.state?.ingestToken,
						onProbe: probe,
						probeState,
					}),
				)
				: null;

			let body = null;

			if (phase === 'idle') {
				// native = Electron desktopCapturer；gdi = Windows 抓屏助手；其余按浏览器共享处理
				const idleCaptureMode = boot?.state?.capture?.mode ?? (boot?.state?.capture?.native === true ? 'native' : 'browser');
				const choices = sourceChoices ?? { available: false, screens: [], windows: [] };
				const allChoices = [...(choices.screens ?? []), ...(choices.windows ?? [])];
				body = h(
					'div',
					{ className: 'dshis-scroll' },
					h(Notice, { notice }),
					boot === null
						? h('div', { className: 'dshis-muted' }, t('msg.loading'))
						: boot.error !== undefined
							? h('div', { className: 'dshis-empty' }, boot.error)
							: null,
					h(
						'div',
						{ className: 'dshis-col' },
						h('div', { className: 'dshis-muted' }, t('idle.profile')),
						h(
							'div',
							{ className: 'dshis-row' },
							doc === null
								? null
								: h(
									'select',
									{
										className: 'dshis-select dshis-grow',
										value: doc.activeId ?? '',
										onChange: async (event) => {
											const next = cloneDocument(doc);
											next.activeId = event.target.value;
											setDoc(next);
											await API.profiles.save(next);
										},
									},
									profiles.map((profile) => h('option', { key: profile.id, value: profile.id }, profile.name)),
								),
						),
						h(
							'div',
							{ className: 'dshis-wrap' },
							(activeProfile?.sources ?? []).filter((source) => source.enabled !== false).map((source) =>
								h(SourceChip, { key: source.id, source, status: rec?.sources?.find((item) => item.id === source.id)?.status }),
							),
							(activeProfile?.sources ?? []).filter((source) => source.enabled !== false).length === 0
								? h('span', { className: 'dshis-muted' }, t('idle.noSource'))
								: null,
						),
					),
					h(
						'div',
						{ className: 'dshis-col' },
						h('div', { className: 'dshis-muted' }, t('idle.capture')),
						h(
							'div',
							{ className: 'dshis-muted' },
							idleCaptureMode === 'native'
								? t('idle.capture.native')
								: (idleCaptureMode === 'gdi' ? t('idle.capture.gdi') : t('idle.capture.browser')),
						),
						idleCaptureMode === 'native' || idleCaptureMode === 'gdi'
							? h(
								'div',
								{ className: 'dshis-row' },
								h(
									'select',
									{
										className: 'dshis-select dshis-grow',
										value: chosenSourceId,
										onChange: (event) => setChosenSourceId(event.target.value),
									},
									allChoices.length === 0
										? h('option', { value: '' }, t('idle.capture.pick'))
										: allChoices.map((item) => h('option', { key: item.id, value: item.id }, item.name)),
								),
								h(Btn, { small: true, onClick: () => void refreshSources() }, '↻'),
							)
							: null,
					),
					h(
						'div',
						{ className: 'dshis-row' },
						h(
							Btn,
							{
								kind: 'primary',
								disabled: busy !== '',
								onClick: () => void startRecording(),
							},
							busy === 'starting' ? t('msg.loading') : `● ${t('btn.start')}`,
						),
					),
					h('div', { className: 'dshis-muted' }, t('idle.hint')),
					recent !== null
						? h(
							'div',
							{ className: 'dshis-col' },
							h('div', { className: 'dshis-muted' }, t('idle.recent')),
							(recent.items ?? []).length === 0
								? h('div', { className: 'dshis-empty' }, t('idle.recent.empty'))
								: (recent.items ?? []).slice(0, 8).map((item) =>
									h(
										'div',
										{ key: item.id, className: 'dshis-anno' },
										h('span', { className: 'dshis-grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title !== '' ? item.title : item.id),
										h(Btn, { small: true, kind: 'ghost', onClick: () => void API.open(item.dir, sessionIdRef.current ?? '') }, t('btn.open.dir')),
									),
								),
						)
						: null,
				);
			} else if (phase === 'recording') {
				body = h(
					'div',
					{ className: 'dshis-scroll' },
					h(Notice, { notice }),
					h(
						'div',
						{ className: 'dshis-row' },
						h(Btn, { kind: 'primary', onClick: () => void addMarker() }, `⚑ ${t('btn.marker')}`),
						h(Btn, { kind: 'danger', disabled: busy !== '', onClick: () => void stopRecording(false) }, `■ ${t('btn.stop')}`),
						h('span', { className: 'dshis-grow' }),
						h('span', { className: 'dshis-muted' }, `${frames.length} ${t('rec.frames')} · ${events.length} ${t('rec.events')}`),
					),
					h(
						Stage,
						{
							frame: liveFrame,
							t0,
							annotations: [],
							activeId: undefined,
							onAddAnnotation: undefined,
							onSelectAnnotation: undefined,
							big: false,
							onToggleBig: () => {},
							statusText: t('rec.noFrame'),
						},
						h('span', null, `${formatRel(elapsed)}`),
						h('span', { className: 'dshis-grow' }),
						captureStatus?.mode === 'gdi' ? h('span', { className: 'dshis-badge' }, 'GDI') : null,
						h('span', null, captureStatus?.error ? `! ${captureStatus.error}` : `${captureStatus?.captured ?? 0} ${t('rec.frames')}`),
					),
					h(
						'div',
						{ className: 'dshis-wrap' },
						(rec?.sources ?? []).map((source) => h(SourceChip, { key: source.id, source, status: source.status })),
					),
					h(EventList, { events: events.slice(-200), activeRel: elapsed, onSeek: undefined }),
				);
			} else {
				body = h(
					'div',
					{ className: 'dshis-scroll' },
					h(Notice, { notice }),
					h(
						Stage,
						{
							frame: previewFrame,
							t0,
							annotations,
							activeId: activeAnnotation,
							onAddAnnotation: (rect) => {
								const id = `a${Date.now().toString(36)}`;
								setAnnotations((previous) => previous.concat([{ id, rect, note: '', atRel: playhead }]));
								setActiveAnnotation(id);
							},
							onSelectAnnotation: (id) => setActiveAnnotation(id),
							big,
							onToggleBig: () => setBig((value) => !value),
							statusText: t('rec.noFrame'),
						},
						h(Btn, { small: true, onClick: () => setPlaying((value) => !value) }, playing ? `❚❚ ${t('btn.pause')}` : `▶ ${t('btn.play')}`),
						h('span', null, `${formatRel(playhead)}`),
						h('span', { className: 'dshis-muted' }, `/ ${formatRel(toRel)}`),
						h('span', { className: 'dshis-grow' }),
						h('span', { className: 'dshis-muted' }, `${inRangeFrames.length} ${t('review.frames.count')}`),
					),
					h(
						'div',
						{ className: 'dshis-col' },
						h(
							'div',
							{ className: 'dshis-row' },
							h('span', { className: 'dshis-muted' }, t('review.range')),
							h('span', { className: 'dshis-badge' }, `${formatRel(fromRel)} → ${formatRel(toRel)}`),
							h('span', { className: 'dshis-badge' }, durationText),
							h('span', { className: 'dshis-grow' }),
							h('span', { className: 'dshis-muted' }, t('review.annotations.hint')),
						),
						h(
							'div',
							{ className: 'dshis-slider' },
							h('span', { className: 'dshis-muted', style: { width: '26px' } }, t('review.from')),
							h('input', {
								type: 'range',
								min: 0,
								max: rangeMax,
								step: 50,
								value: fromRel,
								onChange: (event) => {
									const value = clampNumber(Number(event.target.value), 0, toRel - 100);
									setFromRel(Math.round(value));
								},
							}),
							h(Btn, { small: true, onClick: () => setFromRel(Math.round(playhead)) }, t('review.setFrom')),
						),
						h(
							'div',
							{ className: 'dshis-slider' },
							h('span', { className: 'dshis-muted', style: { width: '26px' } }, t('review.to')),
							h('input', {
								type: 'range',
								min: 0,
								max: rangeMax,
								step: 50,
								value: toRel,
								onChange: (event) => {
									const value = clampNumber(Number(event.target.value), fromRel + 100, rangeMax);
									setToRel(Math.round(value));
								},
							}),
							h(Btn, { small: true, onClick: () => setToRel(Math.round(playhead)) }, t('review.setTo')),
						),
						h(
							'div',
							{ className: 'dshis-row dshis-wrap' },
							h(Btn, { small: true, onClick: () => { setFromRel(0); setToRel(Math.round(rangeMax)); } }, t('review.all')),
							h(Btn, { small: true, onClick: () => { setFromRel(Math.max(0, Math.round(endRelRef.current - 8000))); setToRel(Math.round(endRelRef.current)); } }, t('review.last8')),
							h(
								Btn,
								{
									small: true,
									onClick: () => {
										const markers = events.filter((event) => (event.marker ?? '') !== '');
										if (markers.length === 0) return;
										const marker = markers[markers.length - 1];
										setFromRel(Math.max(0, Math.round(marker.relMs - 3000)));
										setToRel(Math.round(marker.relMs + 3000));
									},
								},
								t('review.marker'),
							),
						),
					),
					h(
						'div',
						{ className: 'dshis-col' },
						h('div', { className: 'dshis-muted' }, `${t('review.annotations')} · ${annotations.length}`),
						annotations.length === 0
							? null
							: annotations.map((annotation, index) =>
								h(
									'div',
									{ key: annotation.id, className: `dshis-anno${annotation.id === activeAnnotation ? ' is-active' : ''}` },
									h('span', { className: 'dshis-anno-idx' }, String(index + 1)),
									h('input', {
										className: 'dshis-input',
										value: annotation.note ?? '',
										placeholder: t('review.annotation.note'),
										onChange: (event) => {
											const value = event.target.value;
											setAnnotations((previous) => previous.map((item) => (item.id === annotation.id ? { ...item, note: value } : item)));
										},
									}),
									h('span', { className: 'dshis-muted' }, formatRel(annotation.atRel ?? 0)),
									h(
										Btn,
										{
											small: true,
											kind: 'ghost',
											onClick: () => {
												setAnnotations((previous) => previous.filter((item) => item.id !== annotation.id));
												setActiveAnnotation(null);
											},
										},
										'×',
									),
								),
							),
					),
					h(
						'div',
						{ className: 'dshis-row dshis-wrap' },
						h('span', { className: 'dshis-muted' }, `${t('review.events')} · ${filteredEvents.length}`),
						h(
							'label',
							{ className: 'dshis-muted dshis-row', style: { gap: '4px' } },
							h('input', { type: 'checkbox', checked: onlyProblems, onChange: (event) => setOnlyProblems(event.target.checked) }),
							t('review.onlyProblems'),
						),
						h('input', {
							className: 'dshis-input',
							style: { maxWidth: '120px' },
							value: query,
							placeholder: t('review.search'),
							onChange: (event) => setQuery(event.target.value),
						}),
					),
					h(EventList, { events: filteredEvents, activeRel: playhead, onSeek: (rel) => { setPlayhead(rel); setPlaying(false); } }),
					h('div', { className: 'dshis-sep' }),
					h(
						'div',
						{ className: 'dshis-col' },
						h('span', { className: 'dshis-muted' }, t('review.title')),
						h('input', { className: 'dshis-input', value: title, placeholder: t('review.title.placeholder'), onChange: (event) => setTitle(event.target.value) }),
						h('span', { className: 'dshis-muted' }, t('review.desc')),
						h('textarea', {
							className: 'dshis-textarea',
							value: description,
							placeholder: t('review.desc.placeholder'),
							onChange: (event) => setDescription(event.target.value),
						}),
					),
					h(
						'div',
						{ className: 'dshis-row dshis-wrap' },
						h(Btn, { onClick: () => void buildArtifacts(), disabled: busy !== '' }, busy === 'exporting' ? t('msg.exporting') : t('btn.export')),
						h(Btn, { kind: 'primary', onClick: () => void deliver(false), disabled: busy !== '' }, busy === 'delivering' ? t('msg.delivering') : t('btn.deliver')),
						h(Btn, { onClick: () => void deliver(true), disabled: busy !== '' }, t('btn.send')),
						h(
							'label',
							{ className: 'dshis-muted dshis-row', style: { gap: '4px' } },
							h('input', { type: 'checkbox', checked: attachGif, onChange: (event) => setAttachGif(event.target.checked) }),
							'附带动图',
						),
					),
					artifacts.length === 0
						? h('div', { className: 'dshis-muted' }, t('review.artifacts.empty'))
						: h(
							'div',
							{ className: 'dshis-col' },
							h('div', { className: 'dshis-muted' }, t('review.artifacts')),
							artifacts.map((item) =>
								h(
									'div',
									{ key: item.path, className: 'dshis-anno' },
									h('span', { className: 'dshis-grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${item.label ?? item.name} · ${item.name}`),
									h(Btn, { small: true, kind: 'ghost', onClick: () => void API.open(item.path, sessionIdRef.current ?? '') }, t('btn.open.dir')),
								),
							),
						),
					bundlePath !== ''
						? h('div', { className: 'dshis-muted', style: { wordBreak: 'break-all' } }, `${t('review.artifacts')} → ${bundlePath}`)
						: null,
				);
			}

			return h('div', { className: 'dshis' }, header, settings ?? body);
		}

		/**
		 * composer 下方的紧凑入口：点一下打开右侧取证台。
		 */
		function Launcher(props) {
			const runtime = props.runtime;
			return h(
				'div',
				{ className: 'dshis-launcher' },
				h(
					'button',
					{
						type: 'button',
						className: 'dshis-btn',
						title: t('launcher.title'),
						onClick: () => runtime.openPanel(),
					},
					`🎥 ${t('launcher')}`,
				),
			);
		}
