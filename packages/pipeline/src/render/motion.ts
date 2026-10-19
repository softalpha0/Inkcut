import type { Motion } from "@inkcut/shared";

/** How far zoom/pan moves over one scene. */
const ZOOM_AMOUNT = 0.15;
const PAN_ZOOM = 1.15;

export interface ZoompanExpr {
  z: string;
  x: string;
  y: string;
}

/**
 * zoompan expressions for one scene of `frames` frames. `on` is the output frame
 * number; progress p runs 0 → 1 across the scene. x/y are in input pixels.
 */
export function motionExpr(motion: Motion, frames: number): ZoompanExpr {
  const p = frames > 1 ? `(on/${frames - 1})` : "0";
  const centerX = "(iw-iw/zoom)/2";
  const centerY = "(ih-ih/zoom)/2";
  switch (motion) {
    case "zoom_in":
      return { z: `1+${ZOOM_AMOUNT}*${p}`, x: centerX, y: centerY };
    case "zoom_out":
      return { z: `${1 + ZOOM_AMOUNT}-${ZOOM_AMOUNT}*${p}`, x: centerX, y: centerY };
    case "pan_left":
      // camera drifts right-to-left across the image
      return { z: `${PAN_ZOOM}`, x: `(iw-iw/zoom)*(1-${p})`, y: centerY };
    case "pan_right":
      return { z: `${PAN_ZOOM}`, x: `(iw-iw/zoom)*${p}`, y: centerY };
    case "static":
      return { z: "1", x: "0", y: "0" };
  }
}

/** Animated clips are slowed down at most this much to fill a longer scene; the rest holds the last frame. */
export const MAX_ANIMATED_STRETCH = 1.3;

/**
 * -vf chain for an animated clip: retime it to the scene's length (slowing down
 * up to MAX_ANIMATED_STRETCH, then holding the last frame; longer clips are
 * cut), and cover-crop it to the output size.
 */
export function animatedSceneFilter(
  clipSec: number,
  frames: number,
  width: number,
  height: number,
  fps: number,
): string {
  const sceneSec = frames / fps;
  const stretch = Math.min(MAX_ANIMATED_STRETCH, Math.max(1, sceneSec / clipSec));
  return [
    `setpts=${stretch.toFixed(4)}*PTS`,
    `fps=${fps}`,
    `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${width}:${height}`,
    `tpad=stop_mode=clone:stop_duration=${Math.ceil(sceneSec)}`,
    "setsar=1",
    "format=yuv420p",
  ].join(",");
}

/**
 * Full -vf chain: cover-crop the image to 2× the output size (reduces zoompan
 * jitter from integer rounding), then zoompan down to the output size.
 */
export function sceneFilter(
  motion: Motion,
  frames: number,
  width: number,
  height: number,
  fps: number,
): string {
  const { z, x, y } = motionExpr(motion, frames);
  const W = width * 2;
  const H = height * 2;
  return [
    `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${W}:${H}`,
    `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${width}x${height}:fps=${fps}`,
    "setsar=1",
    "format=yuv420p",
  ].join(",");
}
