import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Scene } from "@inkcut/shared";
import { runPipeline } from "../src/pipeline.js";
import { Project } from "../src/project.js";
import { ForcedFailure, parseFailAt } from "../src/stages/context.js";
import { animationPromptFor, clipDurationSec, pickScenes, sceneSlotSec } from "../src/stages/animate.js";
import { silentLogger } from "../src/util/log.js";
import { ApiCallCounter } from "../src/util/metrics.js";
import { HttpError } from "../src/util/retry.js";
import { fakeMedia, fakeProviders, tempDir } from "./fakes.js";

const info = { model: "m", minDurationSec: 2, maxDurationSec: 10, pricePerSec: 0.015 };
const scene = (i: number, extra: Partial<Scene> = {}): Scene => ({
  index: i,
  narration: "n",
  visual: "Sam at a desk.",
  imagePrompt: "p",
  motion: "static",
  ...extra,
});

describe("animation planning", () => {
  it("requests whole seconds covering the scene, within the model's limits", () => {
    expect(clipDurationSec(6.3, info)).toBe(7);
    expect(clipDurationSec(1.2, info)).toBe(2);
    expect(clipDurationSec(14, info)).toBe(10);
    expect(clipDurationSec(5.0, { ...info, minDurationSec: 5, maxDurationSec: 5 })).toBe(5);
  });

  it("uses audio length plus the gap in text modes and timestamp spans in audio mode", () => {
    expect(sceneSlotSec([scene(0, { durationSec: 6 })], 0)).toBeCloseTo(6.15);
    const audio = [scene(0, { startSec: 0 }), scene(1, { startSec: 4.5 })];
    expect(sceneSlotSec(audio, 0)).toBeCloseTo(4.5);
    expect(sceneSlotSec(audio, 1, 10)).toBeCloseTo(5.5);
  });

  it("spreads a capped number of scenes evenly, including first and last", () => {
    expect(pickScenes(8, undefined)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(pickScenes(8, 3)).toEqual([0, 4, 7]);
    expect(pickScenes(8, 1)).toEqual([0]);
    expect(pickScenes(3, 10)).toEqual([0, 1, 2]);
  });

  it("falls back to the scene description when the plan has no animation prompt", () => {
    expect(animationPromptFor(scene(0, { animationPrompt: "Sam waves" }))).toMatch(/^Sam waves/);
    expect(animationPromptFor(scene(0))).toMatch(/^Sam at a desk\./);
    expect(animationPromptFor(scene(0))).toMatch(/no text/);
  });
});

async function newProject(animate?: { enabled: boolean; maxScenes?: number }) {
  return Project.create(await tempDir(), {
    id: "anim",
    input: { mode: "topic", topic: "Habits", minutes: 1 },
    styleId: "stickman-classic",
    aspect: "16:9",
    voiceId: "en-US-GuyNeural",
    captions: true,
    seed: 1,
    ...(animate ? { animate } : {}),
  });
}

function run(project: Project, failAt?: string) {
  const counter = new ApiCallCounter();
  const fakes = fakeProviders(counter, { real: false });
  const fa = parseFailAt(failAt);
  return {
    fakes,
    promise: runPipeline({
      project,
      providers: fakes.providers,
      counter,
      log: silentLogger,
      media: fakeMedia,
      ...(fa ? { failAt: fa } : {}),
    }),
  };
}

describe("animate stage", () => {
  it("does nothing without --animate", async () => {
    const project = await newProject();
    const { promise, fakes } = run(project);
    await promise;
    expect(fakes.video.calls).toBe(0);
    expect(project.manifest.scenes.every((s) => !s.videoPath)).toBe(true);
  });

  it("animates the chosen scenes with SERV's motion prompts and clip lengths that fit", async () => {
    const project = await newProject({ enabled: true, maxScenes: 3 });
    const { promise, fakes } = run(project);
    await promise;
    expect(fakes.video.calls).toBe(3);
    const animated = project.manifest.scenes.filter((s) => s.videoPath);
    expect(animated.map((s) => s.index)).toEqual(pickScenes(project.manifest.scenes.length, 3));
    for (const req of fakes.video.requests) {
      expect(req.durationSec).toBeGreaterThanOrEqual(2);
      expect(req.durationSec).toBeLessThanOrEqual(10);
      expect(req.prompt).toMatch(/no text/);
    }
  });

  it("resuming after a failure mid-animation only animates the missing scenes", async () => {
    const project = await newProject({ enabled: true });
    await expect(run(project, "animate:2").promise).rejects.toBeInstanceOf(ForcedFailure);
    const total = project.manifest.scenes.length;
    const second = run(project);
    await second.promise;
    expect(second.fakes.llm.calls).toBe(0);
    expect(second.fakes.tts.calls).toBe(0);
    expect(second.fakes.images.calls).toBe(0);
    expect(second.fakes.video.calls).toBe(total - 2);
  });

  it("can be switched on for a finished project; only animate and render run", async () => {
    const project = await newProject();
    await run(project).promise;
    project.manifest.animate = { enabled: true, maxScenes: 2 };
    const again = run(project);
    await again.promise;
    expect(again.fakes.llm.calls + again.fakes.tts.calls + again.fakes.images.calls).toBe(0);
    expect(again.fakes.video.calls).toBe(2);
  });

  it("keeps zoom/pan for a scene whose animation fails, and finishes the video", async () => {
    const project = await newProject({ enabled: true, maxScenes: 2 });
    const counter = new ApiCallCounter();
    const fakes = fakeProviders(counter, { real: false });
    fakes.video.failFor.set("000.png", new Error("content filter"));
    const result = await runPipeline({
      project,
      providers: fakes.providers,
      counter,
      log: silentLogger,
      media: fakeMedia,
    });
    expect(path.basename(result.outputPath)).toBe("final.mp4");
    const scenes = project.manifest.scenes;
    expect(scenes[0]!.videoPath).toBeUndefined();
    expect(scenes.filter((s) => s.videoPath)).toHaveLength(1);
  });

  it("stops on budget or permission errors instead of silently skipping every scene", async () => {
    const project = await newProject({ enabled: true });
    const counter = new ApiCallCounter();
    const fakes = fakeProviders(counter, { real: false });
    fakes.video.failFor.set("000.png", new HttpError(402, "budget too low"));
    await expect(
      runPipeline({ project, providers: fakes.providers, counter, log: silentLogger, media: fakeMedia }),
    ).rejects.toThrow(/budget/);
  });
});
