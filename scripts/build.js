// Bundles the ES-module sources into ONE self-contained HTML file:
// app and worker scripts and CSS inlined, the build id stamped in.
// No runtime dependencies, no CDN.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

async function bundle(entry, format) {
  const result = await Bun.build({ entrypoints: [new URL(entry, root).pathname], target: 'browser', format, minify: true });
  if (!result.success) throw new AggregateError(result.logs, `bundling ${entry} failed`);
  return result.outputs[0].text();
}

// Inline scripts must not contain "</script"; "<\/script" is the same text to JS.
const inlineSafe = (code) => code.replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');

/** "4815eb6 · 06.11.2026": the commit the page was built from, shown in the form. */
function buildId() {
  const git = Bun.spawnSync(['git', 'log', '-1', '--format=%h · %cd', '--date=format:%d.%m.%Y'], { cwd: root.pathname });
  return git.success ? git.stdout.toString().trim() : 'dev';
}

export async function buildHtml() {
  const [app, worker] = await Promise.all([bundle('src/app/main.js', 'esm'), bundle('src/app/worker.js', 'iife')]);
  return read('src/app/index.html')
    .replace('/*STYLE*/', () => read('src/app/styles.css'))
    .replace('/*WORKER*/', () => inlineSafe(worker))
    .replace('/*BUILD*/', () => buildId())
    .replace('/*APP*/', () => inlineSafe(app));
}

if (import.meta.main) {
  const html = await buildHtml();
  mkdirSync(new URL('dist/', root), { recursive: true });
  writeFileSync(new URL('dist/motogymkhana-constructor.html', root), html);
  writeFileSync(new URL('dist/index.html', root), html);
  console.log(`dist/motogymkhana-constructor.html  ${(html.length / 1024).toFixed(1)} KB`);
}
