import type { ApiCallCounts } from "@inkcut/shared";

/** Counts outbound API requests per service (every attempt, including retries). */
export class ApiCallCounter {
  private readonly counts: Record<string, number> = {};

  add(service: string, n = 1): void {
    this.counts[service] = (this.counts[service] ?? 0) + n;
  }

  get(service: string): number {
    return this.counts[service] ?? 0;
  }

  snapshot(): ApiCallCounts {
    return { ...this.counts };
  }
}
