import eclipse from "./looks/eclipse.module.css";
import perfected from "./looks/perfected.module.css";
import styles from "./producer-lamp.module.css";
import { FirefliesLight } from "./fireflies-light";
import type { LampLook, LampMood } from "./lamp-look";

// The Producer's lamp in each of its looks (lamp-look.ts says which and why),
// all in the same glass since 2026-09-30 (operator: "The light bulb and how
// it sticks in the corner, the animation feels cheap"; he picked "A · Tuck"
// from the draft): a dark glass bead lit along its lower rim by the light
// inside, a thin reflection on its top rim and a catchlight, a shadow on the
// page and the light's warm pool around it. Only the light inside differs:
// Two fireflies is drawn on a canvas (fireflies-light.tsx); Eclipse and The
// original perfected are their round-4 CSS (looks/), scoped by .look, their
// moods .idle/.listening/.talking/.thinking, --glow (0..1) the voice.
//
// The light sits in a round frame the size of the glass (it never shows
// outside it), inside a layer the lamp moves on its own: when the lamp is
// tucked half behind an edge, that layer slides the light into the part still
// on the screen and shrinks it to fit (movable-lamp.tsx, lamp-motion.ts). The
// parts the lamp moves carry data-part.

type Classes = Readonly<Record<string, string>>;
const CSS_LOOKS: Partial<Record<LampLook, Classes>> = { eclipse, perfected };
const MOOD_CLASS: Record<LampMood, string> = {
  idle: styles.moodIdle,
  listening: styles.moodListening,
  talking: styles.moodTalking,
  thinking: styles.moodThinking,
};

/** The classes the lamp itself carries for a look in a mood. */
export function lookClasses(look: LampLook, mood: LampMood): string {
  const m = CSS_LOOKS[look];
  return [MOOD_CLASS[mood], m?.look, m?.[mood]].filter(Boolean).join(" ");
}

/**
 * What goes inside the lamp for a look: its shadow and its pool of light on
 * the page (not on a mark), the glass, the light, the reflection, and the
 * ring that shows it listening. `glow` is the voice (0..1).
 */
export function LookInner({
  look,
  mood = "idle",
  glow = 0,
  bare = false,
}: {
  look: LampLook;
  mood?: LampMood;
  glow?: number;
  /** Without what it throws on the page (a mark inside the sheet). */
  bare?: boolean;
}) {
  return (
    <>
      {!bare && (
        <>
          <span data-part="shadowRest" className={styles.shadowRest} />
          <span data-part="shadowLifted" className={styles.shadowLifted} />
          <span data-part="pool" className={styles.pool} />
          <span data-part="flash" className={styles.flash} />
        </>
      )}
      <span className={styles.glass} />
      <span className={styles.lightFrame}>
        <span data-part="light" className={styles.light}>
          <Light look={look} mood={mood} glow={glow} />
        </span>
      </span>
      <span data-part="gloss" className={styles.gloss} />
      {!bare && <span className={styles.ring} />}
    </>
  );
}

function Light({ look, mood, glow }: { look: LampLook; mood: LampMood; glow: number }) {
  if (look === "fireflies") return <FirefliesLight mood={mood} glow={glow} />;
  const m = CSS_LOOKS[look] as Classes;
  const c = (names: string) =>
    names
      .split(" ")
      .map((n) => m[n])
      .filter(Boolean)
      .join(" ");
  return <span className={m.roundBox}>{look === "eclipse" ? <Eclipse c={c} /> : <Perfected c={c} />}</span>;
}

/**
 * The look as a small mark (the sheet's header, the voice line): the 44 px
 * lamp scaled down, without what it throws on the page, so the one chosen
 * lamp is what shows wherever the Producer does.
 */
export function LookMark({ look, mood, size, glow }: { look: LampLook; mood: LampMood; size: number; glow?: number }) {
  const level = glow ?? (mood === "talking" ? 0.7 : 0);
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
            "--glow": level,
          } as React.CSSProperties
        }
      >
        <LookInner look={look} mood={mood} glow={level} bare />
      </span>
    </span>
  );
}

type InnerProps = { c: (names: string) => string };

function Eclipse({ c }: InnerProps) {
  return (
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

function Perfected({ c }: InnerProps) {
  return (
    <span className={c("core")}>
      <span className={c("halo")} />
      <span className={c("orb")}>
        <span className={c("sss")} />
        <span className={c("warm")} />
        <span className={c("kiss")} />
      </span>
    </span>
  );
}
