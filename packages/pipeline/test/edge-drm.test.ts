import { describe, expect, it } from "vitest";
import { MsEdgeTTS } from "msedge-tts";
import { SEC_MS_GEC_VERSION, generateMuid, generateSecMsGec } from "../src/tts/edge-drm.js";
import { EDGE_WSS_URL, edgeSynthUrl } from "../src/tts/edge.js";

describe("Edge TTS v2 token", () => {
  // Reference values from python edge-tts 7.3.1 (edge_tts/drm.py, generate_sec_ms_gec_v2).
  it.each([
    [0, "52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6"],
    [1_700_000_000, "2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2"],
    [1_761_400_000.7, "D96E7FBD4DD2970E-90C3494324F333E9CAD6C2FBF64C010C4986898CB1299C3A2724A9E25C61EF8E"],
    [1_793_000_000, "781C1B76C9F739B3-1A772624F17530DF13FBF300637917F70D55C163861ADEC2DA70A248A0DE438A"],
    [1_800_000_123, "99E54519B490BE5C-E162DB0977FBDCB9B86DD8148BF1BCDC3C0303176CE39852A42B415935C20654"],
  ])("matches the Python implementation at %s", (unix, token) => {
    expect(generateSecMsGec(unix)).toBe(token);
  });

  it("stays the same within a five-minute window", () => {
    expect(generateSecMsGec(1_800_000_000)).toBe(generateSecMsGec(1_800_000_000 + 299));
    expect(generateSecMsGec(1_800_000_000)).not.toBe(generateSecMsGec(1_800_000_000 + 300));
  });

  it("makes a 32-digit muid", () => {
    expect(generateMuid()).toMatch(/^[0-9A-F]{32}$/);
  });
});

describe("Edge TTS URL", () => {
  it("uses the read-aloud endpoint with the v2 token", () => {
    const url = new URL(edgeSynthUrl(1_700_000_000, "abc123"));
    expect(`${url.origin}${url.pathname}`.replace("https:", "wss:")).toBe(EDGE_WSS_URL);
    expect(url.searchParams.get("ConnectionId")).toBe("abc123");
    expect(url.searchParams.get("Sec-MS-GEC")).toBe(generateSecMsGec(1_700_000_000));
    expect(url.searchParams.get("Sec-MS-GEC-Version")).toBe(SEC_MS_GEC_VERSION);
  });

  it("replaces msedge-tts's own URL builder", async () => {
    const getSynthUrl = (MsEdgeTTS as unknown as { getSynthUrl: () => Promise<string> }).getSynthUrl;
    const url = await getSynthUrl();
    expect(url.startsWith(`${EDGE_WSS_URL}?TrustedClientToken=`)).toBe(true);
    expect(url).toMatch(/Sec-MS-GEC=[0-9A-F]{16}-[0-9A-F]{64}&/);
  });
});
