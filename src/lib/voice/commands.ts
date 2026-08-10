// Lightweight keyword matching for voice navigation — no AI call needed for
// this part, it's just phrase matching on the already-transcribed text.
// Anything that doesn't match a known command falls through and is treated
// as a generation prompt instead.

export type VoiceCommand =
  | { type: "navigate"; href: string; label: string }
  | { type: "new-chat" }
  | { type: "switch-character"; name: string }
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

// "switch to", "use", "pick", "select" a character by name — deliberately a
// separate verb set from NAV_VERBS (which also has "switch to", but for
// pages: "switch to characters" navigates; "switch to Mia" should pick the
// character). Character names always win when characterNames is given and
// a name actually matches — a generation prompt like "use a wide-angle
// shot" won't accidentally match unless "wide-angle shot" happens to BE one
// of the person's own saved character names, which is checked below rather
// than assumed from the verb alone.
const CHARACTER_VERBS = /^(switch to|use|pick|select|change to|talk as)\b/i;

export function parseVoiceCommand(raw: string, characterNames: string[] = []): VoiceCommand {
  const text = raw.trim();
  const lower = text.toLowerCase();

  if (NEW_CHAT.test(lower)) {
    return { type: "new-chat" };
  }

  if (characterNames.length > 0 && CHARACTER_VERBS.test(lower)) {
    const rest = lower.replace(CHARACTER_VERBS, "").trim();
    const match = characterNames.find((name) => {
      const lowerName = name.toLowerCase();
      return rest === lowerName || rest === `${lowerName} character` || rest.startsWith(`${lowerName} `) || rest.endsWith(` ${lowerName}`);
    });
    if (match) return { type: "switch-character", name: match };
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
