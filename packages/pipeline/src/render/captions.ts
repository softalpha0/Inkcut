import type { Aspect, WordTiming } from "@inkcut/shared";
import { normalizeToken } from "../timing.js";

export interface CaptionLine {
  text: string;
  start: number;
  end: number;
}

export interface CaptionOptions {
  minWords?: number;
  maxWords?: number;
  maxChars?: number;
  /** Pause that forces a line break, seconds. */
  breakGapSec?: number;
  /** How long a line lingers after its last word when nothing follows, seconds. */
  holdSec?: number;
}

/**
 * Groups absolute-timed words into caption lines of 2–5 words (spec §5.4),
 * breaking at punctuation and pauses. Each line shows from its first word's
 * start until the next line begins (or a short hold after its last word).
 */
export function buildCaptionLines(words: WordTiming[], opts: CaptionOptions = {}): CaptionLine[] {
  const minWords = opts.minWords ?? 2;
  const maxWords = opts.maxWords ?? 5;
  const maxChars = opts.maxChars ?? 32;
  const breakGap = opts.breakGapSec ?? 0.6;
  const hold = opts.holdSec ?? 0.4;

  const groups: WordTiming[][] = [];
  let cur: WordTiming[] = [];
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
  };

  words.forEach((w, i) => {
    const next = words[i + 1];
    const curText = cur.map((c) => c.text).join(" ");
    if (cur.length >= maxWords || (cur.length > 0 && curText.length + 1 + w.text.length > maxChars)) flush();
    cur.push(w);
    const endsSentence = /[.!?…]["'”’)\]]*$/.test(w.text);
    const endsClause = /[,;:—–]["'”’)\]]*$/.test(w.text);
    const pause = next ? next.start - w.end >= breakGap : true;
    if (endsSentence || pause || (endsClause && cur.length >= minWords)) flush();
  });
  flush();

  // Fold one-word lines into a neighbour when that keeps both within limits (spec: 2–5 words).
  const text = (ws: WordTiming[]) => ws.map((w) => w.text).join(" ");
  const fits = (ws: WordTiming[]) => ws.length <= maxWords && text(ws).length <= maxChars;
  const endsSentence = (w: WordTiming | undefined) => (w ? /[.!?…]["'”’)\]]*$/.test(w.text) : true);
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g]!;
    if (group.length >= minWords || groups.length === 1) continue;
    const prev = groups[g - 1];
    const next = groups[g + 1];
    if (prev && !endsSentence(prev[prev.length - 1]) && fits([...prev, ...group])) {
      prev.push(...group);
      groups.splice(g--, 1);
    } else if (next && !endsSentence(group[0]) && fits([...group, ...next])) {
      next.unshift(...group);
      groups.splice(g--, 1);
    } else if (
      prev &&
      prev.length > minWords &&
      !endsSentence(prev[prev.length - 1]) &&
      fits([prev[prev.length - 1]!, ...group])
    ) {
      // Borrow the previous line's last word: "a b c d e" + "f" -> "a b c d" + "e f".
      group.unshift(prev.pop()!);
    }
  }

  return groups.map((group, g) => {
    const start = group[0]!.start;
    const lastEnd = group[group.length - 1]!.end;
    const nextStart = groups[g + 1]?.[0]?.start;
    let end = lastEnd + hold;
    if (nextStart !== undefined && nextStart - lastEnd < breakGap) end = nextStart;
    else if (nextStart !== undefined) end = Math.min(end, nextStart);
    return { text: group.map((w) => w.text).join(" "), start, end: Math.max(end, start + 0.1) };
  });
}

/** Spreads a scene's words across its duration, weighted by length (when no timings exist). */
export function estimateWordTimings(text: string, startSec: number, durationSec: number): WordTiming[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const weights = tokens.map((t) => normalizeToken(t).length + 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = startSec;
  return tokens.map((text, i) => {
    const d = (durationSec * weights[i]!) / total;
    const w = { text, start: t, end: t + d };
    t += d;
    return w;
  });
}

/** ASS timestamp: H:MM:SS.cc (centiseconds). */
export function formatAssTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** Braces start override blocks and backslashes start escapes in ASS; neutralise both. */
export function escapeAssText(text: string): string {
  return text.replace(/\\/g, "/").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\r?\n/g, " ");
}

export const CAPTION_FONT_NAME = "Nunito ExtraBold";

export interface AssOptions {
  width: number;
  height: number;
  aspect: Aspect;
  fontName?: string;
}

export function buildAss(lines: CaptionLine[], opts: AssOptions): string {
  const vertical = opts.aspect === "9:16";
  const fontSize = vertical ? 92 : 84;
  const outline = vertical ? 6 : 5;
  const marginV = vertical ? Math.round(opts.height * 0.22) : Math.round(opts.height * 0.07);
  const marginLR = Math.round(opts.width * 0.08);
  const font = opts.fontName ?? CAPTION_FONT_NAME;

  const header = [
    "[Script Info]",
    "; Generated by Inkcut",
    "ScriptType: v4.00+",
    `PlayResX: ${opts.width}`,
    `PlayResY: ${opts.height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${font},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,2,0,1,${outline},1,2,${marginLR},${marginLR},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = lines.map(
    (l) =>
      `Dialogue: 0,${formatAssTime(l.start)},${formatAssTime(l.end)},Caption,,0,0,0,,${escapeAssText(l.text)}`,
  );
  return [...header, ...events, ""].join("\n");
}
