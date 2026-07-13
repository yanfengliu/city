// Bare 'fs' on purpose: vite.config.ts aliases 'node:fs' to the browser shim.
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const sceneSource = readFileSync('src/rendering/scene.ts', 'utf8');
const gameSource = readFileSync('src/app/game.ts', 'utf8');

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from, `missing start marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(to, `missing end marker: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe('shadow-cache integration wiring', () => {
  it('disables per-frame maps but preserves explicit initial and lifecycle refreshes', () => {
    expect(sceneSource).toContain('this.renderer.shadowMap.autoUpdate = false');
    expect(sceneSource).toContain('this.renderer.shadowMap.needsUpdate = true');
    expect(sceneSource).toContain('refreshShadowsAfterContextRestore(');
    expect(sceneSource).toContain('this.shadowUpdates.consume(fraction, castShadow)');
  });

  it('invalidates for changing and removed building/structure casters', () => {
    expect(between(gameSource, 'private applyBuildingUpsert', 'private applyBuildingRemoval'))
      .toContain('this.scene.invalidateShadows()');
    expect(between(gameSource, 'private applyBuildingRemoval', 'private applyStructureUpsert'))
      .toContain('this.occupancyDirty = true');
    expect(between(gameSource, 'private applyStructureUpsert', 'private applyStructureRemoval'))
      .toContain('this.scene.invalidateShadows()');
    expect(between(gameSource, 'private applyStructureRemoval', 'private flushDirtyViews'))
      .toContain('this.occupancyDirty = true');
  });

  it('funnels road, bridge, tree, and utility-caster occupancy through one refresh', () => {
    expect(between(gameSource, "case 'roads':", "case 'zones':"))
      .toContain('this.occupancyDirty = true');
    expect(between(gameSource, "case 'networks':", "case 'vehicles':"))
      .toContain('this.occupancyDirty = true');
    const flush = between(gameSource, 'private flushDirtyViews', 'private inspectCell');
    expect(flush).toContain('this.treesView?.updateOccupied(occupied)');
    expect(flush).toContain('this.scene.invalidateShadows()');
  });
});
