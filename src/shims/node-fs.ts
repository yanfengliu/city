/**
 * Browser stub for `node:fs`, aliased in vite.config.ts. civ-engine's public
 * index statically exports Node-only tooling (FileSink, BundleCorpus) whose
 * fs calls must exist as named bindings but are never invoked in the browser.
 */
function unavailable(name: string): never {
  throw new Error(`node:fs.${name} is not available in the browser`);
}

export const appendFileSync = (): never => unavailable('appendFileSync');
export const existsSync = (): never => unavailable('existsSync');
export const lstatSync = (): never => unavailable('lstatSync');
export const mkdirSync = (): never => unavailable('mkdirSync');
export const readdirSync = (): never => unavailable('readdirSync');
export const readFileSync = (): never => unavailable('readFileSync');
export const renameSync = (): never => unavailable('renameSync');
export const rmSync = (): never => unavailable('rmSync');
export const statSync = (): never => unavailable('statSync');
export const writeFileSync = (): never => unavailable('writeFileSync');
