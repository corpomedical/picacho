"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { formatMsg } from "@/lib/i18n/format";
import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";
import { pollUntilSettled } from "@/lib/generations/poll-client";
import {
  discardRecastUpload,
  getRecastTakeMedia,
  inspectRecastClip,
  reserveRecastUpload,
  startRecastTakes,
  type RecastInspection,
} from "@/lib/recast/actions";
import { deleteChatAttachment, reserveChatAttachmentPath } from "@/lib/attachments/actions";
import { requestGenerationCancel } from "@/lib/generations/actions";
import type { RecastCharacter, RecastMotion, RecastTake } from "@/lib/recast/data";
import {
  RECAST_CLIP_TOO_BIG,
  RECAST_IMAGE_UNUSABLE,
  RECAST_NOT_A_VIDEO,
  RECAST_UPLOAD_UNREADABLE,
  recastClipProblemMessage,
} from "@/lib/recast/messages";
import {
  RECAST_BUCKET,
  RECAST_ENGINES,
  RECAST_IMAGE_BUCKET,
  RECAST_JOB_MAX_SECONDS,
  RECAST_JOB_ORDER,
  RECAST_MAX_BYTES,
  recastCastsTogether,
  recastCrowdSharesTake,
  recastImageRoom,
  recastContainerOf,
  recastEngineFor,
  recastEnginesOf,
  recastMissing,
  recastRestageImageRoom,
  recastRestageSeconds,
  recastTakesCast,
  type RecastEngine,
  type RecastJob,
} from "@/lib/recast/recast";
import { composeRecastBrief, recastCastTokens, recastImageTokens, recastRestageTokens } from "@/lib/recast/recast-brief";
import { defaultRecastWindow, isWholeClip, recastWindowCredits, type RecastWindow } from "@/lib/recast/trim";
import { chainPieceCount } from "@/lib/generations/chain";
import { probeLocal, recastStorageObjectUrl, sampleClip, uploadRecastClip } from "@/lib/recast/recast-client";
import {
  recastBlocker,
  recastFitWindow,
  recastJobPromise,
  recastLengthChoices,
  recastLengthFloor,
  recastLocalLengthProblem,
  recastMinutes,
  recastSlotOffer,
  recastSuggestJob,
  recastTierIsSofter,
  recastWait,
  type RecastAspect,
  type RecastBalance,
  type RecastBlocker,
} from "@/lib/recast/door-truth";
import type { RecastRead, RecastWarning } from "@/lib/recast/recast-read";
import { TakeViewer } from "@/components/mystique/take-viewer";

// The Mystique door (working title). Cut 2, 2026-09-18 — "Its still lacking.
// Nothing like the features of Genjitsu."
//
// What was missing was not engines, it was the SURFACE. Genjutsu's real
// product is a library you can use with no footage of your own, a machine
// that understands the clip, and a recipe you can see and change. So:
//
//   the performance   a file, OR one of your own finished videos — every
//                     take this account ever made is a performance someone
//                     else can now give. Theirs cannot do that.
//   the read          what is in the clip, as chips: who, how many cuts,
//                     what must survive, whether it will disappoint.
//   three jobs        into the clip · photo to life · restyle the world.
//   the cast          several at once — together in one video, each playing
//                     their own person in the clip, or one take each.
//   the brief         composed from all of it and SHOWN. Theirs is hidden.
//   the lock          the face judged end to end, and a miss not charged.
//
// NO MACHINERY ON THE WALL: t.mystique names no engine and no model. The
// jobs are said as what happens, the engines as Full and Lighter, and every
// price is read from the clip itself server-side — the number on the button
// is the number charged.

type Source =
  | { kind: "upload"; phase: "uploading" | "inspecting" | "ready"; url: string; path: string | null; name: string }
  | { kind: "take"; phase: "inspecting" | "ready"; url: string; takeId: string; name: string };

type Viewing = { take: RecastTake; media: { resultUrl: string; sourceUrl: string | null } | null };

/** The control a grey Take's reason sends the person to (recastBlocker). */
type BlockerTarget = "drop" | "rights" | "words" | "cast" | "crowd" | "group";

/**
 * An image the person added (2026-09-19). `path` is null while it uploads;
 * `local` marks one uploaded here, whose preview is a blob URL and whose file
 * nothing stands on yet — so removing it removes the file too.
 */
type DoorImage = { key: string; path: string | null; url: string; local: boolean };

/** The image types the door takes — what the server can read and redraw. */
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

// The labels laid over the clip and the photo. LITERAL colours on purpose:
// the app's Screening Room theme redefines Tailwind's `white` as a near-black
// (globals.css, html.screening.dark --color-white), which put these labels
// in dark grey on black — "The font color is unreadable" (2026-09-19). One
// text colour per label, too: two colour utilities on one element resolve by
// stylesheet order, not by the order they are written.
const chipBase = "inline-flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-[5px] text-xs font-medium backdrop-blur-sm";
const chip = `${chipBase} text-[rgba(255,255,255,0.94)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]`;
const chipTake = `${chipBase} text-[#f0cda6] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]`;
const label = "text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#6b6f7a]";
const soft = "rounded-2xl bg-[rgba(255,255,255,0.03)] p-3.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]";
const ghost =
  "cursor-pointer rounded-xl px-3.5 py-2 text-sm font-medium text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] transition-colors hover:bg-[rgba(255,255,255,0.05)] disabled:cursor-not-allowed disabled:opacity-40";
/** A person who asked their system for less motion gets no smooth scroll and no glow (2026-09-22). */
function reducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// A take that settled while this tab was hidden (2026-09-22): the in-page
// notice, the Sets page's way (sets-home.tsx announceIfHidden). Only when the
// tab is hidden, since a visible card already says it; only with permission
// already granted, since this never asks; and only as the person's own
// "tell me when it's done / went wrong" settings allow.
//
// ONE NOTICE PER TAKE. The runner pushes to every browser subscription the
// person has when a take finishes (job-runner.ts finish → notifyUser, with no
// tag) — so a browser that has a subscription has already been told, and this
// page says nothing. A browser without one hears it from here, tagged with the
// take's id so a second tab, or a second settle of the same take, replaces
// rather than repeats it. The service worker first, as the composer does,
// because Android Chrome forbids the page's own Notification constructor.
// Best-effort, and never throws.
function announceIfHidden(notice: { title: string; body: string; tag: string }) {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (document.visibilityState !== "hidden") return;
    const inPage = () => {
      const n = new Notification(notice.title, { body: notice.body, tag: notice.tag });
      n.onclick = () => window.focus();
    };
    const sw = navigator.serviceWorker;
    if (!sw?.getRegistration) {
      inPage();
      return;
    }
    void sw
      .getRegistration()
      .then(async (registration) => {
        if (!registration) return inPage();
        const subscribed = await registration.pushManager?.getSubscription().catch(() => null);
        if (subscribed) return;
        const shown =
          typeof registration.getNotifications === "function"
            ? await registration.getNotifications({ tag: notice.tag }).catch(() => [])
            : [];
        if (shown.length > 0) return;
        await registration.showNotification(notice.title, {
          body: notice.body,
          tag: notice.tag,
          data: { path: "/app/mystique" },
          icon: "/icon-192-maskable.png",
          badge: "/icon-192-maskable.png",
        });
      })
      .catch(() => {
        // No way left to notify: the card says it.
      });
  } catch {
    // The card already shows the result; a notice must never break the page.
  }
}

const pill = (on: boolean) =>
  `cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-medium transition-shadow disabled:cursor-not-allowed disabled:opacity-45 ${
    on
      ? "bg-[rgba(255,255,255,0.06)] text-[#ecedf1] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]"
      : "text-[#c6c9d1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.24)]"
  }`;

export function MystiqueDoor({
  characters,
  motions,
  initialTakes,
  lockOn,
  notify,
  balance,
}: {
  characters: RecastCharacter[];
  motions: RecastMotion[];
  initialTakes: RecastTake[];
  lockOn: boolean;
  /** Their own notification settings (Settings → Notifications), which the in-page notice follows. */
  notify: { ready: boolean; failed: boolean };
  /** What they have left to spend (data.ts), shown beside the price; null when it could not be read. */
  balance: RecastBalance | null;
}) {
  const { t, locale } = useLocale();
  const m = t.mystique;
  const router = useRouter();

  const castable = useMemo(() => characters.filter((c) => c.photos.length > 0), [characters]);
  const [takes, setTakes] = useState(initialTakes);
  const [seenInitial, setSeenInitial] = useState(initialTakes);
  const [source, setSource] = useState<Source | null>(null);
  const [seen, setSeen] = useState<RecastInspection | null>(null);
  const [job, setJob] = useState<RecastJob>("scene");
  // Which stretch of the clip is performed (trim.ts). Every job takes every
  // clip through a window, so nobody is moved to a job they did not choose —
  // which is how the operator's first real take went wrong.
  const [clipWindow, setClipWindow] = useState<RecastWindow | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const [tier, setTier] = useState<"full" | "lite">("full");
  const [castIds, setCastIds] = useState<string[]>(castable[0] ? [castable[0].id] : []);
  const [photoPath, setPhotoPath] = useState<string | null>(castable[0]?.photos[0]?.path ?? null);
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [direction, setDirection] = useState("");
  const [showBrief, setShowBrief] = useState(false);
  const [rights, setRights] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  // Takes a Stop was asked for. The card says "Stopping…" until the SERVER
  // settles it — it used to be marked failed the moment the request
  // returned, before the runner had decided whether it stopped, finished
  // first, or gave the credits back (2026-09-22).
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  // WHERE EACH RENDERING TAKE IS (2026-09-22): the runner's own line
  // ("Rendering part 2 of 3", "Joining the parts"), as each poll hears it.
  // Until the first answer the card uses what the page was served with.
  const [progress, setProgress] = useState<Record<string, string>>({});
  // The clock the "14 min in" lines are read against. Null until the page is
  // in the browser, so the server's render and the first client render agree.
  const [now, setNow] = useState<number | null>(null);
  // The take that just settled, lit for a moment where it landed.
  const [lit, setLit] = useState<string | null>(null);
  const [images, setImages] = useState<DoorImage[]>([]);
  // Several characters in ONE video (Into the clip), or one take each —
  // and, together, which person in the clip each plays (character id →
  // the read's tag, or null for "as your words say"). Unset ids follow the
  // read's order, the lead first.
  const [together, setTogether] = useState(true);
  const [roles, setRoles] = useState<Record<string, string | null>>({});
  // ONE character: which person in the clip they play (2026-09-22). Unset
  // follows the read's lead, as the door always did; { tag: null } is "as
  // your words say". Before this, one character always replaced the lead,
  // and the only way to say otherwise was to argue with the brief in words.
  const [soloPick, setSoloPick] = useState<{ tag: string | null } | null>(null);
  // The clip preview autoplays muted; this is the person's way to stop it —
  // and under reduced motion it starts stopped (review, 2026-09-22).
  const [previewPaused, setPreviewPaused] = useState(false);
  // Why a clip could not be used — said inside the drop area it was dropped on.
  const [clipError, setClipError] = useState("");
  // How much of the clip has reached storage, 0 to 1 — null until the upload
  // says (2026-09-22). The upload in flight, so Cancel can stop it.
  const [uploaded, setUploaded] = useState<number | null>(null);
  const uploadRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const doorRef = useRef<HTMLDivElement | null>(null);
  // Where the grey button's reason sends the person (focusBlocker).
  const dropRef = useRef<HTMLDivElement | null>(null);
  const rightsRef = useRef<HTMLInputElement | null>(null);
  const wordsRef = useRef<HTMLTextAreaElement | null>(null);
  const castRef = useRef<HTMLDivElement | null>(null);
  const groupTrimRef = useRef<HTMLButtonElement | null>(null);
  const crowdAloneRef = useRef<HTMLButtonElement | null>(null);
  // Every blob URL a preview was given, so none outlives the door.
  const imageBlobsRef = useRef<Set<string>>(new Set());
  // The newest pick wins: an upload or a read that lands late is dropped.
  const pickRef = useRef(0);
  const urlRef = useRef<string | null>(null);

  if (initialTakes !== seenInitial) {
    setSeenInitial(initialTakes);
    setTakes(initialTakes);
  }

  // How many of this person's takes are still rendering — said beside the
  // button, so a second press is a choice rather than a guess.
  const rendering = takes.filter((x) => x.status === "generating").length;
  const renderingKey = takes
    .filter((x) => x.status === "generating")
    .map((x) => x.id)
    .join(",");
  useEffect(() => {
    if (!renderingKey) return;
    const ctrl = new AbortController();
    for (const id of renderingKey.split(",")) {
      void pollUntilSettled(id, {
        signal: ctrl.signal,
        // The progress line the runner answers every poll with (poll-client.ts).
        // It was always there; the door never asked for it, so a 35-minute take
        // was a pulsing grid and "3–20 min" the whole way (2026-09-22).
        onPending: (line) => {
          if (ctrl.signal.aborted) return;
          setProgress((prev) => (prev[id] === line ? prev : { ...prev, [id]: line }));
        },
      }).then(() => {
        if (!ctrl.signal.aborted) router.refresh();
      });
    }
    const slow = setInterval(() => router.refresh(), 30_000);
    // The minute clock for "14 min in · about 20 min left".
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const clock = setInterval(tick, 20_000);
    return () => {
      ctrl.abort();
      clearInterval(slow);
      clearTimeout(first);
      clearInterval(clock);
    };
  }, [renderingKey, router]);

  // A TAKE THAT SETTLES while the page is open (2026-09-22): it used to
  // swap its card silently at the bottom of a long page. Now the page goes
  // to it and lights it, and a hidden tab gets one notice. Seen by comparing
  // each take's status with the one before — whether this tab's poll or the
  // 30-second refresh saw it first — so it fires once per take, and never
  // for a take that was already settled when the page opened. A take the
  // person stopped themselves is neither lit nor announced: they were there.
  const statusesRef = useRef<Map<string, RecastTake["status"]> | null>(null);
  const announcedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const before = statusesRef.current;
    statusesRef.current = new Map(takes.map((x) => [x.id, x.status]));
    if (!before) return;
    const settled = takes.filter((x) => before.get(x.id) === "generating" && x.status !== "generating" && x.status !== "stopped");
    if (settled.length === 0) return;
    for (const x of settled) {
      if (announcedRef.current.has(x.id)) continue;
      announcedRef.current.add(x.id);
      const ready = x.status === "succeeded";
      if (ready ? !notify.ready : !notify.failed) continue;
      announceIfHidden({
        title: ready ? t.push.videoReadyTitle : t.push.videoFailedTitle,
        body: ready ? t.push.videoReadyBody : t.push.videoFailedBody,
        tag: `recast-take-${x.id}`,
      });
    }
    const id = settled[0].id;
    const show = setTimeout(() => {
      if (reducedMotion()) return;
      document.getElementById(`take-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setLit(id);
    }, 60);
    return () => clearTimeout(show);
  }, [takes, notify.ready, notify.failed, t.push]);

  // The lit take goes back to normal after a few seconds.
  useEffect(() => {
    if (!lit) return;
    const off = setTimeout(() => setLit(null), 4_000);
    return () => clearTimeout(off);
  }, [lit]);

  useEffect(() => {
    const blobs = imageBlobsRef.current;
    const upload = uploadRef;
    return () => {
      upload.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      for (const url of blobs) URL.revokeObjectURL(url);
    };
  }, []);

  const read: RecastRead | null = seen?.read ?? null;
  const ready = source?.phase === "ready" && seen !== null;
  // Characters and images go into every job but Restyle — and neither is
  // required: words alone can make an Into the clip take (recast.ts
  // recastMissing, 2026-09-19 "Do not lock it just on characters").
  const takesCast = recastTakesCast(job);
  const engine: RecastEngine = recastEngineFor(job, tier);
  const cast = takesCast
    ? castIds.map((id) => castable.find((c) => c.id === id)).filter((c): c is RecastCharacter => Boolean(c))
    : [];
  // TOGETHER (2026-09-19, "Selecting two characters still makes two videos
  // separately"; Restage too since 2026-09-21): everyone cast shares one
  // video by default; "One take each" keeps the variants. Photo to life
  // builds the frame from one picture, so there it is always one take each.
  const ensemble = recastCastsTogether(job) && together && cast.length > 1;
  // The photos ONE Restage take carries, the server's rule (actions.ts
  // photosPerTake): the identity photo and up to three more per character;
  // apart, every take is priced at the character who brings the most.
  const photosOf = (c: RecastCharacter) => Math.min(4, Math.max(1, c.photos.length));
  const photosPerTake = ensemble ? cast.map(photosOf) : cast.length > 0 ? [Math.max(...cast.map(photosOf))] : [];
  const peopleInClip = read ? [...read.people].sort((a, b) => Number(b.lead) - Number(a.lead)) : [];
  const castTags = cast.map((c, i) => (c.id in roles ? roles[c.id] : (peopleInClip[i]?.tag ?? null)));
  // A ROLE THAT IS A WHOLE GROUP (the read’s own judgement) can only be
  // changed in ONE part: every part after the first is handed the footage
  // again and follows it, which is how two takes of the same crowd came
  // back as the footage (2026-09-20). The server refuses it; the door says
  // so before the press, and offers the trim.
  const groupTags = new Set(peopleInClip.filter((p) => p.many).map((p) => p.tag));
  // Who a take that is not "together" replaces: the one character's chosen
  // person, or the read's lead — which is also what one take each sends. The
  // server takes it as castTag (A–D) and writes it into the brief.
  const leadTag = read?.people.find((p) => p.lead)?.tag ?? null;
  const soloTag: string | null = cast.length === 1 && soloPick && (soloPick.tag === null || read?.people.some((p) => p.tag === soloPick.tag)) ? soloPick.tag : leadTag;
  const takeTags = ensemble ? castTags : [soloTag];
  const castOverGroup = takeTags.some((tag) => tag !== null && groupTags.has(tag));
  const parts = clipWindow ? chainPieceCount(clipWindow.end - clipWindow.start) : 1;
  const groupNeedsOnePart = castOverGroup && parts > 1;
  // ONE REPLACEMENT PER TAKE (2026-09-23, paid for on the courtyard clip): a
  // group changed beside somebody else came back with the character twice
  // over, and the group itself back as it was before the end. The server
  // refuses it (recast.ts recastCrowdSharesTake); the door says what would
  // happen and offers both ways out, either of which is the person's own
  // press — nothing here changes the cast on its own.
  const crowdSharesTake = recastCrowdSharesTake(takeTags, groupTags);
  /** The first character cast over a whole group — who the two ways out are named after. */
  const crowdCast = ensemble
    ? (cast.find((_, i) => {
        const tag = takeTags[i];
        return tag !== null && groupTags.has(tag);
      }) ?? null)
    : null;
  // What is actually sent — the server's rule (actions.ts): Photo to life
  // brings ONE picture to life, the character's when someone is cast; Into
  // the clip holds four references, characters included; Restage nine
  // pictures, every cast photo included.
  const imageCap =
    job === "motion"
      ? 1
      : job === "restage"
        ? recastRestageImageRoom(photosPerTake)
        : recastImageRoom(ensemble ? cast.length : Math.min(1, cast.length));
  const usedImages = !takesCast ? [] : job === "motion" ? (cast.length > 0 ? [] : images.slice(0, 1)) : images.slice(0, imageCap);
  // Priced from the file's own numbers scaled to the window — the same call
  // the server charges with (trim.ts), so the button's number is the charge.
  // Restage bills its reference pictures beside its seconds (recast.ts), so
  // the button’s number counts them: every cast photo that rides, and every
  // added image that rides.
  const referenceCount = (e: RecastEngine) =>
    RECAST_ENGINES[e].restages ? photosPerTake.reduce((n, count) => n + count, 0) + usedImages.length : 0;
  const quoteOf = (e: RecastEngine) =>
    seen && clipWindow
      ? { engine: e, credits: recastWindowCredits(e, { seconds: seen.seconds, frames: seen.frames }, clipWindow, referenceCount(e)) }
      : null;
  const quote = quoteOf(engine);
  // About how long this take will wait — the one estimate the whole page
  // uses (door-truth.ts recastMinutes), in place of a flat "3–20 min" that a
  // 30 s take overran by a quarter of an hour.
  const takeMinutes = seen && clipWindow ? recastMinutes(engine, clipWindow.end - clipWindow.start) : null;
  const hasWords = direction.trim().length > 0;
  const rolesUnsaid = ensemble && castTags.some((tag) => tag === null) && !hasWords;
  const takeCount = ensemble ? 1 : takesCast ? Math.max(1, cast.length) : 1;
  // The face lock scores ONE character's face; it promises nothing to a take
  // with several of them, or with nobody.
  const lockApplies = cast.length > 0 && !ensemble;
  const totalCredits = quote ? quote.credits * takeCount : null;
  const keeps = job === "scene" ? (read?.keeps ?? []).filter((k) => !dropped.has(k.what)) : [];
  const photo = cast[0]?.photos.find((p) => p.path === photoPath) ?? cast[0]?.photos[0] ?? null;
  const busy = starting || (source !== null && source.phase !== "ready");
  // WHY TAKE IS GREY (2026-09-22). The button went grey on any of nine
  // conditions and explained one of them. The first thing missing is now
  // named under it, and tapping the line goes to what fixes it; Take is
  // enabled exactly when there is nothing to name (door-truth.ts).
  const blocker: RecastBlocker | null = recastBlocker({
    starting,
    clip: !source ? "none" : ready && quote !== null && clipWindow !== null ? "ready" : "busy",
    rights,
    job,
    missing: recastMissing(job, { characters: cast.length, images: usedImages.length, words: hasWords }),
    rolesUnsaid,
    hasWords,
    imageUploading: images.findIndex((i) => i.path === null) + 1,
    crowdSharesTake,
    groupNeedsOnePart,
    credits: totalCredits,
    balance,
  });
  const canTake = blocker === null;

  // The same function the server composes with, so what is shown is what is
  // sent. Not memoised: it is string work over a handful of short fields,
  // and every input is rebuilt each render anyway.
  // FOR THE STRETCH THAT IS SENT, NOT THE CLIP (2026-09-22): composed from
  // the whole read and the window — its own length, only the cuts inside it
  // — and fitted inside the engine's own prompt, exactly as actions.ts
  // briefFor does. It used to be composed for the whole clip. A long take is
  // shown its first part's words for the whole window: where its parts meet
  // is measured on the server, at the footage's stillest moments.
  const briefWindow = seen ? (clipWindow ?? { start: 0, end: seen.seconds }) : null;
  const briefInParts =
    RECAST_ENGINES[engine].chains === true && briefWindow !== null && chainPieceCount(briefWindow.end - briefWindow.start) > 1;
  // The same names the server gives the engine (actions.ts castingsFor, recast-brief.ts recastBriefNames).
  const briefCast = ensemble ? cast : cast.slice(0, 1);
  const restageNames = job === "restage" ? recastRestageTokens(briefCast.map(photosOf)) : null;
  const castTokens = restageNames
    ? restageNames.tokens
    : engine === "kling-edit"
      ? recastCastTokens(briefCast.map((c) => c.photos.length))
      : [];
  const castings = briefCast.map((c, i) => {
    // Alone, the person the character plays is the door's own "plays" choice
    // (soloTag: the pick, the read's lead unpicked, null for "as your words
    // say") — exactly what take() sends as castTag. Composing on the lead
    // here showed a brief that was not the one sent whenever the choice was
    // used (review, 2026-09-22).
    const tag = ensemble ? castTags[i] : soloTag;
    const many = tag ? read?.people.find((p) => p.tag === tag)?.many === true : false;
    return {
      tag,
      ...(many ? { many: true } : {}),
      characterName: c.name,
      ...(castTokens[i] ? { token: castTokens[i] } : {}),
    };
  });
  // Only the images the take can carry: a long take keeps one of its four
  // places for the still at each switch (actions.ts, recastImageRoom).
  const briefImages = job === "scene" ? Math.min(usedImages.length, recastImageRoom(briefCast.length, briefInParts)) : usedImages.length;
  const brief = briefWindow
    ? composeRecastBrief({
        job,
        engine,
        read,
        window: briefWindow,
        casting: castings.length === 0 ? null : castings.length === 1 ? castings[0] : castings,
        keeps,
        direction,
        images: restageNames
          ? usedImages.map((_, i) => `Image ${restageNames.used + 1 + i}`)
          : job === "scene" && engine === "kling-edit"
            ? recastImageTokens(castTokens, briefImages)
            : [],
        // A take of one piece lets the direction change what the keep list
        // keeps; a long take's parts never do (recast-brief.ts, YOUR WORDS WIN).
        longTake: briefInParts,
      })
    : "";

  function setClip(next: Source | null) {
    if (urlRef.current && urlRef.current !== next?.url) URL.revokeObjectURL(urlRef.current);
    setPreviewPaused(false);
    urlRef.current = next?.kind === "upload" ? next.url : null;
    setSource(next);
    if (next === null) {
      setSeen(null);
      setClipWindow(null);
    }
  }

  /**
   * The read runs on frames sampled here. For a file they are sampled WHILE
   * it uploads (pickFile starts both at once, 2026-09-22) — they used to be
   * sampled only after the last byte had gone, so the wait was the upload,
   * then the sampling, then the read.
   */
  async function inspect(mine: number, args: { path?: string; takeId?: string }, sampling: ReturnType<typeof sampleClip>) {
    const sampled = await sampling;
    if (mine !== pickRef.current) return null;
    const res = await inspectRecastClip({
      ...args,
      frames: sampled.ok ? sampled.clip.frames.join("\n") : "",
    });
    if (mine !== pickRef.current) return null;
    return res;
  }

  async function pickFile(file: File | undefined) {
    if (!file || starting) return;
    setError("");
    setClipError("");
    setRights(false);
    setDropped(new Set());
    setRoles({});
    setSoloPick(null);
    const mine = ++pickRef.current;
    uploadRef.current?.abort();
    if (source?.kind === "upload" && source.path) void discardRecastUpload(source.path).catch(() => {});
    if (!recastContainerOf(file.type)) {
      setClip(null);
      setClipError(RECAST_NOT_A_VIDEO);
      return;
    }
    if (file.size > RECAST_MAX_BYTES) {
      setClip(null);
      setClipError(RECAST_CLIP_TOO_BIG);
      return;
    }
    const url = URL.createObjectURL(file);
    setUploaded(null);
    setClip({ kind: "upload", phase: "uploading", url, path: null, name: file.name });
    // A clip that cannot be used says why where it was dropped (2026-09-22) —
    // not under the Take button at the foot of the form, below a drop area
    // that had just gone blank.
    const fail = (message: string) => {
      if (mine !== pickRef.current) return;
      setClip(null);
      setClipError(message);
    };
    // ITS LENGTH FIRST, from the file in hand (recast-client.ts probeLocal):
    // a clip the server will plainly refuse is refused before a byte is
    // uploaded, in the server's own words. When the browser cannot say — an
    // HEVC .mov it cannot decode — nothing is refused here: the upload and the
    // server's probe decide, as they always did.
    const probe = await probeLocal(file);
    if (mine !== pickRef.current) return;
    if (probe.ok) {
      const plainly = recastLocalLengthProblem(probe.seconds);
      if (plainly) return fail(recastClipProblemMessage(plainly));
    }
    // The frames for the read are sampled while the file uploads, not after.
    const sampling = sampleClip(file).catch(() => ({ ok: false as const, error: RECAST_UPLOAD_UNREADABLE }));
    try {
      const reserved = await reserveRecastUpload({ size: file.size, type: file.type });
      if (mine !== pickRef.current) return;
      if (reserved.error !== null) return fail(reserved.error);
      const sent = await sendClip(reserved.path, reserved.contentType, file, (share) => {
        if (mine === pickRef.current) setUploaded(share);
      });
      if (mine !== pickRef.current) {
        void discardRecastUpload(reserved.path).catch(() => {});
        return;
      }
      if (sent === "aborted") {
        void discardRecastUpload(reserved.path).catch(() => {});
        return;
      }
      if (sent === "failed") return fail(RECAST_UPLOAD_UNREADABLE);
      setClip({ kind: "upload", phase: "inspecting", url, path: reserved.path, name: file.name });
      const res = await inspect(mine, { path: reserved.path }, sampling);
      if (res === null) return;
      if (res.error !== null) return fail(res.error);
      setSeen(res);
      setClip({ kind: "upload", phase: "ready", url, path: reserved.path, name: file.name });
      setClipWindow(recastFitWindow(defaultRecastWindow(res.seconds, job), res.seconds, job));
    } catch (err) {
      const stale = isStaleDeployError(err);
      fail(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
      if (stale) reloadForNewDeploy({ delayMs: 1800 });
    }
  }

  /**
   * The clip to storage, saying how much has gone (recast-client.ts
   * uploadRecastClip — the library's own request, over XMLHttpRequest so it
   * reports progress and can be stopped). When that one cannot be made —
   * no session token to hand, or it failed for any reason but a Cancel —
   * the library's own upload runs instead, without a percentage: the worst
   * case is the door as it was.
   */
  async function sendClip(
    path: string,
    contentType: string,
    file: File,
    /** How much has gone, 0 to 1; null when the upload in hand cannot say. */
    onProgress: (share: number | null) => void,
  ): Promise<"sent" | "aborted" | "failed"> {
    const ctrl = new AbortController();
    uploadRef.current = ctrl;
    try {
      const supabase = createClient();
      const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const token = projectUrl && anonKey ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
      if (ctrl.signal.aborted) return "aborted";
      if (projectUrl && anonKey && token) {
        const sent = await uploadRecastClip({
          url: recastStorageObjectUrl(projectUrl, RECAST_BUCKET, path),
          anonKey,
          token,
          file,
          signal: ctrl.signal,
          onProgress,
        });
        if (sent.ok) return "sent";
        if (sent.aborted || ctrl.signal.aborted) return "aborted";
      }
      // The fallback cannot say how far it has got, so no stale percentage is left showing.
      onProgress(null);
      const { error } = await supabase.storage.from(RECAST_BUCKET).upload(path, file, { contentType });
      if (ctrl.signal.aborted) return "aborted";
      return error ? "failed" : "sent";
    } finally {
      if (uploadRef.current === ctrl) uploadRef.current = null;
    }
  }

  /**
   * Cancel (2026-09-22): the clip in hand is let go — its upload stopped
   * where it is, its read ignored when it lands, and the file removed from
   * storage (discardRecastUpload never removes one a take stands on).
   */
  function cancelClip() {
    pickRef.current++;
    uploadRef.current?.abort();
    uploadRef.current = null;
    if (source?.kind === "upload" && source.path) void discardRecastUpload(source.path).catch(() => {});
    setClip(null);
    setClipError("");
    setUploaded(null);
  }

  async function pickMotion(motion: RecastMotion) {
    if (starting) return;
    setError("");
    setClipError("");
    setRights(false);
    setDropped(new Set());
    setRoles({});
    setSoloPick(null);
    const mine = ++pickRef.current;
    uploadRef.current?.abort();
    if (source?.kind === "upload" && source.path) void discardRecastUpload(source.path).catch(() => {});
    setClip({ kind: "take", phase: "inspecting", url: motion.videoUrl, takeId: motion.takeId, name: motion.title });
    try {
      const res = await inspect(mine, { takeId: motion.takeId }, sampleClip(motion.videoUrl));
      if (res === null) return;
      if (res.error !== null) {
        setClip(null);
        setClipError(res.error);
        return;
      }
      setSeen(res);
      setClip({ kind: "take", phase: "ready", url: motion.videoUrl, takeId: motion.takeId, name: motion.title });
      setClipWindow(recastFitWindow(defaultRecastWindow(res.seconds, job), res.seconds, job));
    } catch {
      if (mine !== pickRef.current) return;
      setClip(null);
      setClipError(t.generate.submitFailed);
    }
  }

  /** A clip too long for the job in hand moves to one that takes it. */
  /**
   * A job is only ever chosen by the person. Until 2026-09-18 a clip longer
   * than the job in hand moved the door to whichever job took it — which is
   * how a 28 s crowd scene landed in Photo to life and came back as a room of
   * cloned children. Now the job stays, and the window shrinks to fit it.
   */
  function chooseJob(next: RecastJob) {
    setJob(next);
    if (seen && clipWindow) setClipWindow(recastFitWindow(clipWindow, seen.seconds, next));
  }

  /**
   * An image of the person's own: uploaded the composer's way — a path in
   * their own folder, then straight from the browser to storage — and
   * shown at once from the file itself. The server reads it again before it
   * is used, and judges it before anything is spent.
   */
  async function addImage(file: File | undefined) {
    if (!file || starting || images.length >= imageCap) return;
    setError("");
    if (!IMAGE_TYPES.includes(file.type)) {
      setError(RECAST_IMAGE_UNUSABLE);
      return;
    }
    const key = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    imageBlobsRef.current.add(url);
    setImages((prev) => [...prev, { key, path: null, url, local: true }]);
    const drop = (message: string) => {
      setImages((prev) => prev.filter((i) => i.key !== key));
      URL.revokeObjectURL(url);
      imageBlobsRef.current.delete(url);
      setError(message);
    };
    try {
      const reserve = new FormData();
      reserve.set("name", file.name);
      reserve.set("size", String(file.size));
      const reserved = await reserveChatAttachmentPath(reserve);
      if (reserved.error !== null || !reserved.path) {
        return drop(
          reserved.errorCode === "SESSION_EXPIRED"
            ? t.generate.uploadErrSession
            : reserved.errorCode === "TOO_LARGE"
              ? formatMsg(t.generate.uploadErrTooLarge, { name: file.name })
              : reserved.errorCode === "RATE_LIMITED"
                ? t.generate.uploadErrRate
                : t.generate.uploadPhotoFailed,
        );
      }
      const { error: uploadError } = await createClient()
        .storage.from(RECAST_IMAGE_BUCKET)
        .upload(reserved.path, file, { contentType: file.type, upsert: false });
      if (uploadError) return drop(t.generate.uploadPhotoFailed);
      const path = reserved.path;
      setImages((prev) => prev.map((i) => (i.key === key ? { ...i, path } : i)));
    } catch (err) {
      const stale = isStaleDeployError(err);
      drop(stale ? t.generate.refreshNeeded : t.generate.uploadPhotoFailed);
      if (stale) reloadForNewDeploy({ delayMs: 1800 });
    }
  }

  /** Off the take — and out of storage when it was uploaded here and nothing stands on it yet. */
  function removeImage(key: string) {
    const image = images.find((i) => i.key === key);
    if (!image) return;
    setImages((prev) => prev.filter((i) => i.key !== key));
    if (image.local) {
      URL.revokeObjectURL(image.url);
      imageBlobsRef.current.delete(image.url);
      if (image.path) {
        const gone = new FormData();
        gone.set("path", image.path);
        void deleteChatAttachment(gone).catch(() => {});
      }
    }
  }

  /**
   * Together: who plays whom. A person in the clip is played once — whoever
   * had them gives them up to "as your words say".
   */
  function setRole(id: string, tag: string | null) {
    setRoles((prev) => {
      const next: Record<string, string | null> = { ...prev };
      cast.forEach((c, i) => {
        if (!(c.id in next)) next[c.id] = castTags[i];
      });
      if (tag) for (const other of Object.keys(next)) if (next[other] === tag) next[other] = null;
      next[id] = tag;
      return next;
    });
  }

  /** Clears the row without touching storage — a take now stands on these files. */
  function forgetImages() {
    for (const i of images) {
      if (!i.local) continue;
      URL.revokeObjectURL(i.url);
      imageBlobsRef.current.delete(i.url);
    }
    setImages([]);
  }

  /** The preview plays the chosen stretch and nothing else. */
  function holdPreviewInWindow() {
    const v = previewRef.current;
    if (!v || !clipWindow) return;
    if (v.currentTime < clipWindow.start - 0.05 || v.currentTime >= clipWindow.end) v.currentTime = clipWindow.start;
  }

  async function take() {
    if (!canTake || !seen || !source) return;
    setError("");
    setStarting(true);
    // This press's own id, fresh per press (lib/recast/repeat.ts): a browser
    // that resends the request after a dropped connection delivers it twice,
    // and the second delivery then follows the takes the first started
    // instead of starting and charging its own.
    const sendId = crypto.randomUUID();
    let res: Awaited<ReturnType<typeof startRecastTakes>>;
    try {
      res = await startRecastTakes({
        sendId,
        ...(source.kind === "upload" ? { path: source.path ?? undefined } : { takeId: source.takeId }),
        characterIds: cast.map((c) => c.id),
        photoPath: photo?.path,
        imagePaths: usedImages.map((i) => i.path).filter((p): p is string => p !== null),
        ...(ensemble ? { together: true, castTags } : {}),
        engine,
        keeps: keeps.map((k) => k.what),
        direction,
        castTag: soloTag ?? undefined,
        read,
        window: clipWindow ?? undefined,
        rights,
      });
    } catch (err) {
      const stale = isStaleDeployError(err);
      setError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
      if (stale) reloadForNewDeploy({ delayMs: 1800 });
      return;
    } finally {
      setStarting(false);
    }
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    const pressedAt = new Date().toISOString();
    setTakes((prev) => [
      ...res.ids.map((id, i) => ({
        id,
        status: "generating" as const,
        characterName: ensemble ? cast.map((c) => c.name).join(" & ") : (cast[i]?.name ?? null),
        engine,
        // The length the take is made at — the window, as the server records
        // it — so its card's wait is counted for the stretch actually sent.
        seconds: Math.max(1, Math.round(clipWindow ? clipWindow.end - clipWindow.start : seen.seconds)),
        credits: quote?.credits ?? null,
        score: null,
        posterUrl: null,
        createdAt: pressedAt,
        recipe: null,
        images: [],
        progress: null,
        outcome: null,
        report: null,
      })),
      ...prev,
    ]);
    pickRef.current++;
    setClip(null);
    setRights(false);
    setDirection("");
    forgetImages();
    router.refresh();
    // The setup empties and the new card is at the foot of the page: go to it.
    const first = res.ids[0];
    if (first && !reducedMotion()) {
      setTimeout(() => document.getElementById(`take-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    }
  }

  /**
   * Stop a take that is still rendering. What it costs is said before it
   * happens, in today's rule (m.stopAsk, job-runner.ts's cancel path): the
   * credits come back only when the render had not started and no earlier
   * part was billed. The card then says "Stopping…" until the server has
   * settled the take — it may still finish first and be delivered — and
   * the row, not this page, says how it ended.
   */
  async function stop(id: string) {
    if (stopping.has(id)) return;
    if (!window.confirm(m.stopAsk)) return;
    setError("");
    setStopping((prev) => new Set(prev).add(id));
    const release = () =>
      setStopping((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    try {
      const res = await requestGenerationCancel(id);
      if (res.error) {
        release();
        setError(res.error);
      }
      router.refresh();
    } catch (err) {
      release();
      const stale = isStaleDeployError(err);
      setError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
      if (stale) reloadForNewDeploy({ delayMs: 1800 });
    }
  }

  async function watch(x: RecastTake) {
    setError("");
    setViewing({ take: x, media: null });
    try {
      const res = await getRecastTakeMedia(x.id);
      if (res.error !== null || !res.resultUrl) {
        setViewing(null);
        setError(res.error ?? t.generate.submitFailed);
        return;
      }
      setViewing((v) => (v?.take.id === x.id ? { take: x, media: { resultUrl: res.resultUrl!, sourceUrl: res.sourceUrl } } : v));
    } catch {
      setViewing(null);
      setError(t.generate.submitFailed);
    }
  }

  /** Recreate: a finished take's settings, back on the door. */
  function reuse(x: RecastTake) {
    if (!x.recipe) return;
    setJob(x.recipe.job);
    setTier(RECAST_ENGINES[x.recipe.engine].tier);
    setDirection(x.recipe.direction);
    // Its images come back as they were sent; they are the take's files, so
    // taking one off the door never deletes it.
    forgetImages();
    setImages(x.images.map((i) => ({ key: i.path, path: i.path, url: i.url, local: false })));
    setViewing(null);
    // From a card at the foot of the page, the setup it fills is at the top.
    doorRef.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    if (x.recipe.source.kind === "take") {
      const motion = motions.find((mo) => mo.takeId === (x.recipe!.source as { takeId: string }).takeId);
      if (motion) void pickMotion(motion);
    }
  }

  // A warning is only said where it is true. A crowd is a problem for the
  // job that keeps the clip's people (one of them is replaced) — for Photo to
  // life it is a far bigger one, said in its own box below; for Restyle it is
  // no problem at all, everyone is redrawn.
  // A face to hold, and one person replaced among many, are warnings about
  // CASTING — a take of words alone replaces nobody.
  const castsSomeone = cast.length > 0 || (job === "motion" && usedImages.length > 0);
  const shownWarnings = (seen?.warnings ?? []).filter(
    (w) =>
      w === "cuts" ||
      (w === "no-head" && job !== "world" && castsSomeone) ||
      ((w === "crowd" || w === "wide") && job === "scene" && cast.length > 0),
  );
  // Photo to life builds the whole picture from the character's photo. A
  // clip that shows a room or other people has all of that INVENTED — the
  // operator's first real take: a selfie asked to become a classroom.
  const motionWillInvent = job === "motion" && read !== null && (read.people.length > 1 || read.framing === "full" || read.framing === "wide");

  const warningText: Record<RecastWarning, string> = {
    cuts: m.warnCuts,
    "no-head": m.warnNoHead,
    crowd: m.warnCrowd,
    wide: m.warnWide,
  };
  const jobName = (j: RecastJob) => (j === "scene" ? m.modeScene : j === "restage" ? m.modeRestage : j === "motion" ? m.modeMotion : m.jobWorld);
  const jobLine = (j: RecastJob) => (j === "scene" ? m.modeSceneLine : j === "restage" ? m.modeRestageLine : j === "motion" ? m.modeMotionLine : m.jobWorldLine);
  const jobLimit = (j: RecastJob) => (j === "scene" ? m.sceneLimit : j === "restage" ? m.restageLimit : j === "motion" ? m.motionLimit : m.worldLimit);
  // What holds best is the job's own answer, not one line for all four — the
  // single "one person, one continuous shot" steered every visitor to one
  // kind of clip that Restyle and Restage do not need (2026-09-22).
  const jobHolds = (j: RecastJob) => (j === "scene" ? m.holdsScene : j === "restage" ? m.holdsRestage : j === "motion" ? m.holdsMotion : m.holdsWorld);
  const aspectWords: Record<RecastAspect, string> = {
    moves: m.aspectMoves,
    sound: m.aspectSound,
    camera: m.aspectCamera,
    place: m.aspectPlace,
    picturePlace: m.aspectPicturePlace,
    cast: m.aspectCast,
    everyone: m.aspectEveryone,
  };

  // The grey button's reason, in words (door-truth.ts recastBlocker). The
  // press itself says "Checking the clip…", so starting names nothing.
  const blockerText = (b: RecastBlocker): string | null => {
    switch (b.kind) {
      case "starting":
        return null;
      case "clip":
        return m.blockClip;
      case "reading":
        return source?.phase === "uploading" ? m.blockUploading : m.blockReading;
      case "rights":
        return m.blockRights;
      case "words":
        return b.why === "look" ? m.blockLook : b.why === "roles" ? m.blockRoles : m.blockWords;
      case "picture":
        return m.blockPicture;
      case "image":
        return formatMsg(m.blockImage, { n: b.n });
      case "crowd":
        return m.blockCrowd;
      case "group":
        return m.blockGroup;
      case "credits":
        return formatMsg(m.blockCredits, { need: b.need, left: b.left });
    }
  };
  /** Where tapping the reason goes: the control that answers it, when there is one. */
  const blockerTarget = (b: RecastBlocker): BlockerTarget | null =>
    b.kind === "clip"
      ? "drop"
      : b.kind === "rights"
        ? "rights"
        : b.kind === "words"
          ? "words"
          : b.kind === "picture"
            ? "cast"
            : b.kind === "crowd"
              ? "crowd"
              : b.kind === "group"
                ? "group"
                : null;
  function goTo(target: BlockerTarget) {
    const el: HTMLElement | null =
      target === "drop"
        ? dropRef.current
        : target === "rights"
          ? rightsRef.current
          : target === "words"
            ? wordsRef.current
            : target === "cast"
              ? (castRef.current?.querySelector<HTMLElement>("button:not([disabled]), a[href]") ?? null)
              : target === "crowd"
                ? crowdAloneRef.current
                : groupTrimRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" });
    el.focus({ preventScroll: true });
  }
  const blockerLine = blocker ? blockerText(blocker) : null;
  const blockerGo = blocker ? blockerTarget(blocker) : null;
  // Restyle's slots (door-truth.ts recastSlotOffer): past 5 s and short of the
  // whole 10, both ends are offered at their prices instead of the big slot
  // being charged in silence.
  const slotOffer = seen && clipWindow ? recastSlotOffer(engine, { seconds: seen.seconds, frames: seen.frames }, clipWindow) : null;
  // Which job suits this clip (door-truth.ts recastSuggestJob): a quiet mark
  // on its card, never a switch — the job is only ever the person's choice.
  const suggested = seen ? recastSuggestJob(read, seen.seconds) : null;
  // Past 15 s, Into the clip's two lengths side by side with their prices
  // and waits (recastLengthChoices). The page still opens on the whole clip.
  const lengthChoices =
    seen && clipWindow ? recastLengthChoices(engine, { seconds: seen.seconds, frames: seen.frames }, clipWindow, referenceCount(engine)) : null;
  const isWindow = (w: RecastWindow) => clipWindow !== null && Math.abs(clipWindow.start - w.start) < 0.05 && Math.abs(clipWindow.end - w.end) < 0.05;
  // Restage never renders under its own shortest take; on a clip shorter than
  // that, it says what comes back.
  const restageComesBack =
    job === "restage" && clipWindow && recastRestageSeconds(clipWindow.end - clipWindow.start) > clipWindow.end - clipWindow.start + 0.05
      ? recastRestageSeconds(clipWindow.end - clipWindow.start)
      : null;

  const buttonLabel = starting
    ? m.starting
    : totalCredits === null
      ? m.takeButton
      : takeCount > 1
        ? `${formatMsg(m.variantsNote, { n: takeCount })} · ${formatMsg(m.credits, { n: totalCredits })}`
        : totalCredits === 1
          ? m.takeButtonOne
          : formatMsg(m.takeButtonPriced, { n: totalCredits });

  return (
    <div ref={doorRef} className="mx-auto max-w-6xl scroll-mt-4">
      <div className="rounded-[28px] bg-[#0b0c10] px-6 pb-6 pt-7 text-[#c6c9d1] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_32px_72px_-28px_rgba(0,0,0,0.7)] sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-[#ecedf1]">{m.headline}</h1>
            <p className="mt-2 max-w-xl text-sm text-[#9aa0ad]">{m.sub}</p>
          </div>
          <div className="space-y-0.5 text-xs text-[#6b6f7a] lg:text-right">
            <p>{m.priceLine}</p>
            <p>{takeMinutes !== null ? formatMsg(m.metaAbout, { minutes: takeMinutes }) : m.meta}</p>
          </div>
        </div>

        {viewing ? (
          <div className="mt-5">
            {viewing.media ? (
              <TakeViewer
                job={viewing.take.engine ? RECAST_ENGINES[viewing.take.engine].job : "motion"}
                resultUrl={viewing.media.resultUrl}
                sourceUrl={viewing.media.sourceUrl}
                title={viewing.take.characterName ?? m.theTake}
                historyHref={`/app/history/${viewing.take.id}`}
                canReuse={viewing.take.recipe !== null}
                onReuse={() => reuse(viewing.take)}
                onClose={() => setViewing(null)}
              />
            ) : (
              <div className="flex min-h-[340px] items-center justify-center rounded-2xl bg-[#101116] text-sm text-[#6b6f7a] ring-1 ring-[rgba(255,255,255,0.1)]">
                {m.loadingTake}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* The screen: the performance left, who gives it right. */}
            <div className="relative mt-5 overflow-hidden rounded-2xl ring-1 ring-[rgba(255,255,255,0.1)]">
              <div className="grid md:grid-cols-2">
                <div
                  ref={dropRef}
                  role="button"
                  tabIndex={0}
                  aria-label={m.dropTitle}
                  onClick={() => fileRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    void pickFile(e.dataTransfer.files?.[0]);
                  }}
                  className={`relative min-h-[300px] cursor-pointer bg-[#101116] outline-none transition-shadow md:min-h-[360px] ${
                    dragOver ? "shadow-[inset_0_0_0_2px_#e0a468]" : "focus-visible:shadow-[inset_0_0_0_2px_rgba(240,205,166,0.6)]"
                  }`}
                >
                  {source ? (
                    <>
                      <video
                        ref={previewRef}
                        src={source.url}
                        muted
                        loop
                        autoPlay
                        playsInline
                        onTimeUpdate={holdPreviewInWindow}
                        // A new clip starts still for someone who asked for
                        // less motion; everyone else keeps the muted autoplay.
                        onLoadedMetadata={(e) => {
                          holdPreviewInWindow();
                          if (reducedMotion() && !e.currentTarget.paused) {
                            e.currentTarget.pause();
                            setPreviewPaused(true);
                          }
                        }}
                        className="absolute inset-0 h-full w-full object-contain"
                      />
                      <span className={`absolute left-3.5 top-3 ${chip} tabular-nums`}>
                        {source.kind === "take" ? m.fromTake : m.yourClip}
                        {seen ? ` · ${formatMsg(m.clipMeta, { seconds: seen.seconds, width: seen.width, height: seen.height })}` : ""}
                      </span>
                      {/* A real way to stop the moving preview (review,
                          2026-09-22) — it autoplayed with no control, even
                          for someone who asked for less motion. */}
                      <button
                        type="button"
                        aria-pressed={previewPaused}
                        onClick={(e) => {
                          e.stopPropagation();
                          const v = previewRef.current;
                          if (!v) return;
                          if (v.paused) {
                            void v.play().catch(() => {});
                            setPreviewPaused(false);
                          } else {
                            v.pause();
                            setPreviewPaused(true);
                          }
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        className={`absolute right-3.5 top-3 ${chip} cursor-pointer hover:bg-black/90`}
                      >
                        {previewPaused ? m.previewPlay : m.previewPause}
                      </button>
                      {/* How far the upload has got, and a way to stop it
                          (2026-09-22) — it was a pulse and "Uploading…" for
                          as long as the connection took. */}
                      {source.phase !== "ready" && (
                        <>
                          <span
                            className={`absolute bottom-3 left-3.5 ${chip} tabular-nums ${
                              source.phase === "uploading" && uploaded !== null ? "" : "motion-safe:animate-pulse"
                            }`}
                          >
                            {source.phase !== "uploading"
                              ? m.reading
                              : uploaded === null
                                ? m.uploading
                                : formatMsg(m.uploadingShare, { n: Math.floor(uploaded * 100) })}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelClip();
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                            className={`absolute bottom-3 right-3.5 ${chip} cursor-pointer hover:bg-black/90`}
                          >
                            {m.cancelClip}
                          </button>
                          {source.phase === "uploading" && uploaded !== null && (
                            <div
                              role="progressbar"
                              aria-label={m.uploading}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.floor(uploaded * 100)}
                              className="absolute inset-x-0 bottom-0 h-[3px] bg-[rgba(255,255,255,0.08)]"
                            >
                              <div className="h-full bg-[#f0cda6] transition-[width] duration-300" style={{ width: `${uploaded * 100}%` }} />
                            </div>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 p-6 text-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7 text-[#6b6f7a]" aria-hidden>
                        <rect x="3" y="5" width="18" height="14" rx="3" />
                        <path d="M10 9.5 15 12l-5 2.5z" fill="currentColor" stroke="none" />
                      </svg>
                      <p className="text-sm font-semibold text-[#ecedf1]">{m.dropTitle}</p>
                      <p className="text-xs text-[#6b6f7a]">{m.dropOr}</p>
                      <span className="rounded-xl px-3.5 py-1.5 text-sm font-medium text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]">{m.pick}</span>
                      {clipError ? (
                        <p role="alert" className="mt-2 max-w-xs text-sm text-[#dc8290]">
                          {localizeServerText(clipError, t)}
                        </p>
                      ) : (
                        <p className="mt-2 max-w-xs text-xs text-[#6b6f7a]">{jobHolds(job)}</p>
                      )}
                    </div>
                  )}
                </div>
                <div className="relative min-h-[240px] bg-[#0e0f14] md:min-h-[360px]">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.url} alt={cast[0]?.name ?? ""} className="absolute inset-0 h-full w-full object-contain" />
                  ) : usedImages[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={usedImages[0].url} alt={formatMsg(m.imageName, { n: 1 })} className="absolute inset-0 h-full w-full object-contain" />
                  ) : job === "scene" ? (
                    <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
                      <p className="max-w-xs text-sm text-[#9aa0ad]">{m.justWords}</p>
                    </div>
                  ) : job === "motion" ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                      <p className="max-w-xs text-sm text-[#9aa0ad]">{m.noPicture}</p>
                      <button type="button" onClick={() => imageFileRef.current?.click()} disabled={starting} className={ghost}>
                        {m.addImage}
                      </button>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
                      <p className="max-w-xs text-sm text-[#9aa0ad]">{m.jobWorldLine}</p>
                    </div>
                  )}
                  <span className={`absolute right-3.5 top-3 ${chipTake}`}>
                    {ensemble
                      ? `${m.theTake} · ${cast.map((c) => c.name).join(" & ")}`
                      : cast.length > 1
                        ? formatMsg(m.variantsNote, { n: cast.length })
                        : cast[0]
                          ? `${m.theTake} · ${cast[0].name}`
                          : m.theTake}
                  </span>
                </div>
              </div>
              <div
                aria-hidden
                className={`absolute inset-y-0 left-1/2 hidden w-[2px] bg-gradient-to-b from-transparent via-[#f0cda6] to-transparent shadow-[0_0_18px_2px_rgba(240,196,142,0.55)] md:block ${
                  busy ? "motion-safe:animate-pulse" : ""
                }`}
              />
            </div>

            {/* The stretch to perform (trim.ts). Every job takes every clip
                through this, so a long clip keeps the job that suits it. */}
            {ready && seen && clipWindow && (
              <div className={`mt-3 ${soft}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className={label}>{m.trimLabel}</p>
                  <p className="text-xs tabular-nums text-[#9aa0ad]">
                    {formatMsg(m.trimMeta, {
                      from: clock(clipWindow.start),
                      to: clock(clipWindow.end),
                      length: (clipWindow.end - clipWindow.start).toFixed(1),
                      total: seen.seconds.toFixed(1),
                    })}
                  </p>
                </div>
                <div aria-hidden className="relative mt-2.5 h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
                  <div
                    className="absolute inset-y-0 rounded-full bg-[#f0cda6]/75"
                    style={{
                      left: `${(clipWindow.start / seen.seconds) * 100}%`,
                      width: `${((clipWindow.end - clipWindow.start) / seen.seconds) * 100}%`,
                    }}
                  />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs text-[#9aa0ad]">{m.trimStart}</span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, seen.seconds - (clipWindow.end - clipWindow.start))}
                      step={0.1}
                      value={clipWindow.start}
                      disabled={starting || isWholeClip(clipWindow, seen.seconds)}
                      onChange={(e) => {
                        const start = Number(e.target.value);
                        const next = recastFitWindow({ start, end: start + (clipWindow.end - clipWindow.start) }, seen.seconds, job);
                        setClipWindow(next);
                        if (previewRef.current) previewRef.current.currentTime = next.start;
                      }}
                      className="mt-1 w-full accent-[#f0cda6] disabled:opacity-40"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-[#9aa0ad]">{m.trimLength}</span>
                    {/* The shortest length is the job's own (door-truth.ts
                        recastLengthFloor): Restage renders at least 5 s, so its
                        slider no longer offers a 3 s that is billed and made as 5. */}
                    <input
                      type="range"
                      min={recastLengthFloor(job, seen.seconds)}
                      max={Math.min(RECAST_JOB_MAX_SECONDS[job], seen.seconds)}
                      step={0.1}
                      value={clipWindow.end - clipWindow.start}
                      disabled={starting}
                      onChange={(e) => setClipWindow(recastFitWindow({ start: clipWindow.start, end: clipWindow.start + Number(e.target.value) }, seen.seconds, job))}
                      className="mt-1 w-full accent-[#f0cda6] disabled:opacity-40"
                    />
                  </label>
                </div>
                {seen.seconds > RECAST_JOB_MAX_SECONDS[job] + 0.05 && (
                  <p className="mt-2 text-xs text-[#9aa0ad]">{formatMsg(m.trimWhy, { n: RECAST_JOB_MAX_SECONDS[job] })}</p>
                )}
                {restageComesBack !== null && <p className="mt-2 text-xs text-[#9aa0ad]">{formatMsg(m.restageShort, { n: restageComesBack })}</p>}
                {/* One piece, or all of it — each with what it costs the press
                    and about how long it waits (2026-09-22). */}
                {lengthChoices && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-pressed={isWindow(lengthChoices.one.window)}
                      disabled={starting}
                      onClick={() => setClipWindow(lengthChoices.one.window)}
                      className={`${pill(isWindow(lengthChoices.one.window))} tabular-nums`}
                    >
                      {formatMsg(m.lengthOne, {
                        seconds: lengthChoices.one.seconds,
                        n: lengthChoices.one.credits * takeCount,
                        minutes: lengthChoices.one.minutes,
                      })}
                    </button>
                    <button
                      type="button"
                      aria-pressed={isWindow(lengthChoices.all.window)}
                      disabled={starting}
                      onClick={() => setClipWindow(lengthChoices.all.window)}
                      className={`${pill(isWindow(lengthChoices.all.window))} tabular-nums`}
                    >
                      {formatMsg(m.lengthAll, {
                        seconds: lengthChoices.all.seconds,
                        n: lengthChoices.all.credits * takeCount,
                        minutes: lengthChoices.all.minutes,
                        parts: lengthChoices.all.parts,
                      })}
                    </button>
                  </div>
                )}
                {slotOffer && (
                  <div className="mt-2.5">
                    <p className="text-xs text-[#d8b483]">
                      {formatMsg(m.slotNote, { length: (clipWindow.end - clipWindow.start).toFixed(1), n: slotOffer.credits })}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" disabled={starting} onClick={() => setClipWindow(slotOffer.cut.window)} className={pill(false)}>
                        {formatMsg(m.slotCut, { n: slotOffer.cut.credits })}
                      </button>
                      {slotOffer.full && (
                        <button type="button" disabled={starting} onClick={() => setClipWindow(slotOffer.full!.window)} className={pill(false)}>
                          {formatMsg(m.slotFull, { seconds: slotOffer.full.seconds, n: slotOffer.full.credits })}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {/* A long take (chain.ts): said before it is paid for, with how long it waits. */}
                {RECAST_ENGINES[engine].chains && chainPieceCount(clipWindow.end - clipWindow.start) > 1 && (
                  <p className="mt-2 text-xs text-[#f0cda6]">
                    {formatMsg(m.longTake, {
                      parts: chainPieceCount(clipWindow.end - clipWindow.start),
                      minutes: recastMinutes(engine, clipWindow.end - clipWindow.start),
                    })}
                  </p>
                )}
              </div>
            )}

            {/* The motion library: every finished video of theirs, ready to be performed again. */}
            <div className="mt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className={label}>{m.libraryLabel}</p>
                <p className="text-xs text-[#6b6f7a]">{m.libraryHint}</p>
              </div>
              {motions.length === 0 ? (
                <p className="mt-2 text-sm text-[#6b6f7a]">{m.libraryEmpty}</p>
              ) : (
                <div className="mt-2 flex gap-2.5 overflow-x-auto pb-1.5">
                  {motions.map((mo) => {
                    const on = source?.kind === "take" && source.takeId === mo.takeId;
                    return (
                      <button
                        key={mo.takeId}
                        type="button"
                        disabled={busy}
                        aria-pressed={on}
                        onClick={() => void pickMotion(mo)}
                        title={mo.title}
                        className={`group relative h-[74px] w-[124px] shrink-0 cursor-pointer overflow-hidden rounded-xl bg-[#101116] transition-shadow disabled:cursor-not-allowed disabled:opacity-40 ${
                          on ? "shadow-[0_0_0_2px_rgba(240,196,142,0.85)]" : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]"
                        }`}
                      >
                        {mo.posterUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={mo.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                        ) : (
                          <span aria-hidden className="absolute inset-0 bg-[#14151a]" />
                        )}
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-4 text-left">
                          <span className="block truncate text-[11px] font-medium text-[rgba(255,255,255,0.92)]">{mo.title}</span>
                          <span className="block text-[10px] tabular-nums text-[rgba(255,255,255,0.6)]">{mo.seconds} s</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* What the clip holds — the read, as chips. */}
            {source && (
              <div className={`mt-4 ${soft}`}>
                <p className={label}>{m.readLabel}</p>
                {!seen ? (
                  <p className="mt-2 text-sm text-[#9aa0ad] motion-safe:animate-pulse">{m.reading}</p>
                ) : !read ? (
                  <p className="mt-2 text-sm text-[#6b6f7a]">{m.readNoRead}</p>
                ) : (
                  <>
                    <p className="mt-1.5 text-sm text-[#ecedf1]">{read.motion}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className={chip}>{read.people.length === 1 ? m.readOnePerson : formatMsg(m.readPeople, { n: read.people.length })}</span>
                      <span className={chip}>
                        {read.cuts.length === 0 ? m.readOneShot : formatMsg(m.readCuts, { at: read.cuts.map((c) => `${c}s`).join(", ") })}
                      </span>
                      {read.sound === "speech" && <span className={chip}>{m.readSpeech}</span>}
                    </div>
                    {/* Only the job that keeps the clip's own picture can keep
                        anything IN it: the other two build the frame from the
                        photo or redraw it from words, so a watch or a caption
                        in the source has nothing to survive into. */}
                    {read.keeps.length > 0 && job === "scene" && (
                      <>
                        <p className={`mt-3 ${label}`}>{m.keepsLabel}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {read.keeps.map((k) => {
                            const on = !dropped.has(k.what);
                            return (
                              <button
                                key={k.what}
                                type="button"
                                aria-pressed={on}
                                disabled={starting}
                                onClick={() =>
                                  setDropped((prev) => {
                                    const next = new Set(prev);
                                    if (on) next.add(k.what);
                                    else next.delete(k.what);
                                    return next;
                                  })
                                }
                                className={`${pill(on)} ${on ? "" : "line-through opacity-60"}`}
                              >
                                {on ? "✓ " : ""}
                                {k.what}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {shownWarnings.length > 0 && (
                      <ul className="mt-3 space-y-1">
                        {shownWarnings.map((w) => (
                          <li key={w} className="text-xs text-[#d8b483]">
                            {warningText[w]}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="mt-4 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
              <div className="min-w-0">
                <p className={label}>{m.modeLabel}</p>
                <div className="mt-2 grid gap-2">
                  {RECAST_JOB_ORDER.map((j) => {
                    const on = job === j;
                    // What this job keeps and changes, from its engines' own
                    // flags (door-truth.ts recastJobPromise) — so Restage and
                    // Restyle say plainly that no sound comes back.
                    const promise = recastJobPromise(j);
                    return (
                      <button
                        key={j}
                        type="button"
                        aria-pressed={on}
                        disabled={starting}
                        onClick={() => chooseJob(j)}
                        className={`cursor-pointer rounded-2xl p-3.5 text-left transition-shadow disabled:cursor-not-allowed disabled:opacity-45 ${
                          on
                            ? "bg-[rgba(255,255,255,0.06)] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]"
                            : "bg-[rgba(255,255,255,0.03)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-semibold text-[#ecedf1]">{jobName(j)}</span>
                            {suggested === j && (
                              <span className="rounded-full px-2 py-px text-[10.5px] font-medium text-[#f0cda6] shadow-[inset_0_0_0_1px_rgba(240,196,142,0.45)]">
                                {m.suitsClip}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-[#6b6f7a]">{jobLimit(j)}</span>
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-[#9aa0ad]">{jobLine(j)}</span>
                        <span className="mt-2 block space-y-0.5 text-[11px] leading-snug">
                          {promise.keeps.length > 0 && (
                            <span className="block text-[#9aa0ad]">
                              <span className="font-semibold text-[#c6c9d1]">{m.promiseKeeps}</span> {promise.keeps.map((a) => aspectWords[a]).join(" · ")}
                            </span>
                          )}
                          <span className="block text-[#9aa0ad]">
                            <span className="font-semibold text-[#f0cda6]">{m.promiseChanges}</span> {promise.changes.map((a) => aspectWords[a]).join(" · ")}
                          </span>
                          {promise.silent && <span className="block font-medium text-[#d8b483]">{m.promiseSilent}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {motionWillInvent && (
                  <div className="mt-3 rounded-2xl bg-[#d8b483]/[0.08] p-3.5 shadow-[inset_0_0_0_1px_rgba(216,180,131,0.4)]">
                    <p className="text-sm leading-relaxed text-[#ecedf1]">{m.motionWarn}</p>
                    <button type="button" onClick={() => chooseJob("scene")} disabled={starting} className={`mt-2.5 ${ghost}`}>
                      {m.motionWarnSwitch}
                    </button>
                  </div>
                )}
                {/* Quality: only where there is a choice (a single "Full" pill
                    chose nothing), and each choice says what it trades — a
                    softer picture only where its resolution is lower (2026-09-22). */}
                {recastEnginesOf(job).length > 1 && (
                  <>
                    <p className={`mt-4 ${label}`}>{m.qualityLabel}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {recastEnginesOf(job).map((e) => {
                        const spec = RECAST_ENGINES[e];
                        const q = quoteOf(e);
                        return (
                          <button
                            key={e}
                            type="button"
                            aria-pressed={e === engine}
                            disabled={starting}
                            onClick={() => setTier(spec.tier)}
                            className={pill(e === engine)}
                          >
                            {spec.tier === "full" ? m.tierFull : m.tierLite}
                            {recastTierIsSofter(e) && <span className="ml-1.5 text-[#9aa0ad]">· {m.tierSofter}</span>}
                            {q && <span className="ml-1.5 tabular-nums text-[#9aa0ad]">· {formatMsg(m.credits, { n: q.credits })}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              <div className="min-w-0">
                {takesCast && (
                  <div ref={castRef}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <p className={label}>{m.castLabel}</p>
                      <p className="text-xs text-[#6b6f7a]">{recastCastsTogether(job) && together ? m.castTogether : m.castMore}</p>
                    </div>
                    <p className="mt-1 text-xs text-[#9aa0ad]">{job === "motion" ? m.castHintMotion : m.castHint}</p>
                    {castable.length === 0 ? (
                      <p className="mt-2 text-sm text-[#9aa0ad]">
                        {m.noCharacters}{" "}
                        <Link href="/app/character/new" className="font-medium text-[#f0cda6] underline-offset-2 hover:underline">
                          {m.createCharacter}
                        </Link>
                      </p>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {castable.map((c) => {
                          const on = castIds.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              aria-pressed={on}
                              disabled={starting}
                              onClick={() =>
                                setCastIds((prev) => {
                                  const next = prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id];
                                  if (next[0] !== prev[0]) setPhotoPath(castable.find((x) => x.id === next[0])?.photos[0]?.path ?? null);
                                  return next;
                                })
                              }
                              className={`flex cursor-pointer items-center gap-2 rounded-full py-1 pl-1 pr-3.5 text-sm font-medium transition-shadow ${
                                on
                                  ? "bg-[rgba(255,255,255,0.06)] text-[#ecedf1] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]"
                                  : "text-[#c6c9d1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.24)]"
                              }`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={c.photos[0].url} alt="" className="h-7 w-7 rounded-full object-cover" />
                              {c.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {/* Together in one video, or one take each (Into the clip, Restage). */}
                    {recastCastsTogether(job) && cast.length > 1 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" aria-pressed={together} disabled={starting} onClick={() => setTogether(true)} className={pill(together)}>
                          {m.togetherOn}
                        </button>
                        <button type="button" aria-pressed={!together} disabled={starting} onClick={() => setTogether(false)} className={pill(!together)}>
                          {m.togetherOff}
                        </button>
                      </div>
                    )}
                    {/* Together: who each one plays, from the people the read found. */}
                    {ensemble && (
                      <div className="mt-3 space-y-2">
                        {cast.map((c, i) => (
                          <label key={c.id} className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={c.photos[0].url} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                            <span className="max-w-[9rem] shrink truncate font-medium text-[#ecedf1]">{c.name}</span>
                            <span className="shrink-0 text-xs text-[#6b6f7a]">{m.rolePlays}</span>
                            {/* A pill like every other control on this door, and
                                one that cannot stretch the column: a native
                                select is as wide as its longest option unless
                                it is allowed to shrink (2026-09-20 — it pushed
                                the left column down to 138 px). */}
                            <select
                              value={castTags[i] ?? ""}
                              disabled={starting}
                              onChange={(e) => setRole(c.id, e.target.value || null)}
                              className="w-full min-w-0 max-w-[20rem] flex-1 cursor-pointer truncate rounded-full bg-[rgba(255,255,255,0.06)] py-1.5 pl-3.5 pr-2 text-sm text-[#ecedf1] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)] outline-none [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              {peopleInClip.map((p) => (
                                <option key={p.tag} value={p.tag}>
                                  {formatMsg(p.many ? m.roleGroup : m.rolePerson, { tag: p.tag, where: p.where.slice(0, 28) })}
                                </option>
                              ))}
                              <option value="">{m.roleWords}</option>
                            </select>
                          </label>
                        ))}
                        {!seen ? (
                          <p className="text-xs text-[#9aa0ad]">{m.rolesPickClip}</p>
                        ) : !read ? (
                          <p className="text-xs text-[#9aa0ad]">{m.rolesNoRead}</p>
                        ) : null}
                      </div>
                    )}
                    {/* ONE character, several people in the clip: who they play,
                        starting on the read's lead (2026-09-22). With no read
                        there is nobody to choose from, and nothing is shown.
                        Only where the take puts them among the clip's own
                        people (Into the clip, Restage): Photo to life builds
                        the frame from the photo and its brief names nobody in
                        the clip, so a choice there would choose nothing. */}
                    {recastCastsTogether(job) && !ensemble && cast.length === 1 && read !== null && read.people.length > 1 && (
                      <label className="mt-3 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={cast[0].photos[0].url} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                        <span className="max-w-[9rem] shrink truncate font-medium text-[#ecedf1]">{cast[0].name}</span>
                        <span className="shrink-0 text-xs text-[#6b6f7a]">{m.rolePlays}</span>
                        <select
                          value={soloTag ?? ""}
                          disabled={starting}
                          onChange={(e) => setSoloPick({ tag: e.target.value || null })}
                          className="w-full min-w-0 max-w-[20rem] flex-1 cursor-pointer truncate rounded-full bg-[rgba(255,255,255,0.06)] py-1.5 pl-3.5 pr-2 text-sm text-[#ecedf1] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)] outline-none [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {peopleInClip.map((p) => (
                            <option key={p.tag} value={p.tag}>
                              {formatMsg(p.many ? m.roleGroup : m.rolePerson, { tag: p.tag, where: p.where.slice(0, 28) })}
                            </option>
                          ))}
                          <option value="">{m.roleWords}</option>
                        </select>
                      </label>
                    )}
                    {/* A whole group cast beside somebody else: the one thing a
                        take will not carry, whatever its length. Both ways out
                        are presses of the person's own — the cast is never
                        rearranged for them, and one press is never turned into
                        two. */}
                    {crowdSharesTake && crowdCast && (
                      <div className="mt-3 rounded-2xl bg-[#d8b483]/[0.08] p-3.5 shadow-[inset_0_0_0_1px_rgba(216,180,131,0.4)]">
                        <p className="text-sm leading-relaxed text-[#ecedf1]">{m.crowdAlone}</p>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <button
                            ref={crowdAloneRef}
                            type="button"
                            disabled={starting}
                            onClick={() =>
                              setCastIds((prev) => {
                                const next = [crowdCast.id];
                                if (next[0] !== prev[0]) setPhotoPath(crowdCast.photos[0]?.path ?? null);
                                return next;
                              })
                            }
                            className={ghost}
                          >
                            {formatMsg(m.crowdAloneOnly, { name: crowdCast.name })}
                          </button>
                          <button
                            type="button"
                            disabled={starting}
                            onClick={() =>
                              setCastIds((prev) => {
                                const next = prev.filter((id) => id !== crowdCast.id);
                                if (next[0] !== prev[0]) setPhotoPath(castable.find((x) => x.id === next[0])?.photos[0]?.path ?? null);
                                return next;
                              })
                            }
                            className={ghost}
                          >
                            {formatMsg(m.crowdAloneDrop, { name: crowdCast.name })}
                          </button>
                        </div>
                      </div>
                    )}
                    {/* A character over a whole group, in a take made in parts:
                        the change every later part is least likely to hold. Not
                        said under the box above: the trim it offers would not
                        save a take that asks for two changes at once. */}
                    {groupNeedsOnePart && !crowdSharesTake && (
                      <div className="mt-3 rounded-2xl bg-[#d8b483]/[0.08] p-3.5 shadow-[inset_0_0_0_1px_rgba(216,180,131,0.4)]">
                        <p className="text-sm leading-relaxed text-[#ecedf1]">{m.crowdWarn}</p>
                        <button
                          ref={groupTrimRef}
                          type="button"
                          disabled={starting || !seen || !clipWindow}
                          onClick={() => {
                            if (!seen || !clipWindow) return;
                            setClipWindow(recastFitWindow({ start: clipWindow.start, end: clipWindow.start + 15 }, seen.seconds, job));
                          }}
                          className={`mt-2.5 ${ghost}`}
                        >
                          {m.crowdWarnTrim}
                        </button>
                      </div>
                    )}
                    {cast[0] && cast[0].photos.length > 1 && (
                      <>
                        <p className={`mt-4 ${label}`}>{m.photoLabel}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {cast[0].photos.map((p) => {
                            const on = p.path === photo?.path;
                            return (
                              <button
                                key={p.path}
                                type="button"
                                aria-pressed={on}
                                aria-label={m.photoLabel}
                                disabled={starting}
                                onClick={() => setPhotoPath(p.path)}
                                className={`h-14 w-14 cursor-pointer overflow-hidden rounded-xl transition-shadow ${
                                  on ? "shadow-[0_0_0_2px_rgba(240,196,142,0.85)]" : "opacity-70 shadow-[0_0_0_1px_rgba(255,255,255,0.12)] hover:opacity-100"
                                }`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={p.url} alt="" className="h-full w-full object-cover" />
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                    {/* Images of their own — anything at all — named in their
                        words as image 1, image 2 (recast-brief.ts). */}
                    <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className={label}>{m.imagesLabel}</p>
                      <p className="text-xs text-[#6b6f7a]">{m.imagesHint}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {images.map((img, i) => {
                        const unused = job === "motion" ? cast.length > 0 || i > 0 : i >= imageCap;
                        return (
                          <div
                            key={img.key}
                            className={`relative h-16 w-16 overflow-hidden rounded-xl bg-[#14151a] shadow-[0_0_0_1px_rgba(255,255,255,0.12)] ${unused ? "opacity-40" : ""}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={img.url} alt={formatMsg(m.imageName, { n: i + 1 })} className="h-full w-full object-cover" />
                            <span
                              className={`absolute inset-x-0 bottom-0 bg-black/70 px-1 py-0.5 text-center text-[10px] font-medium text-[rgba(255,255,255,0.92)] ${
                                img.path ? "" : "motion-safe:animate-pulse"
                              }`}
                            >
                              {img.path ? formatMsg(m.imageName, { n: i + 1 }) : m.uploading}
                            </span>
                            <button
                              type="button"
                              aria-label={m.removeImage}
                              title={m.removeImage}
                              disabled={starting || img.path === null}
                              onClick={() => removeImage(img.key)}
                              className="absolute right-1 top-1 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/70 text-xs leading-none text-[#fff] hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                      {images.length < imageCap && (
                        <button
                          type="button"
                          onClick={() => imageFileRef.current?.click()}
                          disabled={starting}
                          className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium text-[#c6c9d1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)] transition-colors hover:bg-[rgba(255,255,255,0.05)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <span aria-hidden className="text-lg leading-none">
                            +
                          </span>
                          {m.addImage}
                        </button>
                      )}
                    </div>
                    {job === "motion" && (cast.length > 0 ? images.length > 0 : images.length > 1) && (
                      <p className="mt-2 text-xs text-[#9aa0ad]">{m.imagesMotionNote}</p>
                    )}
                    {(job === "scene" || job === "restage") && images.length > imageCap && (
                      <p className="mt-2 text-xs text-[#9aa0ad]">
                        {formatMsg(job === "restage" ? m.imagesRoomNoteRestage : m.imagesRoomNote, { n: imageCap })}
                      </p>
                    )}
                  </div>
                )}
                <p className={`${takesCast ? "mt-4" : ""} ${label}`}>
                  {!takesCast
                    ? m.directionLabel
                    : job === "scene" && cast.length === 0
                      ? m.changeLabel
                      : ensemble && castTags.some((tag) => tag === null)
                        ? m.directionLabel
                        : m.directionOptional}
                </p>
                <textarea
                  ref={wordsRef}
                  value={direction}
                  onChange={(e) => setDirection(e.target.value.slice(0, 600))}
                  placeholder={
                    !takesCast
                      ? m.worldPlaceholder
                      : job === "restage"
                        ? m.restagePlaceholder
                        : job === "scene" && cast.length === 0
                          ? m.changePlaceholder
                          : m.directionPlaceholder
                  }
                  rows={!takesCast || (job === "scene" && cast.length === 0) ? 3 : 2}
                  disabled={starting}
                  className="mt-2 w-full resize-y rounded-xl bg-[rgba(255,255,255,0.04)] px-3.5 py-2.5 text-sm text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] outline-none transition-shadow placeholder:text-[#6b6f7a] focus:shadow-[inset_0_0_0_1px_rgba(240,205,166,0.6)] disabled:opacity-50"
                />
                {ready && (
                  <button type="button" onClick={() => setShowBrief((s) => !s)} className="mt-2 cursor-pointer text-xs font-medium text-[#9aa0ad] underline-offset-2 hover:underline">
                    {showBrief ? m.briefHide : m.briefShow}
                  </button>
                )}
              </div>
            </div>

            {/* The brief, word for word. Genjutsu never shows one. */}
            {ready && showBrief && (
              <div className={`mt-3 ${soft}`}>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-[#c6c9d1]">{brief}</pre>
                <p className="mt-2 text-xs text-[#6b6f7a]">{briefInParts ? m.briefNoteParts : m.briefNote}</p>
              </div>
            )}

            {lockOn && lockApplies && <p className="mt-4 text-xs text-[#9aa0ad]">{m.lockPromise}</p>}
            {/* The face check scores one character's face. A second character
                in the same video takes the promise away — said, rather than the
                line quietly vanishing (2026-09-22). */}
            {lockOn && ensemble && <p className="mt-4 text-xs text-[#9aa0ad]">{m.lockOff}</p>}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/quicktime"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  void pickFile(file);
                }}
              />
              <input
                ref={imageFileRef}
                type="file"
                accept={IMAGE_TYPES.join(",")}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  void addImage(file);
                }}
              />
              <label className="flex min-w-0 flex-1 basis-72 cursor-pointer items-start gap-2.5 text-sm text-[#c6c9d1]">
                <input
                  ref={rightsRef}
                  type="checkbox"
                  checked={rights}
                  disabled={starting}
                  onChange={(e) => setRights(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#f0cda6]"
                />
                <span>{m.rights}</span>
              </label>
              {source && (
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={ghost}>
                  {m.change}
                </button>
              )}
              <button
                type="button"
                onClick={() => void take()}
                disabled={!canTake}
                className="cursor-pointer rounded-xl bg-[#ecedf1] px-5 py-2.5 text-sm font-semibold tabular-nums text-[#16171c] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {buttonLabel}
              </button>
              {/* Beside the price: about how long it waits, and what they have
                  left — so someone short of credits sees it before the press. */}
              {(takeMinutes !== null || balance) && (
                <p className="text-xs tabular-nums text-[#6b6f7a]">
                  {[
                    takeMinutes !== null ? formatMsg(m.aboutMinutes, { minutes: takeMinutes }) : null,
                    balance ? (balance.unlimited ? m.balanceUnlimited : formatMsg(m.balanceLeft, { n: balance.left })) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <div role="status" aria-live="polite" className="basis-full space-y-1 empty:hidden">
                {/* WHAT THE WAIT IS (2026-09-20). A long take is cut into its
                    parts before anything is sent, which is up to a minute of
                    silence on a button that only said "Checking the clip…" —
                    and a second press is a second take, and a second charge
                    ("It is not generating. Its stuck at checking video." →
                    "now it generated two videos"). */}
                {starting && <p className="text-xs text-[#f0cda6]">{parts > 1 ? m.preparingLong : m.preparingNote}</p>}
                {/* Why Take is grey — and, where something fixes it, a way there. */}
                {blockerLine &&
                  (blockerGo ? (
                    <button
                      type="button"
                      onClick={() => goTo(blockerGo)}
                      className="cursor-pointer text-left text-xs font-medium text-[#f0cda6] underline-offset-2 hover:underline"
                    >
                      {blockerLine}
                    </button>
                  ) : (
                    <p className="text-xs text-[#d8b483]">{blockerLine}</p>
                  ))}
                {!starting && rendering > 0 && (
                  <p className="text-xs text-[#9aa0ad]">{formatMsg(rendering === 1 ? m.oneRendering : m.someRendering, { n: rendering })}</p>
                )}
              </div>
            </div>
          </>
        )}
        {error && <p className="mt-3 text-sm text-[#dc8290]">{localizeServerText(error, t)}</p>}

        {/* Your takes: ordinary renders, so History and Videos list them too. */}
        <div className="mt-7">
          <p className={label}>{m.takesLabel}</p>
          {takes.length === 0 ? (
            <p className="mt-3 text-sm text-[#6b6f7a]">{m.empty}</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {takes.map((x) => {
                const missed = x.recipe?.lock === true && x.score !== null && x.score < 60;
                const jobWord = x.engine ? jobName(RECAST_ENGINES[x.engine].job) : "";
                const small = "mt-0.5 text-[11px] leading-snug tabular-nums";
                let lines: ReactNode;
                if (x.status === "generating") {
                  // WHERE IT IS (2026-09-22): the runner's own line, then the
                  // minutes against the one estimate — "taking longer than
                  // usual" past it, never a negative count.
                  const stage = progress[x.id] ?? x.progress;
                  const wait = now !== null ? recastWait(x, now) : null;
                  const waitLine =
                    wait === null
                      ? null
                      : wait.late
                        ? formatMsg(m.progressLate, { elapsed: wait.elapsed })
                        : wait.left === null
                          ? null
                          : wait.elapsed === 0
                            ? formatMsg(m.progressStarted, { left: wait.left })
                            : formatMsg(m.progressTime, { elapsed: wait.elapsed, left: wait.left });
                  lines = (
                    <div role="status" aria-live="polite">
                      {stopping.has(x.id) ? (
                        <p className={`${small} text-[#f0cda6]`}>{m.stopping}</p>
                      ) : (
                        <>
                          <p className={`${small} truncate text-[#9aa0ad]`}>{stage ? localizeServerText(stage, t) : m.rendering}</p>
                          {waitLine && <p className={`${small} ${wait?.late ? "text-[#d8b483]" : "text-[#6b6f7a]"}`}>{waitLine}</p>}
                        </>
                      )}
                    </div>
                  );
                } else if (x.status === "failed" || x.status === "stopped") {
                  // A take that did not deliver says how it ended, why, and
                  // whether it cost anything — it used to be one grey word
                  // and a link (2026-09-22).
                  lines = (
                    <>
                      <p className={`${small} text-[#c6c9d1]`}>
                        {x.status === "stopped" ? m.stopped : m.failed}
                        {/* WHEN (2026-09-22): a failed card from two days
                            ago sat beside a take still rendering and read as
                            that take's failure. The date says which one it
                            is. After mount only — the server cannot know the
                            person's time zone, and a date the first paint
                            disagreed on would be a hydration mismatch. */}
                        {now !== null && ` · ${new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(x.createdAt))}`}
                      </p>
                      {x.status === "failed" && (
                        <p className={`${small} text-[#9aa0ad]`}>
                          {x.outcome?.reason
                            ? localizeServerText(x.outcome.reason, t)
                            : x.outcome?.refused
                              ? m.failedRefused
                              : m.failedUnknown}
                        </p>
                      )}
                      {x.outcome && (x.outcome.charged ? x.credits !== null : true) && (
                        <p className={`${small} ${x.outcome.charged ? "text-[#6b6f7a]" : "text-[#9fc9a4]"}`}>
                          {x.outcome.charged ? formatMsg(m.chargedLine, { n: x.credits ?? 0 }) : m.notCharged}
                        </p>
                      )}
                    </>
                  );
                } else {
                  const meta = missed
                    ? x.credits === 0
                      ? m.lockMissed
                      : m.lockDrifted
                    : [
                        x.seconds !== null && x.credits !== null ? formatMsg(m.takeMeta, { seconds: x.seconds, credits: x.credits }) : null,
                        // The face report, when the runner wrote one, speaks
                        // for every face below; the single score is the
                        // fallback for takes made before it.
                        !x.report && x.score !== null ? formatMsg(m.lockScore, { n: Math.round(x.score) }) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                  lines = (
                    <>
                      <p className={`${small} truncate ${missed ? "text-[#d8b483]" : "text-[#6b6f7a]"}`}>{meta}</p>
                      {!missed &&
                        x.report?.faces.map((f) => (
                          <p key={f.characterId} className={`${small} truncate text-[#9aa0ad]`}>
                            {formatMsg(f.scores.length > 1 ? m.reportFace : m.reportFaceOne, {
                              name: f.name,
                              n: f.scores.length,
                              score: Math.round(f.lowest),
                            })}
                          </p>
                        ))}
                    </>
                  );
                }
                const card = (
                  <div
                    className={`overflow-hidden rounded-2xl bg-[#14151a] text-left transition-shadow group-hover:shadow-[inset_0_0_0_1px_rgba(240,205,166,0.5)] ${
                      lit === x.id
                        ? "shadow-[0_0_0_2px_rgba(240,196,142,0.85),0_0_28px_2px_rgba(240,196,142,0.35)]"
                        : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
                    }`}
                  >
                    <div className="relative aspect-[16/9] bg-[#101116]">
                      {x.posterUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={x.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                      ) : (
                        <div
                          aria-hidden
                          className={`absolute inset-0 opacity-30 [background-image:linear-gradient(to_right,rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.07)_1px,transparent_1px)] [background-size:24px_24px] ${
                            x.status === "generating" ? "motion-safe:animate-pulse" : ""
                          }`}
                        />
                      )}
                    </div>
                    <div className="px-3 py-2.5">
                      <p className="truncate text-[13px] font-semibold text-[#ecedf1]">{[x.characterName, jobWord].filter(Boolean).join(" · ") || m.theTake}</p>
                      {lines}
                    </div>
                  </div>
                );
                if (x.status === "succeeded") {
                  return (
                    <button key={x.id} id={`take-${x.id}`} type="button" aria-label={m.watch} onClick={() => void watch(x)} className="group cursor-pointer">
                      {card}
                    </button>
                  );
                }
                if (x.status === "failed" || x.status === "stopped") {
                  // "Set up again", not "Try again": it puts back what the
                  // take remembers — the job, the quality, the words, the
                  // images, and a clip from the library — and an uploaded
                  // clip, the cast and the trim have to be chosen again
                  // (2026-09-22, the completeness critic). A retry would be a
                  // promise it cannot keep.
                  return (
                    <div key={x.id} id={`take-${x.id}`} className="group">
                      {card}
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 px-1">
                        {x.recipe && (
                          <button
                            type="button"
                            disabled={starting}
                            onClick={() => reuse(x)}
                            className="cursor-pointer text-xs font-medium text-[#f0cda6] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            {m.setUpAgain}
                          </button>
                        )}
                        <Link href={`/app/history/${x.id}`} className="text-xs font-medium text-[#9aa0ad] underline-offset-2 hover:underline">
                          {m.history}
                        </Link>
                      </div>
                    </div>
                  );
                }
                return (
                  // STOP (2026-09-20). Until now a take could only be stopped
                  // from the composer, which never holds one of these — so a
                  // take started by mistake ran to the end and was charged in
                  // full ("Canceled the first one, check if i got refunded").
                  <div key={x.id} id={`take-${x.id}`} className="group relative">
                    {card}
                    <button
                      type="button"
                      disabled={stopping.has(x.id)}
                      onClick={() => void stop(x.id)}
                      className={`absolute right-2 top-2 ${chip} cursor-pointer hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {stopping.has(x.id) ? m.stopping : m.stopTake}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
