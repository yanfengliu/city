import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// civ-engine's index exports Node-only tooling (FileSink, BundleCorpus, MCP
// helpers); these shims satisfy its node:* imports in the browser without
// pulling them into the bundle's executed paths.
const shim = (name: string) =>
  fileURLToPath(new URL(`./src/shims/${name}.ts`, import.meta.url));

// Dev-only: the LLM playtest harness POSTs a JPEG data URL here and the server
// writes it to disk, so the agent can `Read` the exact frame the player sees
// without shuttling ~80 KB of base64 back through the eval boundary (and it
// sidesteps the CDP screenshot timeout seen in this environment). Server
// middleware only — never part of the production bundle. Writes are pinned to
// SHOT_DIR and the name is reduced to a basename, so a stray path can't escape.
const SHOT_DIR = process.env.CITY_SHOT_DIR ?? join(process.cwd(), '.shots');
const shotSink = (): Plugin => ({
  name: 'city-shot-sink',
  apply: 'serve',
  configureServer(server) {
    mkdirSync(SHOT_DIR, { recursive: true });
    server.middlewares.use('/__shot', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end('POST only');
        return;
      }
      const url = new URL(req.url ?? '', 'http://localhost');
      const name = basename(url.searchParams.get('name') ?? 'shot.jpg');
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const b64 = body.replace(/^data:image\/\w+;base64,/, '');
        try {
          writeFileSync(join(SHOT_DIR, name), Buffer.from(b64, 'base64'));
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, name, bytes: b64.length }));
        } catch (err) {
          res.statusCode = 500;
          res.end(String(err));
        }
      });
    });
  },
});

export default defineConfig({
  resolve: {
    // Local `voxel` is linked during development and carries its own Three
    // devDependency, so a bundler following the symlink would resolve a second
    // copy. Pin every import to this app's Three instance: with two copies,
    // instanceof checks and material identity silently fail across the boundary.
    dedupe: ['three'],
    alias: {
      'node:fs': shim('node-fs'),
      'node:path': shim('node-path'),
      'node:crypto': shim('node-crypto'),
    },
  },
  plugins: [shotSink()],
  worker: { format: 'es' },
  server: { port: 5199, strictPort: true },
  build: { target: 'es2022' },
});
