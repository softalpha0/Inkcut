import fsp from "node:fs/promises";
import path from "node:path";
import type { WordTiming } from "@inkcut/shared";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { Logger } from "../util/log.js";
import type { ApiCallCounter } from "../util/metrics.js";
import { errorMessage, withRetry } from "../util/retry.js";
import type { TtsProvider, TtsResult } from "./types.js";

/** Edge reports offsets in 100-nanosecond ticks. */
const TICKS_PER_SEC = 10_000_000;

interface EdgeMetadataItem {
  Type: string;
  Data?: { Offset?: number; Duration?: number; text?: { Text?: string } };
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function parseEdgeWordBoundaries(metadata: { Metadata?: EdgeMetadataItem[] }): WordTiming[] {
  const words: WordTiming[] = [];
  for (const item of metadata.Metadata ?? []) {
    if (item.Type !== "WordBoundary" || !item.Data) continue;
    const text = item.Data.text?.Text?.trim();
    if (!text || item.Data.Offset === undefined) continue;
    const start = item.Data.Offset / TICKS_PER_SEC;
    const end = start + (item.Data.Duration ?? 0) / TICKS_PER_SEC;
    words.push({ text, start, end });
  }
  return words.sort((a, b) => a.start - b.start);
}

/**
 * Microsoft Edge "Read Aloud" voices via msedge-tts (free, no key).
 * Unofficial endpoint: it can change without notice, so it stays behind TtsProvider.
 */
export class EdgeTtsProvider implements TtsProvider {
  readonly name = "edge";

  constructor(
    private readonly counter: ApiCallCounter,
    private readonly log: Logger,
  ) {}

  async synthesize(text: string, voiceId: string, outFile: string): Promise<TtsResult> {
    const tmpDir = `${outFile}.tts-tmp`;
    try {
      const { audioFilePath, metadataFilePath } = await withRetry(
        async () => {
          this.counter.add("edge-tts");
          await fsp.rm(tmpDir, { recursive: true, force: true });
          await fsp.mkdir(tmpDir, { recursive: true });
          const tts = new MsEdgeTTS({ connectionTimeoutMs: 15_000, synthesisTimeoutMs: 30_000 });
          try {
            await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
              wordBoundaryEnabled: true,
            });
            return await tts.toFile(tmpDir, escapeXml(text));
          } finally {
            tts.close();
          }
        },
        {
          timeoutMs: 90_000,
          // Edge errors carry no HTTP status; retry them all.
          shouldRetry: () => true,
          onRetry: (err, attempt, delay) =>
            this.log.warn("Edge TTS failed, retrying", { attempt, delayMs: delay, error: errorMessage(err) }),
        },
      );
      const words = metadataFilePath
        ? parseEdgeWordBoundaries(JSON.parse(await fsp.readFile(metadataFilePath, "utf8")))
        : [];
      await fsp.mkdir(path.dirname(outFile), { recursive: true });
      await fsp.rename(audioFilePath, outFile);
      return { words };
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  }
}
