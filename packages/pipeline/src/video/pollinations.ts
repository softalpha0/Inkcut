import fsp from "node:fs/promises";
import path from "node:path";
import { LIMITS } from "@inkcut/shared";
import {
  POLLINATIONS_BASE_URL,
  POLLINATIONS_MEDIA_URL,
  throwPollinationsError,
  uploadMedia,
} from "../pollinations/client.js";
import type { Logger } from "../util/log.js";
import type { ApiCallCounter } from "../util/metrics.js";
import { HttpError, errorMessage, withRetry } from "../util/retry.js";
import type { AnimateRequest, VideoModelInfo, VideoProvider } from "./types.js";

export const POLLINATIONS_DEFAULT_VIDEO_MODEL = "bytedance/seedance-1-pro-fast";
export const POLLINATIONS_DEFAULT_VIDEO_RESOLUTION = "480p";

export interface PollinationsVideoConfig {
  apiKey: string;
  model: string;
  resolution: string;
  baseURL?: string;
  mediaURL?: string;
  /** Delay between job status checks, ms. */
  pollIntervalMs?: number;
}

interface CatalogPricing {
  completionVideoSeconds?: string;
}

interface CatalogModel {
  name: string;
  aliases?: string[];
  min_duration?: number;
  max_duration?: number;
  pricing?: CatalogPricing;
  pricing_variants?: { name: string; pricing?: CatalogPricing }[];
}

/** Reads one model's limits and per-second price (for the chosen resolution) from GET /video/models. */
export function modelInfoFromCatalog(
  catalog: CatalogModel[],
  model: string,
  resolution: string,
): VideoModelInfo {
  const m = catalog.find((c) => c.name === model || c.aliases?.includes(model));
  if (!m) throw new Error(`Video model "${model}" is not in the Pollinations catalog (GET /video/models)`);
  const variant = m.pricing_variants?.find((v) => v.name === resolution)?.pricing;
  const price = Number((variant ?? m.pricing)?.completionVideoSeconds);
  return {
    model: m.name,
    minDurationSec: m.min_duration ?? 1,
    maxDurationSec: m.max_duration ?? 5,
    ...(Number.isFinite(price) && price > 0 ? { pricePerSec: price } : {}),
  };
}

/** URL for GET /video/{prompt} with the start image passed as `image`. */
export function pollinationsVideoUrl(
  config: PollinationsVideoConfig,
  prompt: string,
  imageUrl: string,
  durationSec: number,
): string {
  const url = new URL(`/video/${encodeURIComponent(prompt)}`, config.baseURL ?? POLLINATIONS_BASE_URL);
  url.searchParams.set("model", config.model);
  url.searchParams.set("image", imageUrl);
  url.searchParams.set("duration", String(durationSec));
  url.searchParams.set("resolution", config.resolution);
  return url.toString();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Pollinations image-to-video. The scene image is uploaded to media.pollinations.ai,
 * then GET /video/{prompt}?model&image&duration&resolution runs as an async job
 * (Prefer: respond-async → 202 + job id; poll GET /v1/jobs/{id}; download /v1/jobs/{id}/result).
 * Identical requests join one generation and one charge, so retries are not billed twice.
 */
export class PollinationsVideoProvider implements VideoProvider {
  readonly name = "pollinations";
  private info?: Promise<VideoModelInfo>;

  constructor(
    private readonly config: PollinationsVideoConfig,
    private readonly counter: ApiCallCounter,
    private readonly log: Logger,
  ) {}

  private get base(): string {
    return this.config.baseURL ?? POLLINATIONS_BASE_URL;
  }

  private auth(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiKey}` };
  }

  describe(): Promise<VideoModelInfo> {
    this.info ??= withRetry(
      async (signal) => {
        const res = await fetch(`${this.base}/video/models`, { signal });
        if (!res.ok) await throwPollinationsError(res, "Pollinations video catalog");
        const catalog = (await res.json()) as CatalogModel[];
        return modelInfoFromCatalog(catalog, this.config.model, this.config.resolution);
      },
      { timeoutMs: 30_000 },
    );
    return this.info;
  }

  async animate(req: AnimateRequest): Promise<void> {
    const retryLog = (what: string) => (err: unknown, attempt: number, delayMs: number) =>
      this.log.warn(`${what} failed, retrying`, { attempt, delayMs, error: errorMessage(err) });

    // Reuse an earlier upload of the same image (saved next to the clip) so resumes don't re-upload.
    const uploadRecord = `${req.outFile}.upload.json`;
    let imageUrl: string | undefined;
    try {
      imageUrl = (JSON.parse(await fsp.readFile(uploadRecord, "utf8")) as { url?: string }).url;
    } catch {
      imageUrl = undefined;
    }
    if (!imageUrl) {
      imageUrl = await withRetry(
        (signal) => {
          this.counter.add("pollinations-upload");
          return uploadMedia(
            this.config.apiKey,
            req.imageFile,
            signal,
            this.config.mediaURL ?? POLLINATIONS_MEDIA_URL,
          );
        },
        { timeoutMs: 60_000, onRetry: retryLog("image upload") },
      );
      await fsp.mkdir(path.dirname(uploadRecord), { recursive: true });
      await fsp.writeFile(uploadRecord, JSON.stringify({ url: imageUrl }));
    }

    const url = pollinationsVideoUrl(this.config, req.prompt, imageUrl, req.durationSec);
    type Started = { kind: "cached"; bytes: Uint8Array } | { kind: "job"; jobId: string };
    const started = await withRetry(
      async (signal): Promise<Started> => {
        this.counter.add("pollinations-video");
        const res = await fetch(url, { headers: { ...this.auth(), Prefer: "respond-async" }, signal });
        if (!res.ok) await throwPollinationsError(res, "Pollinations video");
        const type = res.headers.get("content-type") ?? "";
        if (res.status === 200 && type.startsWith("video/")) {
          // Already cached: the finished video comes back directly.
          return { kind: "cached", bytes: new Uint8Array(await res.arrayBuffer()) };
        }
        const json = (await res.json().catch(() => ({}))) as { id?: unknown };
        if (typeof json.id !== "string") throw new HttpError(502, "Pollinations video returned no job id");
        return { kind: "job", jobId: json.id };
      },
      { timeoutMs: 120_000, onRetry: retryLog("video request") },
    );

    await fsp.mkdir(path.dirname(req.outFile), { recursive: true });
    if (started.kind === "cached") {
      await fsp.writeFile(req.outFile, started.bytes);
      return;
    }

    const jobId = started.jobId;
    const deadline = Date.now() + LIMITS.animateJobTimeoutMs;
    const interval = this.config.pollIntervalMs ?? 5000;
    for (;;) {
      const status = await withRetry(
        async (signal) => {
          const res = await fetch(`${this.base}/v1/jobs/${encodeURIComponent(jobId)}`, {
            headers: this.auth(),
            signal,
          });
          if (!res.ok) await throwPollinationsError(res, "Pollinations job status");
          return (await res.json()) as { status?: string; error?: unknown };
        },
        { timeoutMs: 30_000, onRetry: retryLog("job status") },
      );
      if (status.status === "succeeded") break;
      if (status.status === "failed") {
        const reason = typeof status.error === "string" ? status.error : JSON.stringify(status.error ?? "");
        throw new Error(`Pollinations video job ${jobId} failed: ${reason}`);
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Pollinations video job ${jobId} did not finish within ${LIMITS.animateJobTimeoutMs / 60000} min`,
        );
      }
      await sleep(interval);
    }

    await withRetry(
      async (signal) => {
        const res = await fetch(`${this.base}/v1/jobs/${encodeURIComponent(jobId)}/result`, {
          headers: this.auth(),
          signal,
          redirect: "follow",
        });
        if (!res.ok) await throwPollinationsError(res, "Pollinations job result");
        const tmp = `${req.outFile}.${process.pid}.tmp`;
        await fsp.writeFile(tmp, new Uint8Array(await res.arrayBuffer()));
        await fsp.rename(tmp, req.outFile);
      },
      { timeoutMs: 180_000, onRetry: retryLog("video download") },
    );
  }
}
