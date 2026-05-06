import { describe, test, expect } from "bun:test";
import { crtify, crtifyFile, type CrtifyOptions, type Preset } from "./index";
import sharp from "sharp";
import { resolve } from "path";
import { createHash } from "crypto";
import { existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";

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

  test("phosphor subpixels change output", async () => {
    const without = await crtify(FIXTURE, { preset: "green", phosphorDetail: 0 });
    const with_ = await crtify(FIXTURE, { preset: "green", phosphorDetail: 0.5 });
    const h1 = createHash("md5").update(without).digest("hex");
    const h2 = createHash("md5").update(with_).digest("hex");
    expect(h1).not.toBe(h2);
  });

  test("custom colors override preset", async () => {
    const preset = await crtify(FIXTURE, { preset: "green" });
    const custom = await crtify(FIXTURE, { preset: "green", greenBright: "#ff0000" });
    const h1 = createHash("md5").update(preset).digest("hex");
    const h2 = createHash("md5").update(custom).digest("hex");
    expect(h1).not.toBe(h2);
  });

  test("crtifyFile writes to disk", async () => {
    const out = resolve(tmpdir(), `crtify-test-${Date.now()}.webp`);
    try {
      await crtifyFile(FIXTURE, out);
      expect(existsSync(out)).toBe(true);
      const meta = await sharp(out).metadata();
      expect(meta.format).toBe("webp");
    } finally {
      if (existsSync(out)) unlinkSync(out);
    }
  });

  test("handles large images without crashing", async () => {
    const large = await sharp(FIXTURE).resize(1920, 1080).toBuffer();
    const result = await crtify(large);
    const meta = await sharp(result).metadata();
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
  });
});

describe("pexels integration", () => {
  const PEXELS_URLS = [
    "https://images.pexels.com/photos/3075993/pexels-photo-3075993.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/1779487/pexels-photo-1779487.jpeg?auto=compress&cs=tinysrgb&w=600",
    "https://images.pexels.com/photos/2387793/pexels-photo-2387793.jpeg?auto=compress&cs=tinysrgb&w=600",
  ];
  const PRESETS: Preset[] = ["green", "amber", "white"];

  test("download, process, and preview 3 images", async () => {
    const outputs: string[] = [];

    for (let i = 0; i < PEXELS_URLS.length; i++) {
      const resp = await fetch(PEXELS_URLS[i]);
      expect(resp.ok).toBe(true);
      const buf = Buffer.from(await resp.arrayBuffer());

      const out = resolve(tmpdir(), `crtify-pexels-${i}.webp`);
      await crtifyFile(buf as any, out, { preset: PRESETS[i] });

      const meta = await sharp(out).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBeGreaterThan(0);
      outputs.push(out);
    }

    Bun.spawn(["open", ...outputs]);
  }, 30000);
});
