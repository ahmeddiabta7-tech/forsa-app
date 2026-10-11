// Builds the app into docs/ using esbuild (no other tools needed).
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
const NODE_PATHS = ['/opt/npm-tools/node_modules', './node_modules'];
rmSync('docs', { recursive: true, force: true });
mkdirSync('docs', { recursive: true });
await build({
  entryPoints: { app: 'src/main.jsx' },
  bundle: true, minify: true, sourcemap: false, outdir: 'docs', target: ['es2019'],
  jsx: 'automatic', loader: { '.js': 'jsx' }, nodePaths: NODE_PATHS,
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
});
// Version stamp so phones always load the newest app files after an update.
const v = Date.now().toString(36);
writeFileSync('docs/index.html', readFileSync('index.html', 'utf8').replace('href="app.css"', `href="app.css?v=${v}"`).replace('src="app.js"', `src="app.js?v=${v}"`));
cpSync('public', 'docs', { recursive: true });
cpSync('docs/index.html', 'docs/404.html');
console.log('built docs/');
