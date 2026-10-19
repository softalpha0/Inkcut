import fsp from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../util/retry.js";

export const POLLINATIONS_BASE_URL = "https://gen.pollinations.ai";
export const POLLINATIONS_MEDIA_URL = "https://media.pollinations.ai";

/** What to do about a failed Pollinations response, by status. */
export function pollinationsHint(status: number): string {
  if (status === 401) return " Check POLLINATIONS_API_KEY (use a secret sk_ key).";
  if (status === 402) {
    return " Your pollen balance or this key's budget is too low; raise the key budget at enter.pollinations.ai/keys (topping up the wallet alone does not raise it).";
  }
  if (status === 403)
    return " This key is not allowed to use that model; allow it under Permissions at enter.pollinations.ai/keys.";
  return "";
}

/** Throws an HttpError with the response body and a hint. Non-OK responses only. */
export async function throwPollinationsError(res: Response, what: string): Promise<never> {
  const body = (await res.text().catch(() => "")).slice(0, 400);
  throw new HttpError(
    res.status,
    `${what} returned ${res.status}.${pollinationsHint(res.status)} ${body}`.trim(),
  );
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * Uploads a local file to media.pollinations.ai and returns its public URL
 * (unlisted, expires after 30 days). Generation endpoints take image inputs as URLs.
 */
export async function uploadMedia(
  apiKey: string,
  file: string,
  signal: AbortSignal,
  mediaURL = POLLINATIONS_MEDIA_URL,
): Promise<string> {
  const bytes = await fsp.readFile(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), path.basename(file));
  const res = await fetch(`${mediaURL}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });
  if (!res.ok) await throwPollinationsError(res, "Pollinations media upload");
  const json = (await res.json()) as { url?: unknown };
  if (typeof json.url !== "string") throw new HttpError(502, "Pollinations media upload returned no url");
  return json.url;
}
