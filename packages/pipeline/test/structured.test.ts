import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LlmValidationError, completeJson, extractJson } from "../src/llm/structured.js";
import type { LlmMessage } from "../src/llm/types.js";
import { FakeLlm } from "./fakes.js";
import { cleanScript, scriptSchema } from "../src/stages/script.js";

const schema = z.object({ n: z.number() });
const msgs: LlmMessage[] = [
  { role: "system", content: "Reply with JSON" },
  { role: "user", content: "go" },
];

describe("extractJson", () => {
  it("reads fenced and bare JSON", () => {
    expect(extractJson('```json\n{"n": 1}\n```')).toEqual({ n: 1 });
    expect(extractJson('Sure! {"n": 2} hope that helps')).toEqual({ n: 2 });
  });
});

describe("completeJson", () => {
  it("retries with the validation error fed back, then succeeds", async () => {
    const llm = new FakeLlm();
    llm.queued = ['{"n": "one"}', '{"n": 1}'];
    const seen: LlmMessage[][] = [];
    const spy = { name: "spy", chat: (m: LlmMessage[]) => (seen.push([...m]), llm.chat(m)) };
    await expect(completeJson(spy, msgs, schema)).resolves.toEqual({ n: 1 });
    expect(llm.calls).toBe(2);
    const retry = seen[1]!;
    expect(retry.at(-2)).toEqual({ role: "assistant", content: '{"n": "one"}' });
    expect(retry.at(-1)?.content).toMatch(/failed validation/);
    expect(retry.at(-1)?.content).toMatch(/n/);
  });

  it("gives up after 2 retries (3 calls)", async () => {
    const llm = new FakeLlm();
    llm.queued = ["nope", "still nope", "{}", '{"n": 1}'];
    await expect(completeJson(llm, msgs, schema)).rejects.toBeInstanceOf(LlmValidationError);
    expect(llm.calls).toBe(3);
  });
});

describe("script cleanup", () => {
  it("strips headings, labels, markdown and quotes", () => {
    expect(cleanScript('# Title\nNarration: "**Why** do we wait?\n\n- Because it feels good."')).toBe(
      "Why do we wait? Because it feels good.",
    );
  });

  it("enforces the target length window", () => {
    const s = scriptSchema(150);
    expect(s.safeParse("word ".repeat(150).trim()).success).toBe(true);
    expect(s.safeParse("word ".repeat(60).trim()).success).toBe(false);
    expect(s.safeParse("word ".repeat(250).trim()).success).toBe(false);
  });
});
