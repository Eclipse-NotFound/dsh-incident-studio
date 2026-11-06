		/* ------------------------------------------------------------------ */
		/* 设置：日志源 / 配置管理                                             */
		/* ------------------------------------------------------------------ */

		/** 深拷贝一份配置文档（编辑时不污染已保存/线上状态）。 */
		function cloneDocument(document) {
			try {
				return JSON.parse(JSON.stringify(document));
			} catch {
				return { version: 1, activeId: '', profiles: [] };
			}
		}

		/** 新建一个空配置。 */
		function newProfile(index) {
			return {
				id: `profile-${Date.now().toString(36)}-${index}`,
				name: `配置 ${index + 1}`,
				note: '',
				sources: [
					{ id: `source-${Date.now().toString(36)}`, kind: 'file', label: '日志 A', color: '#6aa9ff', path: '', enabled: true, timeRegex: '', preRoll: true },
				],
				updatedAt: '',
			};
		}

		/**
		 * 设置面板：管理 profile 与其中的日志源。
		 */
		function SettingsPanel(props) {
			const { doc, setDoc, onSave, saving, ingestToken, onProbe, probeState, inputCapability } = props;
			const profiles = Array.isArray(doc?.profiles) ? doc.profiles : [];
			const activeIndex = Math.max(0, profiles.findIndex((profile) => profile.id === doc?.activeId));
			const active = profiles[activeIndex];
			// 采样间隔下拉：只给两个实测有意义的档，配置里写了别的值也要能显示出来
			const pollChoices = [[10, '10ms（约 60 Hz）'], [20, '20ms（约 30 Hz）']];
			const currentPoll = Number(active?.input?.pollMs ?? 20);
			if (!pollChoices.some(([ms]) => ms === currentPoll)) pollChoices.push([currentPoll, `${currentPoll}ms`]);

			const patchProfile = (index, patch) => {
				const next = cloneDocument(doc);
				next.profiles[index] = { ...next.profiles[index], ...patch };
				setDoc(next);
			};

			/** 改当前 profile 的输入记录设置（缺字段时补一个空对象）。 */
			const patchInput = (index, patch) => {
				const next = cloneDocument(doc);
				const target = next.profiles[index];
				target.input = { ...(target.input ?? {}), ...patch };
				setDoc(next);
			};

			const patchSource = (profileIndex, sourceIndex, patch) => {
				const next = cloneDocument(doc);
				const target = next.profiles[profileIndex];
				target.sources[sourceIndex] = { ...target.sources[sourceIndex], ...patch };
				setDoc(next);
			};

			const addSource = (profileIndex) => {
				const next = cloneDocument(doc);
				const target = next.profiles[profileIndex];
				target.sources.push({
					id: `source-${Date.now().toString(36)}`,
					kind: 'file',
					label: `日志 ${target.sources.length + 1}`,
					color: ['#6aa9ff', '#7bd88f', '#f2c94c', '#eb5757', '#bb6bd9'][target.sources.length % 5],
					path: '',
					enabled: true,
					timeRegex: '',
					preRoll: true,
				});
				setDoc(next);
			};

			const removeSource = (profileIndex, sourceIndex) => {
				const next = cloneDocument(doc);
				next.profiles[profileIndex].sources.splice(sourceIndex, 1);
				setDoc(next);
			};

			const addProfile = () => {
				const next = cloneDocument(doc);
				next.profiles.push(newProfile(next.profiles.length));
				next.activeId = next.profiles[next.profiles.length - 1].id;
				setDoc(next);
			};

			const removeProfile = (index) => {
				const next = cloneDocument(doc);
				next.profiles.splice(index, 1);
				if (!next.profiles.some((profile) => profile.id === next.activeId)) {
					next.activeId = next.profiles[0]?.id ?? '';
				}
				setDoc(next);
			};

			return h(
				'div',
				{ className: 'dshis-col', style: { gap: '8px' } },
				h(
					'div',
					{ className: 'dshis-row dshis-wrap' },
					h(
						'select',
						{
							className: 'dshis-select dshis-grow',
							value: doc?.activeId ?? '',
							onChange: (event) => {
								const next = cloneDocument(doc);
								next.activeId = event.target.value;
								setDoc(next);
							},
						},
						profiles.map((profile) => h('option', { key: profile.id, value: profile.id }, profile.name)),
					),
					h(Btn, { small: true, onClick: addProfile }, t('btn.add.profile')),
					profiles.length > 1 ? h(Btn, { small: true, kind: 'danger', onClick: () => removeProfile(activeIndex) }, t('btn.delete')) : null,
					h(Btn, { small: true, kind: 'primary', onClick: onSave, disabled: saving === true }, saving === true ? t('msg.saving') : t('btn.save')),
				),
				active === undefined
					? null
					: h(
						'div',
						{ className: 'dshis-col', style: { gap: '6px' } },
						h('input', {
							className: 'dshis-input',
							value: active.name,
							placeholder: t('settings.name'),
							onChange: (event) => patchProfile(activeIndex, { name: event.target.value }),
						}),
						h('input', {
							className: 'dshis-input',
							value: active.note ?? '',
							placeholder: t('settings.note'),
							onChange: (event) => patchProfile(activeIndex, { note: event.target.value }),
						}),
						h('div', { className: 'dshis-muted' }, t('settings.sources')),
						(active.sources ?? []).map((source, sourceIndex) =>
							h(
								'div',
								{ key: source.id, className: 'dshis-card' },
								h(
									'div',
									{ className: 'dshis-row' },
									h('input', {
										type: 'checkbox',
										checked: source.enabled !== false,
										onChange: (event) => patchSource(activeIndex, sourceIndex, { enabled: event.target.checked }),
										title: t('settings.source.enabled'),
									}),
									h('input', {
										className: 'dshis-input dshis-grow',
										value: source.label,
										placeholder: t('settings.source.label'),
										onChange: (event) => patchSource(activeIndex, sourceIndex, { label: event.target.value }),
									}),
									h('input', {
										type: 'color',
										value: source.color ?? '#6aa9ff',
										title: t('settings.source.color'),
										style: { width: '26px', height: '22px', padding: '0', border: 'none', background: 'transparent' },
										onChange: (event) => patchSource(activeIndex, sourceIndex, { color: event.target.value }),
									}),
									h(Btn, { small: true, kind: 'ghost', onClick: () => removeSource(activeIndex, sourceIndex), title: t('btn.delete') }, '×'),
								),
								h('input', {
									className: 'dshis-input',
									value: source.path ?? '',
									placeholder: t('settings.source.path'),
									onChange: (event) => patchSource(activeIndex, sourceIndex, { path: event.target.value }),
								}),
								h(
									'div',
									{ className: 'dshis-row' },
									h(Btn, { small: true, onClick: () => onProbe?.(source.path ?? '') }, t('btn.probe')),
									h(
										'label',
										{ className: 'dshis-muted dshis-row', style: { gap: '4px' } },
										h('input', {
											type: 'checkbox',
											checked: source.preRoll !== false,
											onChange: (event) => patchSource(activeIndex, sourceIndex, { preRoll: event.target.checked }),
										}),
										t('settings.source.preRoll'),
									),
								),
								probeState !== null && probeState !== undefined && probeState.path === (source.path ?? '')
									? h('div', { className: 'dshis-muted' }, probeState.message)
									: h('div', { className: 'dshis-muted' }, t('settings.source.path.hint')),
							),
						),
						h(Btn, { small: true, onClick: () => addSource(activeIndex) }, t('btn.add.source')),
						h('div', { className: 'dshis-muted' }, t('settings.input')),
						active.input === undefined || active.input === null
							? null
							: h(
								'div',
								{ className: 'dshis-card' },
								h(
									'label',
									{ className: 'dshis-muted dshis-row', style: { gap: '4px' } },
									h('input', {
										type: 'checkbox',
										checked: active.input.enabled !== false,
										onChange: (event) => patchInput(activeIndex, { enabled: event.target.checked }),
									}),
									t('settings.input.enable'),
								),
								h('input', {
									className: 'dshis-input',
									value: active.input.targets ?? '',
									placeholder: t('settings.input.process'),
									onChange: (event) => patchInput(activeIndex, { targets: event.target.value }),
								}),
								h('div', { className: 'dshis-muted' }, t('settings.input.process.hint')),
								h(
									'div',
									{ className: 'dshis-row' },
									h('span', { className: 'dshis-muted' }, t('settings.input.scope')),
									h(
										'select',
										{
											className: 'dshis-select dshis-grow',
											value: active.input.scope === 'all' ? 'all' : 'target',
											onChange: (event) => patchInput(activeIndex, { scope: event.target.value }),
										},
										h('option', { value: 'target' }, t('settings.input.scope.target')),
										h('option', { value: 'all' }, t('settings.input.scope.all')),
									),
								),
								h(
									'div',
									{ className: 'dshis-row dshis-wrap' },
									h(
										'label',
										{ className: 'dshis-muted dshis-row', style: { gap: '4px' } },
										h('input', {
											type: 'checkbox',
											checked: Number(active.input.trailHz) > 0,
											onChange: (event) => patchInput(activeIndex, { trailHz: event.target.checked ? 8 : 0 }),
										}),
										t('settings.input.trail'),
									),
									h('span', { className: 'dshis-muted' }, t('settings.input.poll')),
									h(
										'select',
										{
											className: 'dshis-select',
											style: { width: '86px' },
											value: String(active.input.pollMs ?? 20),
											onChange: (event) => patchInput(activeIndex, { pollMs: Number(event.target.value) }),
										},
										pollChoices.map(([ms, label]) =>
											h('option', { key: ms, value: String(ms) }, label),
										),
									),
								),
								h('div', { className: 'dshis-muted' }, t('settings.input.privacy')),
								inputCapability === null || inputCapability === undefined
									? null
									: inputCapability.available === true
										? h('div', { className: 'dshis-muted' }, `✓ ${t('settings.input.ready', { keys: inputCapability.keys ?? 0 })}`)
										: h(
											'div',
											{ className: 'dshis-muted', style: { color: '#9a6700' } },
											t('settings.input.unavailable', { reason: inputCapability.reason || '—' }),
										),
							),
					),
				h('div', { className: 'dshis-sep' }),
				h('div', { className: 'dshis-muted' }, t('settings.ingest')),
				h(
					'div',
					{ className: 'dshis-muted', style: { wordBreak: 'break-all' } },
					h('code', null, 'POST /dsh-incident-studio/api/ingest'),
					' ',
					t('settings.ingest.hint'),
				),
				h(
					'div',
					{ className: 'dshis-row' },
					h('span', { className: 'dshis-muted' }, `${t('settings.ingest.token')}:`),
					h('code', { style: { fontSize: '10px', wordBreak: 'break-all' } }, ingestToken ?? '—'),
				),
			);
		}
