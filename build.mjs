import * as esbuild from 'esbuild';

const commonOptions = {
  bundle: true,
  format: 'iife',
  target: 'es2020',
  sourcemap: true,
  minify: false,
};

// Build background script
await esbuild.build({
  ...commonOptions,
  entryPoints: ['src/background.ts'],
  outfile: 'extension/dist/background.js',
  globalName: 'WebTimeBackground',
});

// Build content script
await esbuild.build({
  ...commonOptions,
  entryPoints: ['src/content.ts'],
  outfile: 'extension/dist/content.js',
  globalName: 'WebTimeContent',
});

// Build popup scripts - these need to export to window for Chart.js interaction
await esbuild.build({
  ...commonOptions,
  entryPoints: ['src/popup/popup-init.ts'],
  outfile: 'extension/dist/popup/popup-bundle.js',
  globalName: 'WebTimePopup',
  // External Chart.js since it's loaded via script tag
  external: ['chart.js'],
});

console.log('Build complete!');
