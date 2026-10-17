# HDR research — 2026-10-17

**Question:** iPhone videos are HDR (HEVC Main 10, HLG + Dolby Vision 8.4). They looked washed out
in our Chrome export. How do we make HDR look right, fast, in every browser?

**Method:** `/lab/hdr` in the playground decodes a frame and renders the whole frame through each
GPU import path; `scripts/hdr-capture.ts` captures 8 frames from 4 of the owner's iPhone videos
in Chrome 155 and WebKit (macOS), plus Apple's own HDR → SDR rendering of the same frames
(`avconvert`, i.e. AVFoundation — what Photos shows). `scripts/hdr-analyze.py` compares them.

## Findings

1. **Hardware-decoded frames are opaque** (`VideoFrame.format === null`) in Chrome and WebKit:
   `copyTo()` is refused, so we can't read the raw 10-bit HLG values. A "do our own tone mapping
   from raw data" path is impossible for hardware decoding (software decoding would allow it, but
   is far too slow for 4K60 on phones).
2. **Every browser path already converts HDR → SDR itself,** each differently:

   | Path                                              | Error vs Apple (MAE /255) | Brightness (Apple 123) | Saturation (Apple 38.8) |
   | ------------------------------------------------- | ------------------------- | ---------------------- | ----------------------- |
   | Chrome WebGPU `importExternalTexture` (zero-copy) | 73.8                      | 196                    | 25.7                    |
   | Chrome WebGPU `copyExternalImageToTexture`        | 73.8                      | 196                    | 25.6                    |
   | Chrome WebGL2 `texImage2D`                        | 30.5                      | 151                    | 26.3                    |
   | WebKit WebGL2 `texImage2D`                        | 31.1                      | 152                    | 26.3                    |

   Values never exceed 1.0 (no extended range to tone-map from).

3. **Chrome WebGL2 and WebKit WebGL2 are the same** (0.76 / 255 apart).
4. **A fitted correction fixes it on every path:** per-channel tone curve (256-entry LUT) + 3×3
   colour matrix, fitted on 5 frames, tested on 3 unseen frames:
   - WebGL2: MAE 30.3 → **11.3**; the same correction on WebKit: 31.0 → **11.3**
   - WebGPU zero-copy: MAE 72.2 → **11.4** (separate fit) — so we keep zero-copy.

   Visually the corrected frame matches Apple's warm, natural look (checked by eye; the
   comparison image isn't committed because it shows the owner's private footage).
   Fitted numbers: `hdr-calibration-2026-10-17.json` (WebGL2 path).

## Decision (DECISIONS #33)

HDR (HLG/PQ) frames are corrected in the compositor shader with a per-path calibration (LUT +
matrix) that maps the browser's own HDR → SDR conversion to our target look (Apple-like). Zero-copy
WebGPU stays. Because the browser's conversion may differ by OS/GPU (Windows, Android), the editor
**self-calibrates at startup** (Day 3): it builds a small synthetic HLG test frame with known
values, runs it through the active import path, measures the result and derives the correction
for that device — the shipped Mac calibration is the fallback.

## Open

- Verify on the owner's iPhone (Safari iOS) and an Android phone.
- PQ (HDR10) sources: same approach, needs a PQ test file.
- Dolby Vision 8.4 is HLG-compatible; the base layer is what we decode — fine.
- Residual error (~11 / 255) may partly be our reference pipeline (avconvert re-encode); check
  against a still exported from Photos.
