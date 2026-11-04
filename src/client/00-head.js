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
