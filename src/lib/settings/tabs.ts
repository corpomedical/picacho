// The Settings page's tabs (direction A "Front desk", 2026-09-19): an
// Overview first, then seven rooms. Pure, so the alias table is tested.

export const SETTINGS_TABS = [
  "overview",
  "billing",
  "profile",
  "generation",
  "preferences",
  "security",
  "privacy",
  "help",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

// Every name the page answered to before the redesign keeps working, forever:
// Stripe's return address after checkout and the billing portal (?tab=usage),
// every "top up" link in the app, the low-credit push notifications already
// sitting on people's phones, the /app/profile and /app/usage redirects, the
// public /delete-account page. Two of them land on a section inside a tab.
const ALIASES: Record<string, { tab: SettingsTab; anchor?: string }> = {
  usage: { tab: "billing" },
  account: { tab: "profile" },
  appearance: { tab: "preferences" },
  notifications: { tab: "preferences", anchor: "notifications" },
  brand: { tab: "generation", anchor: "brand-rules" },
  support: { tab: "help" },
};

export function isSettingsTab(value: string | null | undefined): value is SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(value ?? "");
}

export function settingsHref(tab: SettingsTab, anchor?: string): string {
  const base = tab === "overview" ? "/app/settings" : `/app/settings?tab=${tab}`;
  return anchor ? `${base}#${anchor}` : base;
}

export type TabResolution =
  | { tab: SettingsTab; redirect: null }
  /** An old name: send the browser to the new address, keeping the rest of the query. */
  | { tab: SettingsTab; redirect: string };

export function resolveSettingsTab(
  raw: string | null | undefined,
  otherParams: Record<string, string | undefined> = {},
): TabResolution {
  if (isSettingsTab(raw)) return { tab: raw, redirect: null };
  const alias = raw ? ALIASES[raw] : undefined;
  if (!alias) return { tab: "overview", redirect: null };
  const query = new URLSearchParams();
  if (alias.tab !== "overview") query.set("tab", alias.tab);
  for (const [k, v] of Object.entries(otherParams)) {
    if (k !== "tab" && typeof v === "string") query.set(k, v);
  }
  const qs = query.toString();
  return {
    tab: alias.tab,
    redirect: `/app/settings${qs ? `?${qs}` : ""}${alias.anchor ? `#${alias.anchor}` : ""}`,
  };
}
