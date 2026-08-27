"use server";

import { createClient } from "@/lib/supabase/server";
import { mediaUrl } from "@/lib/media/url";

// Products — the catalog behind Product Studio ("B on A", 2026-08-27).
// A product is a name plus up to three photos and an optional logo. Files
// live in the EXISTING character-references bucket under the owner's own
// folder (${userId}/products/...), the same reuse the outfit slot chose:
// the bucket's owner-folder RLS and the /api/media route already cover it,
// so this feature added no storage SQL at all. Table + RLS:
// supabase/pending-2026-08-27/product-studio.sql.

const MAX_PRODUCT_IMAGES = 3;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export type ProductRecord = {
  id: string;
  name: string;
  images: { path: string; url: string }[];
  logo: { path: string; url: string } | null;
};

function toRecord(row: {
  id: string;
  name: string;
  image_paths: string[] | null;
  logo_path: string | null;
}): ProductRecord {
  return {
    id: row.id,
    name: row.name,
    images: (row.image_paths ?? []).map((path) => ({
      path,
      url: mediaUrl("character-references", path),
    })),
    logo: row.logo_path
      ? { path: row.logo_path, url: mediaUrl("character-references", row.logo_path) }
      : null,
  };
}

export async function listProducts(): Promise<ProductRecord[]> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return [];
  const { data } = await supabase
    .from("products")
    .select("id, name, image_paths, logo_path")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: false });
  return (data ?? []).map(toRecord);
}

type SaveResult = { error: string | null; product?: ProductRecord };

export async function saveProduct(formData: FormData): Promise<SaveResult> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };
  const userId = userData.user.id;

  const id = ((formData.get("id") as string) || "").trim();
  const name = ((formData.get("name") as string) || "").trim().slice(0, 80);
  if (!name) return { error: "Give the product a name first." };

  // Photos the client kept from the existing record — ownership-scoped the
  // same way character reference paths are.
  const keptRaw = (formData.get("kept_paths") as string) || "[]";
  let kept: string[];
  try {
    const parsed = JSON.parse(keptRaw);
    if (!Array.isArray(parsed) || parsed.some((p) => typeof p !== "string")) throw new Error();
    kept = parsed.filter((p: string) => p.startsWith(`${userId}/`));
  } catch {
    return { error: "Couldn't read the product's photos — refresh and try again." };
  }
  const keptLogo = ((formData.get("kept_logo_path") as string) || "").trim();
  const keptLogoSafe = keptLogo.startsWith(`${userId}/`) ? keptLogo : null;

  const newFiles = formData.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  const logoFile = formData.get("logo");
  const newLogo = logoFile instanceof File && logoFile.size > 0 ? logoFile : null;

  if (kept.length + newFiles.length === 0) {
    return { error: "Add at least one product photo." };
  }
  if (kept.length + newFiles.length > MAX_PRODUCT_IMAGES) {
    return { error: `A product can have up to ${MAX_PRODUCT_IMAGES} photos.` };
  }
  for (const f of [...newFiles, ...(newLogo ? [newLogo] : [])]) {
    if (!f.type.startsWith("image/")) return { error: `${f.name} isn't an image.` };
    if (f.size > MAX_FILE_BYTES) return { error: `${f.name} is larger than 15MB.` };
  }

  async function upload(file: File): Promise<string> {
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const path = `${userId}/products/${crypto.randomUUID()}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());
    const { error } = await supabase.storage
      .from("character-references")
      .upload(path, bytes, { contentType: file.type });
    if (error) throw new Error(error.message);
    return path;
  }

  let imagePaths: string[];
  let logoPath: string | null;
  try {
    imagePaths = [...kept];
    for (const f of newFiles) imagePaths.push(await upload(f));
    logoPath = newLogo ? await upload(newLogo) : keptLogoSafe;
  } catch (err) {
    console.error("saveProduct upload failed:", err);
    return { error: "Couldn't upload a photo — try again." };
  }

  // Existing record: collect paths being dropped so their files get cleaned
  // up after a successful save (same tidy-on-save the character form does).
  let dropped: string[] = [];
  if (id) {
    const { data: existing } = await supabase
      .from("products")
      .select("image_paths, logo_path")
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    if (!existing) return { error: "Couldn't find that product." };
    const before = [...(existing.image_paths ?? []), ...(existing.logo_path ? [existing.logo_path] : [])];
    const after = new Set([...imagePaths, ...(logoPath ? [logoPath] : [])]);
    dropped = before.filter((p) => !after.has(p));
  }

  const row = { name, image_paths: imagePaths, logo_path: logoPath };
  const query = id
    ? supabase.from("products").update(row).eq("id", id).eq("user_id", userId).select("id, name, image_paths, logo_path").single()
    : supabase.from("products").insert({ ...row, user_id: userId }).select("id, name, image_paths, logo_path").single();
  const { data: saved, error } = await query;
  if (error || !saved) {
    console.error("saveProduct failed:", error?.message);
    return { error: "Couldn't save the product — try again." };
  }

  if (dropped.length > 0) {
    // Best-effort cleanup — an orphaned file must never fail the save.
    await supabase.storage.from("character-references").remove(dropped).then(
      () => undefined,
      () => undefined,
    );
  }

  return { error: null, product: toRecord(saved) };
}

export async function deleteProduct(formData: FormData): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: "Your session expired — please log in again." };

  const id = ((formData.get("id") as string) || "").trim();
  if (!id) return { error: "Missing product." };

  const { data: existing } = await supabase
    .from("products")
    .select("image_paths, logo_path")
    .eq("id", id)
    .eq("user_id", userData.user.id)
    .single();
  if (!existing) return { error: "Couldn't find that product." };

  const { error } = await supabase.from("products").delete().eq("id", id).eq("user_id", userData.user.id);
  if (error) {
    console.error("deleteProduct failed:", error.message);
    return { error: "Couldn't delete the product — try again." };
  }

  const files = [...(existing.image_paths ?? []), ...(existing.logo_path ? [existing.logo_path] : [])];
  if (files.length > 0) {
    await supabase.storage.from("character-references").remove(files).then(
      () => undefined,
      () => undefined,
    );
  }
  return { error: null };
}
