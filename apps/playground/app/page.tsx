import Link from 'next/link';

export default function Home() {
  return (
    <main className="page">
      <h1>video-ultra playground</h1>
      <p>Phase 0. The editor itself arrives on Day 4.</p>
      <ul>
        <li>
          <Link href="/bench">Bench</Link> — decode, play, scrub and export measurements on this
          device.
        </li>
      </ul>
    </main>
  );
}
