import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { renderTemplate } from "@/lib/email/render";
import { sendEmail, unsubscribeUrl } from "@/lib/email/send";

// The onboarding drip — fired once a day by Vercel cron (vercel.json).
// Eligibility (confirmed address, opt-out respected, day windows, dedup) is
// computed in ONE definer function in the database (drip_candidates —
// supabase/pending-2026-08-21/drip-emails.sql); this route just renders and
// sends. Idempotency: the dedup row is inserted BEFORE sending (primary-key
// insert, so two overlapping runs can't double-send) and removed if the
// send itself fails, so tomorrow's run retries that person.
//
// Copy lives here in code, English-only for now (same convention as the
// guides), short and honest — three emails total for a new account's first
// week, and nothing after.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TEMPLATES: Record<string, { subject: string; body: string }> = {
  drip_day1: {
    subject: "Your first render is waiting, {{username}}",
    body:
      "Hi {{username}},\n\n" +
      "You created your Picacho account but haven't generated anything yet — and every account gets one free generation a day, no card needed.\n\n" +
      "The two-minute path: create a character from one photo, type a scene in plain words, and watch the pipeline draft, review, generate, and score the result against your character's photo.\n\n" +
      "Your free generation for today is already waiting: https://picacho.ai/app",
  },
  drip_day3: {
    subject: "The number under every render",
    body:
      "Hi {{username}},\n\n" +
      "Three days in — if you've generated with your character, you'll have noticed the identity score under each result. That number is a vision model comparing the render to your character's photo, so you see the match before your audience does.\n\n" +
      "Two things worth trying next: a video (your character acts — it doesn't just pose), and a second reference photo from a different angle, which tightens the identity lock measurably.\n\n" +
      "Today's free generation is waiting: https://picacho.ai/app",
  },
  drip_day7: {
    subject: "A week of the same face — here's what $9 unlocks",
    body:
      "Hi {{username}},\n\n" +
      "You've had a week of one free generation a day. If the consistency is working for you, the Basic plan is $9/month for 12 credits — a standard image or video costs one credit, failed generations never cost anything, and there are no watermarks on any plan.\n\n" +
      "Plans and the full credit math: https://picacho.ai/pricing\n\n" +
      "And if free-once-a-day is all you need right now, that never expires.",
  },
};

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: candidates, error } = await admin.rpc("drip_candidates");
  if (error) {
    console.error("drip: candidates query failed", error.message);
    return NextResponse.json({ error: "candidates failed" }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;
  // Bounded per run — a backlog drains over successive days rather than
  // risking the function timeout mid-batch.
  const batch = (candidates ?? []).slice(0, 200);

  for (const c of batch as {
    user_id: string;
    email: string;
    username: string | null;
    full_name: string | null;
    template: string;
  }[]) {
    const tpl = TEMPLATES[c.template];
    if (!tpl || !c.email) {
      skipped++;
      continue;
    }

    // Claim first (PK insert) — overlapping runs can't both claim.
    const { error: claimError } = await admin
      .from("drip_sends")
      .insert({ user_id: c.user_id, template: c.template });
    if (claimError) {
      skipped++; // already claimed by a concurrent/prior run
      continue;
    }

    const unsubscribe = await unsubscribeUrl(c.user_id);
    const { subject, html } = renderTemplate(
      tpl.subject,
      tpl.body,
      {
        username: c.username ?? "there",
        email: c.email,
        plan: "",
        credits: "",
      },
      unsubscribe,
    );

    const { error: sendError } = await sendEmail({ to: c.email, subject, html, unsubscribeUrl: unsubscribe });
    if (sendError) {
      // Release the claim so tomorrow retries this person.
      await admin.from("drip_sends").delete().match({ user_id: c.user_id, template: c.template });
      console.error("drip: send failed", c.template, sendError);
      skipped++;
      continue;
    }
    sent++;
  }

  return NextResponse.json({ sent, skipped, considered: (candidates ?? []).length });
}
