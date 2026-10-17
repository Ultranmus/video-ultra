'use client';

/** Probes every file in the test library with `probeMedia` and prints the results as JSON. */
import { probeMedia, type ProbeResult } from '@video-ultra/core/internal';
import { useEffect, useState } from 'react';

interface Entry {
  file: string;
  label: string;
}

export default function ProbeLab() {
  const [results, setResults] = useState<Record<string, ProbeResult & { ms: number }> | null>(null);
  useEffect(() => {
    (async () => {
      const manifest: Entry[] = await (await fetch('/media/manifest.json')).json();
      const out: Record<string, ProbeResult & { ms: number }> = {};
      for (const entry of manifest) {
        const blob = await (await fetch(`/media/${entry.file}`)).blob();
        const t0 = performance.now();
        const result = await probeMedia(blob, entry.file.split('/').pop());
        out[entry.file] = { ...result, ms: Math.round(performance.now() - t0) };
      }
      setResults(out);
    })().catch((e: unknown) =>
      setResults({ error: { ok: false, code: 'damaged', message: String(e), ms: 0 } }),
    );
  }, []);
  return (
    <main className="page">
      <h1>Probe lab</h1>
      <pre id="results">{results ? JSON.stringify(results, null, 2) : 'Probing…'}</pre>
    </main>
  );
}
