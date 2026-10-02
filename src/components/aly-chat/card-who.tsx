"use client";

import { useEffect, useState } from "react";
import { cardCast, chatFileLink } from "@/lib/aly-chat/actions";
import type { CardChoice, CardPhoto, CardWho, PhotoJob } from "@/lib/aly-chat/card-photos-rules";

// A picture card's "who" switch and its photos with their jobs (operator,
// 2026-10-02, drafts at claude.ai/artifact/7MEQAvkT4VufEiy5Mu75Pj → 3A "the
// card shows each photo and its job", 4B "your photo wins, the card lets you
// switch"). Shown while the card waits for Make it; the rules of what may
// change live in card-photos-rules.ts.

type Labels = {
  who: string;
  whoPhoto: string;
  whoNoOne: string;
  usesPhotos: string;
  photoJob: string;
  person: string;
  product: string;
  unused: string;
};

type Cast = { id: string; name: string; photoUrl: string | null };

const JOBS: PhotoJob[] = ["person", "product", "unused"];

export function CardWhoAndPhotos({
  photos,
  choice,
  onJob,
  onWho,
  labels,
}: {
  photos: readonly CardPhoto[];
  choice: CardChoice;
  onJob: (fileId: string, job: PhotoJob) => void;
  onWho: (who: CardWho) => void;
  labels: Labels;
}) {
  const [open, setOpen] = useState<"who" | string | null>(null);
  const [cast, setCast] = useState<Cast[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  // Each photo's picture, from the chat's own short-lived link (read again
  // only when the photos themselves change, not on every redraw of the chat).
  const photoKey = photos.map((p) => p.fileId).join(",");
  useEffect(() => {
    let live = true;
    void Promise.all(
      photos.map(async (p) => {
        const r = await chatFileLink(p.fileId).catch(() => null);
        return [p.fileId, r && "url" in r ? r.url : ""] as const;
      }),
    ).then((pairs) => {
      if (live) setThumbs(Object.fromEntries(pairs.filter(([, u]) => u)));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey]);

  // Their characters, read when the menu first opens.
  useEffect(() => {
    if (open !== "who" || cast) return;
    let live = true;
    void cardCast()
      .catch(() => [])
      .then((list) => {
        if (live) setCast(list);
      });
    return () => {
      live = false;
    };
  }, [open, cast]);

  const personPhoto = photos.find((p) => choice.jobs[p.fileId] === "person");
  const whoLabel =
    choice.who.kind === "photo" ? labels.whoPhoto : choice.who.kind === "character" ? choice.who.name : labels.whoNoOne;
  const whoThumb =
    choice.who.kind === "photo" && personPhoto
      ? thumbs[personPhoto.fileId]
      : choice.who.kind === "character"
        ? (cast?.find((c) => c.id === (choice.who as { id: string }).id)?.photoUrl ?? null)
        : null;
  const jobLabel = (j: PhotoJob) => (j === "person" ? labels.person : j === "product" ? labels.product : labels.unused);
  const row = "flex w-full items-center gap-2 border-t border-atelier-rule px-3 py-2 text-left text-[13px] first:border-t-0 hover:bg-atelier-ink/[0.04]";

  return (
    <div className="space-y-2">
      <div>
        <button
          type="button"
          aria-label={labels.who}
          aria-expanded={open === "who"}
          onClick={() => setOpen(open === "who" ? null : "who")}
          className="inline-flex items-center gap-1.5 rounded-full border border-atelier-accent py-0.5 pl-1 pr-2.5 text-[12.5px] text-atelier-ink"
        >
          <Face src={whoThumb} round />
          {whoLabel} <span aria-hidden="true">▾</span>
        </button>
        {open === "who" && (
          <div className="mt-1.5 overflow-hidden rounded-xl border border-atelier-rule bg-atelier-paper" role="menu">
            {photos.length > 0 && (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={choice.who.kind === "photo"}
                className={`${row} ${choice.who.kind === "photo" ? "text-atelier-accent" : "text-atelier-ink"}`}
                onClick={() => {
                  onWho({ kind: "photo" });
                  setOpen(null);
                }}
              >
                <Face src={personPhoto ? thumbs[personPhoto.fileId] : thumbs[photos[0].fileId]} round />
                {labels.whoPhoto}
                {choice.who.kind === "photo" && <span className="ml-auto">✓</span>}
              </button>
            )}
            {(cast ?? []).map((ch) => {
              const on = choice.who.kind === "character" && choice.who.id === ch.id;
              return (
                <button
                  key={ch.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on}
                  className={`${row} ${on ? "text-atelier-accent" : "text-atelier-ink"}`}
                  onClick={() => {
                    onWho({ kind: "character", id: ch.id, name: ch.name });
                    setOpen(null);
                  }}
                >
                  <Face src={ch.photoUrl} round />
                  {ch.name}
                  {on && <span className="ml-auto">✓</span>}
                </button>
              );
            })}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={choice.who.kind === "none"}
              className={`${row} ${choice.who.kind === "none" ? "text-atelier-accent" : "text-atelier-ink"}`}
              onClick={() => {
                onWho({ kind: "none" });
                setOpen(null);
              }}
            >
              <span className="inline-block w-5 text-center text-atelier-muted" aria-hidden="true">
                —
              </span>
              {labels.whoNoOne}
              {choice.who.kind === "none" && <span className="ml-auto">✓</span>}
            </button>
          </div>
        )}
      </div>

      {photos.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-atelier-muted">{labels.usesPhotos}</p>
          <div className="flex flex-wrap gap-2">
            {photos.map((p) => {
              const job = choice.jobs[p.fileId] ?? "unused";
              return (
                <div key={p.fileId} className="w-[76px] space-y-1">
                  <div className={`aspect-square w-full overflow-hidden rounded-lg border border-atelier-rule bg-atelier-ink/[0.05] ${job === "unused" ? "opacity-45" : ""}`}>
                    {thumbs[p.fileId] && (
                      // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link, not a static asset
                      <img src={thumbs[p.fileId]} alt={p.name} className="h-full w-full object-cover" />
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`${labels.photoJob}: ${jobLabel(job)}`}
                    aria-expanded={open === p.fileId}
                    onClick={() => setOpen(open === p.fileId ? null : p.fileId)}
                    className={`w-full rounded-full border py-0.5 text-center text-[11.5px] ${
                      job === "unused" ? "border-atelier-rule text-atelier-muted" : "border-atelier-accent text-atelier-accent"
                    }`}
                  >
                    {jobLabel(job)} <span aria-hidden="true">▾</span>
                  </button>
                  {open === p.fileId && (
                    <div className="overflow-hidden rounded-lg border border-atelier-rule bg-atelier-paper" role="menu">
                      {JOBS.map((j) => (
                        <button
                          key={j}
                          type="button"
                          role="menuitemradio"
                          aria-checked={job === j}
                          className={`block w-full border-t border-atelier-rule px-2 py-1.5 text-left text-[12px] first:border-t-0 hover:bg-atelier-ink/[0.04] ${
                            job === j ? "text-atelier-accent" : "text-atelier-ink"
                          }`}
                          onClick={() => {
                            onJob(p.fileId, j);
                            setOpen(null);
                          }}
                        >
                          {jobLabel(j)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Face({ src, round }: { src: string | null | undefined; round?: boolean }) {
  return (
    <span className={`inline-block h-5 w-5 flex-none overflow-hidden bg-atelier-ink/[0.08] ${round ? "rounded-full" : "rounded"}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- small signed thumbnails */}
      {src && <img src={src} alt="" className="h-full w-full object-cover" />}
    </span>
  );
}
