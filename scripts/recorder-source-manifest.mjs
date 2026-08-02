// Bare specifier on purpose: vite.config.ts aliases node:crypto to a browser shim.
import { createHash } from 'crypto';

export const SOURCE_NORMALIZATION = 'crlf-to-lf';

export function canonicalTextBytes(bytes) {
  const source = Buffer.from(bytes);
  const canonical = Buffer.allocUnsafe(source.byteLength);
  let output = 0;
  for (let input = 0; input < source.byteLength; input++) {
    if (source[input] === 0x0d && source[input + 1] === 0x0a) continue;
    canonical[output++] = source[input];
  }
  return canonical.subarray(0, output);
}

export function sourceFileRecord(path, bytes) {
  const canonical = canonicalTextBytes(bytes);
  return {
    path: path.replaceAll('\\', '/'),
    bytes: canonical.byteLength,
    sha256: createHash('sha256').update(canonical).digest('hex'),
  };
}

export function finishSourceManifest(files) {
  const treeSha256 = createHash('sha256')
    .update(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(''))
    .digest('hex');
  return { normalization: SOURCE_NORMALIZATION, treeSha256, files };
}
