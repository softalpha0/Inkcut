/** Hand-drawn style stick figures, drawn with SVG strokes (no images to load). */

type Pose = "wave" | "think" | "point" | "walk" | "cheer" | "sit";

const ARMS: Record<Pose, string> = {
  wave: "M50 62 L32 80 M50 62 L70 40 L76 26",
  think: "M50 62 L36 84 M50 62 L64 76 L52 50",
  point: "M50 62 L34 84 M50 62 L84 58",
  walk: "M50 62 L34 82 M50 62 L66 82",
  cheer: "M50 62 L30 38 M50 62 L70 38",
  sit: "M50 62 L36 80 M50 62 L66 78",
};

const LEGS: Record<Pose, string> = {
  wave: "M50 98 L38 132 M50 98 L62 132",
  think: "M50 98 L40 132 M50 98 L60 132",
  point: "M50 98 L38 132 M50 98 L62 132",
  walk: "M50 98 L34 128 M50 98 L66 130",
  cheer: "M50 98 L36 130 M50 98 L64 130",
  sit: "M50 98 L74 100 L74 130 M50 98 L80 104 L82 130",
};

export function Stickman({
  pose = "wave",
  shirt,
  ink = "var(--color-ink)",
  className,
  size = 120,
}: {
  pose?: Pose;
  shirt?: string;
  /** Line colour, e.g. white for a chalkboard look. */
  ink?: string;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      viewBox="0 0 100 140"
      width={size * (100 / 140)}
      height={size}
      className={className}
      aria-hidden="true"
      fill="none"
      stroke={ink}
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="50" cy="30" r="17" fill="white" />
      <circle cx="44" cy="28" r="1.8" fill="var(--color-ink)" stroke="none" />
      <circle cx="56" cy="28" r="1.8" fill="var(--color-ink)" stroke="none" />
      <path d={pose === "think" ? "M44 37 Q50 35 56 37" : "M43 36 Q50 42 57 36"} strokeWidth="2.6" />
      {shirt ? <path d="M50 47 L50 98" stroke={shirt} strokeWidth="12" /> : null}
      <path d="M50 47 L50 98" />
      <path d={ARMS[pose]} />
      <path d={LEGS[pose]} />
      {pose === "think" ? (
        <g strokeWidth="2.4">
          <circle cx="78" cy="14" r="3" />
          <circle cx="86" cy="6" r="2" />
        </g>
      ) : null}
    </svg>
  );
}

/** A small whiteboard "scene" used on the landing page. */
export function SceneCard({
  children,
  label,
  tone = "white",
}: {
  children: React.ReactNode;
  label: string;
  tone?: "white" | "color";
}) {
  return (
    <figure className="overflow-hidden rounded-2xl border-2 border-ink bg-white shadow-[4px_4px_0_0_var(--color-ink)]">
      <div
        className={`relative flex aspect-video items-end justify-center gap-2 ${tone === "color" ? "bg-[#eaf4ff]" : "bg-white"}`}
      >
        {tone === "color" ? <div className="absolute inset-x-0 bottom-0 h-1/4 bg-[#dff3e4]" /> : null}
        <div className="relative flex w-full items-end justify-evenly px-[6%] pb-[6%] [&>svg]:h-auto [&>svg]:max-h-[78%] [&>svg]:w-auto [&>svg]:max-w-[30%]">
          {children}
        </div>
      </div>
      <figcaption className="border-t-2 border-ink px-3 py-2 text-sm font-semibold">{label}</figcaption>
    </figure>
  );
}
