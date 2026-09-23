import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pollUntilSettled } from "../generations/poll-client";
import { pollGeneration } from "@/lib/generations/actions";
import { localizeServerText } from "../i18n/server-text";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import { probeLocal, recastStorageObjectUrl, uploadRecastClip } from "./recast-client";

// The poll loop's server action, faked: the door's progress line is the
// runner's answer to each poll, so the test plays those answers in order.
vi.mock("@/lib/generations/actions", () => ({ pollGeneration: vi.fn() }));
vi.mock("@/lib/generations/user-facing-error", () => ({ SESSION_EXPIRED_MESSAGE: "Your session expired — please log in again." }));

// The door's decisions, pinned as source: its own page and nav word (the
// operator's siting call, 2026-09-17), admins only behind the switch, no
// machinery in its words — and a NAME that lives in exactly two places, so
// the working title can change without touching a stored id.

const root = join(__dirname, "..", "..");
const door = readFileSync(join(root, "components", "mystique", "mystique-door.tsx"), "utf8");
const viewer = readFileSync(join(root, "components", "mystique", "take-viewer.tsx"), "utf8");
const sidebar = readFileSync(join(root, "components", "app-sidebar.tsx"), "utf8");
const layout = readFileSync(join(root, "app", "app", "layout.tsx"), "utf8");
const page = readFileSync(join(root, "app", "app", "mystique", "page.tsx"), "utf8");

const section = (lang: string) => {
  const text = readFileSync(join(root, "lib", "i18n", "messages", `${lang}.ts`), "utf8");
  return text.match(/\n  mystique: \{[\s\S]*?\n  \},/)?.[0] ?? "";
};
const keysOf = (s: string) => [...s.matchAll(/\n    (\w+): /g)].map((m) => m[1]);

describe("the Mystique door", () => {
  it("hangs in the nav behind its own visibility, at its own path", () => {
    expect(sidebar).toContain('href: "/app/mystique"');
    expect(sidebar).toContain("mystiqueVisible");
    expect(layout).toContain("const mystiqueVisible = isAdmin && (await isRecastEnabled(supabase))");
  });

  it("its page declares the check's budget and refuses everyone it is not for", () => {
    expect(page).toContain("export const maxDuration = 300");
    expect(page).toContain('profile?.role !== "admin"');
    expect(page.indexOf('profile?.role !== "admin"')).toBeLessThan(page.indexOf("getRecastHome("));
    expect(page).toContain("isRecastEnabled");
  });

  it("keeps the machinery off the wall: its words name no engine, model or rival", () => {
    const spoken = [...section("en").matchAll(/: "([^"]+)"/g)].map((mm) => mm[1]).join(" ");
    expect(spoken.length).toBeGreaterThan(400);
    expect(spoken).not.toMatch(/kling|wan\b|luma|dreamactor|fal\b|engine|model|provider|genjutsu|higgsfield/i);
  });

  it("says the same keys in all four languages", () => {
    const en = keysOf(section("en"));
    expect(en.length).toBeGreaterThan(60);
    for (const lang of ["es", "it", "pt"]) expect(keysOf(section(lang)), lang).toEqual(en);
  });

  it("uses every word it was given, and no word it was not", () => {
    const used = new Set([...`${door}\n${viewer}\n${page}`.matchAll(/\b(?:m|t\.mystique)\.(\w+)/g)].map((x) => x[1]));
    for (const key of keysOf(section("en"))) expect(used.has(key), `unused word: ${key}`).toBe(true);
    const known = new Set(keysOf(section("en")));
    for (const key of used) expect(known.has(key), `missing word: ${key}`).toBe(true);
  });

  it("quotes from the uploaded file and charges what it quoted", () => {
    expect(door).toContain("inspectRecastClip(");
    expect(door).toContain("startRecastTakes(");
    // The button's number is the server's quote, never a browser estimate.
    expect(door).not.toContain("recastCreditCost");
    expect(door).toContain("!canTake");
  });

  it("offers the person's own finished videos as performances", () => {
    expect(door).toContain("motions.map");
    expect(door).toContain("pickMotion");
    // The library reads through our own media route, so a canvas can sample
    // frames from it without being tainted.
    const data = readFileSync(join(root, "lib", "recast", "data.ts"), "utf8");
    expect(data).toContain("videoUrl: url");
    expect(data).toContain("toMediaUrl");
  });

  it("shows the brief it is about to send, composed the way the server composes it", () => {
    expect(door).toContain("composeRecastBrief");
    expect(door).toContain("briefShow");
  });

  it("wipes only where the two films share a frame", () => {
    expect(viewer).toContain('job === "scene" && sourceUrl !== null');
    expect(viewer).toContain("clipPath");
  });

  it("paints its dark surfaces in literal colours — the app theme turns Tailwind's white near-black", () => {
    // "Fix the Tag overlaying the clip … The font color is unreadable"
    // (2026-09-19): globals.css html.screening.dark redefines --color-white,
    // so text-white/90 on black read as dark grey on black.
    for (const [name, text] of [
      ["door", door],
      ["viewer", viewer],
    ] as const) {
      expect(text, name).not.toMatch(/\b(?:text|bg|border|ring|from|via|to)-white\b/);
    }
  });

  it("promises the lock only when the lock is actually on", () => {
    expect(door).toContain("{lockOn && lockApplies && <p");
    // A take with several faces, or none, promises nothing.
    expect(door).toContain("const lockApplies = cast.length > 0 && !ensemble");
    expect(page).toContain("isRecastLockOn");
  });

  it("says a long take is made in parts, and how long it waits, before it is paid for", () => {
    // lib/generations/chain.ts (2026-09-19): past 15 s, Into the clip is
    // rendered in chained parts. The door says so under the trim, from the
    // same count the server plans with.
    expect(door).toContain("chainPieceCount(clipWindow.end - clipWindow.start) > 1");
    expect(door).toContain("RECAST_ENGINES[engine].chains");
    expect(door).toContain("formatMsg(m.longTake, {");
    for (const lang of ["en", "es", "it", "pt"]) {
      const words = section(lang).match(/\n    longTake: "([^"]+)"/)?.[1] ?? "";
      expect(words, lang).toContain("{parts}");
      expect(words, lang).toContain("{minutes}");
      expect(section(lang), lang).toMatch(/\n    sceneLimit: "[^"]*30 s"/);
    }
  });

  it("keeps its own words in one block after the headline, clear of the words lane's end of the section", () => {
    for (const lang of ["en", "es", "it", "pt"]) {
      const s = section(lang);
      expect(s.indexOf("// ── door (2026-09-22) ──"), lang).toBeGreaterThan(s.indexOf("headline:"));
      expect(s.indexOf("// ── door (2026-09-22) ──"), lang).toBeLessThan(s.indexOf("sub:"));
    }
  });

  it("the working title lives in the route and the dictionary — never in the lane", () => {
    const laneDir = join(root, "lib", "recast");
    for (const file of readdirSync(laneDir)) {
      if (file.endsWith(".test.ts")) continue;
      const text = readFileSync(join(laneDir, file), "utf8");
      // Comments may say what the door is called; identifiers and strings may not.
      const code = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code.replace(/revalidatePath\("\/app\/mystique"\)/g, ""), file).not.toMatch(/mystique/i);
    }
    expect(existsSync(join(root, "app", "app", "mystique", "page.tsx"))).toBe(true);
  });
});

// WATCH IT HAPPEN (2026-09-22). A 35-minute take was a pulsing grid under
// "Rendering · 3–20 min", a finished one swapped its card in silence at the
// foot of the page, a stopped one read "Didn't finish", and a failed one was
// a grey word and a link.
describe("the door while a take renders, and after", () => {
  const data = readFileSync(join(root, "lib", "recast", "data.ts"), "utf8");

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(pollGeneration).mockReset();
  });

  it("follows the runner's own progress line, poll by poll, in the reader's language", async () => {
    vi.useFakeTimers();
    const answers = [
      { error: null, state: "pending", stage: "video", progress: "Rendering part 2 of 3" },
      { error: null, state: "pending", stage: "video", progress: "Joining the parts" },
      { error: null, state: "succeeded", resultUrl: "https://x/y.mp4" },
    ];
    vi.mocked(pollGeneration).mockImplementation(async () => answers.shift() as Awaited<ReturnType<typeof pollGeneration>>);
    const heard: string[] = [];
    const done = pollUntilSettled("take-1", { onPending: (line) => heard.push(line) });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await done).toEqual({ state: "settled" });
    expect(heard).toEqual(["Rendering part 2 of 3", "Joining the parts"]);
    expect(heard.map((line) => localizeServerText(line, en))).toEqual(["Rendering part 2 of 3", "Joining the parts"]);
    const spanish = heard.map((line) => localizeServerText(line, es));
    expect(spanish[0]).toBe(es.serverText.stageRecastPart.replace("{part}", "2").replace("{of}", "3"));
    expect(spanish[1]).toBe(es.serverText.stageRecastJoin);
    expect(spanish).not.toEqual(heard);
  });

  it("asks the poll for that line, and shows it through the translator", () => {
    expect(door).toMatch(/pollUntilSettled\(id, \{\s*signal: ctrl\.signal,[\s\S]{0,400}onPending: \(line\) =>/);
    expect(door).toContain("const stage = progress[x.id] ?? x.progress;");
    expect(door).toContain("localizeServerText(stage, t)");
    // The one estimate, everywhere — the flat range is gone from every language.
    expect(door).toContain("recastWait(x, now)");
    expect(door).toContain("recastMinutes(engine, clipWindow.end - clipWindow.start)");
    for (const lang of ["en", "es", "it", "pt"]) expect(section(lang), lang).not.toMatch(/3–20/);
  });

  it("reads where a take is, how it ended and what it cost from the row, not from the press", () => {
    const columns = data.slice(data.indexOf("const TAKE_COLUMNS ="), data.indexOf(";", data.indexOf("const TAKE_COLUMNS =")));
    expect(columns).toContain("progress_stage");
    // The log is the biggest field on a row: asked for on its own, for the settled takes alone.
    expect(columns).not.toContain("pipeline_log");
    expect(data).toContain('takeRows.filter((g) => g.status === "succeeded" || g.status === "failed")');
    expect(data).toContain("recastTakeOutcome({ credits_used:");
    expect(data).toContain('(outcome?.stopped ? "stopped" : "failed")');
    expect(data).toContain('report: status === "succeeded" ? recastTakeReport(');
  });

  it("never calls a take failed before the server has settled it", () => {
    const stop = door.slice(door.indexOf("async function stop("), door.indexOf("async function watch("));
    expect(stop).not.toContain('"failed"');
    expect(stop).toContain("requestGenerationCancel(id)");
    expect(door).toContain("{stopping.has(x.id) ? m.stopping : m.stopTake}");
  });

  it("says progress, and a stop in progress, where a screen reader hears it", () => {
    expect(door).toMatch(/<div role="status" aria-live="polite">\s*\{stopping\.has\(x\.id\) \?/);
  });

  it("offers to set a failed take up again — never to retry it", () => {
    expect(door).toContain("onClick={() => reuse(x)}");
    expect(door).toContain("{m.setUpAgain}");
    expect(section("en")).toMatch(/\n    setUpAgain: "Set up again",/);
    expect(section("en")).not.toMatch(/"Try again"/);
  });

  it("says what each job keeps and changes, from the engines' own flags", () => {
    expect(door).toContain("const promise = recastJobPromise(j);");
    expect(door).toContain("{promise.silent && <span");
    expect(door).toContain("{m.promiseSilent}");
  });

  it("enables Take exactly when nothing is missing, and names the first thing that is", () => {
    expect(door).toContain("const canTake = blocker === null;");
    expect(door).toContain("disabled={!canTake}");
    // The line under the button goes to the control that fixes it.
    expect(door).toContain("onClick={() => goTo(blockerGo)}");
    for (const ref of ["dropRef", "rightsRef", "wordsRef", "castRef", "crowdAloneRef", "groupTrimRef"]) expect(door).toContain(`ref={${ref}}`);
    // …and is heard as it changes.
    expect(door).toMatch(/<div role="status" aria-live="polite" className="basis-full[^"]*">[\s\S]{0,900}\{blockerLine &&/);
  });

  it("says why a clip cannot be used inside the drop area, not under the button", () => {
    const pickFile = door.slice(door.indexOf("async function pickFile("), door.indexOf("async function pickMotion("));
    expect(pickFile).toContain("setClipError(message)");
    expect(pickFile).not.toMatch(/setError\((?!"")/);
    expect(door).toContain('<p role="alert" className="mt-2 max-w-xs text-sm text-[#dc8290]">');
  });

  it("prices lengths honestly: Restage starts at 5 s, and Restyle's slot is offered at both ends", () => {
    expect(door).toContain("min={recastLengthFloor(job, seen.seconds)}");
    expect(door).not.toContain("min={Math.min(3, seen.seconds)}");
    expect(door).toContain("formatMsg(m.restageShort, { n: restageComesBack })");
    expect(door).toContain("setClipWindow(slotOffer.cut.window)");
    expect(door).toContain("formatMsg(m.slotFull, { seconds: slotOffer.full.seconds, n: slotOffer.full.credits })");
  });

  it("shows the balance beside the price, and says when the face check stops applying", () => {
    expect(door).toContain("balance.unlimited ? m.balanceUnlimited : formatMsg(m.balanceLeft, { n: balance.left })");
    expect(page).toContain("balance={home.balance}");
    expect(door).toContain("{lockOn && ensemble && <p");
  });

  it("describes today's stop rule: credits back only before rendering starts", () => {
    const ask = section("en").match(/\n    stopAsk: "([^"]+)"/)?.[1] ?? "";
    expect(ask).toMatch(/hasn't started rendering yet[^.]*credits come back/);
    expect(ask).toMatch(/still costs all of its credits/);
    expect(ask).toMatch(/finishes before the stop lands/);
  });

  it("lets one character play whoever the person chooses, starting on the lead, and sends that choice", () => {
    expect(door).toContain("const leadTag = read?.people.find((p) => p.lead)?.tag ?? null;");
    expect(door).toMatch(/const soloTag: string \| null = cast\.length === 1 && soloPick [^;]*\? soloPick\.tag : leadTag;/);
    const take = door.slice(door.indexOf("async function take("), door.indexOf("async function stop("));
    expect(take).toContain("castTag: soloTag ?? undefined,");
    expect(take).not.toContain("p.lead");
    // Shown only with a read to choose from; a failed read shows no choice.
    expect(door).toContain("{recastCastsTogether(job) && !ensemble && cast.length === 1 && read !== null && read.people.length > 1 && (");
    expect(door).toContain("onChange={(e) => setSoloPick({ tag: e.target.value || null })}");
    // A new clip starts on its own lead again.
    expect(door.match(/setSoloPick\(null\);/g)?.length).toBe(2);
    // Both group rules follow who is actually played (2026-09-23: the tags a
    // take really casts are now named once and asked twice).
    expect(door).toContain("const takeTags = ensemble ? castTags : [soloTag];");
    expect(door).toContain("const castOverGroup = takeTags.some(");
  });

  it("marks the job that suits the clip, and never switches to it", () => {
    expect(door).toContain("const suggested = seen ? recastSuggestJob(read, seen.seconds) : null;");
    expect(door).toContain("{suggested === j && (");
    expect(door).not.toMatch(/(setJob|chooseJob)\(suggested/);
  });

  it("offers quality only where there is a choice, and lengths past 15 s with their prices — keeping today's default", () => {
    expect(door).toContain("{recastEnginesOf(job).length > 1 && (");
    expect(door).toContain("recastTierIsSofter(e) && <span");
    expect(door).toContain("onClick={() => setClipWindow(lengthChoices.one.window)}");
    expect(door).toContain("onClick={() => setClipWindow(lengthChoices.all.window)}");
    // The page still opens on the whole clip up to the job's ceiling (the operator's call).
    expect(door.match(/recastFitWindow\(defaultRecastWindow\(res\.seconds, job\), res\.seconds, job\)/g)?.length).toBe(2);
  });

  it("goes to a take that settles, lights it, and tells a hidden tab once — never asking for permission", () => {
    expect(door).toContain('before.get(x.id) === "generating" && x.status !== "generating"');
    expect(door).toContain("announcedRef.current.has(x.id)");
    expect(door).toContain('Notification.permission !== "granted"');
    expect(door).toContain('document.visibilityState !== "hidden"');
    expect(door).toContain("tag: `recast-take-${x.id}`");
    expect(door).not.toContain("requestPermission");
    // Their own settings decide, as the runner's push is decided.
    expect(door).toContain("if (ready ? !notify.ready : !notify.failed) continue;");
    expect(page).toContain("notify={home.notify}");
    // A person who asked for less motion is not scrolled or flashed at.
    expect(door).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(door).toMatch(/if \(reducedMotion\(\)\) return;\s*document\.getElementById\(`take-\$\{id\}`\)\?\.scrollIntoView/);
  });
});

// YOUR CLIP IS READY SOONER (2026-09-22): its length asked of the browser
// before any upload, the frames for the read sampled while it uploads, and
// the upload saying how far it has got — with a Cancel.
describe("the clip, before and while it uploads", () => {
  const pickFile = door.slice(door.indexOf("async function pickFile("), door.indexOf("async function sendClip("));

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("asks the browser for the length before reserving an upload, and refuses only what it measured", () => {
    const probe = pickFile.indexOf("const probe = await probeLocal(file);");
    const refuse = pickFile.indexOf("if (plainly) return fail(recastClipProblemMessage(plainly));");
    const reserve = pickFile.indexOf("reserveRecastUpload(");
    expect(probe).toBeGreaterThan(-1);
    expect(refuse).toBeGreaterThan(probe);
    expect(reserve).toBeGreaterThan(refuse);
    // A file the browser cannot read (an HEVC .mov) is never refused here.
    expect(pickFile).toMatch(/if \(probe\.ok\) \{\s*const plainly = recastLocalLengthProblem\(probe\.seconds\);/);
  });

  it("samples the frames for the read while the file uploads, not after", () => {
    const sampling = pickFile.indexOf("const sampling = sampleClip(file)");
    expect(sampling).toBeGreaterThan(-1);
    expect(sampling).toBeLessThan(pickFile.indexOf("reserveRecastUpload("));
    expect(pickFile).toContain("await inspect(mine, { path: reserved.path }, sampling)");
    // A stopped or failed upload's file is removed, as a replaced one always was.
    expect(pickFile).toMatch(/if \(sent === "aborted"\) \{\s*void discardRecastUpload\(reserved\.path\)/);
  });

  it("shows how far the upload has got, and offers Cancel", () => {
    expect(door).toContain("formatMsg(m.uploadingShare, { n: Math.floor(uploaded * 100) })");
    expect(door).toContain('role="progressbar"');
    expect(door).toMatch(/e\.stopPropagation\(\);\s*cancelClip\(\);/);
    const cancel = door.slice(door.indexOf("function cancelClip("), door.indexOf("async function pickMotion("));
    expect(cancel).toContain("uploadRef.current?.abort();");
    expect(cancel).toContain("pickRef.current++;");
    // The library's own upload stays as the fallback — never worse than before.
    const send = door.slice(door.indexOf("async function sendClip("), door.indexOf("function cancelClip("));
    expect(send).toContain("uploadRecastClip({");
    expect(send).toContain(".storage.from(RECAST_BUCKET).upload(path, file, { contentType })");
  });

  // A stand-in for the browser's XMLHttpRequest: records the request, and
  // lets the test play its progress, its answer, or an abort.
  class FakeXhr {
    static last: FakeXhr | null = null;
    method = "";
    url = "";
    headers: Record<string, string> = {};
    body: unknown = null;
    status = 0;
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    constructor() {
      FakeXhr.last = this;
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    }
    send(body: unknown) {
      this.body = body;
    }
    abort() {
      this.onabort?.();
    }
  }

  const file = () => new File([new Uint8Array(1000)], "dance.mp4", { type: "video/mp4" });

  it("sends the library's own request, reporting how much has gone", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const shares: number[] = [];
    const url = recastStorageObjectUrl("https://proj.supabase.co/", "recast-sources", "u1/recast-abc.mp4");
    expect(url).toBe("https://proj.supabase.co/storage/v1/object/recast-sources/u1/recast-abc.mp4");
    const sent = uploadRecastClip({ url, anonKey: "anon", token: "tok", file: file(), signal: new AbortController().signal, onProgress: (s) => shares.push(s) });
    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe(url);
    expect(xhr.headers).toEqual({ apikey: "anon", authorization: "Bearer tok", "x-upsert": "false" });
    const body = xhr.body as FormData;
    expect(body.get("cacheControl")).toBe("3600");
    expect((body.get("") as File).size).toBe(1000);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 250, total: 1000 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1000, total: 1000 });
    xhr.status = 200;
    xhr.onload?.();
    expect(await sent).toEqual({ ok: true });
    expect(shares).toEqual([0.25, 1]);
  });

  it("stops on Cancel, and calls any other answer a failure the door falls back from", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const ctrl = new AbortController();
    const stopped = uploadRecastClip({ url: "https://x", anonKey: "a", token: "t", file: file(), signal: ctrl.signal, onProgress: () => {} });
    ctrl.abort();
    expect(await stopped).toEqual({ ok: false, aborted: true });

    const refused = uploadRecastClip({ url: "https://x", anonKey: "a", token: "t", file: file(), signal: new AbortController().signal, onProgress: () => {} });
    FakeXhr.last!.status = 400;
    FakeXhr.last!.onload?.();
    expect(await refused).toEqual({ ok: false, aborted: false });

    const dropped = uploadRecastClip({ url: "https://x", anonKey: "a", token: "t", file: file(), signal: new AbortController().signal, onProgress: () => {} });
    FakeXhr.last!.onerror?.();
    expect(await dropped).toEqual({ ok: false, aborted: false });
  });

  // A stand-in for the <video> element probeLocal reads the length from.
  function fakeVideo(answer: "metadata" | "error" | "nothing", size = { duration: 181.04, width: 1080, height: 1920 }) {
    const video = new EventTarget() as EventTarget & Record<string, unknown>;
    Object.assign(video, {
      preload: "",
      muted: false,
      playsInline: false,
      duration: Number.NaN,
      videoWidth: 0,
      videoHeight: 0,
      removeAttribute: () => {},
      load: () => {},
    });
    Object.defineProperty(video, "src", {
      set() {
        setTimeout(() => {
          if (answer === "metadata") {
            Object.assign(video, { duration: size.duration, videoWidth: size.width, videoHeight: size.height });
            video.dispatchEvent(new Event("loadedmetadata"));
          } else if (answer === "error") video.dispatchEvent(new Event("error"));
        }, 5);
      },
    });
    vi.stubGlobal("document", { createElement: () => video });
  }

  it("reads the length of a file the browser can open", async () => {
    fakeVideo("metadata");
    expect(await probeLocal(file())).toEqual({ ok: true, seconds: 181, width: 1080, height: 1920 });
  });

  it("says nothing — and so refuses nothing — about a file it cannot open, or opens without a picture", async () => {
    fakeVideo("error");
    expect(await probeLocal(file())).toEqual({ ok: false });
    // An HEVC .mov in a browser that can parse it and not decode it: a length and no picture.
    fakeVideo("metadata", { duration: 12, width: 0, height: 0 });
    expect(await probeLocal(file())).toEqual({ ok: false });
    // No answer at all: the door does not wait past the timeout.
    vi.useFakeTimers();
    fakeVideo("nothing");
    const silent = probeLocal(file(), 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await silent).toEqual({ ok: false });
  });
});
