import { describe, expect, it } from 'vitest';
import { QualityGovernor } from './quality';

describe('QualityGovernor', () => {
  it('steps down after repeated late frames, never below 50%', () => {
    const q = new QualityGovernor();
    let t = 0;
    for (let i = 0; i < 4; i++) q.frame(true, (t += 33));
    expect(q.factor).toBe(0.75);
    for (let i = 0; i < 4; i++) q.frame(true, (t += 33));
    expect(q.factor).toBe(0.5);
    for (let i = 0; i < 20; i++) q.frame(true, (t += 33));
    expect(q.factor).toBe(0.5);
  });

  it('ignores occasional late frames', () => {
    const q = new QualityGovernor();
    for (let t = 0; t < 10_000; t += 33) q.frame(t % 2000 === 0, t);
    expect(q.factor).toBe(1);
  });

  it('climbs back one step after 5 calm seconds', () => {
    const q = new QualityGovernor();
    let t = 0;
    for (let i = 0; i < 8; i++) q.frame(true, (t += 33));
    expect(q.factor).toBe(0.5);
    for (let i = 0; i < 160; i++) q.frame(false, (t += 33)); // 5.3 s calm
    expect(q.factor).toBe(0.75);
    for (let i = 0; i < 160; i++) q.frame(false, (t += 33));
    expect(q.factor).toBe(1);
    expect(q.changes).toBe(4);
  });
});
