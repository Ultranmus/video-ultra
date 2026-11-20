import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VideoUltra playground',
  description: 'Development playground and performance bench for video-ultra.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Full-bleed on notched phones; Android shrinks the page (not just the view) for the keyboard.
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
