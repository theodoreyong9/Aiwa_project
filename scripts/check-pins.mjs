#!/usr/bin/env node
// Which repository pins an older commit of the one it depends on? The Aiwa repositories depend on each other by commit
// (lock files, and YourMine's package.json), so a change in one is only in the others once their pin moves — and the order
// matters: core, then platform, then lib, then this project (its Pages build publishes aiwa.bundle.js, which YourMine loads
// when it runs), then YourMine. This reads what each repository pins on GitHub (main) and compares it with the HEAD of what
// it pins, so that a stale pin is seen instead of discovered by a failure.
//
//   node scripts/check-pins.mjs
//
// "behind" is not always wrong (a README-only commit upstream changes nothing for the dependant): look at what the commits
// after the pinned one are before moving a pin. Exit code 1 if anything is behind.

import { execFileSync } from 'node:child_process';

const OWNER = 'theodoreyong9';
// repository -> where its pins are written (a file on main) and how to read them
const DEPENDANTS = [
  { repo: 'Aiwa_platform', file: 'package-lock.json', pins: ['Aiwa_core'] },
  { repo: 'Aiwa_lib', file: 'package-lock.json', pins: ['Aiwa_core', 'Aiwa_platform'] },
  { repo: 'Aiwa_project', file: 'package-lock.json', pins: ['Aiwa_core', 'Aiwa_lib', 'Aiwa_platform'] },
  { repo: 'YourMinedApp', file: 'package.json', pins: ['Aiwa_core'] },
];

const heads = new Map();
function head(repo) {
  if (!heads.has(repo)) {
    const out = execFileSync('git', ['ls-remote', `https://github.com/${OWNER}/${repo}`, 'HEAD'], { encoding: 'utf8', timeout: 30000 });
    heads.set(repo, out.split('\t')[0]);
  }
  return heads.get(repo);
}

async function pinnedIn(dependant, dependency) {
  const reply = await fetch(`https://raw.githubusercontent.com/${OWNER}/${dependant.repo}/main/${dependant.file}`);
  if (!reply.ok) throw new Error(`${dependant.repo}/${dependant.file}: ${reply.status}`);
  const text = await reply.text();
  const found = new RegExp(`${dependency}(?:\\.git)?#([0-9a-f]{40})`, 'i').exec(text);
  return found ? found[1] : null;
}

let behind = 0;
for (const dependant of DEPENDANTS) {
  for (const dependency of dependant.pins) {
    const pinned = await pinnedIn(dependant, dependency);
    const latest = head(dependency);
    const state = pinned === null ? 'no pin found' : pinned === latest ? 'current' : 'BEHIND';
    if (state !== 'current') behind++;
    console.log(`${dependant.repo.padEnd(14)} → ${dependency.padEnd(14)} pinned ${pinned ? pinned.slice(0, 7) : '-------'}  HEAD ${latest.slice(0, 7)}  ${state}`);
  }
}
console.log(behind ? `\n${behind} pin(s) not on HEAD. Order to move them: core → platform → lib → project → YourMine.` : '\nEvery pin is on the HEAD of what it depends on.');
process.exitCode = behind ? 1 : 0;
