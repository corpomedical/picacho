"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { localizeServerText } from "@/lib/i18n/server-text";
import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";
import { DoorFrame } from "@/components/door-frame";
import { saveBrandKit } from "@/lib/press-tour/actions";
import { recordStarConsent } from "@/lib/press-tour/star-consent-actions";
import { PRODUCT_REGULATED_REFUSED } from "@/lib/press-tour/types";
import { BLOCK_FILMING_NOT_OPEN } from "@/lib/press-tour/campaign-messages";
import { CUT_STALLED } from "@/lib/press-tour/film-messages";
import type { CampaignActions, CampaignResult, CampaignView } from "@/lib/press-tour/campaign-types";
import type { PublishActions } from "@/lib/press-tour/publish-types";
import type { WaitlistActions } from "@/lib/press-tour/waitlist";
import type { PressBrandKit, PressCharacter, PressProduct } from "@/lib/press-tour/door-data";
import {
  POLL_MS,
  ROUTE_STOPS,
  decidedCount,
  firstWaiting,
  isClosed,
  isMiss,
  isWorking,
  nextSpend,
  planBlock,
  plannedSeconds,
  routeIndex,
  shotSeconds,
  sourceHost,
  wallBusy,
  wallMoments,
  type NetworkStates,
  type PlanBlock,
} from "@/lib/press-tour/door-view";
import { cn } from "@/lib/cn";
import { CheckIcon, EditIcon, LinkIcon, PressIcon, SendIcon } from "./icons";
import { FinishedCut } from "./finished-cut";
import { PostingAccounts, PressLine, type ConnectNote } from "./press-line";
import { PhonePressWall, PressWall, type WallActions, type WallProduct } from "./press-wall";
import { ProductSheet, type ProductSaved } from "./product-sheet";
import { QuoteCard } from "./quote-card";
import { PhoneRoute, RouteRail, type RouteStopView } from "./route-rail";
import { PhoneRunningOrder, RunningOrder, type StillActions } from "./running-order";
import { StarAskFields, saidLine, type StarDraft } from "./star-ask";
import s from "./press-tour.module.css";

// THE PRESS TOUR DOOR (Cut 1 UI, 2026-09-26). Direction A, "Red Carpet"
// (the operator's pick; artboards door-desktop, door-phone,
// product-import-phone, trial-phone): the dark theatre card, the PRESS TOUR
// marquee in metal, the billing line above it, the static route rail, the
// billing tiles (Starring · Co-starring · The angle), the running order of
// stills with their press stamps, the quote and the lit key; on a phone all
// three stills at once, one decision card and a dock that grows with its
// words, leaving the Producer's lamp its corner.
//
// Written against the contract alone (lib/press-tour/campaign-types.ts):
// every campaign press goes through `actions` (the engine's server actions,
// handed in by the page), every spend carries a fresh sendId, and every
// answer is the engine's fresh view of the ad. The product card and the
// star's answer go through their own actions (actions.ts,
// star-consent-actions.ts).
//
// Rules the door keeps (press-tour-door.test.ts pins them):
// - every word from t.pressTour or t.nav, in four languages; "Press Tour"
//   stays English in each; the engine's English sentences go through
//   localizeServerText;
// - no engine, vendor, model, server or resolution in anything it says;
// - every price is the server's quote (PressQuote), never worked out here;
// - no purchase or upgrade link (reader mode inside the app);
// - nothing says "locked": a check reads "Match", "Checked at 3 moments per
//   shot"; there is no free re-shoot and no refund for a miss;
// - a blocked key is truly disabled (aria-disabled, and a line saying what
//   blocks it): the Film key opens only when the engine names no blocker
//   (every still decided, press_tour_film on), priced from the quote;
// - after filming, the press wall (press-wall.tsx) puts every moment up and
//   a shot that missed waits for the person: Keep take N, Re-film shot N at
//   that shot's own film price, or Cut this shot, free (operator,
//   2026-09-26);
// - the finished cut opens the press line (press-line.tsx), one sheet for
//   every network, through the publishing actions handed in by the page;
// - no trend line: the trend brief (press_trends) is not built, and there is
//   no trend claim without a source.

export type PressTourDoorProps = {
  characters: PressCharacter[];
  products: PressProduct[];
  brandKits: PressBrandKit[];
  /** The newest campaign not yet closed; the door asks the engine for its view. */
  openCampaignId: string | null;
  /** False until the account's email is confirmed: nothing that reaches a paid call runs before. */
  emailConfirmed: boolean;
  /** Where each network stands today (door-view.ts networkStates). */
  networks: NetworkStates;
  /** The engine's server actions, by the contract's names. */
  actions: CampaignActions;
  /** Posting's server actions (publish-types.ts), by the contract's names. */
  publish: PublishActions;
  /** "Tell me when <network> opens" (waitlist.ts). */
  waitlist: WaitlistActions;
  /** A connect's answer on the way back from a network (?connected= / ?connect_error=): the press line opens on it. */
  connectNote: ConnectNote | null;
};

type Length = 10 | 15 | 30;
const LENGTHS: Length[] = [10, 15, 30];
const ASPECT = "9:16";

const LABEL = "font-slate text-[11px] font-medium uppercase tracking-[0.12em] text-[#858994]";
const GHOST =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13.5px] font-medium text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.16)] hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] disabled:opacity-50";
const QUIET =
  "inline-flex min-h-11 items-center text-[12.5px] text-[#9aa0ad] underline decoration-[rgba(255,255,255,0.2)] underline-offset-[3px] hover:text-[#ecedf1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] disabled:opacity-50";

/** "96 credits left" with the number set as a numeral, in any word order. */
function withNumber(template: string, n: number): ReactNode {
  const [before, after = ""] = template.split("{n}");
  return (
    <>
      {before}
      <span className="font-numeral text-[15px] tabular-nums text-[#c6c9d1]">{n}</span>
      {after}
    </>
  );
}

/** "2 minutes ago", in the person's language. Client-only (the campaign is read after mount). */
function ago(iso: string, locale: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const sec = Math.round((at - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(sec);
  if (abs < 45) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(sec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), "hour");
  return rtf.format(Math.round(sec / 86400), "day");
}

type Key = {
  label: string;
  price: string | null;
  disabled: boolean;
  press: (() => void) | null;
  blocker: string | null;
  hint: string | null;
  /** A second choice beside a lit one on the page (the wall's Keep take): drawn quiet, never lit. */
  quiet?: boolean;
};

export function PressTourDoor({ characters, products, brandKits, openCampaignId, emailConfirmed, networks, actions, publish, waitlist, connectNote }: PressTourDoorProps) {
  const { t, locale } = useLocale();
  const m = t.pressTour;
  const ids = useId();

  // What the person has, kept here so an answer or a saved card shows at once.
  const [chars, setChars] = useState(characters);
  const [prods, setProds] = useState(products);
  const [kits, setKits] = useState(brandKits);

  const [starId, setStarId] = useState<string | null>(() => (characters.find((c) => c.photoCount > 0) ?? characters[0])?.id ?? null);
  const [productId, setProductId] = useState<string | null>(
    () => (products.find((p) => p.card.status === "confirmed" && p.card.category !== "regulated") ?? products[0])?.card.id ?? null,
  );
  const [kitId, setKitId] = useState<string | null>(() => brandKits[0]?.kit.id ?? null);
  const [length, setLength] = useState<Length>(15);
  const [goal, setGoal] = useState("");

  const [campaign, setCampaign] = useState<CampaignView | null>(null);
  const [loading, setLoading] = useState(openCampaignId !== null);
  const [pending, setPending] = useState<string | null>(null);
  const [busyShot, setBusyShot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollTick, setPollTick] = useState(0);

  const [sheet, setSheet] = useState<{ initial: PressProduct | null } | null>(null);
  const [picking, setPicking] = useState<"star" | "product" | null>(null);
  const [starDraft, setStarDraft] = useState<StarDraft>({ answer: null, adsOk: false });
  const [notes, setNotes] = useState<string | null>(null);
  const [selectedShot, setSelectedShot] = useState<number | null>(null);
  const [askCancel, setAskCancel] = useState(false);
  // The press line: opened by its key, or on arrival back from connecting a
  // network (or a #press-line link) once the ad is ready.
  const [line, setLine] = useState<"auto" | "open" | "closed">(() =>
    connectNote || (typeof window !== "undefined" && window.location.hash === "#press-line") ? "auto" : "closed",
  );

  // A connect's answer rides on the address once: take it off, so a reload doesn't say it again.
  useEffect(() => {
    if (!connectNote) return;
    const url = new URL(window.location.href);
    for (const k of ["connected", "connect_error", "network", "campaign"]) url.searchParams.delete(k);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [connectNote]);

  // The phone's dock grows with its words; the page keeps exactly that much
  // room under the card, so its last line never hides behind the dock.
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockRoom, setDockRoom] = useState(0);

  // The ad left open, read once on arrival.
  useEffect(() => {
    if (!openCampaignId) return;
    let live = true;
    void (async () => {
      try {
        const res = await actions.getCampaign({ campaignId: openCampaignId });
        if (live && res.ok) {
          setCampaign(res.campaign);
          // The press line opens on arrival only for an ad that is ready now.
          if (res.campaign.stage !== "ready") setLine((l) => (l === "auto" ? "closed" : l));
        }
      } catch (err) {
        // A deploy that landed while the tab was open throws here for as
        // long as the tab runs the old build: only a reload reads the ad,
        // through the one shared guard (stale-deploy.ts).
        if (isStaleDeployError(err) && reloadForNewDeploy()) return;
        /* no ad shown is not a broken door: the person can plan a new one */
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [openCampaignId, actions]);

  // While the engine works (planning, painting, filming, checking, cutting,
  // or a shot on the wall being filmed again), ask again.
  useEffect(() => {
    if (!campaign || !(isWorking(campaign.stage) || wallBusy(campaign.shots))) return;
    const id = campaign.id;
    const timer = setTimeout(async () => {
      try {
        const res = await actions.getCampaign({ campaignId: id });
        if (res.ok) setCampaign(res.campaign);
        else setPollTick((n) => n + 1);
      } catch (err) {
        // A deploy that lands while stills paint makes every ask throw from
        // this tab, so asking again would spin on a frozen ad forever: the
        // shared guard reloads it onto the new build, once (stale-deploy.ts).
        if (isStaleDeployError(err) && reloadForNewDeploy()) return;
        setPollTick((n) => n + 1);
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [campaign, pollTick, actions]);

  const run = useCallback(
    async (label: string, work: () => Promise<CampaignResult>, shot: number | null = null, campaignId: string | null = null) => {
      setPending(label);
      setBusyShot(shot);
      setError(null);
      try {
        const res = await work();
        if (!res.ok) {
          setError(res.error);
          // A refused press may have changed the ad on the server (a price
          // that moved is written to it): read it again, so the receipt,
          // the key's price and the dock show what the next press will
          // charge, never the old figure (PT-08).
          if (campaignId) {
            const fresh = await actions.getCampaign({ campaignId }).catch(() => null);
            if (fresh?.ok) setCampaign(fresh.campaign);
          }
        }
        // A closed ad goes back to the setup; any other answer is the ad now.
        else setCampaign(isClosed(res.campaign.stage) && label === "cancel" ? null : res.campaign);
      } catch (err) {
        if (isStaleDeployError(err) && reloadForNewDeploy()) return;
        setError(m.failed);
      } finally {
        setPending(null);
        setBusyShot(null);
      }
    },
    [m.failed, actions],
  );

  // ── Who and what the ad is about ─────────────────────────────────────────
  const castStarId = campaign?.characterIds[0] ?? starId;
  const castProductId = campaign?.productId ?? productId;
  const castKitId = campaign ? campaign.brandKitId : kitId;
  const star = chars.find((c) => c.id === castStarId) ?? null;
  const product = prods.find((p) => p.card.id === castProductId) ?? null;
  const kit = kits.find((k) => k.kit.id === castKitId) ?? null;
  const castFixed = campaign !== null; // the cast is set once an ad is planned
  // The star's ad-use answer can be missing after planning too (a photo
  // added on the character page changes the photos it covers): the question
  // stays answerable with the cast fixed, or Paint and Repaint would wait
  // with no way to answer (PT-05).
  const starNeedsAnswer = star !== null && star.photoCount > 0 && !star.adAnswer;
  const block: PlanBlock = planBlock({ emailConfirmed, star, product: product?.card ?? null });

  // ── Where the ad is ──────────────────────────────────────────────────────
  const stage = campaign?.stage ?? null;
  const stills = campaign?.stills ?? [];
  const shots = campaign?.shots ?? [];
  const filmed = shots.length > 0;
  const quote = campaign?.quote ?? null;
  const now = routeIndex(campaign && !isClosed(campaign.stage) ? campaign.stage : null, filmed);
  const starts = Object.fromEntries(stills.map((x) => [x.shot, x.span[0]])) as Record<number, number>;
  const wall = filmed ? wallMoments(shots, starts) : [];
  const misses = wall.filter((x) => isMiss(x.verdict)).length;
  const didnt = wall.filter((x) => x.verdict === "didnt_match").length;
  const inFlight = wallBusy(shots);
  const liveNetworks = Object.values(networks).filter((v) => v !== "comingSoon").length;
  const seconds = campaign ? plannedSeconds(stills) || campaign.lengthSeconds : length;
  const perShot = shotSeconds(stills);
  const decided = decidedCount(stills);
  const spend = nextSpend(quote);
  const canAct = stage === "awaiting_approval" && pending === null;

  const stopNames = [m.stepPlan, m.stepStills, m.stepFilm, m.stepWall, m.stepLine];
  const stopSubs: (string | null)[] = ROUTE_STOPS.map((stop, i) => {
    if (stop === "plan") return campaign && stills.length > 0 ? formatMsg(m.routeShots, { n: stills.length, s: seconds }) : m.routeFree;
    if (stop === "stills") {
      if (!campaign || i > now) return null;
      if (stage === "painting") return m.routePainting;
      if (stage === "checking_keyframes") return m.routeChecking;
      return formatMsg(m.routeDecided, { d: decided, n: stills.length });
    }
    if (!campaign || isClosed(campaign.stage)) return null;
    // The stops ahead of an open ad say what they hold, as the artboards
    // do: the film's price from the quote, and where the ad can post today.
    if (stop === "line") return liveNetworks > 0 ? formatMsg(liveNetworks === 1 ? m.routeNetworksOne : m.routeNetworks, { n: liveNetworks }) : m.routeSoon;
    if (i > now) return stop === "film" && quote && !quote.trial ? formatMsg(m.creditsTag, { n: quote.animate }) : null;
    if (stop === "film") return stage === "animating" ? m.routeFilming : m.routeFilmed;
    if (stop === "wall") {
      if (stage === "checking_shots") return m.routeChecking;
      if (stage === "assembling" || stage === "signing") return m.routeCutting;
      // The fixed words: "didn't match" counts only the moments that read so;
      // a product missing is counted under its own word.
      if (didnt > 0) return formatMsg(didnt === 1 ? m.routeMissedOne : m.routeMissed, { n: didnt });
      if (misses > 0) return `${misses} ${m.verdictProductMissing}`;
      return formatMsg(m.routeRead, { n: wall.length });
    }
    return null;
  });
  const stops: RouteStopView[] = stopNames.map((name, i) => ({ name, sub: stopSubs[i] }));

  // ── The key, and what blocks it ──────────────────────────────────────────
  const blockWords: Record<NonNullable<PlanBlock>, string> = {
    email: m.confirmEmail,
    star: m.needStar,
    starPhoto: m.needStarPhoto,
    starAnswer: formatMsg(m.needStarAnswer, { name: star?.name || m.untitledStar }),
    product: m.needProduct,
    productRefused: m.needOtherProduct,
    productCard: m.needProductCard,
  };
  const server = (text: string | null) => (text ? localizeServerText(text, t) : null);
  const priceTag = (credits: number) => (quote?.trial ? m.onUs : formatMsg(m.creditsTag, { n: credits }));

  let key: Key | null;
  if (loading) {
    key = null;
  } else if (!campaign) {
    key = {
      label: m.planKey,
      price: m.free,
      disabled: block !== null || pending !== null,
      press: () =>
        void run("plan", () =>
          actions.planCampaign({
            sendId: crypto.randomUUID(),
            productId: productId!,
            characterId: starId!,
            brandKitId: kitId,
            lengthSeconds: length,
            goal: goal.trim() || undefined,
            source: "door",
          }),
        ),
      blocker: block ? blockWords[block] : null,
      hint: m.planHint,
    };
  } else if (isClosed(campaign.stage)) {
    key = {
      label: m.startNew,
      price: null,
      disabled: false,
      press: () => {
        setCampaign(null);
        setError(null);
      },
      blocker: server(campaign.error) ?? m.adStopped,
      hint: null,
    };
  } else if (spend === "paint" || stage === "draft" || stage === "planned" || stage === "painting" || stage === "checking_keyframes") {
    const campaignId = campaign.id;
    key = {
      label: formatMsg(m.paintKey, { n: stills.length }),
      price: quote && stage === "planned" ? priceTag(quote.paint) : null,
      disabled: stage !== "planned" || campaign.blocker !== null || pending !== null,
      press: () => void run("paint", () => actions.paintStills({ sendId: crypto.randomUUID(), campaignId }), null, campaignId),
      blocker: server(campaign.blocker) ?? (stage === "painting" ? m.paintingNow : null),
      hint: stage === "planned" ? m.paintHint : null,
    };
  } else if (stage === "ready") {
    // The finished cut: the press line opens from here.
    key = {
      label: m.openLine,
      price: null,
      disabled: !campaign.master,
      press: () => setLine("open"),
      blocker: campaign.master ? null : m.cutMissing,
      hint: m.openLineHint,
    };
  } else if (stage === "animating") {
    // Filming: the key stays, shut, saying what we're doing.
    key = {
      label: formatMsg(m.filmKey, { n: stills.length }),
      price: null,
      disabled: true,
      press: null,
      blocker: server(campaign.blocker) ?? m.filmingNow,
      hint: null,
    };
  } else if (filmed) {
    // The press wall: Make the cut with the takes shown (free), once nothing
    // is in our hands. While a shot waits, its Keep take is the lit choice
    // and this one stays quiet; a cut we couldn't finish says so above it.
    const campaignId = campaign.id;
    const open = stage === "awaiting_approval" && !inFlight;
    key = {
      label: m.cutKey,
      price: m.free,
      disabled: !open || pending !== null,
      press: () => void run("cut", () => actions.assembleNow({ campaignId }), null, campaignId),
      // Shut while a shot is still in our hands: say so, when the engine names nothing else.
      blocker: open ? null : (server(campaign.blocker) ?? (inFlight ? m.filmingNow : null)),
      hint: open ? (campaign.blocker === CUT_STALLED ? server(campaign.blocker) : m.cutKeyHint) : null,
      quiet: shots.some((x) => x.needsDecision),
    };
  } else {
    // Film: open once the engine names no blocker (every still decided, and
    // filming switched on), priced from the quote's film line.
    const campaignId = campaign.id;
    key = {
      label: formatMsg(m.filmKey, { n: stills.length }),
      price: quote ? priceTag(quote.animate) : null,
      disabled: campaign.blocker !== null || pending !== null,
      press: () => void run("film", () => actions.filmShots({ sendId: crypto.randomUUID(), campaignId }), null, campaignId),
      blocker: server(campaign.blocker),
      // The engine's own line already says filming is not open: no echo.
      hint: campaign.blocker === BLOCK_FILMING_NOT_OPEN ? null : m.filmHint,
    };
  }

  // On a phone, while a shot on the wall waits, its card carries the choice
  // and the quiet "Make the cut" sits under the wall (wall-phone): no dock,
  // unless a press was refused and the dock must say so.
  const dockShown = key !== null && (!(filmed && key.quiet) || error !== null);
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDockRoom(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading, dockShown]);

  // ── Presses on a still ───────────────────────────────────────────────────
  const act: StillActions = {
    approve: (shot) => campaign && void run("approve", () => actions.approveStill({ campaignId: campaign.id, shot }), shot, campaign.id),
    keep: (shot) => campaign && void run("keep", () => actions.keepStill({ campaignId: campaign.id, shot }), shot, campaign.id),
    undo: (shot) => campaign && void run("undo", () => actions.undoStill({ campaignId: campaign.id, shot }), shot, campaign.id),
    repaint: (shot) =>
      campaign && void run("repaint", () => actions.repaintStill({ sendId: crypto.randomUUID(), campaignId: campaign.id, shot }), shot, campaign.id),
  };
  // ── Presses on the wall ──────────────────────────────────────────────────
  const wallAct: WallActions = {
    keep: (shot, take) => campaign && void run("keep-take", () => actions.keepTake({ campaignId: campaign.id, shot, take }), shot, campaign.id),
    // The price the wall showed rides with the press: a price that moved since is refused, never charged (MONEY-5).
    refilm: (shot, note) =>
      campaign &&
      void run(
        "refilm",
        () =>
          actions.refilmShot({
            sendId: crypto.randomUUID(),
            campaignId: campaign.id,
            shot,
            credits: campaign.shots.find((x) => x.shot === shot)?.refilmCredits ?? 0,
            note: note || undefined,
          }),
        shot,
        campaign.id,
      ),
    cut: (shot) => campaign && void run("cut-shot", () => actions.cutShot({ campaignId: campaign.id, shot }), shot, campaign.id),
  };
  const canDecideWall = stage === "awaiting_approval" && filmed && pending === null;

  const waiting = firstWaiting(stills);
  const shownShot = selectedShot ?? waiting?.shot ?? stills.find((x) => x.decision === "pending")?.shot ?? stills[0]?.shot ?? 1;
  const canRepaint = quote ? !quote.trial : true;

  // ── The star's answer and the brand notes ────────────────────────────────
  async function saveStar() {
    if (!star || !starDraft.answer || !starDraft.adsOk || pending) return;
    setPending("star");
    setError(null);
    try {
      const res = await recordStarConsent({ characterId: star.id, answer: starDraft.answer, adsOk: starDraft.adsOk });
      if (res.error !== null) setError(res.error);
      else {
        setChars((prev) => prev.map((c) => (c.id === star.id ? { ...c, adAnswer: res.answer } : c)));
        // An ad waiting on this answer reads itself again, so the Paint key
        // (or a repaint) opens without a reload.
        if (campaign && !isClosed(campaign.stage)) {
          const fresh = await actions.getCampaign({ campaignId: campaign.id });
          if (fresh.ok) setCampaign(fresh.campaign);
        }
      }
    } catch (err) {
      if (isStaleDeployError(err) && reloadForNewDeploy()) return;
      setError(m.failed);
    } finally {
      setPending(null);
    }
  }

  async function saveNotes() {
    if (!kit || notes === null || pending) return;
    setPending("notes");
    setError(null);
    try {
      // A confirmed kit stays confirmed: its logo's consent still covers it.
      const res = await saveBrandKit({ id: kit.kit.id, name: kit.kit.name, tone: notes, confirm: kit.kit.status === "confirmed" });
      if (res.error !== null) setError(res.error);
      else {
        setKits((prev) => prev.map((k) => (k.kit.id === res.kit.id ? { kit: res.kit, logoUrl: res.logoUrl } : k)));
        setNotes(null);
      }
    } catch (err) {
      if (isStaleDeployError(err) && reloadForNewDeploy()) return;
      setError(m.failed);
    } finally {
      setPending(null);
    }
  }

  function productSaved(saved: ProductSaved) {
    setProds((prev) => [saved.product, ...prev.filter((p) => p.card.id !== saved.product.card.id)]);
    setProductId(saved.product.card.id);
    setSheet(null);
    setError(null);
  }

  const cancel = () => campaign && void run("cancel", () => actions.cancelCampaign({ campaignId: campaign.id }));

  // ── Pieces ───────────────────────────────────────────────────────────────
  const productPhoto = product ? (product.card.photos.map((p) => product.photoUrls[p]).find(Boolean) ?? null) : null;
  const host = product ? sourceHost(product.card.sourceUrl) : null;
  // Only the photos press-kit holds are on a door card (door-data.ts): a
  // leftover card's photos kept elsewhere are neither counted nor shown.
  const productPhotoCount = product ? product.card.photos.length : 0;
  const productSub = [
    host,
    productPhotoCount > 0 ? formatMsg(productPhotoCount === 1 ? m.productPhotosOne : m.productPhotos, { n: productPhotoCount }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const keyNoteId = `${ids}-key-note`;
  const errorLine = error ? (
    <p role="alert" className="text-[12.5px] leading-[1.4] text-[#eed6a0]">
      {localizeServerText(error, t)}
    </p>
  ) : null;

  const keyButton = (className?: string) =>
    key && (
      <button
        type="button"
        onClick={() => {
          if (!key.disabled && key.press) key.press();
        }}
        aria-disabled={key.disabled}
        aria-describedby={key.blocker || key.hint ? keyNoteId : undefined}
        className={cn(s.key, key.quiet && s.keyQuiet, className)}
      >
        {key.label}
        <SendIcon />
        {key.price && <span className={s.price}>{key.price}</span>}
      </button>
    );

  const starTile = (
    <section aria-labelledby={`${ids}-star`} className="flex min-w-0 items-start gap-3.5 px-4 py-3">
      <span className="relative h-14 w-14 flex-none overflow-hidden rounded-xl bg-[rgba(255,255,255,0.05)] shadow-[0_0_0_1px_rgba(255,240,220,0.22),0_14px_26px_-12px_rgba(0,0,0,0.9)]">
        {star?.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- our own media route, already sized
          <img src={star.photoUrl} alt="" className="h-full w-full object-cover" />
        )}
        {star?.adAnswer && (
          <span aria-hidden="true" className={cn("lock-frame", s.marks)} style={{ inset: 4, ["--lock-arm" as string]: "9px", ["--lock-stroke" as string]: "1.5px" }} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h2 id={`${ids}-star`} className={LABEL}>
          {m.starring}
        </h2>
        {star ? (
          <>
            <p className="mt-1 truncate font-numeral text-2xl italic leading-none text-[#f0cda6]">{star.name || m.untitledStar}</p>
            <p className="mt-1 text-xs leading-[1.4] text-[#9aa0ad]">{m.starSub}</p>
            {star.adAnswer ? (
              <p className="mt-1.5 flex gap-1.5 text-[11.5px] leading-[1.38] text-[#b9b2a6]">
                <CheckIcon className="mt-px h-3 w-3 flex-none text-[#e0a468]" />
                {saidLine(star.adAnswer, m)}
              </p>
            ) : star.photoCount === 0 ? (
              <p className="mt-1.5 text-[12px] text-[#eed6a0]">{m.needStarPhoto}</p>
            ) : (
              starNeedsAnswer && (
                <div className="mt-2.5">
                  <StarAskFields name={star.name} draft={starDraft} onChange={setStarDraft} disabled={pending === "star"} m={m} />
                  <button
                    type="button"
                    onClick={() => void saveStar()}
                    disabled={!starDraft.answer || !starDraft.adsOk || pending !== null}
                    className={cn(GHOST, "mt-2 w-full")}
                  >
                    {pending === "star" ? m.saving : m.saveAnswer}
                  </button>
                </div>
              )
            )}
            {!castFixed && chars.length > 1 && (
              <button type="button" onClick={() => setPicking(picking === "star" ? null : "star")} aria-expanded={picking === "star"} className={QUIET}>
                {m.change}
              </button>
            )}
            {picking === "star" && (
              <ul role="radiogroup" aria-label={m.chooseStar} className="mt-1 grid max-h-64 gap-1.5 overflow-y-auto">
                {chars.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={c.id === starId}
                      onClick={() => {
                        setStarId(c.id);
                        setStarDraft({ answer: null, adsOk: false });
                        setPicking(null);
                      }}
                      className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2 text-left text-[13.5px] text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] aria-checked:ring-[rgba(240,196,142,0.65)]"
                    >
                      {c.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- our own media route, already sized
                        <img src={c.photoUrl} alt="" className="h-8 w-8 flex-none rounded-lg object-cover" />
                      ) : (
                        <span aria-hidden="true" className="h-8 w-8 flex-none rounded-lg bg-[rgba(255,255,255,0.05)]" />
                      )}
                      <span className="truncate">{c.name || m.untitledStar}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="mt-2 space-y-2.5">
            <p className="text-sm text-[#9aa0ad]">{m.noCharacter}</p>
            <Link href="/app/character" className={GHOST}>
              {m.makeCharacter}
            </Link>
          </div>
        )}
      </div>
    </section>
  );

  const productTile = (
    <section aria-labelledby={`${ids}-product`} className="flex min-w-0 items-start gap-3.5 px-4 py-3">
      <span className="relative flex h-[76px] w-10 flex-none items-end justify-center">
        <span aria-hidden="true" className="absolute -bottom-1 -left-3.5 -right-3.5 h-4 rounded-[50%] bg-[radial-gradient(closest-side,rgba(224,164,104,0.3),transparent)]" />
        {productPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived private link to the person's own photo
          <img src={productPhoto} alt="" className="relative max-h-[72px] w-auto max-w-[56px] rounded-md object-contain drop-shadow-[0_10px_10px_rgba(0,0,0,0.6)]" />
        ) : (
          <span aria-hidden="true" className="relative h-[60px] w-10 rounded-lg bg-[rgba(255,255,255,0.05)]" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h2 id={`${ids}-product`} className={LABEL}>
          {m.coStarring}
        </h2>
        {product ? (
          <>
            <p className="mt-1 truncate text-[15px] font-semibold leading-[1.2] text-[#ecedf1]">{product.card.name || m.untitledProduct}</p>
            {productSub && (
              <p className="mt-[3px] flex items-center gap-[5px] text-xs text-[#9aa0ad]">
                {host && <LinkIcon className="h-3 w-3 flex-none" />}
                <span className="truncate">{productSub}</span>
              </p>
            )}
            {product.card.category === "regulated" ? (
              <p className="mt-2 text-[12px] leading-[1.4] text-[#eed6a0]">{localizeServerText(PRODUCT_REGULATED_REFUSED, t)}</p>
            ) : product.card.status === "confirmed" ? (
              <>
                <div className="mt-[7px] flex flex-wrap items-center gap-1">
                  {product.card.noReadableText ? (
                    <span className="text-[11px] text-[#858994]">{m.noReadableText}</span>
                  ) : (
                    product.card.labelStrings.slice(0, 6).map((w) => (
                      <span key={w} className="rounded-[5px] px-1.5 py-0.5 font-slate text-[11px] uppercase tracking-[0.04em] text-[#d7cfc2] ring-1 ring-inset ring-[rgba(255,255,255,0.14)]">
                        {w}
                      </span>
                    ))
                  )}
                  {product.card.palette.length > 0 && (
                    <span className="ml-0.5 inline-flex gap-1" aria-hidden="true">
                      {product.card.palette.slice(0, 4).map((hex) => (
                        <i key={hex} className="h-[11px] w-[11px] rounded-[3px] ring-1 ring-inset ring-[rgba(255,255,255,0.2)]" style={{ backgroundColor: hex }} />
                      ))}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 flex gap-1.5 text-[11.5px] leading-[1.38] text-[#b9b2a6]">
                  <CheckIcon className="mt-px h-3 w-3 flex-none text-[#e0a468]" />
                  {m.saidProduct}
                </p>
                {/* A confirmed card stays editable until an ad is planned
                    with it: a plan refused over its name or a ticked label
                    word says to press this (PLAN_REFUSED_LABEL_CLAIM), and
                    without it the only way on was a whole new card. */}
                {!castFixed && (
                  <div className="mt-2">
                    <button type="button" disabled={!emailConfirmed} onClick={() => setSheet({ initial: product })} className={GHOST}>
                      {m.editCard}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                {productPhotoCount === 0 ? (
                  <p className="mt-1.5 text-[12px] text-[#eed6a0]">{m.productNeedsPhotos}</p>
                ) : (
                  <p className="mt-1.5 text-[12px] text-[#9aa0ad]">{m.productDraft}</p>
                )}
                {!castFixed && (
                  <div className="mt-2">
                    <button type="button" disabled={!emailConfirmed} onClick={() => setSheet({ initial: product })} className={GHOST}>
                      {m.finishCard}
                    </button>
                  </div>
                )}
              </>
            )}
            {!castFixed && (
              <div>
                <button type="button" onClick={() => setPicking(picking === "product" ? null : "product")} aria-expanded={picking === "product"} className={QUIET}>
                  {m.change}
                </button>
              </div>
            )}
            {picking === "product" && (
              <ul role="radiogroup" aria-label={m.chooseProduct} className="mt-1 grid max-h-64 gap-1.5 overflow-y-auto">
                {prods.map((p) => {
                  const photo = p.card.photos.map((x) => p.photoUrls[x]).find(Boolean);
                  return (
                    <li key={p.card.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={p.card.id === productId}
                        onClick={() => {
                          setProductId(p.card.id);
                          if (p.card.brandKitId) setKitId(p.card.brandKitId);
                          setPicking(null);
                        }}
                        className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2 text-left text-[13.5px] text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] aria-checked:ring-[rgba(240,196,142,0.65)]"
                      >
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element -- a short-lived private link to the person's own photo
                          <img src={photo} alt="" className="h-8 w-8 flex-none rounded-lg bg-[#101116] object-contain" />
                        ) : (
                          <span aria-hidden="true" className="h-8 w-8 flex-none rounded-lg bg-[rgba(255,255,255,0.05)]" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{p.card.name || m.untitledProduct}</span>
                        <span className="flex-none text-[11px] text-[#858994]">{p.card.status === "confirmed" ? m.productReady : m.productDraftShort}</span>
                      </button>
                    </li>
                  );
                })}
                <li>
                  <button type="button" disabled={!emailConfirmed} onClick={() => setSheet({ initial: null })} className={cn(GHOST, "w-full")}>
                    {m.addProduct}
                  </button>
                </li>
              </ul>
            )}
          </>
        ) : (
          <div className="mt-2 space-y-2.5">
            <p className="text-sm text-[#9aa0ad]">{m.noProduct}</p>
            <button type="button" disabled={!emailConfirmed} onClick={() => setSheet({ initial: null })} className={GHOST}>
              {m.addProduct}
            </button>
          </div>
        )}
      </div>
    </section>
  );

  const angleTile = (
    <section aria-labelledby={`${ids}-angle`} className="min-w-0 px-4 py-3">
      <h2 id={`${ids}-angle`} className={LABEL}>
        {m.angleLabel}
      </h2>
      {campaign ? (
        <p className="mt-1 text-[13.5px] font-medium text-[#ecedf1]">
          {[campaign.angle, formatMsg(m.lengthSeconds, { n: seconds }), ASPECT].filter(Boolean).join(" · ")}
        </p>
      ) : (
        <>
          <div role="radiogroup" aria-label={m.lengthLabel} className="mt-2 grid grid-cols-3 rounded-[11px] bg-[rgba(255,255,255,0.04)] p-[3px] ring-1 ring-inset ring-[rgba(255,255,255,0.08)]">
            {LENGTHS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={length === n}
                onClick={() => setLength(n)}
                className={cn(
                  "min-h-11 rounded-lg text-[13px] tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] lg:min-h-9",
                  length === n ? "bg-[rgba(255,255,255,0.08)] font-medium text-[#ecedf1]" : "text-[#9aa0ad]",
                )}
              >
                {formatMsg(m.lengthSeconds, { n })}
              </button>
            ))}
          </div>
          <label className="mt-2.5 block text-[12px] text-[#9aa0ad]">
            {m.goalLabel}
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              maxLength={300}
              placeholder={m.goalPlaceholder}
              className="mt-1 block w-full resize-none rounded-[10px] bg-[rgba(255,255,255,0.03)] px-2.5 py-2 text-[13px] leading-[1.4] text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.1)] placeholder:text-[#62656e] focus:outline-none focus:ring-[rgba(240,196,142,0.65)]"
            />
          </label>
        </>
      )}
      <div className="mt-2 rounded-[10px] bg-[rgba(255,255,255,0.03)] px-2.5 py-2 text-xs leading-[1.4] text-[#c6c9d1] ring-1 ring-inset ring-[rgba(255,255,255,0.08)]">
        <p className="mb-0.5 flex items-center justify-between gap-2">
          <span className="font-slate text-[11px] font-medium uppercase tracking-[0.1em] text-[#858994]">{m.brandNotes}</span>
          {kit && notes === null && (
            <button
              type="button"
              onClick={() => setNotes(kit.kit.tone ?? "")}
              className="-my-2 inline-flex min-h-11 items-center gap-1 text-[12px] font-medium text-[#f0cda6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] lg:min-h-8"
            >
              <EditIcon className="h-3 w-3" />
              {m.edit}
            </button>
          )}
        </p>
        {!kit ? (
          <p className="text-[#9aa0ad]">{m.noBrandKit}</p>
        ) : notes !== null ? (
          <>
            <label className="sr-only" htmlFor={`${ids}-notes`}>
              {m.brandNotes}
            </label>
            <textarea
              id={`${ids}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={m.notesPlaceholder}
              className="mt-1 block w-full resize-none rounded-lg bg-[rgba(0,0,0,0.25)] px-2 py-1.5 text-[12.5px] leading-[1.4] text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.12)] placeholder:text-[#62656e] focus:outline-none focus:ring-[rgba(240,196,142,0.65)]"
            />
            <span className="mt-1.5 flex gap-2">
              <button type="button" onClick={() => void saveNotes()} disabled={pending !== null} className={cn(GHOST, "min-h-9 px-3 text-[12.5px]")}>
                {pending === "notes" ? m.saving : m.save}
              </button>
              <button type="button" onClick={() => setNotes(null)} className={cn(QUIET, "min-h-9")}>
                {m.cancel}
              </button>
            </span>
          </>
        ) : (
          <>
            {kits.length > 1 && !castFixed ? (
              <label className="mb-1 block">
                <span className="sr-only">{m.brandKit}</span>
                <select
                  value={kit.kit.id}
                  onChange={(e) => setKitId(e.target.value)}
                  className="min-h-11 w-full rounded-lg bg-transparent text-[12.5px] font-medium text-[#ecedf1] focus:outline-none lg:min-h-8"
                >
                  {kits.map((k) => (
                    <option key={k.kit.id} value={k.kit.id} className="bg-[#16130f]">
                      {k.kit.name || m.untitledBrand}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="font-medium text-[#ecedf1]">{kit.kit.name || m.untitledBrand}</p>
            )}
            <p className={kit.kit.tone ? "" : "text-[#858994]"}>{kit.kit.tone || m.noNotes}</p>
          </>
        )}
      </div>
    </section>
  );

  const creditsNow = quote && !quote.trial ? quote.balanceNow : null;
  const runningHead = campaign ? formatMsg(m.runningOrder, { n: stills.length, s: seconds }) : m.runningOrderEmpty;
  const emptyStage = (
    <div className="relative">
      <ol className="grid grid-cols-3 gap-2.5 md:gap-5" aria-label={m.stillsLabel}>
        {[1, 2, 3].map((n) => (
          <li key={n} className="grid aspect-[188/268] place-items-center rounded-[14px] border border-dashed border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.015)]">
            <span className="font-slate text-[11px] tabular-nums text-[#62656e]">{String(n).padStart(2, "0")}</span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[12.5px] leading-[1.45] text-[#9aa0ad]">{loading ? m.loadingAd : m.runningEmpty}</p>
    </div>
  );

  const keyNote = key && (key.blocker || key.hint) && (
    <div id={keyNoteId} className="space-y-1">
      {key.blocker && <p className={s.blocker}>{key.blocker}</p>}
      {key.hint && <p className="text-[11.5px] leading-[1.45] text-[#858994]">{key.hint}</p>}
    </div>
  );

  // The top line under the title, by where the ad is.
  const subLine =
    stage === "animating"
      ? m.subFilming
      : stage === "checking_shots"
        ? m.subChecking
        : stage === "assembling" || stage === "signing"
          ? m.subCutting
          : stage === "ready"
            ? m.subReady
            : filmed && stage === "awaiting_approval"
              ? formatMsg(m.subWall, { n: wall.length })
              : m.sub;

  const wallProduct: WallProduct | null = product
    ? { photo: productPhoto, shape: product.card.dna?.shape ?? [], marks: product.card.dna?.marks ?? [], palette: product.card.palette }
    : null;

  // A ready ad stays open for its press line; starting another only clears this page.
  const newAdControl = stage === "ready" && (
    <button
      type="button"
      onClick={() => {
        setCampaign(null);
        setError(null);
      }}
      className={QUIET}
    >
      {m.startNew}
    </button>
  );

  // Not while we owe the cut (the server refuses it too: MONEY-1); once filmed, the question says the filming stays spent.
  const cancelControl = campaign && !isClosed(campaign.stage) && stage !== "ready" && !campaign.cutOwed && (
    <div className="text-[12px]">
      {askCancel ? (
        <p className="flex flex-wrap items-center gap-x-3 text-[#9aa0ad]">
          {filmed ? m.cancelAskFilmed : m.cancelAsk}
          <button
            type="button"
            onClick={() => {
              setAskCancel(false);
              cancel();
            }}
            disabled={pending !== null}
            className={QUIET}
          >
            {m.cancelYes}
          </button>
          <button type="button" onClick={() => setAskCancel(false)} className={QUIET}>
            {m.cancelNo}
          </button>
        </p>
      ) : (
        <button type="button" onClick={() => setAskCancel(true)} className={QUIET}>
          {m.startOver}
        </button>
      )}
    </div>
  );

  return (
    <>
      <DoorFrame data-press-tour-door="" className="relative isolate overflow-hidden">
        <div className={s.rig} aria-hidden="true">
          <i style={{ left: 0, width: 330 }} />
          <i style={{ left: 250, width: 400 }} />
        </div>
        <div className="relative z-[1]">
          {/* The billing line, the marquee, the promise. */}
          <p className={cn(s.cast, "flex items-baseline gap-[7px] overflow-hidden whitespace-nowrap")}>
            {star && product ? (
              <>
                <b className="truncate">{star.name || m.untitledStar}</b>
                <small>{m.castIn}</small>
                <b className="truncate">{product.card.name || m.untitledProduct}</b>
                <span className="hidden lg:inline">·</span>
                <span className="hidden lg:inline">{m.castSpot}</span>
                <span>·</span>
                <span>{formatMsg(m.castSeconds, { n: seconds })}</span>
                <span className="hidden sm:inline">·</span>
                <span className="hidden sm:inline">{ASPECT}</span>
              </>
            ) : (
              <span>{m.eyebrow}</span>
            )}
          </p>
          <div className="mt-2 flex items-end justify-between gap-6">
            <div className="min-w-0">
              <h1 className="marquee bg-[linear-gradient(180deg,#fbf6ee_18%,#b9ad9c_100%)] bg-clip-text text-[26px] leading-none text-transparent md:text-[34px]">
                {m.headline}
              </h1>
              <p className="mt-2 max-w-[720px] text-[13px] leading-[1.45] text-[#9aa0ad] md:text-sm">{subLine}</p>
            </div>
            {campaign && (
              <div className="hidden flex-none text-right text-xs leading-[1.6] text-[#858994] xl:block">
                {creditsNow !== null && <p>{withNumber(creditsNow === 1 ? m.creditsLeftOne : m.creditsLeft, creditsNow)}</p>}
                {/* The angle is The angle tile's; here only when the ad was last saved, so the promise keeps one line. */}
                <p>{formatMsg(m.savedAgo, { when: ago(campaign.updatedAt, locale) })}</p>
              </div>
            )}
          </div>

          {quote?.trial && (
            <div className="mt-3 flex items-center gap-3 rounded-2xl bg-[rgba(255,255,255,0.03)] px-3 py-2.5 ring-1 ring-inset ring-[rgba(240,196,142,0.35)]">
              <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-[rgba(255,214,164,0.07)] text-[#f6dcb8] ring-1 ring-inset ring-[rgba(255,214,164,0.15)]">
                <PressIcon className="h-[18px] w-[18px]" />
              </span>
              <p className="min-w-0 text-[15px] font-semibold text-[#ecedf1]">
                {m.trialTitle}
                <span className="block text-[12.5px] font-normal text-[#9aa0ad]">{formatMsg(m.trialSub, { s: seconds, n: stills.length })}</span>
              </p>
            </div>
          )}

          {/* Where the ad is. The full rail needs a wide card (a 1280 px window
              with the sidebar); anything narrower reads the compact one. */}
          <div className="hidden xl:block">
            <RouteRail stops={stops} now={now} networks={networks} m={m} />
          </div>
          <div className="xl:hidden">
            <PhoneRoute stops={stops} now={now} networks={networks} right={creditsNow !== null ? formatMsg(creditsNow === 1 ? m.creditsLeftOne : m.creditsLeft, { n: creditsNow }) : null} m={m} />
          </div>

          {!emailConfirmed && (
            <p role="status" className="mt-3 rounded-xl bg-[rgba(238,214,160,0.08)] px-4 py-3 text-sm text-[#eed6a0] ring-1 ring-inset ring-[rgba(238,214,160,0.25)]">
              {m.confirmEmail}
            </p>
          )}

          {/* The billing: the star, the co-star, the angle. On a phone it steps aside once the ad is planned. */}
          <div
            className={cn(
              "mt-3.5 grid grid-cols-1 divide-y divide-[rgba(255,255,255,0.07)] rounded-[18px] bg-[rgba(255,255,255,0.022)] ring-1 ring-inset ring-[rgba(255,255,255,0.08)] xl:grid-cols-[1.08fr_1.2fr_0.82fr] xl:divide-x xl:divide-y-0",
              // On a phone the billing steps aside once the ad is planned,
              // unless the star's answer is still needed (PT-05); once it is
              // filmed, the wall takes the stage at every width (lock-desktop).
              campaign && !starNeedsAnswer ? (filmed ? "hidden" : "max-md:hidden") : null,
            )}
          >
            {starTile}
            {productTile}
            {angleTile}
          </div>

          {filmed && campaign ? (
            <div className="mt-4">
              {stage === "animating" && (
                <p role="status" className="mb-3.5 rounded-2xl bg-[rgba(255,255,255,0.03)] px-4 py-3 text-[13px] leading-[1.45] text-[#9aa0ad] ring-1 ring-inset ring-[rgba(255,255,255,0.08)]">
                  <b className="block text-[14px] font-semibold text-[#ecedf1]">{formatMsg(m.filmingTitle, { n: shots.length })}</b>
                  {m.filmingBody}
                </p>
              )}
              {campaign.creditsRefunded > 0 && (
                <p role="status" className="mb-3 text-[12.5px] leading-[1.45] text-[#b9b2a6]">
                  {formatMsg(campaign.creditsRefunded === 1 ? m.creditsBackOne : m.creditsBack, { n: campaign.creditsRefunded })}
                </p>
              )}
              {stage === "ready" && campaign.master ? (
                <>
                  <FinishedCut
                    master={campaign.master}
                    poster={stills.find((x) => x.imageUrl)?.imageUrl ?? null}
                    productName={product?.card.name ?? null}
                    t={t}
                    keySlot={
                      <div className="flex flex-col gap-2 max-md:hidden">
                        {errorLine}
                        {keyNote}
                        {keyButton()}
                        {newAdControl}
                      </div>
                    }
                  />
                  <div className="mt-6 hidden lg:block">
                    <PressWall shots={shots} stills={stills} canAct={false} busyShot={null} act={wallAct} t={t} product={wallProduct} readOnly />
                  </div>
                  <div className="mt-6 lg:hidden">
                    <PhonePressWall shots={shots} stills={stills} canAct={false} busyShot={null} act={wallAct} t={t} product={wallProduct} readOnly />
                    {newAdControl && <div className="mt-2 md:hidden">{newAdControl}</div>}
                  </div>
                </>
              ) : (
                <>
                  {/* Three shots of three moments side by side, with why the worst missed and the choice beside it, need a wide card (lg); narrower, the phone's wall. */}
                  <div className="hidden lg:block">
                    <PressWall
                      shots={shots}
                      stills={stills}
                      canAct={canDecideWall}
                      busyShot={busyShot}
                      act={wallAct}
                      t={t}
                      product={wallProduct}
                      readOnly={stage !== "awaiting_approval"}
                      keySlot={
                        <>
                          {errorLine}
                          {keyNote}
                          {keyButton()}
                          {cancelControl}
                        </>
                      }
                    />
                    {stage !== "awaiting_approval" && (
                      <div className="ml-auto mt-3.5 flex max-w-[300px] flex-col gap-2">
                        {errorLine}
                        {keyNote}
                        {keyButton()}
                      </div>
                    )}
                  </div>
                  <div className="lg:hidden">
                    <PhonePressWall
                      shots={shots}
                      stills={stills}
                      canAct={canDecideWall}
                      busyShot={busyShot}
                      act={wallAct}
                      t={t}
                      product={wallProduct}
                      readOnly={stage !== "awaiting_approval"}
                    />
                    {/* Between a phone and a wide card, the key sits under the wall; a phone carries it in its dock, except while a shot waits (then it is the quiet second choice, here). */}
                    <div className={cn("mt-3 flex-col gap-2", dockShown ? "hidden md:flex" : "flex")}>
                      {errorLine}
                      {keyNote}
                      {keyButton()}
                    </div>
                    {cancelControl && <div className="mt-2">{cancelControl}</div>}
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
            {/* The running order. */}
            {/* On a phone the route line above already says where the stills are: the heading stays for screen readers only. */}
            <div className={cn("mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1", campaign && stills.length > 0 && "max-md:sr-only")}>
              <h2 className={LABEL}>{runningHead}</h2>
              {stage === "awaiting_approval" && <p className="text-[12.5px] text-[#9aa0ad] max-md:hidden">{m.approveHint}</p>}
            </div>

            <div className={cn("mt-3 grid gap-6 xl:grid-cols-[minmax(0,1fr)_268px]", campaign && stills.length > 0 && !starNeedsAnswer && "max-md:mt-1")}>
              <div className="min-w-0">
                {campaign && stills.length > 0 ? (
                  <>
                    {/* Side-by-side stills with their own keys need ~180 px each (a
                        1024 px window with the sidebar); narrower, the phone's
                        running order and its one decision card. */}
                    <div className="hidden lg:block">
                      <RunningOrder stills={stills} canAct={canAct} busyShot={busyShot} canRepaint={canRepaint} act={act} t={t} />
                    </div>
                    <div className="lg:hidden">
                      <PhoneRunningOrder
                        stills={stills}
                        canAct={canAct}
                        busyShot={busyShot}
                        canRepaint={canRepaint}
                        act={act}
                        t={t}
                        selected={shownShot}
                        onSelect={setSelectedShot}
                      />
                    </div>
                  </>
                ) : campaign && isClosed(campaign.stage) ? (
                  <p role="status" className="rounded-2xl bg-[rgba(255,255,255,0.03)] px-4 py-3.5 text-sm leading-[1.45] text-[#c6c9d1] ring-1 ring-inset ring-[rgba(255,255,255,0.08)]">
                    {server(campaign.error) ?? m.adStopped}
                  </p>
                ) : (
                  emptyStage
                )}
              </div>

              {/* The rail: the quote, what blocks the key, the key. A phone carries these in its dock. */}
              <aside className="hidden flex-col gap-2 md:flex" aria-label={m.quoteLabel}>
                {quote && <QuoteCard quote={quote} stills={stills.length} shotSeconds={perShot} m={m} />}
                {errorLine}
                {keyNote}
                {keyButton()}
                {cancelControl}
              </aside>
            </div>
            {/* A phone has no rail: closing the ad sits under the stills, or an ad left open could not be let go for 7 days. */}
            {cancelControl && <div className="mt-2 md:hidden">{cancelControl}</div>}
            </>
          )}

          {/* The accounts it posts to (web only to connect), once any network can take a post. */}
          {liveNetworks > 0 && <PostingAccounts publish={publish} campaignId={campaign?.id ?? null} connectNote={stage === "ready" && campaign?.master ? null : connectNote} />}
        </div>
      </DoorFrame>

      {/* The phone's dock: opaque, grows with its words, the key leaves the lamp its corner. */}
      {key && dockShown && (
        <>
          <div aria-hidden="true" className="md:hidden" style={{ height: dockRoom }} />
          <div ref={dockRef} className={s.dock}>
            <div className="mb-2 flex flex-col gap-[3px]">
              {errorLine}
              {key.blocker && <p className={s.blocker}>{key.blocker}</p>}
              {quote && spend && !quote.trial && (
                <p className="text-xs text-[#9aa0ad]">
                  {formatMsg(spend === "paint" ? m.dockPaint : m.dockFilm, {
                    n: spend === "paint" ? quote.paint : quote.animate,
                    now: quote.balanceNow,
                    after: quote.balanceAfterNextStep,
                  })}
                </p>
              )}
              {/* While a still waits, its decision card right above says the same (keep it, or repaint it): the dock does not repeat it. */}
              {quote && !quote.trial && quote.policy.reshoot === "off" && !quote.policy.refund && !waiting && !filmed && (
                <p className="text-[11.5px] leading-[1.4] text-[#858994]">{spend === "paint" ? m.policyOff : m.policyFilm}</p>
              )}
              {key.hint && <p className="text-[11.5px] leading-[1.4] text-[#858994]">{key.hint}</p>}
            </div>
            {keyButton(s.dockKey)}
          </div>
        </>
      )}

      {sheet && <ProductSheet initial={sheet.initial} brandKitId={kitId} onClose={() => setSheet(null)} onSaved={productSaved} />}

      {campaign && stage === "ready" && campaign.master && line !== "closed" && (
        <PressLine
          campaign={campaign}
          productName={product?.card.name ?? null}
          publish={publish}
          waitlist={waitlist}
          connectNote={line === "auto" ? connectNote : null}
          onClose={() => setLine("closed")}
        />
      )}
    </>
  );
}
