import { describe, expect, it } from 'vitest';
import { createProject } from '../model/project';
import type { Project } from '../model/schema';
import type { Renderer } from '../render/types';
import { Composer, isTransparentBackground, type MediaLibrary } from './compose';
import { exportKeepsTransparency, exportVideoCodecs } from './export-plan';
import { DecoderPool } from './frames';

/** A renderer that only records what each frame was cleared to. */
function recordingRenderer(): { renderer: Renderer; clears: unknown[] } {
  const clears: unknown[] = [];
  const renderer: Renderer = {
    backend: 'webgl2',
    resize() {},
    render(_layers, background = [0, 0, 0]) {
      clears.push(background === null ? null : [...background]);
    },
    createTarget: (width, height) => ({ width, height }),
    destroyTarget() {},
    draw() {},
    release() {},
    destroy() {},
  };
  return { renderer, clears };
}

const media: MediaLibrary = { videos: new Map(), images: new Map(), luts: new Map() };

function withBackground(color: string): Project {
  const p = createProject({ width: 64, height: 64 });
  p.settings.background = { type: 'color', color };
  return p;
}

describe('transparent background (DECISIONS #196)', () => {
  it('is recognised only for the transparent colour', () => {
    expect(isTransparentBackground(withBackground('transparent'))).toBe(true);
    expect(isTransparentBackground(withBackground('#000000'))).toBe(false);
  });

  it('only WebM keeps it see-through', () => {
    expect(exportKeepsTransparency(true, 'webm')).toBe(true);
    expect(exportKeepsTransparency(true, 'mp4')).toBe(false);
    expect(exportKeepsTransparency(false, 'webm')).toBe(false);
  });

  it('a see-through export is VP9 / VP8, whatever codec was asked', () => {
    expect(exportVideoCodecs('webm', 'auto', false, true)).toEqual(['vp9', 'vp8']);
    expect(exportVideoCodecs('webm', 'av1', false, true)).toEqual(['vp9', 'vp8']);
    expect(exportVideoCodecs('webm', 'auto', true, true)).toEqual(['vp8', 'vp9']);
    // Opaque exports are unchanged.
    expect(exportVideoCodecs('webm', 'av1', false)).toEqual(['av1']);
    expect(exportVideoCodecs('mp4', 'auto', false)).toEqual(['avc']);
    expect(exportVideoCodecs('mp4', 'hevc', false)).toEqual(['hevc']);
    expect(exportVideoCodecs('mp4', 'auto', false, true)).toEqual(['avc']);
    expect(exportVideoCodecs('webm', 'auto', true)).toEqual(['vp8', 'vp9']);
  });

  it('the composer clears to transparent only when asked to keep it', async () => {
    const { renderer, clears } = recordingRenderer();
    const composer = new Composer(renderer, new DecoderPool(1), media, true, 1 << 20, false);
    const clear = withBackground('transparent');
    await composer.render(clear, 0, 64, 64, null);
    composer.keepTransparency = true;
    await composer.render(clear, 0, 64, 64, null);
    await composer.render(withBackground('#ff0000'), 0, 64, 64, null);
    composer.destroy();
    expect(clears).toEqual([[0, 0, 0], null, [1, 0, 0]]);
  });
});
