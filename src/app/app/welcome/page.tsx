import type { Metadata } from "next";
import { WelcomeChoices } from "@/components/light/welcome-choices";
import { TEMPLATES } from "@/lib/templates";
import { CINEMA_PRESETS, isProvenPreset } from "@/lib/generations/cinema-presets";

// Its name in the browser tab and the home-screen app (2026-09-29 check).
export const metadata: Metadata = { title: "Welcome" };

/**
 * The sign-up's last step: the full studio (recommended) or the simple chat
 * (Picacho Light). Only accounts that haven't chosen are sent here (the
 * shell's ModeGate); anyone can open it again, and Settings changes it.
 *
 * The studio card's counts come from what the studio really offers: the
 * ready-made templates, and the camera moves and looks that have earned a
 * chip (proven; the FX tab isn't a camera move or a look).
 */
export default function WelcomePage() {
  const looks = CINEMA_PRESETS.filter((p) => isProvenPreset(p) && p.category !== "fx").length;
  return <WelcomeChoices scenes={TEMPLATES.length} looks={looks} />;
}
