import { describe, expect, it } from 'vitest';
import { Color, type InstancedMesh } from 'three';
import {
  SIGNAL_CYCLE_TICKS,
  SIGNAL_GREEN_TICKS,
  signalPhase,
} from '../../src/protocol/signal-phase';
import type { SignalLensDescriptor } from '../../src/rendering/road-streetscape';
import {
  TRAFFIC_SIGNAL_ACTIVE_GREEN,
  TRAFFIC_SIGNAL_ACTIVE_RED,
  TRAFFIC_SIGNAL_INACTIVE_GREEN,
  TRAFFIC_SIGNAL_INACTIVE_RED,
} from '../../src/rendering/road-streetscape-style';
import { SignalLensesView } from '../../src/rendering/signal-lenses';

const NODE = 31;

function headOn(axis: 'ns' | 'ew'): SignalLensDescriptor[] {
  const arm = axis === 'ew' ? 'w' : 'n';
  return [0, 1, 2].map((slot) => ({
    node: NODE,
    axis,
    slot,
    x: 1,
    y: 1 + slot * 0.1,
    z: 3,
    arm,
  }));
}

function colorOf(view: SignalLensesView, slot: number): number {
  const mesh = view.group.getObjectByName('traffic-signal-lens-instances') as InstancedMesh;
  const color = new Color();
  mesh.getColorAt(slot, color);
  return color.getHex();
}

function tickWithPhase(phase: 'ns' | 'ew' | 'all-red'): number {
  for (let tick = 0; tick < SIGNAL_CYCLE_TICKS; tick++) {
    if (signalPhase(tick, NODE) === phase) return tick;
  }
  throw new Error(`no tick with phase ${phase} in one cycle`);
}

describe('SignalLensesView', () => {
  it('lights green heads on their axis phase and red heads across it', () => {
    const view = new SignalLensesView();
    view.setLenses([...headOn('ew'), ...headOn('ns')]);
    expect(view.count).toBe(6);

    view.updateTick(tickWithPhase('ew'));
    // East-west head: red dark, green lit.
    expect(colorOf(view, 0)).toBe(new Color(TRAFFIC_SIGNAL_INACTIVE_RED).getHex());
    expect(colorOf(view, 2)).toBe(new Color(TRAFFIC_SIGNAL_ACTIVE_GREEN).getHex());
    // North-south head: red lit, green dark.
    expect(colorOf(view, 3)).toBe(new Color(TRAFFIC_SIGNAL_ACTIVE_RED).getHex());
    expect(colorOf(view, 5)).toBe(new Color(TRAFFIC_SIGNAL_INACTIVE_GREEN).getHex());
  });

  it('shows red to both axes during the all-red clearance', () => {
    const view = new SignalLensesView();
    view.setLenses([...headOn('ew'), ...headOn('ns')]);
    view.updateTick(tickWithPhase('all-red'));
    expect(colorOf(view, 0)).toBe(new Color(TRAFFIC_SIGNAL_ACTIVE_RED).getHex());
    expect(colorOf(view, 3)).toBe(new Color(TRAFFIC_SIGNAL_ACTIVE_RED).getHex());
  });

  it('swaps lights when the cycle rolls to the cross axis', () => {
    const view = new SignalLensesView();
    view.setLenses(headOn('ew'));
    const ewGreen = tickWithPhase('ew');
    view.updateTick(ewGreen);
    expect(colorOf(view, 2)).toBe(new Color(TRAFFIC_SIGNAL_ACTIVE_GREEN).getHex());

    view.updateTick(ewGreen + SIGNAL_GREEN_TICKS + SIGNAL_CYCLE_TICKS);
    // Same phase one full cycle later plus a green-length: whatever the phase
    // now is, the lens colors must match the shared phase function exactly.
    const phase = signalPhase(ewGreen + SIGNAL_GREEN_TICKS + SIGNAL_CYCLE_TICKS, NODE);
    const expectedGreen = phase === 'ew' ? TRAFFIC_SIGNAL_ACTIVE_GREEN : TRAFFIC_SIGNAL_INACTIVE_GREEN;
    expect(colorOf(view, 2)).toBe(new Color(expectedGreen).getHex());
  });

  it('clears its instances when the road network loses all junctions', () => {
    const view = new SignalLensesView();
    view.setLenses(headOn('ew'));
    expect(view.count).toBe(3);
    view.setLenses([]);
    expect(view.count).toBe(0);
    expect(view.group.getObjectByName('traffic-signal-lens-instances')).toBeUndefined();
  });
});
