import fsp from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PollinationsImageProvider, isPng, pollinationsImageUrl } from "../src/images/pollinations.js";
import { silentLogger } from "../src/util/log.js";
import { ApiCallCounter } from "../src/util/metrics.js";
import { runFfmpeg } from "../src/util/ffmpeg.js";
import { tempDir } from "./fakes.js";

const config = { apiKey: "sk_test", model: "black-forest-labs/flux.1-schnell" };

describe("pollinationsImageUrl", () => {
  it("puts the encoded prompt in the path and size/seed/model in the query", () => {
    const url = new URL(
      pollinationsImageUrl(config, {
        prompt: "a stick figure, 50% sure?",
        width: 1536,
        height: 864,
        seed: 7,
        outFile: "x",
      }),
    );
    expect(url.origin).toBe("https://gen.pollinations.ai");
    expect(decodeURIComponent(url.pathname)).toBe("/image/a stick figure, 50% sure?");
    expect(url.searchParams.get("model")).toBe("black-forest-labs/flux.1-schnell");
    expect(url.searchParams.get("width")).toBe("1536");
    expect(url.searchParams.get("height")).toBe("864");
    expect(url.searchParams.get("seed")).toBe("7");
    expect(url.searchParams.has("key")).toBe(false);
  });
});

describe("PollinationsImageProvider (fetch mocked)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the key as a Bearer header and converts JPEG to PNG", async () => {
    const dir = await tempDir();
    const jpg = path.join(dir, "in.jpg");
    await runFfmpeg(["-f", "lavfi", "-i", "color=c=white:s=64x36", "-frames:v", "1", jpg]);
    const body = await fsp.readFile(jpg);
    const fetchMock = vi.fn(
      async (_url: string | URL, _init?: RequestInit) =>
        new Response(body, { headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const counter = new ApiCallCounter();
    const outFile = path.join(dir, "images", "000.png");
    await new PollinationsImageProvider(config, counter, silentLogger).generate({
      prompt: "p",
      width: 64,
      height: 36,
      outFile,
    });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test");
    expect(isPng(await fsp.readFile(outFile))).toBe(true);
    expect(counter.get("pollinations")).toBe(1);
  });

  it("does not retry a 402 (no pollen) and says why", async () => {
    const fetchMock = vi.fn(async () => new Response("insufficient balance", { status: 402 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new PollinationsImageProvider(config, new ApiCallCounter(), silentLogger);
    await expect(
      provider.generate({ prompt: "p", width: 64, height: 64, outFile: path.join(await tempDir(), "x.png") }),
    ).rejects.toThrow(/pollen balance/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
