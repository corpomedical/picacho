// The blind corpus: loaded, checked and hashed. The runner NEVER writes a
// brief — the corpus is a directory the operator hands in, written by
// someone who has not read the builder's instructions, the set schema,
// docs/ASTRA_SETS.md or any Picacho prompt or rulebook (corpus-template/WRITER.md).
//
// validateCorpus is pure over parsed JSON; loadCorpus reads the files.
//
// A dry run accepts the template (every row marked "_template": true, or
// text starting "<<FORMAT ONLY") with a banner. --spend refuses any template
// row, a missing attestation, and — unless --allow-partial-corpus — any file
// short of the counts section 4 of docs/ASTRA_SETS.md asks for.
//
// PHOTOS (Sets from a photo). location-photos.json lists A/B's people-free
// location photos; people-photos.json lists D's photos with people, each
// with how the writer has the right to send it to OpenAI (everyone
// recognisable consented, or the people are AI-generated). The pictures
// stay in the corpus folder, outside the repo: loadCorpus reads each one to
// hash it into the corpus hash, so a changed photo reads as a changed
// corpus. Notes get the production clean-up (cleanText at 300, the reserved
// placeholder never a note); notes the form would have cut are a problem.

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { cleanText } from "../../../src/lib/sets/set-spec.ts";
import {
  SET_BRIEF_MAX_CHARS,
  SET_BRIEF_MIN_CHARS,
  SET_DIRECTION_MAX_CHARS,
  SET_PHOTO_MAX_FILE_BYTES,
  SET_PHOTO_NOTES_MAX_CHARS,
  SET_RESERVED_BRIEF,
} from "../../../src/lib/sets/set-config.ts";
import { canonicalJson, isRecord, sha256 } from "./util.mts";

export const CATEGORIES = ["interior", "exterior", "stylised"] as const;
export type Category = (typeof CATEGORIES)[number];
export const ADV_CATEGORIES = ["sexualised-venue", "minors-space", "violence", "brand-venue", "other"] as const;
export type AdvCategory = (typeof ADV_CATEGORIES)[number];

export const FILE_KEYS = ["briefs", "adversarial", "directions", "characters", "canary", "match", "baselines", "locationPhotos", "peoplePhotos"] as const;
export type FileKey = (typeof FILE_KEYS)[number];

/** A/B's photo arm: 20 photos × 3 runs is the spend block's "A/B photos: 60 builds". */
export const LOCATION_PHOTOS_WANTED = 20;
export const LOCATION_PHOTOS_PER_CATEGORY_MIN = 5;
/** Section 4, Part D: "10 location photos containing people". */
export const PEOPLE_PHOTOS_WANTED = 10;

export type Brief = { id: string; category: Category; brief: string; template: boolean };
export type AdversarialRow = { id: string; category: AdvCategory; harmful: boolean; brief: string; template: boolean };
export type Character = {
  id: string;
  name: string;
  consent: { kind: "ai-persona" | "real-person"; confirmedBy: string; confirmedOn: string | null };
  identityPhoto: string;
  traits: { hair: string; distinguishing_features: string; outfit: string; personality: string };
  template: boolean;
};
export type CanaryRow = { id: string; brief: string; template: boolean };
export type MatchRow = {
  id: string;
  file: string;
  licence: string;
  containsPeople: boolean;
  exif: { focal35mm: number | null; focalMm: number | null; orientation: number } | null;
  template: boolean;
};
export type Baselines = {
  identity: { characterId: string; engine: string; scores: number[]; source: string; readOn: string }[];
  outputGateStrictLane: { renders: number; refusals: number; window: string; source: string; readOn: string } | null;
};
/** What every photo row carries: the picture (a relative path inside the corpus) and the photographer's notes, cleaned ("" when none). */
export type PhotoRow = { id: string; file: string; notes: string; licence: string; template: boolean };
export type LocationPhoto = PhotoRow & { category: Category };
export type PeoplePhoto = PhotoRow & { consent: { kind: "ai-generated" | "consented"; confirmedBy: string; confirmedOn: string | null } };

export type CorpusData = {
  meta: { corpusVersion: number; writtenBy: string; writtenOn: string; attested: boolean };
  briefs: Brief[];
  adversarial: AdversarialRow[];
  directions: string[];
  characters: Character[];
  canary: CanaryRow[];
  match: MatchRow[];
  baselines: Baselines | null;
  locationPhotos: LocationPhoto[];
  peoplePhotos: PeoplePhoto[];
};

export type CorpusNeeds = Partial<Record<Exclude<FileKey, "baselines">, boolean>>;

export type CorpusCheck = {
  ok: boolean;
  problems: string[];
  warnings: string[];
  template: boolean;
  data: CorpusData;
  hashes: Record<string, string>;
  corpusHash: string;
};

const FORMAT_ONLY = "<<FORMAT ONLY";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const PHOTO = /\.(jpe?g|png|webp)$/i;

const isTemplateRow = (row: Record<string, unknown>) =>
  row._template === true || Object.values(row).some((v) => typeof v === "string" && v.trimStart().startsWith(FORMAT_ONLY));

const norm = (s: string) => cleanText(s, 100_000).toLowerCase();

function safeRelative(p: unknown): p is string {
  if (typeof p !== "string" || !p || isAbsolute(p)) return false;
  const n = normalize(p);
  return !n.startsWith("..") && !n.includes("/../");
}

/**
 * The production notes clean-up (sets/actions.ts submitSetPhotoBuild):
 * cleanText at 300, and the reserved placeholder is never a note. The form
 * stops typing at 300 (sets-home.tsx), so longer notes are a corpus mistake,
 * not a case to cut silently.
 */
export function cleanNotes(raw: unknown): { ok: true; notes: string } | { ok: false; why: "too_long" | "not_text" } {
  if (raw === undefined || raw === null) return { ok: true, notes: "" };
  if (typeof raw !== "string") return { ok: false, why: "not_text" };
  if (Array.from(cleanText(raw, 100_000)).length > SET_PHOTO_NOTES_MAX_CHARS) return { ok: false, why: "too_long" };
  const notes = cleanText(raw, SET_PHOTO_NOTES_MAX_CHARS);
  return { ok: true, notes: notes === SET_RESERVED_BRIEF ? "" : notes };
}

/** The production brief clean-up (sets/actions.ts submitSetBuild). */
export function cleanBrief(raw: unknown): { ok: true; brief: string } | { ok: false; why: "too_long" | "too_short" | "not_text" } {
  if (typeof raw !== "string") return { ok: false, why: "not_text" };
  const t = raw.trim();
  if (t.length > SET_BRIEF_MAX_CHARS) return { ok: false, why: "too_long" };
  const brief = cleanText(t, SET_BRIEF_MAX_CHARS);
  if (brief.length < SET_BRIEF_MIN_CHARS) return { ok: false, why: "too_short" };
  return { ok: true, brief };
}

export function validateCorpus(
  files: { corpus: unknown } & Partial<Record<FileKey, unknown>>,
  o: { spend: boolean; allowPartial: boolean; needs: CorpusNeeds },
): CorpusCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  const hashes: Record<string, string> = {};
  let template = false;
  const data: CorpusData = {
    meta: { corpusVersion: 0, writtenBy: "", writtenOn: "", attested: false },
    briefs: [],
    adversarial: [],
    directions: [],
    characters: [],
    canary: [],
    match: [],
    baselines: null,
    locationPhotos: [],
    peoplePhotos: [],
  };
  const ids = new Set<string>();
  const claimId = (file: string, id: unknown, i: number): string | null => {
    if (typeof id !== "string" || !ID.test(id)) {
      problems.push(`${file}[${i}]: id must be 1–40 letters, digits, - or _`);
      return null;
    }
    if (ids.has(id)) problems.push(`${file}: duplicate id ${id}`);
    ids.add(id);
    return id;
  };
  const count = (file: FileKey, got: number, want: string, okCount: boolean) => {
    if (okCount) return;
    const msg = `${file}: ${got} rows; the eval asks for ${want}`;
    if (o.spend && !o.allowPartial && o.needs[file as Exclude<FileKey, "baselines">]) problems.push(`${msg} (or pass --allow-partial-corpus)`);
    else warnings.push(msg);
  };

  // corpus.json
  const c = files.corpus;
  if (!isRecord(c)) problems.push("corpus.json is not an object");
  else {
    hashes["corpus.json"] = sha256(canonicalJson(c));
    if (c.corpusVersion !== 1) problems.push("corpus.json: corpusVersion must be 1");
    data.meta.corpusVersion = Number(c.corpusVersion) || 0;
    data.meta.writtenBy = typeof c.writtenBy === "string" ? c.writtenBy : "";
    data.meta.writtenOn = typeof c.writtenOn === "string" ? c.writtenOn : "";
    if (!data.meta.writtenBy.trim()) problems.push("corpus.json: writtenBy (a pseudonym) is required");
    if (!DATE.test(data.meta.writtenOn)) problems.push("corpus.json: writtenOn must be YYYY-MM-DD");
    const att = typeof c.blindAttestation === "string" ? c.blindAttestation.trim() : "";
    const attTemplate = att.startsWith(FORMAT_ONLY) || c._template === true;
    data.meta.attested = att.length >= 20 && !attTemplate;
    if (attTemplate || isTemplateRow(c)) template = true;
    if (!data.meta.attested) {
      const msg = "corpus.json: blindAttestation must be the writer's own sentence (has not read the builder instructions, the set schema, docs/ASTRA_SETS.md or any Picacho prompt or rulebook)";
      if (o.spend) problems.push(msg);
      else warnings.push(msg);
    }
  }

  const rows = (key: FileKey): Record<string, unknown>[] | null => {
    const v = files[key];
    if (v === undefined) {
      if (o.needs[key as Exclude<FileKey, "baselines">]) problems.push(`${key}: file missing (corpus.json files.${key})`);
      return null;
    }
    hashes[key] = sha256(canonicalJson(v));
    if (!Array.isArray(v)) {
      problems.push(`${key}: must be an array`);
      return null;
    }
    return v.map((r, i) => {
      if (!isRecord(r)) {
        problems.push(`${key}[${i}]: must be an object`);
        return {};
      }
      if (isTemplateRow(r)) template = true;
      return r;
    });
  };
  const templateInSpend = (key: FileKey, r: Record<string, unknown>, i: number) => {
    if (o.spend && isTemplateRow(r) && o.needs[key as Exclude<FileKey, "baselines">]) {
      problems.push(`${key}[${i}]: a FORMAT-ONLY template row cannot be spent on`);
    }
  };

  // briefs.json (A/B/C)
  const briefs = rows("briefs");
  if (briefs) {
    const seen = new Map<string, string>();
    briefs.forEach((r, i) => {
      const id = claimId("briefs", r.id, i);
      templateInSpend("briefs", r, i);
      if (!(CATEGORIES as readonly string[]).includes(String(r.category))) problems.push(`briefs[${i}]: category must be ${CATEGORIES.join(" | ")}`);
      const cleaned = cleanBrief(r.brief);
      if (!cleaned.ok) {
        problems.push(`briefs[${i}]: brief ${cleaned.why === "too_long" ? `longer than ${SET_BRIEF_MAX_CHARS} characters` : cleaned.why === "too_short" ? `under ${SET_BRIEF_MIN_CHARS} characters after clean-up` : "must be text"}`);
        return;
      }
      const key = norm(cleaned.brief);
      if (seen.has(key)) problems.push(`briefs: ${id} repeats ${seen.get(key)} once normalised`);
      seen.set(key, String(id));
      if (id) data.briefs.push({ id, category: r.category as Category, brief: cleaned.brief, template: isTemplateRow(r) });
    });
    for (const cat of CATEGORIES) {
      const got = data.briefs.filter((b) => b.category === cat).length;
      count("briefs", got, `10 ${cat}`, got === 10);
    }
  }

  // adversarial.json (D) — clean-up failures are TEST CASES (form-rejected), not corpus errors
  const adv = rows("adversarial");
  if (adv) {
    const seen = new Map<string, string>();
    adv.forEach((r, i) => {
      const id = claimId("adversarial", r.id, i);
      templateInSpend("adversarial", r, i);
      if (!(ADV_CATEGORIES as readonly string[]).includes(String(r.category))) problems.push(`adversarial[${i}]: category must be ${ADV_CATEGORIES.join(" | ")}`);
      if (typeof r.harmful !== "boolean") problems.push(`adversarial[${i}]: harmful must be true or false (the writer's label)`);
      if (typeof r.brief !== "string" || !r.brief.trim()) {
        problems.push(`adversarial[${i}]: brief must be non-empty text`);
        return;
      }
      const key = norm(r.brief);
      if (seen.has(key)) problems.push(`adversarial: ${id} repeats ${seen.get(key)} once normalised`);
      seen.set(key, String(id));
      if (id) data.adversarial.push({ id, category: r.category as AdvCategory, harmful: r.harmful === true, brief: r.brief, template: isTemplateRow(r) });
    });
    count("adversarial", data.adversarial.length, "40", data.adversarial.length === 40);
  }

  // directions.json
  const dir = files.directions;
  if (dir !== undefined) {
    hashes.directions = sha256(canonicalJson(dir));
    if (!Array.isArray(dir)) problems.push("directions: must be an array of strings");
    else {
      dir.forEach((d, i) => {
        if (typeof d !== "string" || !d.trim()) problems.push(`directions[${i}]: must be non-empty text`);
        else if (d.length > SET_DIRECTION_MAX_CHARS) problems.push(`directions[${i}]: longer than ${SET_DIRECTION_MAX_CHARS} characters`);
        else {
          if (d.trimStart().startsWith(FORMAT_ONLY)) {
            template = true;
            if (o.spend && o.needs.directions) problems.push(`directions[${i}]: a FORMAT-ONLY template row cannot be spent on`);
          }
          data.directions.push(d);
        }
      });
      if (data.directions.length < 3) {
        const msg = `directions: ${data.directions.length} rows; at least 3 location-agnostic actions are needed`;
        if (o.spend && o.needs.directions) problems.push(msg);
        else warnings.push(msg);
      }
    }
  } else if (o.needs.directions) problems.push("directions: file missing (corpus.json files.directions)");

  // characters.json
  const chars = rows("characters");
  if (chars) {
    chars.forEach((r, i) => {
      const id = claimId("characters", r.id, i);
      templateInSpend("characters", r, i);
      const consent = isRecord(r.consent) ? r.consent : null;
      const kind = consent?.kind;
      if (kind !== "ai-persona" && kind !== "real-person") problems.push(`characters[${i}]: consent.kind must be ai-persona or real-person`);
      if (typeof consent?.confirmedBy !== "string" || !consent.confirmedBy.trim()) problems.push(`characters[${i}]: consent.confirmedBy (operator initials) is required`);
      const on = typeof consent?.confirmedOn === "string" ? consent.confirmedOn : null;
      if (kind === "real-person" && (on === null || !DATE.test(on))) problems.push(`characters[${i}]: a real person needs consent.confirmedOn (YYYY-MM-DD)`);
      if (!safeRelative(r.identityPhoto) || !PHOTO.test(String(r.identityPhoto))) {
        problems.push(`characters[${i}]: identityPhoto must be a relative path to a .jpg, .png or .webp inside the corpus (HEIC is refused)`);
      }
      const t = isRecord(r.traits) ? r.traits : {};
      const trait = (k: string) => (typeof t[k] === "string" ? (t[k] as string) : "");
      if (typeof r.name !== "string" || !r.name.trim()) problems.push(`characters[${i}]: name is required`);
      if (id) {
        data.characters.push({
          id,
          name: String(r.name ?? ""),
          consent: { kind: kind === "real-person" ? "real-person" : "ai-persona", confirmedBy: String(consent?.confirmedBy ?? ""), confirmedOn: on },
          identityPhoto: String(r.identityPhoto ?? ""),
          traits: { hair: trait("hair"), distinguishing_features: trait("distinguishing_features"), outfit: trait("outfit"), personality: trait("personality") },
          template: isTemplateRow(r),
        });
      }
    });
    count("characters", data.characters.length, "exactly 2", data.characters.length === 2);
  }

  // canary.json
  const can = rows("canary");
  if (can) {
    const seen = new Map<string, string>();
    can.forEach((r, i) => {
      const id = claimId("canary", r.id, i);
      templateInSpend("canary", r, i);
      const cleaned = cleanBrief(r.brief);
      if (!cleaned.ok) {
        problems.push(`canary[${i}]: brief fails the production clean-up (${cleaned.why})`);
        return;
      }
      const key = norm(cleaned.brief);
      if (seen.has(key)) problems.push(`canary: ${id} repeats ${seen.get(key)} once normalised`);
      seen.set(key, String(id));
      if (id) data.canary.push({ id, brief: cleaned.brief, template: isTemplateRow(r) });
    });
    count("canary", data.canary.length, "10", data.canary.length === 10);
  }

  // match.json (E, deferred)
  const match = rows("match");
  if (match) {
    match.forEach((r, i) => {
      const id = claimId("match", r.id, i);
      templateInSpend("match", r, i);
      if (!safeRelative(r.file) || !PHOTO.test(String(r.file))) problems.push(`match[${i}]: file must be a relative .jpg, .png or .webp inside the corpus`);
      if (typeof r.licence !== "string" || !r.licence.trim()) problems.push(`match[${i}]: licence is required`);
      if (typeof r.containsPeople !== "boolean") problems.push(`match[${i}]: containsPeople must be true or false`);
      let exif: MatchRow["exif"] = null;
      if (r.exif !== null && r.exif !== undefined) {
        const e = isRecord(r.exif) ? r.exif : {};
        const num = (v: unknown) => (v === null || v === undefined ? null : typeof v === "number" && v > 0 && Number.isFinite(v) ? v : NaN);
        const f35 = num(e.focal35mm);
        const fmm = num(e.focalMm);
        const orientation = e.orientation === undefined ? 1 : Number(e.orientation);
        if (Number.isNaN(f35) || Number.isNaN(fmm) || !Number.isInteger(orientation) || orientation < 1 || orientation > 8) {
          problems.push(`match[${i}]: exif is null or {focal35mm, focalMm, orientation 1–8}`);
        } else exif = { focal35mm: f35, focalMm: fmm, orientation };
      }
      if (id) data.match.push({ id, file: String(r.file ?? ""), licence: String(r.licence ?? ""), containsPeople: r.containsPeople === true, exif, template: isTemplateRow(r) });
    });
    count("match", data.match.length, "30", data.match.length === 30);
  }

  // location-photos.json (A/B's photo arm) and people-photos.json (D's photo
  // leg). One picture never serves two rows, in either file.
  const photoFiles = new Map<string, string>();
  const photoRow = (key: "locationPhotos" | "peoplePhotos", r: Record<string, unknown>, i: number): PhotoRow | null => {
    const id = claimId(key, r.id, i);
    templateInSpend(key, r, i);
    let ok = true;
    if (!safeRelative(r.file) || !PHOTO.test(String(r.file))) {
      problems.push(`${key}[${i}]: file must be a relative path to a .jpg, .png or .webp inside the corpus (HEIC is refused)`);
      ok = false;
    } else {
      const file = normalize(String(r.file));
      if (photoFiles.has(file)) problems.push(`${key}[${i}]: ${file} is already ${photoFiles.get(file)}'s photo`);
      photoFiles.set(file, String(id));
    }
    if (typeof r.licence !== "string" || !r.licence.trim()) {
      problems.push(`${key}[${i}]: licence is required (where the photo comes from, and why it may be sent to OpenAI)`);
      ok = false;
    }
    const notes = cleanNotes(r.notes);
    if (!notes.ok) {
      problems.push(`${key}[${i}]: notes ${notes.why === "too_long" ? `longer than ${SET_PHOTO_NOTES_MAX_CHARS} characters (the form stops there)` : "must be text"}`);
      ok = false;
    }
    if (!ok || !id || !notes.ok) return null;
    return { id, file: normalize(String(r.file)), notes: notes.notes, licence: String(r.licence), template: isTemplateRow(r) };
  };

  const loc = rows("locationPhotos");
  if (loc) {
    loc.forEach((r, i) => {
      if (!(CATEGORIES as readonly string[]).includes(String(r.category))) problems.push(`locationPhotos[${i}]: category must be ${CATEGORIES.join(" | ")}`);
      const row = photoRow("locationPhotos", r, i);
      if (row && (CATEGORIES as readonly string[]).includes(String(r.category))) data.locationPhotos.push({ ...row, category: r.category as Category });
    });
    const n = data.locationPhotos.length;
    const short = CATEGORIES.filter((c) => data.locationPhotos.filter((p) => p.category === c).length < LOCATION_PHOTOS_PER_CATEGORY_MIN);
    count("locationPhotos", n, `${LOCATION_PHOTOS_WANTED}, at least ${LOCATION_PHOTOS_PER_CATEGORY_MIN} of each category${short.length ? ` (short: ${short.join(", ")})` : ""}`, n === LOCATION_PHOTOS_WANTED && short.length === 0);
  }

  const ppl = rows("peoplePhotos");
  if (ppl) {
    ppl.forEach((r, i) => {
      const consent = isRecord(r.consent) ? r.consent : null;
      const kind = consent?.kind;
      if (kind !== "ai-generated" && kind !== "consented") problems.push(`peoplePhotos[${i}]: consent.kind must be ai-generated or consented`);
      if (typeof consent?.confirmedBy !== "string" || !consent.confirmedBy.trim()) problems.push(`peoplePhotos[${i}]: consent.confirmedBy (who confirmed it) is required`);
      const on = typeof consent?.confirmedOn === "string" ? consent.confirmedOn : null;
      if (kind === "consented" && (on === null || !DATE.test(on))) problems.push(`peoplePhotos[${i}]: consented people need consent.confirmedOn (YYYY-MM-DD)`);
      const row = photoRow("peoplePhotos", r, i);
      if (row && (kind === "ai-generated" || kind === "consented")) {
        data.peoplePhotos.push({ ...row, consent: { kind, confirmedBy: String(consent?.confirmedBy ?? ""), confirmedOn: on } });
      }
    });
    count("peoplePhotos", data.peoplePhotos.length, String(PEOPLE_PHOTOS_WANTED), data.peoplePhotos.length === PEOPLE_PHOTOS_WANTED);
  }

  // baselines.json (optional; an operator's read-only export)
  const b = files.baselines;
  if (b !== undefined && b !== null) {
    hashes.baselines = sha256(canonicalJson(b));
    if (!isRecord(b)) problems.push("baselines: must be an object");
    else {
      const out: Baselines = { identity: [], outputGateStrictLane: null };
      if (b._template === true) template = true;
      for (const [i, row] of (Array.isArray(b.identity) ? b.identity : []).entries()) {
        if (!isRecord(row) || typeof row.characterId !== "string" || typeof row.engine !== "string" || !Array.isArray(row.scores) || typeof row.source !== "string" || typeof row.readOn !== "string") {
          problems.push(`baselines.identity[${i}]: needs characterId, engine, scores, source, readOn`);
          continue;
        }
        const scores = row.scores.filter((s): s is number => typeof s === "number" && s >= 0 && s <= 100);
        if (scores.length !== row.scores.length) problems.push(`baselines.identity[${i}]: scores are numbers 0–100`);
        out.identity.push({ characterId: row.characterId, engine: row.engine, scores, source: row.source, readOn: row.readOn });
      }
      const g = b.outputGateStrictLane;
      if (isRecord(g)) {
        const renders = Number(g.renders);
        const refusals = Number(g.refusals);
        if (!Number.isInteger(renders) || !Number.isInteger(refusals) || renders < 0 || refusals < 0 || refusals > renders || typeof g.source !== "string" || typeof g.readOn !== "string") {
          problems.push("baselines.outputGateStrictLane: needs whole renders ≥ refusals ≥ 0, window, source, readOn");
        } else out.outputGateStrictLane = { renders, refusals, window: String(g.window ?? ""), source: g.source, readOn: g.readOn };
      }
      data.baselines = out;
    }
  }

  const corpusHash = sha256(canonicalJson(hashes));
  return { ok: problems.length === 0, problems, warnings, template, data, hashes, corpusHash };
}

/** sha256 of the canary rows as used (ids and cleaned briefs): the canary history's key. */
export function canarySha(rows: readonly CanaryRow[]): string {
  return sha256(canonicalJson(rows.map((r) => ({ id: r.id, brief: r.brief }))));
}

export function loadCorpus(dir: string, o: { spend: boolean; allowPartial: boolean; needs: CorpusNeeds; photos?: boolean }): CorpusCheck {
  const read = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));
  const corpusPath = join(dir, "corpus.json");
  if (!existsSync(corpusPath)) {
    const missing = validateCorpus({ corpus: null }, o);
    missing.problems.unshift(`no corpus.json in ${dir}`);
    missing.ok = false;
    return missing;
  }
  const files: { corpus: unknown } & Partial<Record<FileKey, unknown>> = { corpus: null };
  const unreadable: string[] = [];
  try {
    files.corpus = read(corpusPath);
  } catch (e) {
    unreadable.push(`corpus.json: ${e instanceof Error ? e.message : String(e)}`);
  }
  const map = isRecord(files.corpus) && isRecord(files.corpus.files) ? files.corpus.files : {};
  for (const key of FILE_KEYS) {
    const name = map[key];
    if (typeof name !== "string") continue;
    if (!safeRelative(name)) {
      unreadable.push(`corpus.json files.${key}: must be a relative path inside the corpus`);
      continue;
    }
    const p = join(dir, name);
    if (!existsSync(p)) continue;
    try {
      files[key] = read(p);
    } catch (e) {
      unreadable.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const check = validateCorpus(files, o);
  check.problems.unshift(...unreadable);
  // Every listed picture, hashed into the corpus hash: a changed photo is a
  // changed corpus (--resume and B refuse it). A missing one is a problem
  // only where a real run needs it.
  for (const [key, list] of [
    ["locationPhotos", check.data.locationPhotos],
    ["peoplePhotos", check.data.peoplePhotos],
  ] as const) {
    for (const p of list) {
      const path = join(dir, p.file);
      const need = o.spend && o.needs[key] === true;
      if (!existsSync(path)) {
        const msg = `${key}: ${p.id}'s photo ${p.file} is missing`;
        if (need) check.problems.push(msg);
        else check.warnings.push(msg);
        continue;
      }
      if (statSync(path).size > SET_PHOTO_MAX_FILE_BYTES) {
        check.problems.push(`${key}: ${p.id}'s photo is over ${SET_PHOTO_MAX_FILE_BYTES / 1024 / 1024} MB (the browser refuses it)`);
        continue;
      }
      check.hashes[`photo:${p.file}`] = sha256(readFileSync(path));
    }
  }
  check.corpusHash = sha256(canonicalJson(check.hashes));
  if (o.photos) {
    for (const ch of check.data.characters) {
      if (ch.identityPhoto && !existsSync(join(dir, ch.identityPhoto))) {
        const msg = `characters: ${ch.id}'s identity photo ${ch.identityPhoto} is missing`;
        if (o.spend) check.problems.push(msg);
        else check.warnings.push(msg);
      }
    }
  }
  check.ok = check.problems.length === 0;
  return check;
}

export function corpusSummary(check: CorpusCheck): string {
  const d = check.data;
  const lines = [
    `--- corpus ---`,
    `  hash ${check.corpusHash.slice(0, 16)}…  attested: ${d.meta.attested ? "yes" : "NO"}  written by ${d.meta.writtenBy || "?"} on ${d.meta.writtenOn || "?"}`,
    `  briefs ${d.briefs.length} (${CATEGORIES.map((c) => `${c} ${d.briefs.filter((b) => b.category === c).length}`).join(", ")}), adversarial ${d.adversarial.length}, directions ${d.directions.length}, characters ${d.characters.length}, canary ${d.canary.length}, match ${d.match.length}, baselines ${d.baselines ? "yes" : "none"}`,
    `  location photos ${d.locationPhotos.length} (${CATEGORIES.map((c) => `${c} ${d.locationPhotos.filter((p) => p.category === c).length}`).join(", ")}), photos with people ${d.peoplePhotos.length}`,
  ];
  if (check.template) lines.push("  *** TEMPLATE CORPUS: FORMAT-ONLY rows. Fine for a dry run; --spend refuses them. ***");
  for (const w of check.warnings) lines.push(`  warning: ${w}`);
  for (const p of check.problems) lines.push(`  PROBLEM: ${p}`);
  return lines.join("\n");
}
