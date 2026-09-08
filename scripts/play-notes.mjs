#!/usr/bin/env node
// Play Console release notes, straight from docs/PLAY_RELEASE_NOTES.md.
//
// Play's "What's new" field takes EVERY language in one paste when each is
// wrapped in its listing tag — <en-US>…</en-US><es-419>…</es-419> — and
// splits them itself. So the doc keeps one fenced block per release in that
// exact shape, and the normal move is one copy:
//
//   node scripts/play-notes.mjs            the whole block on the clipboard,
//                                          plus per-language counts
//   node scripts/play-notes.mjs --print    print it instead of copying
//   node scripts/play-notes.mjs es-419     one language only, bare text
//
// It always reads the TOP versionCode section of the doc, so the newest
// release is what you get and the two can never drift.
//
// Until 2026-09-08 this expected a "### <tag>" heading per language and
// copied them one at a time — four trips to the clipboard for a field that
// takes all four at once. The doc changed shape the same day the operator
// rejected the four-trip version, and this followed.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const LIMIT = 500; // Play's hard cap, per language.
const DOC = "docs/PLAY_RELEASE_NOTES.md";
const SELF = "scripts/play-notes.mjs";

const doc = readFileSync(DOC, "utf8");
const section = doc.split(/^## versionCode /m)[1];
if (!section) {
  console.error(`No "## versionCode" section found in ${DOC}.`);
  process.exit(1);
}
const release = section.split("\n")[0].trim();

// The first fenced block in the section is the paste. Anything after it —
// European variants, notes — is reference, not the release.
const fence = section.match(/^```\n([\s\S]*?)\n```/m);
if (!fence) {
  console.error(`No fenced block found under versionCode ${release}.`);
  process.exit(1);
}
const block = fence[1];

const notes = [...block.matchAll(/<([a-z]{2}-[A-Za-z0-9]{2,3})>\n([\s\S]*?)\n<\/\1>/g)].map(
  ([, lang, body]) => ({ lang, body }),
);
if (notes.length === 0) {
  console.error(
    `The block under versionCode ${release} has no <xx-YY>…</xx-YY> sections. ` +
      "Release notes are written in Play's tag format — see the header of " + DOC + ".",
  );
  process.exit(1);
}

const copy = (text) => spawnSync("pbcopy", { input: text }).status === 0;
const over = notes.filter((n) => n.body.length > LIMIT);

const report = () => {
  console.log(`\nversionCode ${release} — ${notes.length} languages in one paste\n`);
  for (const { lang, body } of notes) {
    const flag = body.length > LIMIT ? `OVER by ${body.length - LIMIT}` : "ok";
    console.log(`  ${lang.padEnd(7)} ${String(body.length).padStart(3)}/${LIMIT}  ${flag}`);
  }
  console.log("");
};

const [arg] = process.argv.slice(2);

if (!arg || arg === "--print") {
  report();
  if (arg === "--print") {
    console.log(block + "\n");
  } else if (copy(block)) {
    console.log("The whole block is on the clipboard. Paste it once into What's new.\n");
  } else {
    console.error("pbcopy failed — is this macOS? Use --print instead.");
    process.exit(1);
  }
  // Warn rather than exit: a note over the limit is still worth having, and
  // Play will tell you too — but better to hear it here than after pasting.
  process.exit(over.length ? 1 : 0);
}

const match = notes.find((n) => n.lang.toLowerCase() === arg.toLowerCase());
if (!match) {
  console.error(`No "${arg}". Available: ${notes.map((n) => n.lang).join(", ")}, --print`);
  process.exit(1);
}
if (!copy(match.body)) {
  console.error("pbcopy failed — is this macOS?");
  process.exit(1);
}
console.log(`${match.lang} on the clipboard — ${match.body.length}/${LIMIT} chars. (Bare text; the usual paste is the whole block: node ${SELF})`);
