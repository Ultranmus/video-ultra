import {
  ALL_FORMATS,
  BlobSource,
  EncodedPacketSink,
  Input,
  UnsupportedInputFormatError,
  type InputAudioTrack,
  type InputTrack,
  type InputVideoTrack,
} from 'mediabunny';
import type { Asset } from '../model/schema';
import { fromSeconds, type Time } from '../model/time';

/**
 * Media probing: what is this file, can this browser play it, and what should the editor know
 * about it? Runs in the engine worker (Mediabunny isn't loaded on the main thread). Reads only the
 * bytes it needs (headers + a few packets), so probing a 2 GB file is fast and memory-flat.
 */

/** Why a file can't be used. */
export type ProbeErrorCode =
  | 'empty'
  | 'unsupported-format'
  | 'unsupported-video-codec'
  | 'unsupported-audio-codec'
  | 'unsupported-image'
  | 'no-media'
  | 'damaged';

/** Something the user should know about a file that still works. */
export type ProbeWarningCode = 'incomplete' | 'audio-unsupported';

export interface ProbeWarning {
  code: ProbeWarningCode;
  message: string;
}

/** What probing found. Everything an {@link Asset} needs except `id` and `source`. */
export interface ProbedMedia {
  /** Probed media files are never LUTs (those are read by the engine). */
  kind: Exclude<Asset['kind'], 'lut'>;
  name: string;
  mimeType: string;
  size: number;
  /** Playable duration (0 for still images). */
  duration: Time;
  /** Display size, after rotation and pixel aspect ratio. */
  width?: number;
  height?: number;
  rotation?: 0 | 90 | 180 | 270;
  hdr?: boolean;
  /** Best-guess frame rate. */
  fps?: number;
  /** Variable frame rate (screen recordings, some phones). */
  vfr?: boolean;
  videoCodec?: string;
  hasAudio: boolean;
  audioCodec?: string;
  /** Index (among the file's audio tracks) of the track the editor plays. */
  audioTrack?: number;
  sampleRate?: number;
  channels?: number;
}

export type ProbeResult =
  | { ok: true; media: ProbedMedia; warnings: ProbeWarning[] }
  | { ok: false; code: ProbeErrorCode; message: string };

const IMAGE_SIGNATURES: [RegExp | ((b: Uint8Array) => boolean), string][] = [
  [(b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, 'image/jpeg'],
  [(b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, 'image/png'],
  [(b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP', 'image/webp'],
  [(b) => ascii(b, 0, 4) === 'GIF8', 'image/gif'],
  [(b) => ascii(b, 4, 4) === 'ftyp' && /^(avif|avis)$/.test(ascii(b, 8, 4)), 'image/avif'],
  [
    (b) =>
      ascii(b, 4, 4) === 'ftyp' &&
      /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)$/.test(ascii(b, 8, 4)),
    'image/heic',
  ],
];

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** Image MIME type from the file's first bytes, or null if it isn't a known image format. */
export function sniffImage(head: Uint8Array): string | null {
  for (const [test, mime] of IMAGE_SIGNATURES) {
    if (typeof test === 'function' ? test(head) : test.test(ascii(head, 0, 16))) return mime;
  }
  return null;
}

/** A clear, user-facing message for a codec this browser can't decode. */
export function unsupportedVideoMessage(codec: string | null): string {
  switch (codec) {
    case 'hevc':
      return "This browser can't play HEVC (H.265) video — the format iPhones record in. Open the editor in Chrome, Edge or Safari, or convert the video to H.264.";
    case 'av1':
      return "This browser can't play AV1 video. Try Chrome, Edge or Firefox, or convert the video to H.264.";
    case 'vp9':
    case 'vp8':
      return "This browser can't play VP8/VP9 video. Try Chrome, Edge or Firefox, or convert the video to H.264.";
    case null:
      return "This video uses a format the editor doesn't recognise (for example ProRes or an old camera codec). Convert it to H.264 MP4 and try again.";
    default:
      return `This browser can't play ${codec.toUpperCase()} video. Convert it to H.264 MP4 and try again.`;
  }
}

const rotations = new Set([0, 90, 180, 270]);

function formatSeconds(seconds: number): string {
  const s = Math.floor(seconds);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

/** Probes a media file (video, audio or image). Never throws. */
export async function probeMedia(
  file: Blob,
  name = (file as File).name ?? 'media',
): Promise<ProbeResult> {
  if (file.size === 0)
    return { ok: false, code: 'empty', message: `"${name}" is empty (0 bytes).` };

  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const imageType = sniffImage(head);
  if (imageType) return probeImage(file, name, imageType);

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  try {
    return await probeAv(input, file, name);
  } catch (error) {
    if (error instanceof UnsupportedInputFormatError) {
      return {
        ok: false,
        code: 'unsupported-format',
        message: `"${name}" isn't a video, audio or image file the editor can open.`,
      };
    }
    return { ok: false, code: 'damaged', message: `"${name}" looks damaged and can't be opened.` };
  } finally {
    input.dispose();
  }
}

async function probeImage(file: Blob, name: string, mimeType: string): Promise<ProbeResult> {
  try {
    const bitmap = await createImageBitmap(file);
    const media: ProbedMedia = {
      kind: 'image',
      name,
      mimeType,
      size: file.size,
      duration: 0,
      width: bitmap.width,
      height: bitmap.height,
      hasAudio: false,
    };
    bitmap.close();
    return { ok: true, media, warnings: [] };
  } catch {
    if (mimeType === 'image/heic') {
      return {
        ok: false,
        code: 'unsupported-image',
        message: `"${name}" is a HEIC photo, which this browser can't open yet. Export it as JPEG (iPhone: Settings → Camera → Formats → Most Compatible) and try again.`,
      };
    }
    return { ok: false, code: 'damaged', message: `"${name}" looks damaged and can't be opened.` };
  }
}

async function probeAv(input: Input, file: Blob, name: string): Promise<ProbeResult> {
  const format = await input.getFormat();
  const videoTracks = await input.getVideoTracks();
  const audioTracks = await input.getAudioTracks();
  if (videoTracks.length === 0 && audioTracks.length === 0) {
    return { ok: false, code: 'no-media', message: `"${name}" has no video or sound in it.` };
  }
  const warnings: ProbeWarning[] = [];

  // Video: the first decodable track, else report why the primary one can't play.
  let video: InputVideoTrack | null = null;
  for (const track of videoTracks) {
    if (await track.canDecode()) {
      video = track;
      break;
    }
  }
  if (videoTracks.length > 0 && !video) {
    const codec = await videoTracks[0]!.getCodec();
    return { ok: false, code: 'unsupported-video-codec', message: unsupportedVideoMessage(codec) };
  }

  // Audio: prefer a decodable stereo/mono track. iPhones add an Apple spatial-audio (APAC) track
  // next to the normal AAC one; browsers can't decode it, so it's skipped.
  let audio: InputAudioTrack | null = null;
  let audioIndex = -1;
  let fallback: { track: InputAudioTrack; index: number } | null = null;
  for (const [index, track] of audioTracks.entries()) {
    if (!(await track.canDecode())) continue;
    if ((await track.getNumberOfChannels()) <= 2) {
      audio = track;
      audioIndex = index;
      break;
    }
    fallback ??= { track, index };
  }
  if (!audio && fallback) {
    audio = fallback.track;
    audioIndex = fallback.index;
  }
  if (audioTracks.length > 0 && !audio) {
    if (!video) {
      const codec = await audioTracks[0]!.getCodec();
      return {
        ok: false,
        code: 'unsupported-audio-codec',
        message: `This browser can't play the sound in "${name}"${codec ? ` (${codec.toUpperCase()})` : ''}. Convert it to MP3 or AAC and try again.`,
      };
    }
    warnings.push({
      code: 'audio-unsupported',
      message: `The sound in "${name}" uses a format this browser can't play, so the clip will be silent.`,
    });
  }
  // Several audio tracks (e.g. iPhone AAC + spatial audio) need no warning: we play the standard
  // one, and there's nothing the user could do about the others. Warnings must be actionable.

  const used = [video, audio].filter((t): t is InputVideoTrack | InputAudioTrack => t !== null);
  const fullS = await input.computeDuration(used);
  const durationS = await playableDuration(used, fullS);
  if (fullS - durationS > 0.5) {
    if (durationS < 0.1) {
      return {
        ok: false,
        code: 'damaged',
        message: `"${name}" is damaged: none of its video or sound is readable.`,
      };
    }
    warnings.push({
      code: 'incomplete',
      message: `"${name}" seems incomplete — maybe the download or copy didn't finish. Only the first ${formatSeconds(durationS)} of ${formatSeconds(fullS)} can be used.`,
    });
  }

  const media: ProbedMedia = {
    kind: video ? 'video' : 'audio',
    name,
    mimeType: await input.getMimeType().catch(() => format.mimeType),
    size: file.size,
    duration: fromSeconds(durationS),
    hasAudio: audio !== null,
  };
  if (video) {
    const rotation = await video.getRotation();
    const metrics = await video.computeFrameRateMetrics().catch(() => null);
    media.width = await video.getDisplayWidth();
    media.height = await video.getDisplayHeight();
    media.rotation = rotations.has(rotation) ? rotation : 0;
    media.hdr = await video.hasHighDynamicRange();
    media.videoCodec = (await video.getCodec()) ?? 'unknown';
    if (metrics) {
      media.fps = Math.round(metrics.bestGuessFrameRate * 1000) / 1000;
      // Not constant = frames aren't evenly spaced (dropped or irregular), so playback must follow
      // each frame's own timestamp.
      media.vfr = !metrics.frameRateIsConstant;
    }
  }
  if (audio) {
    media.audioCodec = (await audio.getCodec()) ?? 'unknown';
    media.audioTrack = audioIndex;
    media.sampleRate = await audio.getSampleRate();
    media.channels = await audio.getNumberOfChannels();
  }
  return { ok: true, media, warnings };
}

/**
 * How much of the file can actually play. A file whose download or copy stopped early still has
 * an index promising the full length, but the packets past the cut are missing (Mediabunny returns
 * no packet there). We binary-search each track for its last present packet — index lookups only,
 * no decoding — and return the shortest playable end.
 */
async function playableDuration(tracks: InputTrack[], durationS: number): Promise<number> {
  let playable = durationS;
  for (const track of tracks) {
    const sink = new EncodedPacketSink(track);
    const present = async (t: number) => {
      try {
        // Read the packet data too: the index alone would claim missing packets exist.
        return (await sink.getPacket(t)) !== null;
      } catch {
        return false;
      }
    };
    if (await present(Math.max(0, durationS - 0.001))) continue;
    let lo = 0;
    let hi = durationS;
    for (let i = 0; i < 24 && hi - lo > 0.01; i++) {
      const mid = (lo + hi) / 2;
      if (await present(mid)) lo = mid;
      else hi = mid;
    }
    playable = Math.min(playable, lo);
  }
  return playable;
}

/** Builds the project {@link Asset} for a probed file. */
export function assetFromProbe(media: ProbedMedia, id: string, source: Asset['source']): Asset {
  const asset: Asset = {
    id,
    kind: media.kind,
    name: media.name,
    mimeType: media.mimeType,
    size: media.size,
    duration: media.duration,
    hasAudio: media.hasAudio,
    source,
  };
  if (media.width !== undefined) asset.width = media.width;
  if (media.height !== undefined) asset.height = media.height;
  if (media.rotation !== undefined) asset.rotation = media.rotation;
  if (media.hdr !== undefined) asset.hdr = media.hdr;
  if (media.fps !== undefined) asset.fps = media.fps;
  if (media.vfr !== undefined) asset.vfr = media.vfr;
  if (media.audioTrack !== undefined) asset.audioTrack = media.audioTrack;
  return asset;
}
