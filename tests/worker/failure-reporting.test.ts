import { describe, expect, it } from 'vitest';
import type { TickFailure } from 'civ-engine';
import {
  simFailureMessage,
  unknownCommandRejection,
} from '../../src/worker/failure-reporting';

const KNOWN = new Set(['placeRoad', 'zone', 'placeService']);
const hasHandler = (name: string): boolean => KNOWN.has(name);

describe('unknownCommandRejection', () => {
  it('passes a command the sim can actually execute', () => {
    expect(unknownCommandRejection('placeRoad', hasHandler)).toBeNull();
  });

  it('refuses an unknown name instead of queueing it', () => {
    // Regression: an unregistered name was answered "Queued command" and then
    // killed the whole simulation on the next drain (browser-reproduced).
    const reason = unknownCommandRejection('notARealCommand', hasHandler);
    expect(reason).not.toBeNull();
    expect(reason).toContain('notARealCommand');
    expect(reason).toMatch(/unknown command/i);
  });

  it('names a near miss so a typo is obvious', () => {
    const reason = unknownCommandRejection('placeroad', hasHandler, [...KNOWN]);
    expect(reason).toContain('placeRoad');
    expect(reason).toMatch(/did you mean/i);
  });

  it('offers no guess when nothing is close', () => {
    const reason = unknownCommandRejection('xyzzy', hasHandler, [...KNOWN]);
    expect(reason).not.toMatch(/did you mean/i);
  });
});

function failure(overrides: Partial<TickFailure> = {}): TickFailure {
  return {
    schemaVersion: 1,
    tick: 4210,
    phase: 'command',
    code: 'handler_threw',
    message: 'no handler registered',
    subsystem: 'commands',
    commandType: 'notARealCommand',
    submissionSequence: 7,
    systemName: null,
    details: null,
    error: { code: 'E_HANDLER', message: 'boom', details: null },
    ...overrides,
  } as unknown as TickFailure;
}

describe('simFailureMessage', () => {
  it('says the sim stopped, when, and what caused it', () => {
    const text = simFailureMessage(failure());
    expect(text).toMatch(/simulation/i);
    expect(text).toContain('4210');
    expect(text).toContain('notARealCommand');
  });

  it('falls back to the system name when no command is implicated', () => {
    const text = simFailureMessage(
      failure({ commandType: null, systemName: 'trafficSystem', phase: 'systems' }),
    );
    expect(text).toContain('trafficSystem');
  });

  it('never returns an empty or bare message', () => {
    const text = simFailureMessage(
      failure({ commandType: null, systemName: null, message: '' }),
    );
    expect(text.length).toBeGreaterThan(20);
    expect(text).toMatch(/simulation/i);
  });
});
