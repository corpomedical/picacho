import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";
import { marketingSocial } from "@/lib/i18n/metadata";
import { createClient } from "@/lib/supabase/server";

// The Picacho course — nine chapters, every step photographed on the live
// product with a drawn cursor and an ochre highlight ring on the thing you
// are told to click (the operator's original brief: "a course on how to use
// our website with screenshots with mouse pointer and everything").
//
// REBUILT 2026-09-09, from scratch. The 2026-08-25 course was reshot on
// 08-27 and then overtaken by 167 UI commits: the Stage x Control Room merge
// replaced the chat composer with a stage + loadout row, the character form
// moved Outfit and Fixed traits inside a closed "Look and voice" fold, the
// dashboard became the reel, and the featured video lane went from three
// models to four. A drift pass found 15 claims that were not merely stale
// but WRONG — two of them ("render on Seedance for exact outfits", "the
// dialogue line hides behind the advanced reveal") would send a reader to a
// refusal. Nothing from the old text survives unchecked.
//
// Shot on a real free account walking the real first-run path, in order:
// sign up, land on an empty dashboard, build one character (Maya) with a
// generated identity photo, spend the day's one free generation on the cafe
// render in chapter 3. That is deliberate — a beginner's course should show
// a beginner's account, not a power user's crowded library, and every number
// on screen (0 credits, 1 take, 100% first-try) is the account's own.
//
// Conventions, same as every guide: English-only body (shell chrome stays
// localized), one CTA band at the end, product claims verified against
// source at writing time — plan allowances from lib/plans.ts, the featured
// video lane from FEATURED_VIDEO_MODEL_IDS, the photoreal fence from
// MODEL_CAPABILITIES in lib/generations/send-plan.ts.
const TITLE = "The Picacho Course: First Login to First Take";
const DESCRIPTION =
  "Learn Picacho in nine short chapters, every step photographed on the live product: create a consistent AI character, generate images and videos that keep their face, and fix the few things that go wrong.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/guides/getting-started" },
  ...marketingSocial("/guides/getting-started", TITLE, DESCRIPTION),
};

export const dynamic = "force-dynamic";

const H2 = "font-display text-2xl font-bold tracking-[-0.02em] text-neutral-900 sm:text-3xl";
const P = "mt-3 text-[15px] leading-relaxed text-neutral-600";

type Callout = { kind: "tip" | "rule" | "warn"; text: React.ReactNode };
type Step = {
  shot?: { src: string; h?: number };
  title: string;
  body: React.ReactNode;
  callout?: Callout;
};
type Chapter = { id: string; title: string; minutes: string; lede: string; steps: Step[] };

const CALLOUT_LABEL: Record<Callout["kind"], string> = {
  tip: "Tip",
  rule: "The rule",
  warn: "Watch out",
};

const CHAPTERS: Chapter[] = [
  {
    id: "get-in",
    title: "Get in and look around",
    minutes: "5 min",
    lede:
      "Picacho keeps one person — your character — looking the same in every image and video you make. This chapter gets you an account and shows you the room you'll be working in.",
    steps: [
      {
        shot: { src: "ch1-01-homepage" },
        title: "Start on the homepage",
        body: (
          <>
            Go to picacho.ai and click <strong>Get started</strong>. There&apos;s also{" "}
            <strong>Log in</strong> and <strong>Sign up</strong> in the top right — every one of
            those buttons lands on the same form.
          </>
        ),
      },
      {
        shot: { src: "ch1-02-signup-form" },
        title: "Fill in the form",
        body: (
          <>
            Five fields: your name, your email, a username, a password, and your company if you
            have one. The username is the name other people see, and it&apos;s what your invite
            link is built from — the line underneath tells you whether the one you typed is free.
            Then tick the box and click <strong>Create account</strong>.
          </>
        ),
        callout: {
          kind: "tip",
          text: (
            <>
              Prefer not to type any of that? <strong>Continue with Google</strong> or{" "}
              <strong>Continue with Facebook</strong> at the top of the same card makes the account
              for you. Those two are the only sign-in providers today.
            </>
          ),
        },
      },
      {
        shot: { src: "ch1-03-check-email" },
        title: "Confirm your email",
        body:
          "We send you a link. Open it on the same device you signed up on — it signs you in and drops you straight into the app, so there's no need to come back to this tab.",
        callout: {
          kind: "tip",
          text: "Nothing after a minute? Check your spam folder. If an account already exists on that address, the form tells you rather than sending anything.",
        },
      },
      {
        shot: { src: "ch1-04-first-screen" },
        title: "Your first screen",
        body: (
          <>
            You land on your dashboard. It&apos;s nearly empty on purpose: a reel playing at the
            top, three cards — <strong>Create an image</strong>, <strong>Create a video</strong>,{" "}
            <strong>How it works</strong> — and a box at the bottom to type in. The counters read
            zero because you haven&apos;t made anything yet.
          </>
        ),
        callout: {
          kind: "tip",
          text: "The reel at the top is ours, not yours. Once you have a few takes of your own, your best ones play there instead.",
        },
      },
      {
        title: "The tour that opens by itself",
        body: (
          <>
            On your first visit a short walkthrough points at the things you&apos;ll need, one at a
            time, with a counter so you know how far in you are. <strong>Skip</strong> closes it and
            nothing is lost — you can replay it from the gear menu whenever you like.
          </>
        ),
      },
      {
        shot: { src: "ch1-06-sidebar" },
        title: "The sidebar is the whole app",
        body: (
          <>
            <strong>Generate</strong> is where you make things. <strong>Characters</strong> holds
            your cast, <strong>History</strong> everything you&apos;ve made,{" "}
            <strong>Templates</strong> and <strong>Community</strong> are for ideas.{" "}
            <strong>Media</strong> opens into Images and Videos, and <strong>Tools</strong> has
            Upscale video, Layers and Notes. The gear at the very bottom opens settings, your plan,
            and this course again.
          </>
        ),
      },
    ],
  },

  {
    id: "character",
    title: "Make your character",
    minutes: "10 min",
    lede:
      "A character is a name, a few photos and a few fixed details. Picacho locks that face into everything you make afterwards, so this is the one part worth doing slowly. We'll build one called Maya.",
    steps: [
      {
        shot: { src: "ch2-01-open-characters" },
        title: "Open Characters",
        body: "Click Characters in the sidebar. This is your cast — a wall of everyone you've made. On day one it's empty.",
      },
      {
        shot: { src: "ch2-02-new-character" },
        title: "Start a new one",
        body: "Click New character at the top right, or the dashed tile on the wall. Both open the same form.",
      },
      {
        shot: { src: "ch2-03-name" },
        title: "Name them",
        body: "The big line at the top of the form is the name. That's the only thing you truly have to fill in — everything below it makes the face hold better.",
        callout: {
          kind: "tip",
          text: "Name the person, not their job or their clothes. “Maya” works in every scene she'll ever appear in; what she's wearing gets its own box further down.",
        },
      },
      {
        shot: { src: "ch2-04-generate-photo" },
        title: "Give them a face",
        body: (
          <>
            Under <strong>Reference images</strong> you can click <strong>+ Add</strong> to upload
            photos from your device — up to five, and uploading is always free. No photos? Describe
            the person in the box and click <strong>Generate</strong>. A free account gets two
            AI-made character photos in total.
          </>
        ),
        callout: {
          kind: "rule",
          text: "The same person in every photo. This grid is what your character's face is measured against — mix two people in, or drop in a product shot, and the AI blends them into someone new on every render.",
        },
      },
      {
        shot: { src: "ch2-05-identity-photo" },
        title: "Your identity photo",
        body: (
          <>
            The photo lands with an <strong>IDENTITY PHOTO</strong> badge. That&apos;s the one every
            take is scored against. The small bar meter beside the portrait is the face lock: one
            photo lights one bar, and it gets stronger as you add more.
          </>
        ),
      },
      {
        shot: { src: "ch2-06-perspective" },
        title: "Or let Perspective do it",
        body: (
          <>
            <strong>Perspective</strong> renders the same person front, three-quarter, profile and
            full body in one tap — exactly the angles the meter is asking for. Each rendered photo
            uses one AI-photo allowance.
          </>
        ),
        callout: {
          kind: "warn",
          text: "A free account has two AI photos in total, so Perspective can't fill all four slots. Upload the rest yourself — that costs nothing.",
        },
      },
      {
        shot: { src: "ch2-07-outfit" },
        title: "Clothes go in Outfit, not in the photos",
        body: (
          <>
            <strong>Look and voice</strong> is folded shut under the photos — click it open. The
            first thing inside is <strong>Outfit</strong>: up to two clothing photos, and flat-lays
            or product shots are perfect because no face is needed.
          </>
        ),
        callout: {
          kind: "rule",
          text: "Faces in Reference images, clothes in Outfit. A jacket dropped into the references grid can quietly become part of the face.",
        },
      },
      {
        shot: { src: "ch2-08-traits" },
        title: "Fixed traits",
        body: (
          <>
            Hair, Outfit, Personality, Distinguishing features and Motion style are short phrases
            that ride into every prompt you write, so you never have to retype them.
          </>
        ),
        callout: {
          kind: "warn",
          text: "Traits have to describe the photos, never argue with them. If the photo shows short dark hair and the trait says “long blonde”, the model is being told to contradict its own reference — and it settles that by drawing someone else.",
        },
      },
      {
        shot: { src: "ch2-09-save" },
        title: "Save",
        body: "Click Save character. You land in the composer with your new character already picked, ready to render.",
      },
      {
        shot: { src: "ch2-10-character-page" },
        title: "Their own page",
        body: (
          <>
            Click a character on the wall any time to open their page: how many takes they&apos;re
            in, how well the face has held, when you last worked on them, and every take they
            appear in under <strong>In action</strong>. <strong>Generate with Maya</strong> jumps
            straight to a composer with her selected.
          </>
        ),
      },
    ],
  },

  {
    id: "first-image",
    title: "Your first image",
    minutes: "3 min",
    lede:
      "The composer is one screen: a dark stage at the top where takes land, a strip of this session's takes under it, and a card at the bottom where you type. Start on Image — it's the fastest way to meet your character.",
    steps: [
      {
        shot: { src: "ch3-01-composer" },
        title: "The screen",
        body: (
          <>
            The dark box is the <strong>stage</strong>, where your finished take appears.{" "}
            <strong>Takes</strong> underneath collects everything from this session. The card at the
            bottom is the composer — everything you choose before you send lives on that one row.
          </>
        ),
      },
      {
        shot: { src: "ch3-02-character-chip" },
        title: "Check who's in the scene",
        body: (
          <>
            The first chip on the composer is your character, with their photo and their face-lock
            meter. In image mode that is the whole row — the engine, clip length and frame shape
            chips only appear once you switch to video.
          </>
        ),
        callout: {
          kind: "warn",
          text: "Send with no character picked and you get a nice picture of a stranger. If a result doesn't look like your character, this is the first thing to check.",
        },
      },
      {
        shot: { src: "ch3-03-write-prompt" },
        title: "Describe the scene, not the person",
        body: (
          <>
            Write it the way you&apos;d tell a friend: <em>Maya at a sunny cafe table with a
            cappuccino, smiling at the camera, soft morning light.</em> You don&apos;t need to
            describe her face or her hair — that&apos;s what the character is for.
          </>
        ),
        callout: {
          kind: "rule",
          text: "The character carries the person; your prompt carries the scene. Spend your words on place, action, light and mood. Repeating hair and clothes in the prompt fights the photos.",
        },
      },
      {
        shot: { src: "ch3-04-send" },
        title: "Send it",
        body: (
          <>
            <strong>Enhance</strong> will rewrite your line into a fuller prompt and show it to you
            before anything is spent — useful, optional. When you&apos;re ready, press{" "}
            <strong>Render</strong>. The line underneath tells you exactly what it will cost: on a
            new account, <em>Uses today&apos;s free generation</em>.
          </>
        ),
      },
      {
        shot: { src: "ch3-05-cooking" },
        title: "Watch it work",
        body: "The composer folds down to a bar and the stage narrates the pipeline: your prompt is rewritten with the character's details folded in, checked that nothing about them was lost, then rendered. You can leave the page — it carries on without you.",
      },
      {
        shot: { src: "ch3-06-result", h: 840 },
        title: "Your take",
        body: (
          <>
            About half a minute later the image lands on the stage — same face as the reference
            photo, new scene. Hover it to download it, or open it full screen. It&apos;s also in{" "}
            <strong>Takes</strong> below the stage and in <strong>History</strong> for good.
          </>
        ),
        callout: {
          kind: "tip",
          text: "Once you're rendering on credits, takes carry an identity score — how close the face came to your character's photo. The one free render a day is deliberately left unscored, so it can never cost you the slot twice.",
        },
      },
      {
        shot: { src: "ch3-07-templates" },
        title: "Want a head start?",
        body: (
          <>
            <strong>Templates</strong> in the sidebar are finished prompts with sample pictures —
            headshots, magazine covers, product shots, seasonal cards. Pick one, swap in your
            character, change the words that are meant to be changed, send.
          </>
        ),
      },
    ],
  },

  {
    id: "video",
    title: "Make a video",
    minutes: "5 min",
    lede:
      "Same composer, same character, one different chip. Video costs more than an image and takes longer, so it's worth knowing which engine you're asking and what it's good at.",
    steps: [
      {
        shot: { src: "ch4-01-video-mode" },
        title: "Switch to Video",
        body: (
          <>
            The <strong>+</strong> button beside the prompt opens a short menu:{" "}
            <strong>Upload files</strong>, <strong>Saved prompts</strong>,{" "}
            <strong>Create image</strong>, <strong>Create video</strong>. Pick{" "}
            <strong>Create video</strong>. The composer keeps its shape — character, engine,
            length, frame shape — and a small chip beside the button now reads <em>Video</em>.
          </>
        ),
      },
      {
        shot: { src: "ch4-02-engine" },
        title: "Choose an engine",
        body: (
          <>
            Four are featured: <strong>Seedance 2.0</strong>, <strong>Kling O3 Pro</strong>,{" "}
            <strong>Gemini Omni Flash 1.1</strong> and <strong>Veo 3.1</strong>. Each shows its
            price in credits before you commit. <strong>More models</strong> opens the rest.
            On the free plan your one video a day runs on <strong>Wan Turbo</strong> — the four
            above unlock with credits, and the composer says so before you send.
          </>
        ),
        callout: {
          kind: "warn",
          text: "Both Seedance lanes refuse photoreal reference photos. If your character is a real-looking person, Picacho will say so and offer you a one-tap switch to an engine that accepts them — take the switch rather than fighting it.",
        },
      },
      {
        shot: { src: "ch4-03-length-shape" },
        title: "Length and shape",
        body: (
          <>
            The seconds chip sets clip length — Seedance 2.0 does 5, 10 or 15 seconds, and other
            engines offer their own. The two icons beside it switch between landscape and portrait.
          </>
        ),
      },
      {
        shot: { src: "ch4-04-camera-light" },
        title: "Three more controls, for when one clip isn't enough",
        body: (
          <>
            <strong>Storyboard</strong> plans the video as two to six shots, each with its own line
            and its own length. <strong>Cinema Studio</strong> turns a single idea into that shot
            list for you. <strong>Frames</strong> lets you pin the first frame — and optionally the
            last — to a photo you already have.
          </>
        ),
        callout: {
          kind: "tip",
          text: "Leave all three off for your first clip. One line, one shot, five seconds is the fastest way to learn what an engine does with your character.",
        },
      },
      {
        shot: { src: "ch4-05-video-tour" },
        title: "Video introduces itself",
        body: (
          <>
            The first time you switch to video, a short tour walks the controls that are new here —
            three stops, a counter, and <strong>Skip</strong> whenever you want. It only ever
            appears once.
          </>
        ),
      },
    ],
  },

  {
    id: "attachments",
    title: "What you attach, and what it does",
    minutes: "2 min",
    lede:
      "The same + menu has Upload files and Take photo. What Picacho does with an attachment depends on what it is and which engine is selected — and it tells you, in a line above the send button, before you spend anything.",
    steps: [
      {
        shot: { src: "ch5-01-receipt" },
        title: "Read the receipt above the button",
        body: (
          <>
            The band is labelled <strong>Send receipt — quoted before the button</strong>, and it
            is exactly that: <strong>Face: saved photo ✓</strong> if your character&apos;s photo is
            riding along, whatever else you attached, and a <strong>Total</strong> in credits. If
            something you expected is missing, it says so here — while it&apos;s still free to fix.
          </>
        ),
        callout: {
          kind: "tip",
          text: "An attached photo is not the same as your character. The character is the face Picacho locks; an attachment is a one-off reference for this take only.",
        },
      },
    ],
  },

  {
    id: "your-work",
    title: "Everything you've made",
    minutes: "2 min",
    lede: "Nothing you make is only on the stage. Three places keep it.",
    steps: [
      {
        shot: { src: "ch6-01-history" },
        title: "History",
        body: "Every take you've made, newest first, with its status and its identity score. Click one to open it.",
      },
      {
        shot: { src: "ch6-02-detail" },
        title: "The take itself",
        body: (
          <>
            The render at full size, with a download button in its corner and{" "}
            <strong>← History</strong> to get back. Scroll down for the rest: the prompt that made
            it, the engine that rendered it, and the buttons to share it to the community or delete
            it.
          </>
        ),
      },
    ],
  },

  {
    id: "community",
    title: "Community",
    minutes: "2 min",
    lede:
      "A public feed of takes people chose to share. It's the fastest way to see what a prompt can actually do — and what a well-built character looks like.",
    steps: [
      {
        shot: { src: "ch7-01-community" },
        title: "The feed",
        body: "Browse what other people made. Nothing of yours appears here unless you share it yourself.",
      },
    ],
  },

  {
    id: "credits",
    title: "Credits, plans and inviting friends",
    minutes: "3 min",
    lede:
      "A free account gets one generation a day and two AI character photos, ever. Everything past that runs on credits.",
    steps: [
      {
        shot: { src: "ch8-01-usage-plan" },
        title: "Usage & plan",
        body: (
          <>
            The gear at the bottom of the sidebar opens Settings; <strong>Usage &amp; plan</strong>{" "}
            is where your balance, your plan and your spending live. Credits are also shown in the
            top right of the composer, so you always know before you send.
          </>
        ),
      },
      {
        shot: { src: "ch8-02-invite" },
        title: "Invite friends",
        body: (
          <>
            Share your link. When someone signs up with it and makes their first take, you both get
            a bonus credit. The link is built from your username.
          </>
        ),
      },
    ],
  },

  {
    id: "troubleshooting",
    title: "When something goes wrong",
    minutes: "3 min",
    lede: "Four things account for nearly every disappointing result. All four are quick to fix.",
    steps: [
      {
        title: "“It doesn't look like my character”",
        body: (
          <>
            Check a character was selected at all — that&apos;s the usual answer. If one was, the
            face lock is probably thin: one photo is a start, but a three-quarter angle and a
            full-body shot of the same person are what make it hold. Add them and render again.
          </>
        ),
      },
      {
        title: "“The outfit came out wrong”",
        body: (
          <>
            Put the clothes in <strong>Outfit</strong> rather than describing them in the prompt,
            and make sure the <strong>Outfit</strong> trait agrees with the photo. Two photos of the
            same outfit — front and back — beat one photo every time. Two <em>different</em>{" "}
            outfits, on the other hand, give you an average of both.
          </>
        ),
      },
      {
        title: "The warnings are on your side",
        body: (
          <>
            When Picacho puts a banner in front of you — a photoreal character on an engine that
            refuses them, a missing voice on a line of dialogue — it&apos;s not being fussy. It has
            seen the combination fail, and it usually offers the fix as a single tap. Take it.
          </>
        ),
      },
      {
        shot: { src: "ch9-01-out-of-credits", h: 560 },
        title: "“It says I have no credits”",
        body: (
          <>
            A free account gets one generation a day. When it&apos;s spent, the composer says so
            plainly and tells you when it comes back — and it&apos;s explicit that your characters
            and your history stay exactly as they are. Add credits, or come back tomorrow.
          </>
        ),
      },
      {
        title: "Still stuck?",
        body: (
          <>
            Settings has a <strong>Support</strong> tab, and there&apos;s a{" "}
            <strong>Send feedback</strong> item in the gear menu. Both reach a person.
          </>
        ),
      },
    ],
  },
];

function CalloutBox({ callout }: { callout: Callout }) {
  const styles =
    callout.kind === "warn"
      ? "bg-amber-500/10 text-amber-900"
      : "bg-ochre/10 text-neutral-700";
  const labelStyles =
    callout.kind === "warn" ? "bg-amber-700 text-amber-50" : "bg-ochre text-onmedia";
  return (
    <aside className={`mt-4 flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm leading-relaxed ${styles}`}>
      <span
        className={`mt-0.5 flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${labelStyles}`}
      >
        {CALLOUT_LABEL[callout.kind]}
      </span>
      <p>{callout.text}</p>
    </aside>
  );
}

export default async function GettingStartedCourse() {
  // The dashboard's course card sends SIGNED-IN newcomers here, and the
  // closing band used to tell them "Start free" → /signup — asking someone
  // who just signed up to sign up. With a session, the band points back into
  // the studio instead; signed-out readers keep the signup CTA.
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const isLoggedIn = Boolean(data.user);

  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <section className="isolate relative overflow-hidden bg-paper">
        <div className="mx-auto max-w-3xl px-8 pb-14 pt-20 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500">
            The Picacho Course
          </p>
          <h1 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-neutral-900 sm:text-5xl">
            From first login to your first take
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-neutral-600 sm:text-base">
            Nine short chapters, every step photographed on the live product. By the end
            you&apos;ll have a character whose face survives every scene, images and videos that
            look like them, and the instincts to fix the few things that go wrong.
          </p>
          <p className="mt-4 text-xs text-neutral-500">
            Shot on a real free account, in order, on the live app. Nothing here is a mockup.
          </p>
        </div>
      </section>

      <nav className="mx-auto max-w-2xl px-8 pt-12">
        <div className="rounded-[18px] border border-neutral-100 bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400">
            Chapters
          </p>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2">
            {CHAPTERS.map((c, i) => (
              <li key={c.id}>
                <a
                  href={`#${c.id}`}
                  className="flex items-center gap-2.5 rounded-lg py-1 text-[15px] text-neutral-700 transition-colors hover:text-ochre dark:hover:text-[#e0a468]"
                >
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-ochre/10 text-xs font-bold text-ochre dark:text-[#e0a468]">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="flex-shrink-0 text-xs tabular-nums text-neutral-400">
                    {c.minutes}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>

      <article className="pb-10">
        {CHAPTERS.map((chapter, ci) => (
          <section
            key={chapter.id}
            id={chapter.id}
            className="mx-auto max-w-2xl scroll-mt-24 px-8 pt-16"
          >
            <div className="flex items-baseline gap-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre dark:text-[#e0a468]">
                Chapter {ci + 1}
              </p>
              <span className="text-xs text-neutral-400">{chapter.minutes}</span>
            </div>
            <h2 className={`mt-2 ${H2}`}>{chapter.title}</h2>
            <p className={P}>{chapter.lede}</p>

            {chapter.steps.map((step, si) => (
              <div key={si} className="mt-10">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-ochre text-sm font-bold text-onmedia">
                    {si + 1}
                  </span>
                  <h3 className="font-display text-lg font-semibold tracking-[-0.01em] text-neutral-900">
                    {step.title}
                  </h3>
                </div>
                <p className={P}>{step.body}</p>
                {step.callout && <CalloutBox callout={step.callout} />}
                {step.shot && (
                  <Image
                    src={`/course/${step.shot.src}.jpg`}
                    alt={step.title}
                    width={1440}
                    height={step.shot.h ?? 900}
                    // The first shot on the page is the LCP element; the rest
                    // stay lazy. Without `sizes`, next/image assumes the image
                    // spans the viewport and serves a ~1920px variant into a
                    // column that is never wider than the article's 672px —
                    // several times the bytes needed, thirty times over.
                    sizes="(max-width: 768px) 100vw, 672px"
                    priority={ci === 0 && si === 0}
                    className="mt-5 w-full rounded-2xl border border-neutral-200 shadow-[0_2px_12px_rgba(0,0,0,0.06)]"
                  />
                )}
              </div>
            ))}
          </section>
        ))}
      </article>

      <section className="mx-auto max-w-2xl px-8 pb-24">
        <div className="rounded-[22px] bg-slate-900 px-8 py-10 text-center">
          <h2 className="font-display text-2xl font-bold tracking-[-0.02em] text-onmedia">
            Ready to meet your character?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-300">
            One free generation every day, two free AI reference photos, no credit card. The first
            two chapters take about fifteen minutes.
          </p>
          <Link
            href={isLoggedIn ? "/app/generate" : "/signup"}
            className="mt-6 inline-flex items-center justify-center rounded-full bg-ochre px-7 py-3 text-sm font-semibold text-onmedia transition-opacity hover:opacity-90"
          >
            {isLoggedIn ? "Open the studio" : "Start free"}
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
