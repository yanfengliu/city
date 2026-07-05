import { describe, expect, it } from 'vitest';
import { activeTips, type TipContext } from '../../src/app/tips';

/** A city that is founded, zoned, grown, and fully powered+watered — the point
 * where the guided progression should hand off to the services/level-up lesson. */
const base: TipContext = {
  playerRoadCells: 8,
  connectedToHighway: true,
  zonedCells: 20,
  buildings: 6,
  hasPlant: true,
  hasPump: true,
  unpowered: 0,
  unwatered: 0,
  structureCount: 0,
  hasSchool: false,
};

const ids = (ctx: TipContext): string[] => activeTips(ctx).map((t) => t.id);

describe('guided tips progression', () => {
  it('shows only the founding tip until the city links to the highway', () => {
    expect(ids({ ...base, connectedToHighway: false })).toEqual(['firstRoad']);
  });

  it('shows the zoning tip once connected with no buildings', () => {
    expect(ids({ ...base, buildings: 0 })).toContain('firstZones');
  });

  it('shows power/water tips while those utilities are missing', () => {
    expect(ids({ ...base, hasPlant: false })).toContain('power');
    expect(ids({ ...base, hasPump: false })).toContain('water');
  });

  it('teaches services once powered+watered, and drops the tip when a school lands', () => {
    // Newly stable city, no services yet → the level-up lesson appears.
    expect(ids(base)).toContain('services');
    // A non-school service satisfies step 1 but the tip stays for step 2.
    expect(ids({ ...base, structureCount: 1 })).toContain('services');
    // A school satisfies both steps → the tip drops.
    expect(ids({ ...base, structureCount: 2, hasSchool: true })).not.toContain('services');
  });

  it('does not surface the services tip while power/water are still unresolved', () => {
    expect(ids({ ...base, unpowered: 3 })).not.toContain('services');
    expect(ids({ ...base, hasPump: false })).not.toContain('services');
  });
});
