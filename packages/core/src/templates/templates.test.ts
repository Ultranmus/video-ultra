import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../model/invariants';
import { sequentialIds } from '../model/project';
import { ANIMATION_PRESETS, FONT_PRESETS } from '../effects/presets';
import { fromSeconds } from '../model/time';
import { fixtureProject } from '../test/fixtures';
import { ItemSchema } from '../model/schema';
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_PRESETS,
  applyTemplate,
  fillTemplateText,
  templatePreset,
} from './templates';

describe('templates', () => {
  it('has a big library: 150+ templates with unique ids in every category', () => {
    expect(TEMPLATE_PRESETS.length).toBeGreaterThanOrEqual(150);
    expect(new Set(TEMPLATE_PRESETS.map((t) => t.id)).size).toBe(TEMPLATE_PRESETS.length);
    for (const c of TEMPLATE_CATEGORIES)
      expect(TEMPLATE_PRESETS.filter((t) => t.category === c).length, c).toBeGreaterThanOrEqual(12);
  });

  it('uses only real animations and fonts, fits its own length, and every variable is used', () => {
    const anims = new Set(ANIMATION_PRESETS.map((a) => a.id));
    const fonts = new Set(FONT_PRESETS.map((f) => f.family));
    for (const t of TEMPLATE_PRESETS) {
      for (const el of t.elements) {
        for (const a of [el.in, el.out, el.loop])
          if (a) expect(anims.has(a), `${t.id} ${a}`).toBe(true);
        if (el.style?.fontFamily) expect(fonts.has(el.style.fontFamily), t.id).toBe(true);
        expect(el.start + el.duration, t.id).toBeLessThanOrEqual(t.duration + 1e-9);
        expect(el.x, t.id).toBeGreaterThan(0);
        expect(el.x, t.id).toBeLessThan(1);
        expect(el.y, t.id).toBeGreaterThan(0);
        expect(el.y, t.id).toBeLessThan(1);
      }
      const text = t.elements.map((e) => e.content).join(' ');
      for (const variable of t.variables) expect(text, t.id).toContain(`{${variable.key}}`);
    }
  });

  it('fills variables, falling back to the examples', () => {
    const t = templatePreset('name-role-clean')!;
    expect(fillTemplateText('{name} · {role}', t, { name: 'Jo' })).toBe('Jo · Product designer');
    expect(fillTemplateText('{unknown}', t)).toBe('{unknown}');
  });

  it('adds valid, grouped lane items at the playhead; empty texts are skipped', () => {
    const ids = sequentialIds('n');
    for (const t of TEMPLATE_PRESETS) {
      const project = fixtureProject();
      const made = applyTemplate(project, t, {}, fromSeconds(2), ids);
      expect(made.length, t.id).toBe(t.elements.length);
      const items = project.tracks.flatMap((tr) => tr.items);
      for (const id of made) {
        const item = items.find((i) => i.id === id)!;
        expect(ItemSchema.safeParse(item).success, t.id).toBe(true);
        expect(item.start).toBeGreaterThanOrEqual(fromSeconds(2));
      }
      if (made.length > 1)
        expect(new Set(made.map((id) => items.find((i) => i.id === id)!.groupId)).size).toBe(1);
      expect(checkInvariants(project), t.id).toEqual([]);
    }
    const project = fixtureProject();
    const t = templatePreset('name-role-bold')!;
    expect(applyTemplate(project, t, { name: ' ', role: 'Host' }, 0, ids)).toHaveLength(1);
  });
});
