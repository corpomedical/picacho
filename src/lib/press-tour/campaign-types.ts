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

/**
 * The campaign stage machine (spec §1.12). Terminal: failed, cancelled,
 * expired. awaiting_approval is where the ad waits on the person: before
 * filming, for the stills; once filmed (CampaignView.shots non-empty), for
 * a shot on the press wall that needs a decision (ShotView.needsDecision),
 * or for "Make the cut" again when the cut couldn't be finished.
 */
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

/**
 * What the person decided about a filmed shot (the press wall). Nothing is
 * decided for them: a shot whose take didn't match waits here (operator,
 * 2026-09-26: no re-shoot and no refund for a miss before the checker is
 * calibrated).
 *   pending    nothing decided (a clean shot goes into the cut as it is)
 *   kept       the person kept `chosenTake` for the cut
 *   refilming  the person paid to film it again; the new take is on its way
 *   cut        left out of the cut (free)
 */
export type ShotDecision = "pending" | "kept" | "refilming" | "cut";

/**
 * Both readings of the product at one moment, when the record holds both
 * (the press wall's "Why moment N missed": the letter row and the Label /
 * Logo / Shape / Colour rows). The words read and the confirmed word are
 * the label's own letters, never a score; each part is a verdict word.
 */
export interface MomentDetail {
  /** The line read on the label at this moment, as read (e.g. "SOLSTAO"). */
  read: string;
  /** The confirmed label word it was held against (e.g. "SOLSTAD"). */
  expected: string;
  /** The second reading, part by part: match, didnt_match or not_readable only. */
  label: Verdict;
  logo: Verdict;
  shape: Verdict;
  colour: Verdict;
}

/** One moment of a filmed take the checks read ("Checked at N moments": N comes from this list). */
export interface MomentView {
  /** Seconds into the take, or null when the moment's time is unknown. */
  atSeconds: number | null;
  face: Verdict;
  product: Verdict;
  /** The plain reason when this moment didn't match or couldn't be read, else null. */
  reason: string | null;
  /** Both readings, when the record holds both (absent otherwise). */
  detail?: MomentDetail;
}

/** Where a take is. */
export type TakeState = "filming" | "checking" | "checked" | "failed";

export interface TakeView {
  /** 1-based, per shot. */
  take: number;
  state: TakeState;
  /** A viewable link to the filmed take, or null before it is filmed (or when it failed). */
  videoUrl: string | null;
  /** Every moment read, in order (empty until checked). */
  moments: MomentView[];
  /** The take's verdict by the worst-moment rule: the worse of its product and face verdicts that apply. */
  worst: Verdict;
  face: Verdict;
  product: Verdict;
  /** The plain reason beside `worst`, or null. */
  reason: string | null;
}

export interface ShotView {
  shot: number; // 1-based
  role: ShotRole;
  takes: TakeView[];
  /** The take that goes into the cut (1-based), or null when none can. */
  chosenTake: number | null;
  decision: ShotDecision;
  /**
   * True when this shot waits on the person before the cut is made: its
   * chosen take didn't match (product or face), it has no usable take, or
   * it was filmed again and the person picks the take.
   */
  needsDecision: boolean;
  /** False for a shot planned without the product ("Not planned"). */
  productExpected: boolean;
  /** What "Re-film shot N" costs: this shot's own film credits (the normal price). */
  refilmCredits: number;
  /** False once the shot has been filmed again as many times as it can be. */
  canRefilm: boolean;
}

/** One finished file. clean: no tag, no end card (TikTok). tagged: the small AI-generated tag, and the brand's end card when there is one. */
export interface RenditionView {
  kind: "clean" | "tagged";
  /** A short-lived viewable/downloadable link. */
  url: string;
  seconds: number;
  /** True only when a C2PA manifest was written AND read back from this very file. */
  signed: boolean;
}

export interface MasterView {
  /** The finished ad's own History row, once delivered. */
  generationId: string | null;
  renditions: RenditionView[];
  /** Admins only (null for everyone else): why a rendition is unsigned, in plain English. */
  adminNote: string | null;
  /**
   * Whether this ad's tagged file carries the brand's end card. Decided once,
   * when the ad was cut (a confirmed brand kit with a logo then): a finished
   * ad never gains one later (PT-R3-07).
   */
  hasEndCard: boolean;
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
  /** The filmed shots, in shot order (empty until filming is charged). */
  shots: ShotView[];
  /** The finished ad (null until it is ready). */
  master: MasterView | null;
  /** Credits that came back on this ad (a still or a shot that failed, the 24 h rule). */
  creditsRefunded: number;
  quote: PressQuote | null;
  /** What blocks the next step, in plain words, or null. E.g. "Decide on shot 3 to film". */
  blocker: string | null;
  /** Plain-words error when stage is failed. */
  error: string | null;
  /**
   * True while we owe this ad its cut: filming was charged and the 24 h
   * rule's clock is running (shots filming or being checked, the cut being
   * made or finished, or a cut parked for the team). The ad can't be closed
   * then: the cut is delivered, or the 24 h rule closes it (MONEY-1). The
   * door hides "Start over" while it is true. Absent reads as false.
   */
  cutOwed?: boolean;
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
  /** Close the ad. Refused while the cut is owed (CampaignView.cutOwed); once filmed, the filming credits stay spent. */
  cancelCampaign(input: { campaignId: string }): Promise<CampaignResult>;
  /**
   * Film every shot from its approved (or kept) still: charges the quote's
   * film line once, whatever the network does to the press. Stage
   * awaiting_approval -> animating -> checking_shots -> (the press wall, when
   * a shot waits on the person) -> assembling -> signing -> ready.
   */
  filmShots(input: { sendId: string; campaignId: string; captions?: boolean }): Promise<CampaignResult>;
  /** Put this take of this shot in the cut (free). */
  keepTake(input: { campaignId: string; shot: number; take: number }): Promise<CampaignResult>;
  /**
   * Film this shot again from its still at the shot's normal film price.
   * `credits` is the price the press wall showed (ShotView.refilmCredits):
   * a price that moved since is refused with the new one before anything is
   * charged (N3; MONEY-5).
   */
  refilmShot(input: { sendId: string; campaignId: string; shot: number; credits: number; note?: string }): Promise<CampaignResult>;
  /** Leave this shot out of the cut (free). */
  cutShot(input: { campaignId: string; shot: number }): Promise<CampaignResult>;
  /**
   * Make the cut now with the takes as they stand (every shot still waiting
   * keeps its chosen take), or make it again after it could not be finished
   * (free).
   */
  assembleNow(input: { campaignId: string }): Promise<CampaignResult>;
}
