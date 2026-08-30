// Backfill character_profiles.render_style — the precise half of the
// Seedance 2.5 policy check (2026-08-30).
//
// WHY THIS EXISTS. send-plan.ts predicts the Seedance 2.5 likeness refusal
// two ways: keyed on the character's stored render_style when it is known,
// and falling back to a heuristic ("style unknown but the character has
// saved photos, so assume a real person") when it is not. Measured against
// production on 2026-08-30, render_style was null on 11 of 12 characters —
// so every catch was coming from the guess, and the classifier that was
// supposed to answer the question had effectively never run.
//
// The guess is right for photoreal characters and WRONG for illustrated
// ones, which are exactly the characters Seedance 2.5 accepts. That is why
// the warning cannot become a hard block until this has run: blocking on a
// guess would start refusing renders that would have worked.
//
// render_style is only written at character-save time, and only when the
// photo set changes, so existing characters would never acquire one on their
// own. This walks them once.
//
// SAFE TO RE-RUN. Only touches rows where render_style is null and at least
// one reference photo exists. One vision call per character (~$0.001 each),
// so a full pass over a few hundred characters costs well under a dollar.
//
// Usage, from the repo root:
//   node scripts/backfill-render-style.mjs          # report only, writes nothing
//   node scripts/backfill-render-style.mjs --apply  # actually write

import fs from "node:fs";

const APPLY = process.argv.includes("--apply");

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI = env.OPENAI_API_KEY;
const MODEL = env.OPENAI_MODEL || "gpt-5.4-mini";

if (!BASE || !KEY) throw new Error("Supabase env missing from .env.local");
if (!OPENAI) {
  console.error(
    "OPENAI_API_KEY is empty in .env.local — the classifier cannot run locally.\n" +
      "Run this where the key is set, or copy the production value in temporarily.",
  );
  process.exit(1);
}

const h = { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json" };

// Same prompt shape as classifyRenderStyle in providers/describe-image.ts.
// Kept in step with it deliberately: a backfill that classifies differently
// from the live path would seed the table with answers the app disagrees with.
async function classify(imageUrl) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Is this image a PHOTOREAL depiction of a person (a photograph, or a " +
                "photorealistic render indistinguishable from one), or an ILLUSTRATED " +
                "one (cartoon, anime, 3D character, painting, vector, mascot)? " +
                'Reply with ONLY one word: photoreal or illustrated.',
            },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      max_completion_tokens: 2000,
    }),
  });
  if (!res.ok) return null;
  const text = (await res.json())?.choices?.[0]?.message?.content?.toLowerCase() ?? "";
  if (text.includes("photoreal")) return "photoreal";
  if (text.includes("illustrated")) return "illustrated";
  return null;
}

const chars = await (
  await fetch(
    `${BASE}/rest/v1/character_profiles?render_style=is.null&select=id,name,reference_image_urls`,
    { headers: h },
  )
).json();

const todo = chars.filter((c) => (c.reference_image_urls || []).length > 0);
console.log(
  `${chars.length} characters without a render_style; ${todo.length} have a photo to classify.` +
    (APPLY ? "" : "  (dry run — pass --apply to write)"),
);

let wrote = 0;
for (const c of todo) {
  const path = c.reference_image_urls[0];
  const signed = await (
    await fetch(`${BASE}/storage/v1/object/sign/character-references/${path}`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ expiresIn: 600 }),
    })
  ).json();
  if (!signed?.signedURL) {
    console.log(`  ${String(c.name).padEnd(16)} SKIP (could not sign photo)`);
    continue;
  }
  const style = await classify(`${BASE}/storage/v1${signed.signedURL}`);
  if (!style) {
    console.log(`  ${String(c.name).padEnd(16)} SKIP (classifier returned nothing)`);
    continue;
  }
  console.log(`  ${String(c.name).padEnd(16)} -> ${style}`);
  if (APPLY) {
    const put = await fetch(`${BASE}/rest/v1/character_profiles?id=eq.${c.id}`, {
      method: "PATCH",
      headers: { ...h, prefer: "return=minimal" },
      body: JSON.stringify({ render_style: style }),
    });
    if (put.ok) wrote++;
    else console.log(`     write failed: ${put.status}`);
  }
}
console.log(APPLY ? `\nWrote ${wrote} render_style values.` : "\nDry run — nothing written.");
