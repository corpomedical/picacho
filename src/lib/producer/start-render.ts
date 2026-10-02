import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runGeneration } from "@/lib/generations/actions";
import { getGenerateWorkspaceData } from "@/lib/generations/workspace-data";
import { DEFAULT_IMAGE_ASPECT, DEFAULT_IMAGE_QUALITY, defaultImageResolution } from "@/lib/generations/providers/image-resolution";
import { cardGenerationId, type StartableCard } from "./start-card";
import { cardPhotoRoles } from "@/lib/aly-chat/card-photos";

// Aly starts one of her own cards (operator, 2026-10-01: "I tell her I cant
// touch the phone you do it for me, she says she cant. I asked she takes
// control so the user works hands free" → "Say price, then go").
//
// The render goes through the very runGeneration the studio's Send, the chat
// card's "Make it" and Picacho Light use, with the same form a card's Make it
// builds (render-card.tsx): every credit, content-policy, brand-rule and
// identity check stays where it is. It runs on the SERVER, inside her turn,
// so a phone that locks or a page that changes can't stop it; a queued video
// is finished by the provider's webhook like any other.
//
// The take's id is derived from the person and the card, so a card can never
// be made twice: a second start (a repeated "do it", the card's own button
// pressed as well) arrives as the same send and runGeneration follows the
// first take instead of rendering again (repeat-send.ts).

// How long her answer waits to hear how the start went. A video is queued
// within seconds; a picture may take longer, and then she says it's on its
// way while the function carries on (after()).
const WAIT_MS = 9000;

export type StartOutcome =
  | { state: "started" | "done"; generationId: string }
  | { state: "failed"; generationId: string; error: string };

export async function startCardRender(supabase: SupabaseClient, userId: string, card: StartableCard): Promise<StartOutcome> {
  const generationId = cardGenerationId(userId, card.id);
  const workspace = await getGenerateWorkspaceData(supabase as never, userId);
  const model = workspace.videoModels.find((m) => m.id === workspace.defaultVideoModelId);

  // The card's chat photos ride in as the composer's attachments would (card-photos.ts).
  const photos = card.kind === "image" ? await cardPhotoRoles(userId, card.photos ?? []) : { roles: [] };
  if ("error" in photos) return { state: "failed", generationId, error: photos.error };

  const fd = new FormData();
  fd.set("generation_id", generationId);
  fd.set("prompt", card.prompt);
  fd.set("content_type", card.kind);
  fd.set("character_id", card.characterId ?? "");
  fd.set("use_outfit", "0");
  fd.set("payload_version", "2");
  if (card.kind === "image") {
    fd.set("image_model_id", workspace.defaultImageModelId);
    fd.set("image_resolution", defaultImageResolution(workspace.defaultImageModelId));
    fd.set("image_aspect", DEFAULT_IMAGE_ASPECT);
    fd.set("image_quality", DEFAULT_IMAGE_QUALITY);
    if (photos.roles.length) fd.set("attachment_roles", JSON.stringify(photos.roles));
  } else {
    fd.set("video_model_id", card.modelId ?? workspace.defaultVideoModelId);
    fd.set(
      "video_duration_seconds",
      String(card.seconds ?? workspace.defaultVideoDurationSeconds ?? model?.defaultDurationSeconds ?? 5),
    );
    if (workspace.defaultAspectRatio) fd.set("video_aspect_ratio", workspace.defaultAspectRatio);
  }

  const run = runGeneration(fd).then(
    (r) => (r.error === null ? ({ state: r.pending ? "started" : "done", generationId } as const) : ({ state: "failed", generationId, error: r.error } as const)),
    (err: unknown) => {
      console.error("producer: start_render failed —", err instanceof Error ? err.message : err);
      return { state: "failed", generationId, error: "It couldn't start just now." } as const;
    },
  );
  // The render outlives her answer: the platform keeps the function alive for it.
  after(() => run.then(() => undefined));
  const waited = await Promise.race([run, new Promise<null>((r) => setTimeout(() => r(null), WAIT_MS))]);
  return waited ?? { state: "started", generationId };
}
