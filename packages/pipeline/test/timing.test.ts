import { FPS, SCENE_GAP_SEC } from "@inkcut/shared";
import { describe, expect, it } from "vitest";
import {
  SCENE_MAX_WORDS,
  SCENE_MIN_WORDS,
  alignWords,
  chunkNarration,
  countWords,
  targetWordCount,
  timelineFromDurations,
  timelineFromStarts,
} from "../src/timing.js";
import { fakeScript } from "./fakes.js";

describe("word math", () => {
  it("targets 150 words per minute", () => {
    expect(targetWordCount(1)).toBe(150);
    expect(targetWordCount(5)).toBe(750);
  });

  it("counts words, ignoring punctuation-only tokens", () => {
    expect(countWords("Hello there — friend.")).toBe(3);
  });
});

describe("chunkNarration", () => {
  it("never loses or reorders words", () => {
    const script = fakeScript(750);
    expect(chunkNarration(script).join(" ")).toBe(script.split(/\s+/).join(" "));
  });

  it("makes scenes of about 4-8 s (10-20 words) and 40-70 scenes for 5 minutes", () => {
    const chunks = chunkNarration(fakeScript(750));
    expect(chunks.length).toBeGreaterThanOrEqual(40);
    expect(chunks.length).toBeLessThanOrEqual(70);
    for (const c of chunks) {
      expect(countWords(c)).toBeLessThanOrEqual(Math.round(SCENE_MAX_WORDS * 1.3));
      expect(countWords(c)).toBeGreaterThanOrEqual(SCENE_MIN_WORDS / 2);
    }
  });

  it("cuts on sentence boundaries when sentences are short enough", () => {
    const chunks = chunkNarration(
      "One two three four five six seven eight nine ten eleven. Twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone.",
    );
    for (const c of chunks) expect(c).toMatch(/[.!?]$/);
  });

  it("splits a very long sentence at a clause break", () => {
    const long =
      "When you sit down to work and the task in front of you feels heavy and unclear, " +
      "your brain quietly looks for any way out that promises relief right now instead of later.";
    const chunks = chunkNarration(long);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toMatch(/,$/);
  });

  it("does not leave a tiny orphan scene at the end", () => {
    const chunks = chunkNarration(`${fakeScript(40)} Done.`);
    expect(countWords(chunks[chunks.length - 1]!)).toBeGreaterThan(2);
  });
});

describe("timeline", () => {
  it("frames sum exactly to the total with no rounding drift", () => {
    const durations = Array.from({ length: 50 }, (_, i) => 4 + ((i * 0.37) % 4));
    const tl = timelineFromDurations(durations, SCENE_GAP_SEC, 0.6, FPS);
    const total = durations.reduce((a, b) => a + b, 0) + SCENE_GAP_SEC * 49 + 0.6;
    expect(tl.reduce((a, t) => a + t.frames, 0)).toBe(Math.round(total * FPS));
    tl.forEach((t, i) => {
      // each scene starts within half a frame of its exact start time
      const exact = durations.slice(0, i).reduce((a, b) => a + b + SCENE_GAP_SEC, 0);
      expect(Math.abs(t.startSec - exact)).toBeLessThanOrEqual(0.5 / FPS + 1e-9);
      if (i > 0) expect(t.startFrame).toBe(tl[i - 1]!.startFrame + tl[i - 1]!.frames);
    });
  });

  it("gives each scene its audio length plus the gap", () => {
    const tl = timelineFromDurations([2, 3], 0.15, 0.6, 30);
    expect(tl[0]!.durationSec).toBeCloseTo(2.15, 1);
    expect(tl[1]!.startSec).toBeCloseTo(2.15, 1);
    expect(tl[1]!.durationSec).toBeCloseTo(3.6, 1);
  });

  it("builds an audio-mode timeline from scene start times", () => {
    const tl = timelineFromStarts([0, 4.02, 9.5], 14.1, 30);
    expect(tl.map((t) => t.startFrame)).toEqual([0, 121, 285]);
    expect(tl[2]!.frames).toBe(423 - 285);
  });

  it("rejects scenes with no frames", () => {
    expect(() => timelineFromStarts([0, 1, 1], 3, 30)).toThrow(/no frames/);
  });
});

describe("alignWords", () => {
  it("keeps punctuation from the text and timings from the timed words", () => {
    const aligned = alignWords(
      "Hello, world! Ready?",
      [
        { text: "Hello", start: 0.1, end: 0.4 },
        { text: "world", start: 0.5, end: 0.9 },
        { text: "Ready", start: 1.2, end: 1.6 },
      ],
      { start: 0, end: 2 },
    );
    expect(aligned).toEqual([
      { text: "Hello,", start: 0.1, end: 0.4 },
      { text: "world!", start: 0.5, end: 0.9 },
      { text: "Ready?", start: 1.2, end: 1.6 },
    ]);
  });

  it("handles words the timed source split in two", () => {
    const aligned = alignWords(
      "self-control matters",
      [
        { text: "self", start: 0, end: 0.3 },
        { text: "control", start: 0.3, end: 0.7 },
        { text: "matters", start: 0.8, end: 1.2 },
      ],
      { start: 0, end: 1.5 },
    );
    expect(aligned[0]).toEqual({ text: "self-control", start: 0, end: 0.7 });
    expect(aligned[1]!.start).toBe(0.8);
  });

  it("interpolates tokens the timed source is missing", () => {
    const aligned = alignWords(
      "one two three four",
      [
        { text: "one", start: 0, end: 0.5 },
        { text: "four", start: 2, end: 2.5 },
      ],
      { start: 0, end: 3 },
    );
    expect(aligned).toHaveLength(4);
    expect(aligned[1]!.start).toBeCloseTo(0.5);
    expect(aligned[2]!.end).toBeCloseTo(2);
    expect(aligned[1]!.end).toBeLessThanOrEqual(aligned[2]!.start + 1e-9);
  });

  it("falls back to spreading words over the bounds with no timings at all", () => {
    const aligned = alignWords("a bb ccc", [], { start: 1, end: 4 });
    expect(aligned[0]!.start).toBe(1);
    expect(aligned[2]!.end).toBeCloseTo(4);
  });
});
