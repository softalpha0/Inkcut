import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { WordTiming } from "@inkcut/shared";
import type { ImageProvider, ImageRequest } from "../src/images/types.js";
import type { LlmClient, LlmMessage } from "../src/llm/types.js";
import type { Providers } from "../src/providers.js";
import type { MediaTools } from "../src/stages/context.js";
import type { SttProvider, Transcript } from "../src/stt/types.js";
import type { TtsProvider, TtsResult } from "../src/tts/types.js";
import type { AnimateRequest, VideoModelInfo, VideoProvider } from "../src/video/types.js";
import { runFfmpeg } from "../src/util/ffmpeg.js";
import type { ApiCallCounter } from "../src/util/metrics.js";

export async function tempDir(prefix = "inkcut-test-"): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

const SENTENCES = [
  "Procrastination is not laziness, it is a way our brain avoids bad feelings.",
  "When a task feels boring or scary, we reach for something that feels better right now.",
  "Scrolling a phone gives a quick reward, so the brain learns to repeat it.",
  "The task does not get easier, and the stress keeps growing in the background.",
  "Small first steps break the loop because they make starting feel safe.",
  "Try working for just five minutes, and let momentum carry you forward.",
];

export function fakeScript(words: number): string {
  const out: string[] = [];
  let n = 0;
  for (let i = 0; n < words; i++) {
    const s = SENTENCES[i % SENTENCES.length]!;
    out.push(s);
    n += s.split(" ").length;
  }
  return out.join(" ");
}

/** Answers the script and plan prompts like SERV would. */
export class FakeLlm implements LlmClient {
  readonly name = "fake-llm";
  calls = 0;
  /** Replies returned before normal behaviour (to test validation retries). */
  queued: string[] = [];

  constructor(private readonly counter?: ApiCallCounter) {}

  async chat(messages: LlmMessage[]): Promise<string> {
    this.calls++;
    this.counter?.add("serv");
    const queued = this.queued.shift();
    if (queued !== undefined) return queued;
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const firstUser = messages.find((m) => m.role === "user")?.content ?? "";
    if (system.includes("narration scripts")) {
      const target = Number(/about (\d+) words/.exec(system)?.[1] ?? 150);
      return fakeScript(target);
    }
    const count = firstUser.split("\n").filter((l) => /^\d+: /.test(l)).length;
    const motions = ["zoom_in", "pan_right", "zoom_out", "pan_left", "static"];
    return JSON.stringify({
      characters: "Sam: a stick figure with a red scarf.",
      scenes: Array.from({ length: count }, (_, i) => ({
        index: i,
        visual: `Scene ${i}`,
        imagePrompt: `Sam sitting at a desk, moment ${i}`,
        motion: motions[i % motions.length],
      })),
    });
  }
}

/** Word timings at 2.5 words/s with 0.3 s per word: the shape real TTS returns. */
export function fakeWordTimings(text: string): WordTiming[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => ({
      text: w.replace(/[^\p{L}\p{N}']/gu, ""),
      start: 0.1 + i * 0.4,
      end: 0.1 + i * 0.4 + 0.3,
    }))
    .filter((w) => w.text);
}

/**
 * TTS fake. With `realAudio`, writes an MP3 that is silent except for a beep on
 * each reported word, so caption sync can be measured from the rendered audio.
 */
export class FakeTts implements TtsProvider {
  readonly name = "fake-tts";
  calls = 0;

  constructor(private readonly opts: { realAudio: boolean; counter?: ApiCallCounter }) {}

  async synthesize(text: string, _voiceId: string, outFile: string): Promise<TtsResult> {
    this.calls++;
    this.opts.counter?.add("edge-tts");
    const words = fakeWordTimings(text);
    await fsp.mkdir(path.dirname(outFile), { recursive: true });
    const duration = words.length ? words[words.length - 1]!.end + 0.1 : 0.5;
    if (this.opts.realAudio) {
      const on = words.map((w) => `between(t,${w.start.toFixed(3)},${w.end.toFixed(3)})`).join("+") || "0";
      await runFfmpeg([
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=880:sample_rate=24000:duration=${duration.toFixed(3)}`,
        "-af",
        `volume=0:enable='not(${on})'`,
        "-c:a",
        "libmp3lame",
        "-b:a",
        "96k",
        outFile,
      ]);
    } else {
      await fsp.writeFile(outFile, `fake audio ${duration}`);
    }
    return { words };
  }
}

export class FakeImages implements ImageProvider {
  readonly name = "fake-images";
  calls = 0;
  requests: ImageRequest[] = [];

  constructor(private readonly opts: { realImages: boolean; counter?: ApiCallCounter }) {}

  async generate(req: ImageRequest): Promise<void> {
    this.calls++;
    this.requests.push(req);
    this.opts.counter?.add("fal");
    await fsp.mkdir(path.dirname(req.outFile), { recursive: true });
    if (this.opts.realImages) {
      await runFfmpeg([
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=${req.width}x${req.height}:rate=1`,
        "-frames:v",
        "1",
        req.outFile,
      ]);
    } else {
      await fsp.writeFile(req.outFile, "fake png");
    }
  }
}

/** Image-to-video fake: a real MP4 of the requested length (realVideo), or a stub file. */
export class FakeVideo implements VideoProvider {
  readonly name = "fake-video";
  calls = 0;
  requests: AnimateRequest[] = [];
  /** Throw this for the given scene image basenames. */
  failFor = new Map<string, Error>();

  constructor(
    private readonly opts: { realVideo: boolean; counter?: ApiCallCounter },
    readonly info: VideoModelInfo = {
      model: "fake/video",
      minDurationSec: 2,
      maxDurationSec: 10,
      pricePerSec: 0.015,
    },
  ) {}

  async describe(): Promise<VideoModelInfo> {
    return this.info;
  }

  async animate(req: AnimateRequest): Promise<void> {
    this.calls++;
    this.requests.push(req);
    this.opts.counter?.add("pollinations-video");
    const failure = this.failFor.get(path.basename(req.imageFile));
    if (failure) throw failure;
    await fsp.mkdir(path.dirname(req.outFile), { recursive: true });
    if (this.opts.realVideo) {
      await runFfmpeg([
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=480x270:rate=24:duration=${req.durationSec}`,
        "-pix_fmt",
        "yuv420p",
        req.outFile,
      ]);
    } else {
      await fsp.writeFile(req.outFile, `fake video ${req.durationSec}`);
    }
  }
}

export class FakeStt implements SttProvider {
  readonly name = "fake-stt";
  calls = 0;
  constructor(private readonly transcript: Transcript) {}
  async transcribe(): Promise<Transcript> {
    this.calls++;
    return this.transcript;
  }
}

export interface FakeSet {
  llm: FakeLlm;
  tts: FakeTts;
  images: FakeImages;
  video: FakeVideo;
  stt?: FakeStt;
  providers: Providers;
}

export function fakeProviders(counter: ApiCallCounter, opts: { real: boolean; stt?: FakeStt }): FakeSet {
  const llm = new FakeLlm(counter);
  const tts = new FakeTts({ realAudio: opts.real, counter });
  const images = new FakeImages({ realImages: opts.real, counter });
  const video = new FakeVideo({ realVideo: opts.real, counter });
  return {
    llm,
    tts,
    images,
    video,
    ...(opts.stt ? { stt: opts.stt } : {}),
    providers: {
      llm: () => llm,
      tts: () => tts,
      images: () => images,
      video: () => video,
      stt: () => {
        if (!opts.stt) throw new Error("no fake STT configured");
        return opts.stt;
      },
    },
  };
}

/** Media tools that never touch ffmpeg: duration from the fake audio file, render writes a stub. */
export const fakeMedia: MediaTools = {
  async probeDuration(file) {
    const text = await fsp.readFile(file, "utf8");
    const m = /fake (?:audio|video) ([\d.]+)/.exec(text);
    return m ? Number(m[1]) : 3;
  },
  async renderVideo(job) {
    await fsp.writeFile(job.outFile, "fake mp4");
    return job.outFile;
  },
};
