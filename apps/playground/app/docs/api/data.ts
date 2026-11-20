import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiItem, ApiKind, ApiPackage } from './types';

/** The packages, in the order the site shows them, with a line on what each is. */
export const PACKAGES: { slug: string; name: string; blurb: string }[] = [
  {
    slug: 'react',
    name: '@video-ultra/react',
    blurb:
      'The editor component, its controller, hooks and theming. Re-exports the core types you need.',
  },
  {
    slug: 'core',
    name: '@video-ultra/core',
    blurb:
      'The engine without React: the project format, every edit as a function, export and devices.',
  },
  {
    slug: 'captions',
    name: '@video-ultra/captions',
    blurb: 'Optional on-device auto-captions: speech to timed words in a worker, nothing uploaded.',
  },
  {
    slug: 'ai',
    name: '@video-ultra/ai',
    blurb:
      'Optional AI helpers: on-device background removal, speech detection and server endpoints.',
  },
];

/** Kinds in page order, with their group titles. */
export const KINDS: [ApiKind, string][] = [
  ['component', 'Components'],
  ['hook', 'Hooks'],
  ['function', 'Functions'],
  ['class', 'Classes'],
  ['constant', 'Constants'],
  ['type', 'Types'],
];

/** Singular kind names (tags on each export). */
export const KIND_LABEL: Record<ApiKind, string> = {
  component: 'component',
  hook: 'hook',
  function: 'function',
  class: 'class',
  constant: 'constant',
  type: 'type',
};

/** The page of one export: its own package, or core for what react re-exports. */
export function itemHref(pkg: string, item: Pick<ApiItem, 'name' | 'fromCore'>): string {
  return `/docs/api/${item.fromCore ? 'core' : pkg}#${item.name}`;
}

let cached: ApiPackage[] | null = null;

/**
 * The API data (`api.json`, made by `pnpm docs:api` from the built packages' types), read at build
 * time on the server. Empty when it hasn't been generated: the pages say how to make it rather
 * than failing the build.
 */
export function loadApi(): ApiPackage[] {
  if (cached) return cached;
  // `next dev` / `next build` run in apps/playground; also allow the repo root.
  const file = [
    join(process.cwd(), 'app/docs/api/api.json'),
    join(process.cwd(), 'apps/playground/app/docs/api/api.json'),
  ].find((f) => existsSync(f));
  if (!file) {
    console.warn('API reference: api.json is missing — run `pnpm docs:api` after building.');
    return [];
  }
  const api = JSON.parse(readFileSync(file, 'utf8')) as ApiPackage[];
  // In dev, re-read every time so a regenerated file shows up without a restart.
  if (process.env.NODE_ENV === 'production') cached = api;
  return api;
}

/** Finds where `{@link Name}` (or `Name.member`) points: this package first, then the others. */
export function resolveLink(api: ApiPackage[], from: string, target: string): string | null {
  const name = target.split(/[.#]/)[0] ?? target;
  const order = [from, 'core', 'react', 'captions', 'ai'];
  for (const slug of order) {
    const item = api.find((p) => p.slug === slug)?.items.find((i) => i.name === name);
    if (item) return itemHref(slug, item);
  }
  return null;
}
