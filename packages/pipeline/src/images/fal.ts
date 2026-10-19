import { createFalClient, type FalClient } from "@fal-ai/client";
import type { Logger } from "../util/log.js";
import { downloadToFile } from "../util/fs.js";
import type { ApiCallCounter } from "../util/metrics.js";
import { errorMessage, withRetry } from "../util/retry.js";
import type { ImageProvider, ImageRequest } from "./types.js";

export const FAL_FLUX_SCHNELL = "fal-ai/flux/schnell";

/**
 * fal.ai Flux Schnell. Input: prompt, image_size {width,height}, seed, num_inference_steps,
 * output_format. No negative prompt support.
 */
export class FalImageProvider implements ImageProvider {
  readonly name = "fal";
  private readonly fal: FalClient;

  constructor(
    apiKey: string,
    private readonly counter: ApiCallCounter,
    private readonly log: Logger,
  ) {
    this.fal = createFalClient({ credentials: apiKey });
  }

  async generate(req: ImageRequest): Promise<void> {
    const retryLog = (what: string) => (err: unknown, attempt: number, delayMs: number) =>
      this.log.warn(`${what} failed, retrying`, { attempt, delayMs, error: errorMessage(err) });

    const result = await withRetry(
      (signal) => {
        this.counter.add("fal");
        return this.fal.subscribe(FAL_FLUX_SCHNELL, {
          input: {
            prompt: req.prompt,
            image_size: { width: req.width, height: req.height },
            num_inference_steps: 4,
            num_images: 1,
            output_format: "png",
            enable_safety_checker: true,
            ...(req.seed !== undefined ? { seed: req.seed } : {}),
          },
          abortSignal: signal,
        });
      },
      { timeoutMs: 120_000, onRetry: retryLog("fal image") },
    );

    const url = result.data.images[0]?.url;
    if (!url) throw new Error(`fal returned no image (request ${result.requestId})`);
    if (result.data.has_nsfw_concepts?.[0]) {
      this.log.warn("fal flagged the image as NSFW; it may be blank", { requestId: result.requestId });
    }
    await withRetry((signal) => downloadToFile(url, req.outFile, signal), {
      timeoutMs: 60_000,
      onRetry: retryLog("image download"),
    });
  }
}
