# AIWA_project

A real wallet interface for AIWA — connect, balance, burn, claim,
send/receive (including fully offline via QR/Share), and a real
delegated "sign once, click as many times as you want" channel. A
single static page (`index.html`), no build step, no server: it opens
directly against [`aiwa-lib`](https://github.com/theodoreyong9/Aiwa_lib),
which composes [`aiwa-core`](https://github.com/theodoreyong9/Aiwa_core)
(validation) and [`aiwa-platform`](https://github.com/theodoreyong9/Aiwa_platform)
(distributed infra). This document describes what the page actually
does today — not a changelog, not a roadmap. For the formal protocol
specification — identity, the event log, progression, accrual,
conservation, delegation, bearer vouchers, and everything else that
lives in `aiwa-core` rather than in this page — see
[`YELLOWPAPER.md`](./YELLOWPAPER.md).

## Where this sits

```
       ┌────────────────────────────────────────────────┐
       │ AIWA_project  <-- you are here                 │
       │ one concrete deployment (a single static page, │
       │ no build step, no fixed server)                │
       └────────────────────────────────────────────────┘
                                │
                                │  imports all three, directly
                                ▼
              ┌──────────────────────────────────┐
              ▼                                  ▼
┌───────────────────────────┐      ┌───────────────────────────┐
│ aiwa-lib                  │      │ aiwa-platform             │
│ public wallet API (AIWA), │      │ transport, replication,   │
│ Channel, contract SDK     │      │ capability-gated storage, │
│                           │      │ bundle publishing         │
└───────────────────────────┘      └───────────────────────────┘
              │                                  │
              └────────────────┬─────────────────┘
                               ▼
       ┌──────────────────────────────────────────────┐
       │ aiwa-core                                    │
       │ the protocol itself: identity, event log,    │
       │ progression, accrual, conservation, Mirror,  │
       │ Causal Tick, contracts, delegation, vouchers │
       │                                              │
       │ depends on nothing of its own - only         │
       │ @noble/curves, @noble/hashes, @scure/bip39,  │
       │ optional @solana/web3.js                     │
       └──────────────────────────────────────────────┘
```

This page never reimplements protocol logic — everything it does is a
direct call into `aiwa-lib`'s API, wired straight to DOM elements.

## Running it

```
npm install
python3 -m http.server 8080   # from this repo's own root — ES modules and IndexedDB both refuse a file:// origin
```
then open `http://127.0.0.1:8080/index.html`.

## Interface: four tabs, installable

The page is organized into four tabs (`Wallet`, `Operations`,
`Channel`, `Contracts`) behind a responsive nav — icon+label side by
side on wider screens, icon-above-label once the viewport gets narrow
enough that the two wouldn't both fit. `Wallet` holds Connect and both
balance panels; `Operations` holds Send/Receive/Withdraw plus a real
**History** panel (below); `Contracts` is unchanged in substance, just
its own tab now.

**`Channel` is a real, standalone wallet once open** — not just
Send. Opening a channel needs the root key once (its one-time
delegation); every real capability below it needs no root connection
at all afterward, exactly mirroring `aiwa-lib`'s own `Channel` API:
Send, **Claim** (moves currently-claimable value into a real,
spendable claim for the real owner), **Receive a bundle** (accepts an
already-signed incoming transfer — this one never actually needed a
channel at all, since `aiwa.receiveOfflineBundle()` never signs with
your own key, but lives here so every disconnected-capable action is
in one place), **Withdraw** (issue a real bearer QR redeemable by
whoever scans it first, and redeem one, both through the channel),
and **Publish a contract** (through the channel's own session
identity — see `aiwa-lib`'s own README for the honest limit this
carries: discoverable by address, but not via "list by creator" for
your root id, since the real cryptographic author is the channel's
session identity here). Verified live, through this exact UI, fully
disconnected: claim, receive, issue+redeem a voucher, and publish (and
have it show up in `Contracts`' own browse-by-address) all work with
no root identity connected.

**History** is not a separate ledger kept alongside the wallet — it's
read directly from the real event log (`aiwa.log.since([])`) on every
view, filtered to the events that actually belong to the connected
identity (commitments, claims, transfers in and out, channel sends,
voucher redemptions) and resolved against the real, materialized
conservation state for each one's actual amount, never a value stored
redundantly. There is no separate source of truth to drift from what
the wallet itself already computes.

It's also a real PWA: `manifest.webmanifest` + `sw.js` make it
installable (a real "Add to Home Screen" / install prompt, standalone
window, its own icon — generated deterministically by
`scripts/generate-icons.mjs`, the same hand-rolled, dependency-free PNG
encoder AIWA_chain's own icon generator uses, adapted to this page's
own accent colors). **Deliberately different from AIWA_chain's own
service worker**: that one hand-enumerates every real file it ships,
which works because `public/app`/`public/core` are this project's own
files. Here, `aiwa-core`/`aiwa-lib`/`aiwa-platform` are real git
dependencies under `node_modules/` whose exact file set can change
between installs — a hand-enumerated precache list would have a real
chance of 404ing on some future dependency update and failing the
entire service worker install. Instead, `sw.js` precaches only the
small, guaranteed-stable shell (`index.html`, the manifest, the
stylesheet, the icons) and caches every other same-origin file
opportunistically as it's actually fetched, network-first — after one
normal online visit, everything this page actually needed is already
cached, and a later offline visit is served from it.

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
  the real bug this distinction fixed). **The live-network path had two
  real bugs** (`aiwa-lib`'s own `send()` never actually published new
  events to an already-connected peer, and even after that fix, never
  bundled the full ancestor chain a peer without prior sync needed) —
  found and fixed in `aiwa-lib`, then re-verified directly against
  THIS page's own "Join network"/"Send over the network" buttons: two
  real, separate browser contexts, real WebRTC, peers connected before
  any funding or sending happened (the exact ordering that was
  silently broken before), a real send through the actual UI button,
  and the recipient's own real balance updating correctly.
- **Receive**: pastes or scans (via the browser's native
  `BarcodeDetector`, where supported) a real offline bundle and appends
  it — real signature and causal verification, identical to any other
  real append; a forged or tampered bundle is rejected, not silently
  accepted.
- **Withdraw — a real bearer QR**: a genuinely different primitive from
  Send/Receive — the recipient is unknown until redemption time.
  Generates a real hash-locked withdrawal code (`aiwa-lib`'s own
  `issueVoucher`/`redeemVoucher`); whoever scans or pastes it first
  genuinely gets the value. The code can be freely copied, screenshot,
  forwarded — only the first real redemption succeeds, an honest
  property of `aiwa-core`'s own single-writer conservation model, not
  new double-spend logic. Same "detection via reconciliation" honest
  limit as any offline send: two people can each locally believe they
  redeemed it until their logs sync.
- **Channel — sign once, click as many times as you want**: opens a
  real, per-peer delegated-send session (`aiwa-core`'s own real
  delegation mechanism) with ONE real signature from your root key, no
  pre-funding, nothing escrowed. Every subsequent click signs with an
  already-unlocked, real, deterministic session key alone — recoverable
  even after a crash, since it's derived from your own root key plus
  the peer's id, never randomly generated. Genuinely self-sufficient
  once open: clicking **Disconnect** does not stop it — a click that
  needs splitting a claim into the exact amount still works, real
  delegated split and all, with no root key involved for any amount.
- **Publish a contract / Browse contracts**: publishes a real, signed,
  addressable bundle via `aiwa-platform`'s own real `publishBundle` —
  real content-addressed dedup, real version history, a real fork
  surfaced rather than silently resolved. The address bakes in your
  real identity id (`contract:<your id>:<name>`), and any bundle is
  independently discoverable by its own address or by its creator's
  real id (`listBundlesByAuthor` — no new protocol, since every
  event's author is already cryptographically verified) even without
  that convention. **Opening** a published contract loads it into a
  real sandboxed `<iframe>` — `sandbox="allow-scripts"` with NO
  `allow-same-origin` — a genuinely different, opaque browser origin
  with zero access to this page's identity or storage, enforced by the
  browser itself, not by any code this project wrote. A contract can
  therefore be arbitrary, untrusted code: the isolation is real, not a
  convention anyone publishing here has to honor. The starter template
  (a real, working mint/transfer token using `aiwa-lib`'s own
  `defineContract`/`Contract`/`signedAction` SDK) generates its own,
  separate identity the instant it opens — it can never see yours.

  A published contract isn't limited to single, one-shot transfers —
  [`examples/channel-contract.html`](examples/channel-contract.html)
  is a real, standalone demo of a contract that opens its own real
  delegated `Channel` (see above) over its own, independent
  `WebrtcTransport`, entirely separate from whatever wallet published
  or opened it: two of its own identities, a real signaling exchange,
  a real `openChannel()`, and repeated real `channel.send()` clicks —
  no simulation. Verified live via Playwright: a real WebRTC data
  channel opens, funding happens, the channel opens, and each click
  moves real value with the recipient's balance updating correctly.

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
- **The starter contract template's own imports** point at this same
  site's real, already-deployed `node_modules/aiwa-lib`/`aiwa-core`
  files (`https://theodoreyong9.github.io/Aiwa_project/node_modules/...`)
  — real, live URLs (confirmed reachable once this repo's own Pages
  deploy is live), but this environment's egress policy blocks
  `github.io` too, so a published contract's own code actually
  *running* inside its sandboxed iframe was not exercised here. What
  *was* verified live: publishing (a real signed bundle, a real
  derived address), discovery by address and by creator, and the
  iframe genuinely receiving the right `srcdoc` with a confirmed
  `sandbox="allow-scripts"` and no `allow-same-origin` — a real,
  opaque, isolated origin, checked directly rather than assumed.

Everything else described above — connect/disconnect, claim, send/receive
(network and offline), and the channel's full set of capabilities
(send, claim, receive, issue+redeem a voucher, publish a contract, all
fully disconnected from the root identity) — was verified live, end to
end, in
a real Chromium browser via Playwright, including the real VDF
progress loop actually growing claimable over real wall-clock time,
and a real forged-bundle rejection. The tabbed navigation, History
(rendering real commit/claim/send/receive/channel/voucher-redeem
entries with real, resolved amounts after a real funding+send+receive
sequence), and the PWA manifest + service worker (resolves, registers,
and reaches an `active` state) were all verified the same way, in the
same real browser.

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
