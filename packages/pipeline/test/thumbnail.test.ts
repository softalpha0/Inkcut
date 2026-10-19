import fsp from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITS, ThumbnailPlanSchema, type Aspect } from "@inkcut/shared";
import { ASSETS_DIR } from "../src/env.js";
import { runPipeline } from "../src/pipeline.js";
import { Project } from "../src/project.js";
import { buildThumbnailAss, headlineAssText, renderThumbnail } from "../src/render/thumbnail.js";
import { thumbnailFiles } from "../src/stages/thumbnail.js";
import { ffprobePath, runFfmpeg, runProcess } from "../src/util/ffmpeg.js";
import { silentLogger } from "../src/util/log.js";
import { ApiCallCounter } from "../src/util/metrics.js";
import { fakeMedia, fakeProviders, tempDir } from "./fakes.js";

async function newProject(aspect: Aspect = "16:9"): Promise<Project> {
  return Project.create(await tempDir(), {
    id: "thumb-project",
    input: { mode: "topic", topic: "Why we procrastinate", minutes: 1 },
    styleId: "flat-cartoon",
    aspect,
    voiceId: "en-US-GuyNeural",
    captions: true,
    seed: 42,
  });
}

function run(project: Project, only?: ("thumbnail" | "render")[]) {
  const counter = new ApiCallCounter();
  const fakes = fakeProviders(counter, { real: false });
  const promise = runPipeline({
    project,
    providers: fakes.providers,
    counter,
    log: silentLogger,
    media: fakeMedia,
    ...(only ? { only } : {}),
  });
  return { promise, fakes };
}

describe("thumbnail stage", () => {
  it("makes three different 16:9 thumbnails in the video's style after the render", async () => {
    const project = await newProject("9:16");
    const { promise, fakes } = run(project);
    await promise;
    const thumbs = project.manifest.thumbnails!;
    expect(thumbs).toHaveLength(LIMITS.thumbnailsPerVideo);
    expect(new Set(thumbs.map((t) => t.seed)).size).toBe(thumbs.length);
    expect(project.manifest.completedStages.at(-1)).toBe("thumbnail");

    const thumbRequests = fakes.images.requests.slice(-thumbs.length);
    for (const req of thumbRequests) {
      // Always YouTube's landscape shape, even for a 9:16 video.
      expect(req.width).toBeGreaterThan(req.height);
      expect(req.prompt).toMatch(/flat cartoon/i);
      expect(req.prompt).toMatch(/No text/);
    }
    for (const t of thumbs) {
      const files = thumbnailFiles(t.index);
      expect(t.outputPath).toBe(files.output);
      expect(await fsp.readFile(project.abs(files.output), "utf8")).toBe(`fake thumbnail ${t.headline}`);
      expect(await fsp.readFile(project.abs(files.clean), "utf8")).toBe("fake clean thumbnail");
    }
  });

  it("re-renders only the text after a headline edit (no new pictures or LLM calls)", async () => {
    const project = await newProject();
    await run(project).promise;
    const thumb = project.manifest.thumbnails![1]!;
    thumb.headline = "STOP *SCROLLING*";
    await fsp.rm(project.abs(thumb.outputPath!));
    await project.save();

    const again = run(project, ["thumbnail"]);
    await again.promise;
    expect(again.fakes.llm.calls).toBe(0);
    expect(again.fakes.images.calls).toBe(0);
    expect(await fsp.readFile(project.abs(thumb.outputPath!), "utf8")).toBe(
      "fake thumbnail STOP *SCROLLING*",
    );
  });

  it("does not fail the video when thumbnails fail in a full run", async () => {
    const project = await newProject();
    const { promise, fakes } = run(project);
    // Script and plan replies are normal; every thumbnail reply is invalid.
    const chat = fakes.llm.chat.bind(fakes.llm);
    fakes.llm.chat = async (messages) => {
      const system = messages.find((m) => m.role === "system")?.content ?? "";
      return system.includes("YouTube thumbnails") ? "no json here" : chat(messages);
    };
    const result = await promise;
    expect(path.basename(result.outputPath)).toBe("final.mp4");
    expect(project.manifest.completedStages).not.toContain("thumbnail");
    expect(project.manifest.thumbnails).toBeUndefined();
  });

  it("reports a thumbnail failure when the thumbnail stage is run on its own", async () => {
    const project = await newProject();
    await run(project).promise;
    delete project.manifest.thumbnails;
    await project.save();
    const { promise, fakes } = run(project, ["thumbnail"]);
    fakes.llm.queued.push("nope", "still nope", "nope again");
    await expect(promise).rejects.toThrow();
  });
});

describe("thumbnail schema and text", () => {
  it("accepts short headlines and rejects long ones", () => {
    const ok = { headline: "THEY *LIED* TO YOU", imagePrompt: "Sam looks shocked at a giant bank" };
    expect(ThumbnailPlanSchema.safeParse({ thumbnails: [ok, ok, ok] }).success).toBe(true);
    const long = { ...ok, headline: "THIS IS FAR TOO MANY WORDS FOR A THUMBNAIL" };
    expect(ThumbnailPlanSchema.safeParse({ thumbnails: [ok, ok, long] }).success).toBe(false);
    expect(ThumbnailPlanSchema.safeParse({ thumbnails: [ok, ok] }).success).toBe(false);
  });

  it("highlights the starred word, or the last word when none is starred", () => {
    expect(headlineAssText("they *lied* to you")).toBe("THEY {\\c&H3BD4FF&}LIED{\\c&HFFFFFF&} TO YOU");
    expect(headlineAssText("why you wait")).toBe("WHY YOU {\\c&H3BD4FF&}WAIT");
    expect(headlineAssText("{bad} \\n")).not.toMatch(/[{}]bad|\\n/);
    expect(buildThumbnailAss("BIG *NEWS*")).toMatch(/Style: Headline,Nunito ExtraBold,180,/);
  });
});

describe("thumbnail render (real FFmpeg)", () => {
  it("writes 1280x720 JPEGs under 2 MB, with and without text", async () => {
    const dir = await tempDir();
    const image = path.join(dir, "thumbnails", "thumb-1.png");
    await fsp.mkdir(path.dirname(image), { recursive: true });
    await runFfmpeg(["-f", "lavfi", "-i", "testsrc2=size=1536x864:rate=1", "-frames:v", "1", image]);
    const out = path.join(dir, "thumbnails", "thumb-1.jpg");
    const clean = path.join(dir, "thumbnails", "thumb-1-clean.jpg");
    await renderThumbnail({
      projectDir: dir,
      imagePath: image,
      headline: "WHY YOU *WAIT*",
      fontsDir: path.join(ASSETS_DIR, "fonts"),
      outFile: out,
      cleanFile: clean,
    });
    for (const file of [out, clean]) {
      const { stdout } = await runProcess(ffprobePath(), [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_name,width,height",
        "-of",
        "csv=p=0",
        file,
      ]);
      expect(stdout.trim()).toBe("mjpeg,1280,720");
      expect((await fsp.stat(file)).size).toBeLessThan(2 * 1024 * 1024);
    }
    // The text version differs from the clean one, and no .ass file is left behind.
    expect(Buffer.compare(await fsp.readFile(out), await fsp.readFile(clean))).not.toBe(0);
    expect(await fsp.readdir(path.dirname(out))).not.toContain("thumb-1.ass");
  }, 30_000);
});
