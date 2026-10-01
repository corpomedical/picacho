import Link from "next/link";
import { requireAdmin } from "@/lib/admin/require-admin";
import { setDefaultModel, setJobModel, setMenuOffered } from "@/lib/admin/models-actions";
import { restoreModel, suspendModel } from "@/lib/admin/actions";
import { getAllModelHealth } from "@/lib/generations/model-health";
import { VIDEO_MODELS, isDormantVideoModel } from "@/lib/generations/providers/video-models";
import { IMAGE_MODELS, SELECTABLE_IMAGE_MODEL_IDS } from "@/lib/generations/providers/image-models";
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
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

export default async function AdminModelsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { admin } = await requireAdmin();
  const product = productKey(sp.p);

  const [controls, health, settings, renders] = await Promise.all([
    getModelControls(),
    getAllModelHealth(),
    admin.from("app_settings").select("key, value").in("key", ["video_model", "image_model"]),
    recentVideoRenders(admin),
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
  const offCount = Object.values(controls.off).reduce((n, ids) => n + (ids?.length ?? 0), 0);
  const pickedCount = JOB_SLOTS.filter((s) => {
    const p = pickedJobModel(controls, s.key);
    return p !== null && p !== s.default;
  }).length;

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

  return (
    <div>
      <AdminErrorBanner error={sp.error} />
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">Product</p>
        <h1 className="mt-1 font-numeral text-3xl text-atelier-ink">Models</h1>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-neutral-500">
        Every model each product runs, and the switch beside it. A switch reaches every server within 15 seconds and
        lands in the Activity log. Keys, balances and the Seedance lane are on{" "}
        <Link href="/admin/providers" className="underline">
          AI providers
        </Link>
        .
      </p>

      {changed && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          <span>{changed.text}</span>
          {changed.undo}
        </div>
      )}
      {problem && (
        <p className="mt-4 rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          {problem}
        </p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Products", value: String(PRODUCTS.length), note: "that run a model" },
          { label: "Out of service", value: String(outOfService), note: "video and picture models", bad: outOfService > 0 },
          { label: "Off the menu", value: String(offCount), note: "hidden from customers" },
          { label: "Switched jobs", value: String(pickedCount), note: "running off their default" },
        ].map((t) => (
          <div key={t.label} className="rounded-2xl border border-atelier-rule bg-atelier-surface px-4 py-3.5">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-atelier-muted">{t.label}</p>
            <p className={cn("mt-1.5 font-numeral text-[28px] leading-none tabular-nums", t.bad ? "text-[#b3261e] dark:text-[#f3b1a8]" : "text-atelier-ink")}>
              {t.value}
            </p>
            <p className="mt-1.5 text-xs text-atelier-muted">{t.note}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        <nav aria-label="Products" className="rounded-2xl border border-atelier-rule bg-atelier-surface p-2">
          <ul className="flex flex-col gap-0.5">
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
                      "flex items-center justify-between gap-2 rounded-[10px] px-3 py-2.5",
                      on ? "bg-atelier-ink/[0.06] shadow-[inset_3px_0_0_var(--color-atelier-accent)]" : "hover:bg-atelier-ink/[0.04]",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm text-atelier-ink">{p.name}</span>
                      <span className="block text-xs text-atelier-muted">
                        {menuCount ? `${menuCount} on menus · ` : ""}
                        {jobCount} behind the scenes
                      </span>
                    </span>
                    {attention(p.key) && <span aria-label="Something changed or out of service" className="h-2 w-2 flex-none rounded-full bg-amber-500" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0 space-y-4">
          <h2 className="font-numeral text-xl text-atelier-ink">{productName}</h2>

          {menus.map((m) => {
            const items = menuItems(m.key);
            const withHealth = m.key === "video" || m.key === "picture";
            const defaultOptions =
              m.key === "video"
                ? VIDEO_MODELS.filter((v) => isOffered(controls, "video", v.id) && !isDormantVideoModel(v.id)).map((v) => ({ id: v.id, name: v.name }))
                : m.key === "picture"
                  ? IMAGE_MODELS.filter((i) => (SELECTABLE_IMAGE_MODEL_IDS as readonly string[]).includes(i.id) || i.id === "flux")
                      .filter((i) => i.id === "flux" || isOffered(controls, "picture", i.id))
                      .map((i) => ({ id: i.id, name: i.id === "flux" ? `${i.name} (default only, not on the menu)` : i.name }))
                  : null;
            const currentDefault = m.key === "video" ? defaults.video : m.key === "picture" ? defaults.picture : null;
            return (
              <Card key={m.key}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-900">{m.label}</h3>
                    <p className="mt-1 text-xs text-neutral-500">
                      Off hides it where customers pick and the server refuses it. Nothing already rendering is touched.
                    </p>
                  </div>
                  {defaultOptions && currentDefault && (
                    <form action={setDefaultModel} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="product" value={product} />
                      <input type="hidden" name="kind" value={m.key} />
                      <label htmlFor={`default-${m.key}`} className="text-xs text-neutral-500">
                        Default
                      </label>
                      <select
                        id={`default-${m.key}`}
                        name="model"
                        defaultValue={currentDefault}
                        className="max-w-[16rem] rounded-[9px] border border-atelier-rule bg-atelier-paper px-2 py-1.5 text-sm text-atelier-ink"
                      >
                        {defaultOptions.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                      <Button variant="secondary" size="sm" type="submit">
                        Set
                      </Button>
                    </form>
                  )}
                </div>
                {m.key === "video" && (
                  <p className="mt-2 text-xs text-neutral-400">
                    The default runs when a customer picks nothing. Free accounts always render on Wan 2.2 Turbo.
                    {renders === null ? " Usage couldn't be read." : " Renders and failures are the last 30 days."}
                  </p>
                )}

                <ul className="mt-3 divide-y divide-neutral-100">
                  {items.map((item) => {
                    const on = isOffered(controls, m.key, item.id);
                    const lock = on ? offLock(m.key, item.id, controls, defaults) : null;
                    const h = withHealth ? health.get(item.id) : undefined;
                    const state = h?.state ?? "healthy";
                    const u = usage.get(item.id);
                    return (
                      <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                        <div className="min-w-0 flex-1 basis-64">
                          <p className="text-sm text-neutral-900">
                            {item.label}
                            {item.id === currentDefault && <span className="ml-2 text-xs font-medium text-atelier-accent">default</span>}
                          </p>
                          <p className="mt-0.5 break-all text-xs text-neutral-400">
                            {item.provider}
                            {item.detail ? ` · ${item.detail}` : ""}
                          </p>
                          {lock && <p className="mt-0.5 text-xs text-neutral-400">Stays on: {lock}</p>}
                        </div>
                        {item.costPerSecondUsd !== undefined && (
                          <span className="text-xs tabular-nums text-neutral-500">${item.costPerSecondUsd}/s</span>
                        )}
                        {m.key === "video" && renders !== null && (
                          <span className="text-xs tabular-nums text-neutral-500">
                            {u ? `${u.renders} renders · ${u.failed} failed` : "no renders"}
                          </span>
                        )}
                        {withHealth && (
                          <form action={state === "healthy" ? suspendModel : restoreModel} className="flex items-center gap-2">
                            <input type="hidden" name="model_id" value={item.id} />
                            <input type="hidden" name="kind" value={m.key === "video" ? "video" : "image"} />
                            <input type="hidden" name="product" value={product} />
                            <Badge tone={state === "healthy" ? "success" : state === "trial" ? "neutral" : "danger"}>
                              {state === "healthy" ? "In service" : state === "trial" ? "Trial retry" : "Out of service"}
                            </Badge>
                            <Button variant="secondary" size="sm" type="submit">
                              {state === "healthy" ? "Suspend" : "Restore"}
                            </Button>
                          </form>
                        )}
                        <form action={setMenuOffered} className="flex items-center gap-2">
                          <input type="hidden" name="product" value={product} />
                          <input type="hidden" name="menu" value={m.key} />
                          <input type="hidden" name="item" value={item.id} />
                          <input type="hidden" name="offer" value={on ? "0" : "1"} />
                          <span className={cn("w-7 text-xs", on ? "text-emerald-700 dark:text-emerald-400" : "text-neutral-400")}>{on ? "On" : "Off"}</span>
                          <button
                            type="submit"
                            role="switch"
                            aria-checked={on}
                            aria-label={`Offer ${item.label} to customers`}
                            disabled={Boolean(lock)}
                            title={lock ?? undefined}
                            className={cn(
                              "relative h-[18px] w-[30px] flex-none rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                              on ? "bg-emerald-600" : "bg-neutral-300",
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
                      </li>
                    );
                  })}
                </ul>
                {withHealth && (
                  <p className="mt-2 border-t border-neutral-100 pt-3 text-xs text-neutral-400">
                    Health: a model takes itself out of service after 3 failures in a row from 2 or more accounts and comes
                    back on its own. Suspend takes it out now; renders that asked for it move to the cheapest model in
                    service.
                  </p>
                )}
              </Card>
            );
          })}

          {(jobs.length > 0 || fixed.length > 0) && (
            <Card>
              <h3 className="text-sm font-semibold text-neutral-900">Behind the scenes</h3>
              <p className="mt-1 text-xs text-neutral-500">
                Models customers never pick. A switch lists only models checked on 2 October 2026 to answer that job&apos;s
                exact request.
              </p>
              <ul className="mt-3 divide-y divide-neutral-100">
                {jobs.map((slot) => {
                  const now = jobNow(slot, controls);
                  return (
                    <li key={slot.key} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,300px)] sm:items-start">
                      <div className="min-w-0">
                        <p className="text-sm text-neutral-900">{slot.job}</p>
                        <p className="mt-0.5 text-xs text-neutral-400">
                          Now {modelOptionLabel(now.model)} · {now.source}
                        </p>
                        {slot.warn && (
                          <p className="mt-2 rounded-[10px] bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                            <span className="font-semibold">Check after switching.</span> {slot.warn}
                          </p>
                        )}
                      </div>
                      <form action={setJobModel} className="flex items-center gap-2">
                        <input type="hidden" name="product" value={product} />
                        <input type="hidden" name="job" value={slot.key} />
                        <label htmlFor={`job-${slot.key}`} className="sr-only">
                          Model for: {slot.job}
                        </label>
                        <select
                          id={`job-${slot.key}`}
                          name="model"
                          defaultValue={now.model}
                          className="min-w-0 flex-1 rounded-[9px] border border-atelier-rule bg-atelier-paper px-2 py-1.5 text-sm text-atelier-ink"
                        >
                          {slot.options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.label}
                              {o.id === slot.default ? " (default)" : ""}
                            </option>
                          ))}
                        </select>
                        <Button variant="secondary" size="sm" type="submit">
                          Switch
                        </Button>
                      </form>
                    </li>
                  );
                })}
                {fixed.map((f) => (
                  <li key={f.job} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
                    <div className="min-w-0">
                      <p className="text-sm text-neutral-900">{f.job}</p>
                      <p className="mt-0.5 text-xs text-neutral-400">{f.why}</p>
                    </div>
                    <p className="text-sm text-neutral-600 sm:pt-0">{f.model}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
