// Director's Cut v2 — one-time (and re-runnable) setup of the Managed Agent
// that edits: HeyGen's HyperFrames skills uploaded as custom skills, the
// sandbox environment, and the agent itself.
//
//   node --env-file=.env.local scripts/directors-cut-setup.mts <hyperframes-repo>/skills [state.json]
//
// <hyperframes-repo> is a checkout of github.com/heygen-com/hyperframes at the
// tag matching HYPERFRAMES_VERSION (git clone --depth 1 --branch v0.8.72 …).
// state.json keeps the ids between runs: skills are uploaded once (a re-run
// adds a new version only with --refresh-skills), the environment is created
// once, and the agent is UPDATED in place when it exists (a new version; open
// sessions keep the version they started on). Prints the two ids Vercel needs:
// DIRECTORS_CUT_AGENT_ID and DIRECTORS_CUT_ENVIRONMENT_ID.

import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  AGENT_EFFORT,
  AGENT_MODEL,
  AGENT_NAME,
  AGENT_SKILLS,
  AGENT_SYSTEM,
  HYPERFRAMES_VERSION,
} from "../src/lib/editor/agent-prompt.ts";

type State = { skills: Record<string, string>; environment?: string; agent?: string };

const [skillsDir, statePath = "directors-cut-state.json"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const refreshSkills = process.argv.includes("--refresh-skills");
if (!skillsDir || !existsSync(skillsDir)) {
  console.error("usage: node --env-file=.env.local scripts/directors-cut-setup.mts <hyperframes-repo>/skills [state.json] [--refresh-skills]");
  process.exit(1);
}
const state: State = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { skills: {} };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
// The agent is created in this key's workspace, and the live site must call it
// with a key from the same one (src/lib/editor/agent.ts editorApiKey).
const client = new Anthropic({ apiKey: process.env.DIRECTORS_CUT_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY });

function filesUnder(root: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(root, rel))) {
    const r = path.join(rel, name);
    if (statSync(path.join(root, r)).isDirectory()) out.push(...filesUnder(root, r));
    else if (!/\.test\.(m?js|ts)$/.test(name)) out.push(r);
  }
  return out;
}

/**
 * The Skills API reads SKILL.md's frontmatter without YAML's folded/literal
 * block forms: `description: >` arrives as the bare ">" and is refused as an
 * XML tag (400, 2026-09-25). Same words, one plain quoted line.
 */
function flattenFrontmatter(text: string): string {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return text;
  const lines = m[1].split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const block = /^(\w[\w-]*):\s*[>|][-+]?\s*$/.exec(lines[i]);
    if (!block) {
      out.push(lines[i]);
      continue;
    }
    const parts: string[] = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
      parts.push(lines[++i].trim());
    }
    out.push(`${block[1]}: ${JSON.stringify(parts.filter(Boolean).join(" "))}`);
  }
  // Element names in a description (hyperframes-audio names `<hf-audio-group>`)
  // read as XML tags to the API: written as plain words instead.
  const header = out.map((line) =>
    /^description:/.test(line) ? line.replace(/<\/?([a-zA-Z][\w-]*)[^>]*>/g, "$1 element") : line,
  );
  return `---\n${header.join("\n")}\n---\n${text.slice(m[0].length)}`;
}

// 1. Skills — each folder uploaded whole (SKILL.md at its root, scripts and references beside it).
for (const name of AGENT_SKILLS) {
  if (state.skills[name] && !refreshSkills) continue;
  const dir = path.join(skillsDir, name);
  if (!existsSync(path.join(dir, "SKILL.md"))) throw new Error(`no ${name}/SKILL.md under ${skillsDir}`);
  const files = await Promise.all(
    filesUnder(dir).map((rel) => {
      const bytes = readFileSync(path.join(dir, rel));
      const body = rel === "SKILL.md" ? Buffer.from(flattenFrontmatter(bytes.toString("utf8"))) : bytes;
      return toFile(body, `${name}/${rel.split(path.sep).join("/")}`);
    }),
  );
  if (state.skills[name]) {
    await client.skills.versions.create(state.skills[name], { files });
    console.log(`skill ${name}: new version`);
  } else {
    const skill = await client.skills.create({ files, display_name: `hyperframes ${HYPERFRAMES_VERSION}: ${name}` });
    state.skills[name] = skill.id;
    console.log(`skill ${name}: ${skill.id} (${files.length} files)`);
  }
  save();
}

// 2. Environment — HyperFrames at the pinned version; the beat-grid script's Python packages.
// Networking is unrestricted while the editor is admins-only: the agent needs npm, jsdelivr,
// the HyperFrames registry, the Chrome download host and our storage's signed URLs.
// Before it opens to plans this becomes `limited` with those hosts listed.
if (!state.environment) {
  const environment = await client.beta.environments.create({
    name: "picacho-directors-cut",
    config: {
      type: "cloud",
      networking: { type: "unrestricted" },
      packages: { npm: [`hyperframes@${HYPERFRAMES_VERSION}`], pip: ["librosa", "numpy", "soundfile"] },
    },
  });
  state.environment = environment.id;
  save();
  console.log(`environment: ${environment.id}`);
}

// 3. The agent — created once, updated in place after that.
const agentBody = {
  name: AGENT_NAME,
  model: { id: AGENT_MODEL, effort: AGENT_EFFORT },
  system: AGENT_SYSTEM,
  tools: [{ type: "agent_toolset_20260401" as const, default_config: { enabled: true }, configs: [{ name: "web_search" as const, enabled: false }] }],
  skills: AGENT_SKILLS.map((name) => ({ type: "custom" as const, skill_id: state.skills[name], version: "latest" })),
};
if (state.agent) {
  const current = await client.beta.agents.retrieve(state.agent);
  const updated = await client.beta.agents.update(state.agent, { ...agentBody, version: current.version });
  console.log(`agent: ${updated.id} updated to version ${updated.version}`);
} else {
  const agent = await client.beta.agents.create(agentBody);
  state.agent = agent.id;
  save();
  console.log(`agent: ${agent.id} version ${agent.version}`);
}

console.log("\nFor Vercel:");
console.log(`DIRECTORS_CUT_AGENT_ID=${state.agent}`);
console.log(`DIRECTORS_CUT_ENVIRONMENT_ID=${state.environment}`);
