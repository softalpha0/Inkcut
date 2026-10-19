import path from "node:path";
import type { InputMode, StageName } from "@inkcut/shared";
import { ASSETS_DIR } from "./env.js";
import type { Project } from "./project.js";
import type { Providers } from "./providers.js";
import { renderVideo } from "./render/compose.js";
import { renderThumbnail } from "./render/thumbnail.js";
import { getStyle } from "./styles/index.js";
import { ForcedFailure, type FailAt, type MediaTools, type StageContext } from "./stages/context.js";
import { runAnimateStage } from "./stages/animate.js";
import { runDrawStage } from "./stages/draw.js";
import { runPlanStage } from "./stages/plan.js";
import { runRenderStage } from "./stages/render.js";
import { runScriptStage } from "./stages/script.js";
import { runThumbnailStage } from "./stages/thumbnail.js";
import { runTranscribeStage } from "./stages/transcribe.js";
import { runVoiceStage } from "./stages/voice.js";
import { probeDuration } from "./util/ffmpeg.js";
import type { Logger } from "./util/log.js";
import type { ApiCallCounter } from "./util/metrics.js";
import { errorMessage } from "./util/retry.js";

type StageFn = (ctx: StageContext) => Promise<void>;

const STAGE_FNS: Record<StageName, StageFn> = {
  script: runScriptStage,
  transcribe: runTranscribeStage,
  plan: runPlanStage,
  voice: runVoiceStage,
  draw: runDrawStage,
  animate: runAnimateStage,
  render: runRenderStage,
  thumbnail: runThumbnailStage,
};

/**
 * Spec §5: stages per input mode. Script mode starts from a provided script.txt.
 * `animate` does nothing unless the project was created or resumed with --animate.
 * `thumbnail` runs last, so the video is ready even if thumbnails fail.
 */
export function stagesFor(mode: InputMode): StageName[] {
  switch (mode) {
    case "topic":
      return ["script", "plan", "voice", "draw", "animate", "render", "thumbnail"];
    case "script":
      return ["plan", "voice", "draw", "animate", "render", "thumbnail"];
    case "audio":
      return ["transcribe", "plan", "draw", "animate", "render", "thumbnail"];
  }
}

export const defaultMedia: MediaTools = { probeDuration, renderVideo, renderThumbnail };

/** Stages whose failure only logs a warning in a full run (the video itself is fine without them). */
const OPTIONAL_STAGES: readonly StageName[] = ["thumbnail"];

export interface RunOptions {
  project: Project;
  providers: Providers;
  counter: ApiCallCounter;
  log: Logger;
  media?: MediaTools;
  failAt?: FailAt;
  fontsDir?: string;
  /** Called when a stage starts, for progress output. May be async (e.g. a DB status update). */
  onStage?: (stage: StageName, n: number, total: number) => void | Promise<void>;
  /** Run only these stages (in pipeline order), e.g. ["draw"] for a single-scene redraw. */
  only?: StageName[];
}

export interface RunResult {
  outputPath: string;
  apiCalls: Record<string, number>;
  durationMs: number;
}

/**
 * Runs every stage in order. Each stage skips work whose output already exists,
 * so a re-run after a failure resumes without repeating paid calls.
 */
export async function runPipeline(opts: RunOptions): Promise<RunResult> {
  const { project, log, counter } = opts;
  const started = Date.now();
  const ctx: StageContext = {
    project,
    providers: opts.providers,
    style: getStyle(project.manifest.styleId, project.manifest.customStyle),
    media: opts.media ?? defaultMedia,
    log,
    fontsDir: opts.fontsDir ?? path.join(ASSETS_DIR, "fonts"),
    ...(opts.failAt ? { failAt: opts.failAt } : {}),
  };

  const run = { startedAt: new Date(started).toISOString(), status: "running" as const, apiCalls: {} };
  project.manifest.runs.push(run);
  const runIndex = project.manifest.runs.length - 1;
  await project.save();

  const finish = async (status: "done" | "failed", error?: string) => {
    project.manifest.runs[runIndex] = {
      ...run,
      status,
      finishedAt: new Date().toISOString(),
      apiCalls: counter.snapshot(),
      ...(error ? { error } : {}),
    };
    await project.save();
  };

  const stages = stagesFor(project.manifest.input.mode).filter((s) => !opts.only || opts.only.includes(s));
  try {
    for (const [i, stage] of stages.entries()) {
      await opts.onStage?.(stage, i + 1, stages.length);
      const stageLog = log.child({ stage });
      const t0 = Date.now();
      try {
        await STAGE_FNS[stage]({ ...ctx, log: stageLog });
      } catch (err) {
        // Report it when only optional stages were asked for (a thumbnail job) or in a forced test failure.
        const onlyOptional = opts.only?.every((s) => OPTIONAL_STAGES.includes(s)) ?? false;
        if (!OPTIONAL_STAGES.includes(stage) || onlyOptional || err instanceof ForcedFailure) throw err;
        stageLog.warn(`${stage} failed; the video is still done`, { error: errorMessage(err) });
        continue;
      }
      await project.markDone(stage);
      stageLog.info(`stage finished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
  } catch (err) {
    await finish("failed", errorMessage(err));
    throw err;
  }
  await finish("done");
  return {
    outputPath: project.manifest.outputPath ? project.abs(project.manifest.outputPath) : "",
    apiCalls: counter.snapshot(),
    durationMs: Date.now() - started,
  };
}
