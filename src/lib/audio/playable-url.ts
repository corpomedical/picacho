// Turning base64 audio from our own server into something the page is allowed
// to play (2026-09-25, operator: "I cant hear the assistant").
//
// The site's Content-Security-Policy (middleware.ts) allows media from
// 'self', blob:, our storage and fal — NOT data:. A `new Audio("data:…")`
// is refused by the browser before it plays a sample, and the only sign is an
// error event nobody sees: every spoken reply the Producer ever sent was
// dropped that way. A blob: URL is the same bytes, allowed by the policy,
// with no loosening of it. Call the returned `release` once the audio is done
// (or abandoned) so the bytes can be freed.

export function playableAudioUrl(base64: string, mime = "audio/mpeg"): { url: string; release: () => void } {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  let released = false;
  return {
    url,
    release: () => {
      if (released) return;
      released = true;
      URL.revokeObjectURL(url);
    },
  };
}
