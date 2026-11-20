import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../model/invariants';
import { findItem, sequentialIds } from '../model/project';
import {
  fixtureProject,
  imageItem,
  regionItem,
  stickerItem,
  textItem,
  videoItem,
} from '../test/fixtures';
import {
  EditError,
  addToLane,
  deleteLut,
  duplicateItem,
  insertMain,
  removeAsset,
  renameAsset,
  splitItem,
  updateItem,
} from './ops';
import { fromSeconds as s } from '../model/time';

/** v0.2 C — green screen, LUT looks, blend modes, blurred areas. */
describe('picture tools', () => {
  const setup = () => {
    const p = fixtureProject();
    const ids = sequentialIds('n');
    insertMain(p, videoItem('a', 'vidA', 5));
    addToLane(p, { ...imageItem('pip', 2), start: s(1) }, ids);
    addToLane(p, textItem('t', 0), ids);
    addToLane(p, stickerItem('st', 0), ids);
    addToLane(p, regionItem('r', 0), ids);
    return { p, ids };
  };
  const item = (p: ReturnType<typeof setup>['p'], id: string) => findItem(p, id)!.item;

  it('a blurred area lives on a picture layer', () => {
    const { p } = setup();
    expect(findItem(p, 'r')!.track.kind).toBe('overlay');
    expect(checkInvariants(p)).toEqual([]);
    expect(() => insertMain(p, regionItem('r2', 0))).toThrow(EditError);
  });

  it('sets, clamps and turns off the green screen', () => {
    const { p } = setup();
    updateItem(p, 'a', { key: { color: '#00b140', tolerance: 3, softness: -1, spill: 0.5 } });
    const a = item(p, 'a');
    expect('key' in a && a.key).toEqual({
      color: '#00b140',
      tolerance: 1,
      softness: 0,
      spill: 0.5,
    });
    updateItem(p, 'a', { key: null });
    expect('key' in item(p, 'a')).toBe(false);
    expect(() =>
      updateItem(p, 't', { key: { color: '#0f0', tolerance: 0.4, softness: 0.2, spill: 0 } }),
    ).toThrow(EditError);
  });

  it('a LUT look must point at a LUT file', () => {
    const { p } = setup();
    updateItem(p, 'pip', { lut: { assetId: 'look', intensity: 1.5 } });
    const pip = item(p, 'pip');
    expect('lut' in pip && pip.lut).toEqual({ assetId: 'look', intensity: 1 });
    expect(checkInvariants(p)).toEqual([]);
    expect(() => updateItem(p, 'pip', { lut: { assetId: 'img', intensity: 1 } })).toThrow(
      EditError,
    );
    expect(() => updateItem(p, 'pip', { lut: { assetId: 'nope', intensity: 1 } })).toThrow(
      EditError,
    );
    // Still used: the file can't be removed; once the look is gone it can.
    expect(() => removeAsset(p, 'look')).toThrow(EditError);
    updateItem(p, 'pip', { lut: null });
    removeAsset(p, 'look');
    expect(p.assets.look).toBeUndefined();
  });

  it('renames a LUT look; deleting it clears every item using it', () => {
    const { p } = setup();
    renameAsset(p, 'look', '  Warm film  ');
    expect(p.assets.look!.name).toBe('Warm film');
    renameAsset(p, 'look', '   ');
    expect(p.assets.look!.name).toBe('Warm film');
    expect(() => renameAsset(p, 'nope', 'x')).toThrow(EditError);
    updateItem(p, 'pip', { lut: { assetId: 'look', intensity: 0.5 } });
    updateItem(p, 'a', { lut: { assetId: 'look', intensity: 1 } });
    expect(() => deleteLut(p, 'img')).toThrow(EditError);
    expect(deleteLut(p, 'look')).toBe(2);
    expect(p.assets.look).toBeUndefined();
    expect('lut' in item(p, 'pip')).toBe(false);
    expect('lut' in item(p, 'a')).toBe(false);
    expect(checkInvariants(p)).toEqual([]);
  });

  it('a text takes a wrap width (clamped); null removes it', () => {
    const { p } = setup();
    updateItem(p, 't', { maxWidth: 0.6 });
    const t = () => item(p, 't') as Extract<ReturnType<typeof item>, { kind: 'text' }>;
    expect(t().maxWidth).toBe(0.6);
    updateItem(p, 't', { maxWidth: 3 });
    expect(t().maxWidth).toBe(1);
    updateItem(p, 't', { maxWidth: 0 });
    expect(t().maxWidth).toBe(0.05);
    expect(checkInvariants(p)).toEqual([]);
    updateItem(p, 't', { maxWidth: null });
    expect('maxWidth' in t()).toBe(false);
    expect(() => updateItem(p, 'st', { maxWidth: 0.5 })).toThrow(EditError);
  });

  it('blend modes on lane pictures, text and stickers; normal removes the field', () => {
    const { p } = setup();
    for (const id of ['pip', 't', 'st']) {
      updateItem(p, id, { blend: 'multiply' });
      expect((item(p, id) as { blend?: string }).blend).toBe('multiply');
      updateItem(p, id, { blend: 'normal' });
      expect('blend' in item(p, id)).toBe(false);
    }
    expect(() => updateItem(p, 'r', { blend: 'screen' })).toThrow(EditError);
  });

  it("a blurred area's settings: effect, shape, amount, size (clamped)", () => {
    const { p } = setup();
    updateItem(p, 'r', { effect: 'pixelate', shape: 'ellipse', amount: 2, width: 0, height: 9 });
    const r = item(p, 'r');
    expect(r.kind === 'region' && [r.effect, r.shape, r.amount, r.width, r.height]).toEqual([
      'pixelate',
      'ellipse',
      1,
      0.01,
      4,
    ]);
    expect(() => updateItem(p, 'r', { filter: { id: 'warm', intensity: 1 } })).toThrow(EditError);
  });

  it('split and duplicate keep the picture tools on both parts', () => {
    const { p, ids } = setup();
    updateItem(p, 'a', { key: { color: '#00ff00', tolerance: 0.3, softness: 0.2, spill: 0.4 } });
    updateItem(p, 'r', { effect: 'pixelate' });
    const second = splitItem(p, 'a', s(2), ids);
    expect('key' in item(p, second) && item(p, second)).toMatchObject({
      key: { color: '#00ff00' },
    });
    const copy = duplicateItem(p, 'r', ids);
    expect(item(p, copy)).toMatchObject({ kind: 'region', effect: 'pixelate' });
    expect(checkInvariants(p)).toEqual([]);
  });
});
