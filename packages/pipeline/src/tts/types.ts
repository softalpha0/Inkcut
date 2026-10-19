import type { WordTiming } from "@inkcut/shared";

export interface TtsResult {
  /** Word timings relative to the start of the written audio file, if the provider reports them. */
  words: WordTiming[];
}

export interface TtsProvider {
  readonly name: string;
  /** Speak `text` with `voiceId` and write an MP3 to `outFile`. */
  synthesize(text: string, voiceId: string, outFile: string): Promise<TtsResult>;
}
