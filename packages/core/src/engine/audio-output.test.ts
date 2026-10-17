import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mixer } from '../audio/mixer';
import { createProject } from '../model/project';
import { fromSeconds, toSeconds } from '../model/time';
import { AudioOutput } from './audio-output';

/** A MessagePort stand-in: records what the output sends; lets the test deliver worklet reports. */
function fakePort() {
  const sent: { type: string; frames?: number }[] = [];
  const port = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    postMessage(message: { type: string; left?: Float32Array }) {
      sent.push({ type: message.type, ...(message.left ? { frames: message.left.length } : {}) });
    },
  };
  const report = (played: number, buffered: number, underruns = 0) =>
    port.onmessage?.({ data: { type: 'progress', played, buffered, underruns } } as MessageEvent);
  return { port: port as unknown as MessagePort, sent, report };
}

const silentMixer = { render: async () => undefined, dispose: () => undefined } as unknown as Mixer;
const RATE = 48000;

afterEach(() => vi.useRealTimers());

describe('AudioOutput', () => {
  it('pre-fills ~0.2 s, then starts the worklet', async () => {
    const { port, sent } = fakePort();
    const out = new AudioOutput(
      port,
      RATE,
      0,
      silentMixer,
      () => createProject(),
      () => undefined,
    );
    await out.start(fromSeconds(3));
    const chunks = sent.filter((m) => m.type === 'chunk');
    expect(chunks.length * 2048).toBeGreaterThanOrEqual(0.2 * RATE);
    expect(sent.at(-1)?.type).toBe('start');
    expect(sent[0]?.type).toBe('flush'); // a start always begins from a clean queue
  });

  it('holds the clock until the first report, then follows frames played minus latency', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const { port, report } = fakePort();
    const out = new AudioOutput(
      port,
      RATE,
      0.05,
      silentMixer,
      () => createProject(),
      () => undefined,
    );
    await out.start(fromSeconds(10));
    expect(out.clock()).toBeNull();
    report(RATE, RATE); // 1 s played, plenty queued
    expect(toSeconds(out.clock()!)).toBeCloseTo(10 + 1 - 0.05, 3);
    vi.advanceTimersByTime(100); // extrapolates between reports
    expect(toSeconds(out.clock()!)).toBeCloseTo(10 + 1.1 - 0.05, 3);
  });

  it('never runs ahead of the audio actually queued (a starving worklet stops the clock)', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const { port, report } = fakePort();
    const out = new AudioOutput(
      port,
      RATE,
      0,
      silentMixer,
      () => createProject(),
      () => undefined,
    );
    await out.start(0);
    report(RATE, RATE * 0.05); // only 50 ms left in the queue
    vi.advanceTimersByTime(500);
    expect(toSeconds(out.clock()!)).toBeCloseTo(1.05, 3);
    report(RATE * 1.05, 0, 1); // ran dry
    vi.advanceTimersByTime(500);
    expect(toSeconds(out.clock()!)).toBeCloseTo(1.05, 3);
    expect(out.underruns).toBe(1);
  });

  it('keeps about 0.3 s queued as the worklet plays', async () => {
    const { port, sent, report } = fakePort();
    const out = new AudioOutput(
      port,
      RATE,
      0,
      silentMixer,
      () => createProject(),
      () => undefined,
    );
    await out.start(0);
    const before = sent.filter((m) => m.type === 'chunk').length;
    report(RATE * 0.15, RATE * 0.05); // played most of the pre-roll
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    const after = sent.filter((m) => m.type === 'chunk').length;
    const queued = after * 2048 - RATE * 0.15;
    expect(after).toBeGreaterThan(before);
    expect(queued).toBeGreaterThanOrEqual(0.3 * RATE);
    expect(queued).toBeLessThan(0.3 * RATE + 2048);
  });

  it('stop flushes the queue and pauses the clock', async () => {
    const { port, sent, report } = fakePort();
    const out = new AudioOutput(
      port,
      RATE,
      0,
      silentMixer,
      () => createProject(),
      () => undefined,
    );
    await out.start(0);
    report(RATE, RATE);
    out.stop();
    expect(sent.at(-1)?.type).toBe('flush');
    expect(out.clock()).toBeNull();
  });
});
