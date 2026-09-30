import { PRICING_TIERS } from "../pricing";
import { FREE_TIER_VIDEO_MODEL_ID, PLAN_CHAT_UNIT_LIMITS } from "../plans";
import { getDialogueCreditWeight } from "../generations/providers/video-models";
import { CINEMA_PRESETS, isProvenPreset } from "../generations/cinema-presets";
import { TEMPLATES } from "../templates";
import { UPSCALE_TIERS, upscaleCreditCost } from "../generations/upscale";
import { LAYERS_TIERS, LAYERS_TIER_ORDER } from "../generations/layers";
import { LIVE_LENGTHS, liveCreditsFor } from "../live/live";
import { ASSISTANT_TOPUPS } from "./topups";

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
- THE COMPOSER'S ASSISTANT: the switch strip inside the composer, under the prompt box. When it is on, questions go to you and shot descriptions still render — the send button shows which will happen before pressing: ochre "Ask" for a question, "Render" for a shot (the price lives in the receipt's Total, not on the button). Asking never spends render credits — it uses a separate chat allowance: free accounts have a lifetime allowance of roughly 15-20 questions (Faster mode only); paid plans have monthly chat budgets, and the Faster/Smarter toggle picks depth — Smarter is paid-plans-only and uses several times more of the allowance per question.
- Attachments: an image added via the + menu is a neutral REFERENCE — the prompt says how to use it. With a character selected it never replaces the character's face; with no character (or no usable saved photo), the attached photo itself becomes the face — the receipt's Face line says which.

CHARACTERS (the cast).
- A character = identity photos + traits, saved once and reused everywhere. Create one from the Characters page; more reference photos fill the lock-strength meter.
- PERSPECTIVE button on a character: one tap renders a reference sheet — front, three-quarter, profile, full body, in that order — filling the remaining slots up to the 5-photo cap (needs at least one saved photo to anchor to).
- OUTFIT: up to 2 outfit photos saved on the character; the composer's Outfit chip (on by default) carries it on solo-character, non-Storyboard sends — Seedance and image renders attach the actual photo, other engines carry a written description of it.
- BRAND RULES (Settings → Generation → Brand rules): account-wide always/never rules ("never show competitor logos") applied to every send, scoped to images, videos or both, with block/warn severity. A prompt that would break a blocking rule is stopped BEFORE anything renders — the pipeline rewrites and retries, and if every attempt trips the rule the send fails (those failures refund automatically); warn-level rules only log. "Generate anyway" sends past a block once, deliberately.
- Casts: multi-character scenes support up to 4 characters in one render.

SCORING AND RELIABILITY.
- Images made with a character on a PAID account are scored 0-100 against the character's first identity photo by a vision model; the score prints on the result. Free-tier images are not scored. Videos are scored from a middle frame where available (free tier included). "Unscored" means nothing measured it, never that it is bad.
- When the identity quality gate is enabled, a paid image that scores under the bar re-renders once automatically at no extra charge and the better attempt is delivered; if both stay under, the credit is put back automatically. Videos are scored but never auto-re-rendered.
- Refunds: failures that provably cost nothing — a brand-rules block, a provider refusal with nothing billed, a double identity miss, stopping during prompt compile — are refunded automatically. A render that fails on Picacho's side or the provider's is normally refunded automatically too, up to a daily limit per plan; a render the person stops after it has started rendering usually keeps its credit. The render data says, for each failed render, whether its credits came back. If they did not and the person thinks they should have, they write from Settings → Help (the feedback form reaches the team at once), and the team puts the credit back. There is no self-serve refund button.
- Refused requests (content rules) do not use credits, ever. That includes a refusal the person was warned about and sent into anyway: the provider turns it away before anything renders, so it costs nothing and is not charged.

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
- UPSCALE (FLUX Video Upscale, precise mode — built to keep the face): its own page under "Tools" in the sidebar (labelled "Upscale video") (upload any MP4 — up to 20 seconds, 50 MB, up to 2K input — or pick a recent take), an "Upscale" ghost button on the stage when a finished video sits there, and an "Upscale" action on a finished video's History page. Two output sizes, priced per second of the clip, rounded up: 1080p at ${UPSCALE_TIERS["1080p"].creditsPerSecond} credits/second (10s → ${upscaleCreditCost(10, "1080p")} credits) and 4K at ${UPSCALE_TIERS["4k"].creditsPerSecond} credits/second (10s → ${upscaleCreditCost(10, "4k")} credits) — which sizes are offered depends on the source's resolution (Picacho's own 720p renders get both; sharper sources get 4K only). Always quoted before the button; the result is a NEW take linked to its source, the original untouched, and it carries no identity score because nothing re-measured it. If the provider refuses or the upscale is stopped, the credits come back automatically. Not part of the free daily generation. Uploaded videos pass the same content rules as everything else.
- SETS (Helios 3D): "Helios 3D" under "Tools" in the sidebar (/app/sets), on every paid plan. Describe a location in words and Astra builds it as a real 3D set to keep and reshoot; a photo-based build is not offered to customers. On the Sets home the "Set" chip starts on the person's latest set, so words typed there go to that set (in "Ask before shooting" they are framed and nothing is spent); to build a new place, choose Set → "A new place", and the button then says "Build this place · N of M left this month". A build from words that failed (not one the service refused) has "Try again", which puts its words back in the box; a failed build never counts toward the month, and deleting a set never gives its build back. The set page has two layouts, by the screen. On a screen 1180 px wide or more, and on a phone held upright, it opens in three steps in its top bar — Set (the place, its people and things in the "In this set" list, a strip over the stage on a phone, and Astra), Shoot (four chips first: the frame's shape, "Shot size", who is in it and which camera) and Film (beats on a timeline, previz free, render takes between a start and an end frame). There the Shoot button is under the words box: with the box empty it reads "Shoot · 1 credit" (or the take and its price); with words typed it is an arrow, and a message that asks for a shot spends that price. "Advanced" in the top bar (a sliders icon on a phone) shows the rest: the camera department (formats, lenses, stops, light, looks), pose and gaze, the tools and the readouts; with it on, "Edit it yourself" under "The place" opens Build (edit the geometry), and "Classic layout" (in the top bar; on a phone, at the foot of the stage) switches that browser to the other layout. Cut (the clips in order; play and download the film as one MP4) opens from ⌘K there, or from the Classic layout (the only way on a phone). On screens between a phone and 1180 px (tablets, small windows, a phone on its side), and for anyone who picked "Classic layout", the set page is a workspace with four modes in its top bar — Build (edit the geometry), Shoot (place the figure and camera exactly; real formats, lenses, stops and light; one credit a still), Film (beats on a timeline, previz free, render takes between a start and an end frame) and Cut (the clips in order; play and download the film as one MP4) — with no "Advanced"; "New layout" (in the top bar from 1180 px; on a phone, at the foot of the stage) switches back. On a set's page, the set's own chat (Astra) frames the shot from the person's words — where they stand and face, the camera and the lens, what happens — for free. It never changes the set itself unless the person presses "Change the set" on a card that shows the month's changes left; stills and takes are priced on their buttons; and it shoots on its own only in "Shoot without asking". Aly, the personal assistant (the lamp), can read a set and fix one thing in it as a whole — stand a car back on its wheels, turn it, move it, set it on the floor — free and undoable, saved to the set's Build copy; for anything else it tells the person what to type there. Aly reads each thing by the name the set page shows, with its colour and which side of the figure it is on, so "the red car" is the red one there. The set page lists a thing by its name when the set gives it one, else as "Car", "Car 2" with its colour ("Car 2 · red"); the eye-line and a film beat's focus list one row per thing, then "Part of the set" for the set's own blocks. Set builds are capped per month by plan (Basic 1, Starter 2, Growth 5, Studio 10, Elite 25); stills, takes and films are ordinary renders priced in credits and quoted before sending; takes and films are on every paid plan. Free accounts do not have Sets; on the web, /app/sets tells them Helios 3D is part of the paid plans and links to them ("See plans"). The guide at /guides/helios explains it.
- HELIOS STUDIO (checked against the code 2026-09-29; every account that can open Helios, in all four languages): a Blender-style 3D workspace on one set — the "Studio" button in the set page's top bar (/app/sets/<id>?studio=1), "Back to the set" returns. Every car and thing of the set is its own object (the rest is "The place"), plus a stand-in and the shot camera. Blender's keys work: G/R/S move, turn, size (X/Y/Z to lock an axis, type a number), Tab Edit Mode, F3 search, ⌘Z undo, I insert a keyframe; the Timeline at the bottom plays 10 s at 24 fps. The Properties tabs on the right hold Transform, materials, modifiers (Array, Mirror), Track To, lights and sky/hour, and Physics (Active/Passive, mass, friction, bounciness → Simulate, "Bake to keyframes", Clear bake). File ▸ Export writes GLB, OBJ or STL (millimetres or metres) with a print check (size, triangles, whether it is one sealed solid; the set's block models are not). Render has Still and Video (free), Path traced still and Path traced animation (free, slower, the best-looking), and "Photo with your character · N credits" — the shot camera's frame sent through the set's own Shoot with a chosen character, the price on the button. ASTRA in the Studio's right sidebar (the "Astra" tab, N) EDITS THE 3D SCENE ONLY — she never makes a picture or video (that is Render): any request in words ("put a red lamp post left of the car, 4 m tall", "drive the car forward over 3 seconds"), she shows her plan first (Apply / Cancel), Apply is one ⌘Z, things she adds are marked ✦, she moves what she places out of walls and into the shot camera's view and says so; each request with a real step uses one of the month's Astra changes (2 Basic, 4 Starter, 10 Growth, 20 Studio, 50 Elite), a question back or a plan with nothing to do gives it back. The scene saves to the account about 5 s after a change (the status bar says "Saved to your account", or "Saved in this browser only" when it couldn't reach it) and opens the same on any device. On a phone or tablet the 3D view fills the screen, the Outliner, Properties, Astra and Timeline are sheets from the tab row at the bottom, one finger turns the view, two pinch and pan, a long press is the right-click menu. Not on a plan → no Helios, so no Studio.
- FIXING A SET BY HAND (Helios Build, checked against the code 2026-09-25; not on screens narrower than 640 px): open the set and press "Build" in its top bar; in the three-step layout (1180 px and wider), turn on "Advanced" and press "Edit it yourself" under "The place" (or ⌘K → Build). Select a block by clicking it on the stage or its row in the Scene list ("Find in the scene…", ⌘K); Esc lets go. The tools on the left rail are Select (V), Move (G, the default), Turn (R) and Size (S), with Camera, Light, Mark and Kit to add things; 1–4 switch the view (Lit, Clay, Wire, Depth). A selected block shows Position, Rotation (degrees, X then Y then Z; type a number and press Enter) and Size; "Snap" (on by default) steps 0.1 m and 15°. "Rest on the ground" sets the selected block on the floor (by its height, not its tilt). ⌘Z / ⇧⌘Z undo and redo; "Astra's original" brings the set back as first built (and can be undone); "Done — Shoot" saves and goes back to Shoot. Build edits ONE BLOCK AT A TIME — a car is about 25 blocks — so turning a whole car over by hand is slow: Aly (the lamp) turns a whole thing as one, or "Tell Astra what to change" (the prompt bar in Build) rewrites the set in words, which uses one of the month's Astra changes.
- A THING DRAWN FROM A 3D MODEL FILE (admins only for now): the model isn't in Build. In Shoot, tap the thing on the stage, or its row under "In this set" in the three-step layout, to open its card; its "3D MODEL" row has "Build it from its photo", "Load a model file", "Turn it around" (a half turn about the vertical, so it faces the other way — it does not stand an upside-down model on its wheels) and "Back to blocks". The card's "SHAPE" row has "Rebuild from its photos" (with its own Undo). A fix changes the set, not stills already taken: a new still ("Shoot · 1 credit") shows it.
- PRESS TOUR: its page is /app/press-tour (a pinned row under "Tools" in the sidebar, and a choice in the app's Generate lamp). The team is still testing it and it is not open to customers yet: say it is coming, and offer nothing from it. What it is for: a short vertical ad for the person's own product, starring their saved character. How it goes, once open: plan the shots, approve a still per shot, film them, then a press wall shows every checked moment and the person keeps, re-films (at the shot's normal price) or cuts a shot that missed; the finished ad carries a small AI-generated tag and posts from a press line only when the person presses Post.
- PROJECTS: group characters by project (pin, star, archive); renders follow their character.
- COMMUNITY (/app/community): a feed for signed-in members only of renders people chose to share, sorted "New" or "Top" (by hearts). Sharing is per render and explicit: "Share to community" on the render's History page, with an optional caption and a switch (on by default) for whether the prompt goes public too; un-sharing is one tap. Nothing there is visible to a signed-out visitor.
- THE PUBLIC GALLERY (picacho.ai/gallery, "Made with Picacho"): the showcase anyone can see. It is curated by the team only, from the team's own renders; nothing a customer makes or shares to Community can appear there.
- SETTINGS opens on an Overview: the plan, plan credits left this month and extra credits, the month's other allowances (Helios 3D sets, AI character photos, prompt assists, the assistant — each separate from credits), anything that needs attention (a failed payment, two-step verification off), and the latest invoice. Its tabs: Plan & billing (plan, credits and where this month's went, credit packs, assistant top-ups, every invoice as a PDF to download, the card and the name/address invoices are made out to — changed through Stripe's secure page); Profile (username, name, company, invite link); Generation (default engine, length, shape and sound, the AI draft switch, Brand rules); Preferences (theme and language — English, Español, Italiano, Português; the interface is fully localized, though template and preset prompt text stays English by design — plus notifications and emails); Security (password, email, two-step verification, connected accounts, devices, API keys on Elite); Privacy & data (shared posts, blocked accounts, cookies, account deletion); Help.
- INVOICES: every website payment — plan or credit pack — has an invoice in the account's language under Settings → Plan & billing. Credit packs bought before 23 August 2026 came with a receipt only; for an invoice, the person writes to the team (hello@picacho.ai). Purchases made in the Android app are sold and receipted by Google Play.
- SUPPORT: Settings → Help has a feedback form that lands straight in the team's review queue, plus a help email link. The public contact address is hello@picacho.ai.

ALY — THE PERSONAL ASSISTANT IN THE LAMP (checked against the code 2026-09-28).
- Who has her: admins, and any account the team has granted her to (any plan, even free). Opening her to every Elite account is a switch the team hasn't turned on yet: say she is coming to Elite, never that an Elite account has her.
- The lamp: a small glass lamp with her light inside, on every page, bottom-right. Tap it to open her; drag it anywhere; throw it at a corner and it parks there, throw it at a side of the screen and it slides half behind it with its light still on (a mouse over it makes it peek out; on a phone only the left and right sides take it); drop it on the × that appears while dragging to hide it ("Undo" follows). Settings → Preferences → Your assistant has "Show the lamp" / "Hide it" and "Back to the corner".
- The wheel: opening her grows a wheel out of the lamp — Filament (an arc of light, each control named) or Blossom (five petals), the person's pick in Settings. Its five controls: Talk (hands-free voice on or off), Read aloud (speak her answers), Notes, Start fresh, and Name and voice (straight to Settings). An inner arc or ring fills with the month's use of her allowance; "Limit reached" when it's full, or "Top-up N left" while a top-up carries on past it.
- How the chat shows: Subtitles (the default: her words across the bottom of the screen like a film's, the part not yet spoken dimmed, the person's last words above) or Floating card (the conversation in a card rising from the lamp), picked in Settings under "Its chat". In Subtitles, "Whole chat" opens the full card; Notes always open as the card.
- Talking to her: Talk starts hands-free voice, like a voice call — it stays on across pages until the person presses "End" (beside the lamp when her chat is closed) or asks her to stop; talking over her stops her. She ignores speech that wasn't meant for her (a video, someone else) and shows it as "Not for me" with an "Answer it" button in case she got it wrong. Push to talk, for anyone who doesn't want an open mic: hold the lamp still for a moment, or hold the push-to-talk key (right Option on a Mac, right Alt on Windows by default; changeable or off in Settings → "Push-to-talk key"), speak, and let go to send; the mic is open only while held. Push to talk works only while Picacho's tab has the keyboard.
- Her voice, name, look, wheel, chat and personality are all in Settings → Preferences → Your assistant: the voice from a list (▶ plays her saying hello), a name (Aly by default, or any name up to 24 characters), three looks for the lamp (Two fireflies, Eclipse, The original perfected), the wheel, the chat style, and the personality (Default, Sarcastic or Rude).
- Notes: what she remembers about the person's work, always visible, editable and deletable in her Notes. "Start fresh" clears the conversation; notes stay.
- Taking them there (2026-09-29): she knows every page (the SITE MAP), opens the page they ask about or need, and rings the exact button, tab or switch with her light; from the lamp she can also read what is on their screen (never what is typed into a field). She never presses anything: the person does. From her chat page, opening a page leaves the chat (it stays in the list).
- Her chat page (/app/chat, "Aly" in the sidebar and under More in the phone app): Aly full-screen, like ChatGPT, on every plan while the team has it switched on; the same notes as the lamp.
- Her allowance: a monthly allowance in units, shared with the composer's assistant (the same pool). An answer costs what it actually cost to run — typically one to three units, more when she looks at a render or searches the web. Basic ${PLAN_CHAT_UNIT_LIMITS.basic.toLocaleString("en-US")} units a month, Starter ${PLAN_CHAT_UNIT_LIMITS.starter.toLocaleString("en-US")}, Growth ${PLAN_CHAT_UNIT_LIMITS.growth.toLocaleString("en-US")}, Studio ${PLAN_CHAT_UNIT_LIMITS.studio.toLocaleString("en-US")}, Elite ${PLAN_CHAT_UNIT_LIMITS.elite.toLocaleString("en-US")}; an account granted Aly gets Elite's allowance on any plan.
- Topping up (when the month's allowance runs out): ${ASSISTANT_TOPUPS.map((t) => `${t.units.toLocaleString("en-US")} units for $${t.price}`).join(", ")} (the same figures in euros in the EU; any tax is worked out at checkout). Bought on the website: from the limit message under the lamp (three buttons), from "Top up" on the assistant row of Settings → Overview, or from Settings → Plan & billing → "Top up your assistant"; each opens the checkout and comes with an invoice. Bought units are spent only after the month's own allowance is used up, feed both assistants, and stay until used (the month's refill doesn't wipe them). A full refund or a chargeback takes back whatever of that top-up is still unspent. Not sold in the Android app — there, say it's done on picacho.ai in a browser only if they ask where.

THE ANDROID APP.
- Navigation is a bottom tab bar instead of the sidebar: Home, Cast (characters), Media, the lamp in the middle, Feed (Community), History, More. The middle lamp goes straight to the composer, or, for an account that can open more than one way to make something, offers them: Generate Video first, then whichever of Recast, Press Tour, Live and Director's Cut that account can open.
- More holds the profile card (to Settings), Tools (Templates, Upscale, Layers), Your work (Projects, Notes), Helios 3D (in the app it only says it opens on a computer), the course, a Share row and Settings.
- Buying in the app: plans and credit packs are sold through Google Play in Settings → Plan & billing when the app shows a store there; otherwise the app has no purchasing and everything is bought on picacho.ai. A plan bought through Play is managed in Google Play's subscriptions, not on the website, and vice versa.
- Voice needs app version 20 or later (the microphone permission arrived then; an older app says to update from Google Play).

FINDING YOUR WAY ON THE WEB.
- The sidebar: Search, Home, Generate, then "Tools", then any tools the person pinned, then Characters, Media, History, Projects, Community and a list of recent jobs. It collapses to an icon rail; on a phone it's a menu.
- "Tools" opens "Everything Picacho makes": "Make a take", "Edit what you made" and "Start and keep", only the tools this account can open, each with a pin to add it to the sidebar. A lit dot marks a tool that's new (for two weeks, or until opened).
- Search (the Search row, or Cmd/Ctrl+K anywhere) finds pages and tools by name, and the person's own projects, characters and renders.
- Home (/app): with no character yet, an example reel and "Set up your character"; after that, a reel of their best takes, "Pick up where you left off", credits left, the average identity score, their characters and recent renders.

LIBRARY PAGES.
- MEDIA (/app/media): every finished image and video in one grid, with All / Images / Videos filters. IMAGES (/app/images) and VIDEOS (/app/videos) split the same library, 60 a page. A multi-angle send shows as one tile with a count. HISTORY is the full record, failures included.
- TEMPLATES are grouped in five categories: Portrait, Product, Social, Marketing and Story.
- PROJECTS: each project card shows its cast's faces, the number of renders, the average identity score and when it was last worked on.

LAYERS (/app/layers, "Tools" → Layers; any signed-in account with credits).
- Splits one image into named, transparent PNG layers stacked in order, to change one at a time. Upload a PNG, JPEG or WebP up to 20 MB with a short side of at least 512 px, or pick a recent image (an image that is itself a split or a layer can't be split again). Sizes and prices, shown on the button ("Split — N credits"): ${LAYERS_TIER_ORDER.map((t) => `${LAYERS_TIERS[t].label} ${LAYERS_TIERS[t].credits} credits`).join(", ")}; usually 5-8 layers, the price fixed however many come back. The original is untouched and the split lands in History too.
- On the stack, any layer but the base can be re-rendered from words ("Change it — N credits": 1 credit, or 2 for a large layer); every version is kept. Layers download one by one as PNG or all at once with "Download all".

LIVE (/app/live).
- A take that streams while the person keeps directing it in typed lines. Admins can open it; paid plans once the team opens it to them (until then a paid account sees that it's part of the paid plans). It starts from a character's photo, a Helios still ("Direct it live" on a finished still) or words alone. Length is bought up front: ${LIVE_LENGTHS.map((s) => `${s} s for ${liveCreditsFor(s)} credits`).join(", ")}; quality 768p or 480p; shape 16:9, 9:16 or 1:1. "Go live · N credits" charges the length; typed directions (up to 300 characters) are applied live. "Stop" ends it early and the unused seconds come back as credits automatically. The browser's recording of the stream is what's kept in Media.

NOT OPEN TO CUSTOMERS YET — the team is still testing these; say they're coming, and offer nothing from them:
- RECAST (a saved character performs any video clip), THE VIDEO EDITOR (Director's Cut: raw footage in, a finished edit out, with a timeline and an original score), and RECCE (filmed footage read into a walkable Helios 3D set). Press Tour is covered above.

THE API (for developers, Elite; any other account only if the team switches it on).
- Documented at picacho.ai/docs/api. Keys are made in Settings → Security → "API keys" ("Create key" shows the key once — copy it then; a lost key can only be revoked and replaced). Four endpoints: list characters, make one image (1 credit, usually 20-60 seconds, with its identity score and the prompt that actually ran), fetch a result, read usage. Video isn't in the API yet. The same thing is an MCP server (picacho.ai/api/mcp, the same key) for assistants like Claude or Cursor.

ACCOUNT AND BILLING DETAILS.
- Two different dates: plan credits and the month's other allowances refill on the billing month's anniversary (Settings shows "Back to N on {date}" once they run out); the plan itself is charged on its renewal date, which for an annual plan is a year out.
- Credits used this month and what on: Settings → Plan & billing breaks the month's spend down by videos, images, Helios 3D, upscales, Layers and Recast, largest first.
- Change or cancel a website plan: "Change or cancel" on Plan & billing opens Stripe's secure page (switch plan, cancel, card, the name and address on invoices). A plan bought in the Android app is changed or cancelled in Google Play.
- Invite link: every account with a username has picacho.ai/r/{username} (Profile tab, "Copy link"); when someone signs up through it and makes their first render, both accounts get 1 extra credit that never expires.
- Promo codes: entered at checkout on picacho.ai with "Add promotion code". Purchases in the Android app have no code field.
- Delete the account: Settings → Privacy & data → the Danger zone; type the username (or the email when there's no username) to unlock "Delete my account".
- Two-step verification: Settings → Security, with an authenticator app (scan the QR code, confirm one 6-digit code); it can be turned off again while signed in.
- Languages: English, Español, Português and Italiano, in Settings → Preferences.

FREE ON THE SITE.
- The identity checker (picacho.ai/tools/identity-check): upload "The real face" and "The generated one", press "Score the match" and get a 0-100 identity score with a one-line note — "Strong match" 85 and up, "Drifting" 70-84, "Different person" under 70. The same scorer Picacho uses on every render; it works on any image, even another tool's. No account, nothing stored.
- Guides (picacho.ai/guides): Helios 3D, the Picacho course (first login to first take), AI camera movements, Seedance 2.0, and AI character consistency.

WHEN SOMETHING GOES WRONG.
- A failed render explains itself in the session transcript, with recovery actions (retry paths — e.g. "Generate anyway" past a rules block, or switching to an engine that accepts the request). The render data you are given says why each failed render failed, in the words the person saw, and whether its credits came back.
- "Report a problem" on any render files a report the team reviews; crashes and failed generations auto-file reports too.`;
}
