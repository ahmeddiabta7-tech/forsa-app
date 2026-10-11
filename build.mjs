// Builds the app into docs/ using esbuild (no other tools needed).
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
const NODE_PATHS = ['/opt/npm-tools/node_modules', './node_modules'];
rmSync('docs', { recursive: true, force: true });
mkdirSync('docs', { recursive: true });
await build({
  entryPoints: { app: 'src/main.jsx' },
  bundle: true, minify: true, sourcemap: false, outdir: 'docs', target: ['es2019'],
  jsx: 'automatic', loader: { '.js': 'jsx' }, nodePaths: NODE_PATHS,
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
});
cpSync('index.html', 'docs/index.html');
cpSync('public', 'docs', { recursive: true });
cpSync('docs/index.html', 'docs/404.html');
console.log('built docs/');
