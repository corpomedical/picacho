"use client";

// "Verify it's you" on the character page (lib/faces/). Hidden unless face
// verification is on and this account may use it — getFaceStatus answers
// null otherwise. The consent step is the one BytePlus's usage rules ask for:
// the notice, an UNTICKED box, and a real way to say no; nothing about a
// face is processed before the box is ticked and Continue is pressed.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { formatMsg } from "@/lib/i18n/format";
import {
  addCharacterToFace,
  getFaceStatus,
  startFaceCheck,
  withdrawFaceVerification,
  type FaceStatus,
} from "@/lib/faces/actions";

const LABEL = "text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted";
const PRIMARY =
  "min-h-11 cursor-pointer rounded-full bg-atelier-accent px-[18px] py-2.5 text-xs font-semibold text-atelier-paper transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-50";
const TEXT_BUTTON =
  "cursor-pointer rounded-[4px] text-left text-[12px] font-medium text-atelier-accent underline-offset-2 hover:underline disabled:cursor-default disabled:text-atelier-muted disabled:no-underline";

export function FaceVerificationPanel({ characterId, notice }: { characterId: string; notice?: string }) {
  const { t, locale } = useLocale();
  const c = t.faces;
  const [status, setStatus] = useState<FaceStatus | null | undefined>(undefined);
  const [consenting, setConsenting] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    let live = true;
    getFaceStatus(characterId)
      .then((s) => live && setStatus(s))
      .catch(() => live && setStatus(null));
    return () => {
      live = false;
    };
  }, [characterId]);

  // Photos BytePlus is still comparing: ask again, for about two minutes.
  const checking = status?.photos.some((p) => p.status === "processing") ?? false;
  useEffect(() => {
    if (!checking || polls >= 24) return;
    const timer = setTimeout(() => {
      getFaceStatus(characterId)
        .then((s) => {
          setStatus(s);
          setPolls((n) => n + 1);
        })
        .catch(() => setPolls((n) => n + 1));
    }, 5000);
    return () => clearTimeout(timer);
  }, [checking, polls, characterId]);

  if (!status) return null;

  const banner =
    notice === "verified" ? c.bannerVerified : notice === "failed" ? c.bannerFailed : notice === "expired" ? c.bannerExpired : null;

  const begin = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await startFaceCheck({ characterId, consent: agreed, noticeVersion: status.noticeVersion });
      if (res.error !== null) {
        setMessage({ kind: "error", text: localizeServerText(res.error, t) });
        setBusy(false);
        return;
      }
      window.location.assign(res.link);
    } catch {
      setMessage({ kind: "error", text: c.couldntReach });
      setBusy(false);
    }
  };

  const reload = async () => setStatus(await getFaceStatus(characterId));

  const addPhotos = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await addCharacterToFace(characterId);
      if (res.error !== null) setMessage({ kind: "error", text: localizeServerText(res.error, t) });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(c.removeConfirm)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await withdrawFaceVerification(characterId);
      if (res.error !== null) setMessage({ kind: "error", text: localizeServerText(res.error, t) });
      else setMessage({ kind: "ok", text: c.removed });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const photoWord = (s: FaceStatus["photos"][number]["status"]) =>
    s === "active" ? c.photoReady : s === "failed" ? c.photoRefused : c.photoChecking;

  return (
    <section className="flex flex-col gap-4 border-t border-atelier-rule pt-4" aria-labelledby="face-verification-title">
      <div className="flex items-center justify-between gap-4">
        <h2 id="face-verification-title" className={LABEL}>
          {c.label}
        </h2>
        {status.state === "verified" && status.verifiedAt && (
          <span className="text-xs text-atelier-muted">
            {formatMsg(c.verifiedOn, { date: new Date(status.verifiedAt).toLocaleDateString(locale) })}
          </span>
        )}
      </div>

      {banner && (
        <p role="status" className={notice === "verified" ? "text-sm text-atelier-accent" : "text-sm text-red-600 dark:text-red-400"}>
          {banner}
        </p>
      )}

      {status.state === "none" && !consenting && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <p className="max-w-[560px] text-sm leading-[21px] text-atelier-ink">{c.intro}</p>
          <button
            type="button"
            className={PRIMARY}
            disabled={!status.hasPhotos}
            onClick={() => {
              setConsenting(true);
              setAgreed(false);
            }}
          >
            {c.verify}
          </button>
        </div>
      )}
      {status.state === "none" && !status.hasPhotos && <p className="text-sm text-atelier-muted">{c.needsPhoto}</p>}

      {status.state === "none" && consenting && (
        <div className="flex max-w-[620px] flex-col gap-3 rounded-2xl border border-atelier-rule p-4">
          <p className="text-sm font-semibold text-atelier-ink">{c.noticeTitle}</p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-[21px] text-atelier-ink">
            <li>{c.noticeOwnFace}</li>
            <li>{c.noticeCheck}</li>
            <li>{c.noticePhotos}</li>
            <li>{c.noticeKeep}</li>
          </ul>
          <Link href="/privacy#facial-information" target="_blank" className="text-sm text-atelier-accent underline underline-offset-2">
            {c.noticePolicy}
          </Link>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-atelier-ink">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-atelier-accent"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <span>{c.consent}</span>
          </label>
          <p className="text-xs text-atelier-muted">{c.languageNote}</p>
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" className={PRIMARY} disabled={!agreed || busy} onClick={begin}>
              {busy ? c.opening : c.continue}
            </button>
            <button type="button" className={TEXT_BUTTON} disabled={busy} onClick={() => setConsenting(false)}>
              {c.notNow}
            </button>
          </div>
        </div>
      )}

      {status.state === "verified" && !status.isThisCharacter && status.photos.length === 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
          <p className="max-w-[560px] text-sm leading-[21px] text-atelier-ink">{c.otherCharacter}</p>
          <button type="button" className={PRIMARY} disabled={busy || !status.hasPhotos} onClick={addPhotos}>
            {c.addPhotos}
          </button>
        </div>
      )}

      {status.state === "verified" && status.photos.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={LABEL}>{c.photosLabel}</span>
          <ul className="flex flex-col gap-1.5">
            {status.photos.map((p) => (
              <li key={p.path} className="flex items-center justify-between gap-4 text-sm text-atelier-ink">
                <span className="truncate text-atelier-muted">{p.path.split("/").pop()}</span>
                <span className={p.status === "active" ? "text-atelier-accent" : p.status === "failed" ? "text-red-600 dark:text-red-400" : "text-atelier-muted"}>
                  {photoWord(p.status)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status.state === "verified" && (
        <div>
          <button type="button" className={TEXT_BUTTON} disabled={busy} onClick={remove}>
            {c.remove}
          </button>
        </div>
      )}

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-red-600 dark:text-red-400" : "text-sm text-atelier-accent"}>
          {message.text}
        </p>
      )}
    </section>
  );
}
