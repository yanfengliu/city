import { describe, expect, it } from 'vitest';
import {
  refreshShadowsAfterContextRestore,
  ShadowMapUpdatePolicy,
} from '../../src/rendering/shadow-update';

describe('ShadowMapUpdatePolicy', () => {
  it('reuses the shadow map until the sun has moved by the configured step', () => {
    const policy = new ShadowMapUpdatePolicy(0.1);

    expect(policy.consume(0.2, true)).toBe(true);
    expect(policy.consume(0.2, true)).toBe(false);
    expect(policy.consume(0.299, true)).toBe(false);
    expect(policy.consume(0.3, true)).toBe(true);
  });

  it('measures sun movement across the wrapped day boundary', () => {
    const policy = new ShadowMapUpdatePolicy(0.05);

    expect(policy.consume(0.98, true)).toBe(true);
    expect(policy.consume(0.01, true)).toBe(false);
    expect(policy.consume(0.03, true)).toBe(true);
  });

  it('forces the next active update after caster geometry changes', () => {
    const policy = new ShadowMapUpdatePolicy(0.1);

    expect(policy.consume(0.4, true)).toBe(true);
    expect(policy.consume(0.4, true)).toBe(false);
    policy.invalidate();
    expect(policy.consume(0.4, true)).toBe(true);
  });

  it('retains invalidation while shadows are inactive', () => {
    const policy = new ShadowMapUpdatePolicy(0.1);

    expect(policy.consume(0.4, true)).toBe(true);
    policy.invalidate();
    expect(policy.consume(0.5, false)).toBe(false);
    expect(policy.consume(0.5, true)).toBe(true);
  });

  it('rebuilds cached shadow state after WebGL context restoration', () => {
    const target = new EventTarget();
    const policy = new ShadowMapUpdatePolicy(0.1);
    const shadowMap = { needsUpdate: false };
    expect(policy.consume(0.4, true)).toBe(true);
    expect(policy.consume(0.4, true)).toBe(false);
    refreshShadowsAfterContextRestore(target, policy, shadowMap);

    target.dispatchEvent(new Event('webglcontextrestored'));

    expect(shadowMap.needsUpdate).toBe(true);
    expect(policy.consume(0.4, true)).toBe(true);
  });
});
