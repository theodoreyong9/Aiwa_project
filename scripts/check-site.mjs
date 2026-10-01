// Fails when a page of the assembled site refers to a local file the site does not contain.
// A static `import './x.js'` that 404s stops the whole module script, so every button of the page does nothing:
// that is what happened when sphere-loader.js was added to the repository but not to the deploy step.
// Usage: node scripts/check-site.mjs _site
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const site = process.argv[2] ?? '_site';
const pages = ['index.html', 'bundle-provider.html'];
const references = (text) => [
  ...[...text.matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]),
  ...[...text.matchAll(/\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ...[...text.matchAll(/\b(?:src|href)=["']([^"'#:?]+)["']/g)].map((m) => m[1]).filter((u) => !u.startsWith('//') && !u.startsWith('/')),
  ...[...text.matchAll(/["'](\.\/[^"']+\.(?:js|json|css|png|webmanifest))["']/g)].map((m) => m[1]),
];

let missing = 0;
for (const page of pages) {
  const path = join(site, page);
  if (!existsSync(path)) { console.error(`${page}: not in ${site}`); missing++; continue; }
  const seen = new Set();
  for (const ref of references(readFileSync(path, 'utf8'))) {
    const file = join(site, dirname(page), ref).replace(/\/$/, '');
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) { console.error(`${page}: refers to ${ref}, which is not in ${site}`); missing++; }
  }
}
if (missing) { console.error(`${missing} missing file(s): the deployed page would not work.`); process.exit(1); }
console.log(`every local file the pages refer to is in ${site}`);
