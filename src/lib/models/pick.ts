// The model each switchable job runs on right now: the operator's pick on the
// Models page, else the environment override the job had before the panel,
// else the code's default (registry.ts says which jobs and which models).

import { identityModel, utilityModel } from "@/lib/generations/providers/openai-model";
import { jobModel } from "./controls";
import { jobSlot, type JobKey } from "./registry";

/** Policy, brand-rule and description readers (temperature 0 + seed): gpt-5.4-mini or gpt-5.4. */
export async function readerModel(): Promise<string> {
  return (await jobModel("policy_reader")) ?? utilityModel();
}

/** The second vote at a band edge: always the other of the two readers. */
export async function otherReaderModel(): Promise<string> {
  return (await readerModel()) === "gpt-5.4" ? "gpt-5.4-mini" : "gpt-5.4";
}

/** The face check (identity scorer). */
export async function faceModel(): Promise<string> {
  return (await jobModel("face_check")) ?? identityModel();
}

/** Any other job: its pick, else its default. */
export async function modelForJob(key: Exclude<JobKey, "policy_reader" | "face_check">): Promise<string> {
  return (await jobModel(key)) ?? jobSlot(key)!.default;
}
