import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';
await Promise.all([
  build({ entryPoints: ['src/main.ts'], outfile: 'build/main.mjs', platform: 'node', format: 'esm', bundle: true, packages: 'external' }),
  build({ entryPoints: ['src/preload.ts'], outfile: 'build/preload.cjs', platform: 'node', format: 'cjs', bundle: true, external: ['electron'] }),
  build({ entryPoints: ['src/ui.tsx'], outfile: 'build/ui.js', bundle: true, jsx: 'automatic', minify: true }),
]);
await copyFile('src/index.html', 'build/index.html');
await copyFile('assets/atom.png', 'build/atom.png');

