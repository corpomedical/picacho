import Link from "next/link";
import { requireAdmin } from "@/lib/admin/require-admin";
import { setDefaultModel, setJobModel, setMenuOffered } from "@/lib/admin/models-actions";
import { restoreModel, suspendModel } from "@/lib/admin/actions";
import { getAllModelHealth } from "@/lib/generations/model-health";
import { VIDEO_MODELS, isDormantVideoModel } from "@/lib/generations/providers/video-models";
import { IMAGE_MODELS, isImageModelPaidOnly } from "@/lib/generations/providers/image-models";
import { FREE_TIER_IMAGE_MODEL_ID, FREE_TIER_VIDEO_MODEL_ID } from "@/lib/plans";
import { ApplyOnChangeSelect } from "@/components/admin/apply-on-change-select";
import { identityModel, utilityModel } from "@/lib/generations/providers/openai-model";
import { fetchAll } from "@/lib/admin/fetch-all";
import { getModelControls } from "@/lib/models/controls";
import {
  FIXED_JOBS,
  JOB_SLOTS,
  MENUS,
  PRODUCTS,
  isOffered,
  jobSlot,
  menuDef,
  modelOptionLabel,
  pickedJobModel,
  type JobSlot,
  type MenuKey,
  type ModelControls,
  type ProductKey,
} from "@/lib/models/registry";
import { menuItems, offLock } from "@/lib/models/menus";
import { Button } from "@/components/ui/button";
import { AdminErrorBanner } from "@/components/admin-error-banner";
import { cn } from "@/lib/cn";

// Admin → Models (operator, 2026-10-02: "I want to see which models are being
// used and in which products we offer and I want the ability to switch
// models." Layout A, "By product", his pick on the mockup page): pick a
// product on the left; on the right, the model menus its customers choose
// from (on/off, default, health) and every model that runs unseen in it, with
// the switch beside each one that has more than one verified model.

type Search = Record<string, string | undefined>;

const DAY_MS = 24 * 60 * 60 * 1000;

function productKey(raw: string | undefined): ProductKey {
  return PRODUCTS.some((p) => p.key === raw) ? (raw as ProductKey) : "video";
}

/** The model a job runs on now, and why. */
function jobNow(slot: JobSlot, controls: ModelControls): { model: string; source: string } {
  const picked = pickedJobModel(controls, slot.key);
  if (picked) return { model: picked, source: picked === slot.default ? "your pick (the default)" : "your pick" };
  if (slot.key === "policy_reader" && process.env.OPENAI_MODEL?.trim()) return { model: utilityModel(), source: "from OPENAI_MODEL" };
  if (slot.key === "face_check" && process.env.IDENTITY_SCORER_MODEL?.trim()) return { model: identityModel(), source: "from IDENTITY_SCORER_MODEL" };
  return { model: slot.default, source: "default" };
}

const ERRORS: Record<string, string> = {
  bad_model: "That model isn't one this switch offers. Reload the page and try again.",
  save_failed: "Couldn't save the switch. Nothing changed; the details are in the server log.",
  default_off: "Put that model back on the menu before making it the default.",
};

function itemLabel(menu: MenuKey, id: string): string {
  return menuItems(menu).find((i) => i.id === id)?.label ?? id;
}

function defaultLabel(which: "video" | "picture", id: string): string {
  return (which === "video" ? VIDEO_MODELS.find((m) => m.id === id)?.name : IMAGE_MODELS.find((m) => m.id === id)?.name) ?? id;
}

/** Video renders in the last 30 days (null when unreadable), read outside render: the clock isn't pure. */
async function recentVideoRenders(admin: Awaited<ReturnType<typeof requireAdmin>>["admin"]) {
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
  return fetchAll<{ video_model_id: string | null; status: string | null }>((from, to) =>
    admin
      .from("generations")
      .select("video_model_id, status")
      .eq("content_type", "video")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(from, to),
  ).catch(() => null);
}

/** When a model was last switched, as "12 min ago" (null when never or unreadable). Read outside render: the clock isn't pure. */
async function lastModelSwitch(admin: Awaited<ReturnType<typeof requireAdmin>>["admin"]): Promise<string | null> {
  const { data } = await admin
    .from("admin_actions")
    .select("created_at")
    .like("action", "model.%")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();
  if (!data?.created_at) return null;
  const minutes = Math.max(0, Math.round((Date.now() - new Date(data.created_at).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} days ago`;
}

export default async function AdminModelsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { admin } = await requireAdmin();
  const product = productKey(sp.p);

  const [controls, health, settings, renders, lastSwitch] = await Promise.all([
    getModelControls(),
    getAllModelHealth(),
    admin.from("app_settings").select("key, value").in("key", ["video_model", "image_model"]),
    recentVideoRenders(admin),
    lastModelSwitch(admin).catch(() => null),
  ]);
  const setting = (k: string) => (settings.data ?? []).find((r) => r.key === k)?.value as string | undefined;
  const defaults = { video: setting("video_model") ?? "kling", picture: setting("image_model") ?? "gpt-image" };

  // Renders and failures per video model, last 30 days.
  const usage = new Map<string, { renders: number; failed: number }>();
  for (const r of renders ?? []) {
    if (!r.video_model_id) continue;
    const u = usage.get(r.video_model_id) ?? { renders: 0, failed: 0 };
    u.renders += 1;
    if (r.status === "failed") u.failed += 1;
    usage.set(r.video_model_id, u);
  }

  const outOfService = [...health.values()].filter((h) => h.state !== "healthy").length;

  // What needs a look, per product: a model out of service, something off a menu, a job off its default.
  const attention = (key: ProductKey): boolean =>
    MENUS.some(
      (m) =>
        m.product === key &&
        ((controls.off[m.key]?.length ?? 0) > 0 ||
          ((m.key === "video" || m.key === "picture") && menuItems(m.key).some((i) => (health.get(i.id)?.state ?? "healthy") !== "healthy"))),
    ) ||
    JOB_SLOTS.some((s) => s.products.includes(key) && pickedJobModel(controls, s.key) !== null && pickedJobModel(controls, s.key) !== s.default);

  const menus = MENUS.filter((m) => m.product === product);
  const jobs = JOB_SLOTS.filter((s) => s.products.includes(product));
  const fixed = FIXED_JOBS.filter((f) => f.products.includes(product));
  const productName = PRODUCTS.find((p) => p.key === product)!.name;

  // ---- What just changed, from ids only (the URL is never shown as text) ----
  let changed: { text: string; undo: React.ReactNode } | null = null;
  if (sp.d_kind === "job") {
    const slot = jobSlot(sp.d_job ?? "");
    if (slot && slot.options.some((o) => o.id === sp.d_now) && slot.options.some((o) => o.id === sp.d_was)) {
      changed = {
        text: `${slot.job.split(",")[0]}: now ${modelOptionLabel(sp.d_now!)}.`,
        undo: (
          <form action={setJobModel}>
            <input type="hidden" name="product" value={product} />
            <input type="hidden" name="job" value={slot.key} />
            <input type="hidden" name="model" value={sp.d_was} />
            <Button variant="secondary" size="sm" type="submit">
              Undo: back to {modelOptionLabel(sp.d_was!)}
            </Button>
          </form>
        ),
      };
    }
  } else if (sp.d_kind === "offer") {
    const menu = menuDef(sp.d_menu ?? "");
    if (menu && menuItems(menu.key).some((i) => i.id === sp.d_item)) {
      const on = sp.d_now === "1";
      const name = itemLabel(menu.key, sp.d_item!);
      changed = {
        text: on ? `${name} is back on the menu for customers.` : `${name} is off the menu for customers.`,
        undo: (
          <form action={setMenuOffered}>
            <input type="hidden" name="product" value={product} />
            <input type="hidden" name="menu" value={menu.key} />
            <input type="hidden" name="item" value={sp.d_item} />
            <input type="hidden" name="offer" value={on ? "0" : "1"} />
            <Button variant="secondary" size="sm" type="submit">
              Undo: {on ? "take it off again" : "put it back"}
            </Button>
          </form>
        ),
      };
    }
  } else if (sp.d_kind === "default" && (sp.d_which === "video" || sp.d_which === "picture")) {
    const which = sp.d_which;
    const known = (id: string | undefined) => !!id && (which === "video" ? VIDEO_MODELS.some((m) => m.id === id) : IMAGE_MODELS.some((m) => m.id === id));
    if (known(sp.d_now) && known(sp.d_was)) {
      changed = {
        text: `${defaultLabel(which, sp.d_now!)} is now the default ${which} model.`,
        undo: (
          <form action={setDefaultModel}>
            <input type="hidden" name="product" value={product} />
            <input type="hidden" name="kind" value={which} />
            <input type="hidden" name="model" value={sp.d_was} />
            <Button variant="secondary" size="sm" type="submit">
              Undo: back to {defaultLabel(which, sp.d_was!)}
            </Button>
          </form>
        ),
      };
    }
  }
  let problem: string | null = null;
  if (sp.err === "locked") {
    const menu = menuDef(sp.menu ?? "");
    const lock = menu ? offLock(menu.key, sp.item ?? "", controls, defaults) : null;
    problem = menu && lock ? `${itemLabel(menu.key, sp.item ?? "")} can't be turned off. ${lock}` : ERRORS.bad_model;
  } else if (sp.err) {
    problem = ERRORS[sp.err] ?? ERRORS.save_failed;
  }

  // ---- The four tiles (the draft's) ----
  const inUse = new Set<string>();
  for (const m of MENUS) for (const i of menuItems(m.key)) inUse.add(i.label);
  for (const slot of JOB_SLOTS) inUse.add(modelOptionLabel(jobNow(slot, controls).model));
  for (const f of FIXED_JOBS) for (const name of f.model.split(" · ")) inUse.add(name);

  const rowGrid = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2.5 sm:grid-cols-[minmax(0,1.6fr)_auto_auto_auto_auto]";

  return (
    <div>
      <AdminErrorBanner error={sp.error} />
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">Product</p>
      <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Models</h1>

      <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          { label: "Products", value: String(PRODUCTS.length), note: "that call a model" },
          { label: "Models in use", value: String(inUse.size), note: "across 8 providers" },
          { label: "Out of service", value: String(outOfService), note: "auto-trips + your suspends", bad: outOfService > 0 },
          { label: "Last switch", value: lastSwitch ?? "—", note: "every switch lands in Activity log", small: true },
        ].map((t) => (
          <div key={t.label} className="rounded-[14px] border border-atelier-rule bg-atelier-surface px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-atelier-muted">{t.label}</p>
            <p
              className={cn(
                "mt-1 font-numeral leading-tight tabular-nums",
                t.small ? "pt-1.5 text-lg" : "text-[26px]",
                t.bad ? "text-[#b3261e] dark:text-[#f3b1a8]" : "text-atelier-ink",
              )}
            >
              {t.value}
            </p>
            <p className="mt-0.5 text-xs text-atelier-muted">{t.note}</p>
          </div>
        ))}
      </div>

      {changed && (
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
          <span>{changed.text}</span>
          {changed.undo}
        </div>
      )}
      {problem && (
        <p className="mt-3.5 rounded-[10px] bg-red-50 px-3 py-2 text-[13px] text-red-800 dark:bg-red-500/10 dark:text-red-200">{problem}</p>
      )}

      <div className="mt-3.5 grid gap-3.5 lg:grid-cols-[250px_minmax(0,1fr)]">
        {/* Products */}
        <nav aria-label="Products" className="self-start rounded-2xl border border-atelier-rule bg-atelier-surface p-2">
          <ul className="flex flex-col gap-1">
            {PRODUCTS.map((p) => {
              const menuCount = MENUS.filter((m) => m.product === p.key).reduce((n, m) => n + menuItems(m.key).length, 0);
              const jobCount = JOB_SLOTS.filter((s) => s.products.includes(p.key)).length + FIXED_JOBS.filter((f) => f.products.includes(p.key)).length;
              const on = p.key === product;
              return (
                <li key={p.key}>
                  <Link
                    href={`/admin/models?p=${p.key}`}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-[10px] border px-2.5 py-2",
                      on
                        ? "border-atelier-rule bg-atelier-surface shadow-[inset_3px_0_0_var(--color-atelier-accent)]"
                        : "border-transparent hover:bg-atelier-ink/[0.04]",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-[13.5px] text-atelier-ink">{p.name}</span>
                      <span className="block text-[11.5px] text-atelier-muted">
                        {menuCount ? `${menuCount} on the menu · ` : ""}
                        {jobCount} behind the scenes
                      </span>
                    </span>
                    {attention(p.key) && <span aria-label="Changed or out of service" className="h-1.5 w-1.5 flex-none rounded-full bg-amber-500" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* The product: its menus, then behind the scenes — one card, as drawn. */}
        <section className="min-w-0 rounded-2xl border border-atelier-rule bg-atelier-surface p-4">
          <h2 className="text-base font-semibold text-atelier-ink">{productName}</h2>

          {menus.map((m) => {
            const items = menuItems(m.key);
            const withDefault = m.key === "video" || m.key === "picture";
            const currentDefault = m.key === "video" ? defaults.video : m.key === "picture" ? defaults.picture : null;
            // FLUX 3 can be the picture default without being on the menu (as drawn).
            const extra =
              m.key === "picture"
                ? IMAGE_MODELS.filter((i) => i.id === "flux").map((i) => ({ id: i.id, label: i.name, provider: "fal", detail: undefined, locked: undefined, defaultOnly: true }))
                : [];
            return (
              <div key={m.key}>
                <h3 className="mb-1 mt-[18px] text-[10.5px] font-semibold uppercase tracking-[0.12em] text-atelier-muted">{m.label}</h3>
                <ul>
                  {[...items.map((i) => ({ ...i, defaultOnly: false })), ...extra].map((item, idx) => {
                    const on = !item.defaultOnly && isOffered(controls, m.key, item.id);
                    const lock = item.defaultOnly ? null : on ? offLock(m.key, item.id, controls, defaults) : null;
                    const state = withDefault ? (health.get(item.id)?.state ?? "healthy") : "healthy";
                    const u = usage.get(item.id);
                    const cost = "costPerSecondUsd" in item ? (item as { costPerSecondUsd?: number }).costPerSecondUsd : undefined;
                    const dormant = m.key === "video" && isDormantVideoModel(item.id);
                    return (
                      <li key={item.id} className={cn(rowGrid, idx > 0 && "border-t border-atelier-rule")}>
                        <div className="min-w-0">
                          <p className="text-[13.5px] text-atelier-ink">
                            {item.label}
                            {item.id === FREE_TIER_VIDEO_MODEL_ID && m.key === "video" && <Chip>free accounts</Chip>}
                            {item.id === FREE_TIER_IMAGE_MODEL_ID && m.key === "picture" && <Chip>free accounts</Chip>}
                            {m.key === "picture" && isImageModelPaidOnly(item.id) && <Chip>paid plans</Chip>}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11.5px] text-atelier-muted">
                            <span>{item.provider}</span>
                            {item.detail && (
                              <>
                                <span>·</span>
                                <span className="break-all font-mono text-[11px]">{item.detail.split(" · ").find((x) => x.includes("/")) ?? item.detail}</span>
                              </>
                            )}
                            {item.defaultOnly && <span>· default only, not on the menu</span>}
                            {dormant && <span>· experimental</span>}
                            {withDefault && !item.defaultOnly && (
                              <form action={state === "healthy" ? suspendModel : restoreModel} className="inline">
                                <input type="hidden" name="model_id" value={item.id} />
                                <input type="hidden" name="kind" value={m.key === "video" ? "video" : "image"} />
                                <input type="hidden" name="product" value={product} />
                                <span>· </span>
                                <button type="submit" className="underline decoration-atelier-rule underline-offset-2 hover:text-atelier-ink">
                                  {state === "healthy" ? "Suspend" : "Restore"}
                                </button>
                              </form>
                            )}
                          </div>
                        </div>
                        <span className="hidden text-xs tabular-nums text-atelier-muted sm:inline">{cost !== undefined ? `$${cost}/s` : ""}</span>
                        <span className="hidden text-xs tabular-nums text-atelier-muted sm:inline">
                          {m.key === "video" && u ? `${u.renders.toLocaleString("en-US")} / 30 d` : ""}
                        </span>
                        <span className="hidden sm:inline">
                          {withDefault && !dormant && (on || item.defaultOnly) && (
                            <form action={setDefaultModel}>
                              <input type="hidden" name="product" value={product} />
                              <input type="hidden" name="kind" value={m.key} />
                              <input type="hidden" name="model" value={item.id} />
                              <button
                                type="submit"
                                role="radio"
                                aria-checked={item.id === currentDefault}
                                disabled={item.id === currentDefault}
                                className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-atelier-muted enabled:hover:text-atelier-ink"
                              >
                                <span
                                  aria-hidden
                                  className={cn(
                                    "h-3 w-3 rounded-full border",
                                    item.id === currentDefault ? "border-atelier-accent bg-atelier-accent shadow-[inset_0_0_0_2px_var(--color-atelier-paper)]" : "border-atelier-muted",
                                  )}
                                />
                                default
                              </button>
                            </form>
                          )}
                        </span>
                        <span className="flex items-center gap-2 justify-self-end">
                          {state !== "healthy" ? (
                            <Pill tone="bad">Out of service</Pill>
                          ) : item.defaultOnly ? null : (
                            <Pill tone={on ? "good" : "mute"}>{on ? "On" : "Off"}</Pill>
                          )}
                          {!item.defaultOnly && (
                            <form action={setMenuOffered}>
                              <input type="hidden" name="product" value={product} />
                              <input type="hidden" name="menu" value={m.key} />
                              <input type="hidden" name="item" value={item.id} />
                              <input type="hidden" name="offer" value={on ? "0" : "1"} />
                              <button
                                type="submit"
                                role="switch"
                                aria-checked={on}
                                aria-label={`Offer ${item.label} to customers`}
                                disabled={Boolean(lock)}
                                title={lock ? `Stays on: ${lock}` : undefined}
                                className={cn(
                                  "relative block h-[18px] w-[30px] rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                                  on ? "bg-emerald-600" : "bg-atelier-rule",
                                )}
                              >
                                <span
                                  className={cn(
                                    "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-[left]",
                                    on ? "left-[14px]" : "left-[2px]",
                                  )}
                                />
                              </button>
                            </form>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {(jobs.length > 0 || fixed.length > 0) && (
            <>
              <h3 className="mb-1 mt-[18px] text-[10.5px] font-semibold uppercase tracking-[0.12em] text-atelier-muted">Behind the scenes</h3>
              <ul>
                {jobs.map((slot, idx) => {
                  const now = jobNow(slot, controls);
                  const options = slot.options.some((o) => o.id === now.model)
                    ? slot.options.map((o) => ({ id: o.id, label: o.label }))
                    : [{ id: now.model, label: `${now.model} (${now.source})` }, ...slot.options];
                  return (
                    <li
                      key={slot.key}
                      className={cn("grid items-center gap-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,240px)]", idx > 0 && "border-t border-atelier-rule")}
                    >
                      <div className="min-w-0">
                        <p className="text-[13.5px] text-atelier-ink">{slot.job}</p>
                        {slot.warn && (
                          <p className="mt-1.5 rounded-[10px] bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-atelier-ink dark:bg-amber-500/10">
                            <b className="text-amber-700 dark:text-amber-300">Check after switching.</b> {slot.warn}
                          </p>
                        )}
                      </div>
                      <form action={setJobModel}>
                        <input type="hidden" name="product" value={product} />
                        <input type="hidden" name="job" value={slot.key} />
                        <ApplyOnChangeSelect id={`job-${slot.key}`} name="model" label={slot.job} defaultValue={now.model} options={options} />
                      </form>
                    </li>
                  );
                })}
                {fixed.map((f, idx) => (
                  <li
                    key={f.job}
                    className={cn(
                      "grid items-center gap-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,240px)]",
                      (idx > 0 || jobs.length > 0) && "border-t border-atelier-rule",
                    )}
                  >
                    <p className="text-[13.5px] text-atelier-ink">{f.job}</p>
                    <div>
                      <p className="text-[13px] text-atelier-ink">{f.model}</p>
                      <p className="text-xs text-atelier-muted">{f.why}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="ml-1.5 whitespace-nowrap rounded-md border border-atelier-rule px-1.5 py-px text-[10.5px] text-atelier-muted">{children}</span>;
}

function Pill({ tone, children }: { tone: "good" | "mute" | "bad"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium before:h-1.5 before:w-1.5 before:rounded-full before:bg-current",
        tone === "good" && "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
        tone === "mute" && "bg-atelier-rule text-atelier-muted",
        tone === "bad" && "bg-red-600/10 text-[#b3261e] dark:text-[#f3b1a8]",
      )}
    >
      {children}
    </span>
  );
}
