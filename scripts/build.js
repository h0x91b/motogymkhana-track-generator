// Bundles the ES-module sources into ONE self-contained HTML file:
// app and worker scripts, CSS and the golden hashes for #selfcheck inlined.
// No runtime dependencies, no CDN.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

async function bundle(entry, format) {
  const result = await Bun.build({ entrypoints: [new URL(entry, root).pathname], target: 'browser', format, minify: true });
  if (!result.success) throw new AggregateError(result.logs, `bundling ${entry} failed`);
  return result.outputs[0].text();
}

// Inline scripts must not contain "</script"; "<\/script" is the same text to JS.
const inlineSafe = (code) => code.replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');

function goldenHashes() {
  const dir = new URL('test/golden/', root);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'pairs.json')
    .sort()
    .map((f) => {
      const g = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
      return { name: g.name, generatorVersion: g.generatorVersion, recipe: g.recipe, seed: g.seed, hash: g.hash };
    });
}

export async function buildHtml() {
  const [app, worker] = await Promise.all([bundle('src/app/main.js', 'esm'), bundle('src/app/worker.js', 'iife')]);
  return read('src/app/index.html')
    .replace('/*STYLE*/', () => read('src/app/styles.css'))
    .replace('/*WORKER*/', () => inlineSafe(worker))
    .replace('/*GOLDEN*/', () => inlineSafe(JSON.stringify(goldenHashes())))
    .replace('/*APP*/', () => inlineSafe(app));
}

if (import.meta.main) {
  const html = await buildHtml();
  mkdirSync(new URL('dist/', root), { recursive: true });
  writeFileSync(new URL('dist/motogymkhana-constructor.html', root), html);
  writeFileSync(new URL('dist/index.html', root), html);
  console.log(`dist/motogymkhana-constructor.html  ${(html.length / 1024).toFixed(1)} KB`);
}
