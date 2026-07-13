const ZONE_PATTERN = [
  'R', 'R', 'C', 'R', 'I', 'R', 'C', 'R',
  'I', 'R', 'R', 'C', 'I', 'R', 'R', 'I',
];

/** Builds the deterministic mixed road-grid city shared by performance probes. */
export function setupPerformanceCity(sim) {
  sim.world.runMaintenance(() => sim.world.setState('treasury', 10_000_000));
  const submit = (name, data) => sim.world.submit(name, data);
  const x0 = 8;
  const x1 = 92;
  const y0 = 8;
  const y1 = 68;
  for (let y = y0; y <= y1; y += 4) {
    submit('placeRoad', { ax: x0, ay: y, bx: x1, by: y });
  }
  for (let x = x0; x <= x1; x += 12) {
    submit('placeRoad', { ax: x, ay: y0, bx: x, by: y1 });
  }
  sim.world.step();
  let patternIndex = 0;
  for (let y = y0; y < y1; y += 4) {
    submit('zone', {
      zone: ZONE_PATTERN[patternIndex % ZONE_PATTERN.length],
      ax: x0,
      ay: y + 1,
      bx: x1,
      by: y + 3,
    });
    patternIndex++;
  }
  sim.world.step();
}

export function cityCounts(sim) {
  return {
    tick: sim.world.tick,
    buildingCount: [...sim.world.query('building')].length,
    vehicles: [...sim.world.query('vehicle')].length,
    populationPeople: [...sim.world.query('citizen')].length * 3,
  };
}
