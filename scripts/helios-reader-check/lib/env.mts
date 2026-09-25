// The one secret a live check may hold (Helios Cut 2, step 13, 2026-09-25):
// OPENAI_API_KEY, from the shell or the checkout's .env.local, read the way
// the Astra Sets eval reads it (parseEnvText; a shell value wins). Every
// other key that could spend or reach production — every SUPABASE_* and
// NEXT_PUBLIC_SUPABASE_* variable, the safety-id secret, the Anthropic and
// fal keys — is deleted from the process, whichever source it came from, so
// nothing but the reader can be paid for and no database can be reached.
// The dry runs never call this: they read no key at all.
//
// Nothing here returns or prints a value: only where the key was found.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnvText } from "../../astra-sets-eval/lib/env.mts";

const STRIPPED = [/^SUPABASE_/, /^NEXT_PUBLIC_SUPABASE_/, /^OPENAI_SAFETY_ID_SECRET$/, /^ANTHROPIC_API_KEY$/, /^FAL_KEY$/];

export function loadReaderKey(envFile: string | null, repoRoot: string): { ok: true; key: "shell" | "file" | "absent" } | { ok: false; error: string } {
  const path = envFile ?? join(repoRoot, ".env.local");
  const text = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (envFile !== null && text === null) return { ok: false, error: `--env-file ${envFile} does not exist` };
  let key: "shell" | "file" | "absent" = "absent";
  if (typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY !== "") key = "shell";
  else {
    const fromFile = text === null ? undefined : parseEnvText(text).OPENAI_API_KEY;
    if (typeof fromFile === "string" && fromFile !== "") {
      process.env.OPENAI_API_KEY = fromFile;
      key = "file";
    }
  }
  for (const k of Object.keys(process.env)) if (STRIPPED.some((re) => re.test(k))) delete process.env[k];
  return { ok: true, key };
}
