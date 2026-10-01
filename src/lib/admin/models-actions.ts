"use server";

// Admin → Models (2026-10-02): the switches. Each one saves to the
// model_controls row (registry.ts), or to the video_model / image_model
// defaults, logs to the Activity log with what it was before, and comes back
// to the page with an Undo that saves the old value the same way.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/require-admin";
import { logAdminAction } from "@/lib/admin/audit";
import { forgetModelControls } from "@/lib/models/controls";
import {
  MODEL_CONTROLS_KEY,
  isOffered,
  jobSlot,
  menuDef,
  parseModelControls,
  pickedJobModel,
  type ModelControls,
} from "@/lib/models/registry";
import { menuItems, offLock } from "@/lib/models/menus";
import { VIDEO_MODELS, isDormantVideoModel } from "@/lib/generations/providers/video-models";
import { IMAGE_MODELS, SELECTABLE_IMAGE_MODEL_IDS } from "@/lib/generations/providers/image-models";

type Admin = Awaited<ReturnType<typeof requireAdmin>>["admin"];

function back(product: string, params: Record<string, string>): never {
  const q = new URLSearchParams({ p: product, ...params });
  redirect(`/admin/models?${q.toString()}`);
}

const productOf = (fd: FormData) => {
  const p = fd.get("product");
  return typeof p === "string" && /^[a-z]{1,20}$/.test(p) ? p : "video";
};

async function readControls(admin: Admin): Promise<ModelControls> {
  const { data, error } = await admin.from("app_settings").select("value").eq("key", MODEL_CONTROLS_KEY).maybeSingle<{ value: string | null }>();
  if (error) throw new Error(error.message);
  return parseModelControls(data?.value);
}

async function saveControls(admin: Admin, controls: ModelControls): Promise<string | null> {
  // Upsert through the service client: app_settings has an admin UPDATE
  // policy but no INSERT policy, and this row has no migration behind it.
  const { error } = await admin.from("app_settings").upsert(
    {
      key: MODEL_CONTROLS_KEY,
      value: JSON.stringify(controls),
      description: "Admin → Models: behind-the-scenes model picks and models taken off customer menus.",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  forgetModelControls();
  return error ? error.message : null;
}

async function readDefaults(admin: Admin): Promise<{ video: string; picture: string }> {
  const { data } = await admin.from("app_settings").select("key, value").in("key", ["video_model", "image_model"]);
  const get = (k: string) => (data ?? []).find((r) => r.key === k)?.value as string | undefined;
  return { video: get("video_model") ?? "kling", picture: get("image_model") ?? "gpt-image" };
}

/**
 * Back to the page with what changed, as ids the page turns into words (never
 * text from the URL: anyone can send an admin a link) and the old value for Undo.
 */
function done(product: string, change: Record<string, string>): never {
  revalidatePath("/admin/models");
  back(product, Object.fromEntries(Object.entries(change).map(([k, v]) => [`d_${k}`, v])));
}

/** A behind-the-scenes job's model. */
export async function setJobModel(formData: FormData) {
  const { admin, userId } = await requireAdmin();
  const product = productOf(formData);
  const slot = jobSlot(String(formData.get("job") ?? ""));
  const model = String(formData.get("model") ?? "");
  if (!slot || !slot.options.some((o) => o.id === model)) back(product, { err: "bad_model" });

  const controls = await readControls(admin);
  const before = pickedJobModel(controls, slot.key);
  if ((before ?? slot.default) === model && before !== null) back(product, {});
  const error = await saveControls(admin, { ...controls, jobs: { ...controls.jobs, [slot.key]: model } });
  if (error) {
    console.error("setJobModel: save failed", error);
    back(product, { err: "save_failed" });
  }

  await logAdminAction(admin, userId, {
    action: "model.job",
    targetType: "model",
    targetId: slot.key,
    before: before ?? `${slot.default} (default)`,
    after: model,
  });
  done(product, { kind: "job", job: slot.key, now: model, was: before ?? slot.default });
}

/** Offer an item on a customer menu, or take it off. */
export async function setMenuOffered(formData: FormData) {
  const { admin, userId } = await requireAdmin();
  const product = productOf(formData);
  const menu = menuDef(String(formData.get("menu") ?? ""));
  const id = String(formData.get("item") ?? "");
  const offer = formData.get("offer") === "1";
  if (!menu) back(product, { err: "bad_model" });
  const item = menuItems(menu.key).find((i) => i.id === id);
  if (!item) back(product, { err: "bad_model" });

  const controls = await readControls(admin);
  if (isOffered(controls, menu.key, id) === offer) back(product, {});
  if (!offer) {
    const lock = offLock(menu.key, id, controls, await readDefaults(admin));
    if (lock) back(product, { err: "locked", menu: menu.key, item: id });
  }
  const off = new Set(controls.off[menu.key] ?? []);
  if (offer) off.delete(id);
  else off.add(id);
  const error = await saveControls(admin, { ...controls, off: { ...controls.off, [menu.key]: [...off] } });
  if (error) {
    console.error("setMenuOffered: save failed", error);
    back(product, { err: "save_failed" });
  }

  await logAdminAction(admin, userId, {
    action: "model.offer",
    targetType: "model",
    targetId: `${menu.key}:${id}`,
    before: offer ? "off" : "offered",
    after: offer ? "offered" : "off",
  });
  done(product, { kind: "offer", menu: menu.key, item: id, now: offer ? "1" : "0" });
}

/** The default video or picture model (what runs when a customer picks nothing). */
export async function setDefaultModel(formData: FormData) {
  const { admin, userId } = await requireAdmin();
  const product = productOf(formData);
  const kind = formData.get("kind") === "picture" ? "picture" : "video";
  const id = String(formData.get("model") ?? "");
  const known =
    kind === "video"
      ? VIDEO_MODELS.some((m) => m.id === id) && !isDormantVideoModel(id)
      : IMAGE_MODELS.some((m) => m.id === id) && ((SELECTABLE_IMAGE_MODEL_IDS as readonly string[]).includes(id) || id === "flux");
  if (!known) back(product, { err: "bad_model" });
  const controls = await readControls(admin);
  if (!isOffered(controls, kind, id)) back(product, { err: "default_off" });

  const key = kind === "video" ? "video_model" : "image_model";
  const { data: previous } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (previous?.value === id) back(product, {});
  const { error } = await admin.from("app_settings").upsert({ key, value: id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) {
    console.error("setDefaultModel: save failed", error);
    back(product, { err: "save_failed" });
  }

  await logAdminAction(admin, userId, {
    action: kind === "video" ? "model.video" : "model.image",
    targetType: "model",
    targetId: key,
    before: (previous?.value as string | undefined) ?? null,
    after: id,
  });
  revalidatePath("/admin/providers");
  done(product, {
    kind: "default",
    which: kind,
    now: id,
    was: (previous?.value as string | undefined) ?? (kind === "video" ? "kling" : "gpt-image"),
  });
}
