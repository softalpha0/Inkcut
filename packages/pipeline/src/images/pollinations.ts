import fsp from "node:fs/promises";
import path from "node:path";
import { runFfmpeg } from "../util/ffmpeg.js";
import type { Logger } from "../util/log.js";
import type { ApiCallCounter } from "../util/metrics.js";
import { POLLINATIONS_BASE_URL, throwPollinationsError } from "../pollinations/client.js";
import { HttpError, errorMessage, withRetry } from "../util/retry.js";
import type { ImageProvider, ImageRequest } from "./types.js";

export { POLLINATIONS_BASE_URL };
export const POLLINATIONS_DEFAULT_MODEL = "black-forest-labs/flux.1-schnell";

export interface PollinationsConfig {
  apiKey: string;
  model: string;
  baseURL?: string;
}

/** URL for GET /image/{prompt}; the prompt goes URL-encoded in the path. */
export function pollinationsImageUrl(config: PollinationsConfig, req: ImageRequest): string {
  const url = new URL(`/image/${encodeURIComponent(req.prompt)}`, config.baseURL ?? POLLINATIONS_BASE_URL);
  url.searchParams.set("model", config.model);
  url.searchParams.set("width", String(req.width));
  url.searchParams.set("height", String(req.height));
  if (req.seed !== undefined) url.searchParams.set("seed", String(req.seed));
  return url.toString();
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

export function isPng(bytes: Uint8Array): boolean {
  return PNG_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Pollinations image API (https://gen.pollinations.ai, docs: pollinations/APIDOCS.md).
 * Auth: Authorization: Bearer sk_... Billed in pollen from the account balance;
 * an empty balance or key budget returns 402, which is not retried.
 */
export class PollinationsImageProvider implements ImageProvider {
  readonly name = "pollinations";

  constructor(
    private readonly config: PollinationsConfig,
    private readonly counter: ApiCallCounter,
    private readonly log: Logger,
  ) {}

  async generate(req: ImageRequest): Promise<void> {
    const url = pollinationsImageUrl(this.config, req);
    const bytes = await withRetry(
      async (signal) => {
        this.counter.add("pollinations");
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${this.config.apiKey}` },
          signal,
        });
        if (!res.ok) await throwPollinationsError(res, "Pollinations image");
        const type = res.headers.get("content-type") ?? "";
        if (!type.startsWith("image/")) {
          throw new HttpError(502, `Pollinations returned ${type || "no content type"} instead of an image`);
        }
        return new Uint8Array(await res.arrayBuffer());
      },
      {
        timeoutMs: 120_000,
        onRetry: (err, attempt, delayMs) =>
          this.log.warn("Pollinations image failed, retrying", {
            attempt,
            delayMs,
            error: errorMessage(err),
          }),
      },
    );

    await fsp.mkdir(path.dirname(req.outFile), { recursive: true });
    if (isPng(bytes)) {
      const tmp = `${req.outFile}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, bytes);
      await fsp.rename(tmp, req.outFile);
      return;
    }
    // JPEG/WebP: convert so every scene image is a real PNG.
    const src = `${req.outFile}.${process.pid}.src`;
    const tmpPng = `${req.outFile}.${process.pid}.tmp.png`;
    await fsp.writeFile(src, bytes);
    try {
      await runFfmpeg(["-i", src, "-frames:v", "1", tmpPng]);
      await fsp.rename(tmpPng, req.outFile);
    } finally {
      await fsp.rm(src, { force: true });
    }
  }
}
