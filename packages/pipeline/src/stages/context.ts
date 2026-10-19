import { StageNameSchema, type StageName, type StylePreset } from "@inkcut/shared";
import type { Project } from "../project.js";
import type { Providers } from "../providers.js";
import type { RenderJob } from "../render/compose.js";
import type { Logger } from "../util/log.js";

export interface MediaTools {
  probeDuration(file: string): Promise<number>;
  renderVideo(job: RenderJob): Promise<string>;
}

/** Testing aid: INKCUT_FAIL_AT=draw (before the first new item) or draw:2 (after two new items). */
export interface FailAt {
  stage: StageName;
  afterItems: number;
}

export class ForcedFailure extends Error {
  constructor(stage: StageName, items: number) {
    super(`Forced failure in "${stage}" after ${items} new item(s) (INKCUT_FAIL_AT)`);
    this.name = "ForcedFailure";
  }
}

export interface StageContext {
  project: Project;
  providers: Providers;
  style: StylePreset;
  media: MediaTools;
  log: Logger;
  fontsDir: string;
  failAt?: FailAt;
}

/** Throws a ForcedFailure when the configured point is reached. */
export function checkForcedFailure(ctx: StageContext, stage: StageName, newItemsSoFar: number): void {
  if (ctx.failAt?.stage === stage && newItemsSoFar >= ctx.failAt.afterItems) {
    throw new ForcedFailure(stage, newItemsSoFar);
  }
}

export function parseFailAt(value: string | undefined): FailAt | undefined {
  if (!value) return undefined;
  const m = /^([a-z]+)(?::(\d+))?$/.exec(value.trim());
  const stage = StageNameSchema.safeParse(m?.[1]);
  if (!m || !stage.success) {
    throw new Error(
      `Invalid fail-at "${value}". Use <stage> or <stage>:<n> with a stage from ${StageNameSchema.options.join(", ")}, e.g. draw:2`,
    );
  }
  return { stage: stage.data, afterItems: m[2] ? Number(m[2]) : 0 };
}
