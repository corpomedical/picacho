// The reading permissions Clippings asks for when a person connects an
// account and its network switch is on (official docs, read 2026-10-02):
// Instagram's insights permission (a reel's views; Meta App Review before
// the public can grant it) and TikTok's video.list (the person's public
// videos and their counts). Alias-free; no imports, so the connect flow
// (social/publish-service.ts) can read it without a cycle.

export const INSTAGRAM_READ_SCOPE = "instagram_business_manage_insights";
export const TIKTOK_READ_SCOPE = "video.list";
