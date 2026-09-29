import type { Metadata } from "next";
import { WelcomeChoices } from "@/components/light/welcome-choices";

// Its name in the browser tab and the home-screen app (2026-09-29 check).
export const metadata: Metadata = { title: "Welcome" };

/**
 * The sign-up's last step (operator, 2026-09-27): Light or Advanced, and the
 * look. Only accounts that haven't chosen are sent here (the shell's
 * ModeGate); anyone can open it again, and Settings changes both.
 */
export default function WelcomePage() {
  return <WelcomeChoices />;
}
