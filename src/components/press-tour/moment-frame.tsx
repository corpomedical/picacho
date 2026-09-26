"use client";

// One moment of a filmed take, as the check read it: the take itself, held
// at that second (a media fragment, #t=, so the browser shows that very
// frame and nothing plays), over the shot's approved still, which stays
// visible wherever a browser won't draw a frame it hasn't played (some
// phones). No frame is ever made up or copied: what shows is the take, or
// the still it was filmed from.

export function MomentFrame({
  videoUrl,
  at,
  still,
  label,
}: {
  videoUrl: string | null;
  /** Seconds into the take, or null (the take's first frame). */
  at: number | null;
  /** The shot's approved still (a short-lived signed link), shown under the frame. */
  still: string | null;
  /** What the frame is, for a screen reader ("Moment 5, 0:07.2, Didn't match"); null when a button around it already says so. */
  label: string | null;
}) {
  const src = videoUrl ? `${videoUrl}#t=${Math.max(0, at ?? 0).toFixed(2)}` : null;
  const named = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };
  return (
    <span {...named} className="absolute inset-0 block bg-[#101116]">
      {still && (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link to the person's own still
        <img src={still} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      {src && (
        <video
          src={src}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </span>
  );
}
