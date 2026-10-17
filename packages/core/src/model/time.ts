/**
 * Timeline time is an integer number of **flicks** (1/705,600,000 s). Every common frame rate
 * (23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120) and audio sample rate (44.1 / 48 / 96 kHz)
 * divides a second into a whole number of flicks, so frame and sample boundaries are exact
 * integers: splitting, trimming and summing durations never drift the way float seconds do.
 * The largest safe value is ~147 days.
 */
export type Time = number;

/** Flicks per second. */
export const FLICKS_PER_SECOND = 705_600_000;

/** A frame rate as a rational number, e.g. 29.97 fps = `{ num: 30000, den: 1001 }`. */
export interface FrameRate {
  num: number;
  den: number;
}

/** Common frame rates. */
export const FRAME_RATES = {
  fps23976: { num: 24000, den: 1001 },
  fps24: { num: 24, den: 1 },
  fps25: { num: 25, den: 1 },
  fps2997: { num: 30000, den: 1001 },
  fps30: { num: 30, den: 1 },
  fps50: { num: 50, den: 1 },
  fps5994: { num: 60000, den: 1001 },
  fps60: { num: 60, den: 1 },
} as const satisfies Record<string, FrameRate>;

/** Seconds → flicks (rounded to the nearest flick). */
export function fromSeconds(seconds: number): Time {
  return Math.round(seconds * FLICKS_PER_SECOND);
}

/** Flicks → seconds. */
export function toSeconds(time: Time): number {
  return time / FLICKS_PER_SECOND;
}

/** Microseconds (WebCodecs timestamps) → flicks. */
export function fromMicroseconds(us: number): Time {
  return Math.round(us * (FLICKS_PER_SECOND / 1_000_000));
}

/** Flicks → microseconds (WebCodecs timestamps), rounded. */
export function toMicroseconds(time: Time): number {
  return Math.round(time / (FLICKS_PER_SECOND / 1_000_000));
}

/** Length of one frame in flicks. Exact for every rate in {@link FRAME_RATES}. */
export function frameDuration(rate: FrameRate): Time {
  return Math.round((FLICKS_PER_SECOND * rate.den) / rate.num);
}

/** Index of the frame that contains `time` (frames start at 0). */
export function frameIndex(time: Time, rate: FrameRate): number {
  return Math.floor(time / frameDuration(rate));
}

/** Rounds `time` to the nearest frame boundary. */
export function snapToFrame(time: Time, rate: FrameRate): Time {
  const frame = frameDuration(rate);
  return Math.round(time / frame) * frame;
}

/** Frames per second as a float (for display and encoder settings only). */
export function fps(rate: FrameRate): number {
  return rate.num / rate.den;
}

/** `m:ss.cc` for display, e.g. `1:04.25`. Hours appear only when needed. */
export function formatTime(time: Time): string {
  const totalCentis = Math.floor((Math.max(0, time) / FLICKS_PER_SECOND) * 100);
  const centis = totalCentis % 100;
  const totalSeconds = Math.floor(totalCentis / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  const body = `${pad(seconds)}.${pad(centis)}`;
  return hours > 0 ? `${hours}:${pad(minutes)}:${body}` : `${minutes}:${body}`;
}
