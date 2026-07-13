import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

function finishManifest(files) {
  const treeSha256 = createHash('sha256')
    .update(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join(''))
    .digest('hex');
  return { treeSha256, files };
}

async function fileRecord(path, displayPath = path) {
  const bytes = await readFile(path);
  return {
    path: displayPath.replaceAll('\\', '/'),
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function manifestPaths(paths) {
  const files = [];
  const visit = async (path) => {
    const entry = await stat(path);
    if (entry.isDirectory()) {
      const children = await readdir(path, { withFileTypes: true });
      children.sort((left, right) => left.name.localeCompare(right.name));
      for (const child of children) await visit(`${path}/${child.name}`);
      return;
    }
    if (entry.isFile()) files.push(await fileRecord(path));
  };
  for (const path of [...paths].sort((left, right) => left.localeCompare(right))) {
    await visit(path);
  }
  return finishManifest(files);
}

export async function manifestDirectory(directory) {
  const root = resolve(directory);
  const files = [];
  const visit = async (relativeDirectory) => {
    const entries = await readdir(resolve(root, relativeDirectory), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(await fileRecord(resolve(root, path), path));
    }
  };
  await visit('');
  return finishManifest(files);
}
