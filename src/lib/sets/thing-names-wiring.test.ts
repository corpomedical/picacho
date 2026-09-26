import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../i18n/messages/en";
import es from "../i18n/messages/es";
import pt from "../i18n/messages/pt";
import it_ from "../i18n/messages/it";

// One naming rule on screen (Helios Cut 4, step B2, 2026-09-26), read as
// source like the page's other wiring tests: every place the set page, the
// card, Build's scene tree and its inspector name a thing reads the same
// rule (elements.ts thingLabels), and the eye-line and focus menus list one
// row per thing, then the set itself (object-ref.ts refRows).

const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
const card = readFileSync(join(__dirname, "../../components/sets/element-card.tsx"), "utf8");
const tree = readFileSync(join(__dirname, "../../components/sets/scene-tree.tsx"), "utf8");
const editor = readFileSync(join(__dirname, "../../components/sets/set-editor.tsx"), "utf8");

describe("the set page's names", () => {
  it("names a thing by the one rule, and a list row adds an unnamed thing's colour, in both layouts", () => {
    expect(view).toContain("const thingLabelOf = useMemo(() => new Map(thingLabels(spec, els).map((l) => [l.key, l])), [spec, els]);");
    expect(view).toContain("return l ? thingLabelText(l, thingWords) : \"\";");
    expect(view).toContain("return l ? thingRowText(l, thingWords, s.reply.colours) : elementName(key);");
    // The three-step layout's "In this set" rows (things-panel.tsx), and the Classic cast strip's chips.
    expect(view).toContain("      name: elementRowName(e.key),\n      thumb: first ?");
    expect(view).toContain("return [{ key: st.key, name: elementRowName(st.key),");
    expect(view).toContain("namedN: s.cast.namedN");
    // Where a photo on nothing can go: the same rows, in the strip's menu and the list's.
    expect(view).toContain("targets={els.map((e) => ({ key: e.key, name: elementRowName(e.key) }))}");
    expect(view).toContain("targets: els.map((e) => ({ key: e.key, name: elementRowName(e.key) })),");
  });

  it("names a tapped part of the set itself when the set does, and says \"Part of the set\" otherwise", () => {
    expect(view).toContain("else if (hit.kind === \"structure\") openElementCard(null, hit.oi);");
    expect(view).toContain("const part = oi === undefined ? undefined : setParts(spec, els).find((p) => p.objects.includes(oi));");
    expect(view).toContain("name: part ? fill(cast.structureNamed, { name: capitalised(part.name) }) : cast.structureTitle");
    expect(view).toContain("const el = cardElementOf(elementCard.key, elementCard.oi);");
    expect(card).toContain('{element.name || (element.kind === "structure" ? c.structureTitle : "")}');
    // A thing's card: "Red sports car", or "Car · red" without a name.
    expect(card).toContain('{"colour" in element && element.colour ? ` · ${element.colour}` : ""}');
    expect(view).toContain("...(l && l.name === null ? { colour: s.reply.colours[l.colour] } : {})");
    for (const [name, t] of Object.entries({ en, es, pt, it: it_ })) {
      expect(t.sets.cast.structureNamed, name).toContain("{name}");
      expect(t.sets.cast.structureNamed.replace("{name}", "").trim().length, name).toBeGreaterThan(0);
    }
    for (const t of [es, pt, it_]) expect(t.sets.cast.structureNamed).not.toBe(en.sets.cast.structureNamed);
  });
});

describe("the eye-line and focus menus", () => {
  it("list one row per thing, then \"Part of the set\" with every block of the set itself, for everyone (critic item 7)", () => {
    expect(view).toContain("const refMenu = useMemo(() => refRows(spec, els), [spec, els]);");
    // The eye-line menu: things, then the set itself under its heading.
    expect(view).toContain("{[...refMenu.things, ...refMenu.parts].map((row, i) => (");
    expect(view).toContain("{i === refMenu.things.length && (");
    expect(view).toContain('active={gaze?.at === "object" && row.objects.includes(gaze.index)}');
    // A beat's Focus and Eye-line: the same rows, the set itself in an optgroup.
    expect(view.split("<optgroup label={cast.structureTitle}>").length - 1).toBe(2);
    expect(view).not.toContain("spec.objects.map((o, oi) => (\n                  <option");
    // No switch: every account's menus (no isAdmin or flag around them).
    const menu = view.slice(view.indexOf("{menu === \"gaze\" && ("), view.indexOf("{menu === \"gaze\" && (") + 3000);
    expect(menu).not.toMatch(/isAdmin|OPEN_TO_ALL/);
  });

  it("names what an eye-line or a focus pull is on as its row names it: the chip, the stage's label and a beat's line", () => {
    expect(view).toContain("? `${s.studio.gaze} · ${fill(s.studio.gazeThing, { thing: refName(gaze.index) })}`");
    expect(view).toContain("const gazeOnName = gaze?.at === \"object\" ? refName(gaze.index) : \"\";");
    expect(view).toContain("? fill(s.studio.lookAtThing, { thing: gazeOnName })");
    expect(view).toContain("? fill(s.studio.lookAtThing, { thing: refName(b.gaze.index) })");
    expect(view).not.toContain("names.objectName(spec.objects[gaze.index])");
  });
});

describe("Build", () => {
  it("lists a named block as \"Grandstand · Box\" and finds it by its name; the inspector says the same", () => {
    expect(tree).toContain("o.name !== undefined ? `${capitalised(o.name)} · ${shapeName(o.shape)}` : `${shapeName(o.shape)} · ${r1(o.size[0])}×${r1(o.size[1])}×${r1(o.size[2])}`;");
    // The search reads the row's whole name, the set's name for it included.
    expect(tree).toContain("hit(names.objectName(o)) && (");
    expect(editor).toContain("const objectName = sceneNames(spec, s).objectName;");
  });
});
