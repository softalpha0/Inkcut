import fsp from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { silentLogger } from "../src/util/log.js";
import { ApiCallCounter } from "../src/util/metrics.js";
import {
  PollinationsVideoProvider,
  modelInfoFromCatalog,
  pollinationsVideoUrl,
} from "../src/video/pollinations.js";
import { tempDir } from "./fakes.js";

const config = {
  apiKey: "sk_test",
  model: "bytedance/seedance-1-pro-fast",
  resolution: "480p",
  pollIntervalMs: 1,
};

/** Shape copied from a real GET /video/models entry. */
const catalog = [
  {
    name: "bytedance/seedance-1-pro-fast",
    min_duration: 2,
    max_duration: 10,
    pricing: { currency: "pollen", completionVideoSeconds: "0.03" },
    pricing_variants: [{ name: "480p", pricing: { currency: "pollen", completionVideoSeconds: "0.015" } }],
  },
  {
    name: "alibaba/wan-2.2-fast",
    aliases: ["wan-fast"],
    min_duration: 5,
    max_duration: 5,
    pricing: { completionVideoSeconds: "0.01" },
  },
];

describe("modelInfoFromCatalog", () => {
  it("reads duration limits and the price for the chosen resolution", () => {
    expect(modelInfoFromCatalog(catalog, "bytedance/seedance-1-pro-fast", "480p")).toEqual({
      model: "bytedance/seedance-1-pro-fast",
      minDurationSec: 2,
      maxDurationSec: 10,
      pricePerSec: 0.015,
    });
    expect(modelInfoFromCatalog(catalog, "bytedance/seedance-1-pro-fast", "720p").pricePerSec).toBe(0.03);
    expect(modelInfoFromCatalog(catalog, "wan-fast", "480p").model).toBe("alibaba/wan-2.2-fast");
  });

  it("rejects unknown models", () => {
    expect(() => modelInfoFromCatalog(catalog, "nope", "480p")).toThrow(/not in the Pollinations catalog/);
  });
});

describe("pollinationsVideoUrl", () => {
  it("passes model, start image, duration and resolution", () => {
    const url = new URL(pollinationsVideoUrl(config, "Sam waves", "https://media.pollinations.ai/abc", 7));
    expect(url.pathname).toBe("/video/Sam%20waves");
    expect(url.searchParams.get("model")).toBe("bytedance/seedance-1-pro-fast");
    expect(url.searchParams.get("image")).toBe("https://media.pollinations.ai/abc");
    expect(url.searchParams.get("duration")).toBe("7");
    expect(url.searchParams.get("resolution")).toBe("480p");
  });
});

describe("PollinationsVideoProvider (fetch mocked)", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function setup() {
    const dir = await tempDir();
    const imageFile = path.join(dir, "images", "000.png");
    await fsp.mkdir(path.dirname(imageFile), { recursive: true });
    await fsp.writeFile(imageFile, "png");
    return { imageFile, outFile: path.join(dir, "animated", "000.mp4") };
  }

  it("uploads the image, starts an async job, polls it and downloads the result", async () => {
    const { imageFile, outFile } = await setup();
    const seen: string[] = [];
    let polls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        seen.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
        if (url.endsWith("/upload"))
          return Response.json({ id: "img1", url: "https://media.pollinations.ai/img1" });
        if (url.includes("/video/")) {
          expect((init?.headers as Record<string, string>).Prefer).toBe("respond-async");
          return Response.json({ id: "job1", status: "pending" }, { status: 202 });
        }
        if (url.endsWith("/v1/jobs/job1")) {
          polls++;
          return Response.json({ status: polls < 2 ? "running" : "succeeded" });
        }
        if (url.endsWith("/v1/jobs/job1/result")) {
          return new Response("MP4DATA", { headers: { "content-type": "video/mp4" } });
        }
        throw new Error(`unexpected ${url}`);
      }),
    );
    const counter = new ApiCallCounter();
    await new PollinationsVideoProvider(config, counter, silentLogger).animate({
      imageFile,
      prompt: "Sam waves",
      durationSec: 5,
      outFile,
    });
    expect(await fsp.readFile(outFile, "utf8")).toBe("MP4DATA");
    expect(seen[0]).toBe("POST https://media.pollinations.ai/upload");
    expect(counter.snapshot()).toEqual({ "pollinations-upload": 1, "pollinations-video": 1 });
  });

  it("reuses the earlier upload on a retry of the same scene", async () => {
    const { imageFile, outFile } = await setup();
    await fsp.mkdir(path.dirname(outFile), { recursive: true });
    await fsp.writeFile(
      `${outFile}.upload.json`,
      JSON.stringify({ url: "https://media.pollinations.ai/old" }),
    );
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/upload")) throw new Error("should not upload again");
      expect(new URL(url).searchParams.get("image")).toBe("https://media.pollinations.ai/old");
      return new Response("CACHED", { headers: { "content-type": "video/mp4" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await new PollinationsVideoProvider(config, new ApiCallCounter(), silentLogger).animate({
      imageFile,
      prompt: "p",
      durationSec: 5,
      outFile,
    });
    expect(await fsp.readFile(outFile, "utf8")).toBe("CACHED");
  });

  it("does not retry a 402 and explains the key budget", async () => {
    const { imageFile, outFile } = await setup();
    const fetchMock = vi.fn(async (input: string | URL) =>
      String(input).endsWith("/upload")
        ? Response.json({ url: "https://media.pollinations.ai/x" })
        : new Response("API key budget too low", { status: 402 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new PollinationsVideoProvider(config, new ApiCallCounter(), silentLogger).animate({
        imageFile,
        prompt: "p",
        durationSec: 5,
        outFile,
      }),
    ).rejects.toThrow(/key's budget/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a failed job", async () => {
    const { imageFile, outFile } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/upload")) return Response.json({ url: "https://media.pollinations.ai/x" });
        if (url.includes("/video/")) return Response.json({ id: "j" }, { status: 202 });
        return Response.json({ status: "failed", error: "moderation" });
      }),
    );
    await expect(
      new PollinationsVideoProvider(config, new ApiCallCounter(), silentLogger).animate({
        imageFile,
        prompt: "p",
        durationSec: 5,
        outFile,
      }),
    ).rejects.toThrow(/failed: moderation/);
  });
});
