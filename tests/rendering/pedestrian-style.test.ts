import { describe, expect, it } from 'vitest';
import {
  PEDESTRIAN_BOTTOM_COLORS,
  PEDESTRIAN_PURPOSE_TOP_PALETTES,
  PEDESTRIAN_SKIN_COLORS,
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
});
