// How long each awaited step of a server render took, for our own measurement (2026-09-30, operator: "Speed
// up the loading" · "measure it"). Step names and milliseconds only — never a user's data.
//
// A streamed page sends its headers before its body, so a Server-Timing header can't carry the steps that
// finish later. Each timed part of the page writes its own steps where it renders, as an inert
// <template data-server-timing="…"> in the Server-Timing format (name;dur=ms, …):
//
//   [...document.querySelectorAll("template[data-server-timing]")].map((t) => t.dataset.serverTiming)
//
// The proxy's own steps (auth claims, the suspension check) ride the real Server-Timing header
// (lib/supabase/middleware.ts), readable from performance.getEntriesByType("navigation")[0].serverTiming.

export type ServerTimer = {
  /** Awaits `work`, noting how long it took under `name`. */
  step<T>(name: string, work: () => PromiseLike<T> | T): Promise<T>;
  /** The steps so far, and the whole since the timer began: "layout.auth;dur=4, layout.mode;dur=151, layout.total;dur=156". */
  value(): string;
};

const NAME = /^[a-z0-9_.-]{1,40}$/i;

export function serverTimer(scope: string): ServerTimer {
  const t0 = performance.now();
  const steps: string[] = [];
  const safe = (n: string) => (NAME.test(n) ? n : "step");
  return {
    async step(name, work) {
      const s = performance.now();
      try {
        return await work();
      } finally {
        steps.push(`${safe(scope)}.${safe(name)};dur=${Math.round(performance.now() - s)}`);
      }
    },
    value() {
      return [...steps, `${safe(scope)}.total;dur=${Math.round(performance.now() - t0)}`].join(", ");
    },
  };
}
