// What /api/edit-project/<token>/<path> answers (project.ts explains why the
// preview frame loads the project from here). The token names one edit and one
// delivered video; the path is a file of that video's project, or one of the
// edit's clips as footage/clip-N.<ext>.
//
//   *.html → served from here, with the preview's own narrow policy
//            (index.html?draft=1 is the editor's unsaved working copy);
//   the rest → a short-lived redirect to the stored object.
//
// No session cookie is involved: the frame is sandboxed to an opaque origin,
// which sends none, so the token is the whole key — and it only ever opens
// what that one video is made of.

import type { SupabaseClient } from "@supabase/supabase-js";
import { EDITOR_BUCKET, type ClipRecord, type DeliveryRecord } from "./job";
import { footageIndex, PROJECT_DRAFT, PROJECT_ENTRY, previewCsp, readProjectToken, safeProjectPath, withRuntime } from "./project";
import { HYPERFRAMES_VERSION } from "./agent-prompt";

const REDIRECT_SECONDS = 60 * 60;

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function serveProjectFile(
  token: string,
  pathParts: string[],
  search: URLSearchParams,
  deps: { admin: SupabaseClient; supabaseOrigin: string | null; now?: number },
): Promise<Response> {
  const who = readProjectToken(token, deps.now);
  if (!who) return notFound();
  const rel = safeProjectPath(Array.isArray(pathParts) ? pathParts.join("/") : "");
  if (!rel) return notFound();

  const { data: row } = await deps.admin
    .from("video_edits")
    .select("id, clips, plan")
    .eq("id", who.editId)
    .maybeSingle<{ id: string; clips: ClipRecord[]; plan: DeliveryRecord | null }>();
  const project = row?.plan?.outputs?.find((o) => o.generationId === who.generationId)?.project;
  if (!row || !project) return notFound();

  const clip = footageIndex(rel);
  const stored = clip !== null ? row.clips?.[clip]?.path : `${project.dir}/${rel}`;
  if (!stored) return notFound();

  if (clip === null && rel.toLowerCase().endsWith(".html")) {
    const tryPaths = rel === PROJECT_ENTRY && search.get("draft") === "1" ? [`${project.dir}/${PROJECT_DRAFT}`, stored] : [stored];
    for (const p of tryPaths) {
      const { data } = await deps.admin.storage.from(EDITOR_BUCKET).download(p);
      if (!data) continue;
      // The page the frame plays gets the runtime (project.ts withRuntime); a sub-composition the runtime fetches does not.
      const text = await data.text();
      return new Response(rel === PROJECT_ENTRY ? withRuntime(text, HYPERFRAMES_VERSION) : text, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": previewCsp(deps.supabaseOrigin),
          "X-Frame-Options": "SAMEORIGIN",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
          "Cache-Control": "private, no-store",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
    return notFound();
  }

  const { data: signed } = await deps.admin.storage.from(EDITOR_BUCKET).createSignedUrl(stored, REDIRECT_SECONDS);
  if (!signed?.signedUrl) return notFound();
  return new Response(null, {
    status: 302,
    headers: {
      Location: signed.signedUrl,
      "Cache-Control": "private, max-age=600",
      "Referrer-Policy": "no-referrer",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
