const STATIC_SOURCE_PATHS = Object.freeze([
  '.gitattributes',
  'index.html',
  'package.json',
  'package-lock.json',
  'scripts/benchmark-frame-pacing.mjs',
  'scripts/frame-pacing-browser-lifecycle.d.mts',
  'scripts/frame-pacing-browser-lifecycle.mjs',
  'scripts/frame-pacing-http.d.mts',
  'scripts/frame-pacing-http.mjs',
  'scripts/frame-pacing-lease.d.mts',
  'scripts/frame-pacing-lease.mjs',
  'scripts/frame-pacing-manifest.d.mts',
  'scripts/frame-pacing-manifest.mjs',
  'scripts/frame-pacing-source-paths.d.mts',
  'scripts/frame-pacing-source-paths.mjs',
  'scripts/frame-pacing-support.d.mts',
  'scripts/frame-pacing-support.mjs',
  'scripts/performance-fixture-contract.d.mts',
  'scripts/performance-fixture-contract.mjs',
  'scripts/recorder-source-manifest.d.mts',
  'scripts/recorder-source-manifest.mjs',
  'scripts/check-production-bundle.mjs',
  'src',
  'tsconfig.json',
  'vite.config.ts',
]);

export function linkedProductionDependencyNames(packageMetadata) {
  return Object.entries(packageMetadata.dependencies ?? {})
    .filter(([, version]) => typeof version === 'string' && version.startsWith('file:'))
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
}

export function framePacingSourcePaths(packageMetadata) {
  const linkedPaths = linkedProductionDependencyNames(packageMetadata).flatMap((name) => [
    `node_modules/${name}/package.json`,
    `node_modules/${name}/dist`,
  ]);
  return [...STATIC_SOURCE_PATHS, ...linkedPaths];
}
