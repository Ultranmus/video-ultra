"""HDR research (2026-10-17). Compare each GPU import path's HDR rendering with Apple's SDR reference, and fit a correction
(per-channel tone curve + 3x3 colour matrix) from the browser's WebGL2 output to Apple's look.
Train on some shots, test on held-out shots."""
import glob, json, os
import numpy as np
from PIL import Image

D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'test-media', 'files', 'hdr-research')

def load(path):
    return np.asarray(Image.open(path).convert('RGB'), dtype=np.float64) / 255.0

def aligned(ours_path, ref):
    img = Image.open(ours_path).convert('RGB')
    h, w = ref.shape[:2]
    if (h > w) != (img.height > img.width):
        img = img.rotate(-90, expand=True)  # portrait iPhone video: rotate 90° clockwise
    img = img.resize((w, h), Image.BILINEAR)
    return np.asarray(img, dtype=np.float64) / 255.0

def sat(x):
    return (x.max(axis=2) - x.min(axis=2)).mean()

shots = sorted({os.path.basename(p).split('--', 1)[1] for p in glob.glob(os.path.join(D, 'apple--*.png'))})
paths = ['chrome-webgpu-external', 'chrome-webgpu-copyExternal', 'chrome-webgl2', 'webkit-webgl2']

print('Mean absolute error vs Apple (0–255) | brightness (Apple → ours) | saturation (Apple → ours)')
rows = {p: [] for p in paths}
pairs = {}
for shot in shots:
    ref = load(os.path.join(D, f'apple--{shot}'))
    for p in paths:
        f = os.path.join(D, f'{p}--{shot}')
        if not os.path.exists(f):
            continue
        ours = aligned(f, ref)
        pairs[(p, shot)] = (ours, ref)
        rows[p].append((np.abs(ours - ref).mean() * 255, ref.mean() * 255, ours.mean() * 255, sat(ref) * 255, sat(ours) * 255))
for p in paths:
    a = np.array(rows[p])
    print(f'  {p:28s} MAE {a[:,0].mean():5.1f}  bright {a[:,1].mean():5.1f} → {a[:,2].mean():5.1f}  sat {a[:,3].mean():4.1f} → {a[:,4].mean():4.1f}')

# Are Chrome and WebKit WebGL2 the same?
diffs = []
for shot in shots:
    if ('chrome-webgl2', shot) in pairs and ('webkit-webgl2', shot) in pairs:
        diffs.append(np.abs(pairs[('chrome-webgl2', shot)][0] - pairs[('webkit-webgl2', shot)][0]).mean() * 255)
print(f'\nChrome WebGL2 vs WebKit WebGL2: mean abs difference {np.mean(diffs):.2f} / 255')

# Fit: Apple ≈ M · curve(ours), curve = per-channel 256-entry LUT. Alternate fitting both.
def fit(train):
    X = np.concatenate([o.reshape(-1, 3) for o, _ in train])
    Y = np.concatenate([r.reshape(-1, 3) for _, r in train])
    # Ignore near-black/near-white regions where clipping makes pairs unreliable.
    ok = (X.max(axis=1) < 0.995) & (Y.max(axis=1) < 0.995)
    X, Y = X[ok], Y[ok]
    M = np.eye(3)
    lut = np.tile(np.linspace(0, 1, 256)[:, None], (1, 3))
    for _ in range(6):
        # 1. curves: map X channel bins to (M^-1 Y)
        target = Y @ np.linalg.inv(M).T
        idx = np.clip((X * 255).round().astype(int), 0, 255)
        for c in range(3):
            sums = np.bincount(idx[:, c], weights=target[:, c], minlength=256)
            counts = np.bincount(idx[:, c], minlength=256)
            known = counts > 20
            vals = np.interp(np.arange(256), np.flatnonzero(known), sums[known] / counts[known])
            vals = np.maximum.accumulate(np.clip(vals, 0, 1))  # monotone
            lut[:, c] = vals
        # 2. matrix: least squares Y ≈ curve(X) · M^T
        C = np.stack([lut[idx[:, c], c] for c in range(3)], axis=1)
        M = np.linalg.lstsq(C, Y, rcond=None)[0].T
    return lut, M

def apply(img, lut, M):
    idx = np.clip((img * 255).round().astype(int), 0, 255)
    C = np.stack([lut[idx[..., c], c] for c in range(3)], axis=-1)
    return np.clip(C @ M.T, 0, 1)

for source in ['chrome-webgl2', 'chrome-webgpu-copyExternal', 'chrome-webgpu-external']:
    data = [(shot, *pairs[(source, shot)]) for shot in shots if (source, shot) in pairs]
    # Hold out every third shot for testing.
    train = [(o, r) for i, (_, o, r) in enumerate(data) if i % 3 != 1]
    test = [(s, o, r) for i, (s, o, r) in enumerate(data) if i % 3 == 1]
    lut, M = fit(train)
    before = np.mean([np.abs(o - r).mean() * 255 for _, o, r in test])
    after = np.mean([np.abs(apply(o, lut, M) - r).mean() * 255 for _, o, r in test])
    print(f'\nCorrection fitted on {source}: held-out MAE {before:.1f} → {after:.1f}  (test shots: {[s for s, _, _ in test]})')
    # Same correction applied to WebKit (fit on Chrome) — does one correction work for both?
    if source == 'chrome-webgl2':
        wk = [pairs[('webkit-webgl2', s)] for s, _, _ in test if ('webkit-webgl2', s) in pairs]
        wb = np.mean([np.abs(o - r).mean() * 255 for o, r in wk])
        wa = np.mean([np.abs(apply(o, lut, M) - r).mean() * 255 for o, r in wk])
        print(f'  same correction on WebKit WebGL2 (held-out): MAE {wb:.1f} → {wa:.1f}')
        np.save(os.path.join(D, 'lut.npy'), lut)
        np.save(os.path.join(D, 'matrix.npy'), M)
        print('  matrix:', np.round(M, 3).tolist())
        # Visual check on a held-out shot.
        s, o, r = test[0]
        Image.fromarray((np.vstack([r, o, apply(o, lut, M)]) * 255).astype(np.uint8)).save(os.path.join(D, 'check.png'))
        print('  check.png = Apple / browser WebGL2 / corrected, for', s)
