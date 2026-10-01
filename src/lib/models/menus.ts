// The items on each customer menu, built from the catalogues the product
// itself offers from (so a model added there shows up here), and the rules
// that keep a menu usable: what can never be turned off, and the last item
// of a group, which can't be either. Relative imports only: tested.

import { VIDEO_MODELS_BY_PRICE, isDormantVideoModel } from "../generations/providers/video-models";
import { IMAGE_MODELS, SELECTABLE_IMAGE_MODEL_IDS } from "../generations/providers/image-models";
import { FREE_TIER_VIDEO_MODEL_ID } from "../plans";
import { RECAST_ENGINES, RECAST_ENGINE_ORDER } from "../recast/recast";
import { MODEL_ENGINES } from "../sets/model-engines";
import { ENGINES as EFFECT_ENGINES } from "../effects/catalog";
import { ENGINES as MUSIC_ENGINES } from "../editor/composer";
import { STILL_ENGINES, DEFAULT_STILL_ENGINE } from "../press-tour/quote";
import { SET_TAKE_DEFAULT_ENGINE, SET_TAKE_ENGINES } from "../sets/take";
import { isOffered, type MenuItem, type MenuKey, type ModelControls } from "./registry";

export type MenuItemWithGroup = MenuItem & { group?: string; costPerSecondUsd?: number };

const imageName = (id: string) => IMAGE_MODELS.find((m) => m.id === id)?.name ?? id;
const imageProvider = (id: string) => (IMAGE_MODELS.find((m) => m.id === id)?.provider === "openai" ? "OpenAI" : "fal");

export function menuItems(menu: MenuKey): MenuItemWithGroup[] {
  switch (menu) {
    case "video":
      return VIDEO_MODELS_BY_PRICE.map((m) => ({
        id: m.id,
        label: m.name,
        provider: /seedance/.test(m.id) ? "fal / BytePlus" : "fal",
        detail: isDormantVideoModel(m.id) ? `${m.falEndpoint} · experimental (Feature flags)` : m.falEndpoint,
        costPerSecondUsd: m.costPerSecondUsd,
        locked: m.id === FREE_TIER_VIDEO_MODEL_ID ? "Free accounts render on it." : undefined,
      }));
    case "picture":
      return SELECTABLE_IMAGE_MODEL_IDS.map((id) => ({ id, label: imageName(id), provider: imageProvider(id) }));
    case "aly_brains":
      return [
        { id: "claude", label: "Claude", provider: "Anthropic", detail: "Model set below (Claude brain)" },
        { id: "gpt", label: "GPT", provider: "OpenAI", detail: "gpt-6-sol" },
        { id: "gemini", label: "Gemini", provider: "Google", detail: "gemini-3.8-flash" },
      ];
    case "recast":
      return RECAST_ENGINE_ORDER.map((e) => ({
        id: e,
        label: RECAST_ENGINES[e].label,
        provider: "fal",
        detail: `${RECAST_ENGINES[e].job} · ${RECAST_ENGINES[e].tier === "full" ? "full" : "lite"} · ${RECAST_ENGINES[e].endpoint}`,
        group: RECAST_ENGINES[e].job,
      }));
    case "models_3d":
      return MODEL_ENGINES.map((e) => ({ id: e.id, label: e.name, provider: "fal", group: "3d" }));
    case "helios_takes":
      return (Object.keys(SET_TAKE_ENGINES) as (keyof typeof SET_TAKE_ENGINES)[]).map((k) => ({
        id: k,
        label: k === "omni" ? `Gemini Omni (${SET_TAKE_ENGINES[k].seconds} s)` : `Veo 3.1 (${SET_TAKE_ENGINES[k].seconds} s)`,
        provider: "fal",
        locked: k === SET_TAKE_DEFAULT_ENGINE ? "The default take engine." : undefined,
      }));
    case "effects":
      return (Object.keys(EFFECT_ENGINES) as (keyof typeof EFFECT_ENGINES)[]).map((k) => ({
        id: k,
        label: EFFECT_ENGINES[k].label,
        provider: "fal",
        detail: `${EFFECT_ENGINES[k].input === "video" ? "Effects on videos" : "Effects on photos"} · ${EFFECT_ENGINES[k].endpoint}`,
      }));
    case "music":
      return (Object.keys(MUSIC_ENGINES) as (keyof typeof MUSIC_ENGINES)[]).map((k) => ({
        id: k,
        label: k === "eleven" ? "ElevenLabs Music 2.5" : "ACE-Step",
        provider: "fal",
        detail: MUSIC_ENGINES[k].endpoint,
        group: "music",
      }));
    case "press_stills":
      return STILL_ENGINES.map((id) => ({
        id,
        label: imageName(id),
        provider: imageProvider(id),
        locked: id === DEFAULT_STILL_ENGINE ? "Press Tour's default picture engine." : undefined,
      }));
  }
}

/**
 * Why this item can't be turned off right now, or null when it can. `defaults`
 * are the admin's current defaults (app_settings video_model / image_model).
 */
export function offLock(
  menu: MenuKey,
  id: string,
  controls: ModelControls,
  defaults: { video: string; picture: string },
): string | null {
  const items = menuItems(menu);
  const item = items.find((i) => i.id === id);
  if (!item) return "Not on this menu.";
  if (item.locked) return item.locked;
  if (menu === "video" && id === defaults.video) return "The default video model. Pick another default first.";
  if (menu === "picture" && id === defaults.picture) return "The default picture model. Pick another default first.";
  const group = items.filter((i) => i.group === item.group);
  if (item.group && group.filter((i) => i.id !== id && isOffered(controls, menu, i.id)).length === 0) {
    return "The last one left for this job.";
  }
  if (!item.group && items.filter((i) => i.id !== id && isOffered(controls, menu, i.id)).length === 0) {
    return "The last one left on this menu.";
  }
  return null;
}
