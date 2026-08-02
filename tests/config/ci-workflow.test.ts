import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8').replaceAll('\r\n', '\n');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies: Record<string, string>;
};
const CHECKOUT_ACTION =
  'actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2';
const SETUP_NODE_ACTION =
  'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0';

function step(name: string): string {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  if (start < 0) throw new Error(`CI workflow is missing the "${name}" step`);
  const end = workflow.indexOf('\n      - ', start + marker.length);
  return workflow.slice(start, end < 0 ? undefined : end);
}

function stepIndex(name: string): number {
  return workflow.indexOf(`      - name: ${name}\n`);
}

function expectStepBefore(left: string, right: string): void {
  expect(stepIndex(left), `${left} must run before ${right}`).toBeLessThan(stepIndex(right));
}

function expectStepLines(name: string, expected: string[]): void {
  const lines = step(name).split('\n').map((line) => line.trim()).filter(Boolean);
  expect(lines).toEqual(expect.arrayContaining(expected));
}

describe('CI workflow contracts', () => {
  it('pins the action runtime and follows the repository Node baseline', () => {
    expect(readFileSync('.nvmrc', 'utf8').trim()).toBe('24');
    expect(workflow.match(/^[ \t]*permissions:/gm)).toEqual(['permissions:']);
    expect(workflow).toContain('permissions:\n  contents: read\n\njobs:');
    for (const name of [
      'Checkout city',
      'Checkout civ-engine (sibling)',
      'Checkout voxel (sibling)',
    ]) {
      expectStepLines(name, [
        `uses: ${CHECKOUT_ACTION}`,
        'persist-credentials: false',
      ]);
    }
    expectStepLines('Checkout city', ['path: city']);
    expectStepLines('Setup Node 24', [
      `uses: ${SETUP_NODE_ACTION}`,
      'node-version-file: city/.nvmrc',
    ]);
    const actionRefs = [...workflow.matchAll(/^[ \t]+uses:\s+([^#\s]+)/gm)]
      .map((match) => match[1]);
    expect(actionRefs.length).toBeGreaterThan(0);
    for (const ref of actionRefs) expect(ref).toMatch(/^[^@\s]+@[a-f0-9]{40}$/);
  });

  it('checks out and builds every local file dependency before city installs', () => {
    expect(Object.entries(packageJson.dependencies)
      .filter(([, value]) => value.startsWith('file:../'))
      .sort(([left], [right]) => left.localeCompare(right)))
      .toEqual([
        ['civ-engine', 'file:../civ-engine'],
        ['voxel', 'file:../voxel'],
      ]);
    expectStepLines('Checkout civ-engine (sibling)', [
      'repository: yanfengliu/civ-engine',
      'ref: main',
      'path: civ-engine',
    ]);
    expectStepLines('Checkout voxel (sibling)', [
      'repository: yanfengliu/voxel',
      'ref: main',
      'path: voxel',
    ]);
    expectStepLines('Install civ-engine dependencies', [
      'working-directory: civ-engine',
      'run: npm ci',
    ]);
    expectStepLines('Build civ-engine dist', [
      'working-directory: civ-engine',
      'run: npm run build',
    ]);
    expectStepLines('Install voxel dependencies', [
      'working-directory: voxel',
      'run: npm ci',
    ]);
    expectStepLines('Build voxel dist', [
      'working-directory: voxel',
      'run: npm run build',
    ]);
    expectStepLines('Install city dependencies', [
      'working-directory: city',
      'run: npm ci',
    ]);
    for (const checkout of [
      'Checkout city',
      'Checkout civ-engine (sibling)',
      'Checkout voxel (sibling)',
    ]) {
      expectStepBefore(checkout, 'Setup Node 24');
    }
    expectStepBefore('Setup Node 24', 'Install civ-engine dependencies');
    expectStepBefore('Install civ-engine dependencies', 'Build civ-engine dist');
    expectStepBefore('Build civ-engine dist', 'Install city dependencies');
    expectStepBefore('Setup Node 24', 'Install voxel dependencies');
    expectStepBefore('Install voxel dependencies', 'Build voxel dist');
    expectStepBefore('Build voxel dist', 'Install city dependencies');
  });
});
