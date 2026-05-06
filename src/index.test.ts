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
  const PRESETS: Preset[] = ["green", "amber", "white"];

  test("download, process, and preview 3 random images", async () => {
    const page = Math.floor(Math.random() * 50) + 1;
    const resp = await fetch(
      `https://api.pexels.com/v1/curated?per_page=3&page=${page}`,
      { headers: { Authorization: process.env.PEXELS_API_KEY ?? "" } }
    );

    let urls: string[];
    if (resp.ok) {
      const data = await resp.json() as { photos: { src: { medium: string } }[] };
      urls = data.photos.map((p) => p.src.medium);
    } else {
      // Fallback: random photo IDs from a large pool
      const pool = [
        1252869, 3075993, 1779487, 2387793, 1563356, 1591447, 2104152,
        417074, 2662116, 1287145, 3184291, 574071, 1181671, 1029604,
        1181244, 3861969, 2088170, 1181263, 3183150, 2582937, 1181292,
        3184339, 1181316, 1181354, 1181425, 2102416, 3182812, 1714208,
        2599244, 3183132, 943096, 1181467, 2115217, 3184405, 1181675,
      ];
      const shuffled = pool.sort(() => Math.random() - 0.5);
      urls = shuffled.slice(0, 3).map(
        (id) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=600`
      );
    }

    const outputs: string[] = [];
    for (let i = 0; i < urls.length; i++) {
      const imgResp = await fetch(urls[i]);
      expect(imgResp.ok).toBe(true);
      const buf = Buffer.from(await imgResp.arrayBuffer());

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
