import Link from "next/link";
import type { Messages } from "@/lib/i18n/messages";
import { localizeServerText } from "@/lib/i18n/server-text";
import { SETS_NOT_OPEN } from "@/lib/sets/messages";
import { settingsHref } from "@/lib/settings/tabs";

// What a free account sees at /app/sets and /app/sets/<id> on the web
// (Helios Cut 3, step 3), instead of "not found": what Helios 3D is, the
// sentence the server already answers with (SETS_NOT_OPEN, "part of the paid
// plans"), and a way to the plans. Both pages send only SETS_NOT_OPEN here,
// and only once Helios is open to the plans (SETS_OPEN_TO_PLANS); before
// that, and in the Android shell, they stay 404.
//
// Reader-mode gate, as on the Angle Stage's own upgrade panel
// (app/app/stage/[id]/page.tsx): the Android shell may say which plans
// include Helios, but must not offer a way to go and get one — so "See
// plans" sits inside !native even though the pages 404 the shell first.
// Nothing here says whether a set exists: the access check runs before any
// set is looked up (lib/sets/data.ts), so a set's own address shows the same
// panel as the Sets home.

export function SetsUpgrade({ t, native }: { t: Messages; native: boolean }) {
  const s = t.sets;
  return (
    <div className="mx-auto max-w-5xl space-y-5" data-sets-upgrade>
      <div>
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">{s.eyebrow}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-atelier-ink">{s.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-atelier-muted">{s.subtitle}</p>
      </div>
      <div className="space-y-3 rounded-media border border-atelier-rule bg-atelier-surface p-6">
        <p className="text-sm text-atelier-ink">{localizeServerText(SETS_NOT_OPEN, t)}</p>
        {!native && (
          <Link
            href={settingsHref("billing")}
            className="inline-block cursor-pointer text-sm font-medium text-atelier-accent underline underline-offset-2 hover:text-atelier-accent/80"
          >
            {t.stage.upgradeCta}
          </Link>
        )}
      </div>
    </div>
  );
}
