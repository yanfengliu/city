import { describe, expect, it } from 'vitest';
import type { LineLoop } from 'three';
import type { CitizenDetail, CitizenPlace } from '../../src/protocol/messages';
import { CitizenLifeMarkers } from '../../src/rendering/citizen-life-markers';
import { FLAT_TERRAIN_SURFACE } from '../../src/rendering/terrain-surface';

const place = (entity: number, x: number, y: number): CitizenPlace => ({
  entity,
  generation: 1,
  x,
  y,
  cell: y * 128 + x,
  zone: 'R',
  level: 1,
  abandoned: false,
  w: 2,
  h: 2,
});

function detail(): CitizenDetail {
  return {
    home: place(1, 10, 12),
    work: { ...place(2, 30, 32), zone: 'C' },
    destination: { ...place(3, 40, 42), zone: 'C' },
    activityPlace: null,
  } as CitizenDetail;
}

describe('CitizenLifeMarkers', () => {
  it('shows distinct home, work, and destination evidence from citizen detail', () => {
    const markers = new CitizenLifeMarkers();
    markers.setTerrainSurface(FLAT_TERRAIN_SURFACE);
    markers.show(detail());

    expect(markers.group.visible).toBe(true);
    expect(markers.group.getObjectByName('citizen-home-marker')?.visible).toBe(true);
    expect(markers.group.getObjectByName('citizen-work-marker')?.visible).toBe(true);
    const destination = markers.group.getObjectByName('citizen-destination-marker');
    expect(destination?.visible).toBe(true);
    expect(destination?.position.x).toBe(41);
    expect(destination?.position.z).toBe(43);
  });

  it('hides absent anchors and clears all evidence when inspection closes', () => {
    const markers = new CitizenLifeMarkers();
    markers.show({ ...detail(), work: null, destination: null });
    expect(markers.group.getObjectByName('citizen-home-marker')?.visible).toBe(true);
    expect(markers.group.getObjectByName('citizen-work-marker')?.visible).toBe(false);

    markers.hide();
    expect(markers.group.visible).toBe(false);
  });

  it('marks a garden outing even though leisure services are not building destinations', () => {
    const markers = new CitizenLifeMarkers();
    const garden = {
      entity: 9,
      generation: 2,
      x: 50,
      y: 60,
      w: 2,
      h: 2,
      kind: 'service' as const,
      label: 'Community Garden',
    };
    markers.show({
      ...detail(),
      destination: null,
      destinationPlace: garden,
      activityPlace: garden,
    });

    const activity = markers.group.getObjectByName('citizen-destination-marker');
    expect(activity?.visible).toBe(true);
    expect(activity?.position.x).toBe(51);
    expect(activity?.position.z).toBe(61);
  });

  it('marks the live destination rather than the venue being left on a return leg', () => {
    const markers = new CitizenLifeMarkers();
    markers.show({
      ...detail(),
      destination: null,
      destinationPlace: {
        entity: 1,
        generation: 1,
        x: 10,
        y: 12,
        w: 2,
        h: 2,
        kind: 'building',
        label: 'Residential building',
      },
      activityPlace: {
        entity: 9,
        generation: 2,
        x: 50,
        y: 60,
        w: 2,
        h: 2,
        kind: 'service',
        label: 'Park at (50, 60)',
      },
    });

    const destination = markers.group.getObjectByName('citizen-destination-marker');
    expect(destination?.position.x).toBe(11);
    expect(destination?.position.z).toBe(13);
  });

  it('reuses unchanged home and work outline geometry across live refreshes', () => {
    const markers = new CitizenLifeMarkers();
    const first = detail();
    markers.show(first);
    const home = markers.group.getObjectByName('citizen-home-marker') as LineLoop;
    const work = markers.group.getObjectByName('citizen-work-marker') as LineLoop;
    const homeGeometry = home.geometry;
    const workGeometry = work.geometry;

    markers.show({
      ...first,
      home: { ...first.home!, abandoned: true, level: 2 },
      work: { ...first.work!, abandoned: true, level: 3 },
    });

    expect(home.geometry).toBe(homeGeometry);
    expect(work.geometry).toBe(workGeometry);

    markers.show({ ...first, home: { ...first.home!, x: first.home!.x + 1 } });
    expect(home.geometry).not.toBe(homeGeometry);
  });
});
