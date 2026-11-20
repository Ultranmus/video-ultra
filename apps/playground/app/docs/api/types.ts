/** What an export is, for grouping on the API pages. */
export type ApiKind = 'component' | 'hook' | 'function' | 'class' | 'constant' | 'type';

/** One export of a package, read from its published type declarations. */
export interface ApiItem {
  name: string;
  kind: ApiKind;
  /** The declaration as TypeScript (2-space indent), doc comments inside it kept. */
  declaration: string;
  /** The export's own doc comment (Markdown-ish: paragraphs, code fences, `code`, **bold**). */
  doc: string;
  /** The doc comment's first sentence, plain text (search results). */
  summary: string;
  /** Re-exported from @video-ultra/core: documented on the core page, linked from here. */
  fromCore?: boolean;
}

/** One package's exports, sorted by name. */
export interface ApiPackage {
  /** e.g. `@video-ultra/react`. */
  name: string;
  /** e.g. `react` (the page's URL segment). */
  slug: string;
  items: ApiItem[];
}

/** One row of the search index shipped to the browser (no declarations, no full docs). */
export interface ApiSearchEntry {
  /** Name. */
  n: string;
  /** Kind. */
  k: ApiKind;
  /** Package slug. */
  p: string;
  /** First sentence. */
  s: string;
}
