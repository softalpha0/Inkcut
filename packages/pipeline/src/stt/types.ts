import type { WordTiming } from "@inkcut/shared";

export interface Transcript {
  /** Full text with punctuation. */
  text: string;
  durationSec: number;
  /** Absolute word timings in seconds. */
  words: WordTiming[];
}

export interface SttProvider {
  readonly name: string;
  transcribe(audioFile: string): Promise<Transcript>;
}
