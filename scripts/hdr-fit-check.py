"""Fits a device's HDR calibration from a bench "HDR check" file (video-ultra-hdr-check.json).

Usage: python3 scripts/hdr-fit-check.py <check.json> [--key webkit-webgpu]   (macOS; numpy + Pillow)

1. Finds the matching original video in test-media/private (same size in bytes).
2. Makes Apple's HDR → SDR reference frames at the same timestamps (avconvert + ffmpeg).
3. For each GPU path in the check, fits curve + matrix (leave-one-out over the 6 frames) and
   reports error before → after. With --key, writes calibration-<key>.json for hdr-analyze.py.
"""
import base64, json, os, subprocess, sys
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PRIVATE = os.path.join(ROOT, 'test-media', 'private')
WORK = os.path.join(ROOT, 'test-media', 'files', 'hdr-research')

def fit(pairs):
    X = np.concatenate([o.reshape(-1, 3) for o, _ in pairs])
    Y = np.concatenate([r.reshape(-1, 3) for _, r in pairs])
    ok = (X.max(axis=1) < 0.995) & (Y.max(axis=1) < 0.995)
    X, Y = X[ok], Y[ok]
    M = np.eye(3)
    lut = np.tile(np.linspace(0, 1, 256)[:, None], (1, 3))
    idx = np.clip((X * 255).round().astype(int), 0, 255)
    for _ in range(6):
        target = Y @ np.linalg.inv(M).T
        for c in range(3):
            sums = np.bincount(idx[:, c], weights=target[:, c], minlength=256)
            counts = np.bincount(idx[:, c], minlength=256)
            known = counts > 5
            xs, ys = np.flatnonzero(known), sums[known] / counts[known]
            if xs[0] > 0:
                xs, ys = np.concatenate([[0], xs]), np.concatenate([[0.0], ys])
            vals = np.interp(np.arange(256), xs, ys)
            vals[0] = 0.0
            lut[:, c] = np.maximum.accumulate(np.clip(vals, 0, 1))
        C = np.stack([lut[idx[:, c], c] for c in range(3)], axis=1)
        M = np.linalg.lstsq(C, Y, rcond=None)[0].T
    return lut, M

def apply(img, lut, M):
    idx = np.clip((img * 255).round().astype(int), 0, 255)
    C = np.stack([lut[idx[..., c], c] for c in range(3)], axis=-1)
    return np.clip(C @ M.T, 0, 1)

def main():
    path = sys.argv[1]
    key = sys.argv[sys.argv.index('--key') + 1] if '--key' in sys.argv else None
    check = json.load(open(path))
    size = check['file']['sizeBytes']
    files = [f for f in os.listdir(PRIVATE) if not f.startswith('.')]
    match = next((f for f in files if os.path.getsize(os.path.join(PRIVATE, f)) == size), None)
    if not match:
        # The phone may have re-saved the video when it was picked: match by duration instead.
        def duration(f):
            out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', os.path.join(PRIVATE, f)], capture_output=True, text=True).stdout
            return float(out.strip() or 0)
        want = check['file']['durationS']
        best = min(files, key=lambda f: abs(duration(f) - want), default=None)
        if best is None or abs(duration(best) - want) > 0.1:
            sys.exit(f'No original video matches {check["file"]["name"]} — copy it into test-media/private.')
        match = best
        print('(matched by duration — the phone re-saved the file; check the codec/HDR in the report)')
    print(f'{check["engine"]} · {check["userAgent"][:90]}…\nvideo: {check["file"]["name"]} = {match}')
    os.makedirs(WORK, exist_ok=True)
    sdr = os.path.join(WORK, f'{match}.apple-sdr.mp4')
    if not os.path.exists(sdr):
        subprocess.run(['avconvert', '--source', os.path.join(PRIVATE, match), '--preset', 'Preset1920x1080', '--output', sdr, '--replace'], check=True, capture_output=True)

    for name, p in check['paths'].items():
        if 'error' in p:
            print(f'  {name}: not available ({p["error"][:60]})')
            continue
        w, h = p['width'], p['height']
        pairs = []
        for frame in p['frames']:
            # Both sides are box-filtered to ¼ size: the GPU's single-tap downscale aliases fine
            # detail (moiré), which would otherwise dominate the comparison.
            small = (max(1, w // 4), max(1, h // 4))
            raw = np.frombuffer(base64.b64decode(frame['rgb']), dtype=np.uint8).reshape(h, w, 3)
            ours = np.asarray(Image.fromarray(raw).resize(small, Image.BOX), dtype=np.float64) / 255.0
            ref_png = os.path.join(WORK, f'checkref-{match}@{frame["t"]}-{w}.png')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(frame['t']), '-i', sdr, '-frames:v', '1', '-vf', f'scale={w}:{h}', ref_png], check=True)
            ref = np.asarray(Image.open(ref_png).convert('RGB').resize(small, Image.BOX), dtype=np.float64) / 255.0
            pairs.append((ours, ref))
        # 1. Does the shipped calibration already work on this device?
        shipped = {('chromium', 'webgpu'): 'chrome-webgpu-external', ('chromium', 'webgl2'): 'chrome-webgl2-worker',
                   ('webkit', 'webgpu'): 'webkit-webgl2-worker', ('webkit', 'webgl2'): 'webkit-webgl2-worker'}.get((check['engine'], name), 'chrome-webgl2-worker')
        cal_path = os.path.join(WORK, f'calibration-{shipped}.json')
        if os.path.exists(cal_path):
            cal = json.load(open(cal_path))
            lut0, M0 = np.array(cal['lut']).T, np.array(cal['matrix'])
            err = np.mean([np.abs(apply(o, lut0, M0) - r).mean() * 255 for o, r in pairs])
            print(f'  {name}: with the shipped calibration ({shipped}): error {err:.1f} / 255')
        # 2. A calibration fitted from this check alone.
        before, after = [], []
        for i in range(len(pairs)):  # leave-one-out
            lut, M = fit([q for j, q in enumerate(pairs) if j != i])
            o, r = pairs[i]
            before.append(np.abs(o - r).mean() * 255)
            after.append(np.abs(apply(o, lut, M) - r).mean() * 255)
        print(f'  {name}: error vs Apple {np.mean(before):.1f} → {np.mean(after):.1f} / 255 (leave-one-out, {len(pairs)} frames)')
        if key:
            lut, M = fit(pairs)
            out = os.path.join(WORK, f'calibration-{key}-{name}.json')
            json.dump({'lut': np.round(lut, 5).T.tolist(), 'matrix': np.round(M, 5).tolist(), 'heldOutMAE': [round(float(np.mean(before)), 2), round(float(np.mean(after)), 2)]}, open(out, 'w'))
            print(f'    wrote {out}')

main()
