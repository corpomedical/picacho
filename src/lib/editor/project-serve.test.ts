import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectToken } from "./project";
import { serveProjectFile } from "./project-serve";

const EDIT = "11111111-1111-4111-8111-111111111111";
const GEN = "22222222-2222-4222-8222-222222222222";
const DIR = `u1/${EDIT}/projects/${GEN}`;

function admin(stored: Record<string, string>) {
  const row = {
    id: EDIT,
    clips: [{ path: `u1/${EDIT}/clip-0.mp4` }, { path: `u1/${EDIT}/clip-1.mp3` }],
    plan: { outputs: [{ generationId: GEN, project: { dir: DIR, entry: "index.html", files: [] } }], history: [] },
  };
  return {
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row, error: null }) };
      return q;
    },
    storage: {
      from: () => ({
        download: async (p: string) => (p in stored ? { data: new Blob([stored[p]]), error: null } : { data: null, error: { message: "no" } }),
        createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://store.example/${p}?token=x` }, error: null }),
      }),
    },
  } as never;
}

beforeEach(() => {
  vi.stubEnv("MEDIA_SIGNING_SECRET", "test-secret");
});

describe("the preview route", () => {
  const tok = () => projectToken(EDIT, GEN);
  const deps = (stored: Record<string, string> = {}) => ({ admin: admin(stored), supabaseOrigin: "https://abc.supabase.co" });

  it("serves the project's page under its own framing policy, and the draft when asked", async () => {
    const stored = { [`${DIR}/index.html`]: "<html>saved</html>", [`${DIR}/draft.html`]: "<html>draft</html>" };
    const page = await serveProjectFile(tok(), ["index.html"], new URLSearchParams(), deps(stored));
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("<html>saved</html>");
    expect(page.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
    expect(page.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    const draft = await serveProjectFile(tok(), ["index.html"], new URLSearchParams("draft=1"), deps(stored));
    expect(await draft.text()).toBe("<html>draft</html>");
    // No draft saved yet: the delivered page.
    const noDraft = await serveProjectFile(tok(), ["index.html"], new URLSearchParams("draft=1"), deps({ [`${DIR}/index.html`]: "<html>saved</html>" }));
    expect(await noDraft.text()).toBe("<html>saved</html>");
  });

  it("sends the project's files and the edit's own clips as short redirects", async () => {
    const sfx = await serveProjectFile(tok(), ["assets", "sfx", "hit.wav"], new URLSearchParams(), deps());
    expect(sfx.status).toBe(302);
    expect(sfx.headers.get("Location")).toBe(`https://store.example/${DIR}/assets/sfx/hit.wav?token=x`);
    const clip = await serveProjectFile(tok(), ["footage", "clip-1.mp3"], new URLSearchParams(), deps());
    expect(clip.headers.get("Location")).toBe(`https://store.example/u1/${EDIT}/clip-1.mp3?token=x`);
    expect((await serveProjectFile(tok(), ["footage", "clip-7.mp4"], new URLSearchParams(), deps())).status).toBe(404);
  });

  it("opens nothing for a bad token, another video, or a path that climbs out", async () => {
    expect((await serveProjectFile("x.y.z.w", ["index.html"], new URLSearchParams(), deps())).status).toBe(404);
    const other = projectToken(EDIT, "33333333-3333-4333-8333-333333333333");
    expect((await serveProjectFile(other, ["index.html"], new URLSearchParams(), deps())).status).toBe(404);
    expect((await serveProjectFile(tok(), ["..", "..", "secret"], new URLSearchParams(), deps())).status).toBe(404);
  });
});
