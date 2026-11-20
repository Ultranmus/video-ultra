import { describe, expect, it } from 'vitest';
import { describeProject, createProject } from '@video-ultra/core';
import { createChatAssistant, parseAnswer } from './assistant';

describe('chat assistant', () => {
  it('reads answers: plain JSON, fenced JSON, or text (no actions)', () => {
    expect(parseAnswer('{"reply":"Done","actions":[{"action":"marker","time":1}]}')).toEqual({
      reply: 'Done',
      actions: [{ action: 'marker', time: 1 }],
    });
    expect(parseAnswer('Sure!\n```json\n{"reply":"ok","actions":[]}\n```').reply).toBe('ok');
    expect(parseAnswer('I cannot do that.')).toEqual({ reply: 'I cannot do that.', actions: [] });
  });

  it('sends the guide, the project and the history to the endpoint', async () => {
    let sent: { url: string; body: { messages: { role: string; content: string }[] } } | null =
      null;
    const assistant = createChatAssistant({
      endpoint: '/api/assistant',
      model: 'm',
      fetch: (async (url: string, init: RequestInit) => {
        sent = { url, body: JSON.parse(init.body as string) };
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"reply":"Added","actions":[]}' } }] }),
        );
      }) as typeof fetch,
    });
    const answer = await assistant.edit({
      instruction: 'add a title',
      project: describeProject(createProject()),
      selection: [],
      playhead: 0,
      history: [{ instruction: 'hi', reply: 'hello' }],
      signal: new AbortController().signal,
    });
    expect(answer.reply).toBe('Added');
    expect(sent!.url).toBe('/api/assistant');
    const messages = sent!.body.messages;
    expect(messages[0]!.content).toContain('"action":"split"');
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(JSON.parse(messages[3]!.content).instruction).toBe('add a title');
  });
});

describe('speech endpoint', () => {
  it('posts text, voice and speed and returns typed audio', async () => {
    const { createSpeechEndpoint } = await import('./speech');
    let body: Record<string, unknown> = {};
    const speech = createSpeechEndpoint({
      endpoint: '/api/speech',
      fetch: (async (_url: string, init: RequestInit) => {
        body = JSON.parse(init.body as string);
        return new Response(new Uint8Array([1, 2, 3]));
      }) as typeof fetch,
    });
    const audio = await speech.speak({
      text: 'Hello',
      voice: 'nova',
      speed: 3,
      signal: new AbortController().signal,
    });
    expect(body).toMatchObject({ input: 'Hello', voice: 'nova', speed: 2, response_format: 'mp3' });
    expect(audio.type).toBe('audio/mpeg');
    expect((await speech.voices()).length).toBe(6);
    expect(speech.appliesSpeed).toBe(true);
    expect(createSpeechEndpoint({ endpoint: '/x', appliesSpeed: false }).appliesSpeed).toBe(false);
  });
});
