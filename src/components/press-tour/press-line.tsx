"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { localizeServerText } from "@/lib/i18n/server-text";
import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";
import { useBackCloser } from "@/lib/native/back-stack";
import type { CampaignView } from "@/lib/press-tour/campaign-types";
import type {
  ConnectionView,
  Network,
  PostDraftInput,
  PostDraftView,
  PostView,
  PostWhen,
  PublishActions,
  TikTokSheetState,
} from "@/lib/press-tour/publish-types";
import {
  NETWORK_MARKS,
  NETWORK_NAMES,
  PRESS_LINE_VERSION,
  TIKTOK_UI_DEFAULT,
  adFileName,
  canCompose,
  defaultScheduleInput,
  downloadUrl,
  localInputToIso,
  parseHashtags,
  postsNewestFirst,
  profileUrl,
  safePermalink,
  sheetColumns,
  tiktokBlocks,
  tiktokSent,
  zoneCity,
  type TikTokUi,
} from "@/lib/press-tour/press-line-view";
import type { WaitlistActions } from "@/lib/press-tour/waitlist";
import { clockSeconds } from "@/lib/press-tour/door-view";
import { CONNECT_ON_COMPUTER, POST_UNCONFIRMED, TIKTOK_INTERACTION_OFF, TIKTOK_PRIVACY_REQUIRED, TIKTOK_TEST_FULL, TIKTOK_TEST_ONLY_ME, type ConnectErrorCode } from "@/lib/social/messages";
import { cn } from "@/lib/cn";
import { TickBox } from "./controls";
import { CalendarIcon, CheckIcon, CloseIcon, DownloadIcon, EyeIcon, PlayIcon, SendIcon, ShieldIcon } from "./icons";
import { renditionOf } from "./finished-cut";
import s from "./press-tour.module.css";

// THE PRESS LINE (Cut 5 UI, design A's publish-desktop and publish-phone
// artboards): one sheet for every network. On a computer each network has
// its own pit, side by side, behind a velvet rope; on a phone, one network
// per step. Every pit previews exactly what will post: the very file (the
// tagged one; TikTok's clean one, since TikTok forbids added marks and its
// own AI label does that job), the exact text, the account, and the time.
// The engine's preview (previewPost) is asked again on every edit; it
// answers with the text that posts, its length, what blocks it and the
// consent token the press sends back. Nothing leaves Picacho before the
// person presses Post, and a press that changed nothing sends nothing twice.
//
// Rules the sheet keeps (publish-types.ts; constraints §6A and §6B; the
// operator, 2026-09-26):
// - the platform's AI label is on for every post and can't be switched off
//   (X "Made with AI", TikTok "AI-generated", Instagram's AI label, Threads'
//   "Made with AI" line in the text);
// - X: the text is counted, no link (the link goes in the bio), a paid
//   partnership label off until turned on, a time to post;
// - TikTok: the creator's nickname and picture from TikTok itself; who can
//   see it has NO default and offers only what TikTok returned (in test
//   mode, Only me); Comment, Duet and Stitch start unticked and are greyed
//   when the creator turned them off; commercial content off until turned
//   on, with Your brand and Branded content (unavailable in test mode;
//   never Only me); the Music Usage Confirmation line; an editable caption;
//   "can take a few minutes to appear"; no Picacho logo or end card; Post
//   waits until who can see it is chosen; TikTok is never scheduled;
// - a network not open to the person says Coming soon, and the switch to
//   hear when it opens starts OFF;
// - connecting happens on the web; the phone app says to use a computer.

export type ConnectNote = { network: Network; outcome: "connected" | ConnectErrorCode };

export type PressLineProps = {
  campaign: CampaignView;
  productName: string | null;
  publish: PublishActions;
  waitlist: WaitlistActions;
  /** The connect callback's answer, shown once. */
  connectNote: ConnectNote | null;
  onClose: () => void;
};

type NetDraft = {
  caption: string;
  tags: string;
  when: "now" | "at";
  at: string;
  paid: boolean;
  tiktok: TikTokUi;
  skip: boolean;
};

type Preview = { key: string; draft: PostDraftView | null; error: string | null };

const WIDE = "(min-width: 1024px)";
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
function useWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

const MUSIC_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const BRANDED_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";

const LABEL = "font-slate text-[11px] font-medium uppercase tracking-[0.1em] text-[#858994]";
const GHOST =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13px] font-medium text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.16)] hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] disabled:opacity-50 lg:min-h-9";
const QUIET =
  "inline-flex min-h-11 items-center text-[12.5px] text-[#9aa0ad] underline decoration-[rgba(255,255,255,0.2)] underline-offset-[3px] hover:text-[#ecedf1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] disabled:opacity-50 lg:min-h-8";
const FIELD =
  "block w-full rounded-xl bg-[rgba(255,255,255,0.03)] px-2.5 py-2 text-[13px] leading-[1.45] text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.12)] placeholder:text-[#62656e] focus:outline-none focus:ring-[1.5px] focus:ring-[rgba(240,196,142,0.6)]";

/** A template with named slots filled by nodes. */
function fill(template: string, slots: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const m = part.match(/^\{(\w+)\}$/);
    return m && m[1] in slots ? <span key={i}>{slots[m[1]]}</span> : part;
  });
}

/** A switch: a real button with role="switch". One that is always on is shown on, and can't be pressed. */
function Switch({ on, onChange, label, locked }: { on: boolean; onChange?: (next: boolean) => void; label: string; locked?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={locked}
      onClick={() => onChange?.(!on)}
      className={s.switch}
    />
  );
}

function Opt({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="min-w-0 flex-1 text-[12.5px] leading-[1.3] text-[#ecedf1]">
        {title}
        {note && <small className="mt-0.5 block text-[11.5px] leading-[1.38] text-[#858994]">{note}</small>}
      </div>
      {children}
    </div>
  );
}

function newDraft(now: Date): NetDraft {
  return { caption: "", tags: "", when: "now", at: defaultScheduleInput(now), paid: false, tiktok: { ...TIKTOK_UI_DEFAULT }, skip: false };
}

/** The very file a network gets, small: a tap plays it with its sound, another pauses it. */
function PreviewVideo({ src, poster, label }: { src: string; poster: string | null; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={playing}
      onClick={() => {
        const v = ref.current;
        if (!v) return;
        if (v.paused) void v.play().catch(() => undefined);
        else v.pause();
      }}
      className="group absolute inset-0 block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#f0cda6]"
    >
      <video
        ref={ref}
        src={src}
        poster={poster ?? undefined}
        playsInline
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        className="h-full w-full object-cover"
      />
      {!playing && (
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[rgba(0,0,0,0.55)] text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]">
            <PlayIcon className="h-3 w-3" />
          </span>
        </span>
      )}
    </button>
  );
}

/** The velvet rope in front of the pits, its posts at the pits' edges. */
/**
 * The account's picture as TikTok sent it. It lives on TikTok's own servers,
 * which the site's image policy (middleware.ts img-src) does not list, and
 * the link expires after two hours: whenever it doesn't load, the plain disc
 * stands in. The nickname beside it is what TikTok requires.
 */
function AccountPicture({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span aria-hidden="true" className="h-6 w-6 flex-none rounded-full bg-[rgba(255,255,255,0.08)]" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- TikTok's own picture for the account, shown as it sent it
    <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-6 w-6 flex-none rounded-full" />
  );
}

function Rope({ weights }: { weights: number[] }) {
  const ids = useId().replace(/:/g, "");
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const xs = [0, ...weights.map((_, i) => weights.slice(0, i + 1).reduce((a, b) => a + b, 0) / total)].map((f) => 8 + f * 1048);
  return (
    <svg className="mx-5 mt-2.5 block h-6 w-[calc(100%-40px)] flex-none" viewBox="0 0 1064 24" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${ids}b`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f0cfa0" />
          <stop offset=".5" stopColor="#b98652" />
          <stop offset="1" stopColor="#6d4a2a" />
        </linearGradient>
        <linearGradient id={`${ids}v`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#8e2a20" />
          <stop offset="1" stopColor="#4a120d" />
        </linearGradient>
      </defs>
      <g fill="none" strokeLinecap="round">
        {xs.slice(1).map((x, i) => (
          <path key={i} d={`M${xs[i] + 1} 7 Q ${(xs[i] + x) / 2} 20 ${x - 1} 7`} stroke={`url(#${ids}v)`} strokeWidth="4" />
        ))}
      </g>
      <g fill={`url(#${ids}b)`}>
        {xs.map((x, i) => (
          <g key={i}>
            <rect x={x - 2.5} y="3" width="5" height="21" rx="2" />
            <circle cx={x} cy="4" r="4" />
          </g>
        ))}
      </g>
    </svg>
  );
}

export function PressLine({ campaign, productName, publish, waitlist, connectNote, onClose }: PressLineProps) {
  const { t, locale } = useLocale();
  const m = t.pressTour;
  const wide = useWide();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const campaignId = campaign.id;

  const [conns, setConns] = useState<ConnectionView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [posts, setPosts] = useState<PostView[]>([]);
  const [sheet, setSheet] = useState<TikTokSheetState | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  // Bumped by "Try again" under TikTok's own no (a public account, too many posts): TikTok is asked again.
  const [sheetTry, setSheetTry] = useState(0);
  const [drafts, setDrafts] = useState<Record<Network, NetDraft>>(() => {
    const now = new Date();
    return { x: newDraft(now), tiktok: newDraft(now), instagram: newDraft(now), threads: newDraft(now) };
  });
  const [previews, setPreviews] = useState<Partial<Record<Network, Preview>>>({});
  const [errors, setErrors] = useState<Partial<Record<Network, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [phase, setPhase] = useState<"compose" | "sent">("compose");
  const [sent, setSent] = useState<Network[]>([]);
  const [step, setStep] = useState(0);
  const [waitOn, setWaitOn] = useState<Network[]>([]);
  const [topError, setTopError] = useState<string | null>(null);
  const [note, setNote] = useState<ConnectNote | null>(connectNote);
  const seq = useRef<Record<string, number>>({});
  // One send id per network and approved post (its consent token): pressing
  // Post again after an answer was lost resends the SAME press, which the
  // server answers with the post it already queued (MONEY-3; the house
  // repeat-send pattern). A new token (anything changed) gets a new id; a
  // post that went through drops its id.
  const [sendIds, setSendIds] = useState<Partial<Record<Network, { token: string; id: string }>>>({});

  useBackCloser(true, onClose);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const server = useCallback((text: string | null | undefined) => (text ? localizeServerText(text, t) : null), [t]);
  const guard = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | null> => {
      try {
        return await work();
      } catch (err) {
        if (isStaleDeployError(err) && reloadForNewDeploy()) return null;
        setTopError(m.failed);
        return null;
      }
    },
    [m.failed],
  );

  // Every network's row, the ad's posts and the person's "tell me" list, once, on open.
  useEffect(() => {
    let live = true;
    void (async () => {
      const [c, p, w] = await Promise.all([
        publish.listConnections().catch(() => null),
        publish.listPosts({ campaignId }).catch(() => null),
        waitlist.readWaitlist().catch(() => null),
      ]);
      if (!live) return;
      if (c?.ok) setConns(c.connections);
      else setLoadError(c ? c.error : m.failed);
      if (p?.ok) setPosts(p.posts);
      if (w?.ok) setWaitOn(w.networks);
    })();
    return () => {
      live = false;
    };
  }, [publish, waitlist, campaignId, m.failed]);

  const tiktokConn = conns?.find((c) => c.network === "tiktok") ?? null;
  const tiktokReady = tiktokConn !== null && canCompose(tiktokConn);
  // TikTok's own answer about the account, read when its pit opens (and again by the server right before sending).
  useEffect(() => {
    if (!tiktokReady) return;
    let live = true;
    void (async () => {
      const res = await publish.prepareTikTokSheet({ campaignId }).catch(() => null);
      if (!live) return;
      if (res?.ok) {
        setSheet(res.sheet);
        setSheetError(res.sheet.blocker);
      } else setSheetError(res ? res.error : m.failed);
    })();
    return () => {
      live = false;
    };
  }, [tiktokReady, publish, campaignId, m.failed, sheetTry]);

  // While a post is going out, ask again for where it is.
  const anySending = posts.some((p) => p.phase === "sending");
  useEffect(() => {
    if (!anySending) return;
    const timer = setTimeout(async () => {
      const res = await publish.listPosts({ campaignId }).catch(() => null);
      if (res?.ok) setPosts(res.posts);
    }, 5000);
    return () => clearTimeout(timer);
  }, [anySending, posts, publish, campaignId]);

  const { open, soon } = useMemo(() => sheetColumns(conns ?? []), [conns]);
  const composable = useMemo(() => open.filter(canCompose).map((c) => c.network), [open]);
  const included = composable.filter((n) => !drafts[n].skip);

  const inputOf = useCallback(
    (net: Network): PostDraftInput & { when: PostWhen } => {
      const d = drafts[net];
      const at = d.when === "at" ? (localInputToIso(d.at) ?? (d.at || "invalid")) : "now";
      return {
        campaignId,
        network: net,
        caption: d.caption,
        hashtags: parseHashtags(d.tags),
        x: net === "x" ? { paidPartnership: d.paid } : null,
        tiktok: net === "tiktok" ? tiktokSent(d.tiktok) : null,
        when: net === "tiktok" ? "now" : at,
      };
    },
    [drafts, campaignId],
  );

  // Exactly what will post, asked again a moment after every edit.
  const inputs = useMemo(() => included.map((net) => [net, inputOf(net)] as const), [included, inputOf]);
  const inputsKey = JSON.stringify(inputs);
  useEffect(() => {
    const timers = inputs.map(([net, input]) => {
      const key = JSON.stringify(input);
      return setTimeout(async () => {
        const n = (seq.current[net] = (seq.current[net] ?? 0) + 1);
        const res = await publish.previewPost(input).catch((err: unknown) => {
          if (isStaleDeployError(err) && reloadForNewDeploy()) return null;
          return { ok: false as const, error: m.failed };
        });
        if (!res || seq.current[net] !== n) return;
        setPreviews((prev) => ({ ...prev, [net]: res.ok ? { key, draft: res.draft, error: null } : { key, draft: null, error: res.error } }));
      }, 450);
    });
    return () => timers.forEach(clearTimeout);
    // inputsKey carries every input's content; `inputs` is rebuilt on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputsKey, publish, m.failed]);

  const edit = (net: Network, patch: Partial<NetDraft>) => {
    setDrafts((prev) => ({ ...prev, [net]: { ...prev[net], ...patch } }));
    setErrors((prev) => ({ ...prev, [net]: undefined }));
  };
  const editTikTok = (patch: Partial<TikTokUi>) => setDrafts((prev) => ({ ...prev, tiktok: { ...prev.tiktok, tiktok: { ...prev.tiktok.tiktok, ...patch } } }));

  // What stops a network's Post, in plain words: the sheet's own rules first, then the engine's.
  const blockersOf = (net: Network): string[] => {
    const out: string[] = [];
    if (net === "tiktok") {
      for (const b of tiktokBlocks(drafts.tiktok.tiktok, sheet)) {
        if (b === "sheet") out.push(server(sheetError) ?? m.ttReading);
        else if (b === "privacy") out.push(m.ttNeedPrivacy);
        else if (b === "commercialPick") out.push(m.ttNeedCommercialPick);
        else out.push(m.ttNeedNotPrivate);
      }
    }
    const p = previews[net];
    const current = p && p.key === JSON.stringify(inputOf(net));
    if (!current) out.push(m.checkingPost);
    else if (p.error) out.push(server(p.error)!);
    // The engine's "Choose who can see this video." is the sheet's own privacy block above in other words: said once.
    else if (p.draft) for (const b of p.draft.blockers) if (!(net === "tiktok" && b === TIKTOK_PRIVACY_REQUIRED)) out.push(server(b)!);
    if (errors[net]) out.push(server(errors[net])!);
    return [...new Set(out)];
  };
  const ready = (net: Network) => {
    const p = previews[net];
    return blockersOf(net).length === 0 && !!p?.draft?.consentToken;
  };

  const whenWords = (iso: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const zone = zoneCity(typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : null);

  const postingRow = campaign.quote?.rows.find((r) => r.key === "posting") ?? null;
  const postingIncluded = postingRow !== null && postingRow.credits === 0;
  const tagged = renditionOf(campaign.master, "tagged");
  const clean = renditionOf(campaign.master, "clean");
  const poster = campaign.stills.find((x) => x.imageUrl)?.imageUrl ?? null;
  const seconds = tagged?.seconds ?? clean?.seconds ?? campaign.lengthSeconds;

  /** One network's sentence in the summary above the key. */
  const sentence = (net: Network): string => {
    const name = NETWORK_NAMES[net];
    if (net === "tiktok") return m.sumTikTok;
    const input = inputOf(net);
    return input.when !== "now" && localInputToIso(drafts[net].at) ? formatMsg(m.sumAt, { network: name, when: whenWords(input.when) }) : formatMsg(m.sumNow, { network: name });
  };

  async function send(nets: Network[]) {
    if (busy) return;
    setBusy("send");
    setTopError(null);
    const done: PostView[] = [];
    for (const net of nets) {
      const token = previews[net]?.draft?.consentToken;
      if (!token || !ready(net)) continue;
      const { when, ...draft } = inputOf(net);
      const held = sendIds[net]?.token === token ? sendIds[net]! : { token, id: crypto.randomUUID() };
      if (held !== sendIds[net]) setSendIds((prev) => ({ ...prev, [net]: held }));
      const meta = { sendId: held.id, consentToken: token, locale, uiVersion: PRESS_LINE_VERSION };
      const res = await guard(() => (when !== "now" ? publish.consentAndSchedule({ ...draft, ...meta, when }) : publish.consentAndPost({ ...draft, ...meta })));
      if (!res) continue;
      if (res.ok) {
        done.push(res.post);
        setSendIds((prev) => (prev[net]?.id === held.id ? { ...prev, [net]: undefined } : prev));
      } else setErrors((prev) => ({ ...prev, [net]: res.error }));
    }
    if (done.length > 0) {
      setPosts((prev) => [...done, ...prev.filter((p) => !done.some((d) => d.id === p.id))]);
      setSent((prev) => [...new Set([...prev, ...done.map((d) => d.network)])]);
    }
    setBusy(null);
    return done;
  }

  async function connect(net: Network) {
    setBusy(`connect:${net}`);
    const res = await guard(() => publish.connectStart({ network: net, returnTo: `/app/press-tour?campaign=${campaignId}` }));
    if (res?.ok) {
      window.location.assign(res.url);
      return;
    }
    if (res) setErrors((prev) => ({ ...prev, [net]: res.error }));
    setBusy(null);
  }

  async function disconnect(net: Network) {
    setBusy(`disconnect:${net}`);
    const res = await guard(() => publish.disconnect({ network: net }));
    if (res?.ok) setConns(res.connections);
    else if (res) setErrors((prev) => ({ ...prev, [net]: res.error }));
    setBusy(null);
  }

  async function cancelPost(post: PostView) {
    setBusy(`cancel:${post.id}`);
    const res = await guard(() => publish.cancelPost({ postId: post.id }));
    if (res?.ok) setPosts((prev) => prev.map((p) => (p.id === post.id ? res.post : p)));
    else if (res) setTopError(res.error);
    setBusy(null);
  }

  async function toggleWait(net: Network, on: boolean) {
    setBusy(`wait:${net}`);
    const res = await guard(() => waitlist.setWaitlist({ network: net, on }));
    if (res?.ok) setWaitOn(res.networks);
    else if (res) setTopError(res.error);
    setBusy(null);
  }

  // ── Pieces ────────────────────────────────────────────────────────────────

  const connectLine = note && (
    <p role="status" className={cn("mx-4 mt-2 rounded-xl px-3 py-2 text-[12.5px] leading-[1.4] ring-1 ring-inset md:mx-7", note.outcome === "connected" ? "bg-[rgba(240,196,142,0.06)] text-[#f0cda6] ring-[rgba(240,196,142,0.3)]" : "bg-[rgba(238,214,160,0.06)] text-[#eed6a0] ring-[rgba(238,214,160,0.25)]")}>
      {note.outcome === "connected"
        ? formatMsg(m.connectedNet, { network: NETWORK_NAMES[note.network] })
        : note.outcome === "denied"
          ? formatMsg(m.connectDenied, { network: NETWORK_NAMES[note.network] })
          : note.outcome === "expired"
            ? m.connectExpired
            : note.outcome === "session"
              ? m.connectSession
              : note.outcome === "closed"
                ? formatMsg(m.connectClosed, { network: NETWORK_NAMES[note.network] })
                : formatMsg(m.connectFailedNet, { network: NETWORK_NAMES[note.network] })}
      <button type="button" onClick={() => setNote(null)} className="ml-2 underline underline-offset-2">
        {m.dismiss}
      </button>
    </p>
  );

  const tagOf = (c: ConnectionView) =>
    c.status === "test_mode" ? (
      <span className={cn(s.tag, s.tagTest)}>{m.netPrivateTestMode}</span>
    ) : c.status === "connected" ? (
      <span className={cn(s.tag, s.tagReady)}>{m.netReady}</span>
    ) : c.status === "needs_reconnect" ? (
      <span className={cn(s.tag, s.tagTest)}>{m.reconnect}</span>
    ) : null;

  const pitHead = (c: ConnectionView) => (
    <h3 className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-[#ecedf1]">
      <span className={s.mark} aria-hidden="true">
        {NETWORK_MARKS[c.network]}
      </span>
      {NETWORK_NAMES[c.network]}
      {c.handle && <span className="truncate text-[12px] font-normal text-[#9aa0ad]">@{c.handle}</span>}
      <span className="ml-auto flex-none">{tagOf(c)}</span>
    </h3>
  );

  const previewBox = (net: Network) => {
    const d = previews[net]?.draft ?? null;
    const file = net === "tiktok" ? clean : tagged;
    const url = d?.videoUrl ?? file?.url ?? null;
    return (
      <span className="relative block aspect-[9/16] w-[86px] flex-none overflow-hidden rounded-[10px] bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.14),0_14px_22px_-12px_rgba(0,0,0,0.9)]">
        {url ? <PreviewVideo src={url} poster={d?.posterUrl ?? poster} label={formatMsg(m.previewLabel, { network: NETWORK_NAMES[net] })} /> : null}
        <span className="pointer-events-none absolute right-[5px] top-[5px] rounded bg-[rgba(0,0,0,0.6)] px-1 font-slate text-[9px] text-[#ecedf1]">
          {clockSeconds(d?.durationSeconds ?? seconds)}
        </span>
      </span>
    );
  };

  /**
   * The words that post, in one box as the artboards draw them: the caption,
   * and under it the hashtags line (their own field, since each network
   * counts them). Below it, the length the network's way and how many
   * hashtags it takes.
   */
  const captionBox = (net: Network) => {
    const d = previews[net]?.draft ?? null;
    const draft = drafts[net];
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-[108px] flex-1 flex-col rounded-xl bg-[rgba(255,255,255,0.03)] ring-1 ring-inset ring-[rgba(255,255,255,0.12)] focus-within:ring-[1.5px] focus-within:ring-[rgba(240,196,142,0.6)]">
          <label className="sr-only" htmlFor={`${titleId}-${net}-cap`}>
            {formatMsg(m.captionFor, { network: NETWORK_NAMES[net] })}
          </label>
          <textarea
            id={`${titleId}-${net}-cap`}
            value={draft.caption}
            onChange={(e) => edit(net, { caption: e.target.value })}
            rows={4}
            maxLength={2200}
            placeholder={m.captionPlaceholder}
            className="min-h-[64px] w-full flex-1 resize-none bg-transparent px-2.5 pb-1 pt-2 text-[13px] leading-[1.45] text-[#ecedf1] placeholder:text-[#62656e] focus:outline-none"
          />
          <label className="block px-2.5 pb-1.5">
            <span className="sr-only">{m.hashtags}</span>
            <input
              value={draft.tags}
              onChange={(e) => edit(net, { tags: e.target.value })}
              // Written back the way it posts ("#coldbrew #oatmilk"), so the box reads as the post.
              onBlur={() => {
                const tidy = parseHashtags(draft.tags).map((t) => `#${t}`).join(" ");
                if (tidy !== draft.tags) edit(net, { tags: tidy });
              }}
              placeholder={m.hashtagsPlaceholder}
              className="min-h-11 w-full bg-transparent text-[13px] text-[#d8b88f] placeholder:text-[#62656e] focus:outline-none lg:min-h-7"
              autoCapitalize="off"
              spellCheck={false}
            />
          </label>
        </div>
        <p className="mt-1 flex justify-between gap-2 text-[11px] text-[#858994]">
          <span>{m.editFreely}</span>
          {/* The count never breaks in two ("0 / 280"); the words beside it wrap first. */}
          <span className="flex-none whitespace-nowrap font-slate tabular-nums">
            {d && <span className="mr-2 font-sans">{formatMsg(m.hashtagLimit, { n: d.hashtagLimit })}</span>}
            {d ? `${d.textLength} / ${d.textLimit}` : `${draft.caption.length}`}
          </span>
        </p>
      </div>
    );
  };

  /**
   * The exact text that posts, when it is more than the box above shows: a
   * line Picacho adds (Threads' "Made with AI"), or words the network's rules
   * tidied. Caption and hashtags alone read in the box as they post.
   */
  const finalText = (net: Network) => {
    const d = previews[net]?.draft;
    if (!d) return null;
    const plain = [d.caption, d.hashtags.map((t) => `#${t}`).join(" ")].filter(Boolean).join("\n\n");
    if (d.finalText === plain) return null;
    return (
      <div>
        <p className={cn(LABEL, "mb-[5px]")}>{m.whatPosts}</p>
        <p className="whitespace-pre-wrap break-words rounded-xl bg-[rgba(0,0,0,0.2)] px-2.5 py-2 text-[12.5px] leading-[1.45] text-[#d8d2c8] ring-1 ring-inset ring-[rgba(255,255,255,0.06)]">{d.finalText}</p>
      </div>
    );
  };

  const whenBox = (net: Network) => {
    const d = previews[net]?.draft;
    if (net === "tiktok" || (d && !d.canSchedule)) return <p className="text-[11.5px] leading-[1.4] text-[#858994]">{m.postsOnPress}</p>;
    const draft = drafts[net];
    return (
      <div>
        <p className={cn(LABEL, "mb-[5px] flex justify-between gap-2")}>
          <span id={`${titleId}-${net}-when`}>{m.when}</span>
          {zone && <span className="normal-case tracking-normal">{formatMsg(m.zoneTime, { zone })}</span>}
        </p>
        <div role="radiogroup" aria-labelledby={`${titleId}-${net}-when`} className="grid grid-cols-2 rounded-[11px] bg-[rgba(255,255,255,0.04)] p-[3px] ring-1 ring-inset ring-[rgba(255,255,255,0.08)]">
          {(["now", "at"] as const).map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={draft.when === w}
              onClick={() => edit(net, { when: w })}
              className={cn(
                "min-h-11 rounded-lg text-[12.5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] lg:min-h-8",
                draft.when === w ? "bg-[rgba(255,255,255,0.08)] font-medium text-[#ecedf1]" : "text-[#9aa0ad]",
              )}
            >
              {w === "now" ? m.whenNow : m.whenLater}
            </button>
          ))}
        </div>
        {draft.when === "at" && (
          <label className="mt-2 flex items-center gap-2 rounded-xl bg-[rgba(255,255,255,0.03)] px-2.5 ring-1 ring-inset ring-[rgba(255,255,255,0.12)] focus-within:ring-[rgba(240,196,142,0.6)]">
            <CalendarIcon className="h-3.5 w-3.5 flex-none text-[#9aa0ad]" />
            <span className="sr-only">{m.whenPick}</span>
            <input
              type="datetime-local"
              value={draft.at}
              onChange={(e) => edit(net, { at: e.target.value })}
              className="min-h-11 flex-1 bg-transparent text-[13px] text-[#ecedf1] [color-scheme:dark] focus:outline-none lg:min-h-9"
            />
          </label>
        )}
      </div>
    );
  };

  const aiRow = (net: Network) => {
    const title = net === "tiktok" ? m.ttAiTitle : net === "x" ? m.xAiTitle : m.aiLabelTitle;
    const noteWords = net === "tiktok" ? m.ttAiNote : net === "x" ? m.xAiNote : net === "threads" ? m.threadsAiNote : m.igAiNote;
    return (
      <Opt title={title} note={noteWords}>
        <span className="flex items-center gap-1.5">
          <ShieldIcon className="mt-0.5 h-3 w-3 text-[#858994]" />
          <Switch on label={formatMsg(m.alwaysOnLabel, { label: title })} locked />
        </span>
      </Opt>
    );
  };

  const blockerList = (net: Network) => {
    // "Who can see this" says Required on the field itself (and the key's line says it): not a third time here.
    const list = blockersOf(net).filter((b) => b !== m.checkingPost && b !== m.ttNeedPrivacy);
    if (list.length === 0) return null;
    return (
      <ul className="space-y-1">
        {list.map((b) => (
          <li key={b} className={s.blocker}>
            {b}
          </li>
        ))}
      </ul>
    );
  };

  // When TikTok itself says no (the account is public, it asked us to slow down, test posting is full for the day), the
  // way on (states board: "Try again", "Save for TikTok"): ask TikTok again, or take the TikTok file and post it there.
  const tiktokStuck = () => {
    const full = previews.tiktok?.draft?.blockers.includes(TIKTOK_TEST_FULL) ?? false;
    const save = clean !== null && (sheetError !== null || full);
    if (sheetError === null && !save) return null;
    return (
      <p className="flex flex-wrap gap-2">
        {sheetError && (
          <button
            type="button"
            onClick={() => {
              setSheet(null);
              setSheetError(null);
              setSheetTry((n) => n + 1);
            }}
            className={GHOST}
          >
            {t.errors.tryAgain}
          </button>
        )}
        {save && clean && (
          <a href={downloadUrl(clean.url, adFileName(productName, "clean"))} download={adFileName(productName, "clean")} className={GHOST}>
            <DownloadIcon className="h-3.5 w-3.5" />
            {m.saveForTikTok}
          </a>
        )}
        {/* Posted by hand, the file carries no label of its own: the person turns TikTok's on (PT-R3-02). */}
        {save && clean && <span className="basis-full text-[11.5px] leading-[1.42] text-[#858994]">{m.saveForTikTokNote}</span>}
      </p>
    );
  };

  const tiktokBody = () => {
    const ui = drafts.tiktok.tiktok;
    const test = sheet?.testMode ?? tiktokConn?.testMode ?? false;
    const interactionOff = sheet ? sheet.commentDisabled || sheet.duetDisabled || sheet.stitchDisabled : false;
    return (
      <>
        {test && <p className={s.banner}>{fill(m.ttTestBanner, { b: <b className="font-semibold text-[#eed6a0]">{m.ttTestLead}</b> })}</p>}
        {sheet ? (
          <p className="flex items-center gap-2 text-[12.5px] text-[#ecedf1]">
            <AccountPicture key={sheet.avatarUrl ?? ""} src={sheet.avatarUrl} />
            <span className="truncate">{sheet.nickname}</span>
            <span className="truncate text-[11.5px] text-[#858994]">@{sheet.username}</span>
            <span className={cn(LABEL, "ml-auto flex-none")}>{m.postingAs}</span>
          </p>
        ) : (
          <p className="text-[12px] text-[#9aa0ad]">{server(sheetError) ?? m.ttReading}</p>
        )}
        <div className="flex gap-2.5">
          {previewBox("tiktok")}
          {captionBox("tiktok")}
        </div>
        {finalText("tiktok")}
        <div>
          <p className={cn(LABEL, "mb-[5px] flex justify-between")}>
            <label htmlFor={`${titleId}-tt-who`}>{m.ttWho}</label>
            <span className={ui.privacy ? undefined : "text-[#e6c46e]"}>{ui.privacy ? m.chosen : m.required}</span>
          </p>
          <select
            id={`${titleId}-tt-who`}
            value={ui.privacy ?? ""}
            onChange={(e) => editTikTok({ privacy: (e.target.value || null) as TikTokUi["privacy"] })}
            disabled={!sheet}
            className={cn(FIELD, "min-h-11 appearance-auto lg:min-h-9", ui.privacy ? s.chosen : s.need)}
          >
            <option value="" disabled>
              {m.ttChoose}
            </option>
            {(sheet?.privacyOptions ?? []).map((p) => (
              <option key={p} value={p} disabled={p === "SELF_ONLY" && ui.commercial && ui.brandedContent} className="bg-[#16130f]">
                {p === "SELF_ONLY" ? m.ttOnlyMe : p === "FOLLOWER_OF_CREATOR" ? m.ttFollowers : p === "MUTUAL_FOLLOW_FRIENDS" ? m.ttFriends : m.ttEveryone}
              </option>
            ))}
          </select>
          {test && <p className="mt-[5px] text-[11.5px] leading-[1.38] text-[#9aa0ad]">{server(TIKTOK_TEST_ONLY_ME)}</p>}
        </div>
        <fieldset>
          <legend className={cn(LABEL, "mb-[5px]")}>{m.ttAllow}</legend>
          <div className="flex flex-wrap gap-x-4">
            {(
              [
                ["allowComment", m.ttComment, sheet?.commentDisabled ?? true],
                ["allowDuet", m.ttDuet, sheet?.duetDisabled ?? true],
                ["allowStitch", m.ttStitch, sheet?.stitchDisabled ?? true],
              ] as const
            ).map(([key, word, off]) => (
              <label key={key} className={cn("flex min-h-11 items-center gap-2 text-[13px] text-[#c6c9d1] lg:min-h-7", off && "opacity-50")}>
                <TickBox checked={!off && ui[key]} disabled={off} onChange={(v) => editTikTok({ [key]: v } as Partial<TikTokUi>)} />
                {word}
              </label>
            ))}
          </div>
          {interactionOff && <p className="text-[11.5px] leading-[1.38] text-[#858994]">{server(TIKTOK_INTERACTION_OFF)}</p>}
        </fieldset>
        <div className="pt-[9px] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <Opt title={m.ttCommercial} note={ui.commercial ? m.ttCommercialHelp : `${m.ttCommercialOff} ${m.ttCommercialHelp}`}>
            <Switch on={ui.commercial} onChange={(v) => editTikTok({ commercial: v })} label={m.ttCommercial} />
          </Opt>
          <div className={cn("mt-[7px] flex flex-col gap-1.5 rounded-[10px] bg-[rgba(255,255,255,0.025)] px-2.5 py-1.5 lg:gap-0 lg:py-1", !ui.commercial && "opacity-60")}>
            <label className="flex min-h-11 items-center gap-2 text-[13px] text-[#c6c9d1] lg:min-h-7">
              <TickBox checked={ui.commercial && ui.yourBrand} disabled={!ui.commercial} onChange={(v) => editTikTok({ yourBrand: v })} />
              {m.ttYourBrand}
              <small className="text-[11.5px] text-[#858994]">· {m.ttYourBrandNote}</small>
            </label>
            <label className={cn("flex min-h-11 items-center gap-2 text-[13px] text-[#c6c9d1] lg:min-h-7", sheet && !sheet.brandedContentAvailable && "opacity-50")}>
              <TickBox
                checked={ui.commercial && ui.brandedContent}
                disabled={!ui.commercial || !sheet || !sheet.brandedContentAvailable}
                onChange={(v) => editTikTok({ brandedContent: v })}
              />
              {m.ttBranded}
              <small className="text-[11.5px] text-[#858994]">· {sheet && !sheet.brandedContentAvailable ? m.ttNotInTest : m.ttBrandedNote}</small>
            </label>
          </div>
        </div>
        {aiRow("tiktok")}
        <p className="text-[11.5px] leading-[1.42] text-[#858994]">
          {fill(ui.commercial && ui.brandedContent ? m.ttDeclarationBranded : m.ttDeclaration, {
            music: (
              <a href={MUSIC_URL} target="_blank" rel="noopener noreferrer" className="text-[#9aa0ad] underline decoration-[rgba(255,255,255,0.25)] underline-offset-2">
                {m.ttMusicLink}
              </a>
            ),
            policy: (
              <a href={BRANDED_URL} target="_blank" rel="noopener noreferrer" className="text-[#9aa0ad] underline decoration-[rgba(255,255,255,0.25)] underline-offset-2">
                {m.ttPolicyLink}
              </a>
            ),
          })}
        </p>
        {whenBox("tiktok")}
      </>
    );
  };

  const xBody = () => {
    const d = previews.x?.draft ?? null;
    return (
      <>
        <div className="flex gap-2.5">
          {previewBox("x")}
          {captionBox("x")}
        </div>
        {finalText("x")}
        <p className="text-[11.5px] leading-[1.4] text-[#9aa0ad]">{server(d?.x?.linkNote) ?? m.xLinkInBio}</p>
        <Opt title={m.xPaid} note={m.xPaidNote}>
          <Switch on={drafts.x.paid} onChange={(v) => edit("x", { paid: v })} label={m.xPaid} />
        </Opt>
        {aiRow("x")}
        <p className="pt-[9px] text-[11.5px] leading-[1.42] text-[#858994] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">{m.xOwnWords}</p>
        {whenBox("x")}
      </>
    );
  };

  const metaBody = (net: Network) => (
    <>
      <div className="flex gap-2.5">
        {previewBox(net)}
        {captionBox(net)}
      </div>
      {finalText(net)}
      {aiRow(net)}
      {whenBox(net)}
    </>
  );

  /** A network's pit, whatever its state: compose, connect, reconnect. */
  const pitBody = (c: ConnectionView) => {
    const net = c.network;
    if (canCompose(c)) {
      return (
        <>
          {/* What stops this post leads the pit (states: "TikTok · account is public"), never below its fold. */}
          {!drafts[net].skip && blockerList(net)}
          {/* A shot that missed the product is still in this cut (PT-R3-05): said, never blocking. */}
          {!drafts[net].skip && previews[net]?.draft?.cutWarning && <p className={s.banner}>{server(previews[net]?.draft?.cutWarning)}</p>}
          {net === "tiktok" && !drafts.tiktok.skip && tiktokStuck()}
          {drafts[net].skip ? (
            <p className="text-[12.5px] leading-[1.45] text-[#9aa0ad]">{formatMsg(m.leftOutBody, { network: NETWORK_NAMES[net] })}</p>
          ) : net === "tiktok" ? (
            tiktokBody()
          ) : net === "x" ? (
            xBody()
          ) : (
            metaBody(net)
          )}
          <p className="mt-auto flex flex-wrap gap-x-4 pt-1">
            <button type="button" onClick={() => edit(net, { skip: !drafts[net].skip })} className={QUIET}>
              {drafts[net].skip ? formatMsg(m.putBackNet, { network: NETWORK_NAMES[net] }) : formatMsg(m.leaveOut, { network: NETWORK_NAMES[net] })}
            </button>
            <button type="button" onClick={() => void disconnect(net)} disabled={busy !== null} className={QUIET}>
              {busy === `disconnect:${net}` ? m.disconnecting : m.disconnect}
            </button>
          </p>
        </>
      );
    }
    const needs = c.status === "needs_reconnect";
    const canGo = c.canConnect && !c.webOnly;
    return (
      <>
        <p className="text-[12.5px] leading-[1.45] text-[#c6c9d1]">
          {needs ? formatMsg(m.reconnectBody, { network: NETWORK_NAMES[net] }) : formatMsg(m.connectBody, { network: NETWORK_NAMES[net] })}
        </p>
        {c.webOnly ? (
          <p className="text-[12px] leading-[1.42] text-[#9aa0ad]">{server(c.note) ?? server(CONNECT_ON_COMPUTER)}</p>
        ) : c.note ? (
          <p className="text-[12px] leading-[1.42] text-[#9aa0ad]">{server(c.note)}</p>
        ) : null}
        {canGo && (
          <button type="button" onClick={() => void connect(net)} disabled={busy !== null} className={cn(needs ? s.keepKey : GHOST, "self-start")}>
            {busy === `connect:${net}` ? m.connecting : formatMsg(needs ? m.reconnectNet : m.connectNet, { network: NETWORK_NAMES[net] })}
          </button>
        )}
        {errors[net] && <p className={s.blocker}>{server(errors[net])}</p>}
      </>
    );
  };

  const saveLink = (className?: string) =>
    tagged && (
      <a href={downloadUrl(tagged.url, adFileName(productName, "tagged"))} download={adFileName(productName, "tagged")} className={cn(GHOST, className)}>
        <DownloadIcon className="h-3.5 w-3.5" />
        {m.saveAd}
      </a>
    );

  const soonPit = soon.length > 0 && (
    <div className={cn(s.pit, s.pitDim)} aria-labelledby={`${titleId}-soon`}>
      <div className={s.pitScroll}>
        {/* The networks by name (publish-desktop: "Ig Instagram · Coming soon"); the tag says when. */}
        <h3 id={`${titleId}-soon`} className="flex min-w-0 items-center gap-2 text-[14px] font-semibold text-[#ecedf1]">
          {soon.length === 1 && (
            <span className={s.mark} aria-hidden="true">
              {NETWORK_MARKS[soon[0].network]}
            </span>
          )}
          <span className="min-w-0 truncate">{soon.map((c) => NETWORK_NAMES[c.network]).join(" · ")}</span>
          <span className={cn(s.tag, s.tagSoon, "ml-auto flex-none")}>{m.netSoon}</span>
        </h3>
        <div className="flex gap-2.5">
          <span className={cn(s.pitPoster, "relative block aspect-[9/16] w-[86px] flex-none overflow-hidden rounded-[10px] shadow-[0_0_0_1px_rgba(255,255,255,0.14)]")}>
            {poster && (
              // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to the person's own still
              <img src={poster} alt="" className="h-full w-full object-cover" />
            )}
            <span className="absolute inset-0 grid place-items-center bg-[rgba(8,7,6,0.62)]">
              <span className={s.soonChip}>{m.soonChip}</span>
            </span>
          </span>
          <div className="flex min-w-0 flex-col justify-center gap-1.5">
            {soon.map((c) => (
              <p key={c.network} className="text-[13px] font-semibold leading-[1.3] text-[#ecedf1]">
                {formatMsg(m.soonTitle, { network: NETWORK_NAMES[c.network] })}
              </p>
            ))}
            <p className="text-[12px] leading-[1.42] text-[#9aa0ad]">{m.soonBody}</p>
          </div>
        </div>
        {saveLink("self-start")}
        {soon.map((c) => (
          <Opt key={c.network} title={formatMsg(m.tellMeWhen, { network: NETWORK_NAMES[c.network] })} note={m.oneEmail}>
            <Switch on={waitOn.includes(c.network)} onChange={(v) => void toggleWait(c.network, v)} label={formatMsg(m.tellMeWhen, { network: NETWORK_NAMES[c.network] })} />
          </Opt>
        ))}
      </div>
    </div>
  );

  // ── The rows of what went out ───────────────────────────────────────────

  const postRow = (p: PostView) => {
    const conn = conns?.find((c) => c.network === p.network) ?? null;
    const link = p.phase === "posted" ? safePermalink(p.permalink) : null;
    const profile = p.message === POST_UNCONFIRMED ? profileUrl(p.network, p.handle) : null;
    const status =
      p.phase === "scheduled" && p.scheduledFor
        ? formatMsg(m.rowScheduled, { when: whenWords(p.scheduledFor) })
        : p.phase === "sending"
          ? m.rowSending
          : p.phase === "posted"
            ? p.publishedAt
              ? formatMsg(m.rowPosted, { when: whenWords(p.publishedAt) })
              : m.rowPostedNow
            : (server(p.message) ?? (p.phase === "needs_you" ? m.rowNeedsYou : m.rowStopped));
    return (
      <li key={p.id} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-2.5 px-3 py-[11px] [&+&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <span className={s.mark} aria-hidden="true">
          {NETWORK_MARKS[p.network]}
        </span>
        <div className="min-w-0">
          <b className="text-[13.5px] font-semibold text-[#ecedf1]">
            {NETWORK_NAMES[p.network]}
            {p.handle && <span className="ml-1.5 text-[12px] font-normal text-[#9aa0ad]">@{p.handle}</span>}
          </b>
          <small className={cn("mt-0.5 block text-[12px] leading-[1.38]", p.phase === "posted" ? "text-[#f0cda6]" : p.phase === "needs_you" ? "text-[#eed6a0]" : "text-[#9aa0ad]")}>
            {status}
            {p.phase === "posted" && p.network === "tiktok" && conn?.testMode && ` ${m.ttOnlyYou}`}
          </small>
        </div>
        <span className="flex flex-wrap justify-end gap-1.5">
          {p.canCancel && (
            <button type="button" onClick={() => void cancelPost(p)} disabled={busy !== null} className={GHOST}>
              {busy === `cancel:${p.id}` ? m.cancelling : m.cancelPost}
            </button>
          )}
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className={GHOST}>
              {m.openPost}
            </a>
          )}
          {profile && (
            <a href={profile} target="_blank" rel="noopener noreferrer" className={GHOST}>
              {formatMsg(m.openProfile, { network: NETWORK_NAMES[p.network] })}
            </a>
          )}
          {p.stage === "needs_reconnect" && conn?.canConnect && !conn.webOnly && (
            <button type="button" onClick={() => void connect(p.network)} disabled={busy !== null} className={GHOST}>
              {formatMsg(m.reconnectNet, { network: NETWORK_NAMES[p.network] })}
            </button>
          )}
        </span>
      </li>
    );
  };

  const postList = (list: PostView[]) =>
    list.length > 0 && (
      <ul aria-label={m.onTheLine} className="rounded-[14px] ring-1 ring-inset ring-[rgba(255,255,255,0.09)]">
        {postsNewestFirst(list).map(postRow)}
        {phase === "sent" &&
          soon.map((c) => (
            <li key={c.network} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-2.5 px-3 py-[11px] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <span className={s.mark} aria-hidden="true">
                {NETWORK_MARKS[c.network]}
              </span>
              <div className="min-w-0">
                <b className="text-[13.5px] font-semibold text-[#ecedf1]">{NETWORK_NAMES[c.network]}</b>
                <small className="mt-0.5 block text-[12px] leading-[1.38] text-[#9aa0ad]">{m.rowSoon}</small>
              </div>
              {saveLink()}
            </li>
          ))}
      </ul>
    );

  // ── The summary above the key, and the key ─────────────────────────────

  const firstBlock = included.length === 0 ? m.sumNothing : (included.map((n) => blockersOf(n)[0]).find(Boolean) ?? null);
  const canSend = included.length > 0 && included.every(ready) && busy === null;
  const scheduledOnly = included.length === 1 && inputOf(included[0]).when !== "now";
  const keyLabel =
    included.length === 1
      ? formatMsg(scheduledOnly ? m.scheduleOn : m.postTo, { network: NETWORK_NAMES[included[0]] })
      : formatMsg(m.postToMany, { n: included.length });

  /** A phone's next step: the next network, or what went out once there is none. */
  const advance = () => {
    if (step + 1 < composable.length) setStep(step + 1);
    else setPhase("sent");
  };

  const sendKey = (nets: Network[], label: string, blocker: string | null, enabled: boolean) => {
    const id = `${titleId}-block-${nets.join("-")}`;
    return (
      <>
        {blocker && (
          <p id={id} className={s.blocker}>
            {blocker}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            if (!enabled) return;
            void send(nets).then((done) => {
              if (!done || done.length === 0) return;
              if (wide) setPhase("sent");
              else advance();
            });
          }}
          aria-disabled={!enabled}
          aria-describedby={blocker ? id : undefined}
          className={s.key}
        >
          {busy === "send" ? m.sending : label}
          <SendIcon />
        </button>
      </>
    );
  };

  // ── Layout ─────────────────────────────────────────────────────────────

  const head = (
    <header className="relative z-[1] flex items-start justify-between gap-3 px-4 pt-3 md:px-7 md:pt-5">
      <div className="min-w-0">
        {/* One line: the product's name gives way, never a number; a phone leaves out "Final cut" (publish-phone). */}
        <p className={cn(LABEL, "flex min-w-0 items-baseline gap-[0.6em] whitespace-nowrap")}>
          <span className="min-w-0 truncate">{productName || m.untitledProduct}</span>
          {wide && (
            <>
              <span aria-hidden="true">·</span>
              <span>{m.finalCut}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span>{formatMsg(m.lengthSeconds, { n: Math.round(seconds) })}</span>
          <span aria-hidden="true">·</span>
          <span>9:16</span>
        </p>
        <h2 id={titleId} className="marquee mt-1.5 bg-[linear-gradient(180deg,#fbf6ee_18%,#b9ad9c_100%)] bg-clip-text text-[20px] leading-none text-transparent md:text-[24px]">
          {m.lineTitle}
        </h2>
        {wide && <p className="mt-2 text-[13.5px] text-[#9aa0ad]">{m.lineSub}</p>}
      </div>
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label={m.close}
        className="-mr-1 grid h-11 w-11 flex-none place-items-center rounded-full text-[#a89f92] ring-1 ring-inset ring-[rgba(255,255,255,0.1)] hover:text-[#ecedf1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6]"
      >
        <CloseIcon />
      </button>
    </header>
  );

  const loading = conns === null && loadError === null;
  const topLines = (
    <>
      {connectLine}
      {(loadError || topError) && (
        <p role="alert" className="mx-4 mt-2 text-[12.5px] leading-[1.4] text-[#eed6a0] md:mx-7">
          {server(loadError ?? topError)}
        </p>
      )}
    </>
  );

  const afterPanel = (
    <div className="flex flex-col gap-3">
      <div role="status" className="flex items-start gap-3 rounded-[14px] bg-[rgba(240,196,142,0.06)] p-3 ring-1 ring-inset ring-[rgba(240,196,142,0.3)]">
        <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-full bg-[rgba(240,196,142,0.16)] text-[#f0cda6]">
          <CheckIcon className="h-[17px] w-[17px]" />
        </span>
        <div>
          <h3 className="text-[16px] font-semibold text-[#ecedf1]">
            {sent.length === 1 ? formatMsg(m.sentTo, { network: NETWORK_NAMES[sent[0]] }) : m.sentMany}
          </h3>
          <p className="mt-[3px] text-[12.5px] leading-[1.45] text-[#9aa0ad]">
            {sent.includes("tiktok") ? (tiktokConn?.testMode ? `${m.ttSentBody} ${m.ttSentTest}` : m.ttSentBody) : m.sentBody}
          </p>
        </div>
      </div>
      {postList(posts)}
      <p className="text-[12px] leading-[1.45] text-[#858994]">{m.afterNote}</p>
    </div>
  );

  let body: ReactNode;
  let foot: ReactNode;
  if (loading) {
    body = <p className="px-4 py-6 text-[13px] text-[#9aa0ad] md:px-7">{m.lineLoading}</p>;
    foot = null;
  } else if (phase === "sent") {
    body = <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 md:px-7">{afterPanel}</div>;
    foot = (
      <div className="flex flex-col gap-2 lg:flex-row-reverse lg:items-center lg:gap-5">
        <div className="lg:w-[300px]">
          <button type="button" onClick={onClose} className={s.key}>
            {m.done}
          </button>
        </div>
        <button type="button" onClick={() => setPhase("compose")} className={cn(QUIET, "justify-center")}>
          {m.backToLine}
        </button>
      </div>
    );
  } else if (wide) {
    const weights = [...open.map((c) => (c.network === "tiktok" ? 1.3 : 1)), ...(soon.length > 0 ? [0.86] : [])];
    body = (
      <>
        <div className="mx-7 mt-3 flex gap-2.5">
          <p className="flex flex-1 items-center gap-[9px] rounded-xl bg-[rgba(255,255,255,0.03)] px-3 py-2 text-[12.5px] text-[#c6c9d1] ring-1 ring-inset ring-[rgba(255,255,255,0.08)]">
            <ShieldIcon className="h-[15px] w-[15px] flex-none text-[#f0cda6]" />
            <span>{fill(m.lineAiLabel, { b: <b className="font-semibold text-[#ecedf1]">{m.lineAiLabelLead}</b> })}</span>
          </p>
          <p className="flex flex-1 items-center gap-[9px] rounded-xl bg-[rgba(255,255,255,0.03)] px-3 py-2 text-[12.5px] text-[#c6c9d1] ring-1 ring-inset ring-[rgba(255,255,255,0.08)]">
            <EyeIcon className="h-[15px] w-[15px] flex-none text-[#f0cda6]" />
            <span>{m.lineExact}</span>
          </p>
        </div>
        {posts.length > 0 && <div className="mx-7 mt-3">{postList(posts)}</div>}
        {weights.length > 0 && <Rope weights={weights} />}
        <div className="grid min-h-0 flex-1 gap-3.5 px-7" style={{ gridTemplateColumns: weights.map((w) => `minmax(0, ${w}fr)`).join(" ") }}>
          {open.map((c) => (
            <div key={c.network} className={s.pit} aria-labelledby={`${titleId}-${c.network}-h`}>
              <div className={s.pitScroll} id={`${titleId}-${c.network}-h`}>
                {pitHead(c)}
                {pitBody(c)}
              </div>
            </div>
          ))}
          {soonPit}
        </div>
      </>
    );
    foot = (
      <div className="flex items-center gap-[18px]">
        <div className="min-w-0 flex-1 text-[12.5px] leading-[1.5] text-[#9aa0ad]">
          <p>
            <b className="font-semibold text-[#ecedf1]">{m.sumLead}</b> {included.map(sentence).join(" ")} {postingIncluded && <span className="text-[#858994]">{m.sumIncluded}</span>}
          </p>
        </div>
        <div className="flex w-[300px] flex-none flex-col gap-1.5">{sendKey(included, keyLabel, firstBlock, canSend)}</div>
      </div>
    );
  } else {
    // A phone: one network per step. The steps are the networks that can take a post now.
    const current = composable[Math.min(step, Math.max(0, composable.length - 1))] ?? null;
    const stepWords = (net: Network, i: number) => {
      const post = posts.find((p) => p.network === net && sent.includes(net));
      if (post) return post.phase === "scheduled" && post.scheduledFor ? formatMsg(m.stepScheduled, { when: whenWords(post.scheduledFor) }) : m.stepSent;
      if (drafts[net].skip && i < step) return m.stepSkipped;
      // Says what the step will do as it is set now: "when I press Post" is the default for every network.
      return net === "tiktok" || drafts[net].when === "now" ? m.stepOnPress : m.stepYourTime;
    };
    body = (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {composable.length > 0 && (
          <ol aria-label={m.oneAtATime} className="mx-4 mt-2.5 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${composable.length}, minmax(0, 1fr))` }}>
            {composable.map((net, i) => (
              <li
                key={net}
                aria-current={net === current ? "step" : undefined}
                className={cn(
                  "rounded-[10px] px-2.5 py-[7px] text-[12px] leading-[1.3] text-[#9aa0ad]",
                  net === current ? "bg-[rgba(240,196,142,0.05)] shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.7)]" : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]",
                )}
              >
                <b className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#ecedf1]">
                  {sent.includes(net) && <CheckIcon className="h-[13px] w-[13px] text-[#f0cda6]" />}
                  {`${i + 1} · ${NETWORK_NAMES[net]}`}
                </b>
                {stepWords(net, i)}
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-col gap-[11px] px-4 py-3">
          {posts.length > 0 && postList(posts)}
          {current ? (
            <>
              {pitHead(open.find((c) => c.network === current)!)}
              {pitBody(open.find((c) => c.network === current)!)}
            </>
          ) : null}
          {open
            .filter((c) => !canCompose(c))
            .map((c) => (
              <div key={c.network} className="rounded-[14px] p-3 ring-1 ring-inset ring-[rgba(255,255,255,0.09)]">
                {pitHead(c)}
                <div className="mt-2 flex flex-col gap-2">{pitBody(c)}</div>
              </div>
            ))}
          {soonPit}
        </div>
      </div>
    );
    foot = current ? (
      <>
        <p className="mb-2 text-[12px] leading-[1.45] text-[#9aa0ad]">
          <b className="font-semibold text-[#ecedf1]">{formatMsg(m.sumLeadOn, { network: NETWORK_NAMES[current] })}</b> {sentence(current)}{" "}
          {postingIncluded && m.sumIncluded}
        </p>
        {sent.includes(current) ? (
          <button type="button" onClick={advance} className={s.key}>
            {m.nextStep}
          </button>
        ) : drafts[current].skip ? (
          <button type="button" onClick={advance} className={s.key}>
            {m.nextStep}
          </button>
        ) : (
          sendKey(
            [current],
            formatMsg(inputOf(current).when !== "now" ? m.scheduleOn : m.postTo, { network: NETWORK_NAMES[current] }),
            blockersOf(current)[0] ?? null,
            ready(current) && busy === null,
          )
        )}
        {!sent.includes(current) && (
          <button
            type="button"
            onClick={() => {
              edit(current, { skip: true });
              advance();
            }}
            className={cn(QUIET, "mt-1 w-full justify-center")}
          >
            {formatMsg(m.skipNet, { network: NETWORK_NAMES[current] })}
          </button>
        )}
      </>
    ) : (
      <button type="button" onClick={onClose} className={s.key}>
        {m.done}
      </button>
    );
  }

  return (
    <div className={s.house}>
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className={s.sheet}>
        <div className={s.rig} aria-hidden="true">
          <i style={{ left: 140, width: 300, top: -80, height: 260 }} />
          <i style={{ left: 400, width: 300, top: -80, height: 260 }} />
          <i style={{ left: 660, width: 300, top: -80, height: 260 }} />
        </div>
        {head}
        {topLines}
        {body}
        {foot && (
          <footer className="relative z-[1] mt-3 flex-none bg-[#110f0c] px-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-2.5 shadow-[inset_0_1px_0_rgba(243,237,228,0.08)] md:px-7 md:pb-[18px] md:pt-3.5 lg:bg-transparent">
            {foot}
          </footer>
        )}
      </section>
    </div>
  );
}

/**
 * The accounts Press Tour posts to, at the foot of the door (spec §3.1
 * "Connections", web only): each network's state, Connect where it can be
 * connected here, and Disconnect for one that is (its posts not yet out are
 * cancelled and its keys revoked and deleted). Read when opened; opened on
 * its own when a connect answers back and the press line isn't showing.
 */
export function PostingAccounts({ publish, campaignId, connectNote }: { publish: PublishActions; campaignId: string | null; connectNote: ConnectNote | null }) {
  const { t } = useLocale();
  const m = t.pressTour;
  const ids = useId();
  const [open, setOpen] = useState(connectNote !== null);
  const [conns, setConns] = useState<ConnectionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<ConnectNote | null>(connectNote);
  const server = (text: string | null | undefined) => (text ? localizeServerText(text, t) : null);

  useEffect(() => {
    if (!open || conns) return;
    let live = true;
    void (async () => {
      const res = await publish.listConnections().catch(() => null);
      if (!live) return;
      if (res?.ok) setConns(res.connections);
      else setError(res ? res.error : m.failed);
    })();
    return () => {
      live = false;
    };
  }, [open, conns, publish, m.failed]);

  async function act(net: Network, what: "connect" | "disconnect") {
    setBusy(`${what}:${net}`);
    setError(null);
    try {
      if (what === "connect") {
        const res = await publish.connectStart({ network: net, returnTo: campaignId ? `/app/press-tour?campaign=${campaignId}` : "/app/press-tour" });
        if (res.ok) {
          window.location.assign(res.url);
          return;
        }
        setError(res.error);
      } else {
        const res = await publish.disconnect({ network: net });
        if (res.ok) setConns(res.connections);
        else setError(res.error);
      }
    } catch (err) {
      if (isStaleDeployError(err) && reloadForNewDeploy()) return;
      setError(m.failed);
    }
    setBusy(null);
  }

  const status = (c: ConnectionView) =>
    c.status === "connected"
      ? `@${c.handle ?? ""}`
      : c.status === "test_mode"
        ? `@${c.handle ?? ""} · ${m.netPrivateTestMode}`
        : c.status === "needs_reconnect"
          ? m.reconnect
          : c.status === "coming_soon"
            ? m.netSoon
            : m.notConnected;

  return (
    <section aria-labelledby={`${ids}-h`} className="mt-6 pt-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
      <button
        type="button"
        id={`${ids}-h`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`${ids}-list`}
        className="inline-flex min-h-11 items-center gap-2 font-slate text-[11px] font-medium uppercase tracking-[0.12em] text-[#858994] hover:text-[#c6c9d1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6]"
      >
        {m.postingAccounts}
        <span aria-hidden="true">{open ? "–" : "+"}</span>
      </button>
      {open && (
        <div id={`${ids}-list`} className="mt-1 max-w-[560px]">
          <p className="text-[12px] leading-[1.45] text-[#9aa0ad]">{m.postingAccountsHint}</p>
          {note && (
            <p role="status" className="mt-2 text-[12.5px] text-[#f0cda6]">
              {note.outcome === "connected"
                ? formatMsg(m.connectedNet, { network: NETWORK_NAMES[note.network] })
                : note.outcome === "denied"
                  ? formatMsg(m.connectDenied, { network: NETWORK_NAMES[note.network] })
                  : note.outcome === "expired"
                    ? m.connectExpired
                    : note.outcome === "session"
                      ? m.connectSession
                      : note.outcome === "closed"
                        ? formatMsg(m.connectClosed, { network: NETWORK_NAMES[note.network] })
                        : formatMsg(m.connectFailedNet, { network: NETWORK_NAMES[note.network] })}{" "}
              <button type="button" onClick={() => setNote(null)} className="underline underline-offset-2">
                {m.dismiss}
              </button>
            </p>
          )}
          {error && (
            <p role="alert" className="mt-2 text-[12.5px] text-[#eed6a0]">
              {server(error)}
            </p>
          )}
          {!conns && !error && <p className="mt-2 text-[12.5px] text-[#9aa0ad]">{m.lineLoading}</p>}
          {conns && (
            <ul className="mt-2 rounded-[14px] ring-1 ring-inset ring-[rgba(255,255,255,0.09)]">
              {conns.map((c) => (
                <li key={c.network} className="grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-2.5 px-3 py-2 [&+&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                  <span className={s.mark} aria-hidden="true">
                    {NETWORK_MARKS[c.network]}
                  </span>
                  <div className="min-w-0">
                    <b className="text-[13px] font-semibold text-[#ecedf1]">{NETWORK_NAMES[c.network]}</b>
                    <small className="block truncate text-[12px] text-[#9aa0ad]">{status(c)}</small>
                    {c.status === "not_connected" && c.webOnly && <small className="block text-[11.5px] text-[#858994]">{server(c.note) ?? server(CONNECT_ON_COMPUTER)}</small>}
                  </div>
                  {canCompose(c) || c.status === "needs_reconnect" ? (
                    <span className="flex gap-1.5">
                      {c.status === "needs_reconnect" && c.canConnect && !c.webOnly && (
                        <button type="button" onClick={() => void act(c.network, "connect")} disabled={busy !== null} className={GHOST}>
                          {formatMsg(m.reconnectNet, { network: NETWORK_NAMES[c.network] })}
                        </button>
                      )}
                      <button type="button" onClick={() => void act(c.network, "disconnect")} disabled={busy !== null} className={GHOST}>
                        {busy === `disconnect:${c.network}` ? m.disconnecting : m.disconnect}
                      </button>
                    </span>
                  ) : c.status === "not_connected" && c.canConnect && !c.webOnly ? (
                    <button type="button" onClick={() => void act(c.network, "connect")} disabled={busy !== null} className={GHOST}>
                      {busy === `connect:${c.network}` ? m.connecting : formatMsg(m.connectNet, { network: NETWORK_NAMES[c.network] })}
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
