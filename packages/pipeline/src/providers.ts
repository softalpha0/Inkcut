import { ServLlmClient } from "./llm/serv.js";
import type { LlmClient } from "./llm/types.js";
import { FalImageProvider } from "./images/fal.js";
import { POLLINATIONS_DEFAULT_MODEL, PollinationsImageProvider } from "./images/pollinations.js";
import type { ImageProvider } from "./images/types.js";
import { OpenAiSttProvider } from "./stt/openai.js";
import type { SttProvider } from "./stt/types.js";
import { EdgeTtsProvider } from "./tts/edge.js";
import type { TtsProvider } from "./tts/types.js";
import {
  POLLINATIONS_DEFAULT_VIDEO_MODEL,
  POLLINATIONS_DEFAULT_VIDEO_RESOLUTION,
  PollinationsVideoProvider,
} from "./video/pollinations.js";
import type { VideoProvider } from "./video/types.js";
import { optionalEnv, requireEnv } from "./env.js";
import type { Logger } from "./util/log.js";
import type { ApiCallCounter } from "./util/metrics.js";

export interface Providers {
  llm(): LlmClient;
  tts(): TtsProvider;
  images(): ImageProvider;
  stt(): SttProvider;
  video(): VideoProvider;
}

function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

/**
 * Providers chosen by env vars. Each is created on first use, so a resumed run that
 * only needs `render` never asks for API keys.
 */
export function providersFromEnv(counter: ApiCallCounter, log: Logger): Providers {
  return {
    llm: lazy(() => {
      return new ServLlmClient(
        {
          apiKey: requireEnv("SERV_API_KEY"),
          baseURL: optionalEnv("SERV_BASE_URL", "https://inference-api.openserv.ai/v1"),
          model: optionalEnv("SERV_MODEL", "gpt-5.4-mini"),
        },
        counter,
        log,
      );
    }),
    tts: lazy(() => {
      const name = optionalEnv("TTS_PROVIDER", "edge");
      if (name === "edge") return new EdgeTtsProvider(counter, log);
      throw new Error(`Unknown TTS_PROVIDER "${name}". Supported: edge`);
    }),
    images: lazy(() => {
      const name = optionalEnv("IMAGE_PROVIDER", "fal");
      if (name === "fal") return new FalImageProvider(requireEnv("FAL_KEY"), counter, log);
      if (name === "pollinations") {
        return new PollinationsImageProvider(
          {
            apiKey: requireEnv("POLLINATIONS_API_KEY"),
            model: optionalEnv("POLLINATIONS_MODEL", POLLINATIONS_DEFAULT_MODEL),
          },
          counter,
          log,
        );
      }
      if (name === "replicate") {
        throw new Error(`IMAGE_PROVIDER "replicate" is planned for M2. Use fal or pollinations.`);
      }
      throw new Error(`Unknown IMAGE_PROVIDER "${name}". Supported: fal, pollinations`);
    }),
    stt: lazy(() => {
      const name = optionalEnv("STT_PROVIDER", "openai");
      if (name === "openai") {
        return new OpenAiSttProvider(
          {
            apiKey: requireEnv("STT_API_KEY"),
            baseURL: optionalEnv("STT_BASE_URL", "https://api.openai.com/v1"),
            model: optionalEnv("STT_MODEL", "whisper-1"),
          },
          counter,
          log,
        );
      }
      throw new Error(`Unknown STT_PROVIDER "${name}". Supported: openai (local whisper is planned)`);
    }),
    video: lazy(() => {
      const name = optionalEnv("ANIMATE_PROVIDER", "pollinations");
      if (name === "pollinations") {
        return new PollinationsVideoProvider(
          {
            apiKey: requireEnv("POLLINATIONS_API_KEY"),
            model: optionalEnv("ANIMATE_MODEL", POLLINATIONS_DEFAULT_VIDEO_MODEL),
            resolution: optionalEnv("ANIMATE_RESOLUTION", POLLINATIONS_DEFAULT_VIDEO_RESOLUTION),
          },
          counter,
          log,
        );
      }
      throw new Error(`Unknown ANIMATE_PROVIDER "${name}". Supported: pollinations`);
    }),
  };
}
