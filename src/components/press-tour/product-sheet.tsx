"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useLocale } from "@/lib/i18n/provider";
import { formatMsg } from "@/lib/i18n/format";
import { localizeServerText } from "@/lib/i18n/server-text";
import { createClient } from "@/lib/supabase/client";
import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";
import { useBackCloser } from "@/lib/native/back-stack";
import {
  confirmProductCard,
  createProductFromUploads,
  importProductFromUrl,
  recordConsent,
  reservePressUploads,
} from "@/lib/press-tour/actions";
import { recordStarConsent } from "@/lib/press-tour/star-consent-actions";
import {
  PRODUCT_REGULATED_REFUSED,
  PRODUCT_VIEWS,
  normaliseLabelStrings,
  normalisePalette,
  type ConsentAnswer,
  type ProductCard,
  type ProductView,
} from "@/lib/press-tour/types";
import { PICK_MAX, cardSaveBlock, type Box, type StarAnswer } from "@/lib/press-tour/door-view";
import type { PressCharacter, PressProduct } from "@/lib/press-tour/door-data";
import { cn } from "@/lib/cn";
import { ROW, RadioDot, TickBox } from "./controls";
import { CheckIcon, CloseIcon, EditIcon, InfoIcon, LinkIcon, PhotosIcon, UploadIcon } from "./icons";
import { LogoCrop } from "./logo-crop";
import { StarAskFields, type StarDraft } from "./star-ask";
import s from "./press-tour.module.css";

// THE PRODUCT CARD (spec §1.1; synthesis §2.3 item 1; the
// product-import-phone artboard): the co-star, read from its page or from
// the person's own photos, then set by the person: 3–5 angles (one the
// front), the words on the label ticked and spelled (or "No readable text
// on this product"), an optional logo box, the colours, and "I own this
// product or may advertise it" — then, when the star has not answered yet,
// who the star is and that they may appear in ads.
//
// Every step is a server action in lib/press-tour/actions.ts (card-service
// decides; this sheet only asks). What the server answers in English is
// shown through localizeServerText; a regulated product gets the refusal
// in the person's language and cannot be saved.

type Word = { key: string; read: string | null; text: string; ticked: boolean; editing: boolean };

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const UPLOADS_AT_ONCE = 5;

export type ProductSaved = { product: PressProduct; starAnswer: StarAnswer | null };

export function ProductSheet({
  initial,
  star,
  brandKitId,
  onClose,
  onSaved,
}: {
  /** A draft card to finish, or null to start one. */
  initial: PressProduct | null;
  /** The star the door has chosen: asked here too when it has no answer yet. */
  star: PressCharacter | null;
  brandKitId: string | null;
  onClose: () => void;
  onSaved: (saved: ProductSaved) => void;
}) {
  const { t } = useLocale();
  const m = t.pressTour;
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"link" | "photos">("link");
  const [url, setUrl] = useState(initial?.card.sourceUrl ?? "");
  const [card, setCard] = useState<ProductCard | null>(initial?.card ?? null);
  const [urls, setUrls] = useState<Record<string, string>>(initial?.photoUrls ?? {});
  const [picked, setPicked] = useState<string[]>(() => (initial ? initial.card.photos.slice(0, PICK_MAX) : []));
  const [views, setViews] = useState<Record<string, ProductView>>(() => {
    const out: Record<string, ProductView> = {};
    for (const a of initial?.card.angles ?? []) out[a.path] = a.view;
    const first = initial?.card.photos[0];
    if (first && !Object.values(out).includes("front")) out[first] = "front";
    return out;
  });
  const [words, setWords] = useState<Word[]>(() =>
    (initial?.card.labelStrings ?? []).map((w, i) => ({ key: `s${i}`, read: null, text: w, ticked: true, editing: false })),
  );
  const [noText, setNoText] = useState(initial?.card.noReadableText ?? false);
  const [newWord, setNewWord] = useState("");
  const [reading, setReading] = useState<"read" | "not_configured" | "unavailable">("read");
  const [skipped, setSkipped] = useState(0);
  const [readLater, setReadLater] = useState(false);
  const [name, setName] = useState(initial?.card.name ?? "");
  const [palette, setPalette] = useState<string[]>(initial?.card.palette ?? []);
  const [logo, setLogo] = useState<Box | null>(null);
  const [logoDone, setLogoDone] = useState<"used" | "skipped" | null>(null);
  const [consent, setConsent] = useState<ConsentAnswer | null>(null);
  const starOpen = !!star && star.photoCount > 0 && !star.adAnswer;
  const [starDraft, setStarDraft] = useState<StarDraft>({ answer: null, adsOk: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(initial?.card.category === "regulated");
  // The card self-test's answer: the chosen photos that did not read as the product.
  const [flagged, setFlagged] = useState<string[]>([]);

  useBackCloser(true, onClose);

  // Focus the sheet's close button on open; give focus back on close.
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

  const front = picked.find((p) => views[p] === "front") ?? null;
  // A box drawn on one photo means nothing on another: a new front starts over.
  const [logoOn, setLogoOn] = useState<string | null>(null);
  if (front !== logoOn) {
    setLogoOn(front);
    setLogo(null);
    setLogoDone(null);
  }

  async function guard<T>(work: () => Promise<T>): Promise<T | null> {
    try {
      return await work();
    } catch (err) {
      if (isStaleDeployError(err) && reloadForNewDeploy()) return null;
      setError(m.failed);
      return null;
    }
  }

  /** A card came back from a read: its photos, its words, its colours join what the person has. */
  function take(res: { card: ProductCard; photoUrls: Record<string, string>; labelCandidates: string[]; labelReading: typeof reading; productRead: "read" | "unavailable"; photosSkipped: number }) {
    const next = res.card;
    setCard(next);
    setUrls((prev) => ({ ...prev, ...res.photoUrls }));
    setReading(res.labelReading);
    setSkipped(res.photosSkipped);
    setReadLater(res.productRead === "unavailable");
    setRefused(next.category === "regulated");
    if (!name) setName(next.name);
    setPalette((prev) => (prev.length > 0 ? prev : next.palette));
    setPicked((prev) => {
      const kept = prev.filter((p) => next.photos.includes(p));
      const fresh = next.photos.filter((p) => !kept.includes(p));
      return [...kept, ...fresh].slice(0, Math.max(kept.length, PICK_MAX));
    });
    setViews((prev) => {
      const out = { ...prev };
      const firstNew = next.photos.find((p) => !out[p]);
      if (!Object.values(out).includes("front") && firstNew) out[firstNew] = "front";
      for (const p of next.photos) out[p] ??= "three_quarter";
      return out;
    });
    setWords((prev) => {
      const seen = new Set(prev.map((w) => w.text.toLocaleLowerCase()));
      const add = res.labelCandidates
        .filter((c) => !seen.has(c.toLocaleLowerCase()))
        .map((c, i) => ({ key: `c${Date.now()}-${i}`, read: c, text: c, ticked: false, editing: false }));
      return [...prev, ...add];
    });
  }

  async function readLink() {
    if (busy || !url.trim()) return;
    setError(null);
    setBusy(m.reading);
    const res = await guard(() => importProductFromUrl({ url: url.trim(), brandKitId }));
    setBusy(null);
    if (!res) return;
    if (res.error !== null) {
      if (res.code === "regulated") setRefused(true);
      setError(res.error);
      return;
    }
    take(res);
  }

  async function addFiles(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => IMAGE_TYPES.includes(f.type)).slice(0, UPLOADS_AT_ONCE);
    if (fileRef.current) fileRef.current.value = "";
    if (busy || files.length === 0) return;
    setError(null);
    setBusy(formatMsg(m.uploading, { n: 1, total: files.length }));
    const places = await guard(() => reservePressUploads({ purpose: "product", files: files.map((f) => ({ bytes: f.size, type: f.type })) }));
    if (!places) return setBusy(null);
    if (places.error !== null) {
      setBusy(null);
      setError(places.error);
      return;
    }
    const supabase = createClient();
    for (const [i, place] of places.uploads.entries()) {
      setBusy(formatMsg(m.uploading, { n: i + 1, total: places.uploads.length }));
      const { error: upErr } = await supabase.storage.from(places.bucket).uploadToSignedUrl(place.path, place.token, files[i], { contentType: files[i].type });
      if (upErr) {
        setBusy(null);
        setError(m.uploadFailed);
        return;
      }
    }
    setBusy(m.reading);
    const res = await guard(() =>
      createProductFromUploads({
        uploads: places.uploads.map((u) => u.path),
        productId: card && card.status === "draft" ? card.id : null,
        url: !card && url.trim() ? url.trim() : null,
        brandKitId,
      }),
    );
    setBusy(null);
    if (!res) return;
    if (res.error !== null) {
      if (res.code === "regulated") setRefused(true);
      setError(res.error);
      return;
    }
    take(res);
  }

  function togglePick(path: string) {
    setPicked((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : prev.length >= PICK_MAX ? prev : [...prev, path]));
  }

  function setView(path: string, view: ProductView) {
    setViews((prev) => {
      const out = { ...prev, [path]: view };
      // One front: choosing a new one moves the old one to three-quarter.
      if (view === "front") for (const p of Object.keys(out)) if (p !== path && out[p] === "front") out[p] = "three_quarter";
      return out;
    });
  }

  function addWord() {
    const text = newWord.trim();
    if (!text) return;
    setWords((prev) => (prev.some((w) => w.text.toLocaleLowerCase() === text.toLocaleLowerCase()) ? prev : [...prev, { key: `t${Date.now()}`, read: null, text, ticked: true, editing: false }]));
    setNewWord("");
    setNoText(false);
  }

  const labelStrings = normaliseLabelStrings(words.filter((w) => w.ticked).map((w) => w.text));
  const block = card
    ? cardSaveBlock({
        picked: picked.length,
        hasFront: front !== null,
        words: labelStrings.length,
        noReadableText: noText,
        consent: consent !== null,
        starOpen,
        starAnswered: starDraft.answer !== null && starDraft.adsOk,
      })
    : null;

  async function save() {
    if (!card || busy || refused || block) return;
    setError(null);
    setBusy(m.saving);
    const consented = await guard(() => recordConsent({ kind: "product", productId: card.id, photos: picked, answer: consent!, place: "door" }));
    if (!consented) return setBusy(null);
    if (consented.error !== null) {
      setBusy(null);
      setError(consented.error);
      return;
    }
    let starAnswer: StarAnswer | null = null;
    if (starOpen && star && starDraft.answer) {
      const kept = await guard(() => recordStarConsent({ characterId: star.id, answer: starDraft.answer!, adsOk: starDraft.adsOk }));
      if (!kept) return setBusy(null);
      if (kept.error !== null) {
        setBusy(null);
        setError(kept.error);
        return;
      }
      starAnswer = kept.answer;
    }
    const res = await guard(() =>
      confirmProductCard({
        productId: card.id,
        angles: picked.map((path) => ({ path, view: views[path] ?? "three_quarter" })),
        labelStrings: noText ? [] : labelStrings,
        noReadableText: noText,
        logoBox: logo && front && logoDone === "used" ? { path: front, ...logo } : null,
        palette: normalisePalette(palette),
        name: name.trim() || undefined,
        brandKitId,
      }),
    );
    setBusy(null);
    if (!res) return;
    if (res.error !== null) {
      if (res.code === "regulated") setRefused(true);
      setFlagged(res.code === "selfTest" ? (res.photos ?? []) : []);
      setError(res.error);
      return;
    }
    setFlagged([]);
    onSaved({ product: { card: res.card, photoUrls: res.photoUrls }, starAnswer });
  }

  const blockWords: Record<NonNullable<typeof block>, string> = {
    photos: m.blockPhotos,
    front: m.blockFront,
    words: m.blockWords,
    consent: m.blockConsent,
    star: m.blockStar,
  };
  const photos = card?.photos ?? [];
  const viewWord: Record<ProductView, string> = {
    front: m.viewFront,
    back: m.viewBack,
    side: m.viewSide,
    three_quarter: m.viewThreeQuarter,
    top: m.viewTop,
    detail: m.viewDetail,
    in_use: m.viewInUse,
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(6,5,4,0.62)] md:items-center md:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative isolate flex max-h-[calc(100dvh-24px)] w-full flex-col overflow-hidden rounded-t-[18px] bg-[linear-gradient(180deg,#1b1714_0%,#110f0c_30%)] text-[#c6c9d1] shadow-[inset_0_1px_0_rgba(255,240,220,0.07),0_32px_72px_-28px_rgba(0,0,0,0.8)] md:max-h-[calc(100dvh-48px)] md:max-w-[560px] md:rounded-[24px]"
      >
        <div className={s.rig} aria-hidden="true">
          <i style={{ left: 60, width: 300, top: -90 }} />
        </div>
        <header className="relative z-[1] flex items-start justify-between gap-3 px-4 pt-3 md:px-6 md:pt-5">
          <div className="min-w-0">
            <p className="font-slate text-[11px] font-medium uppercase tracking-[0.12em] text-[#858994]">{m.cardEyebrow}</p>
            <h2 id={titleId} className="marquee mt-1.5 bg-[linear-gradient(180deg,#fbf6ee_18%,#b9ad9c_100%)] bg-clip-text text-xl leading-none text-transparent">
              {m.cardTitle}
            </h2>
            <p className="mt-2 max-w-[340px] text-[13px] leading-[1.42] text-[#9aa0ad]">{m.cardSub}</p>
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

        <div className="relative z-[1] min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-4 pb-4 pt-2 md:px-6">
          {/* 1 · Where is it? */}
          <Sec n={1} title={m.cardStep1}>
            <div role="tablist" aria-label={m.cardStep1} className="mt-2.5 grid grid-cols-2 rounded-[11px] bg-[rgba(255,255,255,0.04)] p-[3px] ring-1 ring-inset ring-[rgba(255,255,255,0.08)]">
              {(["link", "photos"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={mode === k}
                  onClick={() => setMode(k)}
                  className={cn(
                    "flex min-h-11 items-center justify-center gap-1.5 rounded-lg text-[13.5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6]",
                    mode === k ? "bg-[rgba(255,255,255,0.08)] font-medium text-[#ecedf1]" : "text-[#9aa0ad]",
                  )}
                >
                  {k === "link" ? <LinkIcon className="h-3.5 w-3.5" /> : <PhotosIcon className="h-3.5 w-3.5" />}
                  {k === "link" ? m.byLink : m.byPhotos}
                </button>
              ))}
            </div>
            {mode === "link" ? (
              <form
                className="mt-2.5 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void readLink();
                }}
              >
                <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-[rgba(255,255,255,0.03)] px-3 ring-1 ring-inset ring-[rgba(255,255,255,0.14)] focus-within:ring-[rgba(240,196,142,0.65)]">
                  <LinkIcon className="h-[15px] w-[15px] flex-none text-[#9aa0ad]" />
                  <span className="sr-only">{m.linkLabel}</span>
                  <input
                    type="text"
                    inputMode="url"
                    autoComplete="url"
                    spellCheck={false}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={m.linkPlaceholder}
                    className="min-w-0 flex-1 bg-transparent text-[13.5px] text-[#ecedf1] placeholder:text-[#62656e] focus:outline-none"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!!busy || !url.trim()}
                  className="min-h-11 flex-none rounded-xl px-3.5 text-[13.5px] font-medium text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.16)] hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] disabled:opacity-50"
                >
                  {m.readPage}
                </button>
              </form>
            ) : (
              photos.length === 0 && (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => fileRef.current?.click()}
                  className="mt-2.5 flex min-h-[88px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[rgba(255,255,255,0.2)] text-[13px] text-[#9aa0ad] hover:text-[#ecedf1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] disabled:opacity-50"
                >
                  <UploadIcon className="h-[18px] w-[18px]" />
                  {m.choosePhotos}
                </button>
              )
            )}
            <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(",")} multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void addFiles(e.target.files)} />

            {card && (
              <>
                {card.sourceUrl && (
                  <p className="mt-2 text-[11.5px] text-[#f0cda6]">{formatMsg(m.photosFound, { n: photos.length })}</p>
                )}
                <label className="mt-3 block text-[12px] text-[#9aa0ad]">
                  {m.nameLabel}
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                    className="mt-1 block min-h-11 w-full rounded-xl bg-[rgba(255,255,255,0.03)] px-3 text-[14px] text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.14)] focus:outline-none focus:ring-[rgba(240,196,142,0.65)]"
                  />
                </label>
                <p className="mt-3 text-[12.5px] leading-[1.42] text-[#9aa0ad]">{m.pickHint}</p>
                <ul className="mt-2.5 grid grid-cols-3 gap-2">
                  {photos.map((path, i) => {
                    const on = picked.includes(path);
                    const marked = flagged.includes(path);
                    return (
                      <li key={path} className="min-w-0">
                        <button
                          type="button"
                          aria-pressed={on}
                          aria-label={marked ? `${formatMsg(m.photoN, { n: i + 1 })}: ${m.photoMarked}` : formatMsg(m.photoN, { n: i + 1 })}
                          disabled={!on && picked.length >= PICK_MAX}
                          onClick={() => togglePick(path)}
                          className={cn(
                            "relative block h-[118px] w-full overflow-hidden rounded-[10px] bg-[#101116] ring-1 ring-[rgba(255,255,255,0.1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f0cda6] disabled:opacity-50 md:h-[128px]",
                            marked ? s.waiting : on && s.tilePicked,
                          )}
                        >
                          {urls[path] && (
                            // eslint-disable-next-line @next/next/no-img-element -- a short-lived private link to the person's own photo
                            <img src={urls[path]} alt="" className="h-full w-full object-cover" />
                          )}
                          <span
                            aria-hidden="true"
                            className={cn(
                              "absolute right-1.5 top-1.5 grid h-[22px] w-[22px] place-items-center rounded-md",
                              on ? "bg-[#f0cda6] text-[#1a1410]" : "bg-[rgba(14,12,10,0.75)] shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.5)]",
                            )}
                          >
                            {on && <CheckIcon className="h-[13px] w-[13px]" />}
                          </span>
                          {marked && (
                            <span aria-hidden="true" className="absolute bottom-1.5 left-1.5 rounded-[5px] bg-[rgba(230,196,110,0.92)] px-1.5 py-0.5 text-[11px] font-semibold text-[#1a1410]">
                              {m.photoMarked}
                            </span>
                          )}
                        </button>
                        {on && (
                          <label className="mt-1 block">
                            <span className="sr-only">{formatMsg(m.viewOf, { n: i + 1 })}</span>
                            <select
                              value={views[path] ?? "three_quarter"}
                              onChange={(e) => setView(path, e.target.value as ProductView)}
                              className="min-h-11 w-full rounded-lg bg-[rgba(255,255,255,0.04)] px-2 text-[12.5px] text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.12)] focus:outline-none focus:ring-[rgba(240,196,142,0.65)]"
                            >
                              {PRODUCT_VIEWS.map((v) => (
                                <option key={v} value={v} className="bg-[#16130f]">
                                  {viewWord[v]}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </li>
                    );
                  })}
                  {card.status === "draft" && photos.length < 8 && (
                    <li>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => fileRef.current?.click()}
                        className="grid h-[118px] w-full place-items-center rounded-[10px] border border-dashed border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.02)] px-2 text-center text-[12px] text-[#9aa0ad] hover:text-[#ecedf1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] disabled:opacity-50 md:h-[128px]"
                      >
                        <span>
                          <UploadIcon className="mx-auto mb-1.5 h-[18px] w-[18px]" />
                          {m.addPhotos}
                        </span>
                      </button>
                    </li>
                  )}
                </ul>
                <p className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-[12px] text-[#9aa0ad]">
                  <span>
                    <b className="font-medium text-[#f0cda6]">{picked.length}</b> {m.picked}
                  </span>
                  <span>{m.keepNote}</span>
                </p>
                {skipped > 0 && <p className="mt-1 text-[11.5px] text-[#858994]">{formatMsg(m.photosSkipped, { n: skipped })}</p>}
                {readLater && <p className="mt-1 text-[11.5px] text-[#858994]">{m.readLater}</p>}
              </>
            )}
            {refused && (
              <p role="alert" className="mt-3 flex gap-2 rounded-xl bg-[rgba(255,255,255,0.03)] px-3 py-2.5 text-[12.5px] leading-[1.42] text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.12)]">
                <InfoIcon className="mt-px h-3.5 w-3.5 flex-none text-[#e0a468]" />
                {localizeServerText(PRODUCT_REGULATED_REFUSED, t)}
              </p>
            )}
          </Sec>

          {card && !refused && (
            <>
              {/* 2 · Words on the label */}
              <Sec n={2} title={m.cardStep2}>
                <p className="mt-1.5 text-[12.5px] leading-[1.42] text-[#9aa0ad]">{reading === "read" && words.some((w) => w.read) ? m.wordsLede : m.wordsManual}</p>
                <ul className="mt-2.5 flex flex-col gap-1.5">
                  {words.map((w) => (
                    <li
                      key={w.key}
                      className={cn(
                        "flex min-h-11 items-center gap-2.5 rounded-xl bg-[rgba(255,255,255,0.02)] px-2.5 py-1.5 ring-1 ring-inset",
                        w.editing ? "ring-[1.5px] ring-[rgba(240,196,142,0.65)]" : "ring-[rgba(255,255,255,0.08)]",
                        noText && "opacity-50",
                      )}
                    >
                      <TickBox
                        checked={w.ticked && !noText}
                        disabled={noText}
                        label={w.text}
                        onChange={(ticked) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, ticked } : x)))}
                      />
                      <span className="min-w-0 flex-1">
                        {w.editing ? (
                          <input
                            autoFocus
                            value={w.text}
                            maxLength={80}
                            aria-label={formatMsg(m.fixSpelling, { word: w.read ?? w.text })}
                            onChange={(e) => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, text: e.target.value } : x)))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, editing: false, ticked: true } : x)));
                            }}
                            className="w-full border-b-[1.5px] border-[#f0cda6] bg-transparent font-slate text-[14px] font-medium tracking-[0.04em] text-[#ecedf1] focus:outline-none"
                          />
                        ) : (
                          <span className="block break-words font-slate text-[14px] font-medium tracking-[0.04em] text-[#ecedf1]">{w.text}</span>
                        )}
                        {w.read && w.read !== w.text && <small className="mt-px block text-[11.5px] text-[#858994]">{formatMsg(m.youFixed, { was: w.read })}</small>}
                      </span>
                      <button
                        type="button"
                        disabled={noText}
                        aria-label={w.editing ? m.doneEditing : formatMsg(m.fixSpelling, { word: w.text })}
                        onClick={() => setWords((prev) => prev.map((x) => (x.key === w.key ? { ...x, editing: !x.editing, ticked: x.editing ? true : x.ticked } : x)))}
                        className="grid h-11 w-11 flex-none place-items-center rounded-lg text-[#9aa0ad] hover:text-[#ecedf1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6]"
                      >
                        {w.editing ? <CheckIcon className="h-[15px] w-[15px]" /> : <EditIcon className="h-[15px] w-[15px]" />}
                      </button>
                    </li>
                  ))}
                </ul>
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addWord();
                  }}
                >
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">{m.addWord}</span>
                    <input
                      value={newWord}
                      onChange={(e) => setNewWord(e.target.value)}
                      maxLength={80}
                      disabled={noText}
                      placeholder={m.addWordPlaceholder}
                      className="min-h-11 w-full rounded-xl bg-[rgba(255,255,255,0.03)] px-3 font-slate text-[13px] tracking-[0.04em] text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.12)] placeholder:font-sans placeholder:tracking-normal placeholder:text-[#62656e] focus:outline-none focus:ring-[rgba(240,196,142,0.65)] disabled:opacity-50"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={noText || !newWord.trim()}
                    className="min-h-11 flex-none rounded-xl px-3.5 text-[13.5px] font-medium text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.16)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] disabled:opacity-50"
                  >
                    {m.addWord}
                  </button>
                </form>
                <label className={cn(ROW, "mt-2")}>
                  <TickBox checked={noText} onChange={setNoText} />
                  <span>{m.noReadableText}</span>
                </label>
                <p className="mt-2 flex gap-[7px] text-[12px] leading-[1.42] text-[#9aa0ad]">
                  <InfoIcon className="mt-px h-3.5 w-3.5 flex-none text-[#e0a468]" />
                  {m.wordsNote}
                </p>
              </Sec>

              {/* 3 · Your logo, and the colours */}
              <Sec n={3} title={m.cardStep3} aside={m.optional}>
                {front && urls[front] ? (
                  logoDone ? (
                    <div className="mt-2 flex min-h-11 items-center justify-between gap-3 text-[13px] text-[#c6c9d1]">
                      <span className="flex items-center gap-2">
                        {logoDone === "used" && <CheckIcon className="h-3.5 w-3.5 text-[#e0a468]" />}
                        {logoDone === "used" ? m.logoMarked : m.logoSkipped}
                      </span>
                      <button type="button" onClick={() => setLogoDone(null)} className={GHOST}>
                        {m.change}
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="mt-1.5 text-[12.5px] leading-[1.42] text-[#9aa0ad]">{m.logoLede}</p>
                      <LogoCrop src={urls[front]} box={logo} onChange={setLogo} m={m} />
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        {logo ? (
                          <button type="button" onClick={() => setLogoDone("used")} className={GHOST}>
                            {m.useCrop}
                          </button>
                        ) : (
                          <button type="button" onClick={() => setLogo({ x: 0.3, y: 0.35, w: 0.4, h: 0.2 })} className={GHOST}>
                            {m.placeBox}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setLogo(null);
                            setLogoDone("skipped");
                          }}
                          className={GHOST}
                        >
                          {m.skip}
                        </button>
                      </div>
                    </>
                  )
                ) : (
                  <p className="mt-1.5 text-[12.5px] leading-[1.42] text-[#9aa0ad]">{m.logoNeedsFront}</p>
                )}
                <p className="mt-3 text-[12.5px] leading-[1.42] text-[#9aa0ad]">{palette.length > 0 ? m.coloursLede : m.coloursLater}</p>
                {palette.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {palette.map((hex, i) => (
                      <li key={`${i}-${hex}`}>
                        <label className="relative flex min-h-11 cursor-pointer items-center gap-1.5 rounded-[9px] pl-1.5 pr-2.5 font-slate text-[12px] uppercase text-[#c6c9d1] ring-1 ring-inset ring-[rgba(255,255,255,0.12)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#f0cda6]">
                          <span aria-hidden="true" className="h-[18px] w-[18px] rounded-[5px] ring-1 ring-inset ring-[rgba(255,255,255,0.2)]" style={{ backgroundColor: hex }} />
                          {hex}
                          <input
                            type="color"
                            value={hex}
                            aria-label={formatMsg(m.colourN, { n: i + 1 })}
                            onChange={(e) => setPalette((prev) => prev.map((c, j) => (j === i ? e.target.value.toLowerCase() : c)))}
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                          />
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </Sec>

              {/* 4 · Yours to advertise */}
              <Sec n={4} title={m.cardStep4}>
                <fieldset className="mt-2.5 grid gap-2">
                  <legend className="sr-only">{m.cardStep4}</legend>
                  {(
                    [
                      ["own", m.consentOwn],
                      ["permission", m.consentPermission],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className={cn(ROW, "items-start py-3 leading-[1.42] has-[:checked]:ring-[rgba(240,196,142,0.65)]")}>
                      <span className="mt-px">
                        <RadioDot name={`${titleId}-consent`} checked={consent === value} onChange={() => setConsent(value)} />
                      </span>
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              </Sec>

              {/* 5 · Starring, while the star has not answered */}
              {starOpen && star && (
                <Sec n={5} title={m.starring}>
                  <div className="mt-2.5 flex items-center gap-2.5">
                    {star.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- our own media route, already sized
                      <img src={star.photoUrl} alt="" className="h-11 w-11 flex-none rounded-[10px] object-cover ring-1 ring-[rgba(255,240,220,0.22)]" />
                    ) : (
                      <span aria-hidden="true" className="h-11 w-11 flex-none rounded-[10px] bg-[rgba(255,255,255,0.05)]" />
                    )}
                    <p className="font-numeral text-[22px] italic leading-none text-[#f0cda6]">
                      {star.name || m.untitledStar}
                      <small className="mt-1 block font-sans text-[12px] not-italic text-[#9aa0ad]">{m.yourCharacter}</small>
                    </p>
                  </div>
                  <div className="mt-2.5">
                    <StarAskFields name={star.name} draft={starDraft} onChange={setStarDraft} m={m} />
                  </div>
                </Sec>
              )}
            </>
          )}
        </div>

        <footer className="relative z-[1] flex-none bg-[#110f0c] px-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-2.5 shadow-[0_-1px_0_rgba(243,237,228,0.07)] md:px-6 md:pb-5">
          <div aria-live="polite" className="min-h-0">
            {error ? (
              <p role="alert" className="mb-2 text-[12.5px] leading-[1.4] text-[#eed6a0]">
                {localizeServerText(error, t)}
              </p>
            ) : busy ? (
              <p className="mb-2 text-[12.5px] text-[#9aa0ad]">{busy}</p>
            ) : card && block ? (
              <p id={`${titleId}-block`} className={cn(s.blocker, "mb-1")}>
                {blockWords[block]}
              </p>
            ) : null}
          </div>
          {card && !refused && <p className="mb-2.5 text-[12px] leading-[1.45] text-[#9aa0ad]">{m.saveNote}</p>}
          <button
            type="button"
            onClick={() => void save()}
            aria-disabled={!card || !!block || !!busy || refused}
            aria-describedby={card && block ? `${titleId}-block` : undefined}
            className={s.key}
          >
            {busy === m.saving ? m.saving : m.saveProduct}
          </button>
        </footer>
      </section>
    </div>
  );
}

const GHOST =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13.5px] font-medium text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.16)] hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6]";

function Sec({ n, title, aside, children }: { n: number; title: string; aside?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-2xl bg-[rgba(255,255,255,0.028)] p-3 ring-1 ring-inset ring-[rgba(255,255,255,0.08)]">
      <div className="flex items-baseline gap-2">
        <span aria-hidden="true" className="font-numeral text-lg leading-none text-[#e0a468]">
          {n}
        </span>
        <h3 id={id} className="text-[15px] font-semibold text-[#ecedf1]">
          {title}
        </h3>
        {aside && <span className="ml-auto text-[11.5px] text-[#858994]">{aside}</span>}
      </div>
      {children}
    </section>
  );
}
