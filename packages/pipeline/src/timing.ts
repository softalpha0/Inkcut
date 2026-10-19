import { FPS, SCENE_MAX_SEC, SCENE_MIN_SEC, WORDS_PER_MINUTE, type WordTiming } from "@inkcut/shared";

const WORDS_PER_SEC = WORDS_PER_MINUTE / 60;
/** Scene size in words, derived from the 4–8 s target at 150 wpm (10–20 words). */
export const SCENE_MIN_WORDS = Math.round(SCENE_MIN_SEC * WORDS_PER_SEC);
export const SCENE_MAX_WORDS = Math.round(SCENE_MAX_SEC * WORDS_PER_SEC);
/** A scene may stretch this far past the max to avoid a tiny orphan scene. */
const SCENE_STRETCH_WORDS = Math.round(SCENE_MAX_WORDS * 1.3);

export function tokenize(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function countWords(text: string): number {
  return tokenize(text).filter((t) => normalizeToken(t) !== "").length;
}

export function targetWordCount(minutes: number): number {
  return Math.round(minutes * WORDS_PER_MINUTE);
}

export function estimateSpeechSec(words: number): number {
  return words / WORDS_PER_SEC;
}

/** Lowercase letters and digits only; used to match words across sources. */
export function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

const SENTENCE_END = /[.!?…]["'”’)\]]*$/;
const CLAUSE_END = /[,;:—–-]["'”’)\]]*$/;

export interface TokenRange {
  start: number;
  /** Exclusive. */
  end: number;
}

const size = (r: TokenRange) => r.end - r.start;

function splitLongPiece(tokens: string[], piece: TokenRange): TokenRange[] {
  const out: TokenRange[] = [];
  let cur = { ...piece };
  while (size(cur) > SCENE_MAX_WORDS) {
    // Prefer the latest clause break that leaves both halves reasonably sized.
    let cut = -1;
    for (let i = cur.start + SCENE_MAX_WORDS - 1; i >= cur.start + SCENE_MIN_WORDS / 2; i--) {
      if (CLAUSE_END.test(tokens[i] ?? "") && cur.end - (i + 1) >= SCENE_MIN_WORDS / 2) {
        cut = i + 1;
        break;
      }
    }
    if (cut === -1) {
      const parts = Math.ceil(size(cur) / SCENE_MAX_WORDS);
      cut = cur.start + Math.ceil(size(cur) / parts);
    }
    out.push({ start: cur.start, end: cut });
    cur = { start: cut, end: cur.end };
  }
  out.push(cur);
  return out;
}

/**
 * Groups narration tokens into scenes of 1–2 sentences, about 10–20 words
 * (4–8 s at 150 wpm). Over-long sentences are split at clause breaks.
 */
export function chunkTokens(tokens: string[]): TokenRange[] {
  const sentences: TokenRange[] = [];
  let start = 0;
  tokens.forEach((t, i) => {
    if (SENTENCE_END.test(t)) {
      sentences.push({ start, end: i + 1 });
      start = i + 1;
    }
  });
  if (start < tokens.length) sentences.push({ start, end: tokens.length });

  const pieces = sentences.flatMap((s) => splitLongPiece(tokens, s));

  const chunks: TokenRange[] = [];
  let cur: TokenRange | undefined;
  for (const piece of pieces) {
    if (!cur) {
      cur = { ...piece };
      continue;
    }
    const combined = size(cur) + size(piece);
    if (combined <= SCENE_MAX_WORDS || (size(cur) < SCENE_MIN_WORDS && combined <= SCENE_STRETCH_WORDS)) {
      cur.end = piece.end;
    } else {
      chunks.push(cur);
      cur = { ...piece };
    }
  }
  if (cur) {
    const prev = chunks[chunks.length - 1];
    if (prev && size(cur) < SCENE_MIN_WORDS / 2 && size(prev) + size(cur) <= SCENE_STRETCH_WORDS) {
      prev.end = cur.end;
    } else {
      chunks.push(cur);
    }
  }
  return chunks;
}

export function chunkNarration(text: string): string[] {
  const tokens = tokenize(text);
  return chunkTokens(tokens).map((r) => tokens.slice(r.start, r.end).join(" "));
}

/**
 * Attaches timings to the tokens of `text` (which keep their punctuation) using
 * timed words from TTS or STT, which may lack punctuation or split words
 * differently. Unmatched tokens get times interpolated from their neighbours.
 */
export function alignWords(
  text: string,
  timed: WordTiming[],
  bounds: { start: number; end: number },
): WordTiming[] {
  // Glue punctuation-only tokens ("—") onto the previous token.
  const tokens: string[] = [];
  for (const t of tokenize(text)) {
    if (normalizeToken(t) === "" && tokens.length > 0) tokens[tokens.length - 1] += ` ${t}`;
    else tokens.push(t);
  }
  const norm = timed.map((w) => normalizeToken(w.text));
  const result: (WordTiming | undefined)[] = new Array(tokens.length).fill(undefined);
  const LOOKAHEAD = 4;

  let j = 0;
  for (let i = 0; i < tokens.length && j < timed.length; i++) {
    const want = normalizeToken(tokens[i] ?? "");
    if (!want) continue;
    let matched = false;
    for (let k = j; k < Math.min(timed.length, j + LOOKAHEAD); k++) {
      // Single word, or a token the timed source split in two/three ("self-control" -> "self", "control").
      let joined = "";
      for (let span = 0; span < 3 && k + span < timed.length; span++) {
        joined += norm[k + span];
        if (joined === want) {
          const first = timed[k]!;
          const last = timed[k + span]!;
          result[i] = { text: tokens[i]!, start: first.start, end: last.end };
          j = k + span + 1;
          matched = true;
          break;
        }
        if (!want.startsWith(joined)) break;
      }
      if (matched) break;
    }
    if (!matched) {
      // The timed source may merge words ("ice cream" -> "icecream"): let it cover this token and the next ones.
      const w = timed[j];
      if (w && norm[j]!.startsWith(want)) {
        let covered = want;
        let m = i;
        while (
          m + 1 < tokens.length &&
          covered !== norm[j] &&
          norm[j]!.startsWith(covered + normalizeToken(tokens[m + 1]!))
        ) {
          m++;
          covered += normalizeToken(tokens[m]!);
        }
        if (covered === norm[j]) {
          const span = (w.end - w.start) / (m - i + 1);
          for (let q = i; q <= m; q++) {
            result[q] = {
              text: tokens[q]!,
              start: w.start + span * (q - i),
              end: w.start + span * (q - i + 1),
            };
          }
          i = m;
          j++;
        }
      }
    }
  }

  // Interpolate gaps between known timings.
  const out: WordTiming[] = [];
  let i = 0;
  while (i < tokens.length) {
    const known = result[i];
    if (known) {
      out.push(known);
      i++;
      continue;
    }
    let k = i;
    while (k < tokens.length && !result[k]) k++;
    const from = out.length ? out[out.length - 1]!.end : bounds.start;
    const to = k < tokens.length ? result[k]!.start : bounds.end;
    const slice = tokens.slice(i, k);
    const weights = slice.map((t) => normalizeToken(t).length + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = from;
    slice.forEach((tok, n) => {
      const d = (Math.max(0, to - from) * weights[n]!) / total;
      out.push({ text: tok, start: t, end: t + d });
      t += d;
    });
    i = k;
  }
  return out;
}

export interface TimelineEntry {
  startFrame: number;
  frames: number;
  startSec: number;
  durationSec: number;
}

/**
 * Converts scene start times (seconds) and the total length into whole frames.
 * Frame boundaries are rounded from absolute times, so rounding never drifts
 * and the frames sum exactly to round(total * fps).
 */
export function timelineFromStarts(startsSec: number[], totalSec: number, fps = FPS): TimelineEntry[] {
  const boundaries = [...startsSec.map((s) => Math.round(s * fps)), Math.round(totalSec * fps)];
  return startsSec.map((_, i) => {
    const startFrame = boundaries[i]!;
    const frames = boundaries[i + 1]! - startFrame;
    if (frames <= 0) throw new Error(`Scene ${i} has no frames (start ${startsSec[i]}s, total ${totalSec}s)`);
    return { startFrame, frames, startSec: startFrame / fps, durationSec: frames / fps };
  });
}

/**
 * TTS modes: scenes play back to back, each followed by `gapSec` of silence,
 * with `tailSec` of hold at the very end.
 */
export function timelineFromDurations(
  durationsSec: number[],
  gapSec: number,
  tailSec: number,
  fps = FPS,
): TimelineEntry[] {
  const starts: number[] = [];
  let t = 0;
  durationsSec.forEach((d, i) => {
    starts.push(t);
    t += d + (i < durationsSec.length - 1 ? gapSec : tailSec);
  });
  return timelineFromStarts(starts, t, fps);
}
