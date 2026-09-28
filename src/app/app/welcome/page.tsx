import { WelcomeChoices } from "@/components/light/welcome-choices";

/**
 * The sign-up's last step (operator, 2026-09-27): Light or Advanced, and the
 * look. Only accounts that haven't chosen are sent here (the shell's
 * ModeGate); anyone can open it again, and Settings changes both.
 */
export default function WelcomePage() {
  return <WelcomeChoices />;
}
