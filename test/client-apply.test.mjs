// test/client-apply.test.mjs — 在“假客户端运行时”里真正跑一遍 apply()。
//
// 覆盖三件事：
//   1. 侧边栏座位：tab 类型 / tab 正文 / composer 入口是否按约定注册；
//   2. 面板能否渲染出 HTML（React 服务端渲染跑一次，能挡住 hooks/JSX 崩）；
//   3. 递交链路：createDrafts → addAttachments → setDraft → submit。

import { createRequire } from 'node:module';
import { equal, ok, contains } from './harness.mjs';
import { loadClient } from './pure.test.mjs';

const require = createRequire(import.meta.url);

/**
 * 造一份假的客户端上下文，只实现本插件用过的那几个面。
 * @param options.acceptAttachments false 时模拟 composer 正忙、拒收附件。
 * @returns {{ctx: object, log: object}}
 */
function createFakeClientContext(options) {
	const acceptAttachments = options?.acceptAttachments !== false;
	const log = {
		tabs: [],
		slots: [],
		injects: [],
		effects: 0,
		opened: [],
		drafts: [],
		addedAttachments: [],
		draftText: '',
		submitted: 0,
		scopeCalls: [],
	};

	const conversation = {
		input: {
			for(actx) {
				log.scopeCalls.push(actx?.sessionId ?? null);
				return {
					setDraft(text) {
						log.draftText = text;
					},
					addAttachments(ids) {
						log.addedAttachments.push(...ids);
						return acceptAttachments;
					},
					submit() {
						log.submitted += 1;
					},
					state: { getSnapshot: () => ({ draft: log.draftText, draftRev: 1 }) },
					notify() {},
					focus() {},
				};
			},
		},
		createDrafts(sessionId, files) {
			log.drafts.push({ sessionId, count: files.length });
			return files.map((file, index) => ({ id: `draft-${index + 1}`, name: file.name }));
		},
	};

	const ctx = {
		effect(fn) {
			log.effects += 1;
			const dispose = fn();
			return () => dispose?.();
		},
		get(name) {
			if (name === 'sidebarRightTabs') {
				return {
					register(definition) {
						log.tabs.push(definition);
						return () => {};
					},
				};
			}
			if (name === 'sidebarRight') {
				return {
					openTab(kind, options) {
						log.opened.push({ kind, options });
					},
				};
			}
			if (name === 'conversation') return conversation;
			if (name === 'sessions') {
				return {
					list: { getSnapshot: () => ({ current: 'session-1' }) },
					scope(sessionId) {
						return { sessionId };
					},
				};
			}
			return undefined;
		},
		slots: {
			inject(name, factory) {
				log.injects.push(name);
				return factory();
			},
			register(definition, Component) {
				log.slots.push({ ...definition, Component });
				return () => {};
			},
		},
	};

	return { ctx, log };
}

/** 跑客户端集成断言。 */
export async function run() {
	const exported = await loadClient();
	const React = require('react');
	const { renderToStaticMarkup } = require('react-dom/server');

	const { ctx, log } = createFakeClientContext();
	exported.apply(ctx);

	// --- 座位注册 ---
	equal(log.tabs.length, 1, '注册了 1 个 tab 类型');
	const tab = log.tabs[0];
	equal(tab.id, 'dsh-incident-studio', 'tab 类型 id');
	equal(tab.kind, 'incident-studio', 'tab kind 与 openTab 对得上');
	equal(tab.keepMounted, true, 'tab 保留挂载（切走不丢状态）');
	equal(typeof tab.title, 'function', 'tab title 是函数（跟随语言）');
	ok(typeof tab.title('') === 'string' && tab.title('').length > 0, 'tab title 返回非空文案');
	ok(Array.isArray(tab.guide) && tab.guide.length === 1, '贡献 1 个引导页入口');
	equal(typeof tab.guide[0].title, 'function', '引导入口 title 是函数');
	equal(tab.guide[0].order, 25, '引导入口排序值');

	const bodySlot = log.slots.find((slot) => slot.name === 'sidebar.right.pane.tab');
	ok(bodySlot !== undefined, '注册了 sidebar.right.pane.tab 正文');
	equal(bodySlot.key, 'dsh-incident-studio', '正文座位 key 与 tab 类型 id 一致');
	ok(typeof bodySlot.Component === 'function', '正文座位是组件');

	const launcherSlot = log.slots.find((slot) => slot.name === 'conversation.composer.dock');
	ok(launcherSlot !== undefined, '注册了 composer 入口');
	equal(launcherSlot.order, 60, 'composer 入口排序值');

	ok(log.injects.includes('sidebar.right.pane.tab'), '正文注册走了 slot 声明注入');
	ok(log.injects.includes('conversation.composer.dock'), '入口注册走了 slot 声明注入');

	// --- 面板能渲染 ---
	const markup = renderToStaticMarkup(React.createElement(bodySlot.Component, { sessionId: 'session-1' }));
	ok(markup.length > 0, '面板渲染出 HTML');
	contains(markup, 'dshis', '面板带自己的样式类');
	contains(markup, '现场取证台', '面板渲染出标题');
	contains(markup, '开始录制', '待命态渲染出开始按钮');

	// --- composer 入口能渲染并打开面板 ---
	const launcherMarkup = renderToStaticMarkup(React.createElement(launcherSlot.Component, { sessionId: 'session-1' }));
	contains(launcherMarkup, '取证', '入口渲染出按钮文案');
	// 直接调用 runtime 的开面板动作（等价于点按钮）
	const runtime = exported.__runtime(ctx);
	runtime.openPanel();
	equal(log.opened.length, 1, 'openPanel 调用了 sidebarRight.openTab');
	equal(log.opened[0].kind, 'incident-studio', 'openPanel 打开的是取证台 kind');

	// --- 递交链路 ---
	equal(runtime.currentSessionId(), 'session-1', 'runtime 能读到当前会话');
	const fileA = new File([new Uint8Array([1, 2, 3])], 'frames.png', { type: 'image/png' });
	const fileB = new File([new Uint8Array([4, 5])], 'clip.gif', { type: 'image/gif' });
	const delivered = await runtime.deliver({
		sessionId: 'session-1',
		text: '## 现场取证\n正文',
		files: [fileA, fileB],
		autoSend: false,
	});
	equal(delivered.ok, true, 'deliver 返回成功');
	equal(delivered.attached, 2, 'deliver 报告成功登记的附件数');
	equal(delivered.attachRefused, false, 'deliver 报告附件没有被拒');
	equal(log.drafts.length, 1, '调用了一次 createDrafts');
	equal(log.drafts[0].sessionId, 'session-1', '草稿登记到了目标会话');
	equal(log.drafts[0].count, 2, '两个附件都交给了 createDrafts');
	equal(log.addedAttachments.length, 2, '附件 id 都加进了 composer');
	equal(log.draftText, '## 现场取证\n正文', '正文写进了输入框');
	equal(log.submitted, 0, 'autoSend=false 时不自动提交');

	const sent = await runtime.deliver({ sessionId: 'session-1', text: 'x', files: [], autoSend: true });
	equal(sent.ok, true, 'autoSend 时 deliver 成功');
	equal(log.submitted, 1, 'autoSend=true 触发一次提交');

	// 没有会话时应当明确失败（调用方会退回剪贴板）
	const noSession = await runtime.deliver({ sessionId: '', text: 'x', files: [] });
	equal(noSession.ok, false, '没有会话时 deliver 明确失败');

	// composer 正忙、拒收附件时要如实上报，而不是假装成功
	const busy = createFakeClientContext({ acceptAttachments: false });
	const busyRuntime = exported.__runtime(busy.ctx);
	const refused = await busyRuntime.deliver({ sessionId: 'session-1', text: '正文', files: [fileA] });
	equal(refused.ok, true, '附件被拒时正文仍然写入');
	equal(refused.attachRefused, true, '附件被拒时上报 attachRefused');
	equal(refused.attached, 0, '附件被拒时 attached 为 0');
	equal(busy.log.draftText, '正文', '附件被拒也不影响正文');
}
