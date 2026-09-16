// The lab, on the stage (Helios, 2026-09-16): what the rig's lab looks will
// do, shown on the live view before a credit moves — the promise the panel
// makes about every other control (the frame lines, the field of view, the
// depth of field, the light, the grade), kept for the stock and the lens too.
//
// A PREVIEW, NOT THE LAB. The lab itself is lab-grade.ts, on the finished
// pixels of the still (grain field, real blurs, a long flare streak). This is
// one fragment pass on the live view, with the same order — the lens, then
// the stock — and the same intent, drawn cheaply enough to hold 60 frames a
// second: a ring of taps for the glows instead of a gaussian, taps along the
// row for the streak, hashed grain in screen space. It never touches what the
// image model sees: the sketch is rendered straight from the renderer
// (set-view.tsx frame() and snapshot()), never through the composer.
//
// ONLY INSIDE THE FRAME LINES, and LAST. The picture is the band the frame
// lines draw, so the pass leaves the stage round it alone — a viewport full
// of grain reads as a broken screen, not as film. And it runs AFTER the
// output pass, on the picture as shown rather than on linear light.
//
// TEXTURE, NOT TONE. It draws what the eye recognises a stock or a lens by —
// grain, softness, a glow, a streak, a vignette, scanlines — and leaves the
// lab's tone alone: lifted blacks, a highlight shoulder, warmth and washed
// colour belong to a finished photograph, and on the grey mock, which is
// nearly all dark, 16 mm's lifted blacks came out as fog over the whole band
// (seen on the stage, 2026-09-16). The still itself gets the lot.
//
// Silver Print is not here: the palettes already preview themselves as a CSS
// grade over the canvas (rig.ts palette filters), and doing it twice would
// double the contrast.
//
// Pure: the shader's source and the codes the stage sets. Relative imports
// only, and no three.js — the page passes this to a ShaderPass.

import type { SetRig } from "./rig";

/** The stock the preview draws, as the shader's number. */
export const LAB_PREVIEW_STOCK: Record<string, number> = { digital: 0, film35: 1, film16: 2, homevideo: 3 };
/** The lens character the preview draws, as the shader's number. */
export const LAB_PREVIEW_LENS: Record<string, number> = { clean: 0, anamorphic: 1, vintage: 2, halation: 3 };

/** What the stage should show for this rig; 0 and 0 is nothing to draw (the pass switches off). */
export function labPreviewCodes(rig: Pick<SetRig, "stock" | "lens">): { stock: number; lens: number } {
  return {
    stock: (rig.stock && LAB_PREVIEW_STOCK[rig.stock]) || 0,
    lens: (rig.lens && LAB_PREVIEW_LENS[rig.lens]) || 0,
  };
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uStock;
uniform float uLens;
// Device pixels per CSS pixel: the grain is a speck on the picture, not on
// the screen, so a 2× display gets 2× specks.
uniform float uScale;
// The frame lines in uv: x0, y0, x1, y1. The look stops at their edge.
uniform vec4 uFrame;
varying vec2 vUv;

float luma3(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 tex(vec2 uv) { return texture2D(tDiffuse, uv).rgb; }

/** How far above \`t\` this colour is, by luma or by its brightest channel. */
float hi(vec3 c, float t) { return clamp((luma3(c) - t) / (1.0 - t), 0.0, 1.0); }
float hiPeak(vec3 c, float t) { return clamp((max(max(c.r, c.g), c.b) - t) / (1.0 - t), 0.0, 1.0); }

/** Light added, never multiplied: the same screen blend the lab uses. */
vec3 addLight(vec3 base, vec3 glow) { return 1.0 - (1.0 - base) * (1.0 - clamp(glow, 0.0, 1.0)); }

/** Nine taps round the middle: the lab's gaussian, cheaply. */
vec3 soften(vec2 uv, vec2 r) {
  vec3 c = tex(uv) * 0.2;
  c += (tex(uv + vec2(r.x, 0.0)) + tex(uv - vec2(r.x, 0.0)) + tex(uv + vec2(0.0, r.y)) + tex(uv - vec2(0.0, r.y))) * 0.125;
  c += (tex(uv + r) + tex(uv - r) + tex(uv + vec2(r.x, -r.y)) + tex(uv - vec2(r.x, -r.y))) * 0.075;
  return c;
}

/** The highlights around this point, as one number: eight taps on a ring. */
float ringGlow(vec2 uv, vec2 r, float t, bool peak) {
  float sum = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853981634;
    vec3 s = tex(uv + vec2(cos(a), sin(a)) * r);
    sum += peak ? hiPeak(s, t) : hi(s, t);
  }
  return sum / 8.0;
}

/** Fixed in screen space, like grain on a print: the same speck every frame. */
float grainAt(vec2 px, float size) {
  vec2 p = floor(px / size);
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z) * 2.0 - 1.0;
}

float vignetteAt(vec2 uv, float edge) {
  float d = length(uv - vec2(0.5)) / 0.7071;
  return 1.0 - (1.0 - edge) * pow(max(0.0, (d - 0.35) / 0.65), 1.8);
}

void main() {
  vec2 uv = vUv;
  vec3 col = tex(uv);
  if (uv.x < uFrame.x || uv.x > uFrame.z || uv.y < uFrame.y || uv.y > uFrame.w) {
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // The lens first: glow, halation, the flare streak (lab-grade.ts's order).
  if (uLens > 1.5 && uLens < 2.5) {
    float glow = ringGlow(uv, uTexel * 10.0, 0.62, false);
    col = addLight(col, vec3(1.0, 0.92, 0.78) * glow * 0.55);
    col *= vignetteAt(uv, 0.62);
  } else if (uLens > 2.5) {
    float halo = ringGlow(uv, uTexel * 9.0, 0.78, true);
    col = addLight(col, vec3(1.0, 0.3, 0.08) * halo * 0.9);
  } else if (uLens > 0.5) {
    float streak = 0.0;
    for (int i = 1; i <= 10; i++) {
      float d = float(i) * uTexel.x * 9.0;
      streak += hi(tex(uv + vec2(d, 0.0)), 0.9) + hi(tex(uv - vec2(d, 0.0)), 0.9);
    }
    col = addLight(col, vec3(0.35, 0.62, 1.0) * clamp(streak / 6.0, 0.0, 1.0) * 0.6);
  }

  // Then the stock: the texture it records with.
  if (uStock > 2.5) {
    // Home video: soft, the colour smeared and dragged right, washed, scanlines.
    col = soften(uv, uTexel * vec2(1.6, 0.9));
    vec3 dragged = soften(uv - vec2(uTexel.x * 4.0, 0.0), vec2(uTexel.x * 5.0, 0.0));
    col = vec3(luma3(col)) + (dragged - vec3(luma3(dragged)));
    col += vec3(grainAt(gl_FragCoord.xy, uScale) * 0.018);
    if (mod(floor(gl_FragCoord.y / uScale), 3.0) < 0.5) col *= 0.9;
  } else if (uStock > 1.5) {
    // 16 mm: softer, coarse grain, lifted blacks, a faint vignette.
    col = soften(uv, uTexel * 0.9);
    float l = luma3(col);
    col += vec3(grainAt(gl_FragCoord.xy, 2.2 * uScale) * 0.075 * (0.35 + 2.6 * l * (1.0 - l)));
    col *= vignetteAt(uv, 0.8);
  } else if (uStock > 0.5) {
    // 35 mm: fine grain.
    float l = luma3(col);
    col += vec3(grainAt(gl_FragCoord.xy, uScale) * 0.035 * (0.35 + 2.6 * l * (1.0 - l)));
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

/** The pass the stage adds after the depth of field (set-view.tsx). */
export const LAB_PREVIEW_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: [1 / 1024, 1 / 1024] },
    uStock: { value: 0 },
    uLens: { value: 0 },
    uScale: { value: 1 },
    uFrame: { value: [0, 0, 1, 1] },
  },
  vertexShader: VERTEX,
  fragmentShader: FRAGMENT,
};
