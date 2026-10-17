import { webkit, devices } from '@playwright/test';
const S =
  '/private/tmp/claude-501/-Users-himanshumathpal-Desktop-TS-projects-video-editor/bc7b3209-fc14-44c0-aed9-131a56b66d53/scratchpad/iu-m';
const browser = await webkit.launch();
const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
await page.goto('http://localhost:3150/');
await page.waitForTimeout(5000);
await page.screenshot({ path: `${S}-0.png` });
for (const [i, name] of ['Filter', 'Finetune', 'Sticker'].entries()) {
  const b = page.locator('button', { hasText: name }).first();
  if (await b.isVisible()) {
    await b.tap();
    await page.waitForTimeout(1200);
  }
  await page.screenshot({ path: `${S}-${i + 1}.png` });
}
await browser.close();
