import { describe, expect, it } from 'vitest';
import {
  PEDESTRIAN_BOTTOM_COLORS,
  PEDESTRIAN_SKIN_COLORS,
  PEDESTRIAN_TOP_COLORS,
  identityDraw,
  pedestrianIdentitySeed,
  pedestrianStyle,
} from '../../src/rendering/pedestrian-style';

describe('pedestrianStyle', () => {
  it('creates broad deterministic clothing and body variation', () => {
    const styles = Array.from({ length: 64 }, (_, id) =>
      pedestrianStyle(id, 0, id % 3),
    );
    const signatures = new Set(styles.map((style) => JSON.stringify(style)));

    expect(signatures.size).toBeGreaterThanOrEqual(56);
    for (const style of styles) {
      expect(PEDESTRIAN_TOP_COLORS).toContain(style.topColor);
      expect(PEDESTRIAN_BOTTOM_COLORS).toContain(style.bottomColor);
      expect(PEDESTRIAN_SKIN_COLORS).toContain(style.skinColor);
      expect(style.widthScale).toBeGreaterThanOrEqual(0.9);
      expect(style.widthScale).toBeLessThanOrEqual(1.1);
      expect(style.heightScale).toBeGreaterThanOrEqual(0.92);
      expect(style.heightScale).toBeLessThanOrEqual(1.08);
    }
  });

  it('keys every appearance axis by household incarnation and member', () => {
    const member = pedestrianStyle(7, 3, 1);

    expect(pedestrianStyle(7, 3, 1)).toEqual(member);
    expect(pedestrianStyle(7, 4, 1)).not.toEqual(member);
    expect(pedestrianStyle(7, 3, 2)).not.toEqual(member);
    expect(pedestrianStyle(8, 3, 1)).not.toEqual(member);
  });

  it('gives arms a sleeve or a bare-skin colour, both drawn from the identity', () => {
    const styles = Array.from({ length: 64 }, (_, id) =>
      pedestrianStyle(id, 0, id % 3),
    );
    const sleeved = styles.filter((style) => style.sleeveColor === style.topColor);

    for (const style of styles) {
      expect([style.topColor, style.skinColor]).toContain(style.sleeveColor);
    }
    // Both readings appear on a crowd; neither is a rounding artefact.
    expect(sleeved.length).toBeGreaterThan(8);
    expect(styles.length - sleeved.length).toBeGreaterThan(8);
  });
});

describe('pedestrianIdentitySeed', () => {
  it('draws uncorrelated but repeatable axes for one identity', () => {
    const seed = pedestrianIdentitySeed(21, 5, 2);
    const salts = Array.from({ length: 32 }, (_, i) => 0x9e3779b1 ^ (i * 0x2545f491));
    const draws = salts.map((salt) => identityDraw(seed, salt));

    expect(pedestrianIdentitySeed(21, 5, 2)).toBe(seed);
    expect(pedestrianIdentitySeed(21, 6, 2)).not.toBe(seed);
    expect(pedestrianIdentitySeed(21, 5, 1)).not.toBe(seed);
    expect(new Set(draws).size).toBe(draws.length);
    for (const draw of draws) {
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
  });
});
