"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { persistGeneratedVideo } from "@/lib/generations/core";
import { recordSignal } from "@/lib/generations/record-signal";
import { judgeRender, OutputPolicyRefusal } from "@/lib/generations/output-policy";
import { recordPolicyRefusal } from "@/lib/generations/policy-log";
import { SHARE_PROMPT_HIDE_FAILED } from "@/lib/community/messages";

// Community feed actions — thin wrappers over the SQL in
// supabase/applied/2026-08-21/community.sql. Sharing and reporting go
// through SECURITY DEFINER functions (the definer is where the ownership
// and validity checks live); hearts, unshare and moderation ride plain RLS
// with the caller's own session. Nothing here touches the service role.

export async function shareToCommunity(
  generationId: string,
  caption: string,
  // The share sheet asks whether the prompt goes public with the post
  // (2026-09-11). Defaults to the old behaviour for any caller that does
  // not ask.
  includePrompt: boolean = true,
): Promise<{ error: string | null; postId: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again.", postId: null };
  // A share now costs a picture read (below); the same guard the report
  // action carries, so a held-down button cannot run up a bill.
  if (await rateLimited(userData.user.id, "community-share", 60, 10)) {
    return { error: "That's a lot of sharing at once — give it a minute.", postId: null };
  }

  // The RPC snapshots the generation's media url into the post FOREVER, and
  // a video row can still hold a raw provider-CDN url: pre-2026-09-04 rows
  // were backfilled, but the live persist path falls back to the provider on
  // any failure (the Free-plan 50MB storage cap included). Snapshotting that
  // bakes a link with no persistence promise into the public feed, where it
  // eventually dies for every viewer and nothing ever re-derives it. Move
  // the file into our bucket first; if the copy fails, share what exists
  // today rather than blocking the share.
  const { data: gen } = await supabase
    .from("generations")
    .select("result_url, content_type, poster_url, status, deleted_at")
    .eq("id", generationId)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  // THE FEED GATE (operator, 2026-09-10). The feed is the surface a Play
  // reviewer opens first, and the User Generated Content policy holds it to
  // its own standard, so a post is judged again here — on the picture as it
  // will be shown, in the STRICT lane whatever lane rendered it. A video is
  // judged by its poster, which already exists; only a video with no poster
  // pays for a frame extraction. A refusal is not a verdict on the render
  // (which passed its own gate and stays in History): it says this one is
  // not going on the public feed.
  //
  // Only a live, finished render is judged: anything else the definer
  // refuses on its own terms a moment later, and paying two model reads
  // first would be waste. A video is judged by its poster, and a video
  // whose poster has not been written yet (the reconcile cron backfills
  // them hourly) is asked to wait rather than sent through a frame
  // extraction inside a server action.
  if (gen?.result_url && gen.status === "succeeded" && !gen.deleted_at) {
    if (gen.content_type === "video" && !gen.poster_url) {
      return { error: "This video's preview isn't ready yet — try sharing it again in a few minutes.", postId: null };
    }
    const url = gen.content_type === "video" ? (gen.poster_url as string) : gen.result_url;
    try {
      await judgeRender({ url, kind: "image", strictLane: true });
    } catch (err) {
      if (!(err instanceof OutputPolicyRefusal)) throw err;
      await recordPolicyRefusal({
        userId: userData.user.id,
        gate: "feed",
        reason: err.reason,
        strictLane: true,
        generationId,
        bands: err.readings,
      });
      return {
        error:
          err.reason === "unavailable"
            ? "We couldn't check this picture, so it wasn't shared. Try again in a moment; if it keeps happening, the file may be missing."
            : "This one can't go on the community feed. It stays in your History.",
        postId: null,
      };
    }
  }

  if (
    gen?.content_type === "video" &&
    typeof gen.result_url === "string" &&
    /^https?:\/\//.test(gen.result_url)
  ) {
    const admin = createAdminClient();
    const persisted = await persistGeneratedVideo(admin, userData.user.id, gen.result_url);
    if (persisted) {
      const { error: repointError } = await admin
        .from("generations")
        .update({ result_url: persisted })
        .eq("id", generationId)
        .eq("user_id", userData.user.id);
      if (repointError) {
        // The RPC below would then snapshot the old url — log loudly, the
        // share itself still goes through.
        console.error("shareToCommunity couldn't repoint the persisted video:", repointError.message);
      }
    }
  }

  // The prompt choice rides INTO the definer, so a declined prompt is never
  // written (2026-09-11 review: inserting it and stripping it in a second
  // request left it readable in between, and public for good if the strip
  // failed). The parameter is sent only when the answer is no: a yes works
  // against the old function too.
  const { data, error } = await supabase.rpc("share_to_community", {
    p_generation_id: generationId,
    p_caption: caption.trim().slice(0, 200) || null,
    ...(includePrompt ? {} : { p_include_prompt: false }),
  });
  if (error && !includePrompt && (error.code === "PGRST202" || /could not find the function/i.test(error.message))) {
    // The three-argument function is not deployed yet (pending
    // community-privacy.sql). Nothing was inserted; say so rather than
    // publishing the prompt the person declined.
    return { error: SHARE_PROMPT_HIDE_FAILED, postId: null };
  }
  if (error) {
    console.error("shareToCommunity failed:", error.message);
    // The definer raises human-readable messages; surface them.
    return { error: error.message.replace(/^.*Exception: /, ""), postId: null };
  }
  // Publishing a render under your own name is the strongest keep signal the
  // product collects — stronger than a download, because it is public. After
  // the RPC succeeded, and fail-soft, so research data can never break a share.
  await recordSignal(generationId, userData.user.id, "shared");

  return { error: null, postId: (data as string | null) ?? null };
}

export async function unshareFromCommunity(generationId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const { data: removed, error } = await supabase
    .from("community_posts")
    .delete()
    .eq("generation_id", generationId)
    .eq("user_id", userData.user.id)
    .select("id");
  if (error || !removed?.length) {
    // Zero rows is not success: RLS lets an owner remove only a post that
    // moderation has not hidden, and a delete that matched nothing must not
    // tell the person it is gone (2026-09-11 review).
    if (error) console.error("unshareFromCommunity failed:", error.message);
    return { error: "Couldn't remove this from the community — try again." };
  }
  return { error: null };
}

export async function setCommunityHeart(postId: string, on: boolean): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  if (on) {
    const { error } = await supabase
      .from("community_hearts")
      .upsert({ post_id: postId, user_id: userData.user.id }, { onConflict: "post_id,user_id", ignoreDuplicates: true });
    if (error) return { error: "Couldn't save that — try again." };
  } else {
    const { error } = await supabase
      .from("community_hearts")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", userData.user.id);
    if (error) return { error: "Couldn't save that — try again." };
  }
  return { error: null };
}

export async function recordCommunityView(postId: string): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.rpc("record_community_view", { p_post_id: postId });
  } catch {
    // A lost view count is not worth an error anywhere.
  }
}

export async function reportCommunityPost(
  postId: string,
  reason: string,
  details: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  // Ten reports a minute is plenty for a human and a wall for a script —
  // this action inserts an admin-queue row per call and had no limiter at
  // all (2026-08-31 inspection). Same fail-closed limiter as uploads.
  if (await rateLimited(userData.user.id, "community-report", 60, 10)) {
    return { error: "You're reporting quickly — give it a moment." };
  }

  const { error } = await supabase.rpc("report_community_post", {
    p_post_id: postId,
    p_reason: reason,
    p_details: details.trim().slice(0, 1000) || null,
  });
  if (error) {
    console.error("reportCommunityPost failed:", error.message);
    return { error: error.message.replace(/^.*Exception: /, "") };
  }
  return { error: null };
}

// Moderation: hide/unhide rides the "Admins moderate posts" RLS policy with
// the admin's own session — a non-admin's update simply matches zero rows.
export async function setCommunityPostHidden(postId: string, hidden: boolean): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  // Moderation is admin-only, and the "Admins moderate posts" policy is what
  // enforces it. But RLS enforces by FILTERING, not by failing: a non-admin
  // caller — a stale admin session, a hand-made request — gets zero rows
  // updated and no error, and this used to answer { error: null } to that.
  // The feed would then flip the eye icon as if the post were hidden while
  // everyone else still saw it. Reading the row back turns "affected nothing"
  // into the failure it is.
  const { data, error } = await supabase
    .from("community_posts")
    .update({ hidden_at: hidden ? new Date().toISOString() : null })
    .eq("id", postId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("setCommunityPostHidden failed:", error.message);
    return { error: "Couldn't update this post." };
  }
  if (!data) return { error: "Couldn't update this post." };
  return { error: null };
}

// ---------------------------------------------------------------------------
// Blocking (2026-09-11) — Play's UGC policy requires it beside reporting.
// One-directional: you stop seeing their posts. Owner-scoped by RLS; the
// author is resolved from the post server-side, so the client never needs
// (or gets) another account's id.
// ---------------------------------------------------------------------------

export async function blockPostAuthor(postId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };
  if (await rateLimited(userData.user.id, "community-block", 60, 20)) {
    return { error: "That's a lot of changes at once — give it a minute." };
  }

  const { data: post } = await supabase
    .from("community_posts")
    .select("user_id, username")
    .eq("id", String(postId))
    .maybeSingle();
  if (!post) return { error: "That post isn't available any more." };
  if (post.user_id === userData.user.id) return { error: "That's your own post." };

  const { error } = await supabase.from("community_blocks").upsert(
    {
      blocker_id: userData.user.id,
      blocked_id: post.user_id,
      blocked_username: post.username ?? null,
    },
    { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true },
  );
  if (error) {
    console.error("blockPostAuthor failed:", error.message);
    return { error: "Couldn't block that account — try again." };
  }
  return { error: null };
}

export async function unblockUser(blockedId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };
  const { error } = await supabase
    .from("community_blocks")
    .delete()
    .eq("blocker_id", userData.user.id)
    .eq("blocked_id", String(blockedId));
  if (error) {
    console.error("unblockUser failed:", error.message);
    return { error: "Couldn't unblock — try again." };
  }
  return { error: null };
}

