## crtify - remaining work

### 1. Initial git commit
All files untracked. Commit current state as v0.1.0.

### 2. Tests
Add `src/index.test.ts` with bun test:
- Verify output is valid webp buffer
- Verify dimensions match input
- Verify each preset produces different color output
- Verify resolution-aware spacing scales correctly
- Snapshot test: process a small test image, compare output hash for regression

### 3. Barrel distortion
Simulate CRT screen curvature. Approach: remap pixels with barrel distortion formula before final output.
```
r_distorted = r * (1 + k1 * r^2 + k2 * r^4)
```
- Add `distortion` option (0-1, default 0.15)
- Apply after all effects composited, before webp encode
- Fill corners with black (they curve inward)
- Use raw pixel buffer remapping, not Sharp (no native support)

### 4. Phosphor subpixel simulation
Real CRTs have RGB phosphor triads visible at close range. Subtle effect.
- Create a repeating 3-pixel-wide pattern: R-G-B columns at very low opacity
- Multiply with the image so each "subpixel" only shows its channel
- Make it optional, off by default (only visible on high-res images)
- Add `phosphorDetail` option (0-1, default 0)

### 5. Integrate into lokaalhost22.nl
In the site repo (`~/dev/lokaalhost22.nl`):
- Add crtify as local dependency: `"crtify": "file:../crtify"`
- In `build.ts`: scan content/ for images, run crtify on each, output to dist/
- In `styles.css`: add `border-radius` to `.content-image`
- Cache processed images (skip if source unchanged)

### 6. npm publish (optional)
- Add LICENSE file (MIT)
- Add README.md with usage examples
- Set `"files": ["src"]` in package.json
- `npm publish`
