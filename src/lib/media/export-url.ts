// Every Download and Share asks the download door (api/export) for a
// render of ours instead of the display address: a free account's own
// picture or video leaves with the Picacho "P" (lib/media/free-mark.ts);
// everyone else is sent straight on to the original. A thumbnail's width
// is dropped, since a download is the full file.
export function exportUrl(url: string): string {
  const m = url.match(/^\/api\/media\/(generated-images|generated-videos)\/([^?]+)\?(.*)$/);
  if (!m) return url;
  const v = new URLSearchParams(m[3]).get("v");
  return v ? `/api/export/${m[1]}/${m[2]}?v=${encodeURIComponent(v)}` : url;
}
