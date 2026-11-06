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
