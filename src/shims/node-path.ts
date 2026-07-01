/** Browser stub for `node:path` (see node-fs.ts for why). Pure string ops, safe to implement. */
export const sep = '/';

export function join(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
}

export function resolve(...parts: string[]): string {
  return join(...parts);
}

export function relative(from: string, to: string): string {
  return to.startsWith(from) ? to.slice(from.length).replace(/^\/+/, '') : to;
}
