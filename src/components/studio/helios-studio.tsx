"use client";

// Helios Studio (2026-09-26): the Blender-style workspace for one set, opened
// from the set page with ?studio=1. The engine is the approved draft's code
// (studio-engine.ts), loaded only here, on the client.
//
// Stage 3 (2026-09-29): the scene is kept on the account. The page hands in
// the saved copy (null when none, or the column isn't there yet), and the
// engine saves back through saveStudioScene about 5 s after a change,
// keeping its browser copy as the backup.
//
// "Photo with your character" (stage 3): Render ▸ sends the shot camera's
// frame through the set page's own Shoot (shootInSet, one press id per
// press, studio-press.ts), priced by the same quote the set page shows.
//
// Astra for any request (stage 4): the words, the scene summary and the
// last turns go to askStudioAstra with a fresh press id each; the plan
// comes back to the engine, which shows it and runs it only on Apply.
//
// Blender (Cycles) renders (2026-09-29): Render ▸ "Blender render (Cycles)"
// sends the scene file and the job through studio-cycles.ts to the doors in
// cycles-actions.ts, which render it on a cloud GPU. Shown only when the
// page says so (admins while HELIOS_CYCLES_FOR_ALL is false).
//
// Video with your character (2026-09-30): Render ▸ records the playback
// range through the shot camera and sends it through Recast's own upload,
// read and start (studio-recast.ts → studio-recast-actions.ts), with this
// press's sendId. Shown only when the page says this account can use Recast;
// the characters are Recast's own list.

import { useEffect, useRef, useState } from "react";
import { quoteSend } from "@/lib/generations/quote";
import { useLocale } from "@/lib/i18n/provider";
import { shootInSet } from "@/lib/sets/actions";
import { readSetPress } from "@/lib/sets/press-actions";
import type { SetSpec } from "@/lib/sets/set-spec";
import type { StudioScene } from "@/lib/sets/studio-scene";
import { saveStudioScene } from "@/lib/sets/studio-actions";
import { askStudioAstra } from "@/lib/sets/editor-actions";
import { STUDIO_ASTRA_RESENT } from "@/lib/sets/studio-astra";
import { studioTranslator } from "./studio-i18n";
import { stillQuoteInput } from "@/lib/sets/take";
import type { SetCharacter } from "@/lib/sets/types";
import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";
import { STUDIO_CSS, STUDIO_HTML } from "./studio-markup";
import { pressStudioStill, type StudioPressPhase, type StudioShootInput } from "./studio-press";
import { pressCycles, type CyclesUpdate } from "./studio-cycles";
import { readCyclesRender, renderCyclesInSet, reserveCyclesScene } from "@/lib/sets/cycles-actions";
import { CYCLES_BUCKET } from "@/lib/sets/cycles";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { localizeServerText } from "@/lib/i18n/server-text";
import { RECAST_BUCKET } from "@/lib/recast/recast";
import { recastStorageObjectUrl, uploadRecastClip } from "@/lib/recast/recast-client";
import { discardStudioRecast, inspectStudioRecast, listStudioLooks, openStudioRecast, readStudioRecast, reserveStudioRecast, startStudioRecast } from "@/lib/sets/studio-recast-actions";
import { pressStudioRecast, type RecastPress, type RecastUpdate } from "./studio-recast";
import { StudioOpening, STUDIO_HIDES_APP_CHROME } from "./studio-opening";

/**
 * The engine's code, asked for the moment this module runs in the browser (2026-09-30 — "Speed up the
 * loading"): its download overlaps React's hydration instead of starting after the component mounts. Asked
 * again on mount if this first request failed (a flaky network, a deploy in between).
 */
const engineEarly: Promise<typeof import("./studio-engine")> | null =
  typeof window === "undefined" ? null : import("./studio-engine").catch(() => import("./studio-engine"));

/**
 * The recording to Recast's storage, the way Recast's door sends a clip
 * (mystique-door.tsx sendClip): over XMLHttpRequest so it says how much has
 * gone, and the storage library's own upload when that can't be made.
 */
async function sendStudioClip(path: string, contentType: string, clip: Blob, onShare: (share: number | null) => void): Promise<"sent" | "failed" | "aborted"> {
  const file = new File([clip], path.split("/").pop() || "helios-studio.mp4", { type: contentType });
  const supabase = createBrowserClient();
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = projectUrl && anonKey ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
  if (projectUrl && anonKey && token) {
    const sent = await uploadRecastClip({ url: recastStorageObjectUrl(projectUrl, RECAST_BUCKET, path), anonKey, token, file, signal: new AbortController().signal, onProgress: onShare });
    if (sent.ok) return "sent";
  }
  onShare(null);
  const { error } = await supabase.storage.from(RECAST_BUCKET).upload(path, file, { contentType });
  return error ? "failed" : "sent";
}

export function HeliosStudio({
  setId,
  title,
  spec,
  savedScene,
  characters,
  cyclesOn = false,
  recastOn = false,
  castId = null,
}: {
  setId: string;
  title: string;
  spec: SetSpec;
  savedScene: StudioScene | null;
  characters: SetCharacter[];
  /** Blender renders on a cloud GPU: admins while HELIOS_CYCLES_FOR_ALL is false (the page decides). */
  cyclesOn?: boolean;
  /** Recast's characters when this account can use Recast (the page asks Recast's own rule); null hides "Video with your character". */
  /**
   * Whether to offer "Video with your character": the accounts Recast is for (admins today). Its own gate and
   * its characters are asked when the window opens (openStudioRecast), which is where a refusal is said.
   */
  recastOn?: boolean;
  /** Who plays the set's figure (the set page's "Plays the figure"): Video with your character's first choice. */
  castId?: string | null;
}) {
  const { t, locale } = useLocale();
  // "Opening the set…" until the engine has drawn its first frame (2026-09-30: the Studio showed an empty grey
  // workspace for 10–15 s while its code and the set loaded, which looked broken). "failed": it couldn't load.
  const [opening, setOpening] = useState<"opening" | "ready" | "failed">("opening");
  const castIdRef = useRef(castId);
  // Read once, when the engine starts: a later render must not restart it.
  // The set and its title too (2026-09-30): a server action that revalidates
  // any path (Recast's start does) sends this page again, with a new spec
  // object — which restarted the engine under an open window, froze its
  // "Rendering" line and dropped the finished video of the first live take.
  const specRef = useRef(spec);
  const titleRef = useRef(title);
  const savedRef = useRef(savedScene);
  const charactersRef = useRef(characters);
  const wordsRef = useRef({
    neverStarted: t.sets.pressNeverStarted,
    stillGoing: t.sets.pressStillGoing,
    unchecked: t.sets.pressUnchecked,
    inHistory: t.sets.pressInHistory,
    refresh: t.generate.refreshNeeded,
  });
  const unreachable = t.generate.submitFailed;
  // The latest of them, for the next time the engine starts (another set
  // opened in this same page): this runs before the engine's effect below.
  useEffect(() => {
    specRef.current = spec;
    titleRef.current = title;
  });
  const recastRef = useRef(recastOn);
  // Recast's own words for its lanes and its answers, in the person's language.
  const recastWordsRef = useRef({
    lanes: {
      "kling-edit": { title: t.mystique.modeScene, line: t.mystique.modeSceneLine },
      "h3-768": { title: t.mystique.modeRestage, line: t.mystique.modeRestageLine },
    },
    localize: (text: string) => localizeServerText(text, t),
  });
  useEffect(() => {
    let dispose: (() => void) | null = null;
    let dead = false;
    void (engineEarly ?? import("./studio-engine")).then((m) => {
      if (dead) return;
      dispose = m.startStudio({
        onReady: () => {
          if (!dead) setOpening("ready");
        },
        setId,
        title: titleRef.current,
        spec: specRef.current,
        // Stage 7: the Studio in the person's language (studio-i18n.ts).
        locale,
        t: studioTranslator(locale),
        backHref: `/app/sets/${setId}`,
        savedScene: savedRef.current,
        saveScene: async (scene: unknown) => {
          try {
            return await saveStudioScene(setId, scene);
          } catch {
            // A dropped connection or a new deploy: the browser copy holds it.
            return { error: "unreachable" };
          }
        },
        astra: {
          unreachable,
          ask: async (text: string, summary: unknown, turns: { who: "person" | "astra"; text: string }[]) => {
            try {
              const out = await askStudioAstra(setId, text, summary, turns, crypto.randomUUID(), locale);
              if (out.error !== null) return { error: "pending" in out && out.pending ? STUDIO_ASTRA_RESENT : out.error };
              return { error: null, plan: out.plan, answer: out.answer };
            } catch (err) {
              if (isStaleDeployError(err)) void reloadForNewDeploy({ delayMs: 1800 });
              return { error: unreachable };
            }
          },
        },
        cycles: cyclesOn
          ? {
              unreachable,
              run: (glb: Blob, job: unknown, onUpdate: (u: CyclesUpdate) => void) =>
                pressCycles(
                  {
                    reserve: reserveCyclesScene,
                    upload: (path: string, token: string, file: Blob) =>
                      createBrowserClient().storage.from(CYCLES_BUCKET).uploadToSignedUrl(path, token, file, { contentType: "model/gltf-binary" }),
                    render: renderCyclesInSet,
                    read: readCyclesRender,
                    alive: () => !dead,
                    unreachable,
                    refresh: wordsRef.current.refresh,
                    onStale: () => void reloadForNewDeploy({ delayMs: 1800 }),
                  },
                  setId,
                  { glb, job },
                  onUpdate,
                ),
            }
          : null,
        recast: recastRef.current
          ? {
              load: async () => {
                try {
                  return await openStudioRecast(setId);
                } catch (err) {
                  if (isStaleDeployError(err)) void reloadForNewDeploy({ delayMs: 1800 });
                  return { error: unreachable, timing: "" };
                }
              },
              castId: castIdRef.current ?? null,
              looks: async (characterId: string) => {
                try {
                  const out = await listStudioLooks(setId, { characterId });
                  return out.error === null ? out.looks : [];
                } catch {
                  return [];
                }
              },
              lanes: recastWordsRef.current.lanes,
              recastHref: "/app/mystique",
              historyHref: (generationId: string) => `/app/history/${generationId}`,
              unreachable,
              run: async (press: RecastPress, onUpdate: (u: RecastUpdate) => void, isStopped: () => boolean) => {
                const say = recastWordsRef.current.localize;
                const answer = await pressStudioRecast(
                  {
                    reserve: reserveStudioRecast,
                    upload: sendStudioClip,
                    inspect: inspectStudioRecast,
                    start: (id: string, input: Record<string, unknown>) => startStudioRecast(id, input as Parameters<typeof startStudioRecast>[1]),
                    read: readStudioRecast,
                    discard: discardStudioRecast,
                    alive: () => !dead,
                    stopped: isStopped,
                    unreachable,
                    refresh: wordsRef.current.refresh,
                    changed: "The recording came out different from the range you set, so nothing was sent and nothing was charged. Try again.",
                    failed: "It didn't come out. If it hadn't started rendering, its credits came back.",
                    neverStarted: wordsRef.current.neverStarted,
                    unchecked: wordsRef.current.unchecked,
                    stillGoing: wordsRef.current.stillGoing,
                    onStale: () => void reloadForNewDeploy({ delayMs: 1800 }),
                  },
                  setId,
                  press,
                  onUpdate,
                );
                return answer.error ? { ...answer, error: say(answer.error) } : answer;
              },
            }
          : null,
        render: {
          // THE price, from the function the server charges with (set-view.tsx's own).
          credits: quoteSend(stillQuoteInput()).totalCredits,
          characters: charactersRef.current.map((c) => ({ id: c.id, name: c.name, likenessNeeded: c.likenessNeeded === true })),
          castId: castIdRef.current ?? null,
          looks: async (characterId: string) => {
            try {
              const out = await listStudioLooks(setId, { characterId });
              return out.error === null ? out.looks : [];
            } catch {
              return [];
            }
          },
          setHref: `/app/sets/${setId}`,
          historyHref: (generationId: string) => `/app/history/${generationId}`,
          unreachable,
          shoot: (input: StudioShootInput, onPhase: (phase: StudioPressPhase) => void) =>
            pressStudioStill(
              {
                shoot: shootInSet,
                read: readSetPress,
                alive: () => !dead,
                words: wordsRef.current,
                onStale: () => void reloadForNewDeploy({ delayMs: 1800 }),
                onPhase,
              },
              setId,
              input,
            ),
        },
      });
    }).catch(() => {
      if (!dead) setOpening("failed");
    });
    return () => {
      dead = true;
      dispose?.();
    };
  }, [setId, unreachable, locale, cyclesOn]);
  return (
    <div className="fixed inset-0 z-[70]" data-helios-studio>
      <style>{STUDIO_CSS}</style>
      <style>{STUDIO_HIDES_APP_CHROME}</style>
      <div className="h-full" dangerouslySetInnerHTML={{ __html: STUDIO_HTML }} />
      {opening === "opening" ? (
        // The same cover the page streamed while the set was read (studio-opening.tsx), up until the first frame.
        <StudioOpening words={t.sets.studioOpening} title={title} />
      ) : opening === "failed" ? (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-[#1d1e21] text-[#e6e7ea]" role="status" aria-live="polite" data-studio-opening>
          <p className="text-[15px] font-medium">{t.sets.studioOpenFailed}</p>
          <button type="button" className="rounded-[10px] border border-[#3a3c42] px-3 py-1.5 text-[13px] hover:border-[#e0a468]" onClick={() => void reloadForNewDeploy({ delayMs: 0 })}>
            {t.sets.studioOpenRetry}
          </button>
        </div>
      ) : null}
    </div>
  );
}
