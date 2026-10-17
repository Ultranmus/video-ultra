import Link from 'next/link';

export default function Home() {
  return (
    <main className="page">
      <h1>video-ultra playground</h1>
      <ul>
        <li>
          <Link href="/editor">Editor</Link> — the full editor (add <code>?theme=light</code>,{' '}
          <code>?backend=webgl2</code>).
        </li>
        <li>
          <Link href="/bench">Bench</Link> — decode, play, scrub and export measurements on this
          device.
        </li>
      </ul>
    </main>
  );
}
