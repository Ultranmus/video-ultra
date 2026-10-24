import {
  EDIT_ACTIONS_GUIDE,
  type EditingAssistant,
  type EditingRequest,
  type EditingResponse,
} from '@video-ultra/core';

/** Options of {@link createChatAssistant}. */
export interface ChatAssistantOptions {
  /**
   * An OpenAI-compatible chat completions URL — your own server or proxy, so API keys never
   * reach the browser (e.g. `/api/assistant`, which adds the key and forwards).
   */
  endpoint: string;
  /** Model name sent as `model` (your endpoint may ignore it). */
  model?: string;
  /** Extra request headers (e.g. your app's session token). */
  headers?: Record<string, string>;
  /** Extra instructions after the built-in ones (house style, language…). */
  instructions?: string;
  /** For tests / custom transports. Default: the global `fetch`. */
  fetch?: typeof fetch;
}

/**
 * An {@link EditingAssistant} for any OpenAI-compatible chat endpoint (v0.4). Sends the
 * instruction, the project description and the action guide; expects JSON `{reply, actions}`
 * back. The editor validates every action before applying (one undo step).
 *
 * ```tsx
 * import { createChatAssistant } from '@video-ultra/ai';
 * <VideoEditor assistant={createChatAssistant({ endpoint: '/api/assistant' })} />
 * ```
 */
export function createChatAssistant(options: ChatAssistantOptions): EditingAssistant {
  const call = options.fetch ?? fetch.bind(globalThis);
  return {
    async edit(request: EditingRequest): Promise<EditingResponse> {
      const system = [EDIT_ACTIONS_GUIDE, options.instructions ?? ''].filter(Boolean).join('\n\n');
      const messages = [
        { role: 'system', content: system },
        ...request.history.flatMap((turn) => [
          { role: 'user', content: turn.instruction },
          { role: 'assistant', content: JSON.stringify({ reply: turn.reply, actions: [] }) },
        ]),
        {
          role: 'user',
          content: JSON.stringify({
            instruction: request.instruction,
            selection: request.selection,
            playhead: request.playhead,
            project: request.project,
          }),
        },
      ];
      const response = await call(options.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
        body: JSON.stringify({
          ...(options.model ? { model: options.model } : {}),
          messages,
          response_format: { type: 'json_object' },
          temperature: 0.2,
        }),
        signal: request.signal,
      });
      // The status rides along, so the editor can tell "busy, try again" from a real failure.
      if (!response.ok)
        throw Object.assign(new Error(`The assistant answered ${response.status}`), {
          status: response.status,
        });
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      return parseAnswer(body.choices?.[0]?.message?.content ?? '');
    },
  };
}

/** Reads a model's answer: JSON (possibly in a ``` block) with `reply` and `actions`. */
export function parseAnswer(text: string): EditingResponse {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = (fenced ? fenced[1]! : text).trim();
  try {
    const value = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as {
      reply?: unknown;
      actions?: unknown;
    };
    return {
      reply: typeof value.reply === 'string' ? value.reply : '',
      actions: Array.isArray(value.actions) ? value.actions : [],
    };
  } catch {
    // Not JSON: show what it said, change nothing.
    return { reply: text.trim().slice(0, 500), actions: [] };
  }
}
