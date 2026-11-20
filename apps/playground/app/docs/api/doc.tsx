import { Fragment, type ReactNode } from 'react';
import { highlight } from '../../code';

/** Turns a `{@link Name}` target into a URL (or null when it isn't one of our exports). */
export type LinkResolver = (target: string) => string | null;

/**
 * Renders a doc comment: paragraphs, `- ` lists, ```code blocks```, `inline code`, **bold** and
 * `{@link Name}` (a link to that export when it's known). Doc comments are our own, from the
 * packages' types, read at build time.
 */
export async function Doc({ text, link }: { text: string; link: LinkResolver }) {
  const blocks = text.split(/(```\w*\n[\s\S]*?```)/g).filter((b) => b.trim());
  const rendered = await Promise.all(
    blocks.map(async (block, i) => {
      const code = /^```(\w*)\n([\s\S]*?)```$/.exec(block);
      if (code) {
        const lang = code[1] === 'ts' || code[1] === 'tsx' || !code[1] ? 'tsx' : code[1];
        const html = await highlight(code[2]!.trimEnd(), lang);
        return <div key={i} className="s-code" dangerouslySetInnerHTML={{ __html: html }} />;
      }
      return block
        .split(/\n{2,}/)
        .filter((para) => para.trim())
        .map((para, j) => <Paragraph key={`${i}-${j}`} text={para} link={link} />);
    }),
  );
  return <div className="api-doc">{rendered}</div>;
}

/** A paragraph, or a paragraph's lead line followed by a `- ` list. */
function Paragraph({ text, link }: { text: string; link: LinkResolver }) {
  const lines = text.split('\n');
  const first = lines.findIndex((l) => /^\s*[-*] /.test(l));
  if (first < 0) return <p>{inline(text.replace(/\n/g, ' '), link)}</p>;
  const lead = lines.slice(0, first).join(' ').trim();
  const items: string[] = [];
  for (const line of lines.slice(first)) {
    if (/^\s*[-*] /.test(line)) items.push(line.replace(/^\s*[-*] /, ''));
    else if (items.length > 0) items[items.length - 1] += ` ${line.trim()}`;
  }
  return (
    <>
      {lead ? <p>{inline(lead, link)}</p> : null}
      <ul>
        {items.map((item, i) => (
          <li key={i}>{inline(item, link)}</li>
        ))}
      </ul>
    </>
  );
}

const LINK = /^\{@link(?:code|plain)?\s+([^}|\s]+)(?:[\s|]+([^}]*))?\}$/;

function inline(text: string, link: LinkResolver): ReactNode[] {
  return text.split(/(\{@link[^}]*\}|`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    const ref = LINK.exec(part);
    if (ref) {
      const target = ref[1]!;
      const label = ref[2]?.trim();
      const href = link(target);
      const content = label ? label : <code>{target}</code>;
      return href ? (
        <a key={i} href={href}>
          {content}
        </a>
      ) : (
        <Fragment key={i}>{content}</Fragment>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
