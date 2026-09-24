// A checked EditPlan → one HyperFrames composition (index.html).
//
// Deterministic and pure: the same plan and transcript give byte-identical
// HTML, so a render can be reproduced and the suite can pin the output. The
// only words that come from the customer or the model are text cards and the
// transcript's words, and every one of them goes through escapeHtml into an
// element's text — never into an attribute, a style or the script. The
// script only ever names ids this file made up.
//
// Media is referenced by path inside the bundle (bundle.ts writes one trimmed
// file per shot, so a 40-minute rush does not travel to the renderer to play
// four seconds of it); `mediaStart` is where the shot's first frame sits in
// that file.

import { canvasFor, planDuration, round3, type EditPlan, type Look, type TextKind } from "./plan";
import { captionLines, placeWords, shotStarts, type Transcripts } from "./timeline";

/** `fillSrc`: the baked blurred fill for a "contain" shot (analyze.ts fillArgs), same timing as `src`. */
export type ShotMedia = { src: string; mediaStart: number; hasAudio: boolean; fillSrc?: string };
export type MusicMedia = { src: string; mediaStart: number };

export type CompileInput = {
  plan: EditPlan;
  transcripts: Transcripts;
  /** One per plan.shots entry, same order. */
  shotMedia: ShotMedia[];
  music: MusicMedia | null;
};

/** gsap is loaded from the one CDN HyperFrames' own templates use; the version is pinned. */
const GSAP_SRC = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";
const FADE_SECONDS = 0.4;
const AUDIO_FADE_SECONDS = 0.2;

type LookStyle = {
  font: string;
  titleFont: string;
  titleWeight: number;
  upper: boolean;
  captionSize: number;
  captionWeight: number;
  captionBox: boolean;
  accent: string;
  letterbox: boolean;
};

// The three looks. Font families are ones the HyperFrames renderer ships
// (@hyperframes/producer depends on their @fontsource packages), so a render
// never falls back to a system face the preview did not have.
const LOOKS: Record<Look, LookStyle> = {
  clean: {
    font: "Inter",
    titleFont: "Inter",
    titleWeight: 700,
    upper: false,
    captionSize: 54,
    captionWeight: 600,
    captionBox: true,
    accent: "#ffd166",
    letterbox: false,
  },
  bold: {
    font: "Montserrat",
    titleFont: "Archivo Black",
    titleWeight: 400,
    upper: true,
    captionSize: 72,
    captionWeight: 800,
    captionBox: false,
    accent: "#ffe600",
    letterbox: false,
  },
  cinematic: {
    font: "Inter",
    titleFont: "EB Garamond",
    titleWeight: 500,
    upper: false,
    captionSize: 44,
    captionWeight: 500,
    captionBox: false,
    accent: "#f4e3c1",
    letterbox: true,
  },
};

export function compileComposition(input: CompileInput): string {
  const { plan, transcripts, shotMedia, music } = input;
  if (shotMedia.length !== plan.shots.length) {
    throw new Error(`compile: ${plan.shots.length} shots but ${shotMedia.length} media entries`);
  }
  const { width, height } = canvasFor(plan.aspect);
  const total = planDuration(plan);
  const look = LOOKS[plan.look];
  const unit = Math.min(width, height) / 1080;
  const px = (n: number) => `${Math.round(n * unit)}px`;
  const portrait = height > width;
  const starts = shotStarts(plan.shots);

  const body: string[] = [];
  const script: string[] = [];

  // Pictures and their own sound.
  plan.shots.forEach((shot, i) => {
    const media = shotMedia[i];
    const len = round3(shot.to - shot.from);
    const audible = media.hasAudio && shot.volume > 0;
    const next = plan.shots[i + 1];
    const attrs = [
      `id="v${i}"`,
      `class="clip shot"`,
      `src="${attr(media.src)}"`,
      `data-start="${starts[i]}"`,
      `data-duration="${len}"`,
      `data-media-start="${round3(media.mediaStart)}"`,
      // HyperFrames' rule: a clip either declares its sound or is muted.
      audible ? `data-has-audio="true" data-volume="${round3(shot.volume)}"` : "muted",
      audible && shot.transitionIn === "fade" ? `data-fade-in="${AUDIO_FADE_SECONDS}"` : "",
      audible && next?.transitionIn === "fade" ? `data-fade-out="${AUDIO_FADE_SECONDS}"` : "",
      shot.fit === "contain"
        ? `style="object-fit:contain;transform:scale(${round3(shot.zoom)});transform-origin:${pct(shot.focusX)} ${pct(shot.focusY)}"`
        : `style="object-position:${pct(shot.focusX)} ${pct(shot.focusY)};transform:scale(${round3(shot.zoom)});transform-origin:${pct(shot.focusX)} ${pct(shot.focusY)}"`,
      "playsinline",
    ].filter(Boolean);
    if (shot.fit === "contain" && media.fillSrc) {
      // The fill: the same shot, silent, cropped to the frame and blurred
      // (baked by work.ts), under the whole picture — the vertical-video
      // answer to a wide shot.
      body.push(
        `      <video id="b${i}" class="clip shot fill" src="${attr(media.fillSrc)}" data-start="${starts[i]}" data-duration="${len}" data-media-start="${round3(media.mediaStart)}" muted playsinline></video>`,
      );
      if (shot.transitionIn === "fade") {
        script.push(`tl.fromTo("#b${i}", { opacity: 0 }, { opacity: 1, duration: ${FADE_SECONDS}, ease: "none" }, ${starts[i]});`);
      }
      if (next?.transitionIn === "fade" && len > FADE_SECONDS * 2) {
        script.push(`tl.to("#b${i}", { opacity: 0, duration: ${FADE_SECONDS}, ease: "none" }, ${round3(starts[i] + len - FADE_SECONDS)});`);
      }
    }
    body.push(`      <video ${attrs.join(" ")}></video>`);
    if (shot.transitionIn === "fade") {
      script.push(`tl.fromTo("#v${i}", { opacity: 0 }, { opacity: 1, duration: ${FADE_SECONDS}, ease: "none" }, ${starts[i]});`);
    }
    if (next?.transitionIn === "fade" && len > FADE_SECONDS * 2) {
      script.push(`tl.to("#v${i}", { opacity: 0, duration: ${FADE_SECONDS}, ease: "none" }, ${round3(starts[i] + len - FADE_SECONDS)});`);
    }
  });

  if (music) {
    body.push(
      `      <audio id="music" class="clip" src="${attr(music.src)}" data-start="0" data-duration="${total}" data-media-start="${round3(music.mediaStart)}" data-has-audio="true" data-volume="${round3(plan.music?.volume ?? 0.3)}" data-fade-in="0.5" data-fade-out="1.5"></audio>`,
    );
  }

  if (look.letterbox && !portrait) {
    body.push(`      <div class="bar top"></div>`, `      <div class="bar bottom"></div>`);
  }

  // Captions from what is actually heard.
  if (plan.captions !== "off") {
    const words = placeWords(plan, transcripts);
    const maxChars = portrait ? 22 : plan.look === "bold" ? 26 : 38;
    // Captions give way to a full-frame card: no line starts under a title or
    // end card, and a line running into one ends when it appears (first paid
    // proof, 2026-09-24: "NOW IMAGINE YOURS" showing through the end card).
    const cards = plan.texts.filter((t) => t.kind === "title" || t.kind === "end-card");
    const underCard = (t: number) => cards.some((c) => t >= c.start && t < c.start + c.duration);
    captionLines(words.filter((w) => !underCard(w.start)), { maxChars }).forEach((line, li) => {
      const start = round3(line.start);
      const nextCard = cards.map((c) => c.start).filter((s) => s > start).sort((a, b) => a - b)[0];
      const end = Math.min(line.end, total, nextCard ?? Infinity);
      if (end - start < 0.1) return;
      const spans = line.words
        .map((w, wi) => `<span id="c${li}w${wi}">${escapeHtml(look.upper ? w.text.trim().toUpperCase() : w.text.trim())}</span>`)
        .join(" ");
      body.push(`      <div id="c${li}" class="clip cap" data-start="${start}" data-duration="${round3(end - start)}">${spans}</div>`);
      if (plan.captions === "words") {
        line.words.forEach((w, wi) => {
          script.push(`tl.set("#c${li}w${wi}", { color: ${JSON.stringify(look.accent)} }, ${round3(w.start)});`);
          if (wi < line.words.length - 1) script.push(`tl.set("#c${li}w${wi}", { color: "#ffffff" }, ${round3(line.words[wi + 1].start)});`);
        });
      }
    });
  }

  // Text cards.
  plan.texts.forEach((t, i) => {
    body.push(
      `      <div id="t${i}" class="clip card ${t.kind}" data-start="${t.start}" data-duration="${t.duration}"><span>${escapeHtml(t.text)}</span></div>`,
    );
    const inAt = round3(t.start);
    const outAt = round3(Math.max(t.start, t.start + t.duration - 0.35));
    script.push(`tl.fromTo("#t${i} span", { opacity: 0, y: ${enterOffset(t.kind)} }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }, ${inAt});`);
    if (t.duration > 1.2) script.push(`tl.to("#t${i} span", { opacity: 0, duration: 0.3 }, ${outAt});`);
  });

  const captionBottom = portrait ? px(360) : px(90);
  const css = `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; font-family: "${look.font}", ui-sans-serif, system-ui, sans-serif; }
      .shot { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .shot.fill { transform: scale(1.08); }
      .bar { position: absolute; left: 0; right: 0; height: 10%; background: #000; z-index: 5; }
      .bar.top { top: 0; } .bar.bottom { bottom: 0; }
      .cap { position: absolute; left: 6%; right: 6%; bottom: ${captionBottom}; z-index: 10; text-align: center; color: #fff; font-size: ${px(look.captionSize)}; font-weight: ${look.captionWeight}; line-height: 1.2; }
      .cap { ${look.captionBox ? "background: rgba(0,0,0,.55); padding: .25em .6em; border-radius: .35em; left: 50%; right: auto; transform: translateX(-50%); width: max-content; max-width: 88%;" : "text-shadow: 0 0 .12em #000, 0 .06em .18em rgba(0,0,0,.9);"} }
      .card { position: absolute; z-index: 20; color: #fff; }
      .card span { display: inline-block; }
      .card.title { inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 8%; font-family: "${look.titleFont}", serif; font-weight: ${look.titleWeight}; font-size: ${px(portrait ? 112 : 124)}; line-height: 1.05; letter-spacing: -0.02em; ${look.upper ? "text-transform: uppercase;" : ""} text-shadow: 0 .04em .3em rgba(0,0,0,.6); }
      .card.end-card { inset: 0; display: flex; align-items: center; justify-content: center; text-align: center; padding: 0 10%; background: rgba(0,0,0,.72); font-family: "${look.titleFont}", serif; font-weight: ${look.titleWeight}; font-size: ${px(96)}; ${look.upper ? "text-transform: uppercase;" : ""} }
      .card.lower-third { left: 6%; bottom: ${portrait ? px(560) : px(220)}; font-size: ${px(46)}; font-weight: 700; }
      .card.lower-third span { background: rgba(0,0,0,.6); padding: .3em .65em; border-left: .18em solid ${look.accent}; }
      .card.callout { left: 6%; right: 6%; top: ${portrait ? px(300) : px(90)}; text-align: center; font-size: ${px(64)}; font-weight: 800; ${look.upper ? "text-transform: uppercase;" : ""} text-shadow: 0 0 .12em #000, 0 .06em .2em rgba(0,0,0,.9); }
`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <script src="${GSAP_SRC}"></script>
    <style>${css}    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${width}" data-height="${height}">
${body.join("\n")}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
${script.map((line) => `      ${line}`).join("\n")}
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;
}

function enterOffset(kind: TextKind): number {
  return kind === "lower-third" ? 0 : kind === "callout" ? -24 : 32;
}

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Paths are ours (bundle.ts names them), but an attribute is escaped regardless. */
function attr(s: string): string {
  return escapeHtml(s);
}
