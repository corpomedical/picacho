import { PRICING_TIERS } from "../pricing";
import { FREE_TIER_VIDEO_MODEL_ID } from "../plans";
import { getDialogueCreditWeight } from "../generations/providers/video-models";
import { CINEMA_PRESETS, isProvenPreset } from "../generations/cinema-presets";
import { TEMPLATES } from "../templates";

// The assistant's product guide (operator ask, 2026-09-02: "needs to know
// how to answer any question about picacho. What each button does and how
// it works").
//
// TWO RULES GOVERN THIS FILE:
//
// 1. Deterministic bytes. This text is appended to the model-catalogue
//    system block, which carries a cache breakpoint — one unstable byte
//    here and every conversation re-pays the whole prefix (see context.ts,
//    "THE ORDERING IS THE WHOLE COST STORY"). No clocks, no per-request
//    values, arrays sorted before rendering.
//
// 2. Derived where numbers live in code. Plan prices come from
//    PRICING_TIERS, the dialogue rate from getDialogueCreditWeight, preset
//    names from CINEMA_PRESETS, the template count from TEMPLATES, the free
//    model from FREE_TIER_VIDEO_MODEL_ID — so a pricing or catalogue change
//    can never strand a stale claim in the assistant's mouth. The
//    hand-written prose describes UI mechanics only, and every claim in it
//    was audited against the component source before shipping (2026-09-02
//    verification pass). When the UI changes, change this in the same
//    commit — an assistant that describes last month's buttons is worse
//    than one that says nothing.

function renderPlans(): string {
  return PRICING_TIERS.map(
    (t) =>
      `- ${t.name}: $${t.price}/mo (or $${t.annualPrice}/mo billed annually as one $${
        t.annualPrice * 12
      } payment), ${t.credits} credits/month${t.highlight ? " — the most popular plan" : ""}${
        t.id === "studio"
          ? ". Adds Storyboard frames and multi-image reference"
          : t.id === "elite"
            ? ". Adds API access"
            : ""
      }`,
  ).join("\n");
}

function renderPresets(): string {
  // Display names are i18n; ids are stable and readable enough for the
  // assistant ("crash-zoom" → "crash zoom"). Only proven presets — drafted
  // ones are invisible in the composer and must be invisible here too.
  const proven = CINEMA_PRESETS.filter(isProvenPreset);
  const label: Record<string, string> = {
    move: "Camera moves",
    look: "Light & looks",
    fx: "FX",
  };
  const byCategory = new Map<string, string[]>();
  for (const p of proven) {
    const list = byCategory.get(p.category) ?? [];
    list.push(p.id.replace(/-/g, " "));
    byCategory.set(p.category, list);
  }
  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, names]) => `- ${label[cat] ?? cat}: ${names.sort().join(", ")}`)
    .join("\n");
}

export function renderProductGuide(): string {
  return `PRODUCT GUIDE — what every part of Picacho does. Answer questions about the product from THIS, in the person's own language. Every claim below was audited against the shipped code (2026-09-02). If something is not covered here or in the data above, say you are not certain rather than inventing UI.

THE STUDIO (Generate page) — the main screen.
- The top of the page is the STAGE: a dark band showing the newest render (or whichever take is picked from the filmstrip of thumbnails under it). Scored takes wear a small plate with the character's reference photo, the identity score and the attempt it passed on; unscored or multi-angle takes wear a simpler label. Corner ghost buttons: download on any take, fullscreen on videos.
- SESSION TRANSCRIPT: a button beside the page title (end of the stats row on phones) opens the running conversation — every send, reply, failure and recovery action for this session. It opens itself when the assistant is streaming an answer, when a render fails (the retry buttons live there), and when arriving from History.
- The header row shows First-try success and Avg attempts (once they have renders) and the CREDIT BALANCE in ochre.
- THE COMPOSER is the floating card at the bottom. A Video/Image switch picks the medium (images cost 1 credit). Above everything sits the SEND RECEIPT: an itemized strip showing what the send will use — whose face rides along, what dialogue adds, and the Total in credits — quoted BEFORE the button is pressed on every video send (in image mode it appears when an attachment rides or something needs fixing). Fixable problems (wrong engine for the attachment, dialogue without a voice) appear as receipt rows with one-tap remedies; a credit shortfall shows as its own strip with an "Add credits" button.
- LOADOUT CHIPS between the receipt and the prompt box, left to right:
  - Character chip: which saved character stars in the render. Its five-bar meter is FACE-LOCK STRENGTH — each saved reference photo fills one bar (capped at five); more photos, stronger identity anchor.
  - Engine chip: the video model. Opens a menu — four featured engines, the rest behind "More models" — each showing its price at its default length.
  - Duration chip (only on engines with more than one length): its own menu; lengths costing more than 1 credit show their exact price.
  - Aspect chips: landscape (16:9) and portrait (9:16) icons. A prompt that names its own aspect overrides the chip.
  - Camera and Light & looks chips: cinema presets (list below). A chip glows warm ochre and wears the preset's name while one is armed.
  - New chat: clears the session and starts fresh (renders stay in History).
- MODE PILLS (video mode):
  - Multi-angle: the same prompt from up to 5 camera angles (front, side, three-quarter, back, close-up — three pre-checked) in one send. The button says "Render {n} angles" and the receipt's Total quotes the full fan-out price before anything is spent.
  - Storyboard (Kling O3 Pro engine only; Studio and Elite plans): chains 2-6 shots into one clip, each shot with its own prompt and length, 30 seconds total cap.
  - Cinema Studio: give one idea; it plans the scene as a shot list — every shot, length and credit quoted before anything renders.
  - Frames (Kling engine only; Studio and Elite plans): a start and/or end image for the clip; the same panel offers multi-image reference — 2-4 photos of the character to anchor identity harder.
  - Multi-angle and Cinema Studio need a paid plan or bonus credits (each is several renders in one click, so neither is part of the free trial).
- DIALOGUE row (speech-bubble icon, characters with a voice): type the line and the character says it, voiced and lip-synced. Surcharge: 1 credit per ${(() => {
    // Derive "N seconds per credit" from the real weight function: the
    // smallest duration that still costs exactly one credit.
    let s = 1;
    while (getDialogueCreditWeight(s + 1) === 1) s += 1;
    return s;
  })()} seconds of the clip, shown in the receipt. Not available on the free daily generation.
- ENHANCE: the button by the prompt box that rewrites the prompt with the pipeline's engineering and SHOWS the result before it is used. Each plan has its own prompt-assist allowance (free accounts get a small lifetime allowance).
- THE ASSISTANT (that is you): the switch strip inside the composer, under the prompt box. When it is on, questions go to you and shot descriptions still render — the send button shows which will happen before pressing: ochre "Ask" for a question, "Render" for a shot (the price lives in the receipt's Total, not on the button). Asking never spends render credits — it uses a separate chat allowance: free accounts have a lifetime allowance of roughly 15-20 questions (Faster mode only); paid plans have monthly chat budgets, and the Faster/Smarter toggle picks depth — Smarter is paid-plans-only and uses several times more of the allowance per question.
- Attachments: an image added via the + menu is a neutral REFERENCE — the prompt says how to use it. With a character selected it never replaces the character's face; with no character (or no usable saved photo), the attached photo itself becomes the face — the receipt's Face line says which.

CHARACTERS (the cast).
- A character = identity photos + traits, saved once and reused everywhere. Create one from the Characters page; more reference photos fill the lock-strength meter.
- PERSPECTIVE button on a character: one tap renders a reference sheet — front, three-quarter, profile, full body, in that order — filling the remaining slots up to the 5-photo cap (needs at least one saved photo to anchor to).
- OUTFIT: up to 2 outfit photos saved on the character; the composer's Outfit chip (on by default) carries it on solo-character, non-Storyboard sends — Seedance and image renders attach the actual photo, other engines carry a written description of it.
- BRAND RULES (Settings → Brand rules): account-wide always/never rules ("never show competitor logos") applied to every send, scoped to images, videos or both, with block/warn severity. A prompt that would break a blocking rule is stopped BEFORE anything renders — the pipeline rewrites and retries, and if every attempt trips the rule the send fails (those failures refund automatically); warn-level rules only log. "Generate anyway" sends past a block once, deliberately.
- Casts: multi-character scenes support up to 4 characters in one render.

SCORING AND RELIABILITY.
- Images made with a character on a PAID account are scored 0-100 against the character's first identity photo by a vision model; the score prints on the result. Free-tier images are not scored. Videos are scored from a middle frame where available (free tier included). "Unscored" means nothing measured it, never that it is bad.
- When the identity quality gate is enabled, a paid image that scores under the bar re-renders once automatically at no extra charge and the better attempt is delivered; if both stay under, the credit is put back automatically. Videos are scored but never auto-re-rendered.
- Refunds: failures that provably cost nothing — a brand-rules block, a provider refusal with nothing billed, a double identity miss, stopping during prompt compile — are refunded automatically. For anything else, contact support and the credit is granted back to the account. There is no self-serve refund button.
- Refused requests (content rules) do not use credits — unless the person was warned about that exact refusal and sent anyway.

CREDITS, PLANS AND THE FREE TIER.
- 1 credit ≈ 1 standard video or image; premium engines cost more per the catalogue above. Credits available = the plan's monthly allowance + bonus credits, with purchased credits covering anything beyond; the balance is in the studio header.
${renderPlans()}
- CREDIT PACKS can be bought with or without a plan.
- Free accounts get ONE free generation per day (resets on the UTC day): a short, silent clip on the cheapest engine (${FREE_TIER_VIDEO_MODEL_ID}: with a character photo it runs image-to-video, without one text-to-video), or a single image. Dialogue, longer durations and other engines need a plan or purchased credits. No credit card needed.
- Plans and credits are bought at picacho.ai/pricing. In the Android app: if Settings shows a store section, plans and packs can be bought through Google Play there; otherwise the app has no purchasing and everything is bought on the website — the app signs into the same account either way.

OTHER SURFACES.
- TEMPLATES: ${TEMPLATES.length} ready-made looks, each proven with a real render. Picking one pre-fills the composer's prompt with [bracketed] slots to personalize — nothing sends until the person does; the currently selected character stars in it.
- CINEMA PRESETS (the Camera / Light & looks chips), every one validated with a real render before shipping:
${renderPresets()}
- Presets currently apply on plain Seedance video sends (not Storyboard or multi-reference — the chips clear on leaving that lane).
- HISTORY: every render ever made, including failures, with type and outcome filters; a render's page can continue its session. CONTINUE A CLIP: on a finished video in History, "Continue this clip" seeds the next render with that clip as the starting world — Seedance engines only, with an extra credit surcharge priced in the receipt before sending.
- UPSCALE (FLUX Video Upscale, precise mode — built to keep the face): "Upscale to 1080p" on a finished video's History page, or "Upscale a video" on the History list to bring any MP4 (up to 20 seconds, 50 MB, below 1080p). Costs 0.6 credits per second of the clip, rounded up (10s → 6 credits), quoted before the button; the result is a NEW take linked to its source, the original untouched, and it carries no identity score because nothing re-measured it. If the provider refuses or the upscale is stopped, the credits come back automatically. Not part of the free daily generation. Uploaded videos pass the same content rules as everything else.
- PROJECTS: group characters by project (pin, star, archive); renders follow their character.
- COMMUNITY: a public showcase; sharing is per-render, explicit, and only ever the person's own choice.
- SETTINGS: account/profile; appearance (theme and language — English, Español, Italiano, Português; the interface is fully localized, though template and preset prompt text stays English by design); security (password); usage and billing; Brand rules; Support.
- SUPPORT: Settings → Support has a feedback form that lands straight in the team's review queue, plus a help email link. The public contact address is hello@picacho.ai.

WHEN SOMETHING GOES WRONG.
- A failed render explains itself in the session transcript, with recovery actions (retry paths — e.g. "Generate anyway" past a rules block, or switching to an engine that accepts the request). The pipeline log records what happened; you can read it in the render data above.
- "Report a problem" on any render files a report the team reviews; crashes and failed generations auto-file reports too.`;
}
