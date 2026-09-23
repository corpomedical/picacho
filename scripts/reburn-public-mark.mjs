// Re-burn the Picacho mark into the public gallery's branded video copies.
//
// WHY THIS EXISTS. The 2026-09-06 manual burn put the wordmark into the
// featured videos' <user>/wm/<file> copies SQUASHED: measured 2026-09-23 on
// the live files, the "Picacho" letters sit in a box 3.0x as wide as tall,
// where the real wordmark is 5.07x (public/logo-dark.png). The gallery player
// also laid its own correct-shape overlay beside it, so every branded video
// showed two logos (operator's screenshot, 2026-09-23). The overlay now steps
// aside for branded files (gallery-showcase.tsx), which leaves the file's own
// mark as the only one — so it has to be the right shape.
//
// WHY A NEW FOLDER (wm2/), NOT AN OVERWRITE. /api/media answers with
// "immutable, max-age=31536000" — the edge and every browser that played a
// squashed copy would keep it for a year. A new path is a new address; the
// gallery now reads only <user>/wm2/ (gallery/page.tsx) and falls back to the
// original + overlay for anything this hasn't reached. The old wm/ copies are
// left untouched (delete them in the dashboard once wm2/ looks right).
//
// WHAT IT DOES, per featured admin-owned video in our storage:
//   1. downloads the pristine ORIGINAL (never the old burned copy — burning
//      over it would stack a third mark),
//   2. burns public/logo-dark.png at 12% of the frame width, aspect kept
//      (height derived from the logo's own ratio, never a fixed h), white at
//      55% — the Gemini ghost the overlay uses — bottom right, 2% margin,
//   3. dry run: writes the result to ./reburn-out/ for a look, nothing else;
//      --apply: also uploads it to <user>/wm2/<file>.
//
// Usage, from the repo root:
//   node scripts/reburn-public-mark.mjs          # burn locally, write nothing
//   node scripts/reburn-public-mark.mjs --apply  # burn + upload to wm2/

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const APPLY = process.argv.includes("--apply");
const BUCKET = "generated-videos";
const OUT = path.resolve("reburn-out");
const LOGO = path.resolve("public/logo-dark.png");

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !KEY) throw new Error("Supabase env missing from .env.local");
const h = { apikey: KEY, authorization: `Bearer ${KEY}` };

const objectUrl = (p) => `${BASE}/storage/v1/object/${BUCKET}/${p.split("/").map(encodeURIComponent).join("/")}`;

async function download(p, dest) {
  const res = await fetch(objectUrl(p), { headers: h });
  if (!res.ok) throw new Error(`download ${p}: ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

// Width from the frame, height from the logo's own aspect (ow/mdar) — the
// shape can't drift whatever the video's size or orientation.
const FILTER =
  "[1:v][0:v]scale2ref=w='iw*0.12':h='ow/mdar'[m][v];" +
  "[m]format=rgba,colorchannelmixer=aa=0.55[mk];" +
  "[v][mk]overlay=x='W-w-W*0.02':y='H-h-W*0.02'";

function burn(src, dest) {
  execFileSync(
    ffmpegPath,
    ["-v", "error", "-y", "-i", src, "-i", LOGO, "-filter_complex", FILTER,
     "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
     "-c:a", "copy", "-movflags", "+faststart", "-f", "mp4", dest],
    { stdio: "inherit" },
  );
}

// Decode every frame; any error line means a broken file, which is never
// uploaded (2026-09-23: two overlapping runs wrote one output at once and
// left it undecodable).
function assertDecodes(file) {
  const out = execFileSync(ffmpegPath, ["-v", "error", "-i", file, "-f", "null", "-"], {
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
  if (out.trim()) throw new Error(`${file} does not decode cleanly — not uploading`);
}

// One run at a time: every run shares reburn-out/, and two at once delete
// each other's downloads and interleave writes into the same output.
const LOCK = path.join(OUT, ".lock");
function takeLock() {
  try {
    fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" });
  } catch {
    const pid = Number(fs.readFileSync(LOCK, "utf8"));
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch {}
    if (alive) throw new Error(`Another run (pid ${pid}) is still going — wait for it to finish.`);
    fs.writeFileSync(LOCK, String(process.pid));
  }
  process.on("exit", () => { try { fs.rmSync(LOCK); } catch {} });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  takeLock();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reburn-"));

  const rows = await fetch(
    `${BASE}/rest/v1/generations?select=id,result_url,profiles!inner(role)` +
      `&content_type=eq.video&status=eq.succeeded&deleted_at=is.null` +
      `&featured_at=not.is.null&profiles.role=eq.admin`,
    { headers: h },
  ).then((r) => r.json());
  if (!Array.isArray(rows)) throw new Error(`Unexpected response: ${JSON.stringify(rows).slice(0, 300)}`);

  console.log(`${rows.length} featured admin videos.`);
  console.log(APPLY ? "APPLYING — burning and uploading to wm2/.\n" : "DRY RUN — local files only.\n");

  let done = 0;
  for (const row of rows) {
    const m = String(row.result_url).match(/^\/api\/media\/generated-videos\/([^/]+)\/([^/?]+)/);
    if (!m) { console.log(`${row.id.slice(0, 8)} skip: not in our storage`); continue; }
    const user = m[1];
    const file = decodeURIComponent(m[2]);
    const wmPath = `${user}/wm2/${file}`;

    const src = path.join(tmp, `orig-${file}`);
    const part = path.join(tmp, file);
    const dest = path.join(OUT, file);
    await download(`${user}/${file}`, src);
    burn(src, part);
    fs.rmSync(src, { force: true });
    assertDecodes(part);
    fs.copyFileSync(part, dest);
    fs.rmSync(part);

    if (APPLY) {
      const up = await fetch(objectUrl(wmPath), {
        method: "POST",
        headers: { ...h, "content-type": "video/mp4", "x-upsert": "true" },
        body: fs.readFileSync(dest),
      });
      if (!up.ok) throw new Error(`upload ${wmPath}: ${up.status} ${await up.text()}`);
      console.log(`${row.id.slice(0, 8)} uploaded ${wmPath}`);
    } else {
      console.log(`${row.id.slice(0, 8)} burned -> ${dest}`);
    }
    done++;
  }
  console.log(`\n${done} video(s) ${APPLY ? "uploaded to wm2/ — reload /gallery" : "burned locally — open reburn-out/ to check"}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
