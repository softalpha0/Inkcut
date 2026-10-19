import path from "node:path";

const TYPES: Record<string, string> = {
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
};

export function contentTypeFor(file: string): string {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}
