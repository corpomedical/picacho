import { describe, expect, it } from "vitest";
import { parseEnvText, pickEvalEnv } from "./env.mts";

const FILE = [
  "# comment",
  "OPENAI_API_KEY=sk-file-openai",
  'ANTHROPIC_API_KEY="sk-file-anthropic"',
  "FAL_KEY=fal-file",
  "OPENAI_MODEL=",
  "SUPABASE_SERVICE_ROLE_KEY=service-secret",
  "NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co",
  "OPENAI_SAFETY_ID_SECRET=salt",
  "STRIPE_SECRET_KEY=sk_live_x",
].join("\n");

describe("pickEvalEnv", () => {
  it("takes only the allowlisted keys from the file", () => {
    const r = pickEvalEnv(FILE, {});
    if (!r.ok) throw new Error(r.error);
    const env: Record<string, string | undefined> = {};
    r.apply(env as NodeJS.ProcessEnv);
    expect(env).toEqual({ OPENAI_API_KEY: "sk-file-openai", ANTHROPIC_API_KEY: "sk-file-anthropic", FAL_KEY: "fal-file" });
    expect(r.presence).toEqual({ OPENAI_API_KEY: "file", ANTHROPIC_API_KEY: "file", FAL_KEY: "file", OPENAI_MODEL: "absent" });
  });

  it("lets the shell win", () => {
    const shell = { OPENAI_API_KEY: "sk-shell" };
    const r = pickEvalEnv(FILE, shell);
    if (!r.ok) throw new Error(r.error);
    const env: Record<string, string | undefined> = { ...shell };
    r.apply(env as NodeJS.ProcessEnv);
    expect(env.OPENAI_API_KEY).toBe("sk-shell");
    expect(r.presence.OPENAI_API_KEY).toBe("shell");
  });

  it("refuses a gpt-6 OPENAI_MODEL from the file and from the shell", () => {
    expect(pickEvalEnv("OPENAI_MODEL=gpt-6-anything", {}).ok).toBe(false);
    expect(pickEvalEnv("", { OPENAI_MODEL: "GPT-6x" }).ok).toBe(false);
    expect(pickEvalEnv("OPENAI_MODEL=gpt-5.4-mini", {}).ok).toBe(true);
  });

  it("strips every Supabase variable and the safety-id secret, from any source", () => {
    const shell = { SUPABASE_SERVICE_ROLE_KEY: "shell-secret", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", OPENAI_SAFETY_ID_SECRET: "s", HOME: "/home" };
    const r = pickEvalEnv(FILE, shell);
    if (!r.ok) throw new Error(r.error);
    const env: Record<string, string | undefined> = { ...shell };
    r.apply(env as NodeJS.ProcessEnv);
    expect(Object.keys(env).filter((k) => /SUPABASE|SAFETY_ID/.test(k))).toEqual([]);
    expect(env.HOME).toBe("/home");
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("returns a presence map, never a value", () => {
    const r = pickEvalEnv(FILE, { ANTHROPIC_API_KEY: "sk-shell-anthropic" });
    const json = JSON.stringify(r);
    for (const secret of ["sk-file-openai", "sk-file-anthropic", "fal-file", "service-secret", "sk-shell-anthropic", "sk_live_x"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("parses quoted and exported lines", () => {
    expect(parseEnvText("export A=1\nB='two'\n#C=3\nD")).toEqual({ A: "1", B: "two" });
  });
});
