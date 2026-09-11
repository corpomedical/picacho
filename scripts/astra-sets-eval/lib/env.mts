// Which secrets the eval runner may hold, mechanically.
//
// From .env.local it takes ONLY the three API keys and OPENAI_MODEL, with
// `??=` semantics so a variable already set in the shell wins (the pattern of
// scripts/content-policy-eval.mjs). Everything that could reach production —
// every SUPABASE_* and NEXT_PUBLIC_SUPABASE_* variable, and the safety-id
// secret — is deleted from process.env, whichever source it came from: a
// stray database call then has no key to call with (and net-guard blocks the
// host besides).
//
// OPENAI_MODEL beginning with gpt-6 stops the run (exit 2), whether it came
// from the file or the shell: six utility readers share that setting, and
// the runner never assigns it.
//
// Nothing here returns or prints a value: the result is a presence map, and
// the values travel only inside the `apply` closure.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const EVAL_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "FAL_KEY", "OPENAI_MODEL"] as const;
export type EvalKey = (typeof EVAL_KEYS)[number];

const STRIPPED = [/^SUPABASE_/, /^NEXT_PUBLIC_SUPABASE_/, /^OPENAI_SAFETY_ID_SECRET$/];

export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).replace(/^export\s+/, "").trim();
    out[k] = t
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return out;
}

export type Presence = Record<EvalKey, "shell" | "file" | "absent">;

export type PickedEnv =
  | { ok: true; presence: Presence; strip: string[]; apply: (env: NodeJS.ProcessEnv) => void }
  | { ok: false; error: string };

export function pickEvalEnv(fileText: string | null, shell: Readonly<Record<string, string | undefined>>): PickedEnv {
  const file = fileText === null ? {} : parseEnvText(fileText);
  const gpt6 = (v: string | undefined) => typeof v === "string" && /^gpt-6/i.test(v.trim());
  if (gpt6(shell.OPENAI_MODEL) || gpt6(file.OPENAI_MODEL)) {
    return {
      ok: false,
      error:
        "OPENAI_MODEL names a gpt-6 model. Six utility readers (both content gates' primary readers and the identity scorer) share that setting and would lose their reader; the eval refuses to run. Unset it.",
    };
  }
  const presence = {} as Presence;
  const assign: [string, string][] = [];
  for (const k of EVAL_KEYS) {
    if (typeof shell[k] === "string" && shell[k] !== "") presence[k] = "shell";
    else if (typeof file[k] === "string" && file[k] !== "") {
      presence[k] = "file";
      assign.push([k, file[k]]);
    } else presence[k] = "absent";
  }
  const strip = Object.keys(shell).filter((k) => STRIPPED.some((re) => re.test(k)));
  return {
    ok: true,
    presence,
    strip,
    apply(env) {
      for (const [k, v] of assign) env[k] ??= v;
      for (const k of Object.keys(env)) if (STRIPPED.some((re) => re.test(k))) delete env[k];
    },
  };
}

/** Reads the env file (repo root .env.local by default) and applies the allowlist to process.env. */
export function loadEvalEnv(envFile: string | null, repoRoot: string): { ok: true; presence: Presence; file: string | null } | { ok: false; error: string } {
  const path = envFile ?? join(repoRoot, ".env.local");
  const text = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (envFile !== null && text === null) return { ok: false, error: `--env-file ${envFile} does not exist` };
  const picked = pickEvalEnv(text, process.env);
  if (!picked.ok) return picked;
  picked.apply(process.env);
  return { ok: true, presence: picked.presence, file: text === null ? null : path };
}
