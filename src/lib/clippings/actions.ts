"use server";
// Press Tour › Clippings, from the browser. Each action does three things,
// in this order: who (the signed-in person, through Press Tour's own door:
// switched on, allowed, a confirmed email), the real providers (runtime.ts),
// then the service, which decides everything (service.ts). An error nothing
// names is logged and answered as "unavailable"; the door words every code.
//
// The page that calls readClippings or addClip needs maxDuration 300 and the
// ffmpeg binary traced into it: /app/press-tour has both (next.config.ts).

import { getLocale } from "@/lib/i18n/server";
import { isNativeApp } from "@/lib/native/server";
import { pressTourCaller } from "@/lib/press-tour/card-service";
import { createClient } from "@/lib/supabase/server";
import { clipDeps } from "./runtime";
import * as service from "./service";
import type { ClipFail, ClippingsHome } from "./types";

async function who(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const res = await pressTourCaller(supabase, data.user);
  return res.error === null ? res.caller.userId : null;
}

async function behindDoor<T>(name: string, run: (userId: string) => Promise<T | ClipFail>): Promise<T | ClipFail> {
  try {
    const userId = await who();
    if (!userId) return { ok: false, error: "closed" };
    return await run(userId);
  } catch (err) {
    console.error(`[clippings] ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: "unavailable" };
  }
}

/** What the tab shows (the door polls this while a read runs). */
export async function getClippings(): Promise<{ ok: true; home: ClippingsHome } | ClipFail> {
  return behindDoor("read the tab", async (userId) => {
    const deps = clipDeps();
    const switches = await deps.switches();
    if (!switches.on) return { ok: false, error: "closed" };
    const home = await service.clippingsHome(deps, userId, { switches, webOnly: await isNativeApp() });
    return { ok: true, home };
  });
}

/** Read my posts again (or carry on with words still waiting: free). */
export async function readClippings(input: { carryOn?: boolean }): Promise<{ ok: true } | ClipFail> {
  return behindDoor("start a read", async (userId) => service.startRead(clipDeps(), userId, { locale: await getLocale(), carryOn: input?.carryOn === true }));
}

/** Where the browser uploads a video the person made. */
export async function clipUploadPlace(input: { clipId: string; type: string; size: number }): Promise<service.UploadPlace | ClipFail> {
  return behindDoor("place an upload", (userId) => service.reserveUpload(clipDeps(), userId, input ?? {}));
}

/** The upload arrived: its views and date, and the person's word that they made it. */
export async function addClip(input: { clipId: string; views: string | number | null; postedAt: string | null; attest: boolean }): Promise<{ ok: true } | ClipFail> {
  return behindDoor("add a video", async (userId) => service.finishUpload(clipDeps(), userId, { ...(input ?? {}), locale: await getLocale() } as Parameters<typeof service.finishUpload>[2]));
}

export async function removeClip(input: { clipId: string }): Promise<{ ok: true } | ClipFail> {
  return behindDoor("remove a video", (userId) => service.removeUpload(clipDeps(), userId, input ?? {}));
}
