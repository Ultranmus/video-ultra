/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * Media sources in a real browser (DECISIONS #200, #201):
 *  - `url` sources: a saved project whose video is a url opens, plays and exports; the file is
 *    downloaded once into storage (streamed in the storage worker) and a reload reads it from
 *    there without the network; a server without range support works too.
 *  - Memory (Chrome, `--memory`): process RSS while a 96 MB url downloads, against holding the
 *    same response as a Blob in the page (what `getMedia` used to do).
 *  - The media banner: a kept file handle that needs the person's OK ("Allow", granted inside the
 *    tap) and a missing file picked again ("Find file"; a wrong kind is refused); axe on the
 *    banner; phone layout in WebKit.
 * Usage: playground running, then
 *   node scripts/media-sources-check.ts [--port 3200] [--browsers chrome,webkit,firefox]
 *     [--memory] [--shots <dir>]
 */
import AxeBuilder from '@axe-core/playwright';
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
/** `--browsers none` runs only `--memory`. */
const names = (arg('browsers') ?? 'chrome,webkit,firefox').split(',').filter((n) => n !== 'none');
const memory = process.argv.includes('--memory');
const shots = arg('shots');
const BASE = `http://localhost:${port}`;
const CLIP = 'avc-720p30.mp4';
const BIG = 'avc-long-360p.mp4';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures++;
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
};
const snap = async (page: Page, name: string) => {
  if (!shots) return;
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${shots}/${name}.png` });
};

async function openEditor(page: Page, query = '') {
  await page.goto(`${BASE}/editor?backend=webgl2&sounds=0&assistant=0${query}`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 60000 });
}

/** Imports CLIP into a fresh saved video; returns its asset id. */
async function importClip(page: Page): Promise<string> {
  await page.evaluate(() => (window as any).vuEditor.newVideo());
  await page
    .locator('.vu-root input[type=file][accept^="video"]')
    .first()
    .setInputFiles([resolve(`test-media/files/${CLIP}`)]);
  await page.waitForFunction(
    () => (window as any).vuEditor.project.tracks[0].items.length === 1,
    null,
    { timeout: 30000 },
  );
  return page.evaluate(() => Object.keys((window as any).vuEditor.project.assets)[0]!);
}

/**
 * Saves a copy of the open video whose clip's asset is `newId` with `source`, then opens it.
 * Resolves the copy's project id.
 */
async function openCopyWith(page: Page, newId: string, source: unknown): Promise<string> {
  return page.evaluate(
    async ([newId, source]) => {
      const c = (window as any).vuEditor;
      const p = structuredClone(c.project);
      const oldId = Object.keys(p.assets)[0]!;
      p.id = `check-${newId}`;
      p.name = `Check ${newId}`;
      p.assets = { [newId]: { ...p.assets[oldId], id: newId, source } };
      for (const t of p.tracks) for (const i of t.items) if (i.assetId === oldId) i.assetId = newId;
      await c.storage.openWriter(p);
      void c.openVideo(p.id);
      return p.id as string;
    },
    [newId, source] as const,
  );
}

const hasMedia = (page: Page, id: string, timeout = 60000) =>
  page
    .waitForFunction((id) => (window as any).vuEditor.media.has(id), id, { timeout })
    .then(() => true)
    .catch(() => false);

async function playAndExport(page: Page, label: string) {
  const t0 = await page.evaluate(() => (window as any).vuEditor.playhead.time as number);
  await page.evaluate(() => (window as any).vuEditor.play());
  await page.waitForTimeout(1500);
  const t1 = await page.evaluate(() => {
    const c = (window as any).vuEditor;
    c.pause();
    return c.playhead.time as number;
  });
  const seconds = (t1 - t0) / 705_600_000;
  check(seconds > 0.8, `${label}: plays (${seconds.toFixed(2)} s in 1.5 s)`);
  const out = await page.evaluate(async () => {
    const c = (window as any).vuEditor;
    try {
      const r = await c.exportVideo(
        { format: 'mp4', height: 720, fps: 30, quality: 'low', range: null },
        () => undefined,
        new AbortController().signal,
      );
      return { ok: true, frames: r.frames as number, size: r.blob.size as number };
    } catch (error) {
      return { ok: false, message: String(error) };
    }
  });
  check(
    out.ok === true && (out.frames ?? 0) > 0,
    `${label}: exports (${out.ok ? `${out.frames} frames, ${((out.size ?? 0) / 1e6).toFixed(1)} MB` : out.message})`,
  );
}

async function urlSources(page: Page, name: string, opfs: boolean) {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (/\/(media|norange)\/avc/.test(r.url())) requests.push(r.url());
  });
  await importClip(page);
  const id = `url${Date.now()}`;
  const projectId = await openCopyWith(page, id, { type: 'url', url: `/media/${CLIP}` });
  check(await hasMedia(page, id), `${name}: a url source opens`);
  const stored = await page.evaluate(async (id) => {
    const b = (window as any).vuEditor.media.get(id) as Blob;
    return { size: b.size, file: b instanceof File, name: b instanceof File ? b.name : '' };
  }, id);
  const expected = readFileSync(resolve(`test-media/files/${CLIP}`)).byteLength;
  check(stored.size === expected, `${name}: all ${expected} bytes arrive`);
  if (opfs) {
    const files = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const media = await (
        await root.getDirectoryHandle('video-ultra')
      ).getDirectoryHandle('media');
      const out: string[] = [];
      for await (const n of (media as any).keys()) out.push(n);
      return out;
    });
    check(
      files.includes(id) && files.includes(`${id}.url`),
      `${name}: downloaded into storage (media/${id} + finished marker)`,
    );
  }
  check(requests.length === 1, `${name}: one request for the file (${requests.length})`);
  await playAndExport(page, `${name} url source`);

  if (opfs) {
    // Reload: the project comes back from autosave and reads the file from storage.
    requests.length = 0;
    await page.waitForTimeout(1200); // autosave
    await openEditor(page);
    await page.evaluate((pid) => (window as any).vuEditor.openVideo(pid), projectId);
    check(await hasMedia(page, id), `${name}: after a reload the url source opens again`);
    check(requests.length === 0, `${name}: …from storage, no download (${requests.length})`);
  }

  // A server without range support (plain 200, no Accept-Ranges).
  const body = readFileSync(resolve(`test-media/files/${CLIP}`));
  await page.route('**/norange/**', (route) =>
    route.fulfill({ status: 200, body, headers: { 'content-type': 'video/mp4' } }),
  );
  const id2 = `nr${Date.now()}`;
  await importClip(page);
  await openCopyWith(page, id2, { type: 'url', url: `/norange/${CLIP}` });
  check(await hasMedia(page, id2), `${name}: a server without range support works`);

  // A url that 404s: the banner offers Find file (no crash, no error toast).
  const id3 = `gone${Date.now()}`;
  await importClip(page);
  await openCopyWith(page, id3, { type: 'url', url: `/media/does-not-exist.mp4` });
  const banner = page.locator('[data-media-banner]');
  await banner.waitFor({ timeout: 20000 }).catch(() => undefined);
  check(
    (await banner.innerText().catch(() => '')).includes('Find file'),
    `${name}: an unreachable url shows the banner with Find file`,
  );
}

async function bannerFlows(page: Page, name: string, handles: boolean) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const banner = page.locator('[data-media-banner]');

  if (handles) {
    // A kept file handle whose permission lapsed. An OPFS file handle stands in for the person's
    // file; its permission is simulated: 'prompt' until requested inside a tap.
    const aid = await importClip(page);
    const hid = `h${Date.now()}`;
    await page.evaluate(
      async ([aid, hid]) => {
        const c = (window as any).vuEditor;
        const root = await navigator.storage.getDirectory();
        const media = await (
          await root.getDirectoryHandle('video-ultra')
        ).getDirectoryHandle('media');
        const handle = await media.getFileHandle(aid);
        await c.storage.putMediaHandle(hid, handle);
        const proto = FileSystemHandle.prototype as any;
        (window as any).__perm = 'prompt';
        (window as any).__asked = 0;
        proto.queryPermission = async () => (window as any).__perm;
        // Granted only inside a real tap: Playwright's evaluate counts as a user gesture too, so
        // a click must have just happened (and the page must still have the tap's activation).
        (window as any).__clickAt = -1e9;
        document.addEventListener('click', () => ((window as any).__clickAt = performance.now()), {
          capture: true,
        });
        proto.requestPermission = async () => {
          (window as any).__asked++;
          const tapped = performance.now() - (window as any).__clickAt < 5000;
          if (tapped && (navigator as any).userActivation?.isActive)
            (window as any).__perm = 'granted';
          return (window as any).__perm;
        };
      },
      [aid, hid] as const,
    );
    await openCopyWith(page, hid, { type: 'handle', key: hid });
    await banner.waitFor({ timeout: 20000 }).catch(() => undefined);
    const text = await banner.innerText().catch(() => '');
    check(text.includes('Allow'), `${name}: a lapsed file handle asks "${text.split('\n')[0]}"`);
    check(
      !(await page.evaluate((id) => (window as any).vuEditor.media.has(id), hid)),
      `${name}: …and isn't opened without the person's OK`,
    );
    const axe = await new AxeBuilder({ page })
      .include('[data-media-banner]')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    check(
      axe.violations.length === 0,
      `${name}: banner passes axe ${axe.violations.map((v) => v.id).join(',')}`,
    );
    await snap(page, `${name}-allow`);
    await banner.getByRole('button', { name: 'Allow' }).click();
    check(await hasMedia(page, hid, 10000), `${name}: Allow (inside the tap) opens the file`);
    check((await banner.count()) === 0, `${name}: …and the banner goes`);
    await page.evaluate(() => {
      const proto = FileSystemHandle.prototype as any;
      delete proto.queryPermission;
      delete proto.requestPermission;
    });
  }

  // A missing file: opfs source with nothing stored.
  await importClip(page);
  const mid = `m${Date.now()}`;
  await openCopyWith(page, mid, { type: 'opfs', key: mid });
  await banner.waitFor({ timeout: 20000 }).catch(() => undefined);
  const missing = await banner.innerText().catch(() => '');
  check(missing.includes('Find file'), `${name}: a missing file shows "${missing.split('\n')[0]}"`);
  await snap(page, `${name}-missing`);
  // The wrong kind of file is refused.
  let chooser = page.waitForEvent('filechooser');
  await banner.getByRole('button', { name: /Find/ }).click();
  await (await chooser).setFiles(resolve('test-media/files/photo.jpg'));
  await page.waitForTimeout(1500);
  check(
    !(await page.evaluate((id) => (window as any).vuEditor.media.has(id), mid)) &&
      (await banner.count()) === 1,
    `${name}: picking a photo for a video is refused (banner stays)`,
  );
  chooser = page.waitForEvent('filechooser');
  await banner.getByRole('button', { name: /Find/ }).click();
  await (await chooser).setFiles(resolve(`test-media/files/${CLIP}`));
  check(await hasMedia(page, mid, 20000), `${name}: Find file re-links the picked file`);
  const after = await page.evaluate((id) => {
    const c = (window as any).vuEditor;
    return { source: c.project.assets[id].source, items: c.project.tracks[0].items.length };
  }, mid);
  check(
    after.source.type === 'opfs' && after.items === 1 && (await banner.count()) === 0,
    `${name}: the asset points at the stored copy, the clip stays, the banner goes`,
  );
  await playAndExport(page, `${name} re-linked`);
  check(errors.length === 0, `${name}: no page errors ${errors.join(' | ')}`);
}

/** Total RSS (MB) of the processes using Chrome profile `profile`. */
function rssMb(profile: string): number {
  const out = execFileSync('ps', ['-ax', '-o', 'rss=,command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let kb = 0;
  for (const line of out.split('\n'))
    if (line.includes(profile)) kb += Number(line.trim().split(/\s+/, 1)[0]) || 0;
  return Math.round(kb / 1024);
}

async function memoryCheck() {
  const size = readFileSync(resolve(`test-media/files/${BIG}`)).byteLength;
  const measure = async (how: 'download' | 'blob', url = `/media/${BIG}`) => {
    const profile = mkdtempSync(join(tmpdir(), 'vu-urlmem-'));
    const context: BrowserContext = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await openEditor(page);
    await page.waitForTimeout(3000);
    const base = rssMb(profile);
    const samples: number[] = [];
    const timer = setInterval(() => samples.push(rssMb(profile)), 200);
    const got = await page.evaluate(
      async ([how, url]) => {
        const c = (window as any).vuEditor;
        if (how === 'blob') {
          (window as any).__held = await (await fetch(url)).blob();
          return (window as any).__held.size as number;
        }
        const asset = {
          ...Object.values(c.project.assets)[0],
          id: `big${Date.now()}`,
          source: { type: 'url', url },
        };
        (window as any).__held = await c.storage.getMedia(asset);
        return ((window as any).__held?.size ?? 0) as number;
      },
      [how, url] as const,
    );
    await page.waitForTimeout(3000);
    clearInterval(timer);
    await context.close();
    return { got, base, peak: Math.max(...samples), end: samples.at(-1)! };
  };
  console.log(`\n===== chrome · memory while a ${(size / 1e6).toFixed(0)} MB url arrives`);
  // An editor to give the empty project an asset to copy from.
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  await openEditor(page);
  await importClip(page);
  await browser.close();
  const blob = await measure('blob');
  const stream = await measure('download');
  console.log(
    `  old (response held as a Blob): +${blob.peak - blob.base} MB peak, +${blob.end - blob.base} MB after`,
  );
  console.log(
    `  new (streamed into storage):   +${stream.peak - stream.base} MB peak, +${stream.end - stream.base} MB after`,
  );
  check(stream.got === size, `download complete (${stream.got} bytes)`);
  const huge = arg('huge'); // e.g. a 400 MB file in apps/playground/public: does memory scale?
  if (huge) {
    const hb = await measure('blob', huge);
    const h = await measure('download', huge);
    console.log(
      `  old, ${(hb.got / 1e6).toFixed(0)} MB (${huge}): +${hb.peak - hb.base} MB peak, +${hb.end - hb.base} MB after`,
    );
    console.log(
      `  new, ${(h.got / 1e6).toFixed(0)} MB (${huge}): +${h.peak - h.base} MB peak, +${h.end - h.base} MB after`,
    );
    // Flat: a much bigger file costs about the same (noise between runs is ±20 MB).
    check(
      h.peak - h.base < stream.peak - stream.base + 40,
      'streaming memory does not grow with the file size',
    );
  }
}

const launch = {
  chrome: () => chromium.launch({ channel: 'chrome' }),
  webkit: () => webkit.launch(),
  firefox: () => firefox.launch(),
};

for (const name of names) {
  const browser: Browser = await launch[name as keyof typeof launch]();
  const phone = name === 'webkit';
  // A context of its own: axe needs one (it opens a page in it).
  const context = await browser.newContext(
    phone ? { viewport: { width: 393, height: 852 } } : { viewport: { width: 1280, height: 800 } },
  );
  const page = await context.newPage();
  await openEditor(page);
  const opfs = await page.evaluate(() => (window as any).vuEditor.storage.kind === 'opfs');
  console.log(`\n===== ${name} · storage ${opfs ? 'OPFS' : 'memory'}${phone ? ' · phone' : ''}`);
  await urlSources(page, name, opfs);
  await openEditor(page);
  await bannerFlows(page, name, name === 'chrome' && opfs);
  await browser.close();
}
if (memory) await memoryCheck();

console.log(failures ? `\n${failures} check(s) failed` : '\nAll media source checks passed');
process.exit(failures ? 1 : 0);
