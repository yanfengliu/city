/** Browser stub for `node:crypto` (see node-fs.ts for why). Delegates to Web Crypto. */
export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}
