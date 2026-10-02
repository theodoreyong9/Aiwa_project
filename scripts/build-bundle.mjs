// One browser file with the wallet in it: aiwa-lib, aiwa-core and what they need, bundled (ES module, minified).
// Pages that cannot carry an import map (YourMine's has none, and no build step) load it with
//   const aiwa = await import('https://theodoreyong9.github.io/Aiwa_project/aiwa.bundle.js');
// Usage: node scripts/build-bundle.mjs [outfile]
import { build } from 'esbuild';
import { writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'aiwa.bundle.js');
const dir = mkdtempSync(join(tmpdir(), 'aiwa-bundle-'));
const entry = join(dir, 'entry.js');
const root = resolve('node_modules');
writeFileSync(entry, `
export { AIWA, mountWalletSafety, loadArchiveNodes, saveArchiveNodes, fromUnits, toUnits } from ${JSON.stringify(join(root, 'aiwa-lib/src/index.js'))};
export { reward, miningState, rankingFigure, commitmentPriceLamports, MAX_PATIENCE_RATE, assessMining, generateBip39Mnemonic, validateBip39Mnemonic } from ${JSON.stringify(join(root, 'aiwa-core/src/index.js'))};
`);
try {
  await build({
    entryPoints: [entry], outfile: out, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
    nodePaths: [root], legalComments: 'none', logLevel: 'warning',
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`${out}: ${Math.round(statSync(out).size / 1024)} KB`);
