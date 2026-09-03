#!/usr/bin/env node
// Play Console release notes, straight from docs/PLAY_RELEASE_NOTES.md.
//
// Play's "What's new" field takes one language at a time, so pasting a release
// means four trips to the clipboard. This does the fetching:
//
//   node scripts/play-notes.mjs            print every language, with counts
//   node scripts/play-notes.mjs es-ES      put that one on the clipboard
//   node scripts/play-notes.mjs --all      copy each in turn, Enter between
//
// It always reads the TOP versionCode section of the doc, so the newest
// release is what you get and the two can never drift.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

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

// Each language is a "### <tag>" heading followed by one fenced block.
const notes = [...section.matchAll(/^### (\S+)\n\n```\n([\s\S]*?)\n```/gm)].map(
  ([, lang, body]) => ({ lang, body }),
);
if (notes.length === 0) {
  console.error(`No language blocks found under versionCode ${release}.`);
  process.exit(1);
}

const copy = (text) => spawnSync("pbcopy", { input: text }).status === 0;

// Warn rather than exit: a note over the limit is still worth printing, and
// Play will tell you too — but better to hear it here than after pasting.
const over = notes.filter((n) => n.body.length > LIMIT);

const [arg] = process.argv.slice(2);

if (!arg) {
  console.log(`\nversionCode ${release} — ${notes.length} languages\n`);
  for (const { lang, body } of notes) {
    const flag = body.length > LIMIT ? `OVER by ${body.length - LIMIT}` : "ok";
    console.log(`${"─".repeat(72)}\n${lang}  ·  ${body.length}/${LIMIT} chars  ·  ${flag}\n`);
    console.log(body + "\n");
  }
  console.log("─".repeat(72));
  console.log(`\nTo copy one:  node ${SELF} ${notes[0].lang}`);
  console.log(`All in turn:  node ${SELF} --all\n`);
  process.exit(over.length ? 1 : 0);
}

if (arg === "--all") {
  // Needs a terminal to pace itself. Piped or redirected, readline's question()
  // never settles once stdin ends and the process hangs on an unsettled await —
  // so say what to do instead of stalling.
  if (!process.stdin.isTTY) {
    console.error("--all needs an interactive terminal. Copy one at a time instead:");
    for (const { lang } of notes) console.error(`  node ${SELF} ${lang}`);
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (const [i, { lang, body }] of notes.entries()) {
    if (!copy(body)) {
      console.error("pbcopy failed — is this macOS?");
      process.exit(1);
    }
    console.log(`\n[${i + 1}/${notes.length}] ${lang} is on the clipboard (${body.length} chars).`);
    console.log("Paste it into Play Console, then press Enter here.");
    if (i < notes.length - 1) await rl.question("");
  }
  rl.close();
  console.log("\nAll four pasted. Nothing left on the clipboard worth keeping.\n");
  process.exit(0);
}

const match = notes.find((n) => n.lang.toLowerCase() === arg.toLowerCase());
if (!match) {
  console.error(`No "${arg}". Available: ${notes.map((n) => n.lang).join(", ")}`);
  process.exit(1);
}
if (!copy(match.body)) {
  console.error("pbcopy failed — is this macOS?");
  process.exit(1);
}
console.log(`${match.lang} on the clipboard — ${match.body.length}/${LIMIT} chars.`);
