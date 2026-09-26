import { describe, expect, it } from "vitest";
import type { TikTokChoices } from "../press-tour/publish-types";
import {
  MEDIA_REJECTED,
  TIKTOK_ACCOUNT_PUBLIC,
  TIKTOK_BRANDED_PRIVATE,
  TIKTOK_BRANDED_TEST,
  TIKTOK_CANT_POST_NOW,
  TIKTOK_INTERACTION_OFF,
  TIKTOK_PRIVACY_NOT_OFFERED,
  TIKTOK_PRIVACY_REQUIRED,
  TIKTOK_TEST_FULL,
  TIKTOK_TEST_ONLY_ME,
  TIKTOK_TOO_LONG,
  UPLOAD_FAILED,
} from "./messages";
import { T0, consentFor, sendContext } from "./test-context";
import { formOf, json, jsonOf, scriptedFetch } from "./test-fetch";
import {
  TIKTOK_AUTHORIZE_URL,
  TIKTOK_CREATOR_INFO_URL,
  TIKTOK_INIT_URL,
  TIKTOK_STATUS_URL,
  TIKTOK_TOKEN_URL,
  chunkPlan,
  sheetFrom,
  tiktokChoiceError,
  tiktokOAuth,
  tiktokPosting,
  type CreatorInfo,
} from "./tiktok";

const creds = { clientId: "ckey", clientSecret: "csecret" };

const privateAccount: CreatorInfo = {
  nickname: "Brand Co",
  username: "brandco",
  avatarUrl: "https://p16.tiktokcdn.test/a.jpg",
  privacyOptions: ["FOLLOWER_OF_CREATOR", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
  commentDisabled: false,
  duetDisabled: true,
  stitchDisabled: false,
  maxDurationSeconds: 600,
};

const creatorInfoAnswer = (info: CreatorInfo = privateAccount) =>
  json(200, {
    data: {
      creator_nickname: info.nickname,
      creator_username: info.username,
      creator_avatar_url: info.avatarUrl,
      privacy_level_options: info.privacyOptions,
      comment_disabled: info.commentDisabled,
      duet_disabled: info.duetDisabled,
      stitch_disabled: info.stitchDisabled,
      max_video_post_duration_sec: info.maxDurationSeconds,
    },
    error: { code: "ok", message: "", log_id: "L" },
  });

const choose = (over: Partial<TikTokChoices> = {}): TikTokChoices => ({
  privacy: "SELF_ONLY",
  allowComment: false,
  allowDuet: false,
  allowStitch: false,
  yourBrand: false,
  brandedContent: false,
  ...over,
});

describe("TikTok: connecting (Login Kit for the web)", () => {
  it("asks for user.info.basic, video.publish and video.upload with client_key", () => {
    const url = new URL(tiktokOAuth.authorizeUrl({ creds, redirectUri: "https://picacho.ai/api/social/tiktok/callback", state: "S", codeChallenge: null }));
    expect(`${url.origin}${url.pathname}`).toBe(TIKTOK_AUTHORIZE_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_key: "ckey",
      scope: "user.info.basic,video.publish,video.upload",
      response_type: "code",
      redirect_uri: "https://picacho.ai/api/social/tiktok/callback",
      state: "S",
    });
  });

  it("exchanges the code with the app secret and keeps open_id as the account", async () => {
    const f = scriptedFetch([
      {
        method: "POST",
        url: TIKTOK_TOKEN_URL,
        reply: () => json(200, { access_token: "AT", expires_in: 86400, open_id: "open-1", refresh_token: "RT", refresh_expires_in: 31536000, scope: "user.info.basic,video.publish" }),
      },
    ]);
    const t = await tiktokOAuth.exchangeCode(f.fetch, { creds, code: "C", redirectUri: "https://picacho.ai/api/social/tiktok/callback", verifier: null, now: T0 });
    expect(t).toMatchObject({ accessToken: "AT", refreshToken: "RT", externalId: "open-1", scopes: ["user.info.basic", "video.publish"] });
    expect(t.refreshExpiresAt?.toISOString()).toBe(new Date(T0.getTime() + 31_536_000_000).toISOString());
    expect(formOf(f.calls[0])).toEqual({
      client_key: "ckey",
      client_secret: "csecret",
      code: "C",
      grant_type: "authorization_code",
      redirect_uri: "https://picacho.ai/api/social/tiktok/callback",
    });
  });

  it("refresh keeps the newly returned refresh key (TikTok rotates it)", async () => {
    const f = scriptedFetch([
      { method: "POST", url: TIKTOK_TOKEN_URL, reply: () => json(200, { access_token: "AT2", expires_in: 86400, open_id: "open-1", refresh_token: "RT2", refresh_expires_in: 31536000 }) },
    ]);
    const r = await tiktokOAuth.refresh(f.fetch, { creds, accessToken: "AT", refreshToken: "RT", now: T0 });
    expect(r.ok && r.keys.refreshToken).toBe("RT2");
    expect(formOf(f.calls[0])).toMatchObject({ grant_type: "refresh_token", refresh_token: "RT" });
    const bad = scriptedFetch([{ method: "POST", url: TIKTOK_TOKEN_URL, reply: () => json(400, { error: "invalid_grant" }) }]);
    expect(await tiktokOAuth.refresh(bad.fetch, { creds, accessToken: "AT", refreshToken: "RT", now: T0 })).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("TikTok's sheet: the privacy rules (constraints §6A)", () => {
  const testSheet = sheetFrom(privateAccount, { audited: false, now: T0 });
  const auditedSheet = sheetFrom(privateAccount, { audited: true, now: T0 });

  it("test mode offers only Only me, and no branded content", () => {
    expect(testSheet.privacyOptions).toEqual(["SELF_ONLY"]);
    expect(testSheet.testMode).toBe(true);
    expect(testSheet.brandedContentAvailable).toBe(false);
    expect(testSheet.canPost).toBe(true);
    expect(testSheet.nickname).toBe("Brand Co");
    expect(auditedSheet.privacyOptions).toEqual(privateAccount.privacyOptions);
  });

  it("a PUBLIC account can't post in test mode, and the sheet says so before anything is sent", () => {
    const sheet = sheetFrom({ ...privateAccount, privacyOptions: ["PUBLIC_TO_EVERYONE", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] }, { audited: false, now: T0 });
    expect(sheet.canPost).toBe(false);
    expect(sheet.blocker).toBe(TIKTOK_ACCOUNT_PUBLIC);
    expect(tiktokChoiceError(choose(), sheet, 15)).toBe(TIKTOK_ACCOUNT_PUBLIC);
  });

  it("privacy has NO default: nothing chosen is refused", () => {
    expect(tiktokChoiceError(choose({ privacy: null }), testSheet, 15)).toBe(TIKTOK_PRIVACY_REQUIRED);
    expect(tiktokChoiceError(null, testSheet, 15)).toBe(TIKTOK_PRIVACY_REQUIRED);
  });

  it("a privacy outside the account's options is refused; in test mode anything but Only me says why", () => {
    expect(tiktokChoiceError(choose({ privacy: "FOLLOWER_OF_CREATOR" }), testSheet, 15)).toBe(TIKTOK_TEST_ONLY_ME);
    expect(tiktokChoiceError(choose({ privacy: "PUBLIC_TO_EVERYONE" }), auditedSheet, 15)).toBe(TIKTOK_PRIVACY_NOT_OFFERED);
    expect(tiktokChoiceError(choose({ privacy: "FOLLOWER_OF_CREATOR" }), auditedSheet, 15)).toBeNull();
  });

  it("branded content: never Only me, never in test mode", () => {
    expect(tiktokChoiceError(choose({ brandedContent: true }), testSheet, 15)).toBe(TIKTOK_BRANDED_TEST);
    expect(tiktokChoiceError(choose({ brandedContent: true, privacy: "SELF_ONLY" }), auditedSheet, 15)).toBe(TIKTOK_BRANDED_PRIVATE);
    expect(tiktokChoiceError(choose({ brandedContent: true, privacy: "MUTUAL_FOLLOW_FRIENDS" }), auditedSheet, 15)).toBeNull();
    expect(tiktokChoiceError(choose({ yourBrand: true }), testSheet, 15)).toBeNull();
  });

  it("a toggle the creator turned off stays off; the video can't be longer than they may post", () => {
    expect(tiktokChoiceError(choose({ allowDuet: true }), testSheet, 15)).toBe(TIKTOK_INTERACTION_OFF);
    expect(tiktokChoiceError(choose({ allowComment: true, allowStitch: true }), testSheet, 15)).toBeNull();
    expect(tiktokChoiceError(choose(), { ...testSheet, maxDurationSeconds: 10 }, 15)).toBe(TIKTOK_TOO_LONG);
  });
});

describe("TikTok: posting (Direct Post, FILE_UPLOAD)", () => {
  it("cuts the file for FILE_UPLOAD: whole up to 64 MB, else 16 MB chunks with the rest in the last", () => {
    expect(chunkPlan(3_000_000)).toEqual({ chunkSize: 3_000_000, count: 1 });
    expect(chunkPlan(64 * 1024 * 1024)).toEqual({ chunkSize: 64 * 1024 * 1024, count: 1 });
    expect(chunkPlan(70 * 1024 * 1024)).toEqual({ chunkSize: 16 * 1024 * 1024, count: 4 });
  });

  it("asks creator_info right before sending, inits ONCE with is_aigc and the chosen privacy, uploads, then asks how it went", async () => {
    const bytes = Buffer.alloc(2 * 1024 * 1024, 3);
    const f = scriptedFetch([
      { method: "POST", url: TIKTOK_CREATOR_INFO_URL, times: 1, reply: () => creatorInfoAnswer() },
      {
        method: "POST",
        url: TIKTOK_INIT_URL,
        times: 1,
        reply: () => json(200, { data: { publish_id: "v_pub_1", upload_url: "https://open-upload.tiktokapis.test/video/?upload_id=1" }, error: { code: "ok" } }),
      },
      { method: "PUT", url: "https://open-upload.tiktokapis.test/video/?upload_id=1", times: 1, reply: () => new Response(null, { status: 201 }) },
    ]);
    const consent = consentFor("tiktok", { tiktok: choose({ allowComment: true, yourBrand: true }) });
    const { ctx, saves } = sendContext({ network: "tiktok", fetch: f.fetch, bytes, consent });
    const out = await tiktokPosting.advance(ctx);
    expect(out.kind).toBe("wait");

    const init = jsonOf(f.calls.find((c) => c.url === TIKTOK_INIT_URL)!);
    expect(init).toEqual({
      post_info: {
        title: "Morning ritual.\n\n#coffee",
        privacy_level: "SELF_ONLY",
        disable_comment: false,
        disable_duet: true,
        disable_stitch: true,
        brand_content_toggle: false,
        brand_organic_toggle: true,
        is_aigc: true,
      },
      source_info: { source: "FILE_UPLOAD", video_size: bytes.length, chunk_size: bytes.length, total_chunk_count: 1 },
    });
    const put = f.calls.find((c) => c.method === "PUT")!;
    expect(put.headers["content-range"]).toBe(`bytes 0-${bytes.length - 1}/${bytes.length}`);
    expect(put.headers["content-type"]).toBe("video/mp4");
    // 'publishing' is written before init; the publish id right after it.
    expect(saves[0]).toMatchObject({ stage: "publishing" });
    expect(saves[1].externalIds).toMatchObject({ publishId: "v_pub_1" });
    expect(saves[2].externalIds).toMatchObject({ publishId: "v_pub_1", uploaded: true });

    // The next look asks TikTok how it went, and never inits again.
    const g = scriptedFetch([
      { method: "POST", url: TIKTOK_STATUS_URL, reply: () => json(200, { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [] }, error: { code: "ok" } }) },
    ]);
    const again = sendContext({ network: "tiktok", fetch: g.fetch, bytes, consent, stage: "publishing", externalIds: ctx.post.externalIds, uploadAttempts: 1 });
    expect(await tiktokPosting.advance(again.ctx)).toEqual({ kind: "published", externalPostId: null, permalink: null });
    expect(jsonOf(g.calls[0])).toEqual({ publish_id: "v_pub_1" });
    expect(g.calls.some((c) => c.url === TIKTOK_INIT_URL)).toBe(false);
  });

  it("a public post id makes a permalink, its 19 digits kept exactly", async () => {
    const g = scriptedFetch([
      {
        method: "POST",
        url: TIKTOK_STATUS_URL,
        // Raw text: TikTok sends the id as a 19-digit JSON number, which JSON.parse would round.
        reply: () =>
          new Response('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7300000000000000001]},"error":{"code":"ok"}}', {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      },
    ]);
    const { ctx } = sendContext({ network: "tiktok", fetch: g.fetch, stage: "publishing", externalIds: { publishId: "p", initAt: T0.toISOString(), uploaded: true }, uploadAttempts: 1 });
    const out = await tiktokPosting.advance(ctx);
    expect(out).toEqual({ kind: "published", externalPostId: "7300000000000000001", permalink: "https://www.tiktok.com/@brand/video/7300000000000000001" });
  });

  it("init is never sent blindly twice: no answer = failed, nothing posted (no bytes ever went)", async () => {
    const f = scriptedFetch([
      { method: "POST", url: TIKTOK_CREATOR_INFO_URL, reply: () => creatorInfoAnswer() },
      { method: "POST", url: TIKTOK_INIT_URL, times: 1, reply: () => "no-answer" },
    ]);
    const { ctx } = sendContext({ network: "tiktok", fetch: f.fetch });
    expect(await tiktokPosting.advance(ctx)).toEqual({ kind: "failed", error: UPLOAD_FAILED });
    // And a row that died after 'publishing' without an id is not sent again either.
    const again = scriptedFetch([]);
    expect(await tiktokPosting.advance(sendContext({ network: "tiktok", fetch: again.fetch, stage: "publishing", uploadAttempts: 1 }).ctx)).toEqual({
      kind: "failed",
      error: UPLOAD_FAILED,
    });
    expect(again.calls).toHaveLength(0);
  });

  it("TikTok's own no: too many posts is busy, the test cap is busy, a public account and the wrong privacy are final", async () => {
    const answers: [string, unknown][] = [
      ["spam_risk_too_many_posts", { kind: "busy", error: TIKTOK_CANT_POST_NOW }],
      ["reached_active_user_cap", { kind: "busy", error: TIKTOK_TEST_FULL }],
      ["unaudited_client_can_only_post_to_private_accounts", { kind: "failed", error: TIKTOK_ACCOUNT_PUBLIC }],
      ["privacy_level_option_mismatch", { kind: "failed", error: TIKTOK_PRIVACY_NOT_OFFERED }],
      ["access_token_invalid", { kind: "reconnect" }],
      ["duration_check_failed", { kind: "failed", error: MEDIA_REJECTED }],
    ];
    for (const [code, expected] of answers) {
      const f = scriptedFetch([
        { method: "POST", url: TIKTOK_CREATOR_INFO_URL, reply: () => creatorInfoAnswer() },
        { method: "POST", url: TIKTOK_INIT_URL, reply: () => json(403, { data: {}, error: { code, message: code } }) },
      ]);
      expect(await tiktokPosting.advance(sendContext({ network: "tiktok", fetch: f.fetch }).ctx)).toEqual(expected);
    }
  });

  it("creator_info at send time can stop it before init: can't post now, a privacy no longer offered", async () => {
    const busy = scriptedFetch([{ method: "POST", url: TIKTOK_CREATOR_INFO_URL, reply: () => json(200, { data: {}, error: { code: "spam_risk_too_many_posts" } }) }]);
    expect(await tiktokPosting.advance(sendContext({ network: "tiktok", fetch: busy.fetch }).ctx)).toEqual({ kind: "busy", error: TIKTOK_CANT_POST_NOW });

    const noSelf = scriptedFetch([{ method: "POST", url: TIKTOK_CREATOR_INFO_URL, reply: () => creatorInfoAnswer({ ...privateAccount, privacyOptions: ["FOLLOWER_OF_CREATOR"] }) }]);
    const out = await tiktokPosting.advance(sendContext({ network: "tiktok", fetch: noSelf.fetch }).ctx);
    expect(out.kind === "busy" || out.kind === "failed").toBe(true);
    expect(noSelf.calls.some((c) => c.url === TIKTOK_INIT_URL)).toBe(false);
  });

  it("a lost answer on the LAST chunk is asked about, not re-sent blindly", async () => {
    const f = scriptedFetch([
      { method: "POST", url: TIKTOK_CREATOR_INFO_URL, reply: () => creatorInfoAnswer() },
      { method: "POST", url: TIKTOK_INIT_URL, reply: () => json(200, { data: { publish_id: "p2", upload_url: "https://up.test/u" }, error: { code: "ok" } }) },
      { method: "PUT", url: "https://up.test/u", reply: () => "no-answer" },
    ]);
    const { ctx } = sendContext({ network: "tiktok", fetch: f.fetch });
    const out = await tiktokPosting.advance(ctx);
    expect(out.kind).toBe("wait");
    expect(ctx.post.externalIds).toMatchObject({ publishId: "p2" });
  });

  it("status FAILED is final; status never answering for 45 minutes after upload is unconfirmed", async () => {
    const failed = scriptedFetch([{ method: "POST", url: TIKTOK_STATUS_URL, reply: () => json(200, { data: { status: "FAILED", fail_reason: "file_format_check_failed" }, error: { code: "ok" } }) }]);
    expect(
      await tiktokPosting.advance(sendContext({ network: "tiktok", fetch: failed.fetch, stage: "publishing", externalIds: { publishId: "p", initAt: T0.toISOString(), uploaded: true }, uploadAttempts: 1 }).ctx),
    ).toEqual({ kind: "failed", error: MEDIA_REJECTED });

    const silent = scriptedFetch([{ method: "POST", url: TIKTOK_STATUS_URL, reply: () => "no-answer" }]);
    const late = () => new Date(T0.getTime() + 46 * 60_000);
    expect(
      await tiktokPosting.advance(
        sendContext({ network: "tiktok", fetch: silent.fetch, now: late, stage: "publishing", externalIds: { publishId: "p", initAt: T0.toISOString(), uploaded: true }, uploadAttempts: 1 }).ctx,
      ),
    ).toEqual({ kind: "unconfirmed" });
  });
});
