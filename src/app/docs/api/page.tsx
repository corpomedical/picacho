import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";

// Public API reference.
//
// Deliberately one page and deliberately plain: the whole API is four
// endpoints, and a developer evaluating it wants to read the actual request
// and the actual response, not navigate a documentation site. Every example
// below is copy-pasteable as written.
//
// Example ids are OBVIOUSLY-FAKE placeholder UUIDs on purpose. This page
// used to show a real production character id and generation id lifted from
// a live account — public docs are exactly where an attacker shops for
// known-valid ids to probe with, and a customer pasting the example got a
// confusing "not yours" 404 instead of an obviously-placeholder error.

export const metadata: Metadata = {
  title: "API — Picacho",
  description:
    "Generate character-consistent images from your own software. Four endpoints, one API key.",
};

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-[12px] border border-slate-200 bg-slate-900 p-4 text-[12.5px] leading-relaxed text-slate-100">
      <code>{children}</code>
    </pre>
  );
}

function Endpoint({
  method,
  path,
  children,
}: {
  method: string;
  path: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-slate-200 py-8">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="rounded-[6px] bg-ochre px-2 py-1 font-mono text-[11px] font-bold text-white">
          {method}
        </span>
        <span className="font-mono text-sm font-semibold text-slate-900">{path}</span>
      </div>
      <div className="mt-3 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen bg-paper">
      <MarketingHeader />

      <main className="mx-auto max-w-3xl px-8 py-16">
        <h1 className="font-display text-4xl font-bold tracking-[-0.035em] text-slate-900">
          The Picacho API
        </h1>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          Generate images of your own characters from your own software — the same pipeline the app
          uses, with the same identity locking and the same match scoring. Four endpoints, one key,
          and it draws on the credits already included in your plan.
        </p>
        <p className="mt-4 rounded-[12px] border border-ochre/25 bg-ochre-soft/40 p-4 text-sm leading-relaxed text-slate-700">
          Included with <strong>Elite</strong>. Create a key in{" "}
          <Link href="/app/settings" className="font-medium text-ochre underline underline-offset-2">
            Settings → API keys
          </Link>
          . If you&apos;re on another plan and need it, get in touch — we enable it per account.
        </p>

        <h2 className="mt-12 font-display text-2xl font-bold tracking-[-0.03em] text-slate-900">
          Authentication
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Send your key as a bearer token on every request. Keys are shown once, when you create
          them — we store only a hash, so a lost key can&apos;t be recovered, only replaced.
        </p>
        <Code>{`curl https://picacho.ai/api/v1/usage \\
  -H "Authorization: Bearer pic_live_your_key_here"`}</Code>

        <h2 className="mt-12 font-display text-2xl font-bold tracking-[-0.03em] text-slate-900">
          A first request, end to end
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          List your characters to get an id, then generate against it. That&apos;s the whole
          integration.
        </p>
        <Code>{`# 1. find your character
curl https://picacho.ai/api/v1/characters \\
  -H "Authorization: Bearer $PICACHO_KEY"

# 2. make an image of her
curl -X POST https://picacho.ai/api/v1/generations \\
  -H "Authorization: Bearer $PICACHO_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "walking through a snowy street at night",
    "character_id": "11111111-2222-4333-8444-555555555555"
  }'`}</Code>

        <div className="mt-14">
          <Endpoint method="GET" path="/api/v1/characters">
            <p>
              Your characters, newest first. <code className="text-[12.5px]">has_identity_photo</code>{" "}
              tells you which ones can hold a face — a character without one will still generate, but
              nothing anchors the likeness.
            </p>
            <Code>{`{
  "characters": [
    {
      "id": "11111111-2222-4333-8444-555555555555",
      "name": "Eva",
      "traits": { "hair": "long red curls", "distinguishing_features": "freckles" },
      "has_identity_photo": true,
      "created_at": "2026-08-04T18:22:11.000Z"
    }
  ]
}`}</Code>
          </Endpoint>

          <Endpoint method="POST" path="/api/v1/generations">
            <p>
              Makes one image and returns it when it&apos;s ready — typically 20 to 60 seconds, so
              set your client timeout accordingly. One credit per image. Picacho retries
              automatically before reporting a failure; if something goes wrong on our side,
              get in touch and we&apos;ll credit it back.
            </p>
            <p className="mt-3">
              <strong className="font-semibold text-slate-900">Body:</strong>{" "}
              <code className="text-[12.5px]">prompt</code> (required, up to 2000 characters) and{" "}
              <code className="text-[12.5px]">character_id</code> (optional — omit it and you get a
              generic image with no identity locking).
            </p>
            <Code>{`{
  "id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  "status": "succeeded",
  "image_url": "https://picacho.ai/api/media/generated-images/...",
  "final_prompt": "Eva walks along a narrow cobblestone street at night...",
  "match_score": 91,
  "credits_used": 1
}`}</Code>
            <p className="mt-3">
              <code className="text-[12.5px]">final_prompt</code> is what actually ran after
              Picacho&apos;s drafting step expanded your sentence — usually the most useful thing to
              tune against. <code className="text-[12.5px]">match_score</code> is how closely the
              result matches the character&apos;s identity photo, 0–100; it&apos;s null when no
              character was used.
            </p>
            <p className="mt-3">
              The image URL is permanent and needs no authentication, so you can store it, embed it,
              or hand it to a CDN.
            </p>
          </Endpoint>

          <Endpoint method="GET" path="/api/v1/generations/{id}">
            <p>
              Fetch a generation later. Useful if your HTTP client timed out before the POST
              returned — the work still finished on our side, and the result is here, including the
              same <code className="text-[12.5px]">final_prompt</code>,{" "}
              <code className="text-[12.5px]">image_url</code> and{" "}
              <code className="text-[12.5px]">match_score</code> the POST would have returned.
            </p>
          </Endpoint>

          <Endpoint method="GET" path="/api/v1/usage">
            <p>
              What&apos;s left this billing period. Worth calling before firing a large batch, so a
              budget ceiling shows up as one number rather than a wall of errors halfway through.
            </p>
            <Code>{`{
  "plan": "elite",
  "plan_label": "Elite",
  "included_this_period": 300,
  "used_this_period": 42,
  "remaining_this_period": 258,
  "purchased_credits": 0,
  "period_started_at": "2026-08-09T00:00:00.000Z"
}`}</Code>
            <p className="mt-3">
              Two budgets, drawn in order: <code className="text-[12.5px]">remaining_this_period</code>{" "}
              is the monthly allowance included with the plan, and{" "}
              <code className="text-[12.5px]">purchased_credits</code> is a separate one-off balance
              (credit packs) that covers anything the monthly allowance can&apos;t and never resets.
              Generating stops with a 402 only once both are exhausted, so the real headroom before a
              batch is the sum of the two.
            </p>
          </Endpoint>
        </div>

        <h2 className="mt-12 font-display text-2xl font-bold tracking-[-0.03em] text-slate-900">
          Errors and limits
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Errors come back as{" "}
          <code className="text-[12.5px]">{`{ "error": { "code", "message" } }`}</code> with a
          matching HTTP status: <strong>401</strong> for a missing, invalid or revoked key,{" "}
          <strong>403</strong> when the account doesn&apos;t have API access, <strong>402</strong>{" "}
          when you&apos;re out of credits, <strong>404</strong> for an id that isn&apos;t yours, and{" "}
          <strong>429</strong> past 30 requests per minute to{" "}
          <code className="text-[12.5px]">POST /api/v1/generations</code>. The limit counts
          requests, not finished images — a request refused with a 402 still consumes a slot — so a
          batch that runs out of credits mid-loop can hit 429s too. Back off for the number of
          seconds in the <code className="text-[12.5px]">retry-after</code> header.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Video isn&apos;t in this version. A render takes six to ten minutes and needs a queue
          rather than a request — if you need it, tell us and it moves up the list.
        </p>
      </main>

      <MarketingFooter />
    </div>
  );
}
