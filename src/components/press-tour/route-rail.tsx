import { cn } from "@/lib/cn";
import type { NetworkState, NetworkStates } from "@/lib/press-tour/door-view";
import type { PressWords } from "./verdict";
import s from "./press-tour.module.css";

// The route rail (static; grafted from direction B in A's words): Plan ·
// Stills · Film · Press wall · Press line, forking to the networks. A stop
// the ad has passed is done, the stop it is at is lit, the rest wait. The
// networks' words come from their switches (door-view.ts networkStates):
// nothing reads "Ready" before it can take a post.

export type RouteStopView = { name: string; sub: string | null };

// The networks by their own names (never their logos: letters only).
const NETWORKS = [
  ["x", "X"],
  ["tiktok", "TikTok"],
  ["instagram", "Instagram"],
] as const;

function netWord(state: NetworkState, m: PressWords): string {
  return state === "ready" ? m.netReady : state === "privateTest" ? m.netPrivateTest : m.netSoon;
}

/** The full rail, for a wide card. */
export function RouteRail({ stops, now, networks, m }: { stops: RouteStopView[]; now: number; networks: NetworkStates; m: PressWords }) {
  return (
    <nav aria-label={m.stepsLabel} className="mt-5">
      <ol className="flex items-start">
        {stops.map((stop, i) => (
          <li key={stop.name} className={cn("flex items-start", i > 0 ? "min-w-0 flex-1" : "flex-none")}>
            {i > 0 && <span aria-hidden="true" className={cn(s.leg, "mx-2.5 mt-[4px]", i <= now && s.legDone)} />}
            <span className="flex min-w-0 flex-col items-start gap-[5px]" aria-current={i === now ? "step" : undefined}>
              <span aria-hidden="true" className={cn(s.pin, i < now && s.pinDone, i === now && s.pinNow)} />
              <span
                className={cn(
                  "font-slate whitespace-nowrap text-[11px] font-medium uppercase tracking-[0.12em]",
                  i === now ? "text-[#f0cda6]" : "text-[#8b8f99]",
                )}
              >
                {stop.name}
              </span>
              {stop.sub && <span className={cn("whitespace-nowrap text-[11.5px]", i === now ? "text-[#9aa0ad]" : "text-[#858994]")}>{stop.sub}</span>}
            </span>
          </li>
        ))}
        <li className="flex flex-none items-start">
          <span aria-hidden="true" className={cn(s.leg, "mx-2.5 mt-[4px] w-6")} />
          {/* The fork leaves the route at the pins' height and fans DOWN: X on
              the pins' row, TikTok on the names', Instagram on the lines
              under them, so it never climbs into the title block above. */}
          <span className="relative -mt-[2px] flex flex-col gap-1 pl-[26px]">
            <svg className="absolute left-0 top-0 h-[50px] w-6" viewBox="0 0 24 50" aria-hidden="true">
              <path d="M0 7 H24 M0 7 C10 7 12 25 24 25 M0 7 C10 7 12 43 24 43" fill="none" stroke="#3a3c44" strokeWidth="1.5" />
            </svg>
            {NETWORKS.map(([key, name]) => (
              <span key={key} className="flex items-center gap-[7px] whitespace-nowrap text-[11.5px] leading-[1.2] text-[#858994]">
                <span className="font-slate min-w-[72px] text-[11px] font-medium tracking-[0.1em] text-[#8b8f99]">{name}</span>
                <span className={networks[key] === "ready" ? "text-[#f0cda6]" : undefined}>{netWord(networks[key], m)}</span>
              </span>
            ))}
          </span>
        </li>
      </ol>
    </nav>
  );
}

/** The compact rail for a phone: five pins, the fork, and where the ad is, in words. */
export function PhoneRoute({
  stops,
  now,
  networks,
  right,
  m,
}: {
  stops: RouteStopView[];
  now: number;
  networks: NetworkStates;
  right: string | null;
  m: PressWords;
}) {
  const here = stops[now];
  const dot = (state: NetworkState) => (state === "ready" ? "#e0a468" : state === "privateTest" ? "#a09688" : "#4d505a");
  return (
    <nav aria-label={`${m.stepsLabel}: ${here.name}`} className="mt-3">
      <div className="flex items-center" aria-hidden="true">
        {stops.map((stop, i) => (
          <span key={stop.name} className={cn("flex items-center", i > 0 && "flex-1")}>
            {i > 0 && <span className={cn(s.leg, "mx-[5px]", i <= now && s.legDone)} />}
            <span className={cn(s.pin, s.pinSm, i < now && s.pinDone, i === now && s.pinNow)} />
          </span>
        ))}
        <svg className="ml-[3px] h-[22px] w-[22px] flex-none" viewBox="0 0 22 22">
          <path d="M0 11 C7 11 9 3 20 3 M0 11 H20 M0 11 C7 11 9 19 20 19" fill="none" stroke="#3a3c44" strokeWidth="1.5" />
          <circle cx="20" cy="3" r="2" fill={dot(networks.x)} />
          <circle cx="20" cy="11" r="2" fill={dot(networks.tiktok)} />
          <circle cx="20" cy="19" r="2" fill={dot(networks.instagram)} />
        </svg>
      </div>
      <p className="mb-2 mt-1.5 flex items-baseline justify-between gap-3 text-xs text-[#9aa0ad]">
        <span className="min-w-0">
          <span className="font-slate mr-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[#f0cda6]">{here.name}</span>
          {here.sub}
        </span>
        {right && <span className="flex-none">{right}</span>}
      </p>
    </nav>
  );
}
