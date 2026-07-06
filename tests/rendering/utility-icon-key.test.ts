import { describe, expect, it } from 'vitest';
import { utilityIconKey } from '../../src/rendering/utility-icon-key';

const v = (powered: boolean, watered: boolean, abandoned = false) => ({ powered, watered, abandoned });

describe('utilityIconKey', () => {
  it('shows no icon for a fully served live building', () => {
    expect(utilityIconKey(v(true, true))).toBeNull();
  });

  it('shows ⚡ when unpowered, 💧 when unwatered, both when both', () => {
    expect(utilityIconKey(v(false, true))).toBe('⚡');
    expect(utilityIconKey(v(true, false))).toBe('💧');
    expect(utilityIconKey(v(false, false))).toBe('⚡💧');
  });

  it('shows nothing over an abandoned building, even one lacking utilities', () => {
    expect(utilityIconKey(v(false, false, true))).toBeNull();
    expect(utilityIconKey(v(true, true, true))).toBeNull();
  });
});
