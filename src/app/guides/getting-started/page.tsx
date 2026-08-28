import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { MarketingHeader } from "@/components/marketing/header";
import { MarketingFooter } from "@/components/marketing/footer";

// The Picacho course (2026-08-25, operator: "a course on how to use our
// website with screenshots with mouse pointer and everything") — nine
// chapters, every step photographed on the LIVE product with a drawn-in
// cursor and highlight ring, captured on a fresh demo account (course-demo)
// so it shows exactly what a new user sees. The Maya renders in chapters 2-3
// are real generations, not mockups; the match score in chapter 6 is the
// scorer's actual output (93%). Screenshots live in public/course/ and are
// reproduced by the capture rig (see the session scratchpad's course/
// configs) whenever the UI changes enough to matter.
//
// Same conventions as every guide: English-only body (shell chrome stays
// localized), one CTA band at the end, product claims verified live. The
// course's three identity rules are the distilled lessons of real support
// cases — same person in every reference, clothes in Outfit never in
// References, traits must describe the photos.
//
// Reshot 2026-08-27 after the composer/character redesign wave: cast wall,
// character profile page (Perspective + In action), receipt strip under the
// model row, featured-models menu with "More models", cinema Presets with
// hover previews, Templates with sample pictures, Enhance/Describe chips.
// Every replaced screenshot recaptured live on the same course-demo
// account; the café render in ch3 is a fresh real generation from that
// session (its free daily slot).
export const metadata: Metadata = {
  title: "The Picacho Course: First Login to First Video",
  description:
    "Learn Picacho in nine short chapters, every step photographed on the live product: create a consistent AI character, generate images and videos that keep their face, and fix the few things that go wrong.",
  alternates: { canonical: "/guides/getting-started" },
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
type Chapter = { id: string; title: string; lede: string; steps: Step[] };

const CALLOUT_LABEL: Record<Callout["kind"], string> = {
  tip: "Tip",
  rule: "The rule",
  warn: "Watch out",
};

const CHAPTERS: Chapter[] = [
  {
    id: "welcome",
    title: "Welcome & sign-up",
    lede: "Getting into Picacho takes a minute. Here's the door.",
    steps: [
      {
        shot: { src: "ch1-01-signup-cta" },
        title: "Create your account",
        body: (
          <>
            On <b>picacho.ai</b>, click <b>Get started</b>. You can also continue with Google or
            Facebook on the next screen — same account either way.
          </>
        ),
      },
      {
        shot: { src: "ch1-02-signup-form" },
        title: "Email and password",
        body: <>Enter your email and choose a password, then confirm the address from the email we send you.</>,
      },
      {
        shot: { src: "ch1-03-welcome" },
        title: "Your first look around",
        body: (
          <>
            On first login Picacho offers a one-minute tour — take it, it points at everything this
            course covers.
          </>
        ),
        callout: {
          kind: "tip",
          text: (
            <>
              The dashboard&apos;s advice is the whole product in one line:{" "}
              <b>set up a character first — every generation is built around one.</b> That&apos;s
              Chapter 2.
            </>
          ),
        },
      },
    ],
  },
  {
    id: "character",
    title: "Your first character",
    lede: "A character is the person Picacho keeps consistent across every image and video you make. You'll create one — Maya — with an identity photo, an outfit, and traits that work with the photos instead of against them.",
    steps: [
      {
        shot: { src: "ch2-01-open-characters" },
        title: "Open Characters",
        body: (
          <>
            In the sidebar, click <b>Characters</b>. This is where every character you create lives.
          </>
        ),
      },
      {
        shot: { src: "ch2-02-new-character" },
        title: "Start a new character",
        body: (
          <>
            Your characters live on a wall of portrait cards. Click <b>New character</b> in the
            top-right corner — or the dashed <b>+ New character</b> card, same thing.
          </>
        ),
      },
      {
        shot: { src: "ch2-03-name" },
        title: "Name the person",
        body: (
          <>
            Type the character&apos;s name — we&apos;re calling ours <b>Maya</b>.
          </>
        ),
        callout: {
          kind: "tip",
          text: (
            <>
              Name the <b>person</b>, not their clothes or brand. &ldquo;Maya&rdquo; works for every
              scene she&apos;ll ever appear in; her outfit gets its own section below.
            </>
          ),
        },
      },
      {
        shot: { src: "ch2-04-generate-photo" },
        title: "No photo? Generate one",
        body: (
          <>
            If you don&apos;t have a photo, describe the person in the box and click{" "}
            <b>Generate</b> — your first two AI photos are free. If you do have photos, use{" "}
            <b>+ Add</b> instead: uploading is always free.
          </>
        ),
        callout: {
          kind: "rule",
          text: (
            <>
              Every photo in References must show the <b>same person</b>. Different people in this
              grid — or a product photo — and the AI blends them into someone new on every render.
            </>
          ),
        },
      },
      {
        shot: { src: "ch2-05-first-photo" },
        title: "Your identity photo",
        body: (
          <>
            The photo lands in References with the <b>IDENTITY PHOTO</b> badge — it anchors
            Maya&apos;s face in every generation. The lock-strength meter shows how solid the anchor
            is: add a three-quarter angle and a full-body shot of the <i>same</i> person to
            strengthen it.
          </>
        ),
      },
      {
        shot: { src: "ch2-06-outfit-slot" },
        title: "The Outfit section",
        body: (
          <>
            What Maya <b>wears</b> lives here, apart from who she <b>is</b>. Click{" "}
            <b>+ Add outfit photo</b> to upload clothing shots — product photos and flat-lays are
            perfect, no face needed.
          </>
        ),
        callout: {
          kind: "tip",
          text: (
            <>
              Use up to 2 photos of the <b>same outfit</b> (front and back, say) — not two different
              outfits. Picacho studies the photos once and writes an exact garment description used
              even by video models that can&apos;t read clothing photos directly.
            </>
          ),
        },
      },
      {
        shot: { src: "ch2-07-traits-match" },
        title: "Traits that match the photos",
        body: (
          <>
            Fixed traits ride into every prompt. Ours says <b>&ldquo;Short dark hair&rdquo;</b> —
            because that&apos;s what the photo shows.
          </>
        ),
        callout: {
          kind: "warn",
          text: (
            <>
              Traits must <b>describe your photos</b>, never fight them. If the photos show hair
              worn down and the trait says &ldquo;tied up&rdquo;, the AI is ordered to contradict
              its own reference — and it resolves that by drawing a different-looking person.
            </>
          ),
        },
      },
      {
        shot: { src: "ch2-08-save" },
        title: "Save",
        body: (
          <>
            Click <b>Save character</b>. Maya is now reusable in every image and video you make.
          </>
        ),
      },
      {
        shot: { src: "ch2-09-ready-to-generate" },
        title: "Ready to generate",
        body: (
          <>
            You land in <b>Generate</b> with Maya selected. The prompt box is where the next chapter
            begins — and note the small print under it: your first generation each day is free.
          </>
        ),
      },
      {
        shot: { src: "ch2-10-character-page" },
        title: "Your character's own page",
        body: (
          <>
            Open Maya from the wall any time: her page shows the portrait, the lock-strength meter,
            and her recent renders with their match scores under <b>In action</b> — the receipts of
            the consistency promise. <b>Generate with Maya</b> jumps straight to a composer with her
            selected.
          </>
        ),
        callout: {
          kind: "tip",
          text: (
            <>
              The <b>Perspective</b> button is the fast way to a strong lock: one tap renders her
              front, three-quarter, profile and full-body reference photos — the exact angles the
              meter asks for — instead of prompting each one by hand. Each photo uses one of your
              free AI-photo allowances.
            </>
          ),
        },
      },
    ],
  },
  {
    id: "first-image",
    title: "Your first image",
    lede: "Images are the fastest, cheapest way to meet your character. One prompt, about half a minute, and Maya looks back at you.",
    steps: [
      {
        shot: { src: "ch3-01-pick-character" },
        title: "Pick your character",
        body: (
          <>
            Click the character selector at the top of the composer and choose <b>Maya</b>. Her
            saved face photo now anchors everything this chat generates.
          </>
        ),
        callout: {
          kind: "tip",
          text: (
            <>
              Skipping this gives you a <i>generic</i> render — a nice picture of a stranger. If
              your result doesn&apos;t look like your character, the first thing to check is whether
              one was selected at all.
            </>
          ),
        },
      },
      {
        shot: { src: "ch3-02-write-prompt" },
        title: "Describe the scene, not the person",
        body: (
          <>
            Type what&apos;s <b>happening</b>: &ldquo;Maya at a sunny cafe table with a cappuccino,
            smiling at the camera, soft morning light.&rdquo; Her face comes from the photo; her
            outfit and hair come from the character sheet.
          </>
        ),
        callout: {
          kind: "rule",
          text: (
            <>
              <b>The photos own the person — the prompt owns the scene.</b> Spend your words on
              place, action, light and mood, and identity stays locked. Short on words? The{" "}
              <b>Enhance</b> chip next to send rewrites your prompt into a richer version you
              approve before anything is spent.
            </>
          ),
        },
      },
      {
        shot: { src: "ch3-03-send" },
        title: "Send it",
        body: <>Click the send button. Today&apos;s free generation covers this one.</>,
      },
      {
        shot: { src: "ch3-04-cooking" },
        title: "Watch Picacho work",
        body: (
          <>
            The pipeline card narrates while it works, in three steps: <b>Draft</b> — AI rewrites
            your prompt with the character&apos;s rulebook folded in; <b>Validate</b> — checks
            nothing about your character was lost; <b>Generate</b> — the image model renders,
            anchored to Maya&apos;s photo.
          </>
        ),
      },
      {
        shot: { src: "ch3-05-result", h: 840 },
        title: "The result",
        body: (
          <>
            About half a minute later the image lands in the chat — same face as the reference
            photo, new scene — and the finished card keeps the whole story: the exact drafted
            prompt, the validation, and which model rendered it. It also appears in the Takes rail
            on the right and in History.
          </>
        ),
      },
      {
        shot: { src: "ch3-06-download", h: 720 },
        title: "Save it",
        body: (
          <>
            Hover the image and click the <b>download</b> button in its corner. On the phone app the
            same button opens the share sheet — save to Photos, send to WhatsApp, anywhere.
          </>
        ),
      },
      {
        shot: { src: "ch3-07-templates" },
        title: "Want a head start? Templates",
        body: (
          <>
            The <b>Templates</b> page in the sidebar is a gallery of ready-made scenes — LinkedIn
            headshot, magazine cover, product shots, seasonal cards — each with a sample picture of
            what it produces. Tap <b>Use template</b>, tweak the words in [brackets], and send. Your
            character, their scene.
          </>
        ),
      },
    ],
  },
  {
    id: "videos",
    title: "Making videos",
    lede: "Videos work exactly like images — pick a character, describe the scene — with one new decision: which video model. It's a real decision, because they cost and behave differently.",
    steps: [
      {
        shot: { src: "ch4-01-video-mode" },
        title: "Switch to video",
        body: (
          <>
            From the dashboard choose <b>Create a video</b>, or switch inside the composer — the
            model joins your character in the bar at the top, with the price per clip and the
            duration choices riding alongside.
          </>
        ),
      },
      {
        shot: { src: "ch4-02-models" },
        title: "Choose your model — the honest guide",
        body: (
          <>
            Click the model row: three featured picks come first, each with its one-line truth.{" "}
            <b>Kling O3 Pro (reference)</b> — the strongest face lock, anchors to your
            character&apos;s photo without copying its pose. <b>Seedance 2.0</b> — the best
            all-rounder: it&apos;s the one whose renders can match a saved outfit <i>exactly</i>{" "}
            (it accepts the outfit photo itself — see Chapter 2), it powers the camera Presets
            below, and it goes up to 30 seconds. <b>Veo 3.1</b> — the premium pick, with audio, and
            the one that needs no character at all. <b>More models</b> unfolds the rest: budget{" "}
            <b>Kling 1.6</b>, <b>Kling 2.5 Turbo Pro</b>, <b>Kling O3</b> with native audio, and{" "}
            <b>Seedance 2.5</b> — illustrated and mascot characters only.
          </>
        ),
        callout: {
          kind: "tip",
          text: (
            <>
              If your character wears a specific real outfit, render on <b>Seedance 2.0</b>. On the
              Kling family the outfit rides as a written description — colors and logos land, exact
              stitching isn&apos;t guaranteed. The receipt line under the model row always tells you
              which mode you&apos;re in.
            </>
          ),
        },
      },
      {
        shot: { src: "ch4-03-advanced" },
        title: "Duration and shape",
        body: (
          <>
            Pick the clip length right on the bar (each model shows its own options — Seedance goes
            to 30s; on the phone the chips sit at the top of the model menu). For the aspect ratio, click the small <b>chevron</b> next to send: the advanced
            row unfolds with the frame shapes — landscape for YouTube, portrait for Reels and TikTok
            — and a line for spoken dialogue. Then describe the scene and send, exactly like an
            image.
          </>
        ),
        callout: {
          kind: "warn",
          text: (
            <>
              Videos cost credits (the price chip on the model row is per clip). Your daily free
              generation covers one render a day — and on the free tier it runs on <b>Kling 1.6</b>,
              whatever is selected; the note under the composer says so before you send. After that
              you&apos;ll need a plan or a credit pack from Settings.
            </>
          ),
        },
      },
      {
        shot: { src: "ch4-04-presets" },
        title: "Cinema presets",
        body: (
          <>
            On Seedance, a <b>Presets</b> button appears above the prompt: nineteen proven camera
            moves — crash zoom, dolly-in, orbit, crane reveal, bullet time and more. Point at any
            chip and it plays the actual clip that move produced, so you choose with your eyes. Tap
            to arm it, and the move rides along with whatever scene you describe.
          </>
        ),
        callout: {
          kind: "tip",
          text: (
            <>
              Every preset thumbnail is a real render, not an illustration — what you see on the
              chip is what the move does.
            </>
          ),
        },
      },
    ],
  },
  {
    id: "attachments",
    title: "Attaching photos — what it really does",
    lede: "The + button lets you attach a photo to a message. What that photo will DO depends on the model — so Picacho tells you, in writing, before you send.",
    steps: [
      {
        shot: { src: "ch5-01-attach-receipt" },
        title: "Read the receipt",
        body: (
          <>
            The small line under the model row is the <b>receipt</b> for your next send. Attach a
            photo and it says exactly what will happen — here, on Kling O3 Pro:{" "}
            <i>Face: saved photo · Attached image: described into your prompt</i>. Maya&apos;s face
            stays anchored to her saved reference, and the attachment becomes scene direction. On
            other models the same attachment can ride as the literal reference image — the receipt
            always says which, before anything is spent. An orange <b>Describe image</b> chip can
            turn the photo into written scene words for you.
          </>
        ),
        callout: {
          kind: "warn",
          text: (
            <>
              One thing an attachment should never be: the character&apos;s <b>clothes</b>. Outfit
              photos belong in the character&apos;s Outfit section (Chapter 2), where they can never
              blur who the character is.
            </>
          ),
        },
      },
    ],
  },
  {
    id: "results",
    title: "Your results",
    lede: "Everything you render is kept, scored, and one click away.",
    steps: [
      {
        shot: { src: "ch6-01-history" },
        title: "History",
        body: (
          <>
            The <b>History</b> page lists every generation with its status and — for images — a{" "}
            <b>match score</b>: Picacho&apos;s own judgment of how well the result matches your
            character&apos;s reference photos. Our café render scored 93%.
          </>
        ),
        callout: {
          kind: "tip",
          text: (
            <>
              A low match score is a signal, not bad luck: check that a character was selected, that
              the reference photos are all the same person, and that no clothing photo is sitting in
              the face slot.
            </>
          ),
        },
      },
      {
        shot: { src: "ch6-02-detail", h: 984 },
        title: "The detail page",
        body: (
          <>
            Click any render to see it full size with its full story — the exact prompt that was
            drafted, every pipeline step, and the download button. Failed attempts show <i>why</i>{" "}
            they failed, in plain language.
          </>
        ),
      },
    ],
  },
  {
    id: "community",
    title: "Community",
    lede: "See what other people make with their characters — and share your own when you're proud of one.",
    steps: [
      {
        shot: { src: "ch7-01-community" },
        title: "The feed",
        body: (
          <>
            The <b>Community</b> page opens as a grid of recent public renders. Tap any tile to view
            it full-screen.
          </>
        ),
      },
      {
        shot: { src: "ch7-02-viewer" },
        title: "The viewer",
        body: (
          <>
            Swipe or scroll to move between posts. The rail on the right: like, view count, share,
            and report. Videos autoplay muted — tap the speaker to turn sound on, and it stays on
            for every next video until you mute again. Tap the video itself to pause.
          </>
        ),
        callout: {
          kind: "tip",
          text: (
            <>
              Your own renders are private by default. They only ever appear here when <b>you</b>{" "}
              share them — from the share button on a result.
            </>
          ),
        },
      },
    ],
  },
  {
    id: "credits",
    title: "Credits, plans & inviting friends",
    lede: "What things cost, where to see your balance, and the one link that earns you credits.",
    steps: [
      {
        shot: { src: "ch8-01-settings", h: 984 },
        title: "Settings",
        body: (
          <>
            The <b>Settings</b> page (gear icon, bottom of the sidebar) shows your plan, credit
            balance, and language. Images cost 1 credit, videos vary by model and length — the
            composer always shows the price before you send. Every day, your first generation is
            free.
          </>
        ),
      },
      {
        shot: { src: "ch8-02-invite" },
        title: "Invite friends — you both get credits",
        body: (
          <>
            On the dashboard you&apos;ll find your personal invite link. When someone signs up with
            it and makes their first render, <b>you both get a bonus credit</b>. Copy it, or share
            straight from the card.
          </>
        ),
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "When it goes wrong",
    lede: "Every failure here has a boring explanation and a fast fix. These are the ones that actually happen.",
    steps: [
      {
        title: "“It doesn't look like my character”",
        body: (
          <>
            Three causes, in order of likelihood: <b>(1)</b> No character was selected for that
            generation — check the chip above the prompt. <b>(2)</b> The reference photos
            aren&apos;t all the same person — one stray photo of someone else (or a product shot)
            poisons every render. <b>(3)</b> A trait contradicts the photos — hair &ldquo;tied
            up&rdquo; over photos with hair down forces the AI to split the difference into a
            stranger. Photos own the person; make the words agree with them.
          </>
        ),
      },
      {
        title: "“The outfit came out wrong”",
        body: (
          <>
            On the Kling family, outfit photos can&apos;t ride along — the models only accept
            photos of people — so the outfit travels as a written description: close, not exact.
            For pixel-exact clothing, render on <b>Seedance 2.0</b>, where the outfit photo itself
            is attached as a reference. And keep clothing photos out of References — that&apos;s
            what the Outfit section is for.
          </>
        ),
      },
      {
        shot: { src: "ch9-01-seedance-warn" },
        title: "The warnings are on your side",
        body: (
          <>
            Picacho warns <i>before</i> credits move, not after. Pick Seedance 2.5 with a photoreal
            character and you&apos;ll see this banner with a one-tap switch to the right model. And
            the receipt line from Chapter 5 narrates every send — what anchors the face, what an
            attachment will do — so nothing about a render is a surprise.
          </>
        ),
        callout: {
          kind: "tip",
          text: (
            <>
              When a generation is blocked by your own brand rules, or rejected outright by a
              provider, your credits come back automatically — those failures are always free.
            </>
          ),
        },
      },
      {
        title: "Still stuck?",
        body: (
          <>
            Use <b>Give us your feedback</b> under the composer — a human reads it.
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
    callout.kind === "warn" ? "bg-amber-700 text-amber-50" : "bg-ochre text-white";
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
  return (
    <div className="min-h-screen bg-neutral-50">
      <MarketingHeader />

      <section className="isolate relative overflow-hidden bg-paper">
        <div className="mx-auto max-w-3xl px-8 pb-14 pt-20 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            The Picacho Course
          </p>
          <h1 className="mt-4 font-display text-4xl font-bold leading-[1.08] tracking-[-0.035em] text-slate-900 sm:text-5xl">
            From first login to your first video
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            Nine short chapters, every step photographed on the live product. By the end you&apos;ll
            have a character whose face survives every scene, images and videos that look like them,
            and the instincts to fix the few things that go wrong.
          </p>
          <p className="mt-4 text-xs text-slate-400">
            Every screenshot: the real app, a real new account, real generations.
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
                  className="flex items-center gap-2.5 rounded-lg py-1 text-[15px] text-neutral-700 transition-colors hover:text-ochre"
                >
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-ochre/10 text-xs font-bold text-ochre">
                    {i + 1}
                  </span>
                  {c.title}
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
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">
              Chapter {ci + 1}
            </p>
            <h2 className={`mt-2 ${H2}`}>{chapter.title}</h2>
            <p className={P}>{chapter.lede}</p>

            {chapter.steps.map((step, si) => (
              <div key={si} className="mt-10">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-ochre text-sm font-bold text-white">
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
          <h2 className="font-display text-2xl font-bold tracking-[-0.02em] text-white">
            Ready to meet your character?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-300">
            A free generation every day, two free AI reference photos, no credit card. The whole
            first chapter takes three minutes.
          </p>
          <Link
            href="/signup"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-ochre px-7 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Start free
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
