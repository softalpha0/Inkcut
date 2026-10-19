export interface ImageRequest {
  prompt: string;
  /** Ignored by providers without negative-prompt support (e.g. Flux Schnell). */
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: number;
  /** PNG written here. */
  outFile: string;
}

export interface ImageProvider {
  readonly name: string;
  generate(req: ImageRequest): Promise<void>;
}
