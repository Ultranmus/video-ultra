import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Every decoded frame has exactly one owner, even when the decoder answers late or the source is
 * shut down mid-decode. A fake Mediabunny sink hands out samples on demand and counts closes.
 */
interface FakeSample {
  timestamp: number;
  duration: number;
  closed: boolean;
  close(): void;
  clone(): FakeSample;
}

const made: FakeSample[] = [];
function sample(timestamp: number): FakeSample {
  const s: FakeSample = {
    timestamp,
    duration: 1 / 30,
    closed: false,
    close() {
      this.closed = true;
    },
    clone() {
      return sample(this.timestamp);
    },
  };
  made.push(s);
  return s;
}

/** The next decode: resolved by the test, so it can arrive late or after a shutdown. */
let release: ((value: IteratorResult<FakeSample>) => void) | null = null;

vi.mock('mediabunny', () => ({
  VideoSampleSink: class {
    samples() {
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () =>
              new Promise<IteratorResult<FakeSample>>((resolve) => {
                release = resolve;
              }),
            return: () => Promise.resolve({ done: true as const, value: undefined }),
          };
        },
      };
    }
    getSample() {
      return Promise.resolve(null);
    }
  },
  EncodedPacketSink: class {
    getKeyPacket() {
      return Promise.resolve(null);
    }
  },
}));

const { DecoderPool, FrameSource } = await import('./frames');
const track = { canDecode: () => Promise.resolve(true) } as never;
const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  made.length = 0;
  release = null;
  vi.useRealTimers();
});

describe('FrameSource frame ownership', () => {
  it('closes a frame that arrives after the source was shut down', async () => {
    const source = new FrameSource(track, new DecoderPool(2), false);
    const result = source.frameAt(0);
    await tick();
    source.destroy();
    release?.({ done: false, value: sample(0) });
    expect(await result).toBeNull();
    await tick();
    expect(made.every((s) => s.closed)).toBe(true);
  });

  it('closes a frame that arrives after the watchdog gave up on it', async () => {
    vi.useFakeTimers();
    const source = new FrameSource(track, new DecoderPool(2), false);
    const result = source.frameAt(0);
    await vi.advanceTimersByTimeAsync(3100); // the watchdog fires
    expect(await result).toBeNull();
    release?.({ done: false, value: sample(0) }); // the decoder answers late
    await vi.advanceTimersByTimeAsync(0);
    expect(made.length).toBe(1);
    expect(made[0]!.closed).toBe(true);
    source.destroy();
  });
});
