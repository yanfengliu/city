import { describe, expect, it } from 'vitest';
import {
  SIGNAL_CLEARANCE_TICKS,
  SIGNAL_CYCLE_TICKS,
  SIGNAL_GREEN_TICKS,
  signalPhase,
} from '../../src/protocol/signal-phase';

describe('signalPhase', () => {
  it('is a pure function of tick and node', () => {
    for (const node of [0, 137, 8191]) {
      for (let tick = 0; tick < SIGNAL_CYCLE_TICKS * 2; tick += 7) {
        expect(signalPhase(tick, node)).toBe(signalPhase(tick, node));
      }
    }
  });

  it('gives each axis one full green per cycle, separated by all-red clearance', () => {
    const node = 4321;
    const counts = { ns: 0, ew: 0, 'all-red': 0 };
    for (let tick = 0; tick < SIGNAL_CYCLE_TICKS; tick++) {
      counts[signalPhase(tick, node)]++;
    }
    expect(counts.ns).toBe(SIGNAL_GREEN_TICKS);
    expect(counts.ew).toBe(SIGNAL_GREEN_TICKS);
    expect(counts['all-red']).toBe(2 * SIGNAL_CLEARANCE_TICKS);
  });

  it('never shows green to both axes at once and repeats every cycle', () => {
    const node = 99;
    for (let tick = 0; tick < SIGNAL_CYCLE_TICKS; tick++) {
      const phase = signalPhase(tick, node);
      expect(['ns', 'ew', 'all-red']).toContain(phase);
      expect(signalPhase(tick + SIGNAL_CYCLE_TICKS, node)).toBe(phase);
      expect(signalPhase(tick + 7 * SIGNAL_CYCLE_TICKS, node)).toBe(phase);
    }
  });

  it('staggers cycles across distinct junctions', () => {
    const phasesAtTickZero = new Set<string>();
    for (let node = 0; node < 64; node++) {
      phasesAtTickZero.add(signalPhase(0, node * 131 + 17));
    }
    expect(phasesAtTickZero.size).toBeGreaterThan(1);
  });
});
