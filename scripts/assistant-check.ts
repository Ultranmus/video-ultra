/* eslint-disable @typescript-eslint/no-explicit-any -- reads the page's controller via window */
/**
 * AI editing (v0.4) in a real browser: the Assistant panel sends the instruction and a project
 * description to the host's endpoint (OpenAI-compatible; mocked here with a canned model answer)
 * and applies the answer as one undo step; a plan with one bad action changes nothing and says
 * why; without a server key the playground's offline demo answers (warmer, title, fades); axe;
 * the phone toolbar has it.
 * Usage: playground running, then node scripts/assistant-check.ts [--port 3200]
 */
import AxeBuilder from '@axe-core/playwright';
import { chromium, devices, type Page } from '@playwright/test';
import { resolve } from 'node:path';

const arg = (name: string) =>
  process.argv.includes(`--${name}`)
    ? process.argv[process.argv.indexOf(`--${name}`) + 1]
    : undefined;
const port = arg('port') ?? '3200';
let failures = 0;
const results: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures++;
};

const browser = await chromium.launch({ channel: 'chrome' });
const errors: string[] = [];

async function load(page: Page) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/editor?autosave=0`);
  await page.waitForFunction(() => (window as any).vuEditor?.engine, null, { timeout: 30000 });
  await page
    .locator('.vu-root input[type=file][accept^="video"]')
    .setInputFiles(
      ['avc-720p30.mp4', 'avc-noaudio.mp4'].map((f) => resolve('test-media/files', f)),
    );
  await page.waitForFunction(() => (window as any).vuEditor.project.tracks[0].items.length === 2);
}
const lastTurn = (page: Page) =>
  page.evaluate(() => {
    const turns = (window as any).vuEditor.ui.getState().assistantTurns;
    return turns[turns.length - 1] ?? null;
  });
const ask = async (page: Page, text: string) => {
  const before = await page.evaluate(
    () => (window as any).vuEditor.ui.getState().assistantTurns.length,
  );
  await page.locator('.vu-assistant-input').fill(text);
  await page.locator('.vu-assistant-input').press('Enter');
  await page.waitForFunction(
    (n) => (window as any).vuEditor.ui.getState().assistantTurns.length > n,
    before,
    { timeout: 15000 },
  );
  return lastTurn(page);
};

const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
// The server's model, mocked: an OpenAI-shaped answer. Captures what the editor sent.
let sent: any = null;
await page.route('**/api/assistant', async (route) => {
  sent = JSON.parse(route.request().postData() ?? '{}');
  const user = JSON.parse(sent.messages[sent.messages.length - 1].content);
  const first = user.project.tracks.find((t: any) => t.kind === 'main video').items[0].id;
  const plan = user.instruction.includes('broken')
    ? [
        { action: 'filter', itemId: first, filter: 'warm' },
        { action: 'split', itemId: 'made-up-id', at: 1 },
      ]
    : [
        { action: 'filter', itemId: first, filter: 'warm', intensity: 0.7 },
        { action: 'addText', text: 'Hello', start: 0, duration: 2, position: 'top' },
      ];
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({ reply: 'Warmed it and added Hello.', actions: plan }),
          },
        },
      ],
    }),
  });
});
await load(page);
await page.locator('.vu-rail button', { hasText: 'Assistant' }).click();
const axe = await new AxeBuilder({ page }).include('.vu-panel').analyze();
check(
  'Assistant panel passes axe',
  axe.violations.length === 0,
  axe.violations.map((v) => v.id).join(', '),
);

// 1. Through the (mocked) server model.
let turn = await ask(page, 'Make the first clip warm and say hello');
const state = await page.evaluate(() => {
  const p = (window as any).vuEditor.project;
  return {
    filter: p.tracks[0].items[0].filter?.id,
    texts: p.tracks
      .flatMap((t: any) => t.items)
      .filter((i: any) => i.kind === 'text')
      .map((i: any) => i.text),
  };
});
check(
  'the model’s plan is applied (filter + title)',
  turn.applied === 2 && state.filter === 'warm' && state.texts.includes('Hello'),
  `${turn.reply} · ${JSON.stringify(state)}`,
);
check(
  'the request carries the guide, the instruction and the project (ids, no media)',
  sent.messages[0].content.includes('"action":"split"') &&
    JSON.parse(sent.messages.at(-1).content).project.tracks[0].items.length === 2 &&
    !JSON.stringify(sent).includes('blob:'),
);
await page.evaluate(() => (window as any).vuEditor.undo());
const undone = await page.evaluate(() => {
  const p = (window as any).vuEditor.project;
  return (
    !p.tracks[0].items[0].filter &&
    !p.tracks.some((t: any) => t.items.some((i: any) => i.kind === 'text'))
  );
});
check('one Undo takes the whole plan back', undone);
await page.locator('.vu-panel .vu-assistant-result').last().waitFor();
check(
  'the conversation shows the reply and "Made 2 changes"',
  (await page.locator('.vu-assistant-turn').last().innerText()).includes('Made 2 changes'),
);

// 2. A plan with one bad action changes nothing and says why.
turn = await ask(page, 'something broken');
const filterAfter = await page.evaluate(
  () => (window as any).vuEditor.project.tracks[0].items[0].filter,
);
check(
  'a plan with a made-up id changes nothing and says which action',
  turn.applied === 0 && /Action 2/.test(turn.error ?? '') && !filterAfter,
  turn.error,
);

// 3. No server key → the offline demo.
await page.unroute('**/api/assistant');
turn = await ask(page, 'Make the whole video warmer');
const warm = await page.evaluate(() =>
  (window as any).vuEditor.project.tracks[0].items.map((i: any) => i.adjust.warmth),
);
check(
  'offline demo: "warmer" warms every clip',
  JSON.stringify(warm) === '[0.4,0.4]',
  `${turn.reply} ${JSON.stringify(warm)}`,
);
turn = await ask(page, 'Add a title “Day one” at the start');
check('offline demo: a title', turn.applied === 1, turn.reply);
turn = await ask(page, 'Add a fade between every clip');
const fade = await page.evaluate(
  () => (window as any).vuEditor.project.tracks[0].items[1].transitionIn?.type,
);
check('offline demo: fades between clips', fade === 'fade', turn.reply);
check('no page errors', errors.length === 0, errors.join(' | '));

// 4. Phone: in the toolbar.
{
  const iphone: Record<string, unknown> = { ...devices['iPhone 13'] };
  delete iphone.defaultBrowserType;
  const phone = await (await browser.newContext(iphone)).newPage();
  await load(phone);
  await phone.evaluate(() => (window as any).vuEditor.select(null));
  const has = await phone.locator('.vu-toolbar button', { hasText: 'Assistant' }).count();
  check('phone: Assistant in the toolbar', has > 0);
}
await browser.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
