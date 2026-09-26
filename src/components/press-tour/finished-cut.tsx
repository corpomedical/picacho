"use client";

import type { ReactNode } from "react";
import type { Messages } from "@/lib/i18n/messages/en";
import { formatMsg } from "@/lib/i18n/format";
import type { MasterView, RenditionView } from "@/lib/press-tour/campaign-types";
import { adFileName, downloadUrl } from "@/lib/press-tour/press-line-view";
import { DownloadIcon } from "./icons";

// THE CUT (Cut 4 UI): the finished ad, as the person will post it. The
// tagged file plays here (the small "AI-generated" tag in a clear bottom
// corner, and the brand's end card when there is one); both files can be
// saved: the ad, and the clean one for TikTok, whose AI label does the
// tag's job (TikTok forbids added watermarks and logos): the note under the
// keys tells the person to turn that label on when they post the file
// themselves (PT-R3-02). An admin also
// reads why a file is unsigned (MasterView.adminNote is null for anyone
// else). The key under it opens the press line.

const GHOST =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[13.5px] font-medium text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.16)] hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#f0cda6] lg:min-h-9";

export function renditionOf(master: MasterView | null, kind: RenditionView["kind"]): RenditionView | null {
  return master?.renditions.find((r) => r.kind === kind) ?? null;
}

export function FinishedCut({
  master,
  poster,
  productName,
  t,
  keySlot,
}: {
  master: MasterView;
  poster: string | null;
  productName: string | null;
  t: Messages;
  /** The key (Open the press line), with what blocks it. */
  keySlot: ReactNode;
}) {
  const m = t.pressTour;
  const tagged = renditionOf(master, "tagged");
  const clean = renditionOf(master, "clean");
  const shown = tagged ?? clean;
  return (
    <section aria-labelledby="press-cut" className="grid gap-5 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)] md:items-start">
      {shown ? (
        <video
          src={shown.url}
          poster={poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          className="aspect-[9/16] w-full max-w-[220px] rounded-[14px] bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_26px_40px_-20px_rgba(0,0,0,0.9)] max-md:mx-auto max-md:max-w-[200px]"
          aria-label={m.cutPlayerLabel}
        />
      ) : (
        <div className="grid aspect-[9/16] w-full max-w-[220px] place-items-center rounded-[14px] border border-dashed border-[rgba(255,255,255,0.14)] px-4 text-center text-[12.5px] text-[#9aa0ad]">
          {m.cutMissing}
        </div>
      )}
      <div className="min-w-0">
        <p className="font-slate text-[11px] font-medium uppercase tracking-[0.12em] text-[#858994]">{m.stepLine}</p>
        <h2 id="press-cut" className="mt-1.5 text-[18px] font-semibold leading-[1.25] text-[#ecedf1]">
          {m.cutReadyTitle}
        </h2>
        <p className="mt-1.5 max-w-[520px] text-[13px] leading-[1.45] text-[#9aa0ad]">
          {/* The end card was decided when the ad was cut: said only when this ad has one (PT-R3-07). */}
          {formatMsg(master.hasEndCard ? m.cutReadyBody : m.cutReadyBodyNoCard, { s: formatMsg(m.lengthSeconds, { n: Math.round(shown?.seconds ?? 0) }) })}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {tagged && (
            <a href={downloadUrl(tagged.url, adFileName(productName, "tagged"))} download={adFileName(productName, "tagged")} className={GHOST}>
              <DownloadIcon className="h-3.5 w-3.5" />
              {m.saveAd}
            </a>
          )}
          {clean && (
            <a href={downloadUrl(clean.url, adFileName(productName, "clean"))} download={adFileName(productName, "clean")} className={GHOST}>
              <DownloadIcon className="h-3.5 w-3.5" />
              {m.saveForTikTok}
            </a>
          )}
        </div>
        {clean && <p className="mt-1.5 max-w-[520px] text-[11.5px] leading-[1.42] text-[#858994]">{m.saveForTikTokNote}</p>}
        {master.adminNote && (
          <p className="mt-3 rounded-xl bg-[rgba(238,214,160,0.06)] px-3 py-2 text-[12px] leading-[1.42] text-[#eed6a0] ring-1 ring-inset ring-[rgba(238,214,160,0.2)]">
            <b className="font-medium">{m.adminOnly}</b> {master.adminNote}
          </p>
        )}
        <div className="mt-4 flex max-w-[360px] flex-col gap-2">{keySlot}</div>
      </div>
    </section>
  );
}
