// Smoke test: the engine worker shipped inside @video-ultra/core loads and plays in a Vite app.
import { createLabSession } from '@video-ultra/core/internal';

const status = document.getElementById('status')!;
const canvas = document.getElementById('stage') as HTMLCanvasElement;

try {
  const session = await createLabSession(canvas, 'auto');
  const blob = await (await fetch('/media/avc-720p30.mp4')).blob();
  await session.load(new File([blob], 'avc-720p30.mp4'));
  const result = await session.play(2);
  status.textContent = `OK renderer=${session.backend} presented=${result.presented} dropped=${result.dropped}`;
} catch (error) {
  status.textContent = `FAIL ${String(error)}`;
}
