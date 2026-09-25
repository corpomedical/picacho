import fireflies from "./looks/fireflies.module.css";
import eclipse from "./looks/eclipse.module.css";
import perfected from "./looks/perfected.module.css";
import type { Edge } from "./lamp-place";
import type { LampLook, LampMood } from "./lamp-look";

// The Producer's lamp in each of its looks (lamp-look.ts says which and why).
// Each look is a CSS module holding the round-4 concept it came from, ported
// as it was rendered and critiqued (scratchpad/presence/r4/port_looks.py):
// its scope class is .look, its moods are .idle/.listening/.talking/.thinking,
// its tab is .tab, and --glow (0..1) on the lamp is the voice.

type Classes = Readonly<Record<string, string>>;
const MODULES: Record<LampLook, Classes> = { fireflies, eclipse, perfected };

/** The classes the lamp itself carries for a look in a mood (and as a tab). */
export function lookClasses(look: LampLook, mood: LampMood, tab = false): string {
  const m = MODULES[look];
  return [m.look, m[mood], tab ? m.tab : ""].filter(Boolean).join(" ");
}

type InnerProps = { c: (names: string) => string; tab: boolean };

/**
 * What goes inside the lamp for a look, in three layers:
 * - the pool of light it throws on the page (round only, and not on a mark);
 * - the dark glass (.disc), which fills the lamp and so changes shape with it
 *   when it docks to an edge or leaves one;
 * - the light itself, drawn for one shape: round, or a tab drawn for the right
 *   edge whose box is mirrored or turned so its rounded, lit side still faces
 *   the page. The box is keyed by shape and look, so a change mounts a new one
 *   and it fades in once the lamp has taken its new shape (.roundBox/.tabBox
 *   in the look's stylesheet) instead of sticking out of the old one.
 */
export function LookInner({
  look,
  tab = false,
  edge = null,
  bare = false,
}: {
  look: LampLook;
  tab?: boolean;
  edge?: Edge | null;
  /** Without the pool of light it throws on the page (a mark inside the sheet). */
  bare?: boolean;
}) {
  const m = MODULES[look];
  const c = (names: string) =>
    names
      .split(" ")
      .map((n) => m[n])
      .filter(Boolean)
      .join(" ");
  const Inner = INNERS[look];
  const box = tab
    ? [m.tabBox, edge && edge !== "right" ? m[edge] : ""].filter(Boolean).join(" ")
    : m.roundBox;
  return (
    <>
      {!tab && !bare && <span className={m.pool} />}
      <span className={m.disc} />
      <span key={`${look}:${tab ? (edge ?? "right") : "round"}`} className={box}>
        <Inner c={c} tab={tab} />
      </span>
    </>
  );
}

/**
 * The look as a small mark (the sheet's header, the voice line): the 44 px
 * lamp scaled down, without its pool of light, so the one chosen lamp is what
 * shows wherever the Producer does.
 */
export function LookMark({ look, mood, size, glow }: { look: LampLook; mood: LampMood; size: number; glow?: number }) {
  return (
    <span aria-hidden="true" className="relative block flex-none" style={{ width: size, height: size }}>
      <span
        className={`${lookClasses(look, mood)} grid place-items-center`}
        style={
          {
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 44,
            height: 44,
            margin: -22,
            borderRadius: 9999,
            transform: `scale(${size / 44})`,
            "--glow": glow ?? (mood === "talking" ? 0.7 : 0),
          } as React.CSSProperties
        }
      >
        <LookInner look={look} bare />
      </span>
    </span>
  );
}

function Fireflies({ c, tab }: InnerProps) {
  return tab ? (
    <>
      <span className={c("field")}>
        <span className={c("haze")} />
        <span className={c("ff fb hd")} />
        <span className={c("ff fa hd")} />
      </span>
    </>
  ) : (
    <>
      <span className={c("field")}>
        <span className={c("haze")} />
        <span className={c("ff fb t t6")} />
        <span className={c("ff fb t t5")} />
        <span className={c("ff fb t t4")} />
        <span className={c("ff fb t t3")} />
        <span className={c("ff fb t t2")} />
        <span className={c("ff fb t t1")} />
        <span className={c("ff fa t t6")} />
        <span className={c("ff fa t t5")} />
        <span className={c("ff fa t t4")} />
        <span className={c("ff fa t t3")} />
        <span className={c("ff fa t t2")} />
        <span className={c("ff fa t t1")} />
        <span className={c("ff fb hd")} />
        <span className={c("ff fa hd")} />
      </span>
    </>
  );
}

function Eclipse({ c, tab }: InnerProps) {
  return tab ? (
    <>
      <span className={c("tw")}>
        <span className={c("tco")} />
        <span className={c("tmoon")} />
      </span>
      <span className={c("tbead")}>
        <span className={c("tcore")} />
      </span>
    </>
  ) : (
    <>
      <span className={c("halo")} />
      <span className={c("rays")}>
        <span />
        <span />
        <span />
        <span />
      </span>
      <span className={c("ring")} />
      <span className={c("ring2")} />
      <span className={c("co")} />
      <span className={c("moon")} />
      <span className={c("orb")}>
        <span className={c("limb")} />
        <span className={c("trail")} />
        <span className={c("bead")} />
        <span className={c("core")} />
      </span>
    </>
  );
}

function Perfected({ c, tab }: InnerProps) {
  return tab ? (
    <>
      <span className={c("core")}>
        <span className={c("halo")} />
        <span className={c("orb")}>
          <span className={c("sss")} />
          <span className={c("warm")} />
        </span>
      </span>
    </>
  ) : (
    <>
      <span className={c("core")}>
        <span className={c("halo")} />
        <span className={c("orb")}>
          <span className={c("sss")} />
          <span className={c("warm")} />
          <span className={c("kiss")} />
        </span>
      </span>
    </>
  );
}

const INNERS: Record<LampLook, (p: InnerProps) => React.JSX.Element> = { fireflies: Fireflies, eclipse: Eclipse, perfected: Perfected };
