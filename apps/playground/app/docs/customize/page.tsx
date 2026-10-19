import type { Metadata } from 'next';
import { Code, PageNav } from '../parts';

export const metadata: Metadata = { title: 'Customising the editor' };

export default function Customize() {
  return (
    <article>
      <h1>Customising the editor</h1>
      <Code lang="tsx">{`
<VideoEditor
  customize={{
    hide: ['captions', 'blur', 'videos'],
    railOrder: ['media', 'brand', 'text'],
    panels: [
      {
        id: 'brand',
        label: 'Brand',
        icon: 'M4 4h16v16H4z', // one SVG path on a 24 × 24 grid
        render: (ctl) => <BrandKit ctl={ctl} />,
      },
    ],
    buttons: [{ id: 'share', label: 'Share', onClick: (ctl) => share(ctl.project) }],
    mediaSources: [stockFootage],
  }}
/>
`}</Code>
      <h2>Hide or reorder</h2>
      <p>
        <code>hide</code> takes ids of left-menu panels (<code>templates</code>, <code>text</code>,{' '}
        <code>captions</code>, <code>audio</code>, <code>stickers</code>, <code>filters</code>,{' '}
        <code>transitions</code>, <code>blur</code>), tools (<code>speed</code>, <code>mask</code>,{' '}
        <code>key</code>, <code>cutout</code>…), commands (<code>duplicate</code>, <code>copy</code>
        …) and <code>videos</code> (Your videos). <code>railOrder</code> sorts the left menu, your
        panels included.
      </p>
      <h2>Your own media</h2>
      <Code lang="ts">{`
const stockFootage: MediaSource = {
  id: 'stock',
  label: 'Stock footage',
  async search({ text, cursor }, signal) {
    const page = await api.search(text, cursor, { signal });
    return {
      items: page.results.map((r) => ({
        id: r.id,
        name: r.title,
        kind: 'video',
        thumbnailUrl: r.thumb,
        duration: r.seconds,
        credit: r.licence, // kept with the media in the project
      })),
      next: page.next,
    };
  },
  load: (item, signal) => api.download(item.id, { signal }), // a Blob
};
`}</Code>
      <h2>Text and languages</h2>
      <p>
        Every word in the editor comes from <code>labels</code>; pass any of them to translate or
        rename (<code>DEFAULT_LABELS</code> lists them). <code>dir=&quot;rtl&quot;</code> mirrors
        the chrome for right-to-left languages.
      </p>
      <PageNav href="/docs/customize" />
    </article>
  );
}
