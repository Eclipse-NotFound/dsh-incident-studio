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
			const { doc, setDoc, onSave, saving, ingestToken, onProbe, probeState } = props;
			const profiles = Array.isArray(doc?.profiles) ? doc.profiles : [];
			const activeIndex = Math.max(0, profiles.findIndex((profile) => profile.id === doc?.activeId));
			const active = profiles[activeIndex];

			const patchProfile = (index, patch) => {
				const next = cloneDocument(doc);
				next.profiles[index] = { ...next.profiles[index], ...patch };
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
