// Update ONLY the standing instructions of the live editing agent (Director's
// Cut and Effects share it) from src/lib/editor/agent-prompt.ts — no skill
// uploads, no environment, no state file (directors-cut-setup.mts needs the
// HyperFrames skills folder and its state file; this needs neither). The
// agent gets a new version; sessions already running keep the one they
// started on.
//
//   node --env-file=.env.local scripts/directors-cut-system.mts          (shows what would change)
//   node --env-file=.env.local scripts/directors-cut-system.mts --apply  (updates the agent)

import Anthropic from "@anthropic-ai/sdk";
import { AGENT_SYSTEM } from "../src/lib/editor/agent-prompt.ts";

const agentId = process.env.DIRECTORS_CUT_AGENT_ID;
const apiKey = process.env.DIRECTORS_CUT_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!agentId || !apiKey) {
  console.error("needs DIRECTORS_CUT_AGENT_ID and DIRECTORS_CUT_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY)");
  process.exit(1);
}
const client = new Anthropic({ apiKey });
const current = await client.beta.agents.retrieve(agentId);
const before = (current as { system?: string | null }).system ?? "";
console.log(`agent ${current.id} version ${current.version}: instructions ${before.length} → ${AGENT_SYSTEM.length} characters`);
if (before === AGENT_SYSTEM) {
  console.log("already up to date");
  process.exit(0);
}
if (!process.argv.includes("--apply")) {
  console.log("dry run: add --apply to update the agent");
  process.exit(0);
}
const updated = await client.beta.agents.update(agentId, { version: current.version, system: AGENT_SYSTEM });
console.log(`updated to version ${updated.version}`);
