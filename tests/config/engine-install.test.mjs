import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'node:url';
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
const aliases = [];
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
  await copyFile(new URL('../../scripts/check-engine.mjs', import.meta.url), path.join(root, 'scripts/check-engine.mjs'));
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
  for (const alias of aliases.splice(0)) await unlink(alias);
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
    await expect(checkEngineInstall(root)).rejects.toThrow(/Run npm ci --ignore-scripts after restoring/);
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

describe('engine installation CLI', () => {
  const routes = ['direct', 'junction', ...(process.platform === 'win32' ? ['case variant'] : [])];
  async function entry(root, route) {
    if (route === 'case variant') return path.join(root, 'SCRIPTS/CHECK-ENGINE.mjs');
    if (route === 'direct') return path.join(root, 'scripts/check-engine.mjs');
    const parent = await mkdtemp(path.join(os.tmpdir(), 'city-engine-alias-'));
    roots.push(parent);
    const alias = path.join(parent, 'checkout');
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    aliases.push(alias);
    return path.join(alias, 'scripts/check-engine.mjs');
  }
  const run = (args) => spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10_000, windowsHide: true });

  test.each(routes)('checks and reports a valid installation through %s', async (route) => {
    const { root, installed } = await fixture();
    const result = run([await entry(root, route)]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(`civ-engine ${pin.version}: verified retained archive and private Node/browser runtimes`);
    expect(result.stdout).toContain(installed);
  });

  test.each(routes)('fails visibly for an invalid pin through %s', async (route) => {
    const { root } = await fixture();
    await changeJson(root, 'package.json', (p) => { p.dependencies['civ-engine'] = 'file:../civ-engine'; });
    const result = run([await entry(root, route)]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Engine installation: package dependency differs from the pin');
    expect(result.stdout).toBe('');
  });

  test.each(['normal', 'absent', 'nonexistent'])('does not check on import with %s argv', async (argv) => {
    const { root } = await fixture();
    await changeJson(root, 'package.json', (p) => { p.dependencies['civ-engine'] = 'file:../civ-engine'; });
    const importer = path.join(root, 'scripts/import-check.mjs');
    const alterArgv = argv === 'absent' ? 'delete process.argv[1];' : argv === 'nonexistent' ? `process.argv[1] = ${JSON.stringify(path.join(root, 'missing.mjs'))};` : '';
    await writeFile(importer, `${alterArgv}\nconst guard = await import(${JSON.stringify(pathToFileURL(path.join(root, 'scripts/check-engine.mjs')).href)});\nconsole.log(typeof guard.checkEngineInstall);\n`);
    const result = run([importer]);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('function');
  });
});
