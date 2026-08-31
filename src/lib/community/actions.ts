"use server";

import { createClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";

// Community feed actions — thin wrappers over the SQL in
// supabase/pending-2026-08-21/community.sql. Sharing and reporting go
// through SECURITY DEFINER functions (the definer is where the ownership
// and validity checks live); hearts, unshare and moderation ride plain RLS
// with the caller's own session. Nothing here touches the service role.

export async function shareToCommunity(
  generationId: string,
  caption: string,
): Promise<{ error: string | null; postId: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again.", postId: null };

  const { data, error } = await supabase.rpc("share_to_community", {
    p_generation_id: generationId,
    p_caption: caption.trim().slice(0, 200) || null,
  });
  if (error) {
    console.error("shareToCommunity failed:", error.message);
    // The definer raises human-readable messages; surface them.
    return { error: error.message.replace(/^.*Exception: /, ""), postId: null };
  }
  return { error: null, postId: (data as string | null) ?? null };
}

export async function unshareFromCommunity(generationId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const { error } = await supabase
    .from("community_posts")
    .delete()
    .eq("generation_id", generationId)
    .eq("user_id", userData.user.id);
  if (error) {
    console.error("unshareFromCommunity failed:", error.message);
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

  const { error } = await supabase
    .from("community_posts")
    .update({ hidden_at: hidden ? new Date().toISOString() : null })
    .eq("id", postId);
  if (error) {
    console.error("setCommunityPostHidden failed:", error.message);
    return { error: "Couldn't update this post." };
  }
  return { error: null };
}
