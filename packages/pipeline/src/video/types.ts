export interface VideoModelInfo {
  model: string;
  /** Shortest and longest clip the model generates, seconds. */
  minDurationSec: number;
  maxDurationSec: number;
  /** Pollen per generated second at the chosen resolution, if known. */
  pricePerSec?: number;
}

export interface AnimateRequest {
  /** Local still image used as the first frame. */
  imageFile: string;
  /** What should move. */
  prompt: string;
  /** Whole seconds, within the model's min/max. */
  durationSec: number;
  /** MP4 written here. */
  outFile: string;
}

/** Image-to-video: turns a scene's still image into a short clip. */
export interface VideoProvider {
  readonly name: string;
  /** Duration limits and price, used for planning and the cost estimate. */
  describe(): Promise<VideoModelInfo>;
  animate(req: AnimateRequest): Promise<void>;
}
