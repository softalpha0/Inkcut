import OpenAI from "openai";
import type { Logger } from "../util/log.js";
import type { ApiCallCounter } from "../util/metrics.js";
import { errorMessage, withRetry } from "../util/retry.js";
import type { LlmClient, LlmMessage } from "./types.js";

export interface ServConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  timeoutMs?: number;
}

/**
 * SERV Reasoning through its OpenAI-compatible /v1/chat/completions endpoint.
 * Docs: https://docs.openserv.ai/serv-reasoning/sdk-integration
 */
export class ServLlmClient implements LlmClient {
  readonly name = "serv";
  private readonly client: OpenAI;

  constructor(
    private readonly config: ServConfig,
    private readonly counter: ApiCallCounter,
    private readonly log: Logger,
  ) {
    // Retries are handled by withRetry so every attempt is counted and logged.
    this.client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, maxRetries: 0 });
  }

  async chat(messages: LlmMessage[]): Promise<string> {
    if (!messages.some((m) => m.role === "system")) {
      throw new Error("SERV requires a system message on every request");
    }
    const timeoutMs = this.config.timeoutMs ?? 180_000;
    const completion = await withRetry(
      (signal) => {
        this.counter.add("serv");
        return this.client.chat.completions.create(
          { model: this.config.model, messages },
          { signal, timeout: timeoutMs },
        );
      },
      {
        timeoutMs,
        onRetry: (err, attempt, delay) =>
          this.log.warn(`SERV call failed, retrying`, { attempt, delayMs: delay, error: errorMessage(err) }),
      },
    );
    const text = completion.choices[0]?.message?.content;
    if (!text)
      throw new Error(`SERV returned an empty reply (finish_reason=${completion.choices[0]?.finish_reason})`);
    return text;
  }
}
