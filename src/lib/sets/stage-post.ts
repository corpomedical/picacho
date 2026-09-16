// What the live view is drawn through on the full stage (canvas page J,
// cut 1, 2026-09-17): the picture, its ambient occlusion, the rig's depth
// of field, the bloom on anything that glows, the output (tone mapping and
// colour), and the lab's look last. Only the LIVE view: frame() and
// snapshot() draw straight from the renderer, so the sketch the picture
// model sees carries the sky, the surfaces and the shadows but is never
// blurred, bloomed or grained.
//
// The passes are three's own addons, imported here once so the page's
// stage effect stays readable; the basic stage (phones, ?stage=basic)
// keeps the shorter chain it had — depth of field and the lab only.

import type * as ThreeNS from "three";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import type { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import type { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import type { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { LAB_PREVIEW_SHADER } from "./lab-preview";
import type { StageQuality } from "./build-scene";

type Three = typeof ThreeNS;

export type StagePasses = Awaited<ReturnType<typeof loadStagePasses>>;

/** The addons, loaded once when the stage first needs them. */
export async function loadStagePasses() {
  const [composer, render, bokeh, shader, output, gtao, bloom] = await Promise.all([
    import("three/examples/jsm/postprocessing/EffectComposer.js"),
    import("three/examples/jsm/postprocessing/RenderPass.js"),
    import("three/examples/jsm/postprocessing/BokehPass.js"),
    import("three/examples/jsm/postprocessing/ShaderPass.js"),
    import("three/examples/jsm/postprocessing/OutputPass.js"),
    import("three/examples/jsm/postprocessing/GTAOPass.js"),
    import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
  ]);
  return {
    EffectComposer: composer.EffectComposer,
    RenderPass: render.RenderPass,
    BokehPass: bokeh.BokehPass,
    ShaderPass: shader.ShaderPass,
    OutputPass: output.OutputPass,
    GTAOPass: gtao.GTAOPass,
    UnrealBloomPass: bloom.UnrealBloomPass,
  };
}

/**
 * The full stage's bloom: only the brightest things glow (lamps, screens,
 * the sun's glints), a little by day and more at night, where the lamps are
 * the picture.
 */
export const STAGE_BLOOM = {
  day: { strength: 0.07, radius: 0.4, threshold: 0.97 },
  night: { strength: 0.28, radius: 0.6, threshold: 0.85 },
} as const;

/** The full stage's ambient occlusion: half a metre of reach by day, a little less indoors at night. */
export const STAGE_AO = {
  day: { radius: 0.6, blend: 0.9 },
  night: { radius: 0.35, blend: 0.9 },
} as const;

export type StageComposer = {
  composer: EffectComposer;
  bokeh: BokehPass;
  lab: ShaderPass;
  ao: GTAOPass | null;
  bloom: UnrealBloomPass | null;
};

/**
 * The chain for a stage. `night` picks the bloom and the occlusion for a
 * night set; the lab pass is last, after the output pass, so it works on
 * the picture as shown — the same values lab-grade.ts grades.
 */
export function makeStageComposer(
  THREE: Three,
  P: StagePasses,
  renderer: ThreeNS.WebGLRenderer,
  scene: ThreeNS.Scene,
  camera: ThreeNS.Camera,
  opts: { quality: StageQuality; night: boolean; width: number; height: number },
): StageComposer {
  const w = Math.max(1, opts.width);
  const h = Math.max(1, opts.height);
  const full = opts.quality === "full";
  const c = new P.EffectComposer(renderer);
  c.addPass(new P.RenderPass(scene, camera));
  let ao: GTAOPass | null = null;
  if (full) {
    const look = opts.night ? STAGE_AO.night : STAGE_AO.day;
    ao = new P.GTAOPass(scene, camera, w, h);
    ao.output = P.GTAOPass.OUTPUT.Default;
    ao.updateGtaoMaterial({ radius: look.radius, distanceExponent: 1, thickness: 1, scale: 1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
    ao.blendIntensity = look.blend;
    c.addPass(ao);
  }
  const bokeh = new P.BokehPass(scene, camera, { focus: 4, aperture: 0, maxblur: 0 });
  c.addPass(bokeh);
  let bloom: UnrealBloomPass | null = null;
  if (full) {
    const look = opts.night ? STAGE_BLOOM.night : STAGE_BLOOM.day;
    bloom = new P.UnrealBloomPass(new THREE.Vector2(w, h), look.strength, look.radius, look.threshold);
    c.addPass(bloom);
  }
  c.addPass(new P.OutputPass());
  const lab = new P.ShaderPass(LAB_PREVIEW_SHADER);
  lab.uniforms.uTexel.value = new THREE.Vector2(1 / w, 1 / h);
  lab.uniforms.uFrame.value = new THREE.Vector4(0, 0, 1, 1);
  c.addPass(lab);
  c.setPixelRatio(renderer.getPixelRatio());
  c.setSize(w, h);
  return { composer: c, bokeh, lab, ao, bloom };
}
