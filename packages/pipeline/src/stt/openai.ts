import fs from "node:fs";
import OpenAI from "openai";
import type { Logger } from "../util/log.js";
import type { ApiCallCounter } from "../util/metrics.js";
import { errorMessage, withRetry } from "../util/retry.js";
import type { SttProvider, Transcript } from "./types.js";

export interface OpenAiSttConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

/**
 * Any OpenAI-compatible /audio/transcriptions endpoint (OpenAI whisper-1 by default).
 * Uses verbose_json with word timestamps. SERV has no transcription endpoint (404).
 */
export class OpenAiSttProvider implements SttProvider {
  readonly name = "openai";
  private readonly client: OpenAI;

  constructor(
    private readonly config: OpenAiSttConfig,
    private readonly counter: ApiCallCounter,
    private readonly log: Logger,
  ) {
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, maxRetries: 0 });
  }

  async transcribe(audioFile: string): Promise<Transcript> {
    const timeoutMs = 300_000;
    const res = await withRetry(
      (signal) => {
        this.counter.add("stt");
        return this.client.audio.transcriptions.create(
          {
            file: fs.createReadStream(audioFile),
            model: this.config.model,
            response_format: "verbose_json",
            timestamp_granularities: ["word"],
          },
          { signal, timeout: timeoutMs },
        );
      },
      {
        timeoutMs,
        onRetry: (err, attempt, delay) =>
          this.log.warn("Transcription failed, retrying", {
            attempt,
            delayMs: delay,
            error: errorMessage(err),
          }),
      },
    );
    const words = (res.words ?? []).map((w) => ({ text: w.word.trim(), start: w.start, end: w.end }));
    if (words.length === 0) {
      throw new Error(
        "Transcription returned no word timestamps; the STT endpoint must support timestamp_granularities=word",
      );
    }
    return { text: res.text.trim(), durationSec: res.duration, words };
  }
}
