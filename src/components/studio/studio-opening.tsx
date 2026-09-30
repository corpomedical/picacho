// "Opening the set…" (2026-09-30): the Studio's full-screen cover while its set is read on the server and its
// code loads in the browser. Plain markup, no state: the set page streams it the moment the request arrives
// (a Suspense fallback), and the Studio keeps the same cover up until its first frame is drawn — one picture
// from the first byte to the scene, never an empty grey workspace.

export function StudioOpening({ words, title }: { words: string; title?: string }) {
  return (
    <div className="fixed inset-0 z-[75] flex flex-col items-center justify-center gap-3 bg-[#1d1e21] text-[#e6e7ea]" role="status" aria-live="polite" data-studio-opening>
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#3a3c42] border-t-[#e0a468]" aria-hidden />
      <p className="text-[15px] font-medium">{words}</p>
      {title ? <p className="text-[13px] text-[#9aa0ad]">{title}</p> : null}
    </div>
  );
}
