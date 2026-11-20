/**
 * Builds the API reference data (`apps/playground/app/docs/api/api.json`) from the published type
 * declarations (`packages/{react,core,captions,ai}/dist/index.d.ts`) — what users actually get, so
 * it can't drift from the packages. Each export: its kind, its TypeScript declaration (doc comments
 * inside it kept) and its own doc comment.
 *
 * The JSON is generated, not committed: run this after the packages build (`pnpm docs:api`; the
 * root `playground` script and the Vercel build run it). The site reads it at build time.
 * Usage: node scripts/api-reference.ts
 */
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import type { ApiItem, ApiKind, ApiPackage } from '../apps/playground/app/docs/api/types.ts';

const root = join(import.meta.dirname, '..');
const out = join(root, 'apps/playground/app/docs/api/api.json');

/** Package name → its folder under packages/ (also the page slug). */
const PACKAGES = {
  '@video-ultra/react': 'react',
  '@video-ultra/core': 'core',
  '@video-ultra/captions': 'captions',
  '@video-ultra/ai': 'ai',
} as const;

const entries = Object.entries(PACKAGES).map(([name, slug]) => ({
  name,
  slug,
  file: join(root, 'packages', slug, 'dist', 'index.d.ts'),
}));

const missing = entries.filter((e) => !existsSync(e.file));
if (missing.length > 0) {
  console.error(
    `API reference: no built types for ${missing.map((m) => m.name).join(', ')}.\n` +
      `Build the packages first: pnpm turbo run build --filter='./packages/*'`,
  );
  process.exit(1);
}

const program = ts.createProgram(
  entries.map((e) => e.file),
  {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    skipLibCheck: true,
    noEmit: true,
  },
);
const checker = program.getTypeChecker();
const coreDist = realpathSync(join(root, 'packages/core/dist'));

function kindOf(name: string, decl: ts.Declaration): ApiKind {
  if (
    ts.isInterfaceDeclaration(decl) ||
    ts.isTypeAliasDeclaration(decl) ||
    ts.isEnumDeclaration(decl)
  ) {
    return 'type';
  }
  if (ts.isClassDeclaration(decl)) return 'class';
  if (/^use[A-Z]/.test(name)) return 'hook';
  if (ts.isFunctionDeclaration(decl)) return /^[A-Z]/.test(name) ? 'component' : 'function';
  if (ts.isVariableDeclaration(decl)) {
    const type = checker.getTypeAtLocation(decl);
    const callable = type.getCallSignatures().length > 0;
    if (callable && /^[A-Z][a-z]/.test(name)) return 'component'; // PascalCase callables
    return callable ? 'function' : 'constant';
  }
  return 'constant';
}

/** d.ts files indent with 4 spaces; the docs use 2. */
const tidy = (code: string) =>
  code.replace(/^((?: {4})+)/gm, (s) => ' '.repeat(s.length / 2)).trimEnd();

/** Constants whose inferred type is longer than this are shortened (schemas, label tables). */
const LONG_CONSTANT = 40;

/**
 * A constant with a huge inferred type (a Zod schema, the label table): its type's head only —
 * `ZodMiniObject<…>` — or an object type's first lines. The full type is in the user's editor.
 */
function shortConstant(decl: ts.VariableDeclaration, text: string): string {
  const lines = text.split('\n');
  if (lines.length <= LONG_CONSTANT) return text;
  const keyword = text.startsWith('let') ? 'let' : 'const';
  const type = decl.type;
  if (type && ts.isTypeReferenceNode(type) && type.typeArguments?.length) {
    return `${keyword} ${decl.name.getText()}: ${type.typeName.getText()}<…>;`;
  }
  const head = lines.slice(0, 16);
  return [...head, `  // … ${lines.length - head.length - 1} more lines`, '};'].join('\n');
}

/** Source text of a declaration: the whole statement for variables, without its leading doc. */
function declarationText(decl: ts.Declaration): string {
  const node = ts.isVariableDeclaration(decl) ? decl.parent.parent : decl;
  const source = node.getSourceFile();
  const raw = source.text.slice(node.getStart(source), node.getEnd());
  const text = tidy(raw.replace(/^(export\s+)?declare\s+/, '').replace(/^export\s+/, ''));
  return ts.isVariableDeclaration(decl) ? shortConstant(decl, text) : text;
}

function docOf(symbol: ts.Symbol): string {
  const summary = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
  const tags = symbol
    .getJsDocTags(checker)
    .filter((tag) => ['deprecated', 'example', 'returns', 'remarks', 'see'].includes(tag.name))
    .map((tag) => {
      const text = ts.displayPartsToString(tag.text ?? []).trim();
      // An example is code unless it already has its own fences.
      if (tag.name === 'example' && text && !text.includes('```')) {
        return `**Example**\n\n\`\`\`tsx\n${text}\n\`\`\``;
      }
      const title =
        tag.name === 'returns' ? 'Returns' : tag.name[0]!.toUpperCase() + tag.name.slice(1);
      return `**${title}** ${text}`.trim();
    });
  return [summary, ...tags].filter(Boolean).join('\n\n');
}

/** The first sentence of a doc comment as plain text (search results, package cards). */
function summaryOf(doc: string): string {
  const firstPara = doc.split(/\n{2,}/)[0] ?? '';
  if (firstPara.startsWith('```') || firstPara.startsWith('**')) return '';
  const plain = firstPara
    .replace(
      /\{@link(?:code|plain)?\s+([^}|\s]+)(?:[\s|]+([^}]*))?\}/g,
      (_, n: string, l?: string) => (l?.trim() ? l.trim() : n),
    )
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = /^(.+?[.!?])(\s|$)/.exec(plain)?.[1] ?? plain;
  return sentence.length > 140 ? `${sentence.slice(0, 137).trimEnd()}…` : sentence;
}

function collect(name: string, slug: string, file: string): ApiPackage {
  const source = program.getSourceFile(file);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`No types for ${name} at ${file} — build the packages first.`);
  const items: ApiItem[] = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const decls = symbol.getDeclarations() ?? [];
    const first = decls[0];
    if (!first) continue;
    const doc = docOf(symbol);
    // Overloads and merged declarations (e.g. a type and a value) are shown together.
    const item: ApiItem = {
      name: exported.name,
      kind: kindOf(exported.name, first),
      declaration: decls.map(declarationText).join('\n'),
      doc,
      summary: summaryOf(doc),
    };
    if (slug !== 'core' && realpathSync(first.getSourceFile().fileName).startsWith(coreDist)) {
      item.fromCore = true;
    }
    items.push(item);
  }
  items.sort((a, b) => a.name.localeCompare(b.name));
  return { name, slug, items };
}

const api: ApiPackage[] = entries.map((e) => collect(e.name, e.slug, e.file));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(api)}\n`);
console.log(`API reference: ${api.map((p) => `${p.name} ${p.items.length}`).join(' · ')} → ${out}`);
