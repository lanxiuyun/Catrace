import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const result = await build({
  entryPoints: ['preview.jsx'], bundle: true, write: false,
  outdir: 'build', format: 'iife', platform: 'browser', target: ['es2020'],
  minify: true, legalComments: 'inline', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
// Bundled vendor CSS template literals contain whitespace-only lines; keep diffs clean.
const js = result.outputFiles.find(file => file.path.endsWith('.js')).text.replace(/^[\t ]+$/gm, '');
const css = result.outputFiles.find(file => file.path.endsWith('.css')).text;
if (/@import\s|url\(\s*['"]?https?:/i.test(css)) throw new Error('Unexpected remote CSS dependency');
const source = readFileSync('preview.jsx', 'utf8');
if (!source.includes('return <Theme {...defaults}>')) throw new Error('Missing design theme configuration');
const layout = readFileSync('layout.css', 'utf8');
for (const token of ['--ct-bg: #f8fafc', '--ct-surface: #ffffff', '--ct-accent: #4f46e5', '--ct-border: #e2e8f0']) {
  if (!layout.includes(token)) throw new Error('Missing design reference token: ' + token);
}
if (source.includes("variant={p.id===selected?'soft':'ghost'}")) throw new Error('Plugin rows must not use ghost button geometry');
if (!layout.includes('"Microsoft YaHei"') || !layout.includes('"PingFang SC"')) throw new Error('Missing Chinese sans-serif fallback');
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Catrace · 设计稿主题预览</title><style>${css.replace(/<\/style/gi, '<\\/style')}</style></head><body><div id="root"></div><noscript>此 React 预览需要启用 JavaScript。</noscript><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
new Function(js);
const output = fileURLToPath(new URL('../../catrace-ui-concept.html', import.meta.url));
writeFileSync(output, html);
console.log(`Built ${output}`);
console.log(`PASS: official Radix CSS and React bundled; design reference tokens checked; Chinese font fallback checked; no external CSS assets; JS syntax valid.`);
console.log(`Size: ${(Buffer.byteLength(html)/1024).toFixed(1)} KiB`);
