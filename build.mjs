import * as esbuild from 'esbuild';

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
