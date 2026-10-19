import fsp from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapLimit } from "../src/util/concurrency.js";
import { ensureFonts } from "../src/util/fs.js";
import { tempDir } from "./fakes.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapLimit", () => {
  it("keeps order and limits how many run at once", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await sleep(n * 3);
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
  });

  it("on failure, waits for work already running and starts nothing new", async () => {
    const finished: number[] = [];
    const started: number[] = [];
    const promise = mapLimit([0, 1, 2, 3, 4], 3, async (n) => {
      started.push(n);
      if (n === 0) throw new Error("boom");
      await sleep(30);
      finished.push(n);
    });
    await expect(promise).rejects.toThrow("boom");
    // Items 1 and 2 were already running: they completed before the error surfaced.
    expect(finished.sort()).toEqual([1, 2]);
    expect(started).not.toContain(4);
  });
});

describe("ensureFonts", () => {
  it("copies fonts once and leaves an existing copy alone", async () => {
    const dir = await tempDir();
    const src = path.join(dir, "src");
    const dest = path.join(dir, "dest");
    await fsp.mkdir(src);
    await fsp.writeFile(path.join(src, "Font.ttf"), "font bytes");
    await fsp.writeFile(path.join(src, "OFL.txt"), "licence");
    await ensureFonts(src, dest);
    expect(await fsp.readdir(dest)).toEqual(["Font.ttf"]);
    const first = (await fsp.stat(path.join(dest, "Font.ttf"))).mtimeMs;
    await sleep(20);
    await Promise.all([ensureFonts(src, dest), ensureFonts(src, dest)]);
    expect((await fsp.stat(path.join(dest, "Font.ttf"))).mtimeMs).toBe(first);
  });
});
