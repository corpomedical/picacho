// Which wheel opens out of the lamp (2026-09-27, operator: "I dont like the
// menu that pops out of the light" → "I want an animated wheel that pops out
// but in a different way and shape" → of the drafts, "you do something that
// you feel it fits perfectly" → Filament; "I like it, and add blossom. Let
// there be 2 options for the user to pick from"). Pure, so the layout and the
// settings action can read it on the server.
//
// Filament: a thin arc of light round the lamp; a spark runs along it and
// lights each control as it passes, names beside them, and an inner arc fills
// with the month's use. Blossom: five petals open out of the bulb, and a ring
// round the bulb fills with the month's use. Saved on the account
// (producer_prefs.wheel_style); Filament when there is none.

export const WHEEL_STYLES = ["filament", "blossom"] as const;
export type WheelStyle = (typeof WHEEL_STYLES)[number];
export const DEFAULT_WHEEL_STYLE: WheelStyle = "filament";

export const WHEEL_STYLE_LABELS: Record<WheelStyle, { name: string; line: string }> = {
  filament: { name: "Filament", line: "An arc of light with every control named." },
  blossom: { name: "Blossom", line: "Petals that open out of the bulb." },
};

/** A stored style, or the default when there is none or it isn't one of ours. */
export function parseWheelStyle(value: unknown): WheelStyle {
  return (WHEEL_STYLES as readonly unknown[]).includes(value) ? (value as WheelStyle) : DEFAULT_WHEEL_STYLE;
}

/** How far the wheel reaches from the lamp's centre, in px. */
export function wheelGeometry(style: WheelStyle, phone: boolean) {
  if (style === "blossom") {
    const petal = phone ? 96 : 110;
    return { radius: petal, petalWidth: phone ? 44 : 50, reach: petal + 6 };
  }
  const radius = phone ? 114 : 132;
  // The top control's name sits above it: half the control, a gap, a line.
  return { radius, petalWidth: 0, reach: radius + 21 + 30 };
}

/** The month's use as a fraction, 0..1; no allowance reads as spent. */
export function usageFraction(used: number, cap: number): number {
  return cap > 0 ? Math.min(1, Math.max(0, used / cap)) : 1;
}

/**
 * What the wheel's meter says. Past the month's allowance a top-up carries
 * on (2026-09-28, lib/agent/topups.ts): the meter stays lit and the words say
 * what is left of it; "full" only when there is nothing left at all.
 * `extra` is what top-ups add to this month's ceiling (the snapshot's).
 */
export function usageState(
  used: number,
  cap: number,
  extra = 0,
): { pct: number; full: boolean; onTopUp: boolean; topUpLeft: number; label: string } {
  const pct = usageFraction(used, cap);
  const x = Math.max(0, extra);
  const topUpLeft = Math.max(0, cap + x - used);
  const onTopUp = pct >= 1 && x > 0 && topUpLeft > 0;
  const full = pct >= 1 && !onTopUp;
  const n = (v: number) => v.toLocaleString("en-US");
  const label = full
    ? "Allowance used up for this period"
    : onTopUp
      ? `This month's allowance is used; ${n(topUpLeft)} topped-up units left`
      : `${n(used)} of ${n(cap)} assistant units used this period${x > 0 ? `, plus ${n(x)} topped up` : ""}`;
  return { pct, full, onTopUp, topUpLeft, label };
}
