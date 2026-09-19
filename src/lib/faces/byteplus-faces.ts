// BytePlus's real-person verification and asset library (2026-09-19) — the
// route ByteDance sanctions for putting a real person's face into Seedance.
// Server only. Shapes transcribed from the API reference the same day:
// CreateVisualValidateSession, GetVisualValidateResult, CreateAsset,
// GetAsset, DeleteAsset, DeleteAssetGroup, ListAssetGroups.
//
// Every call is signed with an ACCESS KEY PAIR (signer.ts), not the Bearer
// key the Seedance lane uses: BYTEPLUS_ACCESS_KEY_ID / BYTEPLUS_SECRET_ACCESS_KEY,
// created under IAM → Access keys, ideally on a sub-account holding
// ArkFullAccess for the project (BytePlus's own advice). Without them the
// feature says it is not configured and nothing is sent.
//
// Responses arrive as { ResponseMetadata, Result }, and a refusal as
// ResponseMetadata.Error { Code, Message } — sometimes with a 200.

import { fetchWithTimeout } from "@/lib/generations/providers/fetch-with-timeout";
import { signOpenApiRequest } from "@/lib/faces/signer";

export class FaceApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FaceApiError";
  }
}

function keys(): { accessKeyId: string; secretAccessKey: string } | null {
  const accessKeyId = process.env.BYTEPLUS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.BYTEPLUS_SECRET_ACCESS_KEY?.trim();
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null;
}

/** Whether the access key pair the face calls are signed with is present. */
export function faceApiConfigured(): boolean {
  return keys() !== null;
}

type Envelope<T> = {
  ResponseMetadata?: { RequestId?: string; Error?: { Code?: string; Message?: string } };
  Result?: T;
};

async function call<T>(action: string, body: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
  const k = keys();
  if (!k) throw new FaceApiError("BytePlus access keys are not configured.", "NotConfigured", 0);
  const signed = signOpenApiRequest({ action, body, ...k, now: new Date() });
  const res = await fetchWithTimeout(signed.url, { method: "POST", headers: signed.headers, body: signed.body }, timeoutMs);
  const text = await res.text();
  let parsed: Envelope<T> | null = null;
  try {
    parsed = JSON.parse(text) as Envelope<T>;
  } catch {
    // Not JSON: a gateway page. Reported with the status, which is the useful part.
  }
  const error = parsed?.ResponseMetadata?.Error;
  if (!res.ok || error?.Code) {
    const code = error?.Code ?? `HTTP${res.status}`;
    throw new FaceApiError(`BytePlus ${action} error (${res.status}): ${code} ${error?.Message ?? text.slice(0, 300)}`.trim(), code, res.status);
  }
  // The reference prints some examples bare and some wrapped; read either.
  return (parsed?.Result ?? (parsed as unknown)) as T;
}

/** A one-time verification page for one person, and the token that reads its result (30 minutes). */
export async function createVerificationSession(callbackUrl: string): Promise<{ bytedToken: string; h5Link: string }> {
  const r = await call<{ BytedToken?: string; H5Link?: string }>("CreateVisualValidateSession", { CallbackURL: callbackUrl });
  if (!r.BytedToken || !r.H5Link) throw new FaceApiError("BytePlus returned no verification link.", "NoLink", 200);
  return { bytedToken: r.BytedToken, h5Link: r.H5Link };
}

/** The person BytePlus created for a passed verification: their asset group. */
export async function getVerificationGroup(bytedToken: string): Promise<string> {
  const r = await call<{ GroupId?: string }>("GetVisualValidateResult", { BytedToken: bytedToken });
  if (!r.GroupId) throw new FaceApiError("BytePlus returned no asset group for this verification.", "NoGroup", 200);
  return r.GroupId;
}

/** One photo into the person's group. BytePlus compares it to the verified face before it becomes usable. */
export async function createFaceAsset(input: { groupId: string; url: string; name: string }): Promise<string> {
  const r = await call<{ Id?: string }>("CreateAsset", {
    GroupId: input.groupId,
    URL: input.url,
    AssetType: "Image",
    Name: input.name.slice(0, 64),
  });
  if (!r.Id) throw new FaceApiError("BytePlus returned no asset id.", "NoAsset", 200);
  return r.Id;
}

export type FaceAssetState = { status: "Active" | "Processing" | "Failed"; errorCode: string | null; errorMessage: string | null };

export async function getFaceAsset(id: string): Promise<FaceAssetState> {
  const r = await call<{ Status?: string; Error?: { Code?: string; Message?: string } }>("GetAsset", { Id: id }, 10_000);
  const status = r.Status === "Active" || r.Status === "Failed" ? r.Status : "Processing";
  return { status, errorCode: r.Error?.Code ?? null, errorMessage: r.Error?.Message ?? null };
}

export async function deleteFaceAsset(id: string): Promise<void> {
  await call("DeleteAsset", { Id: id });
}

/** The person and every asset of theirs, gone at BytePlus. Irreversible. */
export async function deleteFaceGroup(id: string): Promise<void> {
  await call("DeleteAssetGroup", { Id: id });
}

/** A harmless read, for checking the keys and the entitlement: how many real-person groups exist. */
export async function countFaceGroups(): Promise<number> {
  const r = await call<{ Items?: unknown[]; TotalCount?: number }>("ListAssetGroups", {
    Filter: { GroupType: "LivenessFace" },
    MaxResults: 10,
  });
  return typeof r.TotalCount === "number" ? r.TotalCount : (r.Items?.length ?? 0);
}
