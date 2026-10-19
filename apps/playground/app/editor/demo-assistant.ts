import type { EditingAssistant, EditingRequest, EditingResponse } from '@video-ultra/core';
import { createChatAssistant } from '@video-ultra/ai';

/**
 * The playground's assistant: the real model behind `/api/assistant` when the server has a key,
 * otherwise a tiny offline demo that understands a few phrases — enough to try the Assistant
 * panel without any account. Not part of the package.
 */
export function createPlaygroundAssistant(): EditingAssistant {
  const remote = createChatAssistant({ endpoint: '/api/assistant' });
  let offline = false;
  return {
    async edit(request) {
      if (!offline) {
        try {
          return await remote.edit(request);
        } catch (error) {
          if (!String(error).includes('501')) throw error;
          offline = true;
        }
      }
      return demoAnswer(request);
    },
  };
}

type Row = Record<string, string | number | boolean | null>;

/** A few phrases, mapped to edit actions (offline demo). */
export function demoAnswer(request: EditingRequest): EditingResponse {
  const text = request.instruction.toLowerCase();
  const rows: Row[] = request.project.tracks.flatMap((t) => t.items);
  const main = request.project.tracks.find((t) => t.kind === 'main video')?.items ?? [];
  const pictures = rows.filter((r) => ['video', 'image', 'freeze'].includes(String(r.kind)));
  const targets = request.selection.length
    ? rows.filter((r) => request.selection.includes(String(r.id)))
    : pictures;
  const actions: unknown[] = [];
  const said: string[] = [];
  const title = /(?:title|text)\s*[“"']([^”"']+)[”"']/.exec(request.instruction);
  if (title) {
    const atEnd = /\bend\b/.test(text);
    actions.push({
      action: 'addText',
      text: title[1],
      start: atEnd ? Math.max(0, request.project.duration - 3) : 0,
      duration: 3,
      position: /bottom/.test(text) ? 'bottom' : /top/.test(text) ? 'top' : 'center',
      size: 'large',
    });
    said.push(`added the title “${title[1]}”`);
  }
  if (/warm/.test(text) || /cool|cold/.test(text)) {
    const warmth = /warm/.test(text) ? 0.4 : -0.4;
    for (const r of targets) actions.push({ action: 'adjust', itemId: r.id, warmth });
    said.push(warmth > 0 ? 'made it warmer' : 'made it cooler');
  }
  if (/bright/.test(text)) {
    for (const r of targets) actions.push({ action: 'adjust', itemId: r.id, brightness: 0.25 });
    said.push('brightened it');
  }
  if (/fade|transition/.test(text)) {
    for (const r of main.slice(1))
      actions.push({ action: 'transition', itemId: r.id, transition: 'fade' });
    const fades = Math.max(0, main.length - 1);
    said.push(fades === 1 ? 'added a fade' : `added ${fades} fades`);
  }
  if (/square|instagram/.test(text)) {
    actions.push({ action: 'canvas', ratio: '1:1' });
    said.push('made it square');
  }
  if (/vertical|tiktok|reel|story/.test(text)) {
    actions.push({ action: 'canvas', ratio: '9:16' });
    said.push('made it vertical');
  }
  if (/mute/.test(text)) {
    for (const r of rows.filter((x) => x.kind === 'video'))
      actions.push({ action: 'sound', itemId: r.id, muted: true });
    said.push('muted the clips');
  }
  if (actions.length === 0)
    return {
      reply:
        'This offline demo knows a few phrases: a title “…”, warmer / cooler, brighter, fades, square, vertical, mute. Connect a model on the server for anything else.',
      actions: [],
    };
  return { reply: `Done: ${said.join(', ')}.`, actions };
}
