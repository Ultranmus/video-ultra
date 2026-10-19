import type { ReactNode } from 'react';

export const metadata = { title: 'video-ultra · Next.js example' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0b0b0d' }}>{children}</body>
    </html>
  );
}
