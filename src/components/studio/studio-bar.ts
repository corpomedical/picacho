// Helios Studio's prompt bar, its look (2026-10-01, operator: "Finalizing the
// UI to look and work like this" — Higgsfield's Blender add-on: a floating,
// rounded, dark bar docked bottom-centre over the viewport, mode tabs on top,
// a text box with the reference picture on its left, an engine picker, option
// chips and a big Generate button on the right). Picacho's own dark and ochre:
// the Generate button is the Studio's accent, not the add-on's lime.
//
// The engine (studio-engine.ts, "the prompt bar" section) draws into this
// skeleton and wires it; everything drawn is English and translated by the
// Studio's translator as it appears (studio-text.ts rows).
//
// Relative imports only (vitest has no "@/" alias).

import { BAR_MODES, type BarMode } from "../../lib/sets/studio-bar";

const I = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

/** One small icon per mode, as the add-on's tabs have. */
export const BAR_ICONS: Record<BarMode, string> = {
  scene: I('<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.8 1.9 1.9.8-1.9.8L19 20.4l-.8-1.9-1.9-.8 1.9-.8z"/>'),
  model: I('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
  anim: I('<circle cx="13" cy="4.5" r="1.8"/><path d="M9 21l2.5-6 2.5 2v4M7 11l3-3h4l2 4 3 1M11.5 15l1-5"/>'),
  image: I('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>'),
  video: I('<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>'),
  camera: I('<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/>'),
  assets: I('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'),
};

const GRIP = `<svg viewBox="0 0 12 20" width="8" height="14" aria-hidden="true"><g fill="currentColor"><circle cx="3" cy="4" r="1.4"/><circle cx="9" cy="4" r="1.4"/><circle cx="3" cy="10" r="1.4"/><circle cx="9" cy="10" r="1.4"/><circle cx="3" cy="16" r="1.4"/><circle cx="9" cy="16" r="1.4"/></g></svg>`;

/** The bar's skeleton: tabs, the card (result, picture + words, option row) and the Generate button; the pill when folded. */
export const BAR_HTML = `<div class="pbar" id="pbar" role="region" aria-label="Prompt bar" data-mode="model">
  <div class="pb-top">
    <button class="pb-grip" id="pbGrip" title="Drag to move the bar · double-click to put it back" aria-label="Drag to move the bar">${GRIP}</button>
    <div class="pb-tabs" role="tablist" aria-label="What to make">${BAR_MODES.map((m) => `<button class="pb-tab" role="tab" data-pbmode="${m.id}" aria-selected="false">${BAR_ICONS[m.id]}<span>${m.label}</span></button>`).join("")}</div>
    <button class="pb-fold" id="pbFold" title="Fold the bar away" aria-label="Fold the bar away"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
  </div>
  <div class="pb-body">
    <div class="pb-card">
      <div class="pb-result" id="pbResult" aria-live="polite"></div>
      <div class="pb-main">
        <div class="pb-refs" id="pbRefs"></div>
        <textarea class="pb-text" id="pbText" rows="2" aria-label="Prompt"></textarea>
      </div>
      <div class="pb-row" id="pbRow"></div>
      <p class="pb-hint" id="pbHint"></p>
    </div>
    <button class="pb-go" id="pbGo"><b id="pbGoLabel">Generate</b><small id="pbGoSub"></small></button>
  </div>
</div>
<button class="pb-pill" id="pbPill" hidden title="Open the prompt bar" aria-label="Open the prompt bar"><i></i><span>Prompt bar</span><small id="pbPillMode"></small></button>`;

/** The phone's first bottom-sheet tab (the bar is a sheet there). */
export const BAR_SHEET_TAB = `<button data-sheet="bar" aria-pressed="false"><span class="mA mB" aria-hidden="true">✦</span><span>Create</span></button>`;

export const BAR_CSS = `
.pbar{--pbx:0px;--pby:0px;--pbax:0px;--pbay:0px;position:absolute;left:50%;bottom:14px;width:min(800px,calc(100% - 28px));transform:translate(calc(-50% + var(--pbx) + var(--pbax)),calc(var(--pby) + var(--pbay)));z-index:4;display:flex;flex-direction:column;gap:6px;color:var(--ink);pointer-events:none;transition:transform .18s ease}
.pbar.dragging{transition:none}
.pbar>*{pointer-events:auto}
.pb-top{display:flex;align-items:center;gap:4px;align-self:flex-start;max-width:100%;padding:3px;background:rgba(24,25,28,.94);border:1px solid rgba(255,255,255,.07);border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.35);backdrop-filter:blur(8px)}
.pb-tabs{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;min-width:0}
.pb-tab{display:flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:9px;color:var(--muted);white-space:nowrap;font-size:12px}
.pb-tab svg{width:14px;height:14px;flex:none}
.pb-tab:hover{color:var(--ink);background:rgba(255,255,255,.05)}
.pb-tab[aria-selected=true]{background:var(--field-h);color:var(--ink)}
.pb-tab[aria-selected=true] svg{color:var(--accent)}
.pb-grip{width:20px;height:28px;display:grid;place-items:center;color:var(--muted);cursor:grab;touch-action:none;border-radius:7px;flex:none}
.pb-grip:hover{color:var(--ink);background:rgba(255,255,255,.05)}
.pbar.dragging .pb-grip{cursor:grabbing}
.pb-fold{width:28px;height:28px;display:grid;place-items:center;color:var(--muted);border-radius:8px;flex:none}
.pb-fold:hover{color:var(--ink);background:rgba(255,255,255,.06)}
.pb-body{display:flex;gap:10px;align-items:stretch;background:rgba(27,28,31,.96);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:10px 10px 10px 12px;box-shadow:0 16px 44px rgba(0,0,0,.55);backdrop-filter:blur(10px)}
.pb-card{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
.pb-result{max-height:200px;overflow:auto;display:flex;flex-direction:column;gap:6px}
.pb-result:empty{display:none}
.pb-result .msg-u,.pb-result .msg-a{margin:0}
.pb-main{display:flex;gap:10px;align-items:flex-start;min-height:44px}
.pb-text{flex:1;min-width:0;min-height:44px;max-height:120px;resize:none;background:transparent;border:0;outline:0;color:var(--ink);font-size:13.5px;line-height:1.45;padding:4px 2px}
.pb-text::placeholder{color:#7f828b}
.pb-text[hidden]{display:none}
.pb-refs{display:flex;gap:6px;flex:none}
.pb-refs:empty{display:none}
.pb-ref{position:relative;width:54px;height:54px;border-radius:10px;border:1px dashed #5a5d66;background:#15161a center/cover no-repeat;display:grid;place-items:center;color:var(--muted);font-size:10px;line-height:1.1;text-align:center;padding:2px}
.pb-ref.has{border:1px solid #3d3f46}
.pb-ref:hover{border-color:var(--accent)}
.pb-ref.over{border-color:var(--accent);background-color:rgba(224,164,104,.1)}
.pb-ref b{position:absolute;left:0;right:0;bottom:-15px;font-weight:500;font-size:9.5px;color:var(--muted)}
.pb-ref .pb-x{position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;background:#2e2f34;border:1px solid #4a4c53;color:var(--ink);font-size:10px;display:grid;place-items:center}
.pb-refs.views{padding-bottom:14px}
.pb-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.pb-row:empty{display:none}
.pb-chip{position:relative;display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:14px;background:var(--field);color:var(--ink2);white-space:nowrap;font-size:11.5px;max-width:100%}
.pb-chip:hover{background:var(--field-h);color:var(--ink)}
.pb-chip.on{background:var(--accent-dim);color:var(--accent-2);box-shadow:inset 0 0 0 1px rgba(224,164,104,.5)}
.pb-chip.eng{background:#34353b;color:var(--ink);font-weight:500}
.pb-chip.eng svg{width:13px;height:13px;color:var(--accent)}
.pb-chip select,.pb-chip input{background:transparent;border:0;color:inherit;height:26px;font:inherit;outline:0;min-width:0}
.pb-chip select option{background:#2a2b2f;color:var(--ink)}
.pb-chip input[type=number]{width:74px}
.pb-chip input.w2{width:44px}
.pb-chip input.txt{width:180px}
.pb-chip label{color:var(--muted)}
.pb-sw{width:26px;height:15px;border-radius:8px;background:#55585f;position:relative;flex:none;transition:background .15s}
.pb-sw::after{content:"";position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;background:#e4e5e8;transition:transform .15s}
.pb-chip.on .pb-sw{background:var(--accent)}
.pb-chip.on .pb-sw::after{transform:translateX(11px);background:#1a1b1e}
.pb-sep{width:1px;height:18px;background:#3a3c42;margin:0 2px}
.pb-hint{margin:0;color:var(--muted);font-size:11px;line-height:1.45}
.pb-hint:empty{display:none}
.pb-hint a,.pb-hint [data-pblink],.pb-links [data-pblink]{color:var(--accent-2);text-decoration:underline;text-underline-offset:2px}
.pb-go{flex:none;width:124px;border-radius:14px;background:var(--accent);color:var(--accent-ink);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:8px;box-shadow:0 6px 18px rgba(224,164,104,.25)}
.pb-go b{font-size:15px;font-weight:700;letter-spacing:.01em}
.pb-go small{font-size:11px;font-weight:600;opacity:.78;text-align:center;line-height:1.25}
.pb-go small:empty{display:none}
.pb-go:hover{background:var(--accent-2)}
.pb-go[disabled]{opacity:.45;cursor:default;box-shadow:none}
.pb-go[hidden]{display:none}
.pb-list{position:absolute!important;left:0;bottom:calc(100% + 6px);top:auto!important;min-width:280px;max-height:360px;overflow:auto;z-index:20}
.pb-list.down{bottom:auto!important;top:calc(100% + 6px)!important}
.pb-list h4{margin:6px 8px 2px;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600}
.pb-list button{display:flex;justify-content:space-between;gap:14px;width:100%}
.pb-list button.on span:first-child{color:var(--accent-2)}
.pb-list button small{color:var(--muted)}
.pb-prog{height:3px;border-radius:2px;background:#3a3c42;overflow:hidden}
.pb-prog i{display:block;height:100%;width:0;background:var(--accent);transition:width .4s}
.pb-out{display:flex;gap:10px;align-items:flex-start}
.pb-out img,.pb-out video{width:132px;max-height:100px;object-fit:cover;border-radius:8px;background:#000;flex:none}
.pb-out p{margin:0 0 4px;color:var(--ink2);line-height:1.45}
.pb-links{display:flex;flex-wrap:wrap;gap:10px}
.pb-links a,.pb-links button{color:var(--accent-2);font-size:11.5px;text-decoration:none}
.pb-note{margin:0;color:#e3a07a;line-height:1.45}
.pb-looks{display:flex;gap:4px;overflow-x:auto;scrollbar-width:thin;max-width:260px}
.pb-looks button{width:28px;height:28px;border-radius:7px;flex:none;overflow:hidden;border:1px solid #3d3f46;padding:0;background:#15161a;color:var(--muted);font-size:9px}
.pb-looks button.on{border:2px solid var(--accent)}
.pb-looks img{width:100%;height:100%;object-fit:cover;display:block}
.pb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:8px;max-height:230px;overflow:auto;padding-right:2px}
.pb-grid h5{grid-column:1/-1;margin:4px 0 0;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600}
.pb-tile{display:flex;flex-direction:column;gap:3px;text-align:left;border-radius:9px;padding:3px;border:1px solid transparent}
.pb-tile:hover{border-color:#4a4c53;background:rgba(255,255,255,.03)}
.pb-tile.on{border-color:var(--accent)}
.pb-tile i{display:block;width:100%;aspect-ratio:4/3;border-radius:7px;background:#15161a center/cover no-repeat}
.pb-tile span{font-size:10.5px;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pb-pill{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:4;height:36px;padding:0 16px 0 12px;border-radius:18px;background:rgba(27,28,31,.96);border:1px solid rgba(255,255,255,.1);color:var(--ink);display:flex;align-items:center;gap:8px;box-shadow:0 10px 30px rgba(0,0,0,.5);font-size:12.5px}
.pb-pill i{width:16px;height:16px;border-radius:5px;background:radial-gradient(circle at 35% 30%,#ffe0b8,#e0a468 55%,#a8672f)}
.pb-pill small{color:var(--muted)}
.pb-pill:hover{border-color:var(--accent)}
.vcanvas .toast{bottom:var(--pbh,12px)}
.mB{font-size:12px!important}
.app.compact .pbar{position:fixed;left:env(safe-area-inset-left);right:env(safe-area-inset-right);bottom:var(--tabs-h);width:auto;height:var(--sheet-h,50vh);transform:none;transition:none;display:none;z-index:50;gap:8px;background:var(--panel,#2c2d31);border:1px solid var(--line);border-bottom:0;border-radius:14px 14px 0 0;box-shadow:0 -12px 32px rgba(0,0,0,.45);padding:0 10px 10px;overflow:auto}
.app.compact[data-sheet=bar] .pbar{display:flex}
.app.compact .pbar>.grip{display:flex!important}
.app.compact .pb-top{align-self:stretch;background:transparent;border:0;box-shadow:none;padding:0}
.app.compact .pb-grip,.app.compact .pb-fold,.app.compact .pb-pill{display:none!important}
.app.compact .pb-body{flex-direction:column;background:transparent;border:0;box-shadow:none;padding:0;backdrop-filter:none}
.app.compact .pb-go{width:100%;min-height:50px;flex-direction:row;gap:10px;position:sticky;bottom:0;z-index:2}
.app.compact .pb-go[disabled]{opacity:1;background:#4a3f35;color:#cdb79f}
.app.compact .pb-tabs{flex:1;min-width:0}
.app.compact .pb-tab{flex:none;min-height:40px}
.app.compact .pb-chip{min-height:40px;height:auto}
.app.compact .pb-text{font-size:16px}
.app.compact .pb-result{max-height:none}
.app.compact .pb-list{position:fixed!important;left:8px;right:8px;bottom:calc(var(--tabs-h) + 8px)}
`;

/** A chip that switches something on and off. */
export function toggleChip(id: string, label: string, on: boolean, title = ""): string {
  return `<button class="pb-chip${on ? " on" : ""}" data-pbtoggle="${id}" aria-pressed="${on}"${title ? ` title="${title}"` : ""}><span class="pb-sw" aria-hidden="true"></span>${label}</button>`;
}

/** A chip holding a select: `options` as [value, label], both already HTML-escaped by the caller; `aria` names a select with no label. */
export function selectChip(id: string, label: string, options: readonly (readonly [string, string])[], value: string, attrs = "", aria = ""): string {
  return `<span class="pb-chip">${label ? `<label for="${id}">${label}</label>` : ""}<select id="${id}" aria-label="${aria || label || id}"${attrs}>${options
    .map(([v, l]) => `<option value="${v}"${v === value ? " selected" : ""}>${l}</option>`)
    .join("")}</select></span>`;
}
