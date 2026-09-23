# AIWA_project

A real wallet interface for AIWA — connect, balance, burn, claim,
send/receive (including fully offline via QR/Share), and a real
delegated "sign once, click as many times as you want" channel. A
single static page (`index.html`), no build step, no server: it opens
directly against [`aiwa-lib`](https://github.com/theodoreyong9/Aiwa_lib),
which composes [`aiwa-core`](https://github.com/theodoreyong9/Aiwa_core)
(validation) and [`aiwa-platform`](https://github.com/theodoreyong9/Aiwa_platform)
(distributed infra). This document describes what the page actually
does today — not a changelog, not a roadmap.

## Running it

```
npm install
python3 -m http.server 8080   # from this repo's own root — ES modules and IndexedDB both refuse a file:// origin
```
then open `http://127.0.0.1:8080/index.html`.

## What's real here

- **Connect / disconnect**: derives or generates a real Ed25519
  keypair — from a real BIP39 mnemonic, or freshly generated if none is
  given — that serves as BOTH your real Solana address and your AIWA
  identity (same curve). Disconnecting clears it from memory only;
  your own already-synced local data (in a real, persistent IndexedDB
  database) is untouched and reloads the moment you reconnect with the
  same key.
- **Address / Solana balance / Burn**: the real address is always
  shown once connected. Solana balance and burn both make a real
  on-chain call through a real `@solana/web3.js` `Connection` (RPC
  endpoint configurable, defaults to devnet) — burn sends real lamports
  to Solana's own real incinerator address, real and irreversible.
- **AIWA balance, claimable, claim**: "Spendable now" is the real sum
  of your own already-claimed, active claims — what `Send` can
  actually move. "Claimable" is real, accrued-but-not-yet-claimed value
  from `aiwa-core`'s own progression/reward mechanism, growing only as
  real VDF proofs are computed (the "Start progress loop" button — real
  computation, not simulated, ticking every 30 real seconds while the
  page is open). "Claim" moves claimable into a real, spendable claim
  with one real signature.
- **Send AIWA**: real, signed transfers, either broadcast to a real,
  live P2P session ("Join network", using `aiwa-platform`'s real
  `WebrtcTransport`) or generated as a fully offline bundle — real
  signed events plus every real ancestor event a stranger with zero
  prior sync would need, encoded as a compact string. "Max" fills in
  exactly what's genuinely spendable, never the inflated total that
  also includes not-yet-claimed value (see aiwa-lib's own README for
  the real bug this distinction fixed).
- **Receive**: pastes or scans (via the browser's native
  `BarcodeDetector`, where supported) a real offline bundle and appends
  it — real signature and causal verification, identical to any other
  real append; a forged or tampered bundle is rejected, not silently
  accepted.
- **Channel — sign once, click as many times as you want**: opens a
  real, per-peer delegated-send session (`aiwa-core`'s own real
  delegation mechanism) with ONE real signature from your root key, no
  pre-funding, nothing escrowed. Every subsequent click signs with an
  already-unlocked, real, deterministic session key alone — recoverable
  even after a crash, since it's derived from your own root key plus
  the peer's id, never randomly generated.

## What isn't verified here, and why

This page was built and tested in a sandboxed environment whose own
egress policy blocks `esm.sh` entirely — the same CDN `aiwa-core`'s own
`solana-wallet.js` already uses (unchanged here) to lazily load
`@solana/web3.js`, and that this page also uses for the `qrcode`
library. Two concrete, honest consequences:

- **Real Solana RPC calls** (balance, burn) could not be exercised
  against a real network in this environment. The code path is the
  identical one `aiwa-core`'s own tests document as needing a real
  browser + real network to verify — expected to work against a real
  RPC endpoint with normal internet access, not independently confirmed
  here.
- **QR code rendering** could not be verified for the same reason. The
  underlying real bundle creation and encoding (`sendOfflineBundle`/
  `encodeOfflineBundle`) is fully verified — the send is genuinely
  final, real signature and all, whether or not the QR image itself can
  render — but the visual QR canvas has not been confirmed to actually
  draw. A QR rendering failure is deliberately non-fatal: the send
  already succeeded, and `Share`/`Copy` remain available regardless.

Everything else described above — connect/disconnect, claim, send/receive
(network and offline), the channel — was verified live, end to end, in
a real Chromium browser via Playwright, including the real VDF
progress loop actually growing claimable over real wall-clock time,
and a real forged-bundle rejection.

## Real economic parameters

`REWARD_PARAMS` in `index.html` (`{alpha, beta, gamma, C, minQ}`) is
the same placeholder value `aiwa-core`'s own test suite uses — not a
real, deployment-chosen economic model. A real deployment of this page
replaces it with its own real, chosen parameters before anyone
connects a real wallet to it.

## Where the real logic actually lives

This repository is deliberately thin: a single HTML page wiring up
`aiwa-lib`'s own real, already-tested `AIWA`/`Channel` classes to DOM
elements. Every real financial rule — the reward curve, conservation,
double-spend detection, delegation — lives in `aiwa-core`, and every
real distributed-systems piece — transport, replication, the offline
bundle's ancestor collection — lives in `aiwa-platform`/`aiwa-lib`,
independently tested there. See those repos' own READMEs for what's
proven and what isn't.
