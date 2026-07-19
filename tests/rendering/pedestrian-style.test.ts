import { describe, expect, it } from 'vitest';
import {
  PEDESTRIAN_BOTTOM_COLORS,
  PEDESTRIAN_PURPOSE_TOP_PALETTES,
  PEDESTRIAN_SKIN_COLORS,
  identityDraw,
  pedestrianIdentitySeed,
  pedestrianStyle,
} from '../../src/rendering/pedestrian-style';

describe('pedestrianStyle', () => {
  it('creates broad deterministic clothing and body variation', () => {
    const styles = Array.from({ length: 64 }, (_, id) =>
      pedestrianStyle(id, 0, 'commercial-work'),
    );
    const signatures = new Set(styles.map((style) => JSON.stringify(style)));

    expect(signatures.size).toBeGreaterThanOrEqual(56);
    for (const style of styles) {
      expect(PEDESTRIAN_PURPOSE_TOP_PALETTES['commercial-work']).toContain(style.topColor);
      expect(PEDESTRIAN_BOTTOM_COLORS).toContain(style.bottomColor);
      expect(PEDESTRIAN_SKIN_COLORS).toContain(style.skinColor);
      expect(style.widthScale).toBeGreaterThanOrEqual(0.9);
      expect(style.widthScale).toBeLessThanOrEqual(1.1);
      expect(style.heightScale).toBeGreaterThanOrEqual(0.92);
      expect(style.heightScale).toBeLessThanOrEqual(1.08);
    }
  });

  it('keeps identity axes stable while purpose selects the top family', () => {
    const commercial = pedestrianStyle(7, 3, 'commercial-work');
    const industrial = pedestrianStyle(7, 3, 'industrial-work');
    const shopping = pedestrianStyle(7, 3, 'shopping');

    expect(PEDESTRIAN_PURPOSE_TOP_PALETTES['commercial-work']).toContain(commercial.topColor);
    expect(PEDESTRIAN_PURPOSE_TOP_PALETTES['industrial-work']).toContain(industrial.topColor);
    expect(PEDESTRIAN_PURPOSE_TOP_PALETTES.shopping).toContain(shopping.topColor);
    expect(pedestrianStyle(7, 3, 'commercial-work')).toEqual(commercial);
    expect(industrial).toMatchObject({
      bottomColor: commercial.bottomColor,
      skinColor: commercial.skinColor,
      widthScale: commercial.widthScale,
      heightScale: commercial.heightScale,
    });
    expect(shopping).toMatchObject({
      bottomColor: commercial.bottomColor,
      skinColor: commercial.skinColor,
      widthScale: commercial.widthScale,
      heightScale: commercial.heightScale,
    });
    expect(pedestrianStyle(7, 4, 'commercial-work')).not.toEqual(commercial);
  });

  it('gives arms a sleeve or a bare-skin colour, both drawn from the identity', () => {
    const styles = Array.from({ length: 64 }, (_, id) =>
      pedestrianStyle(id, 0, 'industrial-work'),
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
    const seed = pedestrianIdentitySeed(21, 5);
    const salts = Array.from({ length: 32 }, (_, i) => 0x9e3779b1 ^ (i * 0x2545f491));
    const draws = salts.map((salt) => identityDraw(seed, salt));

    expect(pedestrianIdentitySeed(21, 5)).toBe(seed);
    expect(pedestrianIdentitySeed(21, 6)).not.toBe(seed);
    expect(new Set(draws).size).toBe(draws.length);
    for (const draw of draws) {
      expect(draw).toBeGreaterThanOrEqual(0);
      expect(draw).toBeLessThan(1);
    }
  });
});
