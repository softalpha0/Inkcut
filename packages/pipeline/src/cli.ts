import fsp from "node:fs/promises";
import path from "node:path";
import { Command, InvalidArgumentError } from "commander";
import {
  AspectSchema,
  CUSTOM_STYLE_ID,
  DEFAULT_STYLE_ID,
  DEFAULT_VOICE_ID,
  LIMITS,
  VOICES,
  type Aspect,
  type ProjectInput,
  type StylePreset,
} from "@inkcut/shared";
import { defaultOutDir, loadEnv } from "./env.js";
import { runPipeline } from "./pipeline.js";
import { Project, newProjectId } from "./project.js";
import { providersFromEnv } from "./providers.js";
import { parseFailAt } from "./stages/context.js";
import { SCRIPT_FILE } from "./stages/script.js";
import { YOUTUBE_FILE } from "./stages/thumbnail.js";
import { STYLES, getStyle, projectSeed } from "./styles/index.js";
import { probeDuration } from "./util/ffmpeg.js";
import { createLogger } from "./util/log.js";
import { ApiCallCounter } from "./util/metrics.js";
import { errorMessage } from "./util/retry.js";

interface CliOptions {
  topic?: string;
  minutes: number;
  style: string;
  customStyle?: string;
  aspect: Aspect;
  voice: string;
  captions: boolean;
  script?: string;
  audio?: string;
  resume?: string;
  out?: string;
  failAt?: string;
  animate?: boolean;
  animateMax?: number;
}

const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a"]);

function parseMinutes(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < LIMITS.minVideoMinutes || n > LIMITS.maxVideoMinutes) {
    throw new InvalidArgumentError(
      `must be a whole number from ${LIMITS.minVideoMinutes} to ${LIMITS.maxVideoMinutes}`,
    );
  }
  return n;
}

function parseAnimateMax(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > LIMITS.maxAnimatedScenesPerVideo) {
    throw new InvalidArgumentError(`must be a whole number from 1 to ${LIMITS.maxAnimatedScenesPerVideo}`);
  }
  return n;
}

/** --animate / --animate-max as stored in the manifest (undefined when not requested). */
function animateSettings(opts: CliOptions): { enabled: boolean; maxScenes?: number } | undefined {
  if (!opts.animate && opts.animateMax === undefined) return undefined;
  return { enabled: true, ...(opts.animateMax !== undefined ? { maxScenes: opts.animateMax } : {}) };
}

function parseAspect(value: string): Aspect {
  const r = AspectSchema.safeParse(value);
  if (!r.success) throw new InvalidArgumentError("must be 16:9 or 9:16");
  return r.data;
}

/** pnpm runs the script inside packages/pipeline; resolve user paths from where they ran the command. */
function resolveUserPath(p: string): string {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

function fail(message: string): never {
  process.stderr.write(`\nError: ${message}\n`);
  process.exit(1);
}

async function createProjectFromOptions(opts: CliOptions, outDir: string): Promise<Project> {
  const modes = [opts.topic, opts.script, opts.audio].filter((v) => v !== undefined).length;
  if (modes !== 1) fail("Give exactly one of --topic, --script or --audio (or --resume <projectId>).");
  const styleId = opts.customStyle !== undefined ? CUSTOM_STYLE_ID : opts.style;
  let style: StylePreset;
  try {
    style = getStyle(styleId, opts.customStyle);
  } catch (err) {
    fail(errorMessage(err));
  }
  if (!VOICES.some((v) => v.id === opts.voice)) {
    fail(`Unknown voice "${opts.voice}". Available: ${VOICES.map((v) => v.id).join(", ")}`);
  }

  let input: ProjectInput;
  let label: string;
  let copyIn: { from: string; to: string; text?: string } | undefined;

  if (opts.topic !== undefined) {
    if (!opts.topic.trim()) fail("--topic is empty.");
    input = { mode: "topic", topic: opts.topic.trim(), minutes: opts.minutes };
    label = opts.topic;
  } else if (opts.script !== undefined) {
    const file = resolveUserPath(opts.script);
    const text = (
      await fsp.readFile(file, "utf8").catch(() => fail(`Cannot read script file ${file}`))
    ).trim();
    if (!text) fail("The script file is empty.");
    if (text.length > LIMITS.maxScriptChars) {
      fail(`The script has ${text.length} characters; the limit is ${LIMITS.maxScriptChars}.`);
    }
    input = { mode: "script", scriptFile: SCRIPT_FILE };
    label = path.parse(file).name;
    copyIn = { from: file, to: SCRIPT_FILE, text: text.replace(/\s+/g, " ") + "\n" };
  } else {
    const file = resolveUserPath(opts.audio!);
    const ext = path.extname(file).toLowerCase();
    if (!AUDIO_EXTS.has(ext)) fail("--audio must be an .mp3, .wav or .m4a file.");
    const stat = await fsp.stat(file).catch(() => fail(`Cannot read audio file ${file}`));
    if (stat.size > LIMITS.maxUploadAudioBytes) {
      fail(
        `The audio file is ${(stat.size / 1048576).toFixed(1)} MB; the limit is ${LIMITS.maxUploadAudioBytes / 1048576} MB.`,
      );
    }
    const seconds = await probeDuration(file);
    if (seconds > LIMITS.maxUploadAudioSec) {
      fail(
        `The audio is ${(seconds / 60).toFixed(1)} minutes long; the limit is ${LIMITS.maxUploadAudioSec / 60} minutes.`,
      );
    }
    const stored = `input/voiceover${ext}`;
    input = { mode: "audio", audioFile: stored };
    label = path.parse(file).name;
    copyIn = { from: file, to: stored };
  }

  const id = newProjectId(label);
  const project = await Project.create(outDir, {
    id,
    input,
    styleId,
    ...(opts.customStyle !== undefined ? { customStyle: opts.customStyle.trim() } : {}),
    aspect: opts.aspect,
    voiceId: opts.voice,
    captions: opts.captions,
    seed: projectSeed(style, id),
    ...(animateSettings(opts) ? { animate: animateSettings(opts)! } : {}),
  });
  if (copyIn) {
    const dest = project.abs(copyIn.to);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (copyIn.text !== undefined) await fsp.writeFile(dest, copyIn.text);
    else await fsp.copyFile(copyIn.from, dest);
  }
  return project;
}

async function main(): Promise<void> {
  loadEnv();
  const program = new Command()
    .name("inkcut")
    .description("Turn a topic, script or voiceover into a narrated cartoon explainer video.")
    .option("--topic <text>", "generate the script from a topic")
    .option("--minutes <n>", "target length for --topic (1-5)", parseMinutes, 1)
    .option("--style <id>", `style preset (${Object.keys(STYLES).join(", ")})`, DEFAULT_STYLE_ID)
    .option("--custom-style <text>", 'describe your own art style, e.g. "1950s retro cartoon, muted colours"')
    .option("--aspect <ratio>", "16:9 or 9:16", parseAspect, "16:9" as Aspect)
    .option("--voice <id>", "Edge TTS voice", DEFAULT_VOICE_ID)
    .option("--no-captions", "do not burn in captions")
    .option("--script <file>", "use your own script (.txt)")
    .option("--audio <file>", "use your own voiceover (.mp3/.wav/.m4a, max 5 min)")
    .option("--resume <projectId>", "continue a project after a failure")
    .option("--out <dir>", "output folder (default: <repo>/out)")
    .option("--animate", "animate scene images with an AI video model (paid, Pollinations)")
    .option("--animate-max <n>", "animate at most n scenes (spread through the video)", parseAnimateMax)
    .option("--fail-at <stage[:n]>", "testing: fail at a stage, e.g. draw:2 (or set INKCUT_FAIL_AT)")
    .showHelpAfterError();
  program.parse();
  const opts = program.opts<CliOptions>();

  const outDir = opts.out ? resolveUserPath(opts.out) : defaultOutDir();
  let failAt;
  try {
    failAt = parseFailAt(opts.failAt ?? process.env.INKCUT_FAIL_AT);
  } catch (err) {
    fail(errorMessage(err));
  }

  let project: Project;
  if (opts.resume) {
    project = await Project.load(outDir, opts.resume).catch((err: unknown) => fail(errorMessage(err)));
    const animate = animateSettings(opts);
    if (animate) {
      // Adding animation to an existing project: earlier stages are reused, only animate + render run.
      project.manifest.animate = animate;
      await project.save();
    }
  } else {
    project = await createProjectFromOptions(opts, outDir);
  }

  const log = createLogger({ project: project.id });
  const counter = new ApiCallCounter();
  const m = project.manifest;
  console.log(`\nInkcut project ${project.id}`);
  console.log(`  folder : ${project.dir}`);
  console.log(
    `  input  : ${m.input.mode}${m.input.mode === "topic" ? ` "${m.input.topic}" (${m.input.minutes} min)` : ""}`,
  );
  console.log(
    `  style  : ${m.customStyle ? `custom (${m.customStyle})` : m.styleId}   aspect: ${m.aspect}   voice: ${m.voiceId}   captions: ${m.captions ? "on" : "off"}`,
  );
  if (m.animate?.enabled) {
    console.log(
      `  animate: on${m.animate.maxScenes ? ` (max ${m.animate.maxScenes} scenes)` : " (all scenes)"}`,
    );
  }
  if (opts.resume) console.log(`  resume : completed stages = ${m.completedStages.join(", ") || "none"}`);
  if (failAt)
    console.log(`  testing: will fail at ${failAt.stage}${failAt.afterItems ? `:${failAt.afterItems}` : ""}`);

  try {
    const result = await runPipeline({
      project,
      providers: providersFromEnv(counter, log),
      counter,
      log,
      ...(failAt ? { failAt } : {}),
      onStage: (stage, n, total) => console.log(`\n==> [${n}/${total}] ${stage}`),
    });
    console.log(`\nDone in ${(result.durationMs / 1000).toFixed(1)}s`);
    console.log(`  output   : ${result.outputPath}`);
    for (const t of project.manifest.thumbnails ?? []) {
      if (t.outputPath)
        console.log(`  thumbnail: ${project.abs(t.outputPath)}  "${t.headline.replace(/\*/g, "")}"`);
    }
    if (project.manifest.youtube) {
      console.log(`  YouTube  : ${project.path(YOUTUBE_FILE)} (titles, description, tags)`);
    }
    console.log(`  API calls: ${formatCalls(result.apiCalls)}`);
  } catch (err) {
    console.error(`\nFailed: ${errorMessage(err)}`);
    console.error(`  API calls this run: ${formatCalls(counter.snapshot())}`);
    const outArg = opts.out ? ` --out "${opts.out}"` : "";
    console.error(`  Fix the problem, then resume with:\n    pnpm cli --resume ${project.id}${outArg}`);
    process.exitCode = 1;
  }
}

function formatCalls(calls: Record<string, number>): string {
  const entries = Object.entries(calls);
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(", ") : "none";
}

main().catch((err: unknown) => fail(errorMessage(err)));
