<p align="center">
  <img src="logo.png" alt="crtify" width="400" />
</p>

<p align="center">
  Convert any image into a CRT phosphor terminal aesthetic.
</p>

---

## Install

```bash
bun i -g crtify
```

## CLI

```bash
# Single file
crtify photo.jpg

# Batch with glob
crtify "images/*.png" --outdir output/

# Pick a phosphor preset
crtify photo.jpg --preset amber

# Watch mode
crtify photo.jpg --watch
```

Output files are saved as `<name>-crt.webp` alongside the original (or in `--outdir`).

### Options

```
--preset <name>      Phosphor preset: green (default), amber, white
--scanlines <0-1>    Scanline opacity (default: 0.4)
--spacing <n>        Scanline spacing in px, scales with resolution (default: 3)
--bloom <0-1>        Bloom/glow strength (default: 0.3)
--vignette <0-1>     Vignette strength (default: 1)
--noise <0-1>        Noise amount (default: 0.08)
--brightness <n>     Brightness multiplier (default: 0.85)
--contrast <n>       Contrast multiplier (default: 1.3)
--phosphor <0-1>     Phosphor subpixel detail (default: 0, off)
--green <hex>        Primary phosphor color (default: #33ff33)
--outdir <dir>       Output directory for batch mode
--watch              Re-process on file change
```

## API

```typescript
import { crtify, crtifyFile } from "crtify";

// Buffer in, Buffer out
const webpBuffer = await crtify("photo.jpg", {
  preset: "green",
});

// File to file
await crtifyFile("photo.jpg", "output.webp", {
  preset: "amber",
  scanlineOpacity: 0.5,
  phosphorDetail: 0.2,
});
```

### Presets

| Preset | Color |
|--------|-------|
| `green` | Classic green phosphor (#33ff33) |
| `amber` | Warm amber terminal (#ffb000) |
| `white` | Monochrome white (#e0e0e0) |

## How it works

1. Convert to greyscale, apply brightness/contrast
2. Map luminance through a gamma-corrected phosphor color LUT
3. Add bloom (blurred screen layer, screen-blended)
4. Overlay dual scanline layers with drift and jitter (exclusion blend)
5. Apply vignette darkening toward edges
6. Add film grain noise (soft-light blend)
7. Optionally apply RGB phosphor subpixel triads

Scanline spacing scales automatically with image resolution so the effect looks consistent across sizes.

## Requirements

- [Bun](https://bun.sh) runtime
- [Sharp](https://sharp.pixelplumbing.com) (installed automatically)

## License

MIT
