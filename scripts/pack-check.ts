/**
 * Release check (PLAN 5.2): every publishable package packed exactly as npm will get it, then
 * - publint (package.json, exports, files) and attw (types resolve in every module mode);
 * - size budgets (gzip) per entry, so the editor stays small;
 * - a fresh project outside the workspace installs the tarballs from the registry and
 *   type-checks a typical React app against them;
 * - in plain Node (no browser): every package imports, and the editor renders on the server
 *   (SSR-safe: no window / document at import or render time).
 * Usage: pnpm build first, then node scripts/pack-check.ts [--keep]
 */
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve('.');
const PACKAGES = ['core', 'react', 'captions', 'ai'] as const;
/** Gzipped size budgets per published file pattern (KB): grow them on purpose, never by drift. */
const BUDGETS: { pkg: string; file: RegExp; kb: number }[] = [
  { pkg: 'core', file: /^index\.js$/, kb: 40 },
  { pkg: 'core', file: /^engine\.worker\.js$/, kb: 220 },
  { pkg: 'react', file: /^index\.js$/, kb: 200 },
  { pkg: 'react', file: /^styles\.css$/, kb: 30 },
  { pkg: 'captions', file: /^index\.js$/, kb: 40 },
  { pkg: 'ai', file: /^index\.js$/, kb: 40 },
];

let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};
const run = (cmd: string, args: string[], cwd = root) =>
  execFileSync(cmd, args, { cwd, stdio: 'pipe', maxBuffer: 1 << 28 }).toString();

const work = mkdtempSync(join(tmpdir(), 'vu-pack-'));
const tarballs = new Map<string, string>();

// ── pack ──────────────────────────────────────────────────────────────────
for (const p of PACKAGES) {
  const dir = join(root, 'packages', p);
  const out = run('pnpm', ['pack', '--pack-destination', work], dir).trim().split('\n').at(-1)!;
  const file = out.startsWith('/') ? out : join(work, out.split('/').at(-1)!);
  tarballs.set(p, file);
  const listing = run('tar', ['-tzf', file]);
  check(
    `${p}: packed with README, LICENSE and dist`,
    /package\/README\.md/.test(listing) &&
      /package\/LICENSE/.test(listing) &&
      /package\/dist\//.test(listing),
  );
  check(
    `${p}: no workspace: ranges left`,
    !run('tar', ['-xzOf', file, 'package/package.json']).includes('workspace:'),
  );
  try {
    run('npx', ['publint', file]);
    check(`${p}: publint`, true);
  } catch (e) {
    check(`${p}: publint`, false, String((e as { stdout?: Buffer }).stdout ?? e).slice(0, 300));
  }
  try {
    run('npx', ['attw', '--pack', dir, '--profile', 'esm-only', '--format', 'ascii']);
    check(`${p}: types resolve (attw, ESM)`, true);
  } catch (e) {
    check(
      `${p}: types resolve (attw, ESM)`,
      false,
      String((e as { stdout?: Buffer }).stdout ?? e).slice(0, 400),
    );
  }
  // Size budgets.
  const dist = join(dir, 'dist');
  for (const budget of BUDGETS.filter((b) => b.pkg === p)) {
    for (const name of readdirSync(dist).filter((f) => budget.file.test(f))) {
      const kb = gzipSync(readFileSync(join(dist, name))).length / 1024;
      check(`${p}/${name} ≤ ${budget.kb} KB gzipped`, kb <= budget.kb, `${kb.toFixed(1)} KB`);
    }
  }
}

// ── a fresh app installs the tarballs ─────────────────────────────────────
const app = join(work, 'app');
mkdirSync(app);
writeFileSync(
  join(app, 'package.json'),
  JSON.stringify({ name: 'fresh-app', private: true, type: 'module' }, null, 2),
);
const reactVersion = JSON.parse(readFileSync(join(root, 'packages/react/package.json'), 'utf8'))
  .devDependencies.react as string;
run(
  'npm',
  [
    'install',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
    ...PACKAGES.map((p) => tarballs.get(p)!),
    `react@${reactVersion}`,
    `react-dom@${reactVersion}`,
    'typescript@6.0.3',
    '@types/react@^19',
    '@types/react-dom@^19',
  ],
  app,
);
check(
  'fresh install from the tarballs',
  statSync(join(app, 'node_modules/@video-ultra/react/dist/index.js')).isFile(),
);

writeFileSync(
  join(app, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'es2022',
        module: 'esnext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        // What Next.js and Vite projects start with (a dependency's own .d.ts files aren't checked).
        skipLibCheck: true,
        lib: ['es2022', 'dom', 'dom.iterable'],
        types: [],
      },
      include: ['app.tsx'],
    },
    null,
    2,
  ),
);
writeFileSync(
  join(app, 'app.tsx'),
  `import { VideoEditor, type EditorController, type Project } from '@video-ultra/react';
import '@video-ultra/react/styles.css';
import { createProject, projectDuration, VERSION } from '@video-ultra/core';
import { createOnDeviceTranscriber } from '@video-ultra/captions';
import { createBackgroundRemover } from '@video-ultra/ai';

export function App() {
  const transcriber = createOnDeviceTranscriber();
  const backgroundRemover = createBackgroundRemover();
  const save = (project: Project) => localStorage.setItem('video', JSON.stringify(project));
  const ready = (ctl: EditorController) => console.log(VERSION, projectDuration(ctl.project));
  return (
    <VideoEditor
      initialProject={createProject({ name: 'Hello' })}
      onSave={save}
      onReady={ready}
      onExport={({ blob, durationSeconds }) => console.log(blob.size, durationSeconds)}
      transcriber={transcriber}
      backgroundRemover={backgroundRemover}
      theme="auto"
    />
  );
}
`,
);
try {
  run(join(app, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.json'], app);
  check('a typical app type-checks against the published types', true);
} catch (e) {
  check(
    'a typical app type-checks against the published types',
    false,
    String((e as { stdout?: Buffer }).stdout ?? e).slice(0, 600),
  );
}

// ── Node: imports and server rendering ────────────────────────────────────
writeFileSync(
  join(app, 'ssr.mjs'),
  `import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
const core = await import('@video-ultra/core');
await import('@video-ultra/captions');
await import('@video-ultra/ai');
const { VideoEditor } = await import('@video-ultra/react');
const html = renderToString(createElement(VideoEditor, { initialProject: core.createProject() }));
console.log(JSON.stringify({ version: core.VERSION, html: html.length }));
`,
);
try {
  const out = JSON.parse(run('node', ['ssr.mjs'], app).trim().split('\n').at(-1)!) as {
    version: string;
    html: number;
  };
  check(
    'every package imports in Node; the editor renders on the server',
    out.html > 0,
    `${out.html} chars of HTML, core ${out.version}`,
  );
} catch (e) {
  check(
    'every package imports in Node; the editor renders on the server',
    false,
    String((e as { stderr?: Buffer }).stderr ?? e).slice(0, 600),
  );
}

if (!process.argv.includes('--keep')) rmSync(work, { recursive: true, force: true });
else console.log(`kept: ${work}`);
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
