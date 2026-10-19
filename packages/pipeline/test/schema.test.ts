import { describe, expect, it } from "vitest";
import {
  LIMITS,
  STYLE_OPTIONS,
  ProjectManifestSchema,
  SceneSchema,
  StylePresetSchema,
  makeScenePlanSchema,
} from "@inkcut/shared";
import { STYLES } from "../src/styles/index.js";

const scene = {
  index: 0,
  narration: "Why do we put things off?",
  visual: "A stickman staring at a pile of homework.",
  imagePrompt: "A stick figure staring at a tall pile of papers on a desk",
  motion: "zoom_in",
};

describe("SceneSchema", () => {
  it("accepts a valid scene", () => {
    expect(SceneSchema.parse(scene)).toMatchObject(scene);
  });

  it("accepts the optional fields filled in after the voice and draw stages", () => {
    const full = { ...scene, durationSec: 4.2, audioPath: "audio/000.mp3", imagePath: "images/000.png" };
    expect(SceneSchema.parse(full).durationSec).toBe(4.2);
  });

  it("rejects an unknown motion", () => {
    expect(SceneSchema.safeParse({ ...scene, motion: "spin" }).success).toBe(false);
  });

  it("rejects empty or whitespace-only text", () => {
    expect(SceneSchema.safeParse({ ...scene, narration: "   " }).success).toBe(false);
    expect(SceneSchema.safeParse({ ...scene, imagePrompt: "" }).success).toBe(false);
  });

  it("rejects negative or fractional indexes and non-positive durations", () => {
    expect(SceneSchema.safeParse({ ...scene, index: -1 }).success).toBe(false);
    expect(SceneSchema.safeParse({ ...scene, index: 1.5 }).success).toBe(false);
    expect(SceneSchema.safeParse({ ...scene, durationSec: 0 }).success).toBe(false);
  });
});

describe("makeScenePlanSchema", () => {
  const planned = (i: number) => ({ index: i, visual: "v", imagePrompt: "p", motion: "static" });

  it("accepts exactly N scenes in order", () => {
    const schema = makeScenePlanSchema(3);
    expect(schema.parse({ characters: "Sam", scenes: [0, 1, 2].map(planned) }).scenes).toHaveLength(3);
  });

  it("rejects the wrong number of scenes", () => {
    const schema = makeScenePlanSchema(3);
    expect(schema.safeParse({ characters: "Sam", scenes: [0, 1].map(planned) }).success).toBe(false);
  });

  it("rejects scenes out of order", () => {
    const schema = makeScenePlanSchema(2);
    const r = schema.safeParse({ characters: "Sam", scenes: [planned(1), planned(0)] });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/expected index 0/);
  });

  it("joins a characters list given as an array instead of one string", () => {
    const schema = makeScenePlanSchema(1);
    expect(
      schema.parse({ characters: ["Sam: red scarf.", "Mia: blue cap."], scenes: [planned(0)] }).characters,
    ).toBe("Sam: red scarf. Mia: blue cap.");
    expect(
      schema.parse({ characters: [{ name: "Sam", look: "red scarf" }], scenes: [planned(0)] }).characters,
    ).toBe("Sam: red scarf");
  });

  it("keeps an optional animationPrompt", () => {
    const parsed = makeScenePlanSchema(1).parse({
      characters: "Sam",
      scenes: [{ ...planned(0), animationPrompt: "Sam waves" }],
    });
    expect(parsed.scenes[0]!.animationPrompt).toBe("Sam waves");
  });

  it("requires a characters description", () => {
    expect(makeScenePlanSchema(1).safeParse({ scenes: [planned(0)] }).success).toBe(false);
  });
});

describe("style presets", () => {
  it("match the options offered in the web app", () => {
    expect(Object.keys(STYLES).sort()).toEqual(STYLE_OPTIONS.map((s) => s.id).sort());
  });

  it("ships the two v1 presets and they validate", () => {
    expect(Object.keys(STYLES).sort()).toEqual(["stickman-classic", "stickman-color"]);
    for (const style of Object.values(STYLES)) expect(StylePresetSchema.parse(style)).toEqual(style);
  });
});

describe("ProjectManifestSchema", () => {
  it("rejects a topic project without a topic", () => {
    const r = ProjectManifestSchema.safeParse({
      version: 1,
      id: "x",
      createdAt: "",
      updatedAt: "",
      input: { mode: "topic", minutes: 1 },
      styleId: "stickman-classic",
      aspect: "16:9",
      voiceId: "en-US-GuyNeural",
      captions: true,
      seed: 1,
      completedStages: [],
      scenes: [],
      runs: [],
    });
    expect(r.success).toBe(false);
  });
});

describe("limits", () => {
  it("match spec §8", () => {
    expect(LIMITS.videosPerUserPerDay).toBe(3);
    expect(LIMITS.maxVideoMinutes).toBe(5);
    expect(LIMITS.maxScriptChars).toBe(6000);
    expect(LIMITS.redrawsPerUserPerDay).toBe(30);
    expect(LIMITS.maxUploadAudioSec).toBe(300);
    expect(LIMITS.maxUploadAudioBytes).toBe(25 * 1024 * 1024);
    expect(LIMITS.outputRetentionHours).toBe(48);
  });
});
