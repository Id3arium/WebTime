import * as esbuild from 'esbuild';
import { rm } from 'node:fs/promises';

// Start from a clean dist so stale orphans from older build layouts can't
// linger and ship inside the packaged extension. (A previous tsc-based build
// emitted one .js per source file; esbuild now bundles to just three outputs,
// and the leftovers — e.g. an old ui-manager.js — were getting flagged by
// AMO's linter even though nothing loads them.)
await rm('extension/dist', { recursive: true, force: true });

const commonOptions = {
  bundle: true,
  sourcemap: true,
  target: 'es2020',
  format: 'iife',
};

await Promise.all([
  esbuild.build({
    ...commonOptions,
    entryPoints: ['src/background.ts'],
    outfile: 'extension/dist/background.js',
  }),
  esbuild.build({
    ...commonOptions,
    entryPoints: ['src/content.ts'],
    outfile: 'extension/dist/content.js',
  }),
  esbuild.build({
    ...commonOptions,
    entryPoints: ['src/popup/popup-init.ts'],
    outfile: 'extension/dist/popup/popup-bundle.js',
  }),
]);

console.log('Build complete.');
