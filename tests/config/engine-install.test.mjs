import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test } from 'vitest';

// Exercise the actual Node guard: City's Vite configuration intentionally shims
// node:path for browser code, which must not replace a CLI's filesystem checks.
const execute = promisify(execFile);
async function checkEngineInstall(root) {
  const { stdout } = await execute(process.execPath, ['--input-type=module', '-e',
    "import { checkEngineInstall } from './scripts/check-engine.mjs'; console.log(JSON.stringify(await checkEngineInstall(process.argv[1])));",
    root,
  ], { cwd: process.cwd(), windowsHide: true });
  return JSON.parse(stdout);
}

const roots = [];
const pin = {
  version: '2.8.1',
  url: 'https://github.com/yanfengliu/civ-engine/releases/download/engine-dist/civ-engine-6a8ae8fa4e65c8d49c933956592e1a088c32a78b.tgz',
  integrity: `sha512-${Buffer.alloc(64, 7).toString('base64')}`,
};
const json = (file, value) => writeFile(file, JSON.stringify(value));
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'city-engine-pin-'));
  roots.push(root);
  const installed = path.join(root, 'node_modules/civ-engine');
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(installed, 'dist'), { recursive: true });
  await json(path.join(root, 'scripts/civ-engine-pin.json'), pin);
  await json(path.join(root, 'package.json'), { dependencies: { 'civ-engine': pin.url } });
  await json(path.join(root, 'package-lock.json'), {
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { 'civ-engine': pin.url } },
      'node_modules/civ-engine': { version: pin.version, resolved: pin.url, integrity: pin.integrity },
    },
  });
  await json(path.join(installed, 'package.json'), {
    name: 'civ-engine', version: pin.version, type: 'module',
    exports: { '.': { import: './dist/index.js' }, './browser': './dist/index.browser.js', './package.json': './package.json' },
  });
  for (const entry of ['index.js', 'index.browser.js']) {
    await writeFile(path.join(installed, 'dist', entry), `export const ENGINE_VERSION = '${pin.version}';\n`);
  }
  return { root, installed };
}
async function changeJson(root, file, mutate) {
  const target = path.join(root, file);
  const value = JSON.parse(await readFile(target, 'utf8'));
  mutate(value);
  await json(target, value);
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('retained engine installation', () => {
  test('accepts a physical compiled package with the pinned archive and matching runtimes', async () => {
    const { root, installed } = await fixture();
    const result = await checkEngineInstall(root);
    expect(result).toMatchObject({ version: pin.version, url: pin.url, integrity: pin.integrity });
    expect(result.packageRoot).toBe(installed);
  });

  test.each([
    ['package.json', (p) => { p.dependencies['civ-engine'] = 'file:../civ-engine'; }],
    ['package-lock.json', (p) => { p.packages[''].dependencies['civ-engine'] = 'file:../civ-engine'; }],
    ['package-lock.json', (p) => { p.packages['node_modules/civ-engine'].resolved = pin.url.replace(/civ-engine-[a-f0-9]+\.tgz$/, 'civ-engine.tgz'); }],
    ['package-lock.json', (p) => { p.packages['node_modules/civ-engine'].integrity = `sha512-${Buffer.alloc(64, 8).toString('base64')}`; }],
    ['package-lock.json', (p) => { p.packages['node_modules/civ-engine'].link = true; }],
    ['package-lock.json', (p) => { p.packages['node_modules/civ-engine'].version = '2.5.0'; }],
    ['node_modules/civ-engine/package.json', (p) => { p.version = '2.5.0'; }],
  ])('rejects manifest, lock, or installed-package drift: %s', async (file, mutate) => {
    const { root } = await fixture();
    await changeJson(root, file, mutate);
    await expect(checkEngineInstall(root)).rejects.toThrow();
  });

  test.each(['index.js', 'index.browser.js'])('rejects a stale compiled %s despite a current manifest', async (entry) => {
    const { root, installed } = await fixture();
    await writeFile(path.join(installed, 'dist', entry), "export const ENGINE_VERSION = '2.5.0';\n");
    await expect(checkEngineInstall(root)).rejects.toThrow(/runtime version/);
  });

  test.each(['engine', 'node_modules', 'dist'])('rejects a shared %s junction even when versions match', async (linkedPart) => {
    const { root, installed } = await fixture();
    const shared = await fixture();
    const target = linkedPart === 'engine' ? installed : linkedPart === 'dist' ? path.join(installed, 'dist') : path.join(root, 'node_modules');
    const sharedTarget = linkedPart === 'engine' ? shared.installed : linkedPart === 'dist' ? path.join(shared.installed, 'dist') : path.join(shared.root, 'node_modules');
    await rm(target, { recursive: true });
    await symlink(sharedTarget, target, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(checkEngineInstall(root)).rejects.toThrow(/physical|linked|outside/);
  });
});
