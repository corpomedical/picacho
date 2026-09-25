"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { formatMsg } from "@/lib/i18n/format";
import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";
import { deleteSet, pollSetBuild, submitSetBuild, submitSetPhotoBuild } from "@/lib/sets/actions";
import { readSetRequest } from "@/lib/sets/words-actions";
import { buildingHintKey, pageSetNotice, photoMetaKey } from "@/lib/sets/leaving";
import { preparePhoto } from "@/lib/sets/photo-client";
import { SET_BRIEF_MAX_CHARS, SET_PHOTO_NOTES_MAX_CHARS } from "@/lib/sets/set-config";
import { SHOT_WORDS_MAX_CHARS } from "@/lib/sets/shot-words";
import { tryAgainWords } from "@/lib/sets/try-again";
import {
  SETS_NOT_OPEN,
  SETS_SESSION_EXPIRED,
  SETS_SUSPENDED,
  SETS_UNAVAILABLE,
  SET_NOT_FOUND,
  SET_PHOTO_UNREADABLE,
} from "@/lib/sets/messages";
import type { SetCharacter, SetStatus, SetSummary } from "@/lib/sets/types";
import { LocalDate } from "@/components/local-date";

// The Sets home (Astra Sets, 2026-09-10; Astra chat since 2026-09-14): it
// asks what we are shooting today. The person says who is in the frame,
// where and what happens, in one message; picks who, and a set they have or
// a new place; and sends. With a set picked the message goes to that set's
// page, which is a conversation with Astra (set-view.tsx). With a new place,
// a small reader takes the place out of the message (shot-words.ts, the
// people and the camera left out — Astra never builds people), the build
// starts, and the message goes with the person to the new set's page, which
// asks it once the build is in. Under the composer: example shoots to
// recreate, then the sets already built. A build runs at OpenAI in the
// background for about a minute and a half; this page polls each one that
// is still building, and the server does the collecting (pollSetBuild), so
// the card changes the moment the build does.
//
// LEAVING (2026-09-11). The finisher, a per-minute cron on the server, runs
// the same collecting step for every build whether or not a page is open,
// and tells the owner's browser when one finishes (lib/sets/finisher.ts).
// It can run only while CRON_SECRET is set; the page is told which
// (finisherOn) and says either "you can leave — it finishes on its own", or
// what is true without it: background mode keeps an answer for about ten
// minutes, so a build nobody collects by then is lost (lib/sets/leaving.ts
// picks the line). A tab left open in the background keeps polling every
// 5 s, so it usually collects a build before the finisher's next minute
// comes round; the finisher then has nothing to settle and sends nothing.
// So this page keeps the promise itself: a build it settles while its tab
// is hidden gets the finisher's notification, shown from here — and one the
// finisher settled is left to the finisher's push, unless this browser has
// no subscription for it to arrive by.
//
// FROM A PHOTO (2026-09-11; admins, behind astra_photo_sets): the photo is
// prepared here (photo-client.ts) and checked on the server before anything
// else — which takes up to a minute or two, hence "Checking the photo…" on
// the button. A photo build takes 2–5 minutes (the three test builds took
// 123–183 s, and a closing retry adds an attempt): without the finisher,
// long enough that an answer nobody collects can be lost, so its copy then
// says to keep the page open.

const POLL_MS = 5000;
const POLL_MAX_MS = 30_000;
// Answers that mean no set on this page can be collected from here any
// more: polling stops and the sentence is shown.
const ACCESS_ERRORS = new Set([SETS_UNAVAILABLE, SETS_NOT_OPEN, SETS_SESSION_EXPIRED, SETS_SUSPENDED]);

type PreparedPhoto = { dataUri: string; width: number; height: number };

const SHEET_SHADOW =
  "shadow-[0_0_0_1px_var(--frost-ring),0_2px_6px_rgba(0,0,0,0.04),0_24px_56px_-20px_rgba(0,0,0,0.22)]";

// A build that left "building" while this tab was hidden: the finisher's
// notification, shown from here (leaving.ts pageSetNotice). Only when the
// tab is hidden, since a visible card already says it, and only with
// permission already granted: this never asks. The service worker first, as
// the composer's notifyIfHidden does and for the same reason
// (generate-form.tsx: Android Chrome forbids the page's own Notification
// constructor), and through it the tap opens the set as the push's would.
//
// ONE NOTIFICATION PER SET. When this tab's own poll settled the build
// (`settledHere`), nobody else announces it. When the finisher settled it,
// the finisher pushed to this browser's subscription — so the page speaks
// only for a browser that has none (the push could not reach it). Either
// way, a notification already on screen with this set's tag is left as it
// is. Best-effort, and never throws.
function announceIfHidden(notice: { title: string; body: string; path: string; tag: string }, settledHere: boolean) {
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
      // No service worker, so no push subscription: the finisher cannot have told this browser.
      inPage();
      return;
    }
    void sw
      .getRegistration()
      .then(async (registration) => {
        if (!registration) return inPage();
        if (!settledHere) {
          const subscribed = await registration.pushManager?.getSubscription().catch(() => null);
          if (subscribed) return;
        }
        const shown =
          typeof registration.getNotifications === "function"
            ? await registration.getNotifications({ tag: notice.tag }).catch(() => [])
            : [];
        if (shown.length > 0) return;
        await registration.showNotification(notice.title, {
          body: notice.body,
          tag: notice.tag,
          data: { path: notice.path },
          icon: "/icon-192-maskable.png",
          badge: "/icon-192-maskable.png",
        });
      })
      .catch(() => {
        // No way left to notify: skip silently.
      });
  } catch {
    // The card already shows the result; a notification must never break the poll.
  }
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden>
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  );
}

export function SetsHome({
  initialSets,
  usedThisMonth,
  monthlyLimit,
  shotsThisMonth,
  photoSetsOn,
  characters,
  finisherOn,
  notifyReady,
  notifyFailed,
  againId = null,
}: {
  initialSets: SetSummary[];
  usedThisMonth: number;
  monthlyLimit: number;
  /** Stills shot in these sets this billing month (the dashboard line). */
  shotsThisMonth: number;
  /** Sets from a photo are on for this person: the composer offers both ways in. */
  photoSetsOn: boolean;
  /** Their characters with a saved photo: who the composer can shoot. */
  characters: SetCharacter[];
  /** The finisher can run (finisher.ts finisherCanRun): a build completes with the page closed. */
  finisherOn: boolean;
  /** The render switches in Settings → Notifications, which the finisher's pushes answer to as well. */
  notifyReady: boolean;
  notifyFailed: boolean;
  /** A failed build's "Try again" on its own page (/app/sets?again=<id>): its words start in the box. */
  againId?: string | null;
}) {
  const { t } = useLocale();
  const s = t.sets;
  // The words of the finisher's notifications, as plain strings so the poll
  // below does not restart every time a refresh hands down a new dictionary.
  const { setReadyTitle, setReadyBodyUntitled, setFailedTitle, setFailedBody } = t.push;
  const router = useRouter();

  const [sets, setSets] = useState<SetSummary[]>(initialSets);
  const [seenInitial, setSeenInitial] = useState(initialSets);
  // A failed build tried again from its own page: its words, once, in the
  // box (Helios Cut 3, step 5). Read on the first render only; the address
  // forgets it below.
  const [againWords] = useState(() => {
    const failed = againId ? initialSets.find((x) => x.id === againId) : undefined;
    return failed ? tryAgainWords(failed) : null;
  });
  const [brief, setBrief] = useState(() => (againWords ?? "").slice(0, SHOT_WORDS_MAX_CHARS));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pollingStopped, setPollingStopped] = useState(false);
  const [mode, setMode] = useState<"describe" | "photo">("describe");
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [notes, setNotes] = useState("");
  const [photoStarting, setPhotoStarting] = useState(false);
  // Who is in the frame, where (a set already built, or a new place), and
  // whether Astra waits for the word after framing.
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  const [setPick, setSetPick] = useState<string | null>(null);
  const [askFirst, setAskFirst] = useState(true);
  const [menu, setMenu] = useState<"character" | "set" | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const briefRef = useRef<HTMLTextAreaElement | null>(null);
  /**
   * A send is on its way. Read the moment a call starts, so a second Enter
   * before the composer paints as busy cannot start a second paid read and a
   * second build — the set page's own busyRef rule (2026-09-17).
   */
  const sendingRef = useRef(false);

  // A refresh brings the server's truth (titles, thumbnails) for sets that
  // finished; it replaces the local list. Adjusted during render, not in an
  // effect, so the stale list never paints first.
  if (initialSets !== seenInitial) {
    setSeenInitial(initialSets);
    setSets(initialSets);
  }

  const buildingIds = pollingStopped
    ? ""
    : sets.filter((x) => x.status === "building").map((x) => x.id).join(",");

  // Collects every build still running. The server does the collecting; a
  // tick that throws (a dropped connection, a laptop waking) must never end
  // the loop, because the answer it is waiting for is already paid for and
  // lasts only minutes at OpenAI — so it backs off and tries again, and a
  // tab running an old deploy reloads itself onto the new one. A build that
  // leaves "building" here is announced if the tab is hidden, under the
  // person's switches (announceIfHidden): always when this poll's own write
  // settled it (res.settledHere), and when the finisher settled it only if
  // this browser has no push subscription for the finisher's push to reach.
  useEffect(() => {
    if (!buildingIds) return;
    let cancelled = false;
    let delay = POLL_MS;
    const tick = async () => {
      let settled = false;
      let threw = false;
      for (const id of buildingIds.split(",")) {
        let res: Awaited<ReturnType<typeof pollSetBuild>>;
        try {
          res = await pollSetBuild(id);
        } catch (err) {
          if (isStaleDeployError(err)) {
            // Through the one shared guard (stale-deploy.ts): a tick that
            // keeps failing cannot reload the page over and over.
            reloadForNewDeploy();
            return;
          }
          threw = true;
          continue;
        }
        if (cancelled) return;
        if (res.error !== null) {
          if (res.error === SET_NOT_FOUND) {
            // Deleted in another tab or on another device.
            setSets((prev) => prev.filter((x) => x.id !== id));
            continue;
          }
          if (ACCESS_ERRORS.has(res.error)) {
            setError(res.error);
            setPollingStopped(true);
            return;
          }
          threw = true;
          continue;
        }
        if (res.state === "building") continue;
        settled = true;
        setSets((prev) =>
          prev.map((x) =>
            x.id === id
              ? { ...x, status: res.state, failure: res.state === "failed" ? res.message : null }
              : x,
          ),
        );
        if (res.state === "ready" ? notifyReady : notifyFailed) {
          announceIfHidden(
            pageSetNotice(id, res.state, { setReadyTitle, setReadyBodyUntitled, setFailedTitle, setFailedBody }),
            res.settledHere === true,
          );
        }
      }
      if (cancelled) return;
      if (settled) router.refresh();
      delay = threw ? Math.min(POLL_MAX_MS, delay * 2) : POLL_MS;
      timerRef.current = setTimeout(tick, delay);
    };
    timerRef.current = setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [
    buildingIds,
    router,
    notifyReady,
    notifyFailed,
    setReadyTitle,
    setReadyBodyUntitled,
    setFailedTitle,
    setFailedBody,
  ]);

  // ?again= is read once: the address forgets it, so a reload does not put
  // the words back over what the person has typed since.
  useEffect(() => {
    if (!againId) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("again");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    } catch {
      // The words are in the box either way.
    }
  }, [againId]);

  // Escape closes an open menu, as a click off it does (and as the set page's menus do).
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  /**
   * Where a message goes: the set's page, the message and the choices in
   * the address. `built`: this message is the one the set is being built
   * from (?from=build), so the set's page never hands its place part to
   * Astra again — only the build branch below says so, never a message to
   * a set already built (Helios Cut 2, step 1, 2026-09-25).
   */
  function threadHref(setId: string, message: string, built = false): string {
    const q = new URLSearchParams();
    q.set("ask", message.slice(0, SHOT_WORDS_MAX_CHARS));
    if (characterId) q.set("character", characterId);
    if (!askFirst) q.set("askFirst", "0");
    if (built) q.set("from", "build");
    return `/app/sets/${setId}?${q.toString()}`;
  }

  /**
   * The message, sent. To a set already built: straight to its page. To a
   * new place: the place is read out of the message (people and camera
   * left out; the whole message when the reader cannot read it), the build
   * starts, and the person goes to the new set's page with the message.
   */
  async function send() {
    const message = brief.trim();
    // The send button's own rule, for Enter too: at the month's cap a new
    // place is refused anyway — and only after a paid read of the message.
    if (!canSend || sendingRef.current) return;
    // Where this message goes, read ONCE. The chips that decide it are held
    // while a send is out (below), so what was on screen is what was sent:
    // picking a set mid-send used to pay for a new place and go to it
    // (found reviewing Helios, fixed 2026-09-18).
    const toSet = setPick;
    setError("");
    if (toSet) {
      router.push(threadHref(toSet, message));
      return;
    }
    sendingRef.current = true;
    setStarting(true);
    let place = message.slice(0, SET_BRIEF_MAX_CHARS);
    let res: Awaited<ReturnType<typeof submitSetBuild>>;
    try {
      try {
        const read = await readSetRequest({ text: message });
        if (read.error === null && read.words?.place) place = read.words.place;
      } catch (err) {
        // A reader that is down builds from the whole message; a stale
        // deploy is caught by the build call below.
        if (isStaleDeployError(err)) throw err;
      }
      res = await submitSetBuild(place);
    } catch (err) {
      const stale = isStaleDeployError(err);
      setError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
      if (stale) reloadForNewDeploy({ delayMs: 1800 });
      return;
    } finally {
      sendingRef.current = false;
      setStarting(false);
    }
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    setSets((prev) => [
      {
        id: res.id,
        title: "",
        brief: place,
        status: "building",
        createdAt: new Date().toISOString(),
        thumbUrl: null,
        failure: null,
        fromPhoto: false,
        shots: 0,
        lastShotAt: null,
      },
      ...prev,
    ]);
    setBrief("");
    router.push(threadHref(res.id, message, true));
  }

  // The photo, prepared in the browser (upright, at most 2048 px, a JPEG
  // with no metadata) before anything is sent. A refusal here is one of the
  // server's own sentences, localized the same way.
  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setError("");
    setPhoto(null);
    setPreparing(true);
    try {
      const res = await preparePhoto(file);
      if (res.ok) setPhoto({ dataUri: res.dataUri, width: res.width, height: res.height });
      else setError(res.error);
    } catch {
      setError(SET_PHOTO_UNREADABLE);
    } finally {
      setPreparing(false);
    }
  }

  async function buildFromPhoto() {
    if (photoStarting || starting || !photo) return;
    setError("");
    setPhotoStarting(true);
    let res: Awaited<ReturnType<typeof submitSetPhotoBuild>>;
    try {
      res = await submitSetPhotoBuild({ photoDataUri: photo.dataUri, notes });
    } catch (err) {
      const stale = isStaleDeployError(err);
      setError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
      if (stale) reloadForNewDeploy({ delayMs: 1800 });
      return;
    } finally {
      setPhotoStarting(false);
    }
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    setSets((prev) => [
      {
        id: res.id,
        title: "",
        brief: notes.trim(),
        status: "building",
        createdAt: new Date().toISOString(),
        thumbUrl: null,
        failure: null,
        fromPhoto: true,
        shots: 0,
        lastShotAt: null,
      },
      ...prev,
    ]);
    setPhoto(null);
    setNotes("");
    router.refresh();
  }

  /**
   * Delete, after a confirm that says what it does to the month's builds
   * (Helios Cut 3, step 4): a ready set's build is not given back, a build
   * still running is stopped and still counts, and a failed one never
   * counted — the count's own rule (data.ts countSetBuildsThisMonth).
   */
  async function remove(id: string, status: SetStatus) {
    const question = status === "building" ? s.deleteConfirmBuilding : status === "failed" ? s.deleteConfirmFailed : s.deleteConfirm;
    if (!window.confirm(question)) return;
    setDeleting(id);
    let res: Awaited<ReturnType<typeof deleteSet>>;
    try {
      res = await deleteSet(id);
    } catch (err) {
      const stale = isStaleDeployError(err);
      setError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
      if (stale) reloadForNewDeploy({ delayMs: 1800 });
      return;
    } finally {
      setDeleting(null);
    }
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    setSets((prev) => prev.filter((x) => x.id !== id));
    if (setPick === id) setSetPick(null);
    router.refresh();
  }

  /** An example, into the composer: its words, with the person's own character's name, for a new place. */
  function recreate(prompt: string) {
    // Never over a send that is out: it would replace the words that send is
    // about to clear, and move the composer under it.
    if (submitting) return;
    setBrief(formatMsg(prompt, { name: characters.find((c) => c.id === characterId)?.name || s.exampleCharacter }));
    setSetPick(null);
    setMode("describe");
    briefRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /**
   * "Try again" on a failed build from words (Helios Cut 3, step 5): its
   * words back in the box, with "A new place". Nothing is spent here — the
   * person presses the build button, which says what it uses.
   */
  function tryAgain(words: string) {
    // Never over a send that is out, as Recreate.
    if (submitting) return;
    setBrief(words.slice(0, SHOT_WORDS_MAX_CHARS));
    setSetPick(null);
    setMode("describe");
    briefRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const used = usedThisMonth;
  const atCap = monthlyLimit >= 0 && used >= monthlyLimit;
  const usageLine = monthlyLimit < 0 ? s.unlimitedUsage : formatMsg(s.monthlyUsage, { used, limit: monthlyLimit });
  const fromPhoto = photoSetsOn && mode === "photo";
  // While a submit runs (the photo check takes up to a minute or two), what
  // it sent stays on screen and cannot change: success clears the words it
  // sent, so an edit made meanwhile would vanish unsent, and switching forms
  // would hide the only line saying what is happening.
  const submitting = starting || photoStarting;
  const chip = (active: boolean) =>
    `flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-[7px] text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-50 ${
      active
        ? "bg-atelier-accent/10 text-atelier-accent shadow-[inset_0_0_0_1px_rgba(180,90,40,0.45)]"
        : "bg-atelier-ink/[0.045] text-atelier-muted hover:bg-atelier-ink/[0.07] hover:text-atelier-ink"
    }`;
  const menuItem = (active: boolean) =>
    `flex w-full cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-sm transition-colors ${
      active ? "bg-atelier-ink/[0.06] font-medium text-atelier-ink" : "text-atelier-muted hover:bg-atelier-ink/5 hover:text-atelier-ink"
    }`;

  const readyCount = sets.filter((x) => x.status === "ready").length;
  const buildingCount = sets.filter((x) => x.status === "building").length;
  const readySets = sets.filter((x) => x.status === "ready");
  const character = characters.find((c) => c.id === characterId) ?? null;
  const pickedSet = readySets.find((x) => x.id === setPick) ?? null;
  const setName = (x: SetSummary) => x.title || (x.status === "ready" ? s.untitled : x.fromPhoto ? x.brief || s.fromPhoto : x.brief);
  const stats = [
    formatMsg(s.statsReady, { n: readyCount }),
    buildingCount > 0 ? formatMsg(s.statsBuilding, { n: buildingCount }) : null,
    formatMsg(s.statsStills, { n: shotsThisMonth }),
    monthlyLimit < 0 ? formatMsg(s.statsBuildsMonth, { n: used }) : formatMsg(s.monthlyUsage, { used, limit: monthlyLimit }),
  ]
    .filter(Boolean)
    .join(" · ");
  const canSend = brief.trim().length > 0 && !submitting && (setPick !== null || !atCap);

  return (
    <div className="space-y-10">
      {/* What are we shooting today? */}
      <div className="flex flex-col items-center gap-5 pt-2 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-atelier-ink">{s.homeHeadline}</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (fromPhoto) void buildFromPhoto();
            else void send();
          }}
          className={`isolate relative w-full max-w-2xl rounded-[28px] bg-atelier-surface/80 p-4 text-left ${SHEET_SHADOW} backdrop-blur-xl`}
        >
          {photoSetsOn && (
            <div className="mb-3 flex flex-wrap gap-2">
              <button type="button" aria-pressed={mode === "describe"} onClick={() => setMode("describe")} disabled={submitting} className={chip(mode === "describe")}>
                {s.modeDescribe}
              </button>
              <button type="button" aria-pressed={mode === "photo"} onClick={() => setMode("photo")} disabled={submitting} className={chip(mode === "photo")}>
                {s.fromPhoto}
              </button>
            </div>
          )}
          {fromPhoto ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex h-40 w-full max-w-xs items-center justify-center overflow-hidden rounded-control border border-atelier-rule bg-atelier-stage">
                  {preparing ? (
                    <span className="px-3 text-center text-xs text-onmedia/70">{s.photoPreparing}</span>
                  ) : photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.dataUri} alt={s.photoPreviewAlt} className="h-full w-full object-contain" />
                  ) : (
                    <div
                      aria-hidden
                      className="h-full w-full opacity-40 [background-image:linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:28px_28px]"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      // Cleared, so choosing the same file again still counts as a choice.
                      e.target.value = "";
                      void pickPhoto(file);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={preparing || photoStarting}
                    className="cursor-pointer rounded-control border border-atelier-rule px-4 py-2 text-sm font-medium text-atelier-ink transition-colors hover:border-atelier-accent disabled:opacity-40"
                  >
                    {photo ? s.photoChange : s.photoPick}
                  </button>
                  <p className="text-xs text-atelier-muted">{s.photoHint}</p>
                </div>
              </div>
              <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{s.photoNotesLabel}</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value.slice(0, SET_PHOTO_NOTES_MAX_CHARS))}
                  rows={2}
                  placeholder={s.photoNotesPlaceholder}
                  disabled={photoStarting}
                  className="mt-1.5 w-full rounded-control border border-atelier-rule bg-transparent px-3 py-2 text-sm text-atelier-ink outline-none transition-colors placeholder:text-atelier-muted/70 focus:border-atelier-accent disabled:opacity-40"
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5 text-xs text-atelier-muted">
                  <p>{s[photoMetaKey(finisherOn)]}</p>
                  <p className="tabular-nums">{usageLine}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs tabular-nums text-atelier-muted">
                    {notes.length}/{SET_PHOTO_NOTES_MAX_CHARS}
                  </span>
                  <button
                    type="submit"
                    disabled={preparing || photoStarting || starting || atCap || !photo}
                    className="cursor-pointer rounded-control bg-atelier-ink px-5 py-2.5 text-sm font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {photoStarting ? s.photoChecking : s.photoBuildButton}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <textarea
                ref={briefRef}
                value={brief}
                onChange={(e) => setBrief(e.target.value.slice(0, SHOT_WORDS_MAX_CHARS))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder={s.homePlaceholder}
                aria-label={s.homeHeadline}
                disabled={starting}
                autoFocus
                className="w-full resize-none border-none bg-transparent px-2.5 py-2 text-sm text-atelier-ink outline-none placeholder:text-atelier-muted/80 disabled:opacity-60"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative flex flex-wrap items-center gap-2">
                  {menu && <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} aria-hidden />}
                  {/* Who */}
                  {characters.length === 0 ? (
                    <Link href="/app/character/new" className={chip(false)}>
                      {s.createCharacter}
                    </Link>
                  ) : (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setMenu((m) => (m === "character" ? null : "character"))}
                        disabled={submitting}
                        aria-expanded={menu === "character"}
                        aria-haspopup="listbox"
                        className={`${chip(false)} pl-1`}
                      >
                        {character?.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={character.thumbUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                        ) : (
                          <span className="h-5 w-5 rounded-full bg-atelier-rule" />
                        )}
                        {character?.name || s.characterLabel}
                        <Chevron />
                      </button>
                      {menu === "character" && (
                        <div
                          role="listbox"
                          aria-label={s.characterLabel}
                          className="absolute left-0 top-full z-30 mt-2 w-max min-w-[12rem] rounded-[12px] bg-atelier-surface p-1.5 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.25)] backdrop-blur-xl"
                        >
                          {characters.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              role="option"
                              aria-selected={characterId === c.id}
                              onClick={() => {
                                setCharacterId(c.id);
                                setMenu(null);
                              }}
                              className={menuItem(characterId === c.id)}
                            >
                              {c.thumbUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={c.thumbUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                              ) : (
                                <span className="h-6 w-6 rounded-full bg-atelier-rule" />
                              )}
                              {c.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Where */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setMenu((m) => (m === "set" ? null : "set"))} disabled={submitting}
                      aria-expanded={menu === "set"}
                      aria-haspopup="listbox"
                      className={chip(false)}
                    >
                      <span className="text-atelier-muted/80">{s.setChip}:</span>
                      {pickedSet ? setName(pickedSet) : s.newPlace}
                      <Chevron />
                    </button>
                    {menu === "set" && (
                      <div
                        role="listbox"
                        aria-label={s.setChip}
                        className="absolute left-0 top-full z-30 mt-2 max-h-72 w-max min-w-[14rem] max-w-[20rem] overflow-y-auto rounded-[12px] bg-atelier-surface p-1.5 shadow-[0_0_0_1px_var(--frost-ring),0_24px_48px_-12px_rgba(0,0,0,0.25)] backdrop-blur-xl"
                      >
                        <button
                          type="button"
                          role="option"
                          aria-selected={setPick === null}
                          onClick={() => {
                            setSetPick(null);
                            setMenu(null);
                          }}
                          className={menuItem(setPick === null)}
                        >
                          {s.newPlace}
                        </button>
                        {readySets.map((x) => (
                          <button
                            key={x.id}
                            type="button"
                            role="option"
                            aria-selected={setPick === x.id}
                            onClick={() => {
                              setSetPick(x.id);
                              setMenu(null);
                            }}
                            className={menuItem(setPick === x.id)}
                          >
                            {x.thumbUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={x.thumbUrl} alt="" className="h-6 w-6 rounded-[4px] object-cover" />
                            ) : (
                              <span className="h-6 w-6 rounded-[4px] bg-atelier-stage" />
                            )}
                            <span className="truncate">{setName(x)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => setAskFirst((v) => !v)} disabled={submitting} aria-pressed={askFirst} title={s.modeHint} className={chip(askFirst)}>
                    {askFirst ? s.askBeforeShooting : s.shootWithoutAsking}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="hidden text-xs tabular-nums text-atelier-muted sm:inline">{setPick ? "" : usageLine}</span>
                  <button
                    type="submit"
                    disabled={!canSend}
                    title={s.shootHere}
                    aria-label={s.shootHere}
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-atelier-ink text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {starting ? (
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <SendIcon className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-red-600">{localizeServerText(error, t)}</p>}
        </form>
        <p className="max-w-2xl text-sm text-atelier-muted">{s.subtitle}</p>
      </div>

      {/* Example shoots: recreate one and it fills the composer */}
      <section className="space-y-4">
        <h2 className="text-center font-display text-xl font-semibold tracking-tight text-atelier-ink">{s.examplesTitle}</h2>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {s.examples.map((ex) => (
            <li key={ex.label} className="flex flex-col gap-3 rounded-media bg-atelier-surface p-4 shadow-[0_0_0_1px_var(--frost-ring),0_1px_2px_rgba(33,29,22,0.04),0_16px_40px_-24px_rgba(33,29,22,0.12)]">
              <p className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{ex.label}</p>
              <p className="flex-1 text-sm text-atelier-ink/85">
                {formatMsg(ex.prompt, { name: character?.name || s.exampleCharacter })}
              </p>
              <div>
                <button type="button" onClick={() => recreate(ex.prompt)} disabled={submitting} className={chip(false)}>
                  {s.recreate}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* The sets */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{s.yourSets}</h2>
          <span className="text-xs tabular-nums text-atelier-muted">{stats}</span>
        </div>
        {sets.length === 0 ? (
          <div className="space-y-1 text-center">
            <p className="text-sm font-medium text-atelier-ink">{s.emptyTitle}</p>
            <p className="mx-auto max-w-md text-sm text-atelier-muted">{s.emptyBody}</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sets.map((x) => {
              // A photo set has no brief: until Astra titles it, it goes by
              // the photographer's notes, or by where it came from.
              const name = setName(x);
              const again = tryAgainWords(x);
              return (
                <li key={x.id} className="overflow-hidden rounded-media bg-atelier-surface shadow-[0_0_0_1px_var(--frost-ring),0_1px_2px_rgba(33,29,22,0.04),0_16px_40px_-24px_rgba(33,29,22,0.12)]">
                  <div className="relative aspect-[4/3] bg-atelier-stage">
                    {x.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={x.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div
                        aria-hidden
                        className="h-full w-full opacity-40 [background-image:linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:28px_28px]"
                      />
                    )}
                    <span
                      className={`absolute left-3 top-3 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
                        x.status === "ready"
                          ? "bg-black/60 text-onmedia"
                          : x.status === "building"
                            ? "animate-pulse bg-atelier-accent text-atelier-stage"
                            : "bg-red-600/90 text-white"
                      }`}
                    >
                      {x.status === "ready" ? s.statusReady : x.status === "building" ? s.statusBuilding : s.statusFailed}
                    </span>
                    {x.status === "ready" && (
                      <Link href={`/app/sets/${x.id}`} className="absolute inset-0" aria-label={`${s.open}: ${name}`} />
                    )}
                  </div>
                  <div className="space-y-1.5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="line-clamp-2 text-sm font-medium text-atelier-ink">{name}</p>
                      <span className="flex-shrink-0 text-xs tabular-nums text-atelier-muted">
                        <LocalDate date={x.createdAt} />
                      </span>
                    </div>
                    {x.fromPhoto && (
                      <span className="inline-block rounded-full border border-atelier-rule px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-atelier-muted">
                        {s.fromPhoto}
                      </span>
                    )}
                    {x.status === "ready" && (
                      <p className="text-xs tabular-nums text-atelier-muted">
                        {x.shots === 0 ? s.noShots : x.shots === 1 ? s.shotsOne : formatMsg(s.shotsMany, { n: x.shots })}
                        {x.lastShotAt && (
                          <>
                            {" · "}
                            <LocalDate date={x.lastShotAt} />
                          </>
                        )}
                      </p>
                    )}
                    {x.status === "building" && (
                      <p className="text-xs text-atelier-muted">{s[buildingHintKey(x.fromPhoto, finisherOn)]}</p>
                    )}
                    {x.status === "failed" && x.failure && (
                      <p className="text-xs text-atelier-muted">{localizeServerText(x.failure, t)}</p>
                    )}
                    <div className="flex items-center justify-between pt-1">
                      {x.status === "ready" ? (
                        <Link href={`/app/sets/${x.id}`} className={chip(false)}>
                          {s.shootHere}
                        </Link>
                      ) : again !== null ? (
                        <button type="button" onClick={() => tryAgain(again)} disabled={submitting} title={s.buildTryAgainHint} className={chip(false)}>
                          {s.buildTryAgain}
                        </button>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        onClick={() => void remove(x.id, x.status)}
                        disabled={deleting === x.id}
                        className="cursor-pointer text-xs text-atelier-muted transition-colors hover:text-red-600 disabled:opacity-50"
                      >
                        {deleting === x.id ? s.deleting : s.delete}
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
