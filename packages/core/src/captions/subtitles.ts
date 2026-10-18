import { FLICKS_PER_SECOND, type Time } from '../model/time';

/**
 * Subtitle files (v0.2 A1): SubRip (.srt) and WebVTT (.vtt) in and out. Pure; tested. Times are
 * flicks. Reading is forgiving (BOM, CRLF, missing numbers, comma or dot milliseconds, hours
 * optional, VTT cue settings and simple tags); writing is strict.
 */

/** One subtitle: when it shows and its text (lines joined with `\n`). */
export interface SubtitleCue {
  start: Time;
  end: Time;
  text: string;
}

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/;
const ARROW = new RegExp(`${TIME.source}\\s*-->\\s*${TIME.source}`);

function toFlicks(h: string | undefined, m: string, s: string, ms: string): Time {
  const seconds =
    Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
  return Math.round(seconds * FLICKS_PER_SECOND);
}

/** Reads SRT or VTT text into cues (in time order; empty and broken cues are skipped). */
export function parseSubtitles(text: string): SubtitleCue[] {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const cues: SubtitleCue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ARROW.exec(lines[i]!);
    if (!m) continue;
    const start = toFlicks(m[1], m[2]!, m[3]!, m[4]!);
    const end = toFlicks(m[5], m[6]!, m[7]!, m[8]!);
    const body: string[] = [];
    while (i + 1 < lines.length && lines[i + 1]!.trim() !== '') {
      if (ARROW.test(lines[i + 1]!)) break;
      body.push(lines[++i]!);
    }
    const textOut = body
      .join('\n')
      // Simple markup: <b>, <i>, <font …>, VTT voice / class tags, {\an8}-style overrides.
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .trim();
    if (textOut && end > start) cues.push({ start, end, text: textOut });
  }
  return cues.sort((a, b) => a.start - b.start);
}

function stamp(t: Time, separator: ',' | '.'): string {
  const ms = Math.max(0, Math.round((t / FLICKS_PER_SECOND) * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor(ms / 60_000) % 60;
  const s = Math.floor(ms / 1000) % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(ms % 1000, 3)}`;
}

/** Cues as a SubRip (.srt) file. */
export function formatSrt(cues: readonly SubtitleCue[]): string {
  return (
    cues
      .map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}`)
      .join('\n\n') + '\n'
  );
}

/** Cues as a WebVTT (.vtt) file. */
export function formatVtt(cues: readonly SubtitleCue[]): string {
  return (
    'WEBVTT\n\n' +
    cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}`).join('\n\n') +
    '\n'
  );
}
