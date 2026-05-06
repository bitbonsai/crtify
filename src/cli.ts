#!/usr/bin/env node

import { crtifyFile, type CrtifyOptions, type Preset } from "./index.js";
import { watch } from "fs";
import { resolve, basename, extname, join } from "path";
import { Glob } from "bun";

function usage(): never {
  console.log(`crtify - Convert images to CRT phosphor terminal aesthetic

Usage: crtify <input...> [options]

Options:
  --outdir <dir>       Output directory for batch mode
  --preset <name>      Phosphor preset: green (default), amber, white
  --scanlines <0-1>    Scanline opacity (default: 0.4)
  --spacing <n>        Scanline spacing in px, scales with resolution (default: 3)
  --bloom <0-1>        Bloom/glow strength (default: 0.3)
  --vignette <0-1>     Vignette strength (default: 1)
  --noise <0-1>        Noise amount (default: 0.08)
  --brightness <n>     Brightness multiplier (default: 0.85)
  --contrast <n>       Contrast multiplier (default: 1.3)
  --distortion <0-1>   Barrel distortion strength (default: 0.15, 0 to disable)
  --green <hex>        Primary phosphor color (default: #33ff33)
  --watch              Re-process on file change
  -h, --help           Show this help`);
  process.exit(0);
}

interface ParsedArgs {
  inputs: string[];
  outdir: string;
  watchMode: boolean;
  opts: CrtifyOptions;
}

function parseArgs(args: string[]): ParsedArgs {
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    usage();
  }

  const inputs: string[] = [];
  const opts: CrtifyOptions = {};
  let outdir = "";
  let watchMode = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    switch (arg) {
      case "--outdir":
        outdir = args[++i];
        break;
      case "--preset":
        opts.preset = args[++i] as Preset;
        break;
      case "--scanlines":
        opts.scanlineOpacity = parseFloat(args[++i]);
        break;
      case "--spacing":
        opts.scanlineSpacing = parseInt(args[++i]);
        break;
      case "--bloom":
        opts.bloomStrength = parseFloat(args[++i]);
        break;
      case "--vignette":
        opts.vignetteStrength = parseFloat(args[++i]);
        break;
      case "--noise":
        opts.noise = parseFloat(args[++i]);
        break;
      case "--brightness":
        opts.brightness = parseFloat(args[++i]);
        break;
      case "--contrast":
        opts.contrast = parseFloat(args[++i]);
        break;
      case "--distortion":
        opts.distortion = parseFloat(args[++i]);
        break;
      case "--green":
        opts.greenBright = args[++i];
        break;
      case "--watch":
        watchMode = true;
        break;
      default:
        if (!arg.startsWith("-")) {
          inputs.push(arg);
        }
        break;
    }
    i++;
  }

  return { inputs, outdir, watchMode, opts };
}

function outputPath(input: string, outdir: string): string {
  const name = basename(input, extname(input));
  const out = `${name}-crt.webp`;
  return outdir ? join(outdir, out) : join(resolve(input, ".."), out);
}

async function expandGlobs(patterns: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const pattern of patterns) {
    if (pattern.includes("*")) {
      const glob = new Glob(pattern);
      for await (const file of glob.scan()) {
        files.push(file);
      }
    } else {
      files.push(pattern);
    }
  }
  return files;
}

async function processFile(input: string, outdir: string, opts: CrtifyOptions): Promise<void> {
  const out = outputPath(input, outdir);
  const start = performance.now();
  await crtifyFile(input, out, opts);
  const ms = Math.round(performance.now() - start);
  console.log(`  ${input} → ${out} (${ms}ms)`);
}

async function processAll(files: string[], outdir: string, opts: CrtifyOptions): Promise<void> {
  console.log(`crtify: processing ${files.length} file${files.length > 1 ? "s" : ""}...`);
  await Promise.all(files.map((f) => processFile(f, outdir, opts)));
  console.log("done");
}

const { inputs, outdir, watchMode, opts } = parseArgs(process.argv.slice(2));

const files = await expandGlobs(inputs);

if (files.length === 0) {
  console.error("no matching files found");
  process.exit(1);
}

await processAll(files, outdir, opts);

if (watchMode) {
  console.log("watching for changes...");
  const seen = new Set<string>();
  for (const file of files) {
    const abs = resolve(file);
    if (seen.has(abs)) continue;
    seen.add(abs);
    watch(abs, async () => {
      console.log(`changed: ${file}`);
      await processFile(file, outdir, opts).catch((e) =>
        console.error(`error: ${e.message}`)
      );
    });
  }
}
