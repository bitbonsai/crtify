import { describe, test, expect } from "bun:test";
import { crtify, type CrtifyOptions, type Preset } from "./index";
import sharp from "sharp";
import { resolve } from "path";
import { createHash } from "crypto";

const FIXTURE = resolve(import.meta.dir, "../test/fixture.jpg");

async function bufferMeta(buf: Buffer) {
  return sharp(buf).metadata();
}

describe("crtify", () => {
  test("returns valid webp buffer", async () => {
    const result = await crtify(FIXTURE);
    const meta = await bufferMeta(result);
    expect(meta.format).toBe("webp");
  });

  test("output dimensions match input", async () => {
    const inputMeta = await sharp(FIXTURE).metadata();
    const result = await crtify(FIXTURE);
    const outputMeta = await bufferMeta(result);
    expect(outputMeta.width).toBe(inputMeta.width);
    expect(outputMeta.height).toBe(inputMeta.height);
  });

  test("each preset produces different output", async () => {
    const presets: Preset[] = ["green", "amber", "white"];
    const hashes = new Set<string>();

    for (const preset of presets) {
      const result = await crtify(FIXTURE, { preset });
      const hash = createHash("md5").update(result).digest("hex");
      hashes.add(hash);
    }

    expect(hashes.size).toBe(3);
  });

  test("resolution-aware spacing scales with height", async () => {
    const small = await sharp(FIXTURE).resize(100, 75).toBuffer();
    const large = await sharp(FIXTURE).resize(400, 300).toBuffer();

    const smallResult = await crtify(small, { scanlineSpacing: 3 });
    const largeResult = await crtify(large, { scanlineSpacing: 3 });

    const smallMeta = await bufferMeta(smallResult);
    const largeMeta = await bufferMeta(largeResult);

    expect(smallMeta.width).toBe(100);
    expect(largeMeta.width).toBe(400);
  });

  test("accepts Buffer input", async () => {
    const buf = await Bun.file(FIXTURE).arrayBuffer();
    const result = await crtify(Buffer.from(buf));
    const meta = await bufferMeta(result);
    expect(meta.format).toBe("webp");
  });

  test("snapshot regression", async () => {
    const result = await crtify(FIXTURE, { preset: "green" });
    const hash = createHash("sha256").update(result).digest("hex");
    expect(hash).toMatchSnapshot("green-preset-fixture");
  });
});
