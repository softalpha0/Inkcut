import fsp from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import { Project } from "../src/project.js";
import { ffmpegPath, ffprobePath, probeDuration, runFfmpeg, runProcess } from "../src/util/ffmpeg.js";
import { silentLogger } from "../src/util/log.js";
import { ApiCallCounter } from "../src/util/metrics.js";
import { FakeStt, fakeProviders, fakeScript, fakeWordTimings, tempDir } from "./fakes.js";

/** Times (s) where sound starts after silence, i.e. each word's beep onset. */
async function beepOnsets(file: string): Promise<number[]> {
  const { stderr } = await runProcess(ffmpegPath(), [
    "-hide_banner",
    "-i",
    file,
    "-af",
    "silencedetect=noise=-35dB:d=0.04",
    "-f",
    "null",
    "-",
  ]);
  return [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
}

function captionStarts(ass: string): number[] {
  return [...ass.matchAll(/^Dialogue: 0,(\d+):(\d\d):(\d\d\.\d\d),/gm)].map(
    (m) => Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]),
  );
}

async function streams(file: string): Promise<string[]> {
  const { stdout } = await runProcess(ffprobePath(), [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_name,width,height",
    "-of",
    "csv=p=0",
    file,
  ]);
  return stdout
    .trim()
    .split(/\r?\n/)
    .map((l) => l.replace(/,+$/, ""));
}

async function audioChannels(file: string): Promise<number> {
  const { stdout } = await runProcess(ffprobePath(), [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=channels",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Number(stdout.trim());
}

describe("end-to-end render with real FFmpeg (fake providers)", () => {
  it("script mode, 16:9: playable H.264/AAC MP4 with captions in sync (±0.3 s)", async () => {
    const outDir = await tempDir();
    const project = await Project.create(outDir, {
      id: "e2e-script",
      input: { mode: "script", scriptFile: "script.txt" },
      styleId: "stickman-classic",
      aspect: "16:9",
      voiceId: "en-US-GuyNeural",
      captions: true,
      seed: 1,
    });
    await fsp.writeFile(project.path("script.txt"), fakeScript(45));
    const counter = new ApiCallCounter();
    const fakes = fakeProviders(counter, { real: true });

    const result = await runPipeline({ project, providers: fakes.providers, counter, log: silentLogger });

    expect(result.outputPath).toBe(project.path("final.mp4"));
    expect(await streams(result.outputPath)).toEqual(["h264,1920,1080", "aac"]);
    expect(await audioChannels(result.outputPath)).toBe(2);
    const expected = project.manifest.scenes.reduce((a, s) => a + s.durationSec!, 0);
    const duration = await probeDuration(result.outputPath);
    expect(duration).toBeGreaterThan(expected);
    expect(duration).toBeLessThan(expected + 0.15 * project.manifest.scenes.length + 1);

    // Sync: every caption line must start on a word's beep in the final audio.
    const onsets = await beepOnsets(result.outputPath);
    const starts = captionStarts(await fsp.readFile(project.path("render", "captions.ass"), "utf8"));
    expect(starts.length).toBeGreaterThan(5);
    const worst = Math.max(...starts.map((s) => Math.min(...onsets.map((o) => Math.abs(o - s)))));
    expect(worst).toBeLessThanOrEqual(0.3);

    // Re-render reuses cached clips and still produces the file.
    const t0 = Date.now();
    await runPipeline({
      project,
      providers: fakes.providers,
      counter: new ApiCallCounter(),
      log: silentLogger,
    });
    expect(Date.now() - t0).toBeLessThan(30_000);
  }, 300_000);

  it("audio mode, 9:16: keeps the uploaded voiceover and its length", async () => {
    const outDir = await tempDir();
    const project = await Project.create(outDir, {
      id: "e2e-audio",
      input: { mode: "audio", audioFile: "input/voiceover.wav" },
      styleId: "stickman-color",
      aspect: "9:16",
      voiceId: "en-US-GuyNeural",
      captions: true,
      seed: 1,
    });
    const text = fakeScript(30);
    const words = fakeWordTimings(text);
    const durationSec = words[words.length - 1]!.end + 0.7;
    await fsp.mkdir(project.path("input"), { recursive: true });
    const on = words.map((w) => `between(t,${w.start},${w.end})`).join("+");
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=660:sample_rate=44100:duration=${durationSec}`,
      "-af",
      `volume=0:enable='not(${on})'`,
      project.path("input", "voiceover.wav"),
    ]);
    const counter = new ApiCallCounter();
    const stt = new FakeStt({ text, durationSec, words });
    const fakes = fakeProviders(counter, { real: true, stt });

    const result = await runPipeline({ project, providers: fakes.providers, counter, log: silentLogger });

    expect(await streams(result.outputPath)).toEqual(["h264,1080,1920", "aac"]);
    expect(Math.abs((await probeDuration(result.outputPath)) - durationSec)).toBeLessThan(0.1);
    const onsets = await beepOnsets(result.outputPath);
    const starts = captionStarts(await fsp.readFile(project.path("render", "captions.ass"), "utf8"));
    const worst = Math.max(...starts.map((s) => Math.min(...onsets.map((o) => Math.abs(o - s)))));
    expect(worst).toBeLessThanOrEqual(0.3);
  }, 300_000);

  it("--animate: animated clips replace zoom/pan, the length and caption sync stay exact", async () => {
    const outDir = await tempDir();
    const project = await Project.create(outDir, {
      id: "e2e-animate",
      input: { mode: "script", scriptFile: "script.txt" },
      styleId: "stickman-classic",
      aspect: "16:9",
      voiceId: "en-US-GuyNeural",
      captions: true,
      seed: 1,
      animate: { enabled: true, maxScenes: 2 },
    });
    await fsp.writeFile(project.path("script.txt"), fakeScript(45));
    const counter = new ApiCallCounter();
    const fakes = fakeProviders(counter, { real: true });

    const result = await runPipeline({ project, providers: fakes.providers, counter, log: silentLogger });

    expect(fakes.video.calls).toBe(2);
    expect(project.manifest.scenes.filter((s) => s.videoPath)).toHaveLength(2);
    expect(await streams(result.outputPath)).toEqual(["h264,1920,1080", "aac"]);
    const expected = project.manifest.scenes.reduce((a, s) => a + s.durationSec!, 0);
    const duration = await probeDuration(result.outputPath);
    expect(duration).toBeGreaterThan(expected);
    expect(duration).toBeLessThan(expected + 0.15 * project.manifest.scenes.length + 1);
    const onsets = await beepOnsets(result.outputPath);
    const starts = captionStarts(await fsp.readFile(project.path("render", "captions.ass"), "utf8"));
    const worst = Math.max(...starts.map((s) => Math.min(...onsets.map((o) => Math.abs(o - s)))));
    expect(worst).toBeLessThanOrEqual(0.3);
  }, 300_000);
});
