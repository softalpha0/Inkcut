import { LIMITS } from "@inkcut/shared";
import { describe, expect, it } from "vitest";
import {
  CreateProjectSchema,
  UpdateThumbnailSchema,
  UpdateSceneSchema,
  UploadRequestSchema,
  audioExtension,
  isAdmin,
  titleFor,
  usageSummary,
} from "../lib/validation";

const common = { styleId: "stickman-classic", aspect: "16:9", voiceId: "en-US-GuyNeural", captions: true };

describe("CreateProjectSchema", () => {
  it("accepts the three input modes", () => {
    expect(
      CreateProjectSchema.parse({ mode: "topic", topic: "Why we procrastinate", minutes: 1, ...common })
        .animate,
    ).toBe(false);
    expect(
      CreateProjectSchema.safeParse({ mode: "script", script: "word ".repeat(50), ...common }).success,
    ).toBe(true);
    expect(CreateProjectSchema.safeParse({ mode: "audio", audioPath: "u/a.mp3", ...common }).success).toBe(
      true,
    );
  });

  it("enforces spec limits: 1-5 minutes and 6,000-character scripts", () => {
    expect(
      CreateProjectSchema.safeParse({ mode: "topic", topic: "x".repeat(10), minutes: 6, ...common }).success,
    ).toBe(false);
    expect(
      CreateProjectSchema.safeParse({ mode: "topic", topic: "x".repeat(10), minutes: 0, ...common }).success,
    ).toBe(false);
    const long = CreateProjectSchema.safeParse({
      mode: "script",
      script: "a".repeat(LIMITS.maxScriptChars + 1),
      ...common,
    });
    expect(long.success).toBe(false);
    expect(long.error?.issues[0]?.message).toMatch(/6,000/);
  });

  it("rejects unknown styles and voices", () => {
    expect(
      CreateProjectSchema.safeParse({ mode: "topic", topic: "abc", minutes: 1, ...common, styleId: "anime" })
        .success,
    ).toBe(false);
    expect(
      CreateProjectSchema.safeParse({ mode: "topic", topic: "abc", minutes: 1, ...common, voiceId: "x" })
        .success,
    ).toBe(false);
  });
});

describe("other request schemas", () => {
  it("scene edits need at least one field", () => {
    expect(UpdateSceneSchema.safeParse({}).success).toBe(false);
    expect(UpdateSceneSchema.safeParse({ narration: "New line." }).success).toBe(true);
  });

  it("uploads are capped at 25 MB and must be mp3/wav/m4a", () => {
    expect(
      UploadRequestSchema.safeParse({ fileName: "a.mp3", size: LIMITS.maxUploadAudioBytes + 1 }).success,
    ).toBe(false);
    expect(audioExtension("Take 1.M4A")).toBe(".m4a");
    expect(audioExtension("voice.ogg")).toBeUndefined();
  });
});

describe("helpers", () => {
  it("only listed admins may animate", () => {
    expect(isAdmin("Me@Example.com", "me@example.com, other@x.com")).toBe(true);
    expect(isAdmin("someone@x.com", "me@example.com")).toBe(false);
    expect(isAdmin("me@example.com", "")).toBe(false);
  });

  it("summarises what is left today", () => {
    expect(usageSummary({ videosStarted: 2, redraws: 31 })).toMatchObject({ videosLeft: 1, redrawsLeft: 0 });
    expect(usageSummary(null).videosLeft).toBe(LIMITS.videosPerUserPerDay);
  });

  it("derives a short title", () => {
    const t = titleFor(
      CreateProjectSchema.parse({
        mode: "script",
        script: "one two three four five six seven eight nine ten",
        ...common,
      }),
    );
    expect(t).toBe("one two three four five six seven eight…");
  });

  it("accepts a custom style with a description and stores it trimmed", () => {
    const r = CreateProjectSchema.safeParse({
      mode: "topic",
      topic: "abc",
      minutes: 1,
      ...common,
      styleId: "custom",
      customStyle: "  1950s retro cartoon, muted colours  ",
    });
    expect(r.success).toBe(true);
    expect(r.data?.customStyle).toBe("1950s retro cartoon, muted colours");
  });

  it("rejects a custom style without a description or naming a studio", () => {
    const base = { mode: "topic", topic: "abc", minutes: 1, ...common, styleId: "custom" };
    expect(CreateProjectSchema.safeParse(base).success).toBe(false);
    const brand = CreateProjectSchema.safeParse({ ...base, customStyle: "Disney princess look" });
    expect(brand.success).toBe(false);
    expect(brand.error?.issues[0]?.message).toMatch(/describe the look/i);
  });

  it("accepts every preset style", () => {
    for (const styleId of [
      "flat-cartoon",
      "whiteboard",
      "storybook",
      "comic",
      "chalkboard",
      "paper-cutout",
    ]) {
      expect(
        CreateProjectSchema.safeParse({ mode: "topic", topic: "abc", minutes: 1, ...common, styleId })
          .success,
      ).toBe(true);
    }
  });
});

describe("UpdateThumbnailSchema", () => {
  it("accepts a short headline, a redraw, or both", () => {
    expect(UpdateThumbnailSchema.safeParse({ headline: "BANKS *LIE*" }).success).toBe(true);
    expect(UpdateThumbnailSchema.safeParse({ redraw: true }).success).toBe(true);
    expect(UpdateThumbnailSchema.safeParse({ headline: "WHY *NOW*", redraw: true }).success).toBe(true);
  });

  it("rejects an empty request and headlines that are too long", () => {
    expect(UpdateThumbnailSchema.safeParse({}).success).toBe(false);
    expect(UpdateThumbnailSchema.safeParse({ headline: "one two three four five six" }).success).toBe(false);
    expect(UpdateThumbnailSchema.safeParse({ headline: "X".repeat(40) }).success).toBe(false);
  });
});
