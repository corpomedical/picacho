// The Picacho mark on public media (operator, 2026-09-05: "videos posted on
// Made by Picacho and community must have a tag of Picacho so that people
// don't steal content — the logo on the bottom right corner"). One shared
// overlay so the two public surfaces can never drift apart on it.
//
// A UI overlay brands every view, screenshot and screen recording; it does
// not survive a raw file download — burning the mark into the pixels needs
// the ffmpeg leg and is the recorded follow-up. pointer-events-none keeps
// the player's own controls clickable straight through it.
export function PicachoMark({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-dark.png"
      alt="Made with Picacho"
      className={`pointer-events-none absolute bottom-2 right-2 select-none opacity-80 drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)] ${
        size === "sm" ? "w-14" : "w-20 sm:w-24"
      }`}
    />
  );
}
