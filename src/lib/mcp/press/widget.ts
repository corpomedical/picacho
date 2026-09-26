// Picacho's card inside Claude and ChatGPT: an MCP Apps view (SEP-1865,
// stable 2026-01-26), served as the ui:// resource below and drawn from the
// ad card (card.ts) a tool result carries.
//
// THE LOOK (operator, 2026-09-26: "A · Red Carpet"; design a-v2
// surfaces.html §3). Inline it is the host's own white or dark card, its
// hairlines and type (the host's CSS variables), with Picacho bringing only
// its ochre key and the corner marks: at most two actions and five facts —
// poster, star, product, cut, checks and the quote with the balance before
// and after. Full screen is the Red Carpet: the metallic PRESS TOUR title,
// the stills with their verdict stamps, the flashbulb on a print whose
// every check matched (one motion; a still afterglow under Reduce Motion),
// and the quote rail with the Film key truly disabled while a still waits.
//
// ONLY A PERSON CAN SPEND. The Paint and Approve keys call app-only tools
// (visibility ["app"]) with the one-time code this card alone receives
// (the result's _meta, which hosts never show the model). The model cannot
// press them.
//
// Self-contained: no network access of its own (connectDomains empty), no
// fonts or scripts from anywhere; pictures only from Picacho's own media
// addresses. Every string the page shows goes in with textContent.
//
// VERSIONED URI: ChatGPT caches a view for up to an hour, so a change to
// this file ships under a new URI (ad-v3.html, …), never over the old one.
// ad-v2 (2026-09-26): the card speaks Spanish, Portuguese and Italian.

import { KNOWN_APP_HOSTS } from "../../domains";
import { localizeServerText } from "../../i18n/server-text";
import es from "../../i18n/messages/es";
import pt from "../../i18n/messages/pt";
import itMessages from "../../i18n/messages/it";
import { CAMPAIGN_MESSAGES, blockDecide } from "../../press-tour/campaign-messages";
import { FILM_MESSAGES, blockDecideShot } from "../../press-tour/film-messages";
import { PRODUCT_LOCK_MESSAGES } from "../../product-lock/messages";
import { POLICY_LINE } from "./messages";
import { WIDGET_TEXTS } from "./widget-text";

export const PRESS_WIDGET_URI = "ui://picacho/press-tour/ad-v2.html";
export const MCP_APP_MIME = "text/html;profile=mcp-app";
/** The _meta key the card's one-time code rides under (card only; never the model). */
export const UI_NONCE_META_KEY = "ai.picacho/ui_nonce";

/** Where the card may load pictures from: the app's own hosts (the media route), plus this dev origin. */
export function widgetResourceDomains(origin: string): string[] {
  const out = KNOWN_APP_HOSTS.filter((h) => !h.startsWith("www.")).map((h) => `https://${h}`);
  if (!out.includes(origin)) out.push(origin);
  return out;
}

/** The resource's _meta: CSP (pictures from our hosts only, no connections, no frames), border, display modes. */
export function widgetMeta(origin: string): Record<string, unknown> {
  const domains = widgetResourceDomains(origin);
  return {
    ui: {
      csp: { connectDomains: [], resourceDomains: domains },
      prefersBorder: true,
    },
    "openai/widgetDescription":
      "Picacho's Press Tour card: the ad's plan or stills with their face and product checks, and the credits it costs. Paid steps start only from the person's tap on this card.",
    "openai/widgetPrefersBorder": true,
    "openai/widgetCSP": { connect_domains: [], resource_domains: domains, redirect_domains: domains },
    "openai/ui": { availableDisplayModes: ["inline", "fullscreen"] },
  };
}

/** resources/list entry. */
export function widgetResourceListing(origin: string): Record<string, unknown> {
  return {
    uri: PRESS_WIDGET_URI,
    name: "press_tour_ad",
    title: "Press Tour ad",
    description: "The Press Tour card: an ad's plan, its stills and their checks.",
    mimeType: MCP_APP_MIME,
    _meta: widgetMeta(origin),
  };
}

/** resources/read answer. */
export function widgetResourceContents(origin: string): Record<string, unknown> {
  return {
    contents: [{ uri: PRESS_WIDGET_URI, mimeType: MCP_APP_MIME, text: pressTourWidgetHtml(), _meta: widgetMeta(origin) }],
  };
}

const CSS = `
:root{--pt-bg:var(--color-background-primary,#fff);--pt-bg2:var(--color-background-secondary,#f6f5f1);--pt-ink:var(--color-text-primary,#1f1e1c);--pt-sub:var(--color-text-secondary,#6b6960);--pt-rule:var(--color-border-primary,#e1ded4);--pt-r:var(--border-radius-lg,14px);--pt-font:var(--font-sans,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);--pt-mono:var(--font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);--pt-ochre:#e8b27c;--pt-ochre-ink:#1a1208;--pt-gold:#e6c46e;--pt-rose:#e0685f;--pt-warn:#b3651b;color-scheme:light dark}
:root[data-theme=dark]{--pt-warn:#eab27a;--pt-bg:var(--color-background-primary,#1d1c1a);--pt-bg2:var(--color-background-secondary,#262521);--pt-ink:var(--color-text-primary,#f2eee6);--pt-sub:var(--color-text-secondary,#a8a296);--pt-rule:var(--color-border-primary,rgba(255,255,255,.13))}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--pt-warn:#eab27a;--pt-bg:var(--color-background-primary,#1d1c1a);--pt-bg2:var(--color-background-secondary,#262521);--pt-ink:var(--color-text-primary,#f2eee6);--pt-sub:var(--color-text-secondary,#a8a296);--pt-rule:var(--color-border-primary,rgba(255,255,255,.13))}}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:transparent}
body{font-family:var(--pt-font);color:var(--pt-ink);font-size:14px;line-height:1.4;-webkit-font-smoothing:antialiased}
button{font:inherit;cursor:pointer;border:0}button[aria-disabled=true]{cursor:not-allowed}
.card{background:var(--pt-bg);border-radius:var(--pt-r);box-shadow:0 0 0 1px var(--pt-rule);overflow:hidden}
.top{display:flex;gap:14px;padding:14px}
.pic{position:relative;flex:none;align-self:flex-start;width:76px;aspect-ratio:9/16;border-radius:8px;overflow:hidden;background:#16130f}
.pic img{width:100%;height:100%;object-fit:cover;display:block}
.marks::before,.marks::after{content:"";position:absolute;width:12px;height:12px;border-color:var(--pt-ochre);border-style:solid;pointer-events:none}
.marks::before{top:4px;left:4px;border-width:2px 0 0 2px}.marks::after{right:4px;bottom:4px;border-width:0 2px 2px 0}
.tt{font-size:15.5px;font-weight:600}.tt small{display:block;font-size:12.5px;font-weight:400;color:var(--pt-sub);margin-top:2px}
.facts{display:grid;grid-template-columns:minmax(0,.82fr) minmax(0,1.18fr);gap:8px 18px;margin-top:10px;font-size:13px}
.facts span{display:block;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--pt-sub);margin-bottom:1px}
.facts b{font-weight:600}.facts em{display:block;font-style:normal;font-size:12px;color:var(--pt-sub);margin-top:1px}
.act{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-top:1px solid var(--pt-rule)}
.btn{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:0 14px;border-radius:10px;font-size:13.5px;font-weight:600}
.btn.p{background:var(--pt-ochre);color:var(--pt-ochre-ink)}.btn.p .price{font-family:var(--pt-mono);font-size:11px;padding:2px 6px;border-radius:6px;background:rgba(26,18,8,.12)}
.btn.s{background:transparent;color:var(--pt-ink);box-shadow:inset 0 0 0 1px var(--pt-rule)}
.btn[aria-disabled=true]{opacity:.55}
.by{margin-left:auto;font-weight:800;font-size:12px;letter-spacing:-.01em}
.note{padding:0 14px 12px;font-size:12.5px;color:var(--pt-sub)}.note.warn{color:var(--pt-warn)}
.full{position:relative;min-height:100vh;padding:26px 24px 30px;color:#efe9dd;background:radial-gradient(120% 70% at 30% -10%,#3a2c1c 0%,#15110d 45%,#0c0a08 100%)}
.billing{margin:0;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#8d8a84;font-stretch:condensed}
.marquee{margin:8px 0 0;font-size:40px;line-height:1;font-weight:800;letter-spacing:.05em;text-transform:uppercase;font-stretch:condensed;background:linear-gradient(180deg,#faf7f0 0%,#c9c2b4 46%,#fffdf8 52%,#8c8578 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
.fsub{margin:8px 0 0;color:#cfc8ba;font-size:14px}.same{position:absolute;top:28px;right:24px;font-size:12px;color:#8d8a84}
.fgrid{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:26px;margin-top:22px}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:22px;align-items:start}
.shot{display:flex;flex-direction:column;align-items:center;gap:10px}
.frame{position:relative;width:100%;max-width:230px;aspect-ratio:9/16;border-radius:10px;overflow:hidden;background:#1b1714;box-shadow:0 0 0 1px rgba(255,255,255,.08)}
.frame img{width:100%;height:100%;object-fit:cover;display:block}
.frame .busy{position:absolute;inset:0;display:grid;place-items:center;color:#9a9489;font-size:12.5px}
.chip{position:absolute;top:8px;left:8px;font-family:var(--pt-mono);font-size:11px;color:#efe9dd;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:999px}
.stamps{position:absolute;left:8px;bottom:8px;display:flex;flex-direction:column;align-items:flex-start;gap:5px}
.stamp{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#f3eee4;background:rgba(12,10,8,.74);padding:3px 9px 3px 5px;border-radius:999px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}
.stamp i{width:13px;height:13px;border-radius:50%;flex:none;display:inline-block}
.v-match i{position:relative;background:var(--pt-gold)}.v-match i::after{content:"";position:absolute;left:36%;top:17%;width:24%;height:46%;border:solid #1a1208;border-width:0 1.6px 1.6px 0;transform:rotate(45deg)}.stamp.v-match{box-shadow:inset 0 0 0 1px rgba(230,196,110,.6)}
.v-didnt_match i{position:relative;border-radius:3px;background:var(--pt-rose)}.v-didnt_match i::before,.v-didnt_match i::after{content:"";position:absolute;left:22%;right:22%;top:50%;height:1.6px;margin-top:-.8px;background:#fff;transform:rotate(45deg)}.v-didnt_match i::after{transform:rotate(-45deg)}.stamp.v-didnt_match{box-shadow:inset 0 0 0 1px rgba(224,104,95,.7)}
.v-not_readable i{border-radius:3px;background:repeating-linear-gradient(135deg,#d7d1c5 0 2px,transparent 2px 4px);box-shadow:inset 0 0 0 1px #d7d1c5}
.v-product_missing i{box-sizing:border-box;border-radius:3px;background:transparent;border:1.5px dashed #d7d1c5}
.v-not_checked i{box-sizing:border-box;background:transparent;border:1.5px solid #9a9489}
.v-no_one_in_shot i,.v-not_planned i{height:2px;border-radius:1px;background:#b9b2a6}
.frame.good::before,.frame.good::after{content:"";position:absolute;width:16px;height:16px;border-color:var(--pt-ochre);border-style:solid;z-index:2;pointer-events:none}
.frame.good::before{top:6px;right:6px;border-width:2px 2px 0 0}.frame.good::after{bottom:6px;right:6px;border-width:0 2px 2px 0}
.flash .bulb{position:absolute;inset:0;background:radial-gradient(circle at 50% 32%,rgba(255,255,255,.95),rgba(255,255,255,0) 62%);opacity:0;animation:bulb 1.2s ease-out var(--at,350ms) 1 both;pointer-events:none}
@keyframes bulb{0%{opacity:0}7%{opacity:.95}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){.flash .bulb{animation:none;opacity:0}.frame.flash{box-shadow:0 0 0 1px rgba(230,196,110,.6),0 0 26px rgba(230,196,110,.22)}}
.shot h3{margin:0;font-size:14px;font-weight:500;color:#efe9dd}
.acts{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;align-items:center}
.pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;border-radius:999px;background:transparent;color:#efe9dd;box-shadow:inset 0 0 0 1px rgba(230,196,110,.6);font-size:13px}
.pill.on{background:rgba(230,196,110,.14)}
.quiet{background:none;color:#b9b2a6;font-size:12.5px;text-decoration:underline;text-underline-offset:3px;padding:0}
.waits{width:100%;max-width:230px;border-radius:12px;padding:8px 10px 10px;background:rgba(230,196,110,.05);box-shadow:inset 0 0 0 1px rgba(230,196,110,.28)}
.waits .h{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--pt-gold);font-family:var(--pt-mono)}
.waits .t{margin-top:3px;font-size:12px;color:#efe9dd}.waits .row{margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px}
.ghost{height:32px;border-radius:9px;background:transparent;color:#efe9dd;box-shadow:inset 0 0 0 1px rgba(255,255,255,.2);font-size:12.5px}
.ghost.on{box-shadow:inset 0 0 0 1px rgba(230,196,110,.7);background:rgba(230,196,110,.12)}
.rail{display:flex;flex-direction:column;gap:12px}
.soft{border-radius:14px;padding:14px;background:rgba(255,255,255,.035);box-shadow:inset 0 0 0 1px rgba(255,255,255,.09)}
.label{margin:0;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#8d8a84;font-family:var(--pt-mono)}
.qrow{display:flex;justify-content:space-between;gap:10px;padding:6px 0;font-size:13px;color:#d9d3c7;box-shadow:inset 0 -1px 0 rgba(255,255,255,.06)}
.qrow .v{font-family:var(--pt-mono);font-size:12px;color:#efe9dd}.qrow.whole{color:#fff;font-weight:500}
.policy{margin:8px 0 0;font-size:11.5px;color:#b9b2a6}
.big{display:flex;justify-content:space-between;align-items:flex-end;margin-top:10px;padding-top:12px;box-shadow:inset 0 1px 0 rgba(255,255,255,.1)}
.big b{font-size:34px;font-weight:300;line-height:1}.big b small{font-size:12px;margin-left:6px;color:#b9b2a6}
.bal{margin:6px 0 0;font-size:12px;color:#cfc8ba}
.blocker{margin:0;font-size:13px;color:#e9d6ae;display:flex;gap:8px;align-items:center}.blocker::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--pt-gold);flex:none}
.render{width:100%;min-height:46px;border-radius:12px;background:var(--pt-ochre);color:var(--pt-ochre-ink);font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:13px;display:flex;justify-content:center;align-items:center;gap:10px}
.render[aria-disabled=true]{background:rgba(255,255,255,.06);color:#8d8a84;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
.render .price{font-family:var(--pt-mono);font-size:11px;letter-spacing:0;text-transform:none;padding:2px 7px;border-radius:6px;background:rgba(0,0,0,.14)}
.link{background:none;color:#e8b27c;padding:0;font-size:13px;text-decoration:underline;text-underline-offset:3px;text-align:left}
.err{margin:0;font-size:12.5px;color:#f1a79f}
.rows,.wideWaits{display:none}
.rows{flex-direction:column;align-items:center;gap:3px;font-size:11px;color:#d9d3c7}.rows span{display:inline-flex;align-items:center;gap:5px}.rows i{width:10px;height:10px;border-radius:50%;display:inline-block;flex:none}
.rows .v-no_one_in_shot i,.rows .v-not_planned i{height:2px;border-radius:1px}.rows .v-not_readable i,.rows .v-didnt_match i,.rows .v-product_missing i{border-radius:2px}
.wideWaits{flex-direction:column;gap:10px;margin-top:14px}.wideWaits .waits{max-width:none}.wideWaits .ghost{min-height:44px;font-size:13.5px}
@media (max-width:760px){.fgrid{grid-template-columns:1fr}.same{position:static;margin-top:6px}.marquee{font-size:32px}.shots{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}}
@media (max-width:520px){.full{padding:18px 14px 24px}.shots{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.frame .stamps{display:none}.rows{display:flex}.shot .waits{display:none}.wideWaits{display:flex}.chip{font-size:9.5px;padding:2px 6px;top:5px;left:5px}.shot h3{font-size:12.5px}.pill{min-height:44px;padding:0 10px;font-size:12px}.frame.good::before,.frame.good::after{width:11px;height:11px}}
@media (max-width:420px){.facts{grid-template-columns:1fr}.top{padding:12px}}
`;

// The card's logic: the MCP Apps bridge (ui/initialize, tool results,
// tools/call, open-link, display mode, size), with ChatGPT's window.openai
// as a fallback; rendering; the two paid keys; polling while we work.
// Plain ES2019, no template literals (it lives inside one).
const SCRIPT = `
(function(){
"use strict";
var TEXTS=__TEXTS__;var ENGINE=__ENGINE__;var NONCE_KEY="__NONCE_KEY__";
var T=TEXTS.en;var LOC="en";var root=document.getElementById("app");
var state={card:null,nonce:null,busy:false,error:null,choices:{},display:"inline",modes:["inline"],polling:null,pollUntil:0};
var nextId=1,pending={},bridge=false;
function tr(s){if(!s||LOC==="en"||!ENGINE[LOC])return s;var i=ENGINE.en.indexOf(s);return i>=0?ENGINE[LOC][i]:s}
function fmt(s,v){return String(s).replace(/\\{(\\w+)\\}/g,function(w,k){return v&&k in v?String(v[k]):w})}
function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n}
function add(p){for(var i=1;i<arguments.length;i++){var c=arguments[i];if(c)p.appendChild(c)}return p}
function safeImg(u){return typeof u==="string"&&(/^https:\\/\\//.test(u)||/^http:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?\\//.test(u))?u:null}
function send(method,params){return new Promise(function(res,rej){var id=nextId++;pending[id]={res:res,rej:rej};try{window.parent.postMessage({jsonrpc:"2.0",id:id,method:method,params:params},"*")}catch(e){delete pending[id];rej(e);return}setTimeout(function(){if(pending[id]){delete pending[id];rej(new Error("timeout"))}},45000)})}
function notify(method,params){try{window.parent.postMessage({jsonrpc:"2.0",method:method,params:params},"*")}catch(e){}}
window.addEventListener("message",function(ev){if(ev.source!==window.parent)return;var m=ev.data;if(!m||m.jsonrpc!=="2.0")return;
 if(m.id!=null&&!m.method&&pending[m.id]){var p=pending[m.id];delete pending[m.id];if(m.error)p.rej(m.error);else p.res(m.result);return}
 if(m.method==="ui/notifications/tool-result"){take(m.params);return}
 if(m.method==="ui/notifications/host-context-changed"){context(m.params||{});render();return}
 if(m.method==="ui/resource-teardown"&&m.id!=null){stopPoll();window.parent.postMessage({jsonrpc:"2.0",id:m.id,result:{}},"*");return}
 if(m.method==="ping"&&m.id!=null){window.parent.postMessage({jsonrpc:"2.0",id:m.id,result:{}},"*")}
});
function context(c){if(c.theme==="dark"||c.theme==="light")document.documentElement.setAttribute("data-theme",c.theme);
 var vars=c.styles&&c.styles.variables;if(vars)for(var k in vars){if(/^--[a-z0-9-]+$/.test(k)&&typeof vars[k]==="string")document.documentElement.style.setProperty(k,vars[k])}
 if(c.locale){var l=String(c.locale).slice(0,2).toLowerCase();T=TEXTS[l]||TEXTS.en;LOC=TEXTS[l]?l:"en";document.documentElement.lang=l}
 if(c.displayMode)state.display=c.displayMode;if(c.availableDisplayModes)state.modes=c.availableDisplayModes}
function take(result){if(!result)return;var sc=result.structuredContent;var meta=result._meta||{};
 if(sc&&sc.kind==="press_tour_ad"){state.card=sc;state.choices={}}
 var n=meta[NONCE_KEY];state.nonce=n&&typeof n.value==="string"?n:null;
 state.error=result.isError&&result.content&&result.content[0]?String(result.content[0].text||""):null;
 render();maybePoll()}
function callTool(name,args){
 if(bridge)return send("tools/call",{name:name,arguments:args});
 if(window.openai&&window.openai.callTool)return window.openai.callTool(name,args).then(function(r){return r&&r.structuredContent?r:{structuredContent:r&&r.result,_meta:r&&r._meta}});
 return Promise.reject(new Error("no host"))}
function openLink(url){if(!url)return;if(bridge){send("ui/open-link",{url:url}).catch(function(){window.open(url,"_blank","noopener")});return}
 if(window.openai&&window.openai.openExternal){window.openai.openExternal({href:url});return}window.open(url,"_blank","noopener")}
function fullscreen(){if(bridge){send("ui/request-display-mode",{mode:"fullscreen"}).then(function(r){if(r&&r.mode){state.display=r.mode;render()}}).catch(function(){});return}
 if(window.openai&&window.openai.requestDisplayMode)window.openai.requestDisplayMode({mode:"fullscreen"})}
function canFull(){return state.modes.indexOf("fullscreen")>=0||(!bridge&&window.openai&&window.openai.requestDisplayMode)}
function stopPoll(){if(state.polling){clearTimeout(state.polling);state.polling=null}}
function maybePoll(){stopPoll();var c=state.card;if(!c||c.next!=="wait"||!c.plan_id)return;if(!state.pollUntil)state.pollUntil=Date.now()+15*60000;if(Date.now()>state.pollUntil)return;
 state.polling=setTimeout(function(){callTool("poll_ad_job",{plan_id:c.plan_id}).then(take).catch(function(){maybePoll()})},5000)}
function act(name,args){if(state.busy)return;state.busy=true;state.error=null;render();
 callTool(name,args).then(function(r){state.busy=false;state.pollUntil=0;take(r)}).catch(function(){state.busy=false;state.error=T.tryAgain;render()})}
function paint(){var c=state.card;if(!c||!state.nonce||state.nonce.purpose!=="paint")return;act("start_ad",{plan_id:c.plan_id,ui_nonce:state.nonce.value})}
function decisions(){var c=state.card,out=[];c.stills.forEach(function(s){var ch=state.choices[s.shot];if(s.decision==="pending"&&ch)out.push({shot:s.shot,choice:ch})});return out}
function allDecided(){var c=state.card;return c&&c.stills.length>0&&c.stills.every(function(s){return !s.painting&&(s.decision!=="pending"||state.choices[s.shot])})}
function approve(){var c=state.card;if(!c||!state.nonce||(state.nonce.purpose!=="approve"&&state.nonce.purpose!=="film")||!allDecided())return;act("approve_stills",{plan_id:c.plan_id,ui_nonce:state.nonce.value,decisions:decisions(),locale:LOC})}
var MISS=["didnt_match","not_readable","product_missing"];
function clean(s){return MISS.indexOf(s.face)<0&&MISS.indexOf(s.product)<0}
function good(s){return !s.painting&&(s.face==="match"||s.face==="no_one_in_shot")&&(s.product==="match"||s.product==="not_planned")}
function roleName(r){return r==="hook"?T.roleHook:r==="costar"?T.roleCostar:T.roleLine}
function mmss(n){var m=Math.floor(n/60),s=n%60;return m+":"+(s<10?"0":"")+s}
function stamp(kind,v){var s=el("span","stamp v-"+v);add(s,el("i"),el("span",null,v==="no_one_in_shot"?T.no_one_in_shot:kind+" · "+(T[v]||v)));return s}
function priceTag(n){return el("span","price",n+" "+T.cr)}
function primaryLabel(c){if(c.next==="paint")return[fmt(T.actionPaint,{n:c.stills.length}),c.quote?c.quote.paint:null];
 if(c.next==="decide")return[T.actionReview,null];if(c.next==="film")return[fmt(T.actionFilm,{n:c.stills.length}),c.quote?c.quote.animate:null];
 if(c.next==="set_up_product")return[T.actionSetUp,null];if(c.next==="post")return[T.actionPressLine,null];return[T.actionOpen,null]}
function subline(c){if(c.next==="paint")return T.subPaint;if(c.next==="wait")return T.subWait;if(c.next==="decide")return c.film_open?T.subFilm:T.subFilmInPicacho;
 if(c.next==="film")return T.subFilm;if(c.next==="film_in_picacho")return T.subFilmInPicacho;if(c.next==="post")return T.subReady;if(c.next==="set_up_product")return T.subSetUp;return tr(c.error||c.blocker||"")}
function inline(c){var card=el("div","card");var top=el("div","top");var pic=el("span","pic marks");var src=safeImg(c.poster_url);
 if(src){var im=el("img");im.src=src;im.alt=T.posterAlt;pic.appendChild(im)}
 var body=el("div");body.style.flex="1";body.style.minWidth="0";var tt=el("div","tt",c.title?fmt(T.planTitle,{title:c.title}):(c.product||T.yourAd));add(tt,el("small",null,subline(c)));
 var facts=el("div","facts");function fact(label,value,extra){var d=el("div");add(d,el("span",null,label),el("b",null,value));if(extra)add(d,el("em",null,extra));facts.appendChild(d)}
 if(c.star)fact(T.factStar,c.star);if(c.product)fact(T.factProduct,c.product);if(c.cut)fact(T.factCut,fmt(T.cutValue,{shots:c.cut.shots,seconds:c.cut.seconds}));fact(T.factChecks,c.checks);
 if(c.quote){var q=c.quote;var paidNow=q.paint_paid;var v={total:q.total,paint:q.paint,animate:q.animate,now:q.balance_now,after:q.balance_after_next_step};if(q.film_paid)fact(T.factQuote,fmt(T.quoteValueAllPaid,v),fmt(T.balanceLeft,v));else fact(T.factQuote,fmt(paidNow?T.quoteValuePaid:T.quoteValue,v),fmt(c.short_by?T.balanceLeft:paidNow?T.balanceFilm:T.balancePaint,v))}
 add(top,pic,add(body,tt,facts));card.appendChild(top);
 var a=el("div","act");var lab=primaryLabel(c);var p=el("button","btn p",lab[0]);if(lab[1]!=null)p.appendChild(priceTag(lab[1]));
 var blocked=state.busy||(c.next==="paint"&&(!state.nonce||c.short_by))||(c.next==="film"&&(!state.nonce||c.short_by));if(blocked)p.setAttribute("aria-disabled","true");
 p.onclick=function(){if(p.getAttribute("aria-disabled")==="true")return;if(c.next==="paint")paint();else if(c.next==="decide"||c.next==="film"){if(canFull())fullscreen();else openLink(c.open_url)}else if(c.next==="post")openLink(c.press_line_url||c.open_url);else openLink(c.open_url)};
 if(state.busy)p.textContent=T.working;a.appendChild(p);
 if(canFull()&&c.stills.length>0&&c.next!=="decide"&&c.next!=="film"){var f=el("button","btn s",T.actionFullScreen);f.onclick=fullscreen;a.appendChild(f)}else if(c.next!=="set_up_product"&&c.next!=="finish_in_picacho"&&c.next!=="closed"&&c.next!=="post"){var o=el("button","btn s",T.actionOpen);o.onclick=function(){openLink(c.open_url)};a.appendChild(o)}
 add(a,el("span","by","Picacho"));card.appendChild(a);
 if(c.short_by)card.appendChild(el("p","note warn",fmtShort(c)));
 if(state.error)card.appendChild(el("p","note warn",state.error));
 return card}
function fmtShort(c){return fmt(T.shortCredits,{needed:c.short_by.needed,have:c.short_by.have})}
function shotView(c,s,i){var w=el("div","shot");var fr=el("div","frame"+(good(s)?" good flash":""));if(good(s))fr.style.setProperty("--at",(350+i*420)+"ms");
 var src=safeImg(s.image_url);if(src){var im=el("img");im.src=src;im.alt=fmt(T.stillAlt,{n:s.shot});fr.appendChild(im)}else fr.appendChild(el("div","busy",T.painting));
 add(fr,el("span","chip",(s.shot<10?"0":"")+s.shot+" · "+mmss(s.span[0])+"–"+mmss(s.span[1])));
 if(!s.painting){var st=el("div","stamps");add(st,stamp(T.face,s.face),stamp(T.product,s.product));fr.appendChild(st)}
 if(good(s))fr.appendChild(el("span","bulb"));
 add(w,fr,el("h3",null,roleName(s.role)));
 if(!s.painting){var rows=el("div","rows");[[T.face,s.face],[T.product,s.product]].forEach(function(p){var line=el("span","v-"+p[1]);add(line,el("i"),el("span",null,p[1]==="no_one_in_shot"?T.no_one_in_shot:p[0]+" · "+(T[p[1]]||p[1])));rows.appendChild(line)});w.appendChild(rows)}
 if(s.painting)return w;
 var acts=el("div","acts");var ch=state.choices[s.shot];
 if(s.decision==="approved"||s.decision==="kept"){add(acts,el("span","pill on",s.decision==="approved"?T.approved:T.kept))}
 else if(clean(s)){var b=el("button","pill"+(ch==="approve"?" on":""),ch==="approve"?T.approved:T.approve);b.onclick=function(){state.choices[s.shot]=ch==="approve"?null:"approve";render()};acts.appendChild(b)}
 if(s.house_repainted)add(w,el("span","quiet",T.houseRepainted));
 if(s.decision==="pending"&&!clean(s))w.appendChild(waitsBox(c,s,T.waitsForYou));
 else if(s.decision==="pending"){var rp=el("button","quiet",fmt(T.repaint,{n:c.quote?c.quote.repaint_credits:1}));rp.onclick=function(){openLink(c.open_url)};acts.appendChild(rp)}
 w.appendChild(acts);return w}
function waitsBox(c,s,title){var ch=state.choices[s.shot];var box=el("div","waits");add(box,el("div","h",title),el("div","t",(s.reason?tr(s.reason)+" ":"")+T.waitsLine));
 var row=el("div","row");var k=el("button","ghost"+(ch==="keep"?" on":""),T.keep);k.onclick=function(){state.choices[s.shot]=ch==="keep"?null:"keep";render()};
 var r=el("button","ghost",fmt(T.repaint,{n:c.quote?c.quote.repaint_credits:1}));r.onclick=function(){openLink(c.open_url)};add(row,r,k);box.appendChild(row);return box}
function full(c){var f=el("div","full");var stars=c.star&&c.product?fmt(T.billing,{star:c.star,product:c.product,seconds:c.cut?c.cut.seconds:15}):"";
 add(f,el("p","billing",stars),el("h2","marquee",T.marquee),el("p","fsub",subline(c)),el("p","same",T.sameAd));
 var g=el("div","fgrid");var shots=el("div","shots");c.stills.forEach(function(s,i){shots.appendChild(shotView(c,s,i))});
 var rail=el("div","rail");if(c.quote){var q=c.quote;var soft=el("div","soft");soft.appendChild(el("p","label",T.theQuote));
  function row(a,b,cls){var r=el("div","qrow"+(cls?" "+cls:""));add(r,el("span",null,a),el("span","v",b));soft.appendChild(r)}
  row(fmt(T.rowStills,{n:c.stills.length}),q.paint+" "+T.cr+(q.paint_paid?" · "+T.paid:""));row(fmt(T.rowFilm,{n:c.stills.length}),q.animate+" "+T.cr+(q.film_paid?" · "+T.paid:""));
  row(T.rowChecks,T.included);row(T.rowPosting,T.included);row(T.wholeAd,q.total+" "+T.cr,"whole");soft.appendChild(el("p","policy",tr(q.policy)));
  if(q.film_paid){soft.appendChild(el("p","bal",fmt(T.balanceLeft,{now:q.balance_now})))}else{var filmNext=q.paint_paid;var big=el("div","big");var bb=el("b",null,filmNext?q.animate:q.paint);bb.appendChild(el("small",null,T.credits));add(big,el("span","label",filmNext?T.toFilm:T.toPaint),bb);soft.appendChild(big);
  soft.appendChild(el("p","bal",fmt(c.short_by?T.balanceLeft:filmNext?T.balanceFilm:T.balancePaint,{now:q.balance_now,after:q.balance_after_next_step})))}rail.appendChild(soft)}
 var blockText=c.short_by?fmtShort(c):(c.next==="decide"&&!allDecided())||c.next==="film_in_picacho"||c.next==="finish_in_picacho"?tr(c.blocker):null;if(blockText){var bl=el("p","blocker",blockText);bl.id="pt-block";rail.appendChild(bl)}
 var key;if(c.next==="paint"){key=el("button","render",fmt(T.actionPaint,{n:c.stills.length}));if(c.quote)key.appendChild(el("span","price",c.quote.paint+" "+T.credits));if(!state.nonce||c.short_by||state.busy)key.setAttribute("aria-disabled","true");key.onclick=function(){if(key.getAttribute("aria-disabled")!=="true")paint()}}
 else if(c.next==="decide"){key=el("button","render",c.film_open?fmt(T.actionFilm,{n:c.stills.length}):T.actionApprove);if(c.film_open&&c.quote)key.appendChild(el("span","price",c.quote.animate+" "+T.credits));if(!allDecided()||!state.nonce||state.busy)key.setAttribute("aria-disabled","true");if(blockText)key.setAttribute("aria-describedby","pt-block");key.onclick=function(){if(key.getAttribute("aria-disabled")!=="true")approve()}}
 else if(c.next==="post"){key=el("button","render",T.actionPressLine);key.onclick=function(){openLink(c.press_line_url||c.open_url)}}
 else if(c.next==="film_in_picacho"||c.next==="finish_in_picacho"){key=el("button","render",c.next==="film_in_picacho"?T.actionFilmInPicacho:T.actionOpen);key.onclick=function(){openLink(c.open_url)}}
 if(key){if(state.busy)key.firstChild.textContent=T.working;rail.appendChild(key)}
 if(c.next!=="finish_in_picacho"){var open=el("button","link",T.actionOpen);open.onclick=function(){openLink(c.open_url)};rail.appendChild(open)}
 if(state.error)rail.appendChild(el("p","err",state.error));
 var wide=el("div","wideWaits");c.stills.forEach(function(s){if(!s.painting&&s.decision==="pending"&&!clean(s))wide.appendChild(waitsBox(c,s,fmt(T.shotWaits,{n:s.shot})))});
 var left=el("div");add(left,shots,wide);add(g,left,rail);f.appendChild(g);return f}
function render(){root.textContent="";var c=state.card;if(!c)return;root.appendChild(state.display==="fullscreen"?full(c):inline(c));size()}
var lastH=0;function size(){var h=Math.ceil(document.documentElement.scrollHeight);if(bridge&&h!==lastH){lastH=h;notify("ui/notifications/size-changed",{width:Math.ceil(document.documentElement.scrollWidth),height:h})}}
if(window.ResizeObserver)new ResizeObserver(size).observe(document.body);
send("ui/initialize",{protocolVersion:"2026-01-26",appInfo:{name:"picacho-press-tour",version:"1"},appCapabilities:{availableDisplayModes:["inline","fullscreen"]}}).then(function(r){bridge=true;context((r&&r.hostContext)||{});notify("ui/notifications/initialized",{});render()}).catch(function(){});
function fromOpenAI(){var o=window.openai;if(!o||state.card)return;if(o.theme)context({theme:o.theme,displayMode:o.displayMode,locale:o.locale});if(o.toolOutput)take({structuredContent:o.toolOutput,_meta:o.toolResponseMetadata||{}})}
window.addEventListener("openai:set_globals",function(){var o=window.openai;if(!o)return;if(o.displayMode){state.display=o.displayMode}if(!bridge&&o.toolOutput)take({structuredContent:o.toolOutput,_meta:o.toolResponseMetadata||{}});else render()});
setTimeout(fromOpenAI,1500);
})();
`;

/**
 * The engine's own sentences a card can carry (its blocker, why it closed,
 * a still's reason, the launch policy), in the card's other languages: the
 * app's catalogs (i18n/server-text.ts) looked up once here, so a Spanish
 * card never shows an English line. Parallel lists, English first; a
 * sentence with no translation passes through as it came.
 */
function engineTexts(): Record<string, string[]> {
  const shots = [1, 2, 3, 4, 5, 6];
  const english = [
    ...new Set<string>([
      ...CAMPAIGN_MESSAGES,
      ...FILM_MESSAGES,
      ...PRODUCT_LOCK_MESSAGES,
      ...shots.map(blockDecide),
      ...shots.map(blockDecideShot),
    ]),
  ];
  const out: Record<string, string[]> = { en: [...english, POLICY_LINE] };
  for (const [lang, t] of [["es", es], ["pt", pt], ["it", itMessages]] as const) {
    out[lang] = [...english.map((line) => localizeServerText(line, t)), WIDGET_TEXTS[lang].policyLine];
  }
  return out;
}

/** The whole view: one HTML document, no external anything. */
export function pressTourWidgetHtml(): string {
  const texts = JSON.stringify(WIDGET_TEXTS).replace(/</g, "\\u003c");
  const engine = JSON.stringify(engineTexts()).replace(/</g, "\\u003c");
  const script = SCRIPT.replace("__TEXTS__", texts).replace("__ENGINE__", engine).replace("__NONCE_KEY__", UI_NONCE_META_KEY);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Press Tour</title><style>${CSS}</style></head><body><main id="app" aria-live="polite"></main><script>${script}</script></body></html>`;
}
