import { describe, expect, it } from "vitest";
import {
  buildAss,
  buildCaptionLines,
  escapeAssText,
  estimateWordTimings,
  formatAssTime,
} from "../src/render/captions.js";
import { sceneCaptionLines } from "../src/render/compose.js";

const words = (text: string, start = 0, step = 0.4) =>
  text.split(" ").map((t, i) => ({ text: t, start: start + i * step, end: start + i * step + 0.3 }));

describe("formatAssTime", () => {
  it("formats H:MM:SS.cc", () => {
    expect(formatAssTime(0)).toBe("0:00:00.00");
    expect(formatAssTime(61.234)).toBe("0:01:01.23");
    expect(formatAssTime(3725.999)).toBe("1:02:06.00");
  });

  it("clamps negatives to zero", () => {
    expect(formatAssTime(-1)).toBe("0:00:00.00");
  });
});

describe("buildCaptionLines", () => {
  it("makes lines of 2-5 words", () => {
    const lines = buildCaptionLines(
      words("this is a sentence with quite a few words in it and it keeps going on"),
    );
    for (const l of lines) {
      const n = l.text.split(" ").length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it("starts each line exactly when its first word starts", () => {
    const w = words("one two three four five six seven eight", 10);
    const lines = buildCaptionLines(w);
    expect(lines[0]!.start).toBe(10);
    expect(lines[1]!.start).toBe(w[5]!.start);
  });

  it("breaks after sentence punctuation", () => {
    const lines = buildCaptionLines(words("We wait. Then we panic and rush."));
    expect(lines[0]!.text).toBe("We wait.");
  });

  it("breaks at long pauses and does not show a line during the silence", () => {
    const w = [
      { text: "before", start: 0, end: 0.3 },
      { text: "pause", start: 0.4, end: 0.7 },
      { text: "after", start: 3, end: 3.3 },
      { text: "pause", start: 3.4, end: 3.7 },
    ];
    const lines = buildCaptionLines(w);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.end).toBeLessThan(1.5);
    expect(lines[1]!.start).toBe(3);
  });

  it("lines never overlap", () => {
    const lines = buildCaptionLines(words("a b c d e f g h i j k l m n o p q r s t u v w x y z"));
    for (let i = 1; i < lines.length; i++) expect(lines[i]!.start).toBeGreaterThanOrEqual(lines[i - 1]!.end);
  });

  it("respects the max characters per line", () => {
    const lines = buildCaptionLines(words("extraordinarily complicated misunderstandings accumulate"), {
      maxChars: 22,
    });
    for (const l of lines) expect(l.text.length <= 22 || l.text.split(" ").length === 1).toBe(true);
  });
});

describe("estimateWordTimings", () => {
  it("covers exactly the given span, longer words getting more time", () => {
    const w = estimateWordTimings("a looooong b", 5, 3);
    expect(w[0]!.start).toBe(5);
    expect(w[2]!.end).toBeCloseTo(8);
    expect(w[1]!.end - w[1]!.start).toBeGreaterThan(w[0]!.end - w[0]!.start);
  });
});

describe("buildAss", () => {
  const ass = buildAss([{ text: "Hello {there}", start: 1, end: 2.5 }], {
    width: 1920,
    height: 1080,
    aspect: "16:9",
  });

  it("sets the play resolution to the video size", () => {
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("PlayResY: 1080");
  });

  it("writes one dialogue event per line with ASS times", () => {
    expect(ass).toContain("Dialogue: 0,0:00:01.00,0:00:02.50,Caption,,0,0,0,,Hello (there)");
  });

  it("uses the bundled caption font", () => {
    expect(ass).toMatch(/Style: Caption,Nunito ExtraBold,/);
  });

  it("places vertical captions higher than horizontal ones", () => {
    const v = buildAss([], { width: 1080, height: 1920, aspect: "9:16" });
    const marginV = (s: string) => Number(/Style: Caption,(?:[^,]*,){20}(\d+)/.exec(s)?.[1]);
    expect(marginV(v)).toBeGreaterThan(marginV(ass));
  });

  it("escapes override braces and backslashes", () => {
    expect(escapeAssText("a {b} c\\N")).toBe("a (b) c/N");
  });
});

describe("sceneCaptionLines", () => {
  const lines = [
    { text: "a b", start: 0, end: 1.5 },
    { text: "c d", start: 1.5, end: 3.2 },
    { text: "e f", start: 3.2, end: 5 },
  ];

  it("shifts lines into clip time and clamps them to the clip", () => {
    expect(sceneCaptionLines(lines, 3, 2)).toEqual([
      { text: "c d", start: 0, end: expect.closeTo(0.2, 5) as unknown as number },
      { text: "e f", start: expect.closeTo(0.2, 5) as unknown as number, end: 2 },
    ]);
  });

  it("drops lines outside the clip", () => {
    expect(sceneCaptionLines(lines, 0, 1.5).map((l) => l.text)).toEqual(["a b"]);
  });
});
