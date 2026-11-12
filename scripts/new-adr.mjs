// Create docs/adr/NNNN-<slug>.md with the next free number.
//
//   bun scripts/new-adr.mjs <slug>              next number after every one in use
//   bun scripts/new-adr.mjs <slug> --number 17  the number the coordinator assigned
//
// "In use" means present on this checkout or on any fetched origin branch, so an
// ADR sitting in another open PR counts. The script fetches origin first (skipped
// quietly when offline). A number is never reused, gaps included.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const ADR_DIR = join(ROOT, 'docs/adr');
const NAME = /^(\d{4})-.+\.md$/;

const args = process.argv.slice(2);
const at = args.indexOf('--number');
const wanted = at >= 0 ? Number(args.splice(at, 2)[1]) : null;
const slug = args[0];
if (!slug || args.length > 1 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || (wanted !== null && !(Number.isInteger(wanted) && wanted > 0))) {
  console.error('usage: bun scripts/new-adr.mjs <kebab-case-slug> [--number N]');
  process.exit(2);
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** ADR number -> where it was seen. */
const taken = new Map();
const note = (file, where) => {
  const m = file.match(NAME);
  if (m && !taken.has(Number(m[1]))) taken.set(Number(m[1]), `${where}: ${file}`);
};
for (const f of readdirSync(ADR_DIR)) note(f, 'this checkout');

try {
  git('fetch', '--quiet', 'origin');
} catch {
  console.warn('warning: git fetch origin failed; checking the branches fetched before');
}
let refs = [];
try {
  refs = git('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin').split('\n').filter((r) => r && r !== 'origin/HEAD' && r !== 'origin');
} catch {
  console.warn('warning: no git refs readable; checking this checkout only');
}
for (const ref of refs) {
  let files = '';
  try {
    files = git('ls-tree', '--name-only', `${ref}:docs/adr`);
  } catch {
    continue; // the branch has no docs/adr
  }
  for (const f of files.split('\n')) note(f, ref);
}

const number = wanted ?? Math.max(0, ...taken.keys()) + 1;
if (taken.has(number)) {
  console.error(`ADR ${String(number).padStart(4, '0')} is already taken (${taken.get(number)}).`);
  process.exit(1);
}

const file = join(ADR_DIR, `${String(number).padStart(4, '0')}-${slug}.md`);
if (existsSync(file)) {
  console.error(`${file} already exists.`);
  process.exit(1);
}
writeFileSync(file, `# ${slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())}

Context and the decision, in a few sentences.

## Considered Options

- Option — why not.
`);
console.log(file.slice(ROOT.length + 1));
