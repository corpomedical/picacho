// Catches state read before it exists.
//
// Twice on 2026-08-10 a change to generate-form.tsx referenced a useState
// binding ABOVE the line that declares it. That is a temporal dead zone error
// which throws on every render and takes the whole page down — and neither
// `tsc` nor eslint reports it, because the reference sat inside a callback:
//
//     const selected = videoModels.find((m) => m.id === videoModelId);  // line 1299
//     ...
//     const [videoModelId] = useState(...);                             // line 1355
//
// TypeScript has a use-before-declaration check, but it deliberately doesn't
// apply inside a function body — it can't know whether the function runs now
// or later. `.find()` runs now. So the error only appears at runtime.
//
// This script closes that specific gap: find every useState/useRef binding in
// a file and report any textual reference that occurs before its declaration.
//
// Run: node scripts/check-hook-order.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const HOOK_DECL = /const\s+\[?\s*([A-Za-z_$][\w$]*)/;
const HOOK_LINE = /=\s*(useState|useRef|useMemo|useCallback)\s*[<(]/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(path)) out.push(path);
  }
  return out;
}

// Blanks out string and template contents so a name mentioned inside one —
// searchParams.get("prompt") — isn't mistaken for reading the `prompt`
// binding. Written as a small scanner rather than a regex because escaping a
// correct string-literal regex through two layers of quoting is exactly the
// kind of thing that silently half-works.
function stripStrings(line) {
  let out = "";
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) { quote = null; out += '""'; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    out += ch;
  }
  return out;
}

let problems = 0;

for (const file of walk(ROOT)) {
  const lines = readFileSync(file, "utf8").split("\n");

  // Split the file into top-level function bodies first.
  //
  // Without this the check compares a name used in one component against a
  // same-named binding in another component further down the same file, and
  // reports nonsense. generate-form.tsx alone defines a dozen helper
  // components that each have their own `contentType`, `prompt`, `items`.
  // Four false positives out of five findings is a tool nobody runs.
  const starts = [];
  lines.forEach((line, i) => {
    if (/^(export\s+)?(async\s+)?function\s/.test(line)) starts.push(i);
  });
  starts.push(lines.length);

  for (let b = 0; b < starts.length - 1; b++) {
    const from = starts[b];
    const to = starts[b + 1];
    const body = lines.slice(from, to);

    const declaredAt = new Map();
    body.forEach((line, i) => {
      if (!HOOK_LINE.test(line)) return;
      const match = line.match(HOOK_DECL);
      if (match) declaredAt.set(match[1], i);
    });

    for (const [name, declLine] of declaredAt) {
      // Not preceded by a dot: `t.notes` is a property, not a read of the
      // `notes` binding. And string contents are stripped first, so
      // searchParams.get("prompt") doesn't look like a read of `prompt`.
      const usage = new RegExp(`(^|[^.\\w$])${name}\\b`);
      for (let i = 0; i < declLine; i++) {
        const line = stripStrings(body[i]);
        if (/^\s*(\/\/|\*|\/\*|import\b)/.test(line)) continue;
        if (!usage.test(line)) continue;
        // Only component-body statements, which is where it actually throws.
        if (!/^ {2}(const|let|return|if|\{)/.test(line)) continue;
        console.error(
          `${file}:${from + i + 1}  reads "${name}" but it is declared at line ${from + declLine + 1}`,
        );
        problems++;
        break;
      }
    }
  }
}

console.log(problems === 0 ? "hook order: clean" : `hook order: ${problems} problem(s)`);
process.exit(problems > 0 ? 1 : 0);
