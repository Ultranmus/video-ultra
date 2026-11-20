import { codeToHtml } from 'shiki';
import { CopyButton } from './copy-button';

/** Syntax-highlighted HTML, light and dark (the page's colour scheme picks). Build time only. */
export function highlight(code: string, lang = 'tsx'): Promise<string> {
  return codeToHtml(code, {
    lang,
    themes: { light: 'github-light-default', dark: 'github-dark-default' },
    defaultColor: false,
  });
}

/** A code sample: highlighted, scrolls sideways in its own box, with a copy button. */
export async function Code({ children, lang = 'tsx' }: { children: string; lang?: string }) {
  const code = children.replace(/^\n/, '').replace(/\s+$/, '');
  const html = await highlight(code, lang);
  // The <pre> is focusable (shiki sets tabindex) so keyboard users can scroll a long line.
  return (
    <div className="s-code" data-lang={lang}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      <CopyButton text={code} />
    </div>
  );
}
