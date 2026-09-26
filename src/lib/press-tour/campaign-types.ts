// The contract between the Press Tour door (UI) and the campaign engine
// (server). Both sides build against these shapes; the engine owns their
// meaning. Alias-free on purpose: money and policy modules import it under
// vitest, which has no "@/" alias.
//
// Sources: press-tour spec v1 §1.12 (stage machine) as corrected by the
// synthesis v2 (N2 vocabulary, N3 one money grammar, N4 repaint price) and
// the operator's decisions of 2026-09-25/26: no free re-shoot before the
// checker is calibrated (a miss shows its verdict; the person may repaint a
// still or re-film a shot at the normal price), no refunds for misses yet,
// the free trial ad is the full 15 s 3-shot ad.

/** The campaign stage machine (spec §1.12). Terminal: failed, cancelled, expired. */
export const CAMPAIGN_STAGES = [
  "draft",
  "planned",
  "painting",
  "checking_keyframes",
  "awaiting_approval",
  "animating",
  "checking_shots",
  "assembling",
  "signing",
  "ready",
  "failed",
  "cancelled",
  "expired",
] as const;
export type CampaignStage = (typeof CAMPAIGN_STAGES)[number];

/** Where a campaign was started from. */
export type CampaignSource = "door" | "generate" | "producer" | "mcp" | "trial";

/** The fixed verdict words (synthesis S4/N2). Customer copy maps each to a translated label. */
export type Verdict =
  | "match"
  | "didnt_match"
  | "not_readable"
  | "product_missing"
  | "not_checked"
  | "no_one_in_shot";

/** The role a shot plays in the ad (hook → co-star → line). */
export type ShotRole = "hook" | "costar" | "line";

/** What the person decided about a still. */
export type StillDecision = "pending" | "approved" | "kept";

export interface StillView {
  shot: number; // 1-based
  role: ShotRole;
  /** Seconds this shot covers in the cut, e.g. [0, 5]. */
  span: [number, number];
  /** One line in plain words: what happens in the shot. */
  direction: string;
  /** Signed, viewable URL of the painted still (9:16), or null while painting. */
  imageUrl: string | null;
  face: Verdict;
  product: Verdict;
  /**
   * False for a shot planned without the product (a hook with the star
   * alone): its product check does not apply, the still is clear on its face
   * alone, and the door says "Not planned" instead of a verdict.
   */
  productExpected: boolean;
  /** When a check didn't match or couldn't read, the plain reason (e.g. 'The label is turned away'). */
  reason: string | null;
  decision: StillDecision;
  /** How many times the person has repainted this still (each repaint is 1 credit). */
  repaints: number;
  /** True when the checker repainted it once on the house (shown as "We repainted this once, free"). */
  houseRepainted: boolean;
}

/** One line of the receipt, as the server prices it. */
export interface QuoteRow {
  key: "stills" | "film" | "checks" | "posting";
  /** Credits for this line; 0 = "included". */
  credits: number;
  /** True once these credits have been charged. */
  paid: boolean;
}

/** N3: one money grammar, sent by the server, printed by every surface. */
export interface PressQuote {
  version: number;
  /** Credits to paint the stills (1 per still). */
  paint: number;
  /** Credits to film every shot. */
  animate: number;
  /** paint + animate. */
  total: number;
  rows: QuoteRow[];
  policy: {
    /** 'off' until the checker is calibrated (operator, 2026-09-26: no re-shoot yet). */
    reshoot: "off" | "person" | "auto";
    /** Refunds for a product miss: false until calibrated and approved. */
    refund: boolean;
  };
  /** Credits the person has now, and after the next spend ("96 left now · 90 after filming"). */
  balanceNow: number;
  balanceAfterNextStep: number;
  /** True when this campaign is the account's free first ad (nothing is charged). */
  trial: boolean;
}

export interface CampaignView {
  id: string;
  stage: CampaignStage;
  source: CampaignSource;
  productId: string;
  characterIds: string[];
  brandKitId: string | null;
  lengthSeconds: 10 | 15 | 30;
  aspect: "9:16";
  /** The plan's title line, e.g. "Morning ritual". */
  angle: string | null;
  stills: StillView[];
  quote: PressQuote | null;
  /** What blocks the next step, in plain words, or null. E.g. "Decide on shot 3 to film". */
  blocker: string | null;
  /** Plain-words error when stage is failed. */
  error: string | null;
  updatedAt: string;
}

/** Every campaign action answers with the fresh view or a plain error. */
export type CampaignResult =
  | { ok: true; campaign: CampaignView }
  | { ok: false; error: string };

/**
 * The server actions the door calls (implemented in campaign-actions.ts).
 * Every spend carries a client-made sendId so a resent request never charges twice.
 */
export interface CampaignActions {
  /** Plan a new ad: free (counts against the daily plan budget). Stage → planned. */
  planCampaign(input: {
    sendId: string;
    productId: string;
    characterId: string;
    brandKitId?: string | null;
    lengthSeconds?: 10 | 15 | 30;
    goal?: string;
    source?: CampaignSource;
  }): Promise<CampaignResult>;
  /** Paint the stills (charges the paint line, or nothing on the trial). Stage → painting → awaiting_approval. */
  paintStills(input: { sendId: string; campaignId: string }): Promise<CampaignResult>;
  approveStill(input: { campaignId: string; shot: number }): Promise<CampaignResult>;
  keepStill(input: { campaignId: string; shot: number }): Promise<CampaignResult>;
  undoStill(input: { campaignId: string; shot: number }): Promise<CampaignResult>;
  /** Repaint one still at 1 credit (N4). */
  repaintStill(input: { sendId: string; campaignId: string; shot: number; note?: string }): Promise<CampaignResult>;
  getCampaign(input: { campaignId: string }): Promise<CampaignResult>;
  cancelCampaign(input: { campaignId: string }): Promise<CampaignResult>;
}
