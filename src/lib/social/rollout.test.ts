import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NETWORKS } from "../press-tour/publish-types";
import { PRESS_TOUR_FLAGS, PRESS_TOUR_SETTINGS } from "../press-tour/enabled";
import { SOCIAL_MESSAGES } from "./messages";
import { OAUTH } from "./networks";
import { POST_COLUMNS } from "./store";

// Publishing's rollout, pinned across the files that each keep a piece of it:
// the SQL (press-tour-04-social.sql), the posts clock in vercel.json and its
// route, the four callback routes, verify-db's probes, and the customer copy.

const repo = join(__dirname, "..", "..", "..");

function findSql(name: string): string {
  const root = join(repo, "supabase");
  const candidates = [join(root, "pending", name), ...readdirSync(join(root, "applied")).map((d) => join(root, "applied", d, name))];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`${name} is in neither supabase/pending nor supabase/applied/<date>`);
  return readFileSync(found, "utf8");
}

const sql = findSql("press-tour-04-social.sql");
const verifyDb = readFileSync(join(repo, "scripts", "verify-db.mjs"), "utf8");

describe("press-tour-04-social.sql", () => {
  it("no post can exist without the platform's AI label", () => {
    expect(sql).toContain("ai_label             boolean not null default true,");
    expect(sql).toContain("constraint scheduled_posts_ai_label check (ai_label),");
  });

  it("TikTok gets the clean file and is never scheduled; everyone else the tagged one", () => {
    expect(sql).toContain("constraint scheduled_posts_rendition_network check ((network = 'tiktok') = (rendition = 'clean')),");
    expect(sql).toContain("constraint scheduled_posts_tiktok_now check (network <> 'tiktok' or options ->> 'when' = 'now'),");
  });

  it("one press, one row: the idempotency key is unique", () => {
    expect(sql).toContain("create unique index if not exists scheduled_posts_idempotency on public.scheduled_posts (idempotency_key);");
  });

  it("the secrets, the states, the revokes, the testers and the queue have RLS on and ZERO policies; people can't read them", () => {
    for (const t of ["social_connection_secrets", "oauth_states", "social_revocations", "press_social_testers", "scheduled_posts"]) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${t} from public, anon, authenticated;`);
      expect(sql).not.toMatch(new RegExp(`create policy [^;]* on public\\.${t}\\b`));
    }
    expect(sql).toContain("revoke all on public.social_connections from public, anon, authenticated;");
    expect(sql).toContain("grant select on public.social_connections to authenticated;");
    expect(sql).toMatch(/create policy "Read own social connections" on public\.social_connections\s+for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\);/);
  });

  it("the secrets hold only ciphertext, iv, tag and the key version", () => {
    const from = sql.indexOf("create table if not exists public.social_connection_secrets (");
    const body = sql.slice(from, sql.indexOf("\n);", from));
    const cols = [...body.matchAll(/^ {2}([a-z_]+)\s/gm)].map((m) => m[1]).filter((c) => c !== "constraint");
    expect(cols).toEqual([
      "connection_id",
      "access_ciphertext",
      "access_iv",
      "access_tag",
      "refresh_ciphertext",
      "refresh_iv",
      "refresh_tag",
      "key_version",
      "updated_at",
    ]);
  });

  it("the claim is SECURITY DEFINER, oldest first, SKIP LOCKED, and the service role's alone", () => {
    const start = sql.indexOf("create or replace function public.claim_scheduled_posts(");
    const fn = sql.slice(start, sql.indexOf("$function$;", start));
    expect(fn).toContain("security definer");
    expect(fn).toContain("set search_path to ''");
    expect(fn).toContain("for update skip locked");
    expect(fn).toContain("order by coalesce(d.resume_at, d.scheduled_for)");
    expect(sql).toContain("revoke all on function public.claim_scheduled_posts(integer, uuid) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.claim_scheduled_posts(integer, uuid) to service_role;");
  });

  it("every column the store reads is created", () => {
    const from = sql.indexOf("create table if not exists public.scheduled_posts (");
    const body = sql.slice(from, sql.indexOf("\n);", from));
    for (const col of POST_COLUMNS.split(", ")) expect(body, col).toMatch(new RegExp(`^ {2}${col}\\s`, "m"));
  });

  it("adds no switch: posting's switches and the X ceiling come from 01, inserted OFF", () => {
    expect(sql).not.toMatch(/insert into public\.feature_flags/);
    for (const f of ["press_tour_posting", "press_post_x", "press_post_tiktok_direct", "press_post_meta"]) expect(PRESS_TOUR_FLAGS).toContain(f);
    expect(PRESS_TOUR_SETTINGS.press_x_daily_cap.seed).toBe("0");
  });

  it("verify-db probes the claim as private and every table", () => {
    const privateList = verifyDb.slice(verifyDb.indexOf("const PRIVATE_RPCS = ["), verifyDb.indexOf("];", verifyDb.indexOf("const PRIVATE_RPCS = [")));
    expect(privateList).toContain('"claim_scheduled_posts"');
    for (const t of ["social_connections", "social_connection_secrets", "oauth_states", "social_revocations", "press_social_testers", "scheduled_posts"]) {
      expect(verifyDb).toContain(`  ${t}: [`);
    }
  });
});

describe("the posts clock", () => {
  it("runs every minute, behind the cron secret", () => {
    const crons = (JSON.parse(readFileSync(join(repo, "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] }).crons;
    expect(crons.filter((c) => c.path === "/api/cron/press-posts")).toEqual([{ path: "/api/cron/press-posts", schedule: "* * * * *" }]);
    const route = readFileSync(join(repo, "src", "app", "api", "cron", "press-posts", "route.ts"), "utf8");
    expect(route).toContain("if (!secret || auth !== `Bearer ${secret}`) {");
    expect(route.indexOf("{ status: 401 }")).toBeLessThan(route.indexOf("postsTick("));
    expect(route).toContain("posting: switches.press_tour_posting");
    expect(route).toContain("export const maxDuration = 300;");
  });
});

describe("the connect callbacks", () => {
  it("one route per network, each handing its own network to the shared handler", () => {
    for (const n of NETWORKS) {
      const route = readFileSync(join(repo, "src", "app", "api", "social", n, "callback", "route.ts"), "utf8");
      expect(route).toContain(`return handleSocialCallback("${n}", request);`);
      expect(route).toContain('export const dynamic = "force-dynamic";');
    }
  });

  it("each network's credentials come from its own two variables", () => {
    expect(NETWORKS.map((n) => [OAUTH[n].envKeys.id, OAUTH[n].envKeys.secret])).toEqual([
      ["X_CLIENT_ID", "X_CLIENT_SECRET"],
      ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
      ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
      ["THREADS_APP_ID", "THREADS_APP_SECRET"],
    ]);
  });
});

describe("customer copy", () => {
  // Machine and vendor words never reach a person (the door test's rule, v2 #34).
  const banned = /\b(token|tokens|oauth|api|queue|rendition|container|webhook|cron|payload|hash|sha256|pkce|seedance|higgsfield|kling|veo|minimax|hailuo|wan|nano banana|gpt-image|flux|gemini|openai|anthropic|claude|fal|supabase)\b/i;

  it("names no machine part and no vendor", () => {
    for (const m of SOCIAL_MESSAGES) expect(m, m).not.toMatch(banned);
  });

  it("never says locked", () => {
    for (const m of SOCIAL_MESSAGES) expect(m.toLowerCase()).not.toContain("locked");
  });

  it("every constant is listed once", () => {
    expect(new Set(SOCIAL_MESSAGES).size).toBe(SOCIAL_MESSAGES.length);
    const src = readFileSync(join(__dirname, "messages.ts"), "utf8");
    const exported = [...src.matchAll(/^export const ([A-Z_]+) =/gm)].map((m) => m[1]).filter((n) => n !== "SOCIAL_MESSAGES" && n !== "CONNECT_ERROR_CODES");
    const listed = src.slice(src.indexOf("export const SOCIAL_MESSAGES = ["));
    for (const name of exported) expect(listed, name).toContain(`  ${name},`);
  });
});
