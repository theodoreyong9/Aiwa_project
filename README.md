# AIWA_project

The AIWA wallet page: connect, burn, claim, send, receive (QR), contracts, browse. A single static page
(`index.html`), no build step, no server: it opens directly against
[`aiwa-lib`](https://github.com/theodoreyong9/Aiwa_lib), which composes
[`aiwa-core`](https://github.com/theodoreyong9/Aiwa_core) (validation) and
[`aiwa-platform`](https://github.com/theodoreyong9/Aiwa_platform) (distributed infra). This document describes what
the page does today, not a changelog. For the formal protocol — identity, the event log, progression, accrual,
conservation, and everything else that lives in `aiwa-core` rather than in this page — see
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

## Interface: three tabs, installable

- **Wallet** — Connect; then the balance (spendable, claimable, **Claim**), your identity id and Solana address
  (Copy), **Burn**, **Send**, **Receive**, and History (read from the event log, never a separate ledger).
- **Contract** — publish a contract: signed with your identity, content-addressed, immutable once published.
- **Browse** — open a contract by address, or list what an identity published.

Dark and light follow the system; a phone width is a single column, with no sideways scroll.

**What the page leaves out, on purpose.** Live peer connections (WebRTC offer/answer), channels (delegated session
keys), bearer withdrawal QR codes (vouchers) and a separate "offline bundle" feature are not in this page. They stay in
`aiwa-lib` / `aiwa-platform`, which expose them to any other front end. Consequences: there is no "send over the
network" and no automatic sync with a peer — **Send and Receive are one QR (or copy/paste, or share sheet)** — and
Browse sees what is in *this device's* log: what you published, and what you received.

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

- **Connect / disconnect**: derives or generates a real Ed25519 keypair — from a BIP39 recovery phrase, or freshly
  generated if none is given — that serves as BOTH your Solana address and your AIWA identity (same curve).
  Disconnecting clears it from memory only; your local data (a persistent IndexedDB database) reloads the moment you
  reconnect with the same key.

- **Address / Solana balance / Burn**: the real address is always
  shown once connected. Solana balance and burn both make a real
  on-chain call through a real `@solana/web3.js` `Connection` (RPC
  endpoint configurable, defaults to devnet) — burn sends real lamports
  to Solana's own real incinerator address, real and irreversible.
  **The burn is what backs your capital — mandatory** (yellow paper §8.2): after broadcasting, the wallet asks Solana
  for the *finalized* transaction, checks that it is a burn paid by your own key, publishes it (the signature only)
  and only then commits the capital; committing without a burn is refused. To credit **another** domain's capital
  the wallet must have confirmed that domain's burn against Solana too: the page gives the wallet its Solana
  connection once it is connected, and confirmation then happens by itself when events arrive. This concerns where
  value is *minted*, not who passes it on: a coin received through someone who never burned anything is fine, as long
  as the wallet has confirmed the burn of the domain that minted it. Offline, no newly minted value is credited
  until a connection exists; value already in the wallet is untouched. Not exercised against a real Solana
  endpoint from the build environment (see below).

- **Balance, claimable, claim**: "Spendable" is the sum of your own already-claimed, active claims — what Send can
  move. "Claimable" is accrued-but-not-yet-claimed value, growing as epochs of real sequential work are done (the progress
  loop starts by itself when you connect: one epoch is 100 000 modular squarings and its proof, about every 30 s, written
  as an event of about 2 KB that anyone verifies in milliseconds — measured in Chromium on this very page). **Claim** moves
  claimable into a spendable claim with one signature.
- **"Last action" mining and T**: the line under the balance says what mines — the capital of your last burn, its **T**, the
  epoch and how many epochs since your last action. **T** (0 to 40 %, next to the amount to burn) is the patience rate you
  choose at the burn for what follows: it makes the reward curve more generous and **costs that share of the burn**, which
  is destroyed without counting (the page says what counts as capital before you burn). A burn **replaces** your position and
  **pays what the previous one accrued** as a spendable claim; a small burn after a big one lowers what mines. Logs written
  by the earlier version of this page (hash-chain epochs, cumulative capital) are not carried over: this deployment now
  requires the proof of the work of an epoch.

- **Catching up since last checkpoint**: connecting shows a real
  progress bar while a genuinely large backlog since your last local
  checkpoint is folded (`aiwa.onMaterializeProgress`, wired straight
  through to `aiwa-lib`'s own materialization) — the same concern the
  original AIWA_chain's "loading since last snapshot" indicator
  addressed, for the same reason: an unbounded, unsynced backlog is a
  real, unbounded-time replay from genesis on a cold load. A small,
  routine fold stays silent, same as before. `aiwa.startAutoCheckpoint()`
  now also runs automatically once connected, so that backlog stays
  bounded going forward instead of growing indefinitely between
  checkpoints.

- **Send / Receive**: a signed transfer plus every ancestor event a stranger with no prior sync needs, encoded as a
  compact string — shown as a QR, or copied, or shared. Receive scans it (the browser's `BarcodeDetector`, where
  supported) or takes it pasted, and appends it with the same signature and causal verification as any other append; a
  forged or tampered code is rejected, not silently accepted. Send moves what is *spendable*, never the total that
  includes not-yet-claimed value. A QR that cannot be drawn is not fatal: the send is already final, Share and Copy
  stay.

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

  **Opening the form pre-filled from the Aiwa Android app (`#publish=1;<name>;<code>`).**
  [Aiwa](https://github.com/theodoreyong9/Aiwa_widget) has Claude write a contract — one
  self-contained `index.html` — and opens this page with the file in the URL *fragment*
  (raw-deflated, then base64url-encoded; a fragment is never sent to a server). Once your wallet
  is connected, the *Contract* tab holds the name, version `1.0.0` and
  the code — and nothing more: reading it and pressing **Publish** (which signs with your identity)
  stay yours. Not connected yet, the Wallet tab stays in front with a note, and the form is filled the
  moment you connect. Anything not matching that exact shape is ignored. Checked in Chromium on this
  very page (real connect, real form; 6.7 KB contract byte for byte; garbage and foreign fragments ignored).

  [`examples/channel-contract.html`](examples/channel-contract.html) is a standalone example of a contract that is
  more than a one-shot transfer: it opens its own `aiwa-lib` `Channel` over its own `WebrtcTransport`, entirely
  separate from whatever wallet published or opened it. It is a contract, not a feature of this page.

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

Everything else above — connect/disconnect, claim, the tabs, History, the PWA manifest and service worker, the
contract publish/browse flow — was exercised in Chromium through the real page (a desktop and a
phone width, light and dark), with the real `aiwa-lib`. Send/Receive were exercised for their messages (nothing to
send, garbage refused); the full value path needs a confirmed burn, which needs real Solana.

## Real economic parameters

`REWARD_PARAMS` in `index.html` (`{alpha, beta, gamma, C, minQ}`) is
the same placeholder value `aiwa-core`'s own test suite uses — not a
real, deployment-chosen economic model. A real deployment of this page
replaces it with its own real, chosen parameters before anyone
connects a real wallet to it.

## Where the real logic actually lives

This repository is deliberately thin: a single HTML page wiring up
`aiwa-lib`'s own real, already-tested `AIWA` class to DOM
elements. Every real financial rule — the reward curve, conservation,
double-spend detection, delegation — lives in `aiwa-core`, and every
real distributed-systems piece — transport, replication, the offline
bundle's ancestor collection — lives in `aiwa-platform`/`aiwa-lib`,
independently tested there. See those repos' own READMEs for what's
proven and what isn't.
