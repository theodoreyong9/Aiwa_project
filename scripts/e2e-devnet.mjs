#!/usr/bin/env node
// The whole path of a wallet, once, for real — the run nothing else here has done: a wallet is made from a phrase, funded on
// Solana devnet, BURNS SOL, mines epochs (the deployment's own work: 100 000 squarings and a proof each), claims, is
// verified the way a registry verifies it (aiwa-core's assessSubmission, asking Solana itself for the burn), is backed up to
// an archive node, and is brought back on a "second device" from the phrase alone — which then carries on, and is accepted
// again by the same verifier.
//
//   node scripts/e2e-devnet.mjs                     real: Solana devnet (the burn is real, of devnet SOL, worth nothing)
//   node scripts/e2e-devnet.mjs --sol 0.02 --epochs 5 --T 0.2
//   node scripts/e2e-devnet.mjs --rpc https://my-rpc.example
//   node scripts/e2e-devnet.mjs --phrase "twelve words …"   reuse a wallet (fund it once, then run again)
//   node scripts/e2e-devnet.mjs --yourmine ~/YourMinedApp   also runs YourMine's real validate.js (the GitHub Action's script) on
//                                                   this wallet's own evidence, and restores a wallet from the baseline it writes
//   node scripts/e2e-devnet.mjs --fake              the same steps against a stand-in Solana in this process (a dry run
//                                                   of the script itself; proves nothing about the network)
//
// Needs the project's dependencies (npm install). On a phone: Termux, `pkg install nodejs git`, clone the repository,
// `npm install`, then the command above. Not covered: the YourMine pull request and its GitHub Action — printed at the end.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as web3 from '@solana/web3.js';
import { AIWA } from 'aiwa-lib';
import {
  assessSubmission, broadcastBurnTransaction, deriveKeypairFromBip39Mnemonic, generateBip39Mnemonic, base58Encode,
  SOLANA_INCINERATOR_ADDRESS,
} from 'aiwa-core';

// the deployment's parameters: the same as index.html's and YourMine's
const PARAMS = { alpha: 1.1, beta: 2.2, gamma: 3, C: Math.pow(33, 3), minQ: 1, epochIterations: 100000 };

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback; };
if (flag('help') || flag('h')) {
  console.log(readFileHeader());
  process.exit(0);
}
const fake = flag('fake');
const rpc = option('rpc', 'https://api.devnet.solana.com');
const sol = Number(option('sol', 0.01));
const T = Number(option('T', 0.1));
const epochs = Math.max(1, Number(option('epochs', 3)));

let passed = 0, failed = 0;
const say = (text = '') => console.log(text);
const step = (title) => say(`\n— ${title}`);
const check = (ok, what, detail = '') => { (ok ? passed++ : failed++); say(`${ok ? '  PASS' : '  FAIL'}  ${what}${detail ? `  (${detail})` : ''}`); return ok; };
const seconds = (since) => `${((performance.now() - since) / 1000).toFixed(1)} s`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readFileHeader() {
  return 'Usage: node scripts/e2e-devnet.mjs [--fake] [--rpc URL] [--sol 0.01] [--T 0.1] [--epochs 3] [--phrase "…"]\n(see the comment at the top of the file)';
}

// A stand-in for Solana, in this process: enough of the connection that the burn and its verification use.
function fakeSolana() {
  const balances = new Map();
  const transactions = new Map();
  const FEE = 5000;
  const credit = (address, lamports) => balances.set(address, (balances.get(address) ?? 0) + lamports);
  return {
    async getBalance(publicKey) { return balances.get(publicKey.toBase58()) ?? 0; },
    async requestAirdrop(publicKey, lamports) { credit(publicKey.toBase58(), lamports); return `airdrop-${balances.size}`; },
    async getLatestBlockhash() { return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 }; },
    async sendRawTransaction(raw) {
      const tx = web3.Transaction.from(raw);
      if (!tx.verifySignatures()) throw new Error('fake Solana: bad signature');
      const transfer = web3.SystemInstruction.decodeTransfer(tx.instructions[0]);
      const payer = tx.feePayer.toBase58();
      const to = transfer.toPubkey.toBase58();
      const lamports = Number(transfer.lamports);
      const signature = base58Encode(tx.signature);
      const before = [balances.get(payer) ?? 0, balances.get(to) ?? 0];
      if (before[0] < lamports + FEE) throw new Error('fake Solana: insufficient funds');
      balances.set(payer, before[0] - lamports - FEE);
      credit(to, lamports);
      transactions.set(signature, {
        slot: 1,
        transaction: { message: { accountKeys: [payer, to, '11111111111111111111111111111111'] } },
        meta: { err: null, fee: FEE, preBalances: [before[0], before[1], 1], postBalances: [balances.get(payer), balances.get(to), 1] },
      });
      return signature;
    },
    async confirmTransaction() { return { value: { err: null } }; },
    async getTransaction(signature) { return transactions.get(signature) ?? null; },
    // the same transaction as the JSON-RPC answer @solana/web3.js parses (for a validator that runs as its own process)
    rpcTransaction(signature) {
      const t = transactions.get(signature);
      if (!t) return null;
      return {
        slot: 5, blockTime: 1,
        transaction: { signatures: [signature], message: { accountKeys: t.transaction.message.accountKeys, header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 1 }, recentBlockhash: '11111111111111111111111111111111', instructions: [{ programIdIndex: 2, accounts: [0, 1], data: '3Bxs4Bc3VYuGVB19' }] } },
        meta: { err: null, fee: FEE, innerInstructions: [], logMessages: [], preBalances: t.meta.preBalances, postBalances: t.meta.postBalances, preTokenBalances: [], postTokenBalances: [], rewards: [] },
      };
    },
  };
}

async function main() {
  say(`Aiwa end-to-end: ${fake ? 'FAKE Solana (a dry run of this script)' : `Solana at ${rpc}`} — burn ${sol} SOL at T ${T}, ${epochs} epochs of ${PARAMS.epochIterations.toLocaleString('en')} squarings`);
  const connection = fake ? fakeSolana() : new web3.Connection(rpc, 'confirmed');

  // 1. a wallet, from a phrase
  step('1. A wallet from a recovery phrase');
  const phrase = option('phrase', null) ?? await generateBip39Mnemonic(12);
  const keypair = web3.Keypair.fromSecretKey((await deriveKeypairFromBip39Mnemonic(phrase)).secretKey);
  const address = keypair.publicKey.toBase58();
  const aiwa = new AIWA({ rewardParams: PARAMS });
  await aiwa.connect({ mnemonic: phrase });
  check(aiwa.address === address, 'the Aiwa wallet and a Solana wallet derive the same address from the phrase', address);
  if (!option('phrase', null)) say(`  phrase (devnet, keep it if you want to reuse this wallet): ${phrase}`);

  // 2. funds
  step('2. Funds on devnet');
  const lamports = Math.round(sol * 1e9);
  const needed = lamports + 20_000;
  let balance = await connection.getBalance(keypair.publicKey);
  if (balance < needed) {
    try { await connection.requestAirdrop(keypair.publicKey, Math.max(needed, 1e9)); say('  airdrop requested'); }
    catch (err) { say(`  the faucet refused (${String(err.message).slice(0, 80)}): fund ${address} by hand — https://faucet.solana.com (network: devnet)`); }
    const until = Date.now() + 10 * 60_000;
    while ((balance = await connection.getBalance(keypair.publicKey)) < needed && Date.now() < until) { await sleep(5000); process.stdout.write('.'); }
    say();
  }
  if (!check(balance >= needed, `the wallet holds enough to burn ${sol} SOL`, `${(balance / 1e9).toFixed(4)} SOL`)) return finish();

  // 3. the burn (what the page's Burn button does: broadcast, confirm finalized, record, commit)
  step('3. Burn');
  let t = performance.now();
  const signature = await broadcastBurnTransaction(web3, connection, keypair, lamports);
  say(`  signature ${signature}  (${seconds(t)})`);
  if (!fake) say(`  https://explorer.solana.com/tx/${signature}?cluster=devnet`);
  const recorded = await aiwa.recordBurn(signature, connection);
  check(recorded.lamports === lamports, 'Solana reports the burn as finalized, paid by this wallet, of the amount asked', `${recorded.lamports} lamports to ${SOLANA_INCINERATOR_ADDRESS.slice(0, 6)}…`);
  await aiwa.recordCommitment({ b: Math.floor(recorded.lamports * (1 - T)) / 1e9, T });
  const afterBurn = await aiwa.mining();
  check(afterBurn && afterBurn.capital > 0 && afterBurn.T === T, 'the burn replaced the position: capital counts what is left after T', `capital ${afterBurn?.capital} SOL, T ${afterBurn?.T}`);

  // 4. mining
  step(`4. Mine ${epochs} epochs`);
  for (let i = 0; i < epochs; i++) {
    t = performance.now();
    const made = await aiwa.advanceProgress();
    say(`  epoch ${made.epoch}  (${seconds(t)})`);
    if (!made.eventId) check(false, 'an epoch was written');
  }
  const mined = await aiwa.mining();
  check(mined.epoch === epochs && mined.sinceLastAction === epochs, 'age and time since the last action count the epochs worked', `epoch ${mined.epoch}`);
  const claimable = await aiwa.claimable();
  check(Number(claimable) > 0, 'something is claimable', `${claimable} AIWA`);

  // 5. verified as a registry verifies — Solana is asked for the burn by the verifier, not by the wallet. Before the claim:
  //    a claim is an action, it restarts the clock, and the figure a registry freezes is the one of the moment before it.
  step('5. Verified by a third party (aiwa-core assessSubmission, the call YourMine\'s validate.js makes)');
  const prEvidence = await aiwa.submissionEvidence();   // what a submission made now would carry (kept for step 8)
  const first = await assessSubmission({ rewardParams: PARAMS, evidence: prEvidence, domain: aiwa.identity.id, connection });
  check(first.ok && first.mining && first.rejections.length === 0, 'the evidence is accepted, nothing rejected', first.ok ? '' : first.reason);
  check(first.mining?.epoch === epochs, 'the verifier derives the same epoch', `epoch ${first.mining?.epoch}`);
  check(first.mining && first.mining.capital === afterBurn.capital, 'and the burn it confirmed with Solana is the capital', `${first.mining?.capital} SOL`);
  check(first.ranking && first.ranking.score > 0 && first.ranking.laps === epochs, 'the ranking figure a registry would freeze: score and laps', `score ${first.ranking?.score}, laps ${first.ranking?.laps}`);
  if (first.rejections.length) say(`  rejections: ${JSON.stringify(first.rejections)}`);
  if (!first.ok || !first.baseline) return finish(phrase);

  // 6. claim, then the verifier that kept the earlier state accepts the claim as a continuation
  step('6. Claim');
  if (Number(claimable) > 0) {
    await aiwa.claim(claimable);
    check(Number(await aiwa.spendableBalance()) >= Number(claimable), 'the claim is spendable', `${await aiwa.spendableBalance()} AIWA`);
    const afterClaim = await assessSubmission({
      rewardParams: PARAMS, domain: aiwa.identity.id, baseline: first.baseline, connection,
      evidence: await aiwa.submissionEvidence({ afterEpoch: first.baseline.epoch, after: first.baseline.head }),
    });
    check(afterClaim.ok && afterClaim.rejections.length === 0 && afterClaim.mining.sinceLastAction === 0, 'the claim continues the chain the verifier kept, and restarts the clock', afterClaim.ok ? (afterClaim.rejections.length ? JSON.stringify(afterClaim.rejections).slice(0, 160) : '') : afterClaim.reason);
  } else say('  nothing to claim yet (run with more --epochs)');
  const settled = await aiwa.mining();
  const second = await assessSubmission({ rewardParams: PARAMS, evidence: await aiwa.submissionEvidence(), domain: aiwa.identity.id, connection });

  // 7. backup, a lost device, the phrase
  step('7. A lost device: archive node, then the phrase on a second device');
  const { createArchiveServer } = await import('aiwa-platform/archive-server');
  const dir = mkdtempSync(join(tmpdir(), 'aiwa-e2e-node-'));
  const node = createArchiveServer({ dir });
  await new Promise((r) => node.listen(0, '127.0.0.1', r));
  const nodeUrl = `http://127.0.0.1:${node.address().port}`;
  try {
    const pushed = await aiwa.archiveNow([nodeUrl]);
    check(pushed.ok.length === 1, 'the backup is on the archive node', nodeUrl);
    const phone = new AIWA({ rewardParams: PARAMS });
    await phone.connect({ mnemonic: phrase });
    check((await phone.mining()) === null, 'the second device starts with nothing but the phrase');
    const got = await phone.restoreFromArchive([nodeUrl]);
    check(got.found && got.restored, 'the node gives the wallet back', `epoch ${got.epoch}`);
    const back = await phone.mining();
    check(back.chainHead === settled.chainHead && back.capital === settled.capital && back.epoch === settled.epoch, 'same mining state, same chain head');
    check(await phone.spendableBalance() === await aiwa.spendableBalance(), 'same spendable AIWA', await phone.spendableBalance());
    const more = await phone.advanceProgress();
    check(Boolean(more.eventId), 'and it carries on', `epoch ${more.epoch}`);
    const next = await assessSubmission({
      rewardParams: PARAMS, domain: phone.identity.id, baseline: second.baseline, connection,
      evidence: await phone.submissionEvidence({ afterEpoch: second.baseline.epoch, after: second.baseline.head }),
    });
    check(next.ok && next.rejections.length === 0 && next.mining.epoch === epochs + 1, 'the verifier that kept the earlier state accepts what the restored wallet did next', next.ok ? `epoch ${next.mining.epoch}` : next.reason);
    // the other way back: a registry that kept only the state it derived
    const third = new AIWA({ rewardParams: PARAMS });
    await third.connect({ mnemonic: phrase });
    const adopted = await third.adoptState(second.baseline.state);
    check(adopted.adopted && adopted.epoch === epochs, 'a registry\'s kept state also brings the mining back', `epoch ${adopted.epoch}`);
  } finally { node.closeAllConnections(); node.close(); rmSync(dir, { recursive: true, force: true }); }

  // 8. YourMine's registry: the real validate.js (what the GitHub Action runs) on this wallet's own evidence
  const yourmine = option('yourmine', null);
  if (yourmine) await registryStep({ yourmine: resolve(yourmine.replace(/^~/, process.env.HOME ?? '~')), connection, keypair, address, prEvidence, first, phraseUsed: phrase });

  return finish(phrase, signature);
}

async function registryStep({ yourmine, connection, keypair, address, prEvidence, first, phraseUsed }) {
  step('8. YourMine\'s registry: the real validate.js on this wallet\'s own evidence, then a wallet restored from what it keeps');
  const requireFromYourmine = createRequire(join(yourmine, 'package.json'));
  const nacl = requireFromYourmine('tweetnacl');
  const dir = mkdtempSync(join(tmpdir(), 'aiwa-e2e-registry-'));
  let rpcServer = null;
  try {
    for (const f of ['validate.js', 'solana-utils.js', 'aiwa-utils.js']) copyFileSync(join(yourmine, f), join(dir, f));
    symlinkSync(join(yourmine, 'node_modules'), join(dir, 'node_modules'));
    writeFileSync(join(dir, 'files.json'), '[]');
    // what the page pushes: the signed YourMine event, the sphere, and the Aiwa evidence ({ ...evidence, wallet })
    const nonce = `e2e-${Math.random().toString(36).slice(2, 12)}`;
    const code = '/* a sphere */\nwindow.YM_S={};\n';
    const filename = 'e2e.sphere.js';
    const event = { action: 'create', filename, content_hash: createHash('sha256').update(code).digest('hex'), nonce, timestamp: Math.floor(Date.now() / 1000), score: 123, laps: 1, codeUrl: 'https://example.invalid/e2e.sphere.js', wip: false };
    const signature = Buffer.from(nacl.sign.detached(Buffer.from(JSON.stringify(event)), keypair.secretKey)).toString('base64');
    mkdirSync(join(dir, '_pr_content', 'events'), { recursive: true });
    mkdirSync(join(dir, '_pr_content', 'aiwa'), { recursive: true });
    writeFileSync(join(dir, '_pr_content', filename), code);
    writeFileSync(join(dir, '_pr_content', 'events', `${nonce}.json`), JSON.stringify({ ...event, wallet: address, signature }));
    writeFileSync(join(dir, '_pr_content', 'aiwa', `${nonce}.json`), JSON.stringify({ ...prEvidence, wallet: address }));

    let rpcUrl = rpc;
    if (fake) {   // the stand-in Solana, answering the validator over HTTP the way a real RPC would
      rpcServer = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          const call = JSON.parse(body);
          const result = call.method === 'getTransaction' ? connection.rpcTransaction(call.params[0]) : null;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result }));
        });
      });
      await new Promise((r) => rpcServer.listen(0, '127.0.0.1', r));
      rpcUrl = `http://127.0.0.1:${rpcServer.address().port}`;
    }
    const ran = await new Promise((done) => {
      const child = spawn('node', ['validate.js'], { cwd: dir, env: { ...process.env, GH_ACTOR: 'e2e', PR_CONTENT_DIR: '_pr_content', SOLANA_RPC: rpcUrl } });
      let out = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { out += c; });
      child.on('close', (status) => done({ status, out }));
    });
    check(ran.status === 0, 'validate.js accepts the pull request', ran.status === 0 ? '' : ran.out.split('\n').filter(Boolean).slice(-2).join(' | '));
    if (ran.status !== 0) return;
    const result = JSON.parse(readFileSync('/tmp/validation_result.json', 'utf8'));
    check(Math.abs(result.files[0].score - first.ranking.score) < 1e-12 && result.files[0].laps === first.ranking.laps, 'its score and laps are the validator\'s own figure, not the 123 the event wrote', `score ${result.files[0].score}, laps ${result.files[0].laps}`);
    check(result.aiwaBaseline && result.aiwaBaseline.epoch === first.baseline.epoch && result.aiwaBaseline.head === first.baseline.head, 'the baseline it hands to merge.js is the same state at the same chain head');
    // what merge.js writes (aiwa-state.json on main), read back as the wallet reads it, and a wallet restored from it
    const kept = JSON.parse(JSON.stringify({ [address]: { ...result.aiwaBaseline, validatedAt: Math.floor(Date.now() / 1000) } }));
    const lost = new AIWA({ rewardParams: PARAMS });
    await lost.connect({ mnemonic: phraseUsed });
    const adopted = await lost.adoptState(kept[address].state);
    check(adopted.adopted && adopted.epoch === first.baseline.epoch, 'a wallet that lost everything is restored from the file the registry keeps (aiwa-state.json)', `epoch ${adopted.epoch}`);
    const again = await lost.advanceProgress();
    check(Boolean(again.eventId), 'and carries on from the registry\'s chain head', `epoch ${again.epoch}`);
  } finally {
    rpcServer?.closeAllConnections?.(); rpcServer?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function finish(phrase, signature) {
  say(`\n${failed ? `${failed} FAILED, ${passed} passed` : `ALL ${passed} PASSED`}${fake ? '  (against a stand-in Solana: this proved the script, not the network)' : ''}`);
  if (!fake && !failed) {
    say('\nStill by hand — the part that needs GitHub:');
    say('  1. In YourMine: Mine → Create wallet, typing THIS phrase in the "Seed phrase" field (same address, same Aiwa identity).');
    say('     Note: that wallet has the burn above only if it is the same wallet — that is the point of using the same phrase.');
    say('  2. Build → write a sphere → Sign & Submit (opens the pull request; the Action validates it with the same assessSubmission).');
    say('  3. Watch https://github.com/theodoreyong9/YourMinedApp/actions : "Validate" must pass; then aiwa-state.json on main has this wallet.');
    say('  4. Lose it on purpose (clear the site data), log in with the phrase, Recovery → "Restore from the YourMine registry".');
    say(`  phrase: ${phrase}\n  burn:   ${signature}`);
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => { console.error(`\nThe run stopped: ${err.stack ?? err}`); process.exit(2); });
