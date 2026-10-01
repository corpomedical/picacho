import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getModelControls } from "@/lib/models/controls";
import { getGenerateWorkspaceData } from "@/lib/generations/workspace-data";
import { producerVisible, readProducerGrant } from "@/lib/producer/enabled";
import { loadPrefs } from "@/lib/producer/store";
import { createAdminClient } from "@/lib/supabase/server";
import { firstName } from "@/lib/light/mode";
import { isNativeApp } from "@/lib/native/server";
import { spendableCredits, type PlanId } from "@/lib/plans";
import type { LightDefaults } from "@/components/light/light-chat";
import { availableBrains, isAlyChatEnabled } from "./enabled";
import type { Brain } from "./brains";

// What every chat page needs (2026-09-29): who's asking, which brains are
// on, whether this account is limited to Claude (free), the projects a chat
// can move to, and the composer defaults a render card's "Make it" uses.

export type ChatPageBase = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  open: boolean;
  name: string;
  firstName: string | null;
  brains: Record<Brain, boolean>;
  limited: boolean;
  projects: { id: string; name: string }[];
  defaults: LightDefaults;
  topUpHref: string | null;
  /** Aly's live voice: whoever has Aly's lamp (the live route's own rule, api/producer/live). */
  liveVoice: boolean;
  /** Picacho Light's top bar: credits to spend and the account button's letter. */
  creditsLeft: number;
  initial: string;
};

export async function chatPageBase(): Promise<ChatPageBase> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const userId = data.user.id;
  const admin = createAdminClient();

  const [open, { data: profile }, prefs, granted, { data: projects }, workspace, native] = await Promise.all([
    isAlyChatEnabled(supabase),
    supabase.from("profiles").select("plan, plan_status, full_name, username, role, status").eq("id", userId).maybeSingle(),
    loadPrefs(admin, userId),
    readProducerGrant(supabase, userId),
    supabase
      .from("projects")
      .select("id, name")
      .eq("user_id", userId)
      .eq("is_archived", false)
      .order("updated_at", { ascending: false })
      .limit(50),
    getGenerateWorkspaceData(supabase, userId),
    isNativeApp(),
  ]);
  const plan = ((profile?.plan as PlanId | null) ?? "none") as PlanId;
  const active = ((profile?.plan_status as string | null) ?? null) === null || profile?.plan_status === "active";
  const isAdmin = profile?.role === "admin";
  // Admins chat on Elite's allowance, like the lamp (the route's own rule).
  const limited = !isAdmin && !granted && (plan === "none" || !active);
  const model = workspace.videoModels.find((m) => m.id === workspace.defaultVideoModelId);
  const liveVoice = await producerVisible(supabase, profile ? { ...profile, producer_access: granted } : profile, isAdmin);

  return {
    supabase,
    userId,
    open,
    name: prefs.name,
    firstName: firstName(profile?.full_name as string | null),
    brains: offeredBrains(availableBrains(), (await getModelControls()).off.aly_brains ?? []),
    limited,
    projects: (projects ?? []).map((p) => ({ id: p.id as string, name: String(p.name ?? "") })),
    defaults: {
      videoModelId: workspace.defaultVideoModelId,
      videoDurationSeconds: workspace.defaultVideoDurationSeconds ?? model?.defaultDurationSeconds ?? 5,
      videoAspectRatio: workspace.defaultAspectRatio,
      imageModelId: workspace.defaultImageModelId,
    },
    topUpHref: native ? null : "/app/settings?tab=billing#assistant-topup",
    liveVoice,
    creditsLeft: spendableCredits({
      monthlyLimit: workspace.creditsLimit,
      used: workspace.creditsUsed,
      bonus: workspace.bonusCredits,
      purchased: workspace.purchasedCredits,
    }),
    initial: (
      ((firstName(profile?.full_name as string | null) ?? (profile?.username as string | null) ?? data.user.email ?? "?").trim()[0] ?? "?")
    ).toUpperCase(),
  };
}

/** A brain taken off the menu on Admin → Models reads as unreachable, so the picker greys it out. Luna stays on. */
function offeredBrains<T extends Record<string, boolean>>(brains: T, off: readonly string[]): T {
  return Object.fromEntries(Object.entries(brains).map(([k, v]) => [k, v && (k === "luna" || !off.includes(k))])) as T;
}
