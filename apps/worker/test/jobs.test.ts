import fsp from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ApiCallCounter } from "@inkcut/pipeline";
import { silentLogger } from "@inkcut/pipeline";
import { BUCKETS } from "@inkcut/db";
import { LIMITS } from "@inkcut/shared";
import { handleJob, markJobFailed, recoverStuckProjects, runCleanup, type WorkerDeps } from "../src/jobs.js";
import { LocalAssetStore } from "../src/local-assets.js";
import { MemoryProjectStore } from "./memory-store.js";
import {
  FakeStt,
  fakeMedia,
  fakeProviders,
  fakeScript,
  fakeWordTimings,
  tempDir,
  type FakeSet,
} from "../../../packages/pipeline/test/fakes.js";

const USER = "4f6d2c1e-8a3b-4c5d-9e7f-0a1b2c3d4e5f";
const PID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

async function setup(opts: { stt?: FakeStt } = {}) {
  const root = await tempDir("inkcut-worker-");
  const projects = new MemoryProjectStore();
  const assets = new LocalAssetStore(path.join(root, "storage"));
  const runs: FakeSet[] = [];
  let failImages = false;
  const deps: WorkerDeps = {
    projects,
    assets,
    media: fakeMedia,
    workRoot: root,
    log: silentLogger,
    providers: (counter: ApiCallCounter) => {
      const fakes = fakeProviders(counter, { real: false, ...(opts.stt ? { stt: opts.stt } : {}) });
      if (failImages) {
        fakes.images.generate = async () => {
          throw new Error("image service down");
        };
      }
      runs.push(fakes);
      return fakes.providers;
    },
  };
  const exists = (bucket: string, p: string) =>
    fsp
      .stat(path.join(root, "storage", bucket, ...p.split("/")))
      .then(() => true)
      .catch(() => false);
  return { root, projects, assets, deps, runs, exists, setFailImages: (v: boolean) => (failImages = v) };
}

describe("worker jobs", () => {
  it("generate: runs the pipeline, stores assets, scenes and a 48 h output", async () => {
    const { projects, deps, exists, runs } = await setup();
    projects.add({ id: PID, user_id: USER, input_mode: "topic", topic: "Why we procrastinate", minutes: 1 });
    await handleJob(
      { type: "generate", projectId: PID },
      { ...deps, now: () => new Date("2026-01-01T00:00:00Z") },
    );

    const row = projects.projects.get(PID)!;
    expect(row.status).toBe("done");
    expect(row.output_path).toBe(`${USER}/${PID}/final.mp4`);
    expect(row.output_expires_at).toBe("2026-01-03T00:00:00.000Z");
    expect(projects.statusLog).toEqual([
      "queued",
      "scripting",
      "planning",
      "voicing",
      "drawing",
      "animating",
      "rendering",
      "rendering", // thumbnails
      "done",
    ]);
    expect(await exists(BUCKETS.outputs, row.output_path!)).toBe(true);
    expect(await exists(BUCKETS.assets, `${USER}/${PID}/project.json`)).toBe(true);

    const scenes = projects.scenes.get(PID)!;
    expect(scenes.length).toBeGreaterThan(3);
    expect(scenes[0]!.image_path).toBe(`${USER}/${PID}/images/000.png`);
    expect(await exists(BUCKETS.assets, scenes[0]!.audio_path!)).toBe(true);
    expect(runs[0]!.llm.calls).toBe(4); // script, plan, thumbnails, YouTube details
    expect(await exists(BUCKETS.assets, `${USER}/${PID}/youtube.txt`)).toBe(true);
    expect(await exists(BUCKETS.assets, `${USER}/${PID}/thumbnails/thumb-1.jpg`)).toBe(true);
    expect(await exists(BUCKETS.assets, `${USER}/${PID}/thumbnails/thumb-3-clean.jpg`)).toBe(true);
  });

  it("a failed job keeps progress; retry resumes without repeating SERV or TTS", async () => {
    const { projects, deps, runs, setFailImages } = await setup();
    projects.add({ id: PID, user_id: USER, input_mode: "topic", topic: "Sleep", minutes: 1 });
    setFailImages(true);
    await expect(handleJob({ type: "generate", projectId: PID }, deps)).rejects.toThrow(/image service down/);
    const failed = projects.projects.get(PID)!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatch(/image service down/);
    expect(projects.scenes.get(PID)!.every((s) => s.audio_path)).toBe(true);

    setFailImages(false);
    await handleJob({ type: "generate", projectId: PID }, deps);
    expect(projects.projects.get(PID)!.status).toBe("done");
    const retry = runs[1]!;
    expect(retry.tts.calls).toBe(0);
    expect(retry.llm.calls).toBe(2); // thumbnails + YouTube details, never reached before
    expect(retry.images.calls).toBe(projects.scenes.get(PID)!.length + LIMITS.thumbnailsPerVideo);
  });

  it("redraw: uses the edited prompt for one scene only, then waits for a render", async () => {
    const { projects, deps, runs } = await setup();
    projects.add({ id: PID, user_id: USER, input_mode: "topic", topic: "Habits", minutes: 1 });
    await handleJob({ type: "generate", projectId: PID }, deps);

    projects.scenes.get(PID)![1]!.image_prompt = "Sam riding a bicycle up a hill";
    await handleJob({ type: "redraw", projectId: PID, sceneIndex: 1 }, deps);
    const run = runs[1]!;
    expect(run.images.calls).toBe(1);
    expect(run.images.requests[0]!.prompt).toContain("Sam riding a bicycle up a hill");
    expect(run.llm.calls + run.tts.calls).toBe(0);
    expect(projects.projects.get(PID)!.status).toBe("draft");
    expect(projects.scenes.get(PID)![1]!.image_prompt).toBe("Sam riding a bicycle up a hill");
  });

  it("revoice then render: re-voices only the edited scene and renders without paid calls", async () => {
    const { projects, deps, runs } = await setup();
    projects.add({ id: PID, user_id: USER, input_mode: "topic", topic: "Focus", minutes: 1 });
    await handleJob({ type: "generate", projectId: PID }, deps);

    projects.scenes.get(PID)![0]!.narration = "A brand new opening line for this video.";
    await handleJob({ type: "revoice", projectId: PID, sceneIndex: 0 }, deps);
    expect(runs[1]!.tts.calls).toBe(1);
    expect(projects.projects.get(PID)!.status).toBe("draft");
    expect(projects.scenes.get(PID)![0]!.narration).toBe("A brand new opening line for this video.");

    await handleJob({ type: "render", projectId: PID }, deps);
    const render = runs[2]!;
    expect(render.llm.calls + render.tts.calls + render.images.calls).toBe(0);
    expect(projects.projects.get(PID)!.status).toBe("done");
  });

  it("thumbnail: a new headline re-renders only the text; a new picture redraws one image", async () => {
    const { projects, deps, runs, root } = await setup();
    projects.add({ id: PID, user_id: USER, input_mode: "topic", topic: "Money", minutes: 1 });
    await handleJob({ type: "generate", projectId: PID }, deps);

    await handleJob(
      { type: "thumbnail", projectId: PID, index: 1, headline: "BANKS *LIE*", redraw: false },
      deps,
    );
    const edit = runs[1]!;
    expect(edit.llm.calls + edit.images.calls + edit.tts.calls).toBe(0);
    expect(projects.projects.get(PID)!.status).toBe("done");
    const stored = path.join(root, "storage", BUCKETS.assets, USER, PID, "thumbnails", "thumb-2.jpg");
    expect(await fsp.readFile(stored, "utf8")).toBe("fake thumbnail BANKS *LIE*");

    await handleJob({ type: "thumbnail", projectId: PID, index: 0, redraw: true }, deps);
    const redraw = runs[2]!;
    expect(redraw.llm.calls).toBe(0);
    expect(redraw.images.calls).toBe(1);
    const manifest = JSON.parse(
      await fsp.readFile(path.join(root, "storage", BUCKETS.assets, USER, PID, "project.json"), "utf8"),
    ) as { thumbnails: { seed: number; headline: string }[] };
    expect(redraw.images.requests[0]!.seed).toBe(manifest.thumbnails[0]!.seed);
    expect(new Set(manifest.thumbnails.map((t) => t.seed)).size).toBe(3);
    expect(manifest.thumbnails[1]!.headline).toBe("BANKS *LIE*");
  });

  it("render adds thumbnails to an older video that has none, and survives a thumbnail failure", async () => {
    const { projects, deps, runs, root } = await setup();
    projects.add({ id: PID, user_id: USER, input_mode: "topic", topic: "Older video", minutes: 1 });
    await handleJob({ type: "generate", projectId: PID }, deps);

    // Make it look like a video from before thumbnails existed.
    const stored = path.join(root, "storage", BUCKETS.assets, USER, PID);
    const manifestFile = path.join(stored, "project.json");
    const stripThumbnails = async () => {
      const manifest = JSON.parse(await fsp.readFile(manifestFile, "utf8")) as Record<string, unknown>;
      delete manifest.thumbnails;
      await fsp.writeFile(manifestFile, JSON.stringify(manifest));
      await fsp.rm(path.join(stored, "thumbnails"), { recursive: true, force: true });
    };
    await stripThumbnails();

    await handleJob({ type: "render", projectId: PID }, deps);
    expect(runs[1]!.llm.calls).toBe(1);
    expect(runs[1]!.images.calls).toBe(LIMITS.thumbnailsPerVideo);
    expect(projects.projects.get(PID)!.status).toBe("done");
    expect(await fsp.readFile(path.join(stored, "thumbnails", "thumb-1.jpg"), "utf8")).toMatch(
      /^fake thumbnail/,
    );

    // A thumbnail failure during a render only logs a warning.
    await stripThumbnails();
    const providers = deps.providers;
    await handleJob(
      { type: "render", projectId: PID },
      {
        ...deps,
        providers: (counter, log) => {
          const p = providers(counter, log);
          return { ...p, llm: () => ({ name: "broken", chat: async () => "not json" }) };
        },
      },
    );
    expect(projects.projects.get(PID)!.status).toBe("done");
  });

  it("extras: adds YouTube details to a finished video without touching its video or thumbnails", async () => {
    const { projects, deps, runs, root } = await setup();
    projects.add({ id: PID, user_id: USER, input_mode: "topic", topic: "Focus", minutes: 1 });
    await handleJob({ type: "generate", projectId: PID }, deps);
    const stored = path.join(root, "storage", BUCKETS.assets, USER, PID);
    const manifestFile = path.join(stored, "project.json");
    const manifest = JSON.parse(await fsp.readFile(manifestFile, "utf8")) as Record<string, unknown>;
    delete manifest.youtube;
    await fsp.writeFile(manifestFile, JSON.stringify(manifest));

    await handleJob({ type: "extras", projectId: PID }, deps);
    const run = runs[1]!;
    expect(run.llm.calls).toBe(1);
    expect(run.images.calls + run.tts.calls).toBe(0);
    expect(projects.projects.get(PID)!.status).toBe("done");
    expect(await fsp.readFile(path.join(stored, "youtube.txt"), "utf8")).toMatch(/^TITLES/);
  });

  it("marks videos left running by a stopped worker as failed, but not queued or recent ones", async () => {
    const { projects, deps } = await setup();
    const old = "2026-01-01T00:00:00.000Z";
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ];
    projects.add({ id: ids[0]!, user_id: USER, input_mode: "topic", status: "rendering", updated_at: old });
    projects.add({ id: ids[1]!, user_id: USER, input_mode: "topic", status: "queued", updated_at: old });
    projects.add({
      id: ids[2]!,
      user_id: USER,
      input_mode: "topic",
      status: "rendering",
      updated_at: "2026-01-01T01:50:00.000Z",
    });
    projects.add({
      id: ids[3]!,
      user_id: USER,
      input_mode: "topic",
      status: "animating",
      updated_at: "2026-01-01T00:30:00.000Z",
    });
    const recovered = await recoverStuckProjects({ ...deps, now: () => new Date("2026-01-01T02:00:00Z") });
    expect(recovered).toBe(1);
    expect(projects.projects.get(ids[0]!)!.status).toBe("failed");
    expect(projects.projects.get(ids[0]!)!.error).toMatch(/Press Retry/);
    expect(projects.projects.get(ids[1]!)!.status).toBe("queued"); // still waiting in the queue
    expect(projects.projects.get(ids[2]!)!.status).toBe("rendering"); // recent progress
    expect(projects.projects.get(ids[3]!)!.status).toBe("animating"); // animation gets longer
  });

  it("records a job BullMQ failed outside the handler (stalled) on the project", async () => {
    const { projects, deps } = await setup();
    projects.add({ id: PID, user_id: USER, input_mode: "topic", status: "drawing" });
    await markJobFailed({ type: "generate", projectId: PID }, "job stalled more than allowable limit", deps);
    expect(projects.projects.get(PID)!.status).toBe("failed");
    expect(projects.projects.get(PID)!.error).toMatch(/worker stopped/);

    // A finished project is left alone.
    projects.projects.get(PID)!.status = "done";
    await markJobFailed({ type: "generate", projectId: PID }, "late failure", deps);
    expect(projects.projects.get(PID)!.status).toBe("done");
  });

  it("script mode uses the project's script as narration", async () => {
    const { projects, deps, runs } = await setup();
    const script = fakeScript(60);
    projects.add({ id: PID, user_id: USER, input_mode: "script", script });
    await handleJob({ type: "generate", projectId: PID }, deps);
    expect(runs[0]!.llm.calls).toBe(3); // plan + thumbnails + YouTube details
    expect(
      projects.scenes
        .get(PID)!
        .map((s) => s.narration)
        .join(" "),
    ).toBe(script);
  });

  it("audio mode reads the uploaded voiceover from the uploads bucket", async () => {
    const text = fakeScript(40);
    const words = fakeWordTimings(text);
    const durationSec = words[words.length - 1]!.end + 0.5;
    const stt = new FakeStt({ text, durationSec, words });
    const { projects, deps, root } = await setup({ stt });
    const upload = `${USER}/voice.mp3`;
    const local = path.join(root, "storage", BUCKETS.uploads, USER, "voice.mp3");
    await fsp.mkdir(path.dirname(local), { recursive: true });
    await fsp.writeFile(local, `fake audio ${durationSec}`);
    projects.add({ id: PID, user_id: USER, input_mode: "audio", audio_path: upload });

    await handleJob({ type: "generate", projectId: PID }, deps);
    expect(stt.calls).toBe(1);
    expect(projects.projects.get(PID)!.status).toBe("done");
  });

  it("audio mode rejects a voiceover longer than 5 minutes", async () => {
    const { projects, deps, root } = await setup();
    const local = path.join(root, "storage", BUCKETS.uploads, USER, "long.mp3");
    await fsp.mkdir(path.dirname(local), { recursive: true });
    await fsp.writeFile(local, "fake audio 400");
    projects.add({ id: PID, user_id: USER, input_mode: "audio", audio_path: `${USER}/long.mp3` });
    await expect(handleJob({ type: "generate", projectId: PID }, deps)).rejects.toThrow(
      /longer than 5 minutes/,
    );
    expect(projects.projects.get(PID)!.error).toMatch(/longer than 5 minutes/);
  });

  it("cleanup deletes outputs and assets after 48 h and marks the project expired", async () => {
    const { projects, deps, exists } = await setup();
    projects.add({ id: PID, user_id: USER, input_mode: "topic", topic: "Time", minutes: 1 });
    await handleJob(
      { type: "generate", projectId: PID },
      { ...deps, now: () => new Date("2026-01-01T00:00:00Z") },
    );

    expect(await runCleanup({ ...deps, now: () => new Date("2026-01-02T00:00:00Z") })).toBe(0);
    expect(await runCleanup({ ...deps, now: () => new Date("2026-01-03T00:00:01Z") })).toBe(1);
    const row = projects.projects.get(PID)!;
    expect(row.status).toBe("expired");
    expect(row.output_path).toBeNull();
    expect(await exists(BUCKETS.outputs, `${USER}/${PID}/final.mp4`)).toBe(false);
    expect(await exists(BUCKETS.assets, `${USER}/${PID}/project.json`)).toBe(false);
  });
});
