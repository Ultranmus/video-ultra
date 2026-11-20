import type { Metadata } from 'next';
import { Code, PageNav, TryIt } from '../parts';

export const metadata: Metadata = { title: 'Theming' };

export default function Theming() {
  return (
    <article>
      <h1>Theming</h1>
      <p className="docs-lead">
        Dark, light or the device&apos;s choice, your colours, corners and font. Try every option
        live in the playground and copy the result.
      </p>
      <Code lang="tsx">{`
<VideoEditor
  theme="auto" // 'dark' (default), 'light', or follow the OS
  themeOverrides={{ accent: '#0a7cff', fontFamily: 'Inter, sans-serif', radius: '12px' }}
  contrast="auto" // high contrast when the OS asks for more
  density="auto" // thumb-sized controls on touch screens
/>
`}</Code>
      <TryIt href="/playground?tab=theme">Try themes in the playground</TryIt>
      <p>
        <code>themeOverrides</code> covers the common tokens: <code>accent</code>,{' '}
        <code>accentHover</code>, <code>accentContrast</code>, <code>accentText</code>,{' '}
        <code>bg</code>, <code>stage</code>, <code>surface1</code>–<code>surface3</code>,{' '}
        <code>text</code>, <code>textMuted</code>, <code>border</code>, <code>fontFamily</code>,{' '}
        <code>radius</code> and <code>timelineBg</code>.
      </p>
      <h2>Everything else, in CSS</h2>
      <p>
        The editor&apos;s styles live in <code>@layer video-ultra</code> and use <code>--vu-*</code>{' '}
        variables, so your CSS wins without fighting specificity:
      </p>
      <Code lang="css">{`
.vu-root {
  --vu-surface-1: #101014;
  --vu-selection: #0a7cff;
}
`}</Code>
      <p>
        Classes start with <code>vu-</code>; the editor never styles anything outside its root, and
        your page styles don&apos;t leak in.
      </p>
      <PageNav href="/docs/theming" />
    </article>
  );
}
