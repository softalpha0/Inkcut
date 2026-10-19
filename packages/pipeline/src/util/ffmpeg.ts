import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

/** Bundled binaries (ffmpeg-static / ffprobe-static); FFMPEG_PATH / FFPROBE_PATH override (Docker). */
export function ffmpegPath(): string {
  const p = process.env.FFMPEG_PATH?.trim() || (ffmpegStatic as unknown as string | null);
  if (!p) throw new Error("No ffmpeg binary for this platform. Set FFMPEG_PATH.");
  return p;
}

export function ffprobePath(): string {
  return process.env.FFPROBE_PATH?.trim() || ffprobeStatic.path;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

export function runProcess(bin: string, args: string[], opts: { cwd?: string } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      // keep only the tail; ffmpeg can be chatty
      if (stderr.length > 20_000) stderr = stderr.slice(-10_000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else {
        const tail = stderr.trim().split(/\r?\n/).slice(-15).join("\n");
        reject(new Error(`${bin.split(/[\\/]/).pop()} exited with code ${code}:\n${tail}`));
      }
    });
  });
}

export function runFfmpeg(args: string[], opts: { cwd?: string } = {}): Promise<RunResult> {
  return runProcess(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", ...args], opts);
}

/** Media duration in seconds via ffprobe. */
export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await runProcess(ffprobePath(), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const value = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Could not read duration of ${file} (ffprobe said "${stdout.trim()}")`);
  }
  return value;
}
