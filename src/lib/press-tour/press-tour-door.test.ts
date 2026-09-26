import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import itMessages from "../i18n/messages/it";
import { renderProductGuide } from "../agent/product-guide";

// The Press Tour door's decisions, pinned as source (build map §5.1; the
// Recast door's test is the model): its own page and a pinned row under
// Tools, the phone's lamp beside Generate Video and Recast, admins only behind
// the press_tour switch with the refusal BEFORE any read, the shared theatre
// card, and words in four languages that name no machinery, promise no lock,
// no free re-shoot and no refund (operator, 2026-09-26).

const root = join(__dirname, "..", "..");
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");
const door = read("components", "press-tour", "press-tour-door.tsx");
const wallPart = read("components", "press-tour", "press-wall.tsx");
const linePart = read("components", "press-tour", "press-line.tsx");
/** Every piece of the door (the door, the running order, the quote, the product card...), by file. */
const PARTS = readdirSync(join(root, "components", "press-tour"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => [f, read("components", "press-tour", f)] as const);
const all = PARTS.map(([, text]) => text).join("\n");
const css = read("components", "press-tour", "press-tour.module.css");
/** Code alone: comments may say what the door never does. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const frame = read("components", "door-frame.tsx");
const page = read("app", "app", "press-tour", "page.tsx");
const sidebar = read("components", "app-sidebar.tsx");
const tabBar = read("components", "native-tab-bar.tsx");
const tools = read("lib", "nav", "tools.ts");
const layout = read("app", "app", "layout.tsx");

const LANGS = ["en", "es", "pt", "it"] as const;
type Lang = (typeof LANGS)[number];
const CATALOGS = { en, es, pt, it: itMessages } as const;

const section = (lang: Lang) => read("lib", "i18n", "messages", `${lang}.ts`).match(/\n  pressTour: \{[\s\S]*?\n  \},/)?.[0] ?? "";
const keysOf = (s: string) => [...s.matchAll(/\n    (\w+): /g)].map((m) => m[1]);
/**
 * Every sentence the door can say in one language: its section, its two nav
 * words, and the engine's sentences it shows (filming, the wall, the cut
 * and posting, mapped by server-text.ts under press* keys).
 */
const spoken = (lang: Lang) => {
  const c = CATALOGS[lang];
  const engine = Object.entries(c.serverText)
    .filter(([key]) => key.startsWith("press"))
    .map(([, v]) => v);
  return [...Object.values(c.pressTour), c.nav.pressTour, c.nav.pressTourSub, ...engine];
};

// No engine, vendor, model, server or resolution in customer words (Spec v2
// #34: word boundaries, all four languages, a small allowlist of real words).
// Posting's machinery too (social/messages.ts's rule): no tokens, queues,
// containers, renditions, manifests, file tools or sign-in plumbing.
const MACHINERY =
  /\b(?:seedance|higgsfield|soul|kling|veo|minimax|hailuo|wan|luma|runway|nano banana|gpt(?:-image)?|gemini|openai|anthropic|claude|opus|sonnet|flux|fal|engine|model|models|provider|server|servidor|api|720p|1080p|4k|fps|oauth|tokens?|queues?|renditions?|containers?|manifests?|ffmpeg|c2pa|webhooks?|lane|ocr|sha-?256|cron)\b/i;
// Real words that share a spelling with a banned one, per language, lower
// case only (an engine name is capitalised): Spanish "veo" is "I see".
const REAL_WORDS: Partial<Record<Lang, RegExp>> = { es: /(?<=\s|^)veo(?=[\s.,;:!?]|$)/g };
// Keys that stay English on purpose: "Press Tour" in every language;
// Spanish "Plan", which is the Spanish word too (the Red Carpet artboards);
// "{n} cr" and "{n} s", the short forms the Spanish artboard prints as they
// are; and Italian "Logo".
// "Hashtags" is the Spanish and Portuguese word too, and TikTok's Italian
// app calls Stitch "Stitch".
const SAME_AS_ENGLISH: Record<Exclude<Lang, "en">, readonly string[]> = {
  es: ["headline", "stepPlan", "creditsShort", "lengthSeconds", "hashtags"],
  pt: ["headline", "creditsShort", "lengthSeconds", "hashtags"],
  it: ["headline", "creditsShort", "lengthSeconds", "logoTag", "ttStitch"],
};

describe("the Press Tour door", () => {
  it("hangs in the nav as a tool, pinned under Tools, never as a new menu row", () => {
    expect(tools).toContain('{ key: "pressTour", href: "/app/press-tour", group: "make"');
    expect(tools).toContain('export const DEFAULT_PINNED: readonly ToolKey[] = ["pressTour"];');
    expect(sidebar).toContain("pressTourVisible");
    expect(sidebar).toContain("pressTour: PressTourIcon,");
    expect(sidebar).toContain('case "pressTour":');
    // No hand-written row: the pinned rows come from the one list of tools.
    expect(sidebar).not.toMatch(/navRow\(\{\s*href: "\/app\/press-tour"/);
    expect(layout).toContain("const pressTourVisible = isAdmin && (await isPressTourEnabled(supabase));");
    expect(layout).toContain("pressTourVisible={pressTourVisible}");
  });

  it("sits in the phone's lamp beside Generate Video and Recast, behind the same gate", () => {
    expect(layout).toContain("pressTourOn={pressTourVisible}");
    expect(tabBar).toContain('type Choice = "video" | "recast" | "pressTour" | "live" | "cut";');
    expect(tabBar).toContain("pressTour: PRESS_TOUR_HREF,");
    expect(tabBar).toContain("const hasChoices = recastOn || pressTourOn || liveOn || cutOn;");
    expect(tabBar).toContain('onClick={() => choose("pressTour")}');
    // Third, after Recast and before Live (lamp-phone artboard).
    const recast = tabBar.indexOf('onClick={() => choose("recast")}');
    const press = tabBar.indexOf('onClick={() => choose("pressTour")}');
    const live = tabBar.indexOf('onClick={() => choose("live")}');
    expect(recast).toBeGreaterThan(-1);
    expect(press).toBeGreaterThan(recast);
    expect(live).toBeGreaterThan(press);
  });

  it("refuses everyone it is not for before it reads anything, and declares the budget its actions need", () => {
    expect(page).toContain("export const maxDuration = 300");
    const signIn = page.indexOf('redirect("/login")');
    const role = page.indexOf('if (profile?.role !== "admin") notFound();');
    const flag = page.indexOf("if (!(await isPressTourEnabled(supabase))) notFound();");
    const load = page.indexOf("getPressTourHome(");
    expect(signIn).toBeGreaterThan(-1);
    expect(role).toBeGreaterThan(signIn);
    expect(flag).toBeGreaterThan(role);
    expect(load).toBeGreaterThan(flag);
    // The only read before the refusals is the person's own role.
    const before = page.slice(0, flag);
    expect(before.match(/\.from\(/g)?.length).toBe(1);
    expect(before).toContain('.from("profiles").select("role").eq("id", userId)');
  });

  it("stands in the shared theatre card, in literal colours", () => {
    expect(door).toContain('import { DoorFrame } from "@/components/door-frame";');
    expect(door).toContain("<DoorFrame");
    expect(frame).toContain("rounded-[28px] bg-[#0b0c10]");
    // globals.css html.screening.dark redefines --color-white: a door that
    // used text-white read dark grey on black (2026-09-19).
    for (const [name, text] of [...PARTS, ["frame", frame] as const]) {
      expect(text, name).not.toMatch(/\b(?:text|bg|border|ring|from|via|to)-white\b/);
      // DM Mono is loaded at 400 and 500 only.
      expect(text, name).not.toMatch(/slate[^"]*font-semibold|font-semibold[^"]*slate/);
    }
  });

  it("prices nothing itself and links to no purchase (reader mode inside the app)", () => {
    // Every number is the server's quote (campaign-types.ts PressQuote).
    for (const [name, text] of PARTS) {
      expect(text, name).not.toMatch(/from "@\/lib\/(?:generations|pricing|plans)/);
      expect(code(text), name).not.toMatch(/creditCost|CreditCost|USD_PER_CREDIT|creditsFor\(|quoteSend|stillCredits|shotCredits|buildPressQuote/);
      expect(code(text), name).not.toMatch(/\/pricing|checkout|upgrade|billing/i);
    }
    // A credit figure is printed only from the quote's own fields, or the
    // one fixed price the contract names: a repaint is 1 credit (N4).
    const printed = [...code(all).matchAll(/formatMsg\(m\.(?:creditsShort|creditsTag|dockPaint|dockFilm|balancePaint|balanceFilm), \{([^}]*)\}/g)].map((x) => x[1]);
    expect(printed.length).toBeGreaterThan(5);
    for (const vars of printed) {
      for (const [, value] of vars.matchAll(/\b(?:n|now|after): ([^,]+?)(?:,|\s*$)/g)) {
        // A re-film is priced by the contract's own field (ShotView.refilmCredits: the shot's normal film price).
        expect(value.trim(), vars).toMatch(/^(?:1|r\.credits|shot\.refilmCredits|quote\.(?:total|paint|animate|balanceNow|balanceAfterNextStep)|credits|spend === "paint" \? quote\.paint : quote\.animate)$/);
      }
    }
  });

  it("wires the ad through the contract alone, and opens the Film key only when the engine names no blocker", () => {
    // The engine's actions come in as props from the page: the campaign's,
    // posting's and the "tell me" list's, never imported by a piece.
    expect(all).not.toMatch(/from "@\/lib\/press-tour\/(?:campaign-actions|publish-actions|waitlist-actions)"/);
    expect(door).toContain("actions: CampaignActions;");
    expect(door).toContain("publish: PublishActions;");
    expect(door).toContain("waitlist: WaitlistActions;");
    expect(page).toContain("const actions: CampaignActions = {");
    expect(page).toContain("const publish: PublishActions = {");
    expect(page).toContain('from "@/lib/press-tour/campaign-actions"');
    expect(page).toContain('from "@/lib/press-tour/publish-actions"');
    // Every spend carries a fresh sendId (campaign-types.ts), the film and a re-film included.
    for (const call of ["actions.planCampaign({", "actions.paintStills({", "actions.repaintStill({", "actions.filmShots({", "actions.refilmShot({"]) {
      const at = door.indexOf(call);
      expect(at, call).toBeGreaterThan(-1);
      expect(door.slice(at, at + 120), call).toContain("sendId: crypto.randomUUID()");
    }
    // Film: priced from the quote's film line, shut while the engine names a
    // blocker (a still undecided, filming switched off), saying what it is.
    const film = door.slice(door.indexOf("// Film: open once the engine names no blocker"), door.indexOf("m.filmHint,") + 12);
    expect(film.length).toBeGreaterThan(100);
    expect(film).toContain("price: quote ? priceTag(quote.animate) : null,");
    expect(film).toContain("disabled: campaign.blocker !== null || pending !== null,");
    expect(film).toContain("blocker: server(campaign.blocker),");
    // While we film, the key stays and stays shut.
    const filming = door.slice(door.indexOf('} else if (stage === "animating") {'), door.indexOf("} else if (filmed) {"));
    expect(filming).toContain("disabled: true,");
    expect(filming).toContain("press: null,");
    expect(door).toContain("aria-disabled={key.disabled}");
    expect(door).toContain("if (!key.disabled && key.press) key.press();");
  });

  it("puts every moment up on the wall and leaves each missed shot to the person: keep, re-film at its price, or cut", () => {
    // The fixed verdict shapes on every print, the red ring only on the worst miss, the flash only on a match.
    expect(wallPart).toContain("<Glyph v={x.verdict} />");
    expect(wallPart).toContain("matched && s.flash,");
    expect(wallPart).toContain('x.verdict === "not_readable" && s.momentUnread,');
    expect(wallPart).toContain("worst && s.printMiss,");
    // The three presses, and nothing decided for the person.
    expect(wallPart).toContain("act.keep(shot.shot, take.take)");
    expect(wallPart).toContain("act.refilm(shot.shot, note.trim())");
    expect(wallPart).toContain("act.cut(shot.shot)");
    expect(wallPart).toContain("formatMsg(m.creditsShort, { n: shot.refilmCredits })");
    expect(wallPart).toContain("m.cutShot} <small");
    expect(wallPart).toContain("{m.free}</small>");
    // The honest lines, on both walls.
    expect(wallPart.match(/\{m\.wallHonest\}/g)?.length).toBe(2);
    // The letter row and the four parts only when the record holds both readings.
    expect(wallPart).toContain("const d = x.moment.detail;\n  if (!d) return null;");
    expect(en.pressTour.wallHonest).toBe("The check can be wrong, so every moment stays up for you to judge. Blur never counts as a miss.");
  });

  it("posts only what the person saw and pressed: TikTok's audit rules, the AI label always on, a consent per press", () => {
    // Who can see it: no default, only what TikTok returned.
    expect(linePart).toContain('value={ui.privacy ?? ""}');
    expect(linePart).toContain('<option value="" disabled>');
    expect(linePart).toContain("(sheet?.privacyOptions ?? []).map((p) =>");
    // Comment, Duet and Stitch: unticked until ticked, greyed when the creator turned them off.
    expect(linePart).toContain("<TickBox checked={!off && ui[key]} disabled={off}");
    // Branded content never "Only me", and unavailable in test mode.
    expect(linePart).toContain('disabled={p === "SELF_ONLY" && ui.commercial && ui.brandedContent}');
    expect(linePart).toContain("disabled={!ui.commercial || !sheet || !sheet.brandedContentAvailable}");
    // TikTok is never scheduled, and gets the clean file.
    expect(linePart).toContain('when: net === "tiktok" ? "now" : at,');
    expect(linePart).toContain('const file = net === "tiktok" ? clean : tagged;');
    // The AI label: shown on, and it can't be switched off.
    expect(linePart).toContain("<Switch on label={formatMsg(m.alwaysOnLabel, { label: title })} locked />");
    // Every press sends the preview's consent token and ONE send id per network and consent token: a retry after a
    // lost answer resends the same press, never a second post (MONEY-3); the id goes once the post went through.
    expect(linePart).toContain("const held = sendIds[net]?.token === token ? sendIds[net]! : { token, id: crypto.randomUUID() };");
    expect(linePart).toContain("const meta = { sendId: held.id, consentToken: token, locale, uiVersion: PRESS_LINE_VERSION };");
    expect(linePart).toContain("setSendIds((prev) => (prev[net]?.id === held.id ? { ...prev, [net]: undefined } : prev));");
    expect(linePart).not.toMatch(/sendId: crypto\.randomUUID\(\)/);
    // A mismatched shot still in the cut is said on the press line (PT-R3-05), and the TikTok file's hand-posting note
    // sits by the fallback download too (PT-R3-02).
    expect(linePart).toContain("server(previews[net]?.draft?.cutWarning)");
    expect(linePart.match(/\{m\.saveForTikTokNote\}/g)?.length).toBe(1);
    expect(linePart).toContain("publish.consentAndSchedule({ ...draft, ...meta, when })");
    expect(linePart).toContain("publish.consentAndPost({ ...draft, ...meta })");
    // The Music Usage Confirmation line.
    expect(en.pressTour.ttDeclaration).toContain("{music}");
    expect(en.pressTour.ttMusicLink).toBe("Music Usage Confirmation");
  });

  it("builds no re-shoot, no refund line and no trend claim (operator, 2026-09-26)", () => {
    // No re-shoot of any kind: a still is repainted at its price, or kept; a
    // filmed shot is re-filmed only by the person's press, at its normal
    // price (the refilm presses above), never on its own.
    expect(code(all)).not.toMatch(/re-?shoot(?!\s*===\s*"off")/i);
    expect(code(all).match(/actions\.refilmShot\(/g)?.length).toBe(1);
    // The policy line prints only for the decided launch state.
    expect(all).toContain('quote.policy.reshoot === "off" && !quote.policy.refund');
    // The trend brief is not built: no trend card, no press_trends read.
    expect(code(all)).not.toMatch(/trend/i);
    expect(Object.keys(en.pressTour).some((k) => /trend|reshoot|refund/i.test(k))).toBe(false);
  });

  it("fires the flashbulb when the star matched and every applicable check matched, and not at all under reduced motion", () => {
    expect(read("components", "press-tour", "running-order.tsx")).toContain("flashes ? s.flash : clear ? s.glow : waits ? s.waiting : null");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.flash::after,\s*\.flash > img,\s*\.flash \.land/);
    expect(reduced).toContain("animation: none;");
    // Red is only ever "Didn't match": in the CSS only its own rules carry
    // it, and no piece of the door writes it inline.
    const RED = /#f08a80|#ffb4ab|#ff8a80|255, ?138, ?128/i;
    const rules = css.split("}").filter((rule) => RED.test(rule));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule.slice(0, rule.indexOf("{")).trim(), rule).toMatch(/Miss$/);
    for (const [name, text] of PARTS) expect(text, name).not.toMatch(RED);
  });

  it("says the same keys in all four languages", () => {
    const keys = keysOf(section("en"));
    expect(keys.length).toBeGreaterThan(20);
    for (const lang of ["es", "pt", "it"] as const) expect(keysOf(section(lang)), lang).toEqual(keys);
  });

  it("uses every word it was given, and no word it was not", () => {
    const used = new Set([...`${all}\n${page}`.matchAll(/\b(?:m|t\.pressTour)\.(\w+)/g)].map((x) => x[1]));
    const known = new Set(keysOf(section("en")));
    for (const key of known) expect(used.has(key), `unused word: ${key}`).toBe(true);
    for (const key of used) expect(known.has(key), `missing word: ${key}`).toBe(true);
  });

  it("translates every word — only its name, and words that are the same in the language, stay English", () => {
    const keys = Object.keys(en.pressTour) as (keyof typeof en.pressTour)[];
    for (const lang of ["es", "pt", "it"] as const) {
      const c = CATALOGS[lang];
      for (const key of keys) {
        expect(c.pressTour[key], `${lang}.pressTour.${key} is empty`).toBeTruthy();
        const same = c.pressTour[key] === en.pressTour[key];
        expect(same, `${lang}.pressTour.${key}`).toBe(SAME_AS_ENGLISH[lang].includes(key));
      }
      expect(c.nav.pressTourSub).not.toBe(en.nav.pressTourSub);
      // The name is English everywhere.
      expect(c.nav.pressTour).toBe("Press Tour");
      expect(c.pressTour.headline).toBe("Press Tour");
    }
    expect(en.nav.pressTour).toBe("Press Tour");
  });

  it("keeps the machinery off the wall in every language", () => {
    expect(spoken("en").join(" ").length).toBeGreaterThan(400);
    for (const lang of LANGS) {
      for (const words of spoken(lang)) {
        const allowed = REAL_WORDS[lang];
        const text = allowed ? words.replace(allowed, "") : words;
        expect(text, `${lang}: ${words}`).not.toMatch(MACHINERY);
      }
    }
    // The list itself catches what it is for, and lets real words through.
    expect("Filmed with Kling 3").toMatch(MACHINERY);
    expect("Rendered at 1080p on our server").toMatch(MACHINERY);
    expect("Nano Banana stills").toMatch(MACHINERY);
    expect("Veo 3 took it").toMatch(MACHINERY);
    expect("Te veo en la rueda de prensa".replace(REAL_WORDS.es!, "")).not.toMatch(MACHINERY);
    expect("We want the falafel").not.toMatch(MACHINERY);
  });

  it("promises no lock, no free re-shoot and no refund (operator, 2026-09-26)", () => {
    const LOCKED: Record<Lang, RegExp> = {
      en: /\block(?:ed|s)?\b/i,
      es: /bloquead|blindad/i,
      pt: /bloquead|travad/i,
      it: /bloccat|blindat/i,
    };
    const FREE_RESHOOT: Record<Lang, RegExp> = {
      en: /re-?shoot[^.]*\bfree\b|\bfree\b[^.]*re-?shoot/i,
      es: /repet\w*[^.]*gratis|gratis[^.]*repet/i,
      pt: /(?:refaz|refilm|regrav)\w*[^.]*(?:grátis|de graça)|(?:grátis|de graça)[^.]*(?:refaz|refilm|regrav)/i,
      it: /(?:rigir|rifa)\w*[^.]*gratis|gratis[^.]*(?:rigir|rifa)/i,
    };
    const REFUND: Record<Lang, RegExp> = {
      en: /\brefund/i,
      es: /reembols/i,
      pt: /reembols|estorn/i,
      it: /rimbors/i,
    };
    for (const lang of LANGS) {
      for (const words of spoken(lang)) {
        expect(words, lang).not.toMatch(LOCKED[lang]);
        expect(words, lang).not.toMatch(FREE_RESHOOT[lang]);
        expect(words, lang).not.toMatch(REFUND[lang]);
      }
    }
  });

  it("tells the assistant it exists and is not open to customers yet", () => {
    const guide = renderProductGuide();
    expect(guide).toContain("PRESS TOUR");
    expect(guide).toContain("/app/press-tour");
    expect(guide).toContain("not open to customers yet");
  });
});
