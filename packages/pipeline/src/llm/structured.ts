import { LIMITS } from "@inkcut/shared";
import { z } from "zod";
import type { Logger } from "../util/log.js";
import type { LlmClient, LlmMessage } from "./types.js";

export class LlmValidationError extends Error {
  constructor(
    message: string,
    readonly lastReply: string,
  ) {
    super(message);
    this.name = "LlmValidationError";
  }
}

/** Pulls a JSON object out of a reply that may be wrapped in ```json fences or prose. */
export function extractJson(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(reply);
  const body = (fenced?.[1] ?? reply).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Reply contains no JSON object");
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}

function describeError(err: unknown): string {
  if (err instanceof z.ZodError) return z.prettifyError(err);
  return err instanceof Error ? err.message : String(err);
}

export interface ValidatedOptions<T> {
  /** Turns the raw reply into a candidate value (e.g. extractJson, or trimming text). */
  parse: (reply: string) => unknown;
  schema: z.ZodType<T>;
  /** Retries after a validation failure. Default LIMITS.llmValidationRetries (2). */
  retries?: number;
  log?: Logger;
  label?: string;
}

/**
 * Calls the LLM and validates the reply with zod. On failure, the validation
 * error is fed back as a follow-up message and the model is asked again.
 */
export async function completeValidated<T>(
  llm: LlmClient,
  messages: LlmMessage[],
  opts: ValidatedOptions<T>,
): Promise<T> {
  const retries = opts.retries ?? LIMITS.llmValidationRetries;
  const convo = [...messages];
  let lastReply = "";
  let lastError = "";

  for (let attempt = 0; attempt <= retries; attempt++) {
    lastReply = await llm.chat(convo);
    try {
      return opts.schema.parse(opts.parse(lastReply));
    } catch (err) {
      lastError = describeError(err);
      opts.log?.warn(`${opts.label ?? "LLM"} reply failed validation`, {
        attempt: attempt + 1,
        error: lastError.split("\n")[0],
      });
      convo.push(
        { role: "assistant", content: lastReply },
        {
          role: "user",
          content: `Your reply failed validation:\n${lastError}\n\nReply again with the complete corrected answer only, in the exact format requested.`,
        },
      );
    }
  }
  throw new LlmValidationError(
    `${opts.label ?? "LLM"} reply still invalid after ${retries} retries: ${lastError}`,
    lastReply,
  );
}

export function completeJson<T>(
  llm: LlmClient,
  messages: LlmMessage[],
  schema: z.ZodType<T>,
  opts: Omit<ValidatedOptions<T>, "parse" | "schema"> = {},
): Promise<T> {
  return completeValidated(llm, messages, { ...opts, parse: extractJson, schema });
}
