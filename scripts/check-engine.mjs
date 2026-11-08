import { lstat, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
function requireMatch(condition, message) {
  if (!condition) throw new Error(`Engine installation: ${message}. Run npm ci after restoring the verified pin and lockfile.`);
}

/** npm ci verifies archive bytes; this checks the selected artifact and runtime identity. */
export async function checkEngineInstall(root = defaultRoot) {
  const packageRoot = path.join(await realpath(root), 'node_modules', 'civ-engine');
  const [pin, manifest, lock] = await Promise.all([
    readJson(path.join(root, 'scripts/civ-engine-pin.json')),
    readJson(path.join(root, 'package.json')),
    readJson(path.join(root, 'package-lock.json')),
  ]);
  requireMatch(/^https:\/\/github\.com\/yanfengliu\/civ-engine\/releases\/download\/engine-dist\/civ-engine-[a-f0-9]{40}\.tgz$/.test(pin.url), 'pin must name a retained commit archive');
  requireMatch(/^sha512-[A-Za-z0-9+/]{86}==$/.test(pin.integrity), 'pin must contain the verified SHA-512 integrity');
  requireMatch(manifest.dependencies?.['civ-engine'] === pin.url, 'package dependency differs from the pin');
  requireMatch(lock.packages?.['']?.dependencies?.['civ-engine'] === pin.url, 'root lock dependency differs from the pin');
  const entry = lock.packages?.['node_modules/civ-engine'];
  requireMatch(entry && !entry.link && entry.resolved === pin.url && entry.integrity === pin.integrity && entry.version === pin.version, 'locked engine archive, integrity, or version differs from the pin');

  for (const directory of [path.dirname(packageRoot), packageRoot]) {
    const stat = await lstat(directory);
    requireMatch(stat.isDirectory() && !stat.isSymbolicLink(), `${directory} must be a physical directory, not linked`);
    requireMatch(await realpath(directory) === directory, `${directory} resolves outside its physical location`);
  }
  const resolve = createRequire(path.join(root, 'package.json')).resolve;
  const manifestPath = await realpath(resolve('civ-engine/package.json'));
  requireMatch(manifestPath === path.join(packageRoot, 'package.json'), 'resolved engine package is outside the private installation');
  const installed = await readJson(manifestPath);
  requireMatch(installed.name === 'civ-engine' && installed.version === pin.version, 'installed package version differs from the pin');
  const browserExport = installed.exports?.['./browser'];
  const entries = [installed.exports?.['.']?.import, typeof browserExport === 'string' ? browserExport : browserExport?.default];
  for (const relativeEntry of entries) {
    requireMatch(typeof relativeEntry === 'string', 'compiled Node or browser export is missing');
    const runtimePath = await realpath(path.resolve(packageRoot, relativeEntry));
    const relative = path.relative(packageRoot, runtimePath);
    requireMatch(relative.startsWith(`dist${path.sep}`) && !path.isAbsolute(relative), 'runtime entry resolves outside the private compiled package');
    const runtime = await import(pathToFileURL(runtimePath).href);
    requireMatch(runtime.ENGINE_VERSION === pin.version, `runtime version in ${relativeEntry} differs from ${pin.version}`);
  }
  return { version: pin.version, url: pin.url, integrity: pin.integrity, packageRoot };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await checkEngineInstall();
    console.log(`civ-engine ${result.version}: verified retained archive and private Node/browser runtimes`);
    console.log(result.packageRoot);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
