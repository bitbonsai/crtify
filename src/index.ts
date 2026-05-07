import sharp from "sharp";

export type Preset = "green" | "amber" | "white";

const presets: Record<Preset, { bright: string; dim: string }> = {
  green: { bright: "#33ff33", dim: "#000000" },
  amber: { bright: "#ffb000", dim: "#000000" },
  white: { bright: "#e0e0e0", dim: "#000000" },
};

export interface CrtifyOptions {
  preset?: Preset;
  greenBright?: string;
  greenDim?: string;
  scanlineOpacity?: number;
  scanlineSpacing?: number;
  bloomRadius?: number;
  bloomStrength?: number;
  vignetteStrength?: number;
  noise?: number;
  brightness?: number;
  contrast?: number;
  phosphorDetail?: number;
}

const defaults: Required<Omit<CrtifyOptions, "preset">> = {
  greenBright: "#33ff33",
  greenDim: "#000000",
  scanlineOpacity: 0.3,
  scanlineSpacing: 3,
  bloomRadius: 2,
  bloomStrength: 0.3,
  vignetteStrength: 1,
  noise: 0.09,
  brightness: 0.84,
  contrast: 1.4,
  phosphorDetail: 0,
};

const REFERENCE_HEIGHT = 600;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function createScanlines(
  width: number,
  height: number,
  spacing: number,
  opacity: number,
  color: [number, number, number],
  phaseOffset: number
): Buffer {
  const channels = 4;
  const buf = Buffer.alloc(width * height * channels);
  const rng = seededRandom(42 + Math.round(phaseOffset * 100));
  const period = spacing * 2;

  for (let y = 0; y < height; y++) {
    const wave = (Math.sin((y / period) * Math.PI * 2 + phaseOffset) + 1) / 2;
    const drift = 0.85 + 0.15 * Math.sin(y / (height * 0.25));
    const jitter = 0.9 + rng() * 0.2;
    const alpha = Math.round(opacity * wave * jitter * drift * 255);

    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
      buf[i + 3] = alpha;
    }
  }

  return buf;
}

function createVignette(
  width: number,
  height: number,
  strength: number
): Buffer {
  const channels = 4;
  const buf = Buffer.alloc(width * height * channels);
  const cx = width / 2;
  const cy = height / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - cx) / cx;
      const dy = (y - cy) / cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const v = Math.pow(Math.max(0, dist - 0.3) / 1.1, 2.2) * strength;
      const alpha = Math.round(Math.min(1, v) * 255);

      const i = (y * width + x) * channels;
      buf[i] = 0;
      buf[i + 1] = 0;
      buf[i + 2] = 0;
      buf[i + 3] = alpha;
    }
  }

  return buf;
}

function createNoise(
  width: number,
  height: number,
  amount: number,
  rng: () => number
): Buffer {
  const channels = 4;
  const buf = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const noise = (rng() - 0.5) * 2 * amount * 255;
      const val = Math.round(Math.max(0, Math.min(255, 128 + noise)));
      buf[i] = val;
      buf[i + 1] = val;
      buf[i + 2] = val;
      buf[i + 3] = Math.round(amount * 80);
    }
  }

  return buf;
}

function applyPhosphorSubpixels(
  src: Buffer,
  width: number,
  height: number,
  detail: number
): Buffer {
  const dst = Buffer.from(src);
  const blend = detail;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const col = x % 3;
      // Each pixel keeps its designated channel at full, others dimmed
      const keepR = col === 0 ? 1 : 1 - blend;
      const keepG = col === 1 ? 1 : 1 - blend;
      const keepB = col === 2 ? 1 : 1 - blend;
      dst[i] = Math.round(src[i] * keepR);
      dst[i + 1] = Math.round(src[i + 1] * keepG);
      dst[i + 2] = Math.round(src[i + 2] * keepB);
    }
  }

  return dst;
}

function resolveOptions(opts: CrtifyOptions): Required<Omit<CrtifyOptions, "preset">> {
  const p = opts.preset ? presets[opts.preset] : null;
  return {
    ...defaults,
    ...(p ? { greenBright: p.bright, greenDim: p.dim } : {}),
    ...opts,
  };
}

export async function crtify(
  input: string | Buffer,
  opts: CrtifyOptions = {}
): Promise<Buffer> {
  const o = resolveOptions(opts);
  const [bR, bG, bB] = hexToRgb(o.greenBright);
  const [dR, dG, dB] = hexToRgb(o.greenDim);

  // 1. Single decode: extract alpha + greyscale + brightness/contrast
  const pipeline = sharp(input);
  const { width: w, height: h, channels: inputChannels } = await pipeline.metadata();
  const width = w!;
  const height = h!;
  const hasAlpha = inputChannels === 4;

  let alphaBuf: Buffer | null = null;
  if (hasAlpha) {
    alphaBuf = await sharp(input).extractChannel(3).raw().toBuffer();
  }

  const scaleFactor = height / REFERENCE_HEIGHT;
  const effectiveSpacing = Math.max(1, Math.round(o.scanlineSpacing * scaleFactor));

  const greyBuf = await pipeline
    .greyscale()
    .modulate({ brightness: o.brightness })
    .linear(o.contrast, -(128 * o.contrast - 128))
    .raw()
    .toBuffer();

  // 2. Map luminance to phosphor color via recomb matrix
  // Build a LUT then apply, since recomb can't do gamma
  const lut = new Uint8Array(256 * 3);
  for (let v = 0; v < 256; v++) {
    const lum = Math.pow(v / 255, 1.4);
    lut[v * 3] = Math.round(dR + (bR - dR) * lum);
    lut[v * 3 + 1] = Math.round(dG + (bG - dG) * lum);
    lut[v * 3 + 2] = Math.round(dB + (bB - dB) * lum);
  }

  const rgbBuf = Buffer.alloc(width * height * 3);
  for (let i = 0; i < greyBuf.length; i++) {
    const v = greyBuf[i];
    const j = i * 3;
    rgbBuf[j] = lut[v * 3];
    rgbBuf[j + 1] = lut[v * 3 + 1];
    rgbBuf[j + 2] = lut[v * 3 + 2];
  }

  // 3. Bloom
  const base = await sharp(rgbBuf, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();

  const bloomed = await sharp(base)
    .blur(Math.max(0.3, o.bloomRadius * 2 + 0.5))
    .ensureAlpha()
    .raw()
    .toBuffer();

  for (let i = 3; i < bloomed.length; i += 4) {
    bloomed[i] = Math.round(bloomed[i] * o.bloomStrength);
  }

  // 4. Merge both scanline layers into one buffer
  const color: [number, number, number] = [bR, bG, bB];
  const scan1 = createScanlines(width, height, effectiveSpacing, o.scanlineOpacity, color, 0);
  const scan2 = createScanlines(width, height, effectiveSpacing, o.scanlineOpacity * 0.5, color, 0.7);

  const mergedScan = Buffer.alloc(width * height * 4);
  for (let i = 0; i < mergedScan.length; i += 4) {
    const a1 = scan1[i + 3] / 255;
    const a2 = scan2[i + 3] / 255;
    const a = Math.min(1, a1 + a2 * (1 - a1));
    if (a > 0) {
      mergedScan[i] = Math.round((scan1[i] * a1 + scan2[i] * a2 * (1 - a1)) / a);
      mergedScan[i + 1] = Math.round((scan1[i + 1] * a1 + scan2[i + 1] * a2 * (1 - a1)) / a);
      mergedScan[i + 2] = Math.round((scan1[i + 2] * a1 + scan2[i + 2] * a2 * (1 - a1)) / a);
    }
    mergedScan[i + 3] = Math.round(a * 255);
  }

  const vignetteBuf = createVignette(width, height, o.vignetteStrength);
  const noiseRng = seededRandom(7);
  const noiseBuf = createNoise(width, height, o.noise, noiseRng);

  const raw4 = { width, height, channels: 4 as const };

  const blurredScan = await sharp(mergedScan, { raw: raw4 })
    .blur(0.6)
    .raw()
    .toBuffer();

  // 5. Composite with raw buffers (no PNG round-trips)
  const composited = await sharp(base)
    .composite([
      { input: bloomed, raw: raw4, blend: "screen" as const },
      { input: blurredScan, raw: raw4, blend: "exclusion" as const },
      { input: vignetteBuf, raw: raw4, blend: "over" as const },
      { input: noiseBuf, raw: raw4, blend: "soft-light" as const },
    ]);

  // 6. Post-processing: phosphor subpixels + restore alpha
  let finalBuf = await composited.ensureAlpha().raw().toBuffer();

  if (o.phosphorDetail > 0) {
    finalBuf = applyPhosphorSubpixels(finalBuf, width, height, o.phosphorDetail);
  }

  if (alphaBuf) {
    for (let i = 0; i < width * height; i++) {
      finalBuf[i * 4 + 3] = alphaBuf[i];
    }
  }

  return sharp(finalBuf, { raw: { width, height, channels: 4 } })
    .webp({ quality: 90 })
    .toBuffer();
}

export async function crtifyFile(
  input: string,
  output: string,
  opts: CrtifyOptions = {}
): Promise<void> {
  const result = await crtify(input, opts);
  await sharp(result).toFile(output);
}
