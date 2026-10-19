import fsp from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITS, type ProjectInput } from "@inkcut/shared";
import { runPipeline } from "../src/pipeline.js";
import { Project } from "../src/project.js";
import { ForcedFailure, parseFailAt } from "../src/stages/context.js";
import { silentLogger } from "../src/util/log.js";
import { ApiCallCounter } from "../src/util/metrics.js";
import { FakeStt, fakeMedia, fakeProviders, fakeScript, fakeWordTimings, tempDir } from "./fakes.js";

async function newProject(input: ProjectInput, outDir?: string): Promise<Project> {
  const dir = outDir ?? (await tempDir());
  return Project.create(dir, {
    id: "test-project",
    input,
    styleId: "stickman-classic",
    aspect: "16:9",
    voiceId: "en-US-GuyNeural",
    captions: true,
    seed: 42,
  });
}

function run(project: Project, opts: { failAt?: string; stt?: FakeStt } = {}) {
  const counter = new ApiCallCounter();
  const fakes = fakeProviders(counter, { real: false, ...(opts.stt ? { stt: opts.stt } : {}) });
  const failAt = parseFailAt(opts.failAt);
  const promise = runPipeline({
    project,
    providers: fakes.providers,
    counter,
    log: silentLogger,
    media: fakeMedia,
    ...(failAt ? { failAt } : {}),
  });
  return { promise, fakes, counter };
}

const THUMBS = LIMITS.thumbnailsPerVideo;

describe("resume", () => {
  it("after a forced failure at draw, resumes without calling SERV or TTS again", async () => {
    const project = await newProject({ mode: "topic", topic: "Why we procrastinate", minutes: 1 });

    const first = run(project, { failAt: "draw:2" });
    await expect(first.promise).rejects.toBeInstanceOf(ForcedFailure);
    const scenes = project.manifest.scenes.length;
    expect(scenes).toBeGreaterThan(3);
    expect(first.fakes.llm.calls).toBe(2); // script + plan
    expect(first.fakes.tts.calls).toBe(scenes);
    expect(first.fakes.images.calls).toBe(2);
    expect(project.manifest.completedStages).toEqual(["script", "plan", "voice"]);
    expect(project.manifest.runs[0]).toMatchObject({ status: "failed", apiCalls: { serv: 2, fal: 2 } });

    // Fresh process: reload from disk, as `pnpm cli --resume <id>` does.
    const reloaded = await Project.load(path.dirname(project.dir), project.id);
    const second = run(reloaded);
    const result = await second.promise;
    // Only the thumbnail stage (never reached before) calls SERV, plus its pictures.
    expect(second.fakes.llm.calls).toBe(1);
    expect(second.fakes.tts.calls).toBe(0);
    expect(second.fakes.images.calls).toBe(scenes - 2 + THUMBS);
    expect(result.apiCalls).toEqual({ fal: scenes - 2 + THUMBS, serv: 1 });
    expect(result.outputPath).toBe(reloaded.path("final.mp4"));
    expect(reloaded.manifest.completedStages).toEqual([
      "script",
      "plan",
      "voice",
      "draw",
      "animate",
      "render",
      "thumbnail",
    ]);
    expect(reloaded.manifest.runs.map((r) => r.status)).toEqual(["failed", "done"]);
  });

  it("a partial voice stage only voices the missing scenes", async () => {
    const project = await newProject({ mode: "topic", topic: "Habits", minutes: 1 });
    await expect(run(project, { failAt: "voice:3" }).promise).rejects.toBeInstanceOf(ForcedFailure);
    const scenes = project.manifest.scenes.length;

    const second = run(project);
    await second.promise;
    expect(second.fakes.llm.calls).toBe(1); // thumbnails
    expect(second.fakes.tts.calls).toBe(scenes - 3);
    expect(second.fakes.images.calls).toBe(scenes + THUMBS);
  });

  it("re-running a finished project makes no API calls", async () => {
    const project = await newProject({ mode: "topic", topic: "Sleep", minutes: 1 });
    await run(project).promise;
    const again = run(project);
    const result = await again.promise;
    expect(result.apiCalls).toEqual({});
  });

  it("script mode skips script generation and uses the script as written", async () => {
    const outDir = await tempDir();
    const project = await newProject({ mode: "script", scriptFile: "script.txt" }, outDir);
    const script = fakeScript(60);
    await fsp.writeFile(project.path("script.txt"), script);
    const { promise, fakes } = run(project);
    await promise;
    expect(fakes.llm.calls).toBe(2); // plan + thumbnails, no script
    expect(project.manifest.scenes.map((s) => s.narration).join(" ")).toBe(script);
  });

  it("audio mode transcribes once, skips TTS, and resumes without re-transcribing", async () => {
    const text = fakeScript(50);
    const words = fakeWordTimings(text);
    const durationSec = words[words.length - 1]!.end + 0.5;
    const stt = new FakeStt({ text, durationSec, words });
    const project = await newProject({ mode: "audio", audioFile: "input/voiceover.mp3" });
    await fsp.mkdir(project.path("input"), { recursive: true });
    await fsp.writeFile(project.path("input", "voiceover.mp3"), `fake audio ${durationSec}`);

    const first = run(project, { failAt: "draw:1", stt });
    await expect(first.promise).rejects.toBeInstanceOf(ForcedFailure);
    expect(stt.calls).toBe(1);
    expect(first.fakes.tts.calls).toBe(0);
    const scenes = project.manifest.scenes;
    expect(scenes[0]!.startSec).toBe(0);
    for (let i = 1; i < scenes.length; i++)
      expect(scenes[i]!.startSec!).toBeGreaterThan(scenes[i - 1]!.startSec!);

    const second = run(project, { stt });
    await second.promise;
    expect(stt.calls).toBe(1);
    expect(second.fakes.llm.calls).toBe(1); // thumbnails only
  });
});
