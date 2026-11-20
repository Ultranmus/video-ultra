/** A docs page in the sidebar. */
export interface DocsPage {
  href: string;
  title: string;
}

/** The docs sidebar, in reading order, in groups. */
export const GROUPS: { title: string; pages: DocsPage[] }[] = [
  {
    title: 'Start',
    pages: [
      { href: '/docs', title: 'Introduction' },
      { href: '/docs/getting-started', title: 'Getting started' },
      { href: '/docs/nextjs', title: 'Next.js' },
      { href: '/docs/vite', title: 'Vite' },
    ],
  },
  {
    title: 'Guides',
    pages: [
      { href: '/docs/saving', title: 'Saving and projects' },
      { href: '/docs/events', title: 'Events and the controller' },
      { href: '/docs/customize', title: 'Customising the editor' },
      { href: '/docs/theming', title: 'Theming' },
      { href: '/docs/captions', title: 'Captions' },
      { href: '/docs/ai', title: 'AI features' },
      { href: '/docs/performance', title: 'Performance and devices' },
    ],
  },
  {
    title: 'Reference',
    pages: [
      { href: '/docs/options', title: 'All options' },
      { href: '/docs/api', title: 'API reference' },
      { href: '/playground', title: 'Playground' },
    ],
  },
];

/** The docs pages in reading order (previous / next links); the playground is not a docs page. */
export const PAGES: DocsPage[] = GROUPS.flatMap((g) => g.pages).filter((p) =>
  p.href.startsWith('/docs'),
);
