import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { withJobAlert } from "@/lib/push/admin-alerts";
import { notifyAdmins } from "@/lib/push/web-push";
import { loadRetention } from "@/lib/retention/load";
import { MAX_PUSHES_PER_RUN, morePush, quietPush, stalledPush } from "@/lib/retention/alerts";
import { QUIET_AFTER_DAYS, QUIET_LIST_DAYS, dayKey } from "@/lib/retention/model";

// Who comes back's morning check (2026-10-03, operator: "Draft all three,
// both admins" → the alerts board). Daily, vercel.json:
//   - a paying customer with no visit for QUIET_AFTER_DAYS → "went quiet";
//   - a first render that failed or was refused, nothing since → "didn't land".
// Each fires once per person per episode: retention_alerts is claimed (PK
// insert) before the push, the drip's pattern, so overlapping runs can't
// both send. A quiet episode is keyed by the last day they were seen, so
// coming back and going quiet again is a new one. Cancellations push from
// the webhooks the moment they happen (lib/retention/subscription-events.ts).
//
// Before supabase/applied/2026-10-03/who-comes-back.sql runs, every claim fails and
// nothing is sent.
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const retention = await loadRetention(admin);

  const due: { userId: string; kind: "quiet" | "stalled"; episode: string; push: ReturnType<typeof quietPush> }[] = [];
  for (const p of retention.paths.values()) {
    if (p.paying && p.quietDays !== null && p.quietDays >= QUIET_AFTER_DAYS && p.quietDays <= QUIET_LIST_DAYS) {
      due.push({ userId: p.id, kind: "quiet", episode: p.lastActiveAt ? dayKey(p.lastActiveAt) : "never", push: quietPush(p) });
    } else if (p.stalled) {
      due.push({ userId: p.id, kind: "stalled", episode: "first", push: stalledPush(p) });
    }
  }

  let sent = 0;
  let skipped = 0;
  let held = 0;
  for (const d of due) {
    const { error } = await admin.from("retention_alerts").insert({ user_id: d.userId, kind: d.kind, episode: d.episode });
    if (error) {
      skipped++; // already sent for this episode, or the table isn't there yet
      continue;
    }
    if (sent < MAX_PUSHES_PER_RUN) {
      await notifyAdmins(d.push);
      sent++;
    } else {
      held++;
    }
  }
  if (held > 0) await notifyAdmins(morePush(held));

  return NextResponse.json({ considered: due.length, sent, summed: held, skipped });
}

// A 5xx or a throw reaches the operator's phone, damped per job (lib/push/admin-alerts.ts).
export const GET = withJobAlert("retention", run);
