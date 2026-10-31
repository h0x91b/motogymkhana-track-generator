// Hidden page (#selfcheck): regenerates the golden pairs in this browser and
// compares canonical hashes with the ones recorded by the test suite, to prove
// cross-browser reproducibility on real phones.
import { courseHash, generateCourse, GENERATOR_VERSION } from '../generator/index.js';

export function runSelfCheck(root) {
  let pairs = [];
  try {
    pairs = JSON.parse(document.getElementById('golden').textContent);
  } catch {
    pairs = [];
  }
  root.innerHTML = '';
  const page = document.createElement('section');
  page.className = 'selfcheck';
  const rows = [];
  let okCount = 0;
  const t0 = performance.now();
  for (const p of pairs) {
    const t = performance.now();
    const result = generateCourse(p.recipe, p.seed);
    const ms = performance.now() - t;
    const hash = result.ok ? courseHash(result.course) : 'error';
    const ok = hash === p.hash && p.generatorVersion === GENERATOR_VERSION;
    if (ok) okCount++;
    rows.push(`<tr><td>${p.name}</td><td>${p.hash}</td><td>${hash}</td><td>${Math.round(ms)} мс</td><td class="${ok ? 'ok' : 'bad'}">${ok ? 'совпало' : 'РАСХОЖДЕНИЕ'}</td></tr>`);
  }
  const total = Math.round(performance.now() - t0);
  const verdict = pairs.length && okCount === pairs.length;
  page.innerHTML = `<h2>Самопроверка генератора v${GENERATOR_VERSION}</h2>
    <p class="${verdict ? 'ok' : 'bad'}" id="selfcheck-verdict">${verdict ? `Все ${pairs.length} эталонов совпали` : `Совпало ${okCount} из ${pairs.length}`}</p>
    <p>${navigator.userAgent}</p><p>Всего ${total} мс</p>
    <table><tr><th>эталон</th><th>ожидалось</th><th>получилось</th><th>время</th><th></th></tr>${rows.join('')}</table>`;
  root.append(page);
  root.style.overflow = 'auto';
}
