import { CUSTOM_STYLE_ID, LIMITS, STYLE_OPTIONS } from "@inkcut/shared";
import { Logo } from "@/components/Logo";
import { SceneCard, Stickman } from "@/components/Stickman";
import { StyleSwatch } from "@/components/StyleSwatch";
import { ButtonLink } from "@/components/ui";

const STEPS = [
  {
    title: "Give it an idea",
    body: "Type a topic, paste your own script, or upload a voiceover you recorded.",
    pose: "think" as const,
  },
  {
    title: "Inkcut writes and plans",
    body: "The narration is written and split into scenes, each with one clear moment to draw.",
    pose: "point" as const,
  },
  {
    title: "Voice, drawings, captions",
    body: "Every scene gets a natural AI voice, an illustration drawn with Pollinations AI in your chosen style, and word-by-word captions.",
    pose: "walk" as const,
  },
  {
    title: "Download the MP4",
    body: "Gentle camera motion, synced captions, ready for YouTube, Shorts, TikTok or class.",
    pose: "cheer" as const,
  },
];

const FEATURES = [
  {
    title: "3 click-worthy thumbnails",
    body: "Every video comes with three YouTube thumbnails, each a different hook. Upload all three to YouTube's Test & compare and let it pick the winner.",
  },
  {
    title: "Captions that land on the word",
    body: "Captions are timed from the voice itself, a few words at a time, burned into the video.",
  },
  {
    title: "Characters that stay themselves",
    body: "Recurring characters are described the same way in every scene, so your cast stays consistent.",
  },
  {
    title: "Wide or vertical",
    body: "16:9 for YouTube, 9:16 for Shorts, Reels and TikTok. Same video, framed for each.",
  },
  {
    title: "Fix one scene, not the whole video",
    body: "Edit a line or a drawing prompt, redraw or re-voice just that scene, then render again.",
  },
  {
    title: "Bring your own voice",
    body: "Upload a recording and Inkcut cuts scenes on your sentences and draws to match.",
  },
  {
    title: `${STYLE_OPTIONS.length} styles, or your own`,
    body: "Stickman, flat cartoon, whiteboard, storybook, comic, chalkboard, paper cut-out, or describe any cartoon look.",
  },
];

const FAQ = [
  {
    q: "Is it really free?",
    a: `Yes. Inkcut is free to use, with fair daily limits: ${LIMITS.videosPerUserPerDay} new videos and ${LIMITS.redrawsPerUserPerDay} scene redraws per day.`,
  },
  {
    q: "How long can a video be?",
    a: `Up to ${LIMITS.maxVideoMinutes} minutes. Scripts can be up to ${LIMITS.maxScriptChars.toLocaleString("en")} characters.`,
  },
  {
    q: "Can I use my own voice?",
    a: `Yes. Upload an MP3, WAV or M4A (up to ${LIMITS.maxUploadAudioSec / 60} minutes) and Inkcut draws the scenes to fit it.`,
  },
  {
    q: "Do I have to post it somewhere?",
    a: "No. You download the MP4 and post it wherever you like. Inkcut never posts for you.",
  },
  {
    q: "How long do you keep my video?",
    a: `${LIMITS.outputRetentionHours} hours after it is rendered, then it is deleted. Download it before then.`,
  },
  {
    q: "Do I get a thumbnail?",
    a: "Yes, three. Each has a different hook headline and picture in your video's style, sized 1280x720 for YouTube. Change the words or draw a new picture anytime, and download a version without text if you prefer to add your own.",
  },
  {
    q: "Can I use my own art style?",
    a: 'Yes. Choose "Custom style" and describe the look in your own words, like "1950s retro cartoon, muted colours". Describe colours, lines and mood rather than naming a studio or show.',
  },
  {
    q: "What kinds of videos work best?",
    a: "Explainers: history stories, psychology ideas, science basics, how-tos. One idea per scene, told simply.",
  },
];

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b-2 border-ink/10 bg-paper/85 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Logo />
        <div className="hidden items-center gap-7 text-sm font-semibold text-ink-2 md:flex">
          <a href="#how" className="hover:text-ink">
            How it works
          </a>
          <a href="#features" className="hover:text-ink">
            Features
          </a>
          <a href="#styles" className="hover:text-ink">
            Styles
          </a>
          <a href="#faq" className="hover:text-ink">
            FAQ
          </a>
        </div>
        <div className="flex items-center gap-2">
          <a href="/login" className="hidden px-3 text-sm font-semibold text-ink-2 hover:text-ink sm:block">
            Sign in
          </a>
          <ButtonLink href="/app/new" className="px-4 py-2 text-sm">
            Make a video
          </ButtonLink>
        </div>
      </nav>
    </header>
  );
}

function Desk() {
  return (
    <svg
      viewBox="0 0 120 80"
      width={150}
      height={100}
      aria-hidden="true"
      fill="none"
      stroke="var(--color-ink)"
      strokeWidth="4"
      strokeLinecap="round"
    >
      <path d="M6 30 H114 M18 30 V78 M102 30 V78" />
      <rect x="40" y="8" width="40" height="22" rx="3" fill="white" />
      <path d="M52 30 L48 36 M68 30 L72 36" />
    </svg>
  );
}

function Tree() {
  return (
    <svg
      viewBox="0 0 90 140"
      width={110}
      height={170}
      aria-hidden="true"
      stroke="var(--color-ink)"
      strokeWidth="4"
      strokeLinecap="round"
    >
      <path d="M45 138 V70" fill="none" />
      <circle cx="45" cy="48" r="34" fill="#9bd8a7" />
      <circle cx="30" cy="40" r="5" fill="#ff8a6b" stroke="none" />
      <circle cx="58" cy="56" r="5" fill="#ff8a6b" stroke="none" />
    </svg>
  );
}

/** The hero "video": a whiteboard frame with stickmen and cycling captions. */
function HeroVideo() {
  return (
    <div className="relative">
      <div className="absolute -inset-3 -rotate-2 rounded-[28px] bg-marker" aria-hidden="true" />
      <div className="relative overflow-hidden rounded-3xl border-2 border-ink bg-white shadow-[6px_6px_0_0_var(--color-ink)]">
        <div className="flex items-center gap-1.5 border-b-2 border-ink bg-paper-2 px-4 py-2">
          <span className="size-2.5 rounded-full bg-coral" />
          <span className="size-2.5 rounded-full bg-marker" />
          <span className="size-2.5 rounded-full bg-mint" />
          <span className="ml-3 truncate text-xs font-semibold text-muted">why-we-procrastinate.mp4</span>
        </div>
        <div className="relative aspect-video">
          <div className="absolute inset-x-[8%] bottom-[22%] h-[3px] rounded bg-ink/80" />
          <div className="absolute bottom-[22%] left-[14%] animate-bob">
            <Stickman pose="think" shirt="var(--color-sky)" size={150} />
          </div>
          <div className="absolute bottom-[22%] left-[46%]">
            <div className="flex w-16 flex-col items-center sm:w-20">
              {Array.from({ length: 7 }).map((_, i) => (
                <div
                  key={i}
                  className="h-3 w-full rounded-sm border-2 border-ink bg-white sm:h-4"
                  style={{ transform: `rotate(${(i % 2 ? 1 : -1) * (i + 1)}deg)` }}
                />
              ))}
            </div>
          </div>
          <div className="absolute bottom-[22%] right-[12%] [animation-delay:0.8s] animate-bob">
            <Stickman pose="point" shirt="var(--color-coral)" size={140} />
          </div>
          <div className="caption-cycle absolute inset-x-0 bottom-[6%] grid place-items-center">
            {["Why do we put things off?", "It's not laziness,", "it's a mood problem."].map((t) => (
              <span
                key={t}
                className="col-start-1 row-start-1 rounded-md px-2 font-display text-lg text-white [-webkit-text-stroke:3px_var(--color-ink)] [paint-order:stroke_fill] sm:text-2xl"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 border-t-2 border-ink px-4 py-2">
          <span className="text-xs">▶</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-2">
            <div className="h-full w-1/3 rounded-full bg-ink" />
          </div>
          <span className="text-xs font-semibold text-muted">0:21 / 1:02</span>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  return (
    <div className="paper-dots overflow-x-clip">
      <Nav />

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 md:grid-cols-[1.05fr_1fr] md:pt-20">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border-2 border-ink bg-white px-3 py-1 text-xs font-bold">
              <span className="size-2 rounded-full bg-mint" /> Free · no credit card
            </p>
            <h1 className="font-display text-4xl leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Turn any idea into a <span className="marker">cartoon explainer</span> video.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-ink-2">
              Type a topic, paste a script or upload your voice. Inkcut writes the narration, records the
              voice, draws every scene and edits it all into an MP4 with captions, in minutes.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/app/new" variant="marker" className="px-6 py-3 text-lg">
                Make my first video
              </ButtonLink>
              <ButtonLink href="#how" variant="ghost" className="px-6 py-3 text-lg">
                See how it works
              </ButtonLink>
            </div>
            <p className="mt-4 text-sm text-muted">
              {LIMITS.videosPerUserPerDay} free videos a day · up to {LIMITS.maxVideoMinutes} minutes each ·
              16:9 or 9:16
            </p>
          </div>
          <HeroVideo />
        </section>

        {/* How it works */}
        <section id="how" className="border-y-2 border-ink bg-white">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <h2 className="font-display text-3xl sm:text-4xl">From idea to MP4 in four steps</h2>
            <p className="mt-3 max-w-2xl text-ink-2">
              You choose the topic and the look. Inkcut does the busywork.
            </p>
            <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative rounded-2xl border-2 border-ink bg-paper p-5">
                  <span className="absolute -top-4 left-5 grid size-8 place-items-center rounded-full border-2 border-ink bg-marker font-display">
                    {i + 1}
                  </span>
                  <div className="flex h-28 items-end justify-center">
                    <Stickman pose={s.pose} size={100} />
                  </div>
                  <h3 className="mt-3 font-display text-lg">{s.title}</h3>
                  <p className="mt-1 text-sm text-ink-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="font-display text-3xl sm:text-4xl">
            Made for <span className="marker">faceless channels</span> and teachers
          </h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                // The first feature (thumbnails) is a full-width highlight above the others.
                className={`rounded-2xl border-2 border-ink p-5 shadow-[4px_4px_0_0_var(--color-ink)] ${i === 0 ? "bg-marker/40 sm:col-span-2 lg:col-span-3" : "bg-white"}`}
              >
                <h3 className="font-display text-lg">{f.title}</h3>
                <p className="mt-2 text-sm text-ink-2">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Styles */}
        <section id="styles" className="border-y-2 border-ink bg-paper-2">
          <div className="mx-auto max-w-6xl px-4 py-20">
            <h2 className="font-display text-3xl sm:text-4xl">Pick a look</h2>
            <p className="mt-3 max-w-2xl text-ink-2">
              Stickman, cartoon, whiteboard, storybook and more, or describe your own. Every scene in a video
              shares the same style and characters, so it looks like one story.
            </p>
            <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[
                ...STYLE_OPTIONS,
                { id: CUSTOM_STYLE_ID, name: "Your own style", description: "Describe any cartoon look." },
              ].map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded-xl border-2 border-ink bg-white p-2.5"
                  title={s.description}
                >
                  <StyleSwatch styleId={s.id} />
                  <span className="font-display text-sm leading-tight">{s.name}</span>
                </li>
              ))}
            </ul>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <SceneCard label="Stickman classic: black ink on white">
                <Stickman pose="point" size={170} />
                <Desk />
                <Stickman pose="think" size={160} />
              </SceneCard>
              <SceneCard label="Stickman color: flat pastel scenery" tone="color">
                <Stickman pose="cheer" shirt="var(--color-coral)" size={170} />
                <Tree />
                <Stickman pose="wave" shirt="var(--color-sky)" size={160} />
              </SceneCard>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl px-4 py-20">
          <h2 className="font-display text-3xl sm:text-4xl">Questions</h2>
          <div className="mt-8 divide-y-2 divide-ink/10 rounded-2xl border-2 border-ink bg-white">
            {FAQ.map((f) => (
              <details key={f.q} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between font-display text-lg">
                  {f.q}
                  <span className="ml-4 text-2xl transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-ink-2">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="px-4 pb-24">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 rounded-3xl border-2 border-ink bg-ink px-6 py-14 text-center text-paper shadow-[8px_8px_0_0_var(--color-marker)]">
            <Stickman pose="cheer" size={110} className="[&_*]:stroke-paper" />
            <h2 className="font-display text-3xl sm:text-4xl">Your first video is a topic away.</h2>
            <p className="max-w-xl text-paper/80">
              Sign in with your email or Google. No payment details, ever.
            </p>
            <ButtonLink href="/app/new" variant="marker" className="px-7 py-3 text-lg">
              Start free
            </ButtonLink>
          </div>
        </section>
      </main>

      <footer className="border-t-2 border-ink bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:flex-row">
          <Logo />
          <a
            href="https://pollinations.ai/?ref=badge"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 hover:text-ink"
            title="Illustrations and thumbnails are generated with Pollinations AI"
          >
            <img
              src="https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg"
              alt="Made with pollinations.ai"
              height={20}
              className="h-5 w-auto"
            />
          </a>
          <p>© {new Date().getFullYear()} Inkcut. Videos are yours to post anywhere.</p>
        </div>
      </footer>
    </div>
  );
}
