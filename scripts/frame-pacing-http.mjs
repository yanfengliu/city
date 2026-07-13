import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { withTimeout } from './frame-pacing-support.mjs';

function contentType(filePath) {
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  }[extname(filePath)] ?? 'application/octet-stream';
}

export async function serveDist(directory) {
  const root = resolve(directory);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
      const filePath = resolve(root, relativePath);
      if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
        response.writeHead(403).end('forbidden');
        return;
      }
      if (!(await stat(filePath)).isFile()) throw new Error('not a file');
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': contentType(filePath),
      });
      response.end(await readFile(filePath));
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('benchmark server has no TCP port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose, reject) => {
      server.close((error) => error ? reject(error) : resolveClose());
    }),
    forceClose: () => server.closeAllConnections(),
  };
}

export async function closeHttpServer(server, cleanupTimeoutMs) {
  const closing = server.close();
  try {
    await withTimeout(closing, cleanupTimeoutMs, 'benchmark HTTP server cleanup');
  } catch (error) {
    server.forceClose();
    await withTimeout(closing, cleanupTimeoutMs, 'forced benchmark HTTP server cleanup')
      .catch(() => undefined);
    throw error;
  }
}
