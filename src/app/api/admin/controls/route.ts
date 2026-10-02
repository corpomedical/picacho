import { json, preflight, requireAdminFromRequest } from "@/lib/admin/api-auth";
import { getAllModelHealth } from "@/lib/generations/model-health";
import { maxSingleRenderCostUsd } from "@/lib/generations/providers/video-models";
import { loadProviderFunds } from "@/lib/admin/provider-funds";
import { MENUS, PRODUCTS, isOffered } from "@/lib/models/registry";
import { menuItems, offLock } from "@/lib/models/menus";
import { readModelDefaults, readStoredControls } from "@/lib/models/controls-store";

// GET /api/admin/controls — the phone admin app's Controls tab: every
// customer model menu (on/off, default, health, the lock that keeps an item
// on), the provider balances with their Top up links, and the feature
// switches. Changes go through /api/admin/act (setOffered, restoreModel,
// suspendModel, setFlag).
export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return preflight(request);
}

export async function GET(request: Request) {
  const auth = await requireAdminFromRequest(request);
  if (auth instanceof Response) return auth;
  const { admin } = auth;
  const [controls, defaults, health, funds, flags] = await Promise.all([
    readStoredControls(admin).catch(() => ({ jobs: {}, off: {} })),
    readModelDefaults(admin),
    getAllModelHealth(),
    loadProviderFunds(maxSingleRenderCostUsd()),
    admin.from("feature_flags").select("key, enabled, description").order("key"),
  ]);
  const menus = MENUS.map((m) => ({
    key: m.key,
    label: m.label,
    product: PRODUCTS.find((p) => p.key === m.product)?.name ?? m.product,
    items: menuItems(m.key).map((i) => {
      const on = isOffered(controls, m.key, i.id);
      const state = m.key === "video" || m.key === "picture" ? (health.get(i.id)?.state ?? "healthy") : "healthy";
      return {
        id: i.id,
        label: i.label,
        provider: i.provider,
        on,
        lock: on ? offLock(m.key, i.id, controls, defaults) : null,
        isDefault: (m.key === "video" && i.id === defaults.video) || (m.key === "picture" && i.id === defaults.picture),
        health: state,
        canSuspend: m.key === "video" || m.key === "picture",
      };
    }),
  }));
  return json(request, { menus, funds, flags: flags.data ?? [] });
}
