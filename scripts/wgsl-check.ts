/**
 * Compiles the compositor's WGSL with Chrome's own WebGPU compiler (Tint) — both the image
 * variant and the derived video (external texture) variant — and builds the render pipelines.
 * `pnpm shaders` validates with naga, which accepts some code Tint rejects (e.g. `a * b ^ c`
 * without parentheses); a Tint error means black WebGPU frames.
 * Usage: playground running, then node scripts/wgsl-check.ts
 */
import { chromium } from '@playwright/test';
import { externalVariant } from '../packages/core/src/render/shaders/external.ts';
import { SHADERS } from '../packages/core/src/render/shaders/generated.ts';

const BASE = process.env.PLAYGROUND ?? 'http://localhost:3200';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
// Any page of the playground: WebGPU needs a secure context.
await page.goto(`${BASE}/lab/composite`);
let failures = 0;
const variants = [
  ['video (external texture)', externalVariant(SHADERS.composite.wgsl2d)],
  ['image (texture_2d)', SHADERS.composite.wgsl2d],
] as const;
for (const [name, code] of variants) {
  const messages = await page.evaluate(async (source) => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return ['error no WebGPU adapter'];
    const device = await adapter.requestDevice();
    const module = device.createShaderModule({ code: source });
    const info = await module.getCompilationInfo();
    device.pushErrorScope('validation');
    device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'bgra8unorm' }] },
      primitive: { topology: 'triangle-strip' },
    });
    const error = await device.popErrorScope();
    return [
      ...info.messages.map((m) => `${m.type} ${m.lineNum}:${m.linePos} ${m.message}`),
      ...(error ? [`error pipeline: ${error.message}`] : []),
    ];
  }, code);
  const errors = messages.filter((m) => m.startsWith('error'));
  if (errors.length) failures++;
  console.log(
    `${errors.length ? '✗' : '✓'} ${name}${messages.length ? `\n  ${messages.join('\n  ')}` : ''}`,
  );
}
await browser.close();
process.exitCode = failures ? 1 : 0;
