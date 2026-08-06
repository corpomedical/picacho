// Lightweight keyword matching for voice navigation — no AI call needed for
// this part, it's just phrase matching on the already-transcribed text.
// Anything that doesn't match a known command falls through and is treated
// as a generation prompt instead.

export type VoiceCommand =
  | { type: "navigate"; href: string; label: string }
  | { type: "new-chat" }
  | { type: "prompt"; text: string };

const NAV_COMMANDS: { patterns: RegExp[]; href: string; label: string }[] = [
  { patterns: [/\b(generate|generator|generation)\b/], href: "/app/generate", label: "Generate" },
  { patterns: [/\bproject(s)?\b/], href: "/app/projects", label: "Projects" },
  { patterns: [/\bcharacter(s)?\b/], href: "/app/character", label: "Characters" },
  { patterns: [/\bhistory\b/], href: "/app/history", label: "History" },
  { patterns: [/\badmin\b/], href: "/admin", label: "Admin" },
  { patterns: [/\b(feature flags|flags)\b/], href: "/admin/flags", label: "Feature flags" },
  { patterns: [/\b(billing)\b/], href: "/admin/billing", label: "Billing" },
  { patterns: [/\b(settings)\b/], href: "/admin/settings", label: "Settings" },
];

const NAV_VERBS = /^(open|go to|goto|show|navigate to|take me to|switch to)\b/i;
const NEW_CHAT = /^(new chat|start a new chat|start new chat|clear (the )?chat|clear this chat)\b/i;

export function parseVoiceCommand(raw: string): VoiceCommand {
  const text = raw.trim();
  const lower = text.toLowerCase();

  if (NEW_CHAT.test(lower)) {
    return { type: "new-chat" };
  }

  // Only treat it as navigation if it actually reads like a navigation
  // request ("open characters") — otherwise a generation prompt that happens
  // to mention "a character walking through a market" would misfire.
  if (NAV_VERBS.test(lower)) {
    for (const cmd of NAV_COMMANDS) {
      if (cmd.patterns.some((p) => p.test(lower))) {
        return { type: "navigate", href: cmd.href, label: cmd.label };
      }
    }
  }

  return { type: "prompt", text };
}
