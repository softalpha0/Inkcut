import { Redis } from "ioredis";

export function redisConnectionForTests(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}
