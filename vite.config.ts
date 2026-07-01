import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// civ-engine's index exports Node-only tooling (FileSink, BundleCorpus, MCP
// helpers); these shims satisfy its node:* imports in the browser without
// pulling them into the bundle's executed paths.
const shim = (name: string) =>
  fileURLToPath(new URL(`./src/shims/${name}.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      'node:fs': shim('node-fs'),
      'node:path': shim('node-path'),
      'node:crypto': shim('node-crypto'),
    },
  },
  worker: { format: 'es' },
  server: { port: 5199, strictPort: true },
  build: { target: 'es2022' },
});
