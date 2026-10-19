import { CUSTOM_STYLE_ID } from "@inkcut/shared";
import { Stickman } from "@/components/Stickman";

/** Small preview tile for each art style (drawn with CSS + SVG, no images to load). */
const SWATCHES: Record<string, { bg: string; ink?: string; shirt?: string; extra?: string }> = {
  "stickman-classic": { bg: "bg-white" },
  "stickman-color": { bg: "bg-[#eaf4ff]", shirt: "var(--color-coral)" },
  "flat-cartoon": { bg: "bg-[#fff1c9]", shirt: "var(--color-sky)" },
  whiteboard: { bg: "bg-white", ink: "#1f3fb8", extra: "ring-2 ring-inset ring-[#d9dde3]" },
  storybook: { bg: "bg-[#fbeee6]", ink: "#7a5a4a", shirt: "#e88b8b" },
  comic: {
    bg: "bg-[#ffe066] bg-[radial-gradient(circle,#00000022_1px,transparent_1.5px)] bg-[length:6px_6px]",
    shirt: "var(--color-coral)",
  },
  chalkboard: { bg: "bg-[#1f3a2f]", ink: "#f4f1e8", shirt: "#f6d365" },
  "paper-cutout": { bg: "bg-[#f3d9b1] shadow-[inset_0_-10px_0_0_#e3b98a]", shirt: "var(--color-mint)" },
};

export function StyleSwatch({ styleId }: { styleId: string }) {
  if (styleId === CUSTOM_STYLE_ID) {
    return (
      <span className="grid size-14 shrink-0 place-items-center rounded-lg border-2 border-dashed border-ink bg-white text-2xl">
        ✎
      </span>
    );
  }
  const s = SWATCHES[styleId] ?? SWATCHES["stickman-classic"]!;
  return (
    <span
      className={`grid size-14 shrink-0 place-items-end justify-center overflow-hidden rounded-lg border-2 border-ink ${s.bg} ${s.extra ?? ""}`}
    >
      <Stickman pose="wave" size={48} shirt={s.shirt} ink={s.ink} />
    </span>
  );
}
