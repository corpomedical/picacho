import { describe, expect, it } from "vitest";
import { STUDIO_HTML } from "./studio-markup";
import { STUDIO_TEXT } from "./studio-text";
import { localNumber, studioTranslator } from "./studio-i18n";
import { normaliseStudioSummary, studioAstraInput, studioLanguage } from "../../lib/sets/studio-astra";

const LOCALES = ["es", "pt", "it"] as const;
const holes = (s: string) => [...s.matchAll(/\{(\d)\}/g)].map((m) => m[1]).sort().join(",");

describe("Helios Studio's words in four languages", () => {
  it("every row has English, Spanish, Portuguese and Italian, the same {n} values, and no English key twice", () => {
    const seen = new Set<string>();
    for (const row of STUDIO_TEXT) {
      expect(row, row[0]).toHaveLength(4);
      for (const cell of row) expect(cell.trim(), row[0]).not.toBe("");
      for (const cell of row.slice(1)) expect(holes(cell), row[0]).toBe(holes(row[0]));
      const key = row[0].replace(/\s+/g, " ");
      expect(seen.has(key), `twice: ${row[0]}`).toBe(false);
      seen.add(key);
    }
    expect(STUDIO_TEXT.length).toBeGreaterThan(450);
  });

  it("translates exact text, patterns with their values, and numbers the way each language writes them", () => {
    const es = studioTranslator("es"), it2 = studioTranslator("it"), pt = studioTranslator("pt");
    expect(es("Insert keyframe")).toBe("Insertar clave");
    expect(pt("Edit Mode")).toBe("Modo Edição");
    expect(it2("Properties")).toBe("Proprietà");
    expect(es("Undo · Insert keyframe")).toBe("Deshacer · Insertar clave");
    expect(es("Measured 3.25 m")).toBe("Medido: 3,25 m");
    expect(it2("1.00 kg")).toBe("1,00 kg");
    expect(es("Objects 1/5 | Verts 12,975 | 15:48")).toBe("Objetos 1/5 | Vértices 12.975 | 15:48");
    expect(es("Apply 3 steps")).toBe("Aplicar 3 pasos");
    expect(es("Add  ·  something nobody wrote")).toBe("Add  ·  something nobody wrote");
    expect(studioTranslator("en")("Insert keyframe")).toBe("Insert keyframe");
    expect(localNumber("18,304", "pt")).toBe("18.304");
    expect(localNumber("0.25", "en")).toBe("0.25");
  });

  it("the Studio's own words are what Blender's interfaces say, and Blender's kept English stays", () => {
    const es = studioTranslator("es"), pt = studioTranslator("pt"), it2 = studioTranslator("it");
    expect([es("Outliner"), pt("Outliner"), it2("Outliner")]).toEqual(["Listado", "Delineador", "Outliner"]);
    expect([es("Track To"), pt("Array"), it2("Mirror")]).toEqual(["Track To", "Array", "Mirror"]);
    expect([es("Layout"), pt("Layout"), it2("Layout")]).toEqual(["Layout", "Layout", "Layout"]);
  });

  it("no English is left in the markup: every text and label is translated, or is a word every language keeps", () => {
    // Words, keys and names that are the same in all four (Blender keeps them, or they are keys / data).
    const SAME = new Set(["Picacho", "Layout", "Shot", "Render", "Helios Studio · beta", "Global", "Global ▾", "Astra", "Array", "Mirror", "Track To", "Set", "Helios Render", "16:9 · HD", "GLB", "OBJ", "STL", "AI", "GPU", "LMB", "RMB", "⇧LMB", "⇧RMB", "Tab", "⌃Space", "Home", ".glb", "GLB · OBJ · STL", "Material", "Final", "Sensor", "Local", "Cache", "Menu", "Alpha", "Center", "Format", "Type", "Box", "Engine", "Item", "Timeline", "Timeline ▾", "Empty", "Mesh", "Camera", "Wireframe", "Output", "Cast", "Menus", "File", "Timeline · Dope Sheet", "Outliner", "Scope"]);
    const html = STUDIO_HTML.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<(script|style)[\s\S]*?<\/\1>/g, "");
    const texts = [...html.matchAll(/>([^<>]+)</g)].map((m) => m[1].replace(/\s+/g, " ").trim()).filter((t) => /[A-Za-z]{2}/.test(t));
    const labels = [...html.matchAll(/\b(?:title|placeholder|aria-label)=(?:"([^"]*)"|'([^']*)')/g)].map((m) => (m[1] ?? m[2]).trim()).filter((t) => /[A-Za-z]{2}/.test(t));
    const all = [...new Set([...texts, ...labels])];
    expect(all.length).toBeGreaterThan(80);
    for (const loc of LOCALES) {
      const tr = studioTranslator(loc);
      const left = all.filter((t) => tr(t) === t && !SAME.has(t));
      expect(left, loc).toEqual([]);
    }
  });

  it("Astra is told the person's language in one short line; English sends nothing new", () => {
    const summary = normaliseStudioSummary({ objects: [] });
    expect(studioAstraInput("hola", summary, [], studioLanguage("es")).split("\n")[0]).toBe("Write reply, question, options and every say in Spanish (Spain); names and ids stay as they are.");
    expect(studioLanguage("pt")).toBe("Brazilian Portuguese");
    expect(studioLanguage("it")).toBe("Italian");
    expect(studioLanguage("en")).toBeNull();
    expect(studioLanguage("xx")).toBeNull();
    expect(studioAstraInput("hi", summary, [], studioLanguage("en")).startsWith("Scene:")).toBe(true);
  });
});
