/**
 * dsh-incident-studio — client half（现场取证台：浏览器端）
 *
 * 侧边栏里的一个取证面板：录屏（桌面端抓帧序列 / 浏览器端录 webm 抽帧）、
 * 与主机跟随的日志流共用一条毫秒时间轴，录完在区间内标注、导出关键帧条带
 * 与动图，最后把结构化上下文一键填进 composer（可带附件、可直接发送）。
 *
 * 本文件由 tools/build-client.mjs 从 src/client/*.js 拼接生成，不要直接改 client.js。
 */
window.__ModuleLoader__.load({
	id: 'dsh-incident-studio',
	factory: (require) => {
		const module = { exports: {} };
		const React = require('react');
		const h = React.createElement;
		const { useCallback, useEffect, useMemo, useRef, useState } = React;

		/** tab 类型在 sidebarRightTabs 里的实现 id（全局唯一）。 */
		const TAB_ID = 'dsh-incident-studio';
		/** tab 的 kind：openTab 用它开页。 */
		const TAB_KIND = 'incident-studio';
		/** composer 下方快捷入口所在的 slot。 */
		const LAUNCHER_SLOT = 'conversation.composer.dock';
		/** 单次录制最多在本地保留多少帧（防内存爆掉）。 */
		const MAX_LOCAL_FRAMES = 1500;

		/* ------------------------------------------------------------------ */
		/* 文案：桌面端与 web 端共用中文，英文作为回退                        */
		/* ------------------------------------------------------------------ */

		const IS_ZH = (() => {
			try {
				return (navigator.language || 'zh').toLowerCase().startsWith('zh');
			} catch {
				return true;
			}
		})();

		const STRINGS = {
			zh: {
				'tab.title': '现场取证台',
				'tab.desc': '录屏 + 日志同轴对齐，标注后交给 Agent',
				'launcher': '取证',
				'launcher.title': '打开现场取证台（录屏 + 日志对齐）',
				'title': '现场取证台',
				'phase.idle': '待命',
				'phase.recording': '录制中',
				'phase.review': '复看',
				'btn.settings': '设置',
				'btn.start': '开始录制',
				'btn.stop': '停止录制',
				'btn.marker': '打点',
				'btn.marker.title': '在当前时刻放一个标记（问题发生的那一刻按一下）',
				'btn.save': '保存配置',
				'btn.saved': '已保存',
				'btn.probe': '检测',
				'btn.add.source': '添加日志源',
				'btn.add.profile': '新建配置',
				'btn.delete': '删除',
				'btn.export': '生成产物',
				'btn.deliver': '填进输入框',
				'btn.send': '直接发送',
				'btn.big': '放大',
				'btn.big.off': '还原',
				'btn.open.dir': '打开目录',
				'btn.play': '播放',
				'btn.pause': '暂停',
				'btn.reset': '重来',
				'idle.hint': '点「开始录制」后，画面与日志会一起记录；出问题时按「打点」，然后停止录制，在时间轴上圈出问题那几秒。',
				'idle.profile': '当前配置',
				'idle.noSource': '还没有可用的日志源：打开设置填一个日志文件路径，或者只录画面。',
				'idle.capture': '采集源',
				'idle.capture.pick': '选择要录制的窗口或屏幕',
				'idle.capture.native': '桌面端可直接抓帧',
				'idle.capture.gdi': '当前宿主用 Windows 抓屏助手抓帧（整个桌面，多显示器取并集）',
				'idle.capture.browser': '浏览器端将请求屏幕共享权限',
				'idle.capture.unavailable': '当前宿主不支持抓帧',
				'idle.recent': '最近的取证',
				'idle.recent.empty': '这个工作区还没有取证记录。',
				'rec.elapsed': '已录',
				'rec.events': '条事件',
				'rec.frames': '帧',
				'rec.input': '输入',
				'rec.input.arming': '输入记录启动中…',
				'rec.input.ready': '输入记录就绪',
				'rec.input.off': '输入记录已关闭',
				'rec.input.error': '输入记录出错：{msg}',
				'rec.input.keys': '{n} 按键',
				'rec.input.clicks': '{n} 点击',
				'rec.input.held': '按住中',
				'rec.waiting': '等待日志文件…',
				'rec.source.ok': '跟随中',
				'rec.noFrame': '还没有画面（检查采集源是否关闭）',
				'review.range': '区间',
				'review.from': '起点',
				'review.to': '终点',
				'review.all': '全部',
				'review.last8': '最后 8 秒',
				'review.marker': '打点前后 3 秒',
				'review.setFrom': '设为起点',
				'review.setTo': '设为终点',
				'review.events': '事件',
				'review.events.empty': '这个区间内没有事件。',
				'review.input': '输入',
				'review.input.show': '展开',
				'review.input.hide': '收起',
				'review.input.empty': '这个区间内没有键鼠输入。',
				'review.input.anchor': '前一条输入：{name}{where} {delta}s 前',
				'review.input.seek': '跳到这一条输入对应的画面',
				'review.onlyProblems': '只看错误/警告',
				'review.search': '搜索…',
				'review.annotations': '画面标注',
				'review.annotations.hint': '在画面上拖出红框，圈出问题位置',
				'review.annotation.note': '这个框说明什么？（可留空）',
				'review.annotation.count': '区域内已画',
				'review.desc': '问题描述',
				'review.desc.placeholder': '用一句话说清现象：什么时候、做了什么、哪里不对。',
				'review.title': '标题',
				'review.title.placeholder': '取证标题（会写进文件名与纪要）',
				'review.artifacts': '产物',
				'review.artifacts.empty': '还没有生成产物。',
				'review.frames.count': '帧',
				'settings.profiles': '配置',
				'settings.name': '配置名',
				'settings.note': '说明',
				'settings.sources': '日志源',
				'settings.source.label': '名称',
				'settings.source.path': '日志文件路径',
				'settings.source.path.hint': '绝对路径，或相对当前工作区。文件可以稍后才出现（先开录制再开游戏也行）。',
				'settings.source.enabled': '启用',
				'settings.source.color': '颜色',
				'settings.source.preRoll': '录制前回看历史尾部',
				'settings.input': '键鼠输入记录',
				'settings.input.enable': '记录按键与鼠标',
				'settings.input.process': '目标进程名，例如 Remains',
				'settings.input.process.hint': '填游戏的可执行文件名（.exe 可省略），可逗号分隔多个。只有它在前台时才记录键鼠，切到别的窗口就暂停。',
				'settings.input.scope': '记录范围',
				'settings.input.scope.target': '仅目标程序在前台时',
				'settings.input.scope.all': '除本插件外的所有前台窗口',
				'settings.input.trail': '记录指针轨迹',
				'settings.input.poll': '采样间隔',
				'settings.input.privacy': '只记录「哪个键按下/抬起、鼠标点在哪」，不记录任何文字内容，也不安装键盘钩子。',
				'settings.input.unavailable': '这台宿主用不了输入记录：{reason}',
				'settings.input.noTarget': '未设目标进程（设置里填游戏进程名）',
				'settings.input.ready': '输入助手可用（{keys} 个键位）',
				'settings.ingest': '也可以让程序直接推事件',
				'settings.ingest.hint': 'POST /dsh-incident-studio/api/ingest，带 header x-incident-token（值见下方）',
				'settings.ingest.token': '令牌',
				'msg.loading': '加载中…',
				'msg.saving': '保存中…',
				'msg.exporting': '正在生成产物…',
				'msg.delivering': '正在递交…',
				'msg.stopping': '正在收尾…',
				'msg.copied': '已复制到剪贴板',
				'msg.noSession': '拿不到当前会话，无法填入输入框；内容已复制到剪贴板。',
				'msg.delivered': '已填进输入框，检查无误后回车发送。',
				'msg.sent': '已发送。',
				'msg.attachRefused': '（附件没登记成功——输入框正忙，请稍后重试或手动把图片拖进去）',
				'msg.needDescription': '请先写一句问题描述。',
				'msg.needRange': '区间里没有画面帧，请调整区间。',
				'msg.artifactReady': '产物已生成并落盘。',
				'msg.captureFail': '无法开始采集：',
				'err.generic': '操作失败',
				'unit.s': '秒',
				'unit.frame': '帧',
			},
			en: {
				'tab.title': 'Incident Studio',
				'tab.desc': 'Screen frames + logs on one timeline, annotated for an agent',
				'launcher': 'Capture',
				'launcher.title': 'Open Incident Studio (screen + log alignment)',
				'title': 'Incident Studio',
				'phase.idle': 'idle',
				'phase.recording': 'recording',
				'phase.review': 'review',
				'btn.settings': 'Settings',
				'btn.start': 'Start recording',
				'btn.stop': 'Stop',
				'btn.marker': 'Mark',
				'btn.marker.title': 'Drop a marker at this instant',
				'btn.save': 'Save',
				'btn.saved': 'Saved',
				'btn.probe': 'Check',
				'btn.add.source': 'Add source',
				'btn.add.profile': 'New profile',
				'btn.delete': 'Delete',
				'btn.export': 'Build artifacts',
				'btn.deliver': 'Fill composer',
				'btn.send': 'Send now',
				'btn.big': 'Expand',
				'btn.big.off': 'Restore',
				'btn.open.dir': 'Open folder',
				'btn.play': 'Play',
				'btn.pause': 'Pause',
				'btn.reset': 'Reset',
				'idle.hint': 'Press Start to record screen and logs together; hit Mark when it breaks, then stop and select the few seconds that matter.',
				'idle.profile': 'Profile',
				'idle.noSource': 'No log source yet: add a log file path in Settings, or record video only.',
				'idle.capture': 'Capture source',
				'idle.capture.pick': 'Pick a window or screen',
				'idle.capture.native': 'Native frame capture available',
				'idle.capture.gdi': 'Using the Windows screen-grab helper (whole desktop, all monitors)',
				'idle.capture.browser': 'The browser will ask for screen sharing',
				'idle.capture.unavailable': 'Frame capture is unavailable here',
				'idle.recent': 'Recent captures',
				'idle.recent.empty': 'No captures in this workspace yet.',
				'rec.elapsed': 'elapsed',
				'rec.events': 'events',
				'rec.frames': 'frames',
				'rec.input': 'input',
				'rec.input.arming': 'input recorder starting…',
				'rec.input.ready': 'input recorder ready',
				'rec.input.off': 'input recording is off',
				'rec.input.error': 'input recorder error: {msg}',
				'rec.input.keys': '{n} keys',
				'rec.input.clicks': '{n} clicks',
				'rec.input.held': 'held',
				'rec.waiting': 'waiting for log file…',
				'rec.source.ok': 'following',
				'rec.noFrame': 'No frames yet (is the capture source still open?)',
				'review.range': 'Range',
				'review.from': 'start',
				'review.to': 'end',
				'review.all': 'All',
				'review.last8': 'Last 8s',
				'review.marker': '±3s around mark',
				'review.setFrom': 'Set start',
				'review.setTo': 'Set end',
				'review.events': 'Events',
				'review.events.empty': 'No events in this range.',
				'review.input': 'Input',
				'review.input.show': 'Show',
				'review.input.hide': 'Hide',
				'review.input.empty': 'No keyboard or mouse input in this range.',
				'review.input.anchor': 'last input: {name}{where} {delta}s before',
				'review.input.seek': 'Jump to the frame for this input',
				'review.onlyProblems': 'Only errors/warnings',
				'review.search': 'Search…',
				'review.annotations': 'Annotations',
				'review.annotations.hint': 'Drag on the frame to box the problem',
				'review.annotation.note': 'What does this box show? (optional)',
				'review.annotation.count': 'drawn in range',
				'review.desc': 'What went wrong',
				'review.desc.placeholder': 'One sentence: when, what you did, what looked wrong.',
				'review.title': 'Title',
				'review.title.placeholder': 'Capture title (used in file names and the note)',
				'review.artifacts': 'Artifacts',
				'review.artifacts.empty': 'Nothing built yet.',
				'review.frames.count': 'frames',
				'settings.profiles': 'Profiles',
				'settings.name': 'Profile name',
				'settings.note': 'Note',
				'settings.sources': 'Log sources',
				'settings.source.label': 'Label',
				'settings.source.path': 'Log file path',
				'settings.source.path.hint': 'Absolute, or relative to the workspace. The file may appear later.',
				'settings.source.enabled': 'Enabled',
				'settings.source.color': 'Color',
				'settings.source.preRoll': 'Include the tail from before recording',
				'settings.input': 'Keyboard/mouse input',
				'settings.input.enable': 'Record keys and mouse',
				'settings.input.process': 'Target process, e.g. Remains',
				'settings.input.process.hint': 'The game executable (".exe" optional), comma separated. Keys are only recorded while it owns the foreground window.',
				'settings.input.scope': 'Scope',
				'settings.input.scope.target': 'Only while a target is in front',
				'settings.input.scope.all': 'Any foreground window except this plugin',
				'settings.input.trail': 'Record pointer path',
				'settings.input.poll': 'Sample interval',
				'settings.input.privacy': 'Only records which key went down/up and where the mouse clicked - no text, and no keyboard hooks.',
				'settings.input.unavailable': 'Input recording is unavailable here: {reason}',
				'settings.input.noTarget': 'no target process yet (set the game exe in Settings)',
				'settings.input.ready': 'Input helper ready ({keys} keys)',
				'settings.ingest': 'Programs can push events too',
				'settings.ingest.hint': 'POST /dsh-incident-studio/api/ingest with header x-incident-token',
				'settings.ingest.token': 'token',
				'msg.loading': 'Loading…',
				'msg.saving': 'Saving…',
				'msg.exporting': 'Building artifacts…',
				'msg.delivering': 'Delivering…',
				'msg.stopping': 'Finishing…',
				'msg.copied': 'Copied to clipboard',
				'msg.noSession': 'No session available; copied to clipboard instead.',
				'msg.delivered': 'Filled into the composer — review and press Enter.',
				'msg.sent': 'Sent.',
				'msg.attachRefused': '(attachments were not accepted — the composer is busy; retry or drop the images in manually)',
				'msg.needDescription': 'Write one sentence about the problem first.',
				'msg.needRange': 'No frames in this range; adjust it.',
				'msg.artifactReady': 'Artifacts built and saved.',
				'msg.captureFail': 'Cannot start capture: ',
				'err.generic': 'Operation failed',
				'unit.s': 's',
				'unit.frame': 'frames',
			},
		};

		/**
		 * 取一条文案。
		 * @param key 文案键。
		 * @param vars 可选的 {name} 占位替换。
		 * @returns 当前语言下的文本，缺失时回退到键名。
		 */
		function t(key, vars) {
			const table = STRINGS[IS_ZH ? 'zh' : 'en'];
			let text = table[key] ?? STRINGS.zh[key] ?? key;
			if (vars !== null && typeof vars === 'object') {
				for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, String(value));
			}
			return text;
		}

		/* ------------------------------------------------------------------ */
		/* 样式：全部走 DSH 的 --dsw-* 变量，跟随亮/暗主题                     */
		/* ------------------------------------------------------------------ */

		const STYLE_ID = 'dsh-incident-studio/styles';

		const CSS = `
.dshis{display:flex;flex-direction:column;height:100%;min-height:0;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary,#1f2328)}
.dshis *{box-sizing:border-box}
.dshis-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-line-lighter,var(--dsw-alias-border-l2,rgba(0,0,0,.08)))}
.dshis-head-title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshis-phase{font-size:11px;padding:1px 6px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-secondary,#57606a);white-space:nowrap}
.dshis-phase.is-rec{background:rgba(220,50,50,.14);color:#c22}
.dshis-row{display:flex;align-items:center;gap:6px}
.dshis-col{display:flex;flex-direction:column;gap:6px}
.dshis-wrap{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dshis-grow{flex:1;min-width:0}
.dshis-muted{color:var(--dsw-alias-label-tertiary,#8b949e);font-size:11px}
.dshis-scroll{flex:1;min-height:0;overflow:auto;padding:8px 10px;display:flex;flex-direction:column;gap:8px}
.dshis-empty{color:var(--dsw-alias-label-tertiary,#8b949e);font-size:12px;padding:10px;border:1px dashed var(--dsw-alias-line-lighter,rgba(0,0,0,.12));border-radius:10px;text-align:center}
.dshis-sep{height:1px;background:var(--dsw-alias-line-lighter,rgba(0,0,0,.08));margin:2px 0}
.dshis-btn{appearance:none;font:inherit;font-size:12px;line-height:18px;padding:4px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));background:var(--dsw-alias-bg-module-platform,transparent);color:inherit;cursor:pointer;white-space:nowrap}
.dshis-btn:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.dshis-btn[disabled]{opacity:.5;cursor:default}
.dshis-btn.primary{background:#1f6feb;border-color:#1f6feb;color:#fff}
.dshis-btn.primary:hover:not([disabled]){background:#1a5fd0}
.dshis-btn.danger{background:rgba(220,50,50,.12);border-color:rgba(220,50,50,.45);color:#c22}
.dshis-btn.ghost{border-color:transparent;background:transparent;padding:2px 6px}
.dshis-btn.sm{font-size:11px;padding:2px 7px;border-radius:7px}
.dshis-input,.dshis-textarea,.dshis-select{width:100%;font:inherit;font-size:12px;padding:4px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));background:var(--dsw-alias-bg-layer-3,transparent);color:inherit}
.dshis-input:focus,.dshis-textarea:focus,.dshis-select:focus{outline:1px solid #1f6feb;outline-offset:0}
.dshis-textarea{resize:vertical;min-height:56px;line-height:19px}
.dshis-card{border:1px solid var(--dsw-alias-line-lighter,rgba(0,0,0,.1));border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-module-platform,transparent)}
.dshis-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:2px 8px;border-radius:9px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));max-width:100%}
.dshis-dot{width:7px;height:7px;border-radius:50%;flex:none}
.dshis-stage{position:relative;border-radius:10px;overflow:hidden;background:#0b0b0d;min-height:110px;display:flex;align-items:center;justify-content:center}
.dshis-stage img{display:block;width:100%;height:auto;max-height:46vh;object-fit:contain}
.dshis-stage.is-big{position:fixed;inset:16px;z-index:60;min-height:0;box-shadow:0 18px 60px rgba(0,0,0,.5)}
.dshis-stage.is-big img{max-height:calc(100vh - 92px)}
.dshis-overlay{position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;touch-action:none}
.dshis-stage-bar{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:6px;padding:4px 8px;background:linear-gradient(to top,rgba(0,0,0,.62),rgba(0,0,0,0));color:#fff;font-size:11px}
.dshis-stage-bar .dshis-btn{background:rgba(255,255,255,.14);border-color:transparent;color:#fff;padding:1px 8px}
.dshis-slider{display:flex;align-items:center;gap:8px}
.dshis-slider input[type=range]{flex:1;min-width:0;accent-color:#1f6feb}
.dshis-event{display:flex;gap:6px;padding:2px 4px;border-radius:6px;cursor:pointer;align-items:baseline}
.dshis-event:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dshis-event.is-active{background:rgba(31,111,235,.14)}
.dshis-event-time{flex:none;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#8b949e);font-size:11px}
.dshis-event-src{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary,#8b949e);border:1px solid var(--dsw-alias-line-lighter,rgba(0,0,0,.12));border-radius:5px;padding:0 4px}
.dshis-event-text{flex:1;min-width:0;word-break:break-word;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px}
.dshis-event.is-error .dshis-event-text{color:#d1242f}
.dshis-event.is-warn .dshis-event-text{color:#9a6700}
.dshis-event.is-pre{opacity:.62}
.dshis-anno{display:flex;gap:6px;align-items:center;padding:4px 6px;border-radius:8px;border:1px solid var(--dsw-alias-line-lighter,rgba(0,0,0,.1))}
.dshis-anno.is-active{border-color:#d1242f;background:rgba(209,36,47,.07)}
.dshis-anno-idx{flex:none;width:16px;height:16px;border-radius:50%;background:#d1242f;color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center}
.dshis-notice{border-radius:8px;padding:6px 8px;font-size:11px;line-height:16px}
.dshis-notice.ok{background:rgba(31,111,235,.1);color:var(--dsw-alias-label-secondary,#57606a)}
.dshis-notice.err{background:rgba(209,36,47,.12);color:#d1242f}
.dshis-badge{font-size:10px;padding:0 5px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-secondary,#57606a);white-space:nowrap}
.dshis-launcher{display:flex;align-items:center;gap:6px;font-size:11px}
.dshis-launcher .dshis-btn{font-size:11px;padding:1px 8px}
.dshis-input-hud{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;min-height:18px}
.dshis-key{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;line-height:15px;padding:0 5px;border-radius:5px;border:1px solid var(--dsw-alias-line-lighter,rgba(0,0,0,.12));background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dshis-key.is-down{background:rgba(31,111,235,.18);border-color:rgba(31,111,235,.45);color:#1f6feb}
.dshis-event.is-input .dshis-event-text{color:var(--dsw-alias-label-secondary,#57606a)}
.dshis-event.is-input .dshis-event-src{border:none;background:transparent;font-size:11px;padding:0;width:14px;text-align:center}
.dshis-input-list{max-height:240px;overflow:auto;border:1px solid var(--dsw-alias-line-lighter,rgba(0,0,0,.1));border-radius:8px;padding:2px 4px}
.dshis-src-row{display:grid;grid-template-columns:56px 1fr auto;gap:6px;align-items:center}
.dshis-hidden{display:none}
`;

		/**
		 * 注入样式表（幂等：同一个 STYLE_ID 只注入一次）。
		 * @returns 卸载函数。
		 */
		function installStyles() {
			if (typeof document === 'undefined') return () => {};
			const existing = document.querySelector(`style[data-dshis=${JSON.stringify(STYLE_ID)}]`);
			if (existing !== null) return () => {};
			const style = document.createElement('style');
			style.dataset.dshis = STYLE_ID;
			style.textContent = CSS;
			document.head.append(style);
			return () => style.remove();
		}

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

// 本文件由 tools/vendor-gifenc.mjs 自动生成，不要手工编辑。
// 来源：gifenc@1.0.3（https://github.com/mattdesl/gifenc），MIT 许可，原文如下。
// The MIT License (MIT)
// Copyright (c) 2017 Matt DesLauriers
// 
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// 
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
// IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
// OR OTHER DEALINGS IN THE SOFTWARE.
// 
// 
//
// 只保留 GIFEncoder / quantize / applyPalette / prequantize，供现场取证台在浏览器内
// 把截取区间编码成动图 GIF（不依赖任何外部程序）。
const GIFENC = (function () {
var X={signature:"GIF",version:"89a",trailer:59,extensionIntroducer:33,applicationExtensionLabel:255,graphicControlExtensionLabel:249,imageSeparator:44,signatureSize:3,versionSize:3,globalColorTableFlagMask:128,colorResolutionMask:112,sortFlagMask:8,globalColorTableSizeMask:7,applicationIdentifierSize:8,applicationAuthCodeSize:3,disposalMethodMask:28,userInputFlagMask:2,transparentColorFlagMask:1,localColorTableFlagMask:128,interlaceFlagMask:64,idSortFlagMask:32,localColorTableSizeMask:7};function F(t=256){let e=0,s=new Uint8Array(t);return{get buffer(){return s.buffer},reset(){e=0},bytesView(){return s.subarray(0,e)},bytes(){return s.slice(0,e)},writeByte(r){n(e+1),s[e]=r,e++},writeBytes(r,o=0,i=r.length){n(e+i);for(let c=0;c<i;c++)s[e++]=r[c+o]},writeBytesView(r,o=0,i=r.byteLength){n(e+i),s.set(r.subarray(o,o+i),e),e+=i}};function n(r){var o=s.length;if(o>=r)return;var i=1024*1024;r=Math.max(r,o*(o<i?2:1.125)>>>0),o!=0&&(r=Math.max(r,256));let c=s;s=new Uint8Array(r),e>0&&s.set(c.subarray(0,e),0)}}var O=12,J=5003,lt=[0,1,3,7,15,31,63,127,255,511,1023,2047,4095,8191,16383,32767,65535];function at(t,e,s,n,r=F(512),o=new Uint8Array(256),i=new Int32Array(J),c=new Int32Array(J)){let x=i.length,a=Math.max(2,n);o.fill(0),c.fill(0),i.fill(-1);let l=0,f=0,g=a+1,h=g,b=!1,w=h,_=(1<<w)-1,u=1<<g-1,k=u+1,B=u+2,p=0,A=s[0],z=0;for(let y=x;y<65536;y*=2)++z;z=8-z,r.writeByte(a),I(u);let d=s.length;for(let y=1;y<d;y++){t:{let m=s[y],v=(m<<O)+A,M=m<<z^A;if(i[M]===v){A=c[M];break t}let V=M===0?1:x-M;for(;i[M]>=0;)if(M-=V,M<0&&(M+=x),i[M]===v){A=c[M];break t}I(A),A=m,B<1<<O?(c[M]=B++,i[M]=v):(i.fill(-1),B=u+2,b=!0,I(u))}}return I(A),I(k),r.writeByte(0),r.bytesView();function I(y){for(l&=lt[f],f>0?l|=y<<f:l=y,f+=w;f>=8;)o[p++]=l&255,p>=254&&(r.writeByte(p),r.writeBytesView(o,0,p),p=0),l>>=8,f-=8;if((B>_||b)&&(b?(w=h,_=(1<<w)-1,b=!1):(++w,_=w===O?1<<w:(1<<w)-1)),y==k){for(;f>0;)o[p++]=l&255,p>=254&&(r.writeByte(p),r.writeBytesView(o,0,p),p=0),l>>=8,f-=8;p>0&&(r.writeByte(p),r.writeBytesView(o,0,p),p=0)}}}var $=at;function D(t,e,s){return t<<8&63488|e<<2&992|s>>3}function G(t,e,s,n){return t>>4|e&240|(s&240)<<4|(n&240)<<8}function j(t,e,s){return t>>4<<8|e&240|s>>4}function R(t,e,s){return t<e?e:t>s?s:t}function T(t){return t*t}function tt(t,e,s){var n=0,r=1e100;let o=t[e],i=o.cnt,c=o.ac,x=o.rc,a=o.gc,l=o.bc;for(var f=o.fw;f!=0;f=t[f].fw){let h=t[f],b=h.cnt,w=i*b/(i+b);if(!(w>=r)){var g=0;s&&(g+=w*T(h.ac-c),g>=r)||(g+=w*T(h.rc-x),!(g>=r)&&(g+=w*T(h.gc-a),!(g>=r)&&(g+=w*T(h.bc-l),!(g>=r)&&(r=g,n=f))))}}o.err=r,o.nn=n}function Q(){return{ac:0,rc:0,gc:0,bc:0,cnt:0,nn:0,fw:0,bk:0,tm:0,mtm:0,err:0}}function ut(t,e){let s=e==="rgb444"?4096:65536,n=new Array(s),r=t.length;if(e==="rgba4444")for(let o=0;o<r;++o){let i=t[o],c=i>>24&255,x=i>>16&255,a=i>>8&255,l=i&255,f=G(l,a,x,c),g=f in n?n[f]:n[f]=Q();g.rc+=l,g.gc+=a,g.bc+=x,g.ac+=c,g.cnt++}else if(e==="rgb444")for(let o=0;o<r;++o){let i=t[o],c=i>>16&255,x=i>>8&255,a=i&255,l=j(a,x,c),f=l in n?n[l]:n[l]=Q();f.rc+=a,f.gc+=x,f.bc+=c,f.cnt++}else for(let o=0;o<r;++o){let i=t[o],c=i>>16&255,x=i>>8&255,a=i&255,l=D(a,x,c),f=l in n?n[l]:n[l]=Q();f.rc+=a,f.gc+=x,f.bc+=c,f.cnt++}return n}function H(t,e,s={}){let{format:n="rgb565",clearAlpha:r=!0,clearAlphaColor:o=0,clearAlphaThreshold:i=0,oneBitAlpha:c=!1}=s;if(!t||!t.buffer)throw new Error("quantize() expected RGBA Uint8Array data");if(!(t instanceof Uint8Array)&&!(t instanceof Uint8ClampedArray))throw new Error("quantize() expected RGBA Uint8Array data");let x=new Uint32Array(t.buffer),a=s.useSqrt!==!1,l=n==="rgba4444",f=ut(x,n),g=f.length,h=g-1,b=new Uint32Array(g+1);for(var w=0,u=0;u<g;++u){let C=f[u];if(C!=null){var _=1/C.cnt;l&&(C.ac*=_),C.rc*=_,C.gc*=_,C.bc*=_,f[w++]=C}}T(e)/w<.022&&(a=!1);for(var u=0;u<w-1;++u)f[u].fw=u+1,f[u+1].bk=u,a&&(f[u].cnt=Math.sqrt(f[u].cnt));a&&(f[u].cnt=Math.sqrt(f[u].cnt));var k,B,p;for(u=0;u<w;++u){tt(f,u,!1);var A=f[u].err;for(B=++b[0];B>1&&(p=B>>1,!(f[k=b[p]].err<=A));B=p)b[B]=k;b[B]=u}var z=w-e;for(u=0;u<z;){for(var d;;){var I=b[1];if(d=f[I],d.tm>=d.mtm&&f[d.nn].mtm<=d.tm)break;d.mtm==h?I=b[1]=b[b[0]--]:(tt(f,I,!1),d.tm=u);var A=f[I].err;for(B=1;(p=B+B)<=b[0]&&(p<b[0]&&f[b[p]].err>f[b[p+1]].err&&p++,!(A<=f[k=b[p]].err));B=p)b[B]=k;b[B]=I}var y=f[d.nn],m=d.cnt,v=y.cnt,_=1/(m+v);l&&(d.ac=_*(m*d.ac+v*y.ac)),d.rc=_*(m*d.rc+v*y.rc),d.gc=_*(m*d.gc+v*y.gc),d.bc=_*(m*d.bc+v*y.bc),d.cnt+=y.cnt,d.mtm=++u,f[y.bk].fw=y.fw,f[y.fw].bk=y.bk,y.mtm=h}let M=[];var V=0;for(u=0;;++V){let L=R(Math.round(f[u].rc),0,255),C=R(Math.round(f[u].gc),0,255),Y=R(Math.round(f[u].bc),0,255),E=255;if(l){if(E=R(Math.round(f[u].ac),0,255),c){let st=typeof c=="number"?c:127;E=E<=st?0:255}r&&E<=i&&(L=C=Y=o,E=0)}let K=l?[L,C,Y,E]:[L,C,Y];if(xt(M,K)||M.push(K),(u=f[u].fw)==0)break}return M}function xt(t,e){for(let s=0;s<t.length;s++){let n=t[s],r=n[0]===e[0]&&n[1]===e[1]&&n[2]===e[2],o=n.length>=4&&e.length>=4?n[3]===e[3]:!0;if(r&&o)return!0}return!1}function U(t,e){var s=0,n;for(n=0;n<t.length;n++){let r=t[n]-e[n];s+=r*r}return s}function P(t,e){return e>1?Math.round(t/e)*e:t}function et(t,{roundRGB:e=5,roundAlpha:s=10,oneBitAlpha:n=null}={}){let r=new Uint32Array(t.buffer);for(let o=0;o<r.length;o++){let i=r[o],c=i>>24&255,x=i>>16&255,a=i>>8&255,l=i&255;if(c=P(c,s),n){let f=typeof n=="number"?n:127;c=c<=f?0:255}l=P(l,e),a=P(a,e),x=P(x,e),r[o]=c<<24|x<<16|a<<8|l<<0}}function nt(t,e,s="rgb565"){if(!t||!t.buffer)throw new Error("quantize() expected RGBA Uint8Array data");if(!(t instanceof Uint8Array)&&!(t instanceof Uint8ClampedArray))throw new Error("quantize() expected RGBA Uint8Array data");if(e.length>256)throw new Error("applyPalette() only works with 256 colors or less");let n=new Uint32Array(t.buffer),r=n.length,o=s==="rgb444"?4096:65536,i=new Uint8Array(r),c=new Array(o),x=s==="rgba4444";if(s==="rgba4444")for(let a=0;a<r;a++){let l=n[a],f=l>>24&255,g=l>>16&255,h=l>>8&255,b=l&255,w=G(b,h,g,f),_=w in c?c[w]:c[w]=gt(b,h,g,f,e);i[a]=_}else{let a=s==="rgb444"?j:D;for(let l=0;l<r;l++){let f=n[l],g=f>>16&255,h=f>>8&255,b=f&255,w=a(b,h,g),_=w in c?c[w]:c[w]=bt(b,h,g,e);i[l]=_}}return i}function gt(t,e,s,n,r){let o=0,i=1e100;for(let c=0;c<r.length;c++){let x=r[c],a=x[3],l=q(a-n);if(l>i)continue;let f=x[0];if(l+=q(f-t),l>i)continue;let g=x[1];if(l+=q(g-e),l>i)continue;let h=x[2];l+=q(h-s),!(l>i)&&(i=l,o=c)}return o}function bt(t,e,s,n){let r=0,o=1e100;for(let i=0;i<n.length;i++){let c=n[i],x=c[0],a=q(x-t);if(a>o)continue;let l=c[1];if(a+=q(l-e),a>o)continue;let f=c[2];a+=q(f-s),!(a>o)&&(o=a,r=i)}return r}function rt(t,e,s=5){if(!t.length||!e.length)return;let n=t.map(i=>i.slice(0,3)),r=s*s,o=t[0].length;for(let i=0;i<e.length;i++){let c=e[i];c.length<o?c=[c[0],c[1],c[2],255]:c.length>o?c=c.slice(0,3):c=c.slice();let x=N(n,c.slice(0,3),U),a=x[0],l=x[1];l>0&&l<=r&&(t[a]=c)}}function q(t){return t*t}function W(t,e,s=U){let n=Infinity,r=-1;for(let o=0;o<t.length;o++){let i=t[o],c=s(e,i);c<n&&(n=c,r=o)}return r}function N(t,e,s=U){let n=Infinity,r=-1;for(let o=0;o<t.length;o++){let i=t[o],c=s(e,i);c<n&&(n=c,r=o)}return[r,n]}function ot(t,e,s=U){return t[W(t,e,s)]}function ct(t={}){let{initialCapacity:e=4096,auto:s=!0}=t,n=F(e),r=5003,o=new Uint8Array(256),i=new Int32Array(r),c=new Int32Array(r),x=!1;return{reset(){n.reset(),x=!1},finish(){n.writeByte(X.trailer)},bytes(){return n.bytes()},bytesView(){return n.bytesView()},get buffer(){return n.buffer},get stream(){return n},writeHeader:a,writeFrame(l,f,g,h={}){let{transparent:b=!1,transparentIndex:w=0,delay:_=0,palette:u=null,repeat:k=0,colorDepth:B=8,dispose:p=-1}=h,A=!1;if(s?x||(A=!0,a(),x=!0):A=Boolean(h.first),f=Math.max(0,Math.floor(f)),g=Math.max(0,Math.floor(g)),A){if(!u)throw new Error("First frame must include a { palette } option");pt(n,f,g,u,B),it(n,u),k>=0&&dt(n,k)}let z=Math.round(_/10);wt(n,p,z,b,w);let d=Boolean(u)&&!A;ht(n,f,g,d?u:null),d&&it(n,u),yt(n,l,f,g,B,o,i,c)}};function a(){ft(n,"GIF89a")}}function wt(t,e,s,n,r){t.writeByte(33),t.writeByte(249),t.writeByte(4),r<0&&(r=0,n=!1);var o,i;n?(o=1,i=2):(o=0,i=0),e>=0&&(i=e&7),i<<=2;let c=0;t.writeByte(0|i|c|o),S(t,s),t.writeByte(r||0),t.writeByte(0)}function pt(t,e,s,n,r=8){let o=1,i=0,c=Z(n.length)-1,x=o<<7|r-1<<4|i<<3|c,a=0,l=0;S(t,e),S(t,s),t.writeBytes([x,a,l])}function dt(t,e){t.writeByte(33),t.writeByte(255),t.writeByte(11),ft(t,"NETSCAPE2.0"),t.writeByte(3),t.writeByte(1),S(t,e),t.writeByte(0)}function it(t,e){let s=1<<Z(e.length);for(let n=0;n<s;n++){let r=[0,0,0];n<e.length&&(r=e[n]),t.writeByte(r[0]),t.writeByte(r[1]),t.writeByte(r[2])}}function ht(t,e,s,n){if(t.writeByte(44),S(t,0),S(t,0),S(t,e),S(t,s),n){let r=0,o=0,i=Z(n.length)-1;t.writeByte(128|r|o|0|i)}else t.writeByte(0)}function yt(t,e,s,n,r=8,o,i,c){$(s,n,e,r,t,o,i,c)}function S(t,e){t.writeByte(e&255),t.writeByte(e>>8&255)}function ft(t,e){for(var s=0;s<e.length;s++)t.writeByte(e.charCodeAt(s))}function Z(t){return Math.max(Math.ceil(Math.log2(t)),1)}var Bt=ct;
return { GIFEncoder: ct, applyPalette: nt, prequantize: et, quantize: H };
})();

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
			const [inputs, setInputs] = useState([]);
			const [frames, setFrames] = useState([]);
			const [showInputs, setShowInputs] = useState(false);
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
						input: activeProfile?.input ?? {},
					});
					if (!started.ok) {
						setNotice({ level: 'err', text: started.message ?? t('err.generic') });
						return;
					}
					setRec(started.value.recording);
					setStartedAt(Number(started.value.recording?.t0) || now);
					setElapsed(0);
					setEvents([]);
					setInputs([]);
					setShowInputs(false);
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
					// 输入记录在停止时已经收尾归档，这里一次性取回，用于复看与递交摘要。
					const inputResult = await API.input(0);
					if (inputResult.ok) {
						setInputs(Array.isArray(inputResult.value?.inputs) ? inputResult.value.inputs : []);
						if (!stopped.ok) setRec((previous) => (previous === null ? previous : { ...previous, input: inputResult.value?.input ?? previous.input }));
					}

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
					const anchor = describeAnchor(result.value.anchor ?? result.value.event.anchor);
					setNotice({
						level: 'ok',
						text: anchor === ''
							? `已打点：${formatRel(result.value.event.relMs)}`
							: `已打点：${formatRel(result.value.event.relMs)}（${anchor}）`,
					});
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
					});					if (!result.ok) {
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
						inputInfo: typeof result.value.inputInfo === 'string' ? result.value.inputInfo : '',
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
			const inRangeInputs = useMemo(() => filterInputs(inputs, fromRel, toRel), [inputs, fromRel, toRel]);
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
						inputCapability: boot?.state?.input ?? null,
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
						{ className: 'dshis-row dshis-wrap' },
						h('span', { className: 'dshis-muted' }, t('rec.input')),
						typeof boot?.state?.input?.probedAt !== 'string' || boot.state.input.probedAt === ''
							? h('span', { className: 'dshis-muted' }, t('rec.input.arming'))
							: boot?.state?.input?.available !== true
								? h(
									'span',
									{ className: 'dshis-badge' },
									t('settings.input.unavailable', { reason: boot?.state?.input?.reason || '—' }),
								)
								: activeProfile?.input?.enabled === false
									? h('span', { className: 'dshis-badge' }, t('rec.input.off'))
									: (activeProfile?.input?.targets ?? '') === ''
										? h('span', { className: 'dshis-badge', style: { color: '#9a6700' } }, t('settings.input.noTarget'))
										: h(
											'span',
											{ className: 'dshis-badge' },
											`${activeProfile.input.targets}${activeProfile.input.scope === 'all' ? ' · all' : ''}`,
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
					h(InputHud, { input: rec?.input }),
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
					h(
						'div',
						{ className: 'dshis-col' },
						h(
							'div',
							{ className: 'dshis-row dshis-wrap' },
							h('span', { className: 'dshis-muted' }, `${t('review.input')} · ${inRangeInputs.length}`),
							inRangeInputs.length > 0 ? h('span', { className: 'dshis-badge' }, inputSummaryText(inRangeInputs)) : null,
							h('span', { className: 'dshis-grow' }),
							showInputs
								? h(Btn, { small: true, onClick: () => setShowInputs(false) }, t('review.input.hide'))
								: h(Btn, { small: true, onClick: () => setShowInputs(true) }, t('review.input.show')),
						),
						rec?.input?.reason ? h('div', { className: 'dshis-muted' }, `${t('rec.input')}：${rec.input.reason}`) : null,
						showInputs
							? h(InputList, { inputs: inRangeInputs, onSeek: (rel) => { setPlayhead(rel); setPlaying(false); } })
							: null,
					),
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
