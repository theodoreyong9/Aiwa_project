# AIWA Yellow Paper

**Causal Coordination and Local Value Accrual for Partition-Tolerant Networks**
Version 3.0 — formal specification, reference implementation

This is a revision of the original AIWA_chain Yellow Paper (v2.0), updated
for the current, four-repository architecture. Sections carried forward
describe mechanisms independently confirmed still present and tested in
the current codebase; sections marked **updated** describe a mechanism
that was redesigned, not merely relocated, during that split — the
formula or field shape changed, not just the file path. Two sections are
new: Delegation (§17) and Bearer vouchers (§18), neither of which existed
in v2.0.

---

## Abstract

AIWA is a value-accrual and causal-coordination primitive for networks
under arbitrary delay, intermittent connectivity, and unbounded
partition. It separates two properties conventionally coupled in
distributed ledgers:

**Coordination.** A deterministic causal layer over authenticated events,
rooted in a common genesis. Domains operate while disconnected;
reconciliation is deferred, not required.

**Accrual.** Local, unconditional creation of value, gated at genesis by
an external commitment (§8) and thereafter driven by real sequential
computation (§6) — never by a shared clock.

$$\text{Progression} \to \text{claimable value} \qquad \text{Conservation} \to \text{ownership} \qquad \text{Mirror} \to \text{verifiable history}$$

No component requires a globally synchronized state. The reference
implementation is now split across four packages by concern —
validation (`aiwa-core`), distributed infrastructure (`aiwa-platform`),
a developer-facing facade (`aiwa-lib`), and one concrete deployment
(`AIWA_project`) — described in §0.

---

## 0. Architecture: four packages, one protocol

The specification below is implemented once, in `aiwa-core`, and
composed by everything above it — never reimplemented at a different
layer:

- **`aiwa-core`** — the protocol itself. Identity, the event log and its
  content-addressing, progression, the sequential proof, accrual,
  conservation, Mirror, Causal Tick, relative rate, generous transfer,
  content-addressed contract publishing, delegation, and bearer
  vouchers. Depends on nothing of its own — only `@noble/curves`,
  `@noble/hashes`, `@scure/bip39`, and an optional `@solana/web3.js`
  peer dependency for the genesis commitment (§8). 339 passing tests.
- **`aiwa-platform`** — distributed infrastructure with no protocol
  logic of its own: WebRTC transport, a replicator that syncs an
  `aiwa-core` event log between peers, capability-gated data stores, a
  graph materializer, and multi-file bundle publishing (§19). 72
  passing tests.
- **`aiwa-lib`** — the public, developer-facing facade. A real wallet
  API (`AIWA`) composing `aiwa-core`'s validation with `aiwa-platform`'s
  transport, and a smart-contract/token authoring SDK
  (`defineContract`/`Contract`/`signedAction`). 27 passing tests.
- **`AIWA_project`** — one concrete deployment: a single static page, no
  build step, no fixed server, wiring `aiwa-lib`'s API directly to DOM
  elements.

A consequence worth stating plainly: nothing above `aiwa-core` may alter
what counts as a valid state transition. `aiwa-lib`'s `Channel` and
bearer vouchers are real protocol extensions (§17, §18) — they live in
`aiwa-core`, not layered on top of it, for exactly this reason.

## 1. System model

A domain is an operational environment holding one or more identities
and local state. An identity is a keypair. Communication between
domains is continuous, intermittent, delayed, asymmetric, or absent, for
arbitrary duration.

**Assumed:** collision-resistant hashing, EUF-CMA-secure signatures,
deterministic serialization.
**Not assumed:** a synchronized wall clock, continuous access to any
external chain, a global consensus quorum, a globally replicated state.

## 2. Identity

$$\mathrm{domain}(i) = \mathrm{SHA\text{-}256}(\mathrm{pk}_i)$$

Full 256-bit digest, hex-encoded, untruncated. The private key
authorizes state transitions; no other binding — device, IP, location —
is part of identity. In the current implementation the same Ed25519
keypair also serves as the domain's real Solana address (`aiwa-lib`'s
own `toIdentity()`) — one key, two roles, not two separate credentials
to manage.

## 3. Event log and content addressing — **updated**

State transitions are signed events referencing causal parents. A
participant need not hold every event, only what is relevant to its own
state and observed relationships.

$$\mathrm{id}(e) = \mathrm{SHA\text{-}256}\Big(\mathrm{JSON}\big(\{\mathrm{domain}, \mathrm{author}, \mathrm{authorPublicKey}, \mathrm{parents}: \mathrm{sort}(e.\mathrm{parents}), \mathrm{type}, \mathrm{payload}: \mathrm{canon}(e.\mathrm{payload}), \mathrm{createdAt}\}\big)\Big)$$

where $\mathrm{canon}(v)$ is defined recursively exactly as in v2.0: for
an array, applied element-wise, order preserved; for an object, keys
sorted lexicographically and applied to each value under its sorted
key; otherwise unchanged. **This is genuinely wider than v2.0's own
formula**, which covered only $\{\mathrm{parents}, \mathrm{payload}\}$ —
the current event envelope (`aiwa-core/src/event.js`) binds `domain`,
`author`, the real embedded `authorPublicKey`, and `type` into the same
id and the same signature, closing a real gap the narrower envelope
left open: under the old formula, an event's `type` was not itself
covered by content-addressing, which is exactly the forgery class
`aiwa-lib`'s own `contract.js` documents (§17's own delegation payloads
are deliberately signed over a message that does **not** include
`type`, for the same reason spelled out there).

**Author, present but not blindly trusted.** `author` is carried
directly in the event; a real verifier (`verifyEvent`) independently
re-derives it from the embedded `authorPublicKey` and rejects any event
where they disagree — an event cannot claim an author it cannot really
sign for. A reducer folding events into state, however, is never handed
`author` at all (`adapt-event.js`'s own `toReducerEvent` strips it
before a reducer ever sees the event) — anything a reducer needs to
attribute to a real signer must be a **separately embedded signature
inside the payload itself**, checked by the reducer, never inferred
from the outer envelope. Every payload-level signature scheme in this
document (transfer, split, delegation, voucher redemption,
`signedAction`) exists because of this exact separation.

## 4. Mirror

$M_D \in \{\texttt{empty}, \texttt{full}\}$: a domain $D$'s own signed,
per-epoch commitment to what it has observed of another domain, never a
replica of the observed state.

**Reception monotonicity.** For domain $D$ observing $X$:
$\mathrm{seen}_D(X, e_{i+1}) \geq \mathrm{seen}_D(X, e_i)$ for successive
real commitments $e_i$. A claim of having seen less than previously
committed is rejected.

Mirror does not establish that two domains are distinct real-world
actors, nor rule out a coalition fabricating consistent history together
at real cost. It is evidence about the structure of observed history —
not an identity oracle.

## 5. Progression

$$\mathrm{epoch}_D(n+1) = \mathrm{epoch}_D(n) + 1$$

valid only if causally chained to $D$'s own last accepted transition and
carrying a real sequential proof (§6). Progression is local:
$\mathrm{epoch}_A$ and $\mathrm{epoch}_B$ are never directly comparable.

**Not automatic by default in every deployment, but is in this one.**
`aiwa-lib`'s `startProgressLoop()` calls `advanceProgress()` on a real
timer for as long as a wallet stays connected — matching the original
AIWA_chain's own `vdf-worker.js`, which ran the identical way, without a
manual button. A domain that never calls `advanceProgress()` stays at
epoch 0 and never accrues anything to claim, however much real
wall-clock time passes.

## 6. Sequential proof

$$h_0 = \mathrm{SHA\text{-}256}(\mathrm{seed}), \qquad h_i = \mathrm{SHA\text{-}256}(h_{i-1})$$

seeded from $(\mathrm{domain}, \mathrm{output}_{n-1})$. Symmetric —
verification cost equals production cost — unlike an asymmetric VDF
(Wesolowski, Pietrzak); what is unconditional is that the chain imposes
$\mathrm{iterations}$ genuinely dependent, sequential steps — no amount
of hardware lets a later step be computed before an earlier one. How
much *real time* those steps take is not unconditional: real,
independent SHA-256 benchmarks show roughly a 2–4$\times$ spread
between common hardware with and without dedicated SHA acceleration.

**Locality.** Computation of $h_i$ occurs on exactly one real device at
a time — never distributed, never assisted by other domains. Identity
is the keypair (§2); the computing device may change without
discontinuity in $\mathrm{epoch}_D$.

**Deployment-chosen iteration count.** `aiwa-lib`'s own
`startProgressLoop()` defaults to 100,000 iterations every 30 real
seconds per tick — a deployment's own choice, unrelated to v2.0's own
reference figure of 12,000; the mechanism (§6.1 below, unchanged) is
what's specified here, not any one deployment's constant.

### 6.1 Asymmetric verification (Wesolowski)

The symmetric chain (above) costs a verifier exactly what it cost the
prover. A real Wesolowski VDF, over $\mathbb{Z}_N^*$ for a 2048-bit RSA
modulus $N$ of unknown factorization (the real, published RSA-2048
challenge number), gives verification cost independent of the real
iteration count $T$:

$$y = x^{2^T} \bmod N \qquad \ell = \mathrm{HashToPrime}(x, T, y) \qquad \pi = x^{\lfloor 2^T/\ell \rfloor} \bmod N$$

$$r = 2^T \bmod \ell \qquad \text{Verify: } \pi^{\ell} \cdot x^{r} \stackrel{?}{=} y \pmod N$$

Real prover cost is on the order of $2T$ modular multiplications. Real
verifier cost is $O(\log T)$. $\ell$ is derived deterministically from
$(x, T, y)$ — never accepted as prover-supplied input.

## 7. Accrual — **updated**

$$r(b, q, q_{\text{total}}, T) = \frac{b \cdot q^{\alpha}}{\left[\ln\left(q_{\text{total}}^{\,\beta(1-T)} + C\right)\right]^{\gamma}}$$

| Symbol | Meaning |
|---|---|
| $b$ | committed capital (§8, cumulative) |
| $q$ | epochs since $D$'s own last economic action (burn or claim); resets on each; floored at `minQ` |
| $q_{\text{total}}$ | $D$'s own total progression epoch count; never resets |
| $T$ | **new in this version**: a patience rate, clamped to $[0, 0.4]$ |
| $\alpha, \beta, \gamma, C, \mathrm{minQ}$ | deployment parameters |

**This is a genuinely different formula from v2.0's own**
$R(S,t,A) = S\cdot t^\alpha / [\beta\ln A + \ln(1+C/A^\beta)]^\gamma$ —
not a renaming. The denominator's structure changed (a single
$\ln(\cdot)$ term rather than a sum of two), and a patience-rate term
$T$ was introduced with no v2.0 counterpart. Both versions share the
same *shape* of intent — capital-weighted, epoch-driven, maturity in
the denominator — but a deployment migrating from a v2.0-era parameter
set must re-derive $(\alpha,\beta,\gamma,C)$ against the current
formula; the old values do not carry over unchanged.

**Reproducibility.** Computed in Q128 fixed-point BigInt arithmetic
(`fixed-point-math.js`), never `Math.log`/`Math.pow` — IEEE 754 never
guarantees those agree bit-for-bit across runtimes the way
$+,-,\times,\div$ do, and `reward()`'s output funds a real, on-chain
AIWA claim. `rewardFixed()` is the reproducible core; `reward()` is a
plain-`Number` convenience wrapper over it, identical in behavior.

**Invariant, unchanged from v2.0.** $q$ and $q_{\text{total}}$ are
derived exclusively from $D$'s own verified progression state at query
time — never accepted from an event payload.

## 8. Genesis Commitment — **updated (atomic with the burn)**

$$b_D = \sum_{\text{valid burns}} \mathrm{lamports}_i$$

Activation requires an irreversible SOL burn to Solana's incinerator
address, verified from a finalized transaction record. Cumulative
across every valid burn.

**Atomic in this deployment, where v2.0 left it as two separate
steps.** `aiwa-lib`'s `AIWA.burn(lamports, connection)` broadcasts the
real burn, then immediately, in the same call, records the exact burned
amount as committed capital — one action, matching the original
AIWA_chain UI's own `ignition.js` ("Burn & ignite": one button, one real
signature covers both). An earlier revision of this deployment's own
wallet briefly split this into two separately-clickable steps (burn,
then a manual "record commitment"); found to be a real, if minor,
regression against the original design and reverted before ship.

$R$ is linear in $b$: absent a genesis cost, splitting capital across
identities would not reduce total accrual. A per-identity activation
cost makes churn strictly costlier, not free — see v2.0 §8.1's own
churn-profitability calculator (`churn-analysis.js`, unchanged,
deployment-specific, never a general guarantee for any given parameter
tuple).

**External dependency, unchanged.** Broadcasting a burn requires
reaching a centralized, Earth-hosted RPC endpoint over real internet —
the one exception to this document's own no-shared-infrastructure
principle. Once activated, $\mathrm{epoch}_D$ requires no further
contact with Solana or Earth.

## 9. Conservation

A claim is a tuple $(\mathrm{id}, \mathrm{amount}, \mathrm{owner},
\mathrm{status} \in \{\mathrm{active}, \mathrm{deactivated},
\mathrm{consumed}\})$.

**Split.** $C \to (C_1, C_2)$ where $\mathrm{amount}(C_1) +
\mathrm{amount}(C_2) = \mathrm{amount}(C)$ by construction.

**Transfer, via Deactivate → Prove → Verify → Consume → Activate.**
$\mathrm{proveTransfer}$ requires a real signature verifiable against
$\mathrm{from}$'s own real public key. The proof id is deterministic —
$\mathrm{id} = \mathrm{claimId}{:}\mathrm{from}{:}\mathrm{to}{:}n{:}\mathrm{derivation}$
— and the consumed-proof set is idempotent: a second attempt at the
identical proof is rejected outright, and `deactivate()` refuses a
claim not currently `active`, which is the entire mechanism behind
§18's own "only the first redemption succeeds" — no separate
double-spend logic was written for that property; it falls out of this
one.

**A load-bearing property `owner`/`from`/`to` never enforce, exploited
constructively in §18.** Nothing in `conservation.js` requires these
fields to be real, derivable identities — they are opaque strings.
Ownership of a claim is proven entirely by the signature check in
`proveTransfer`/`verify`, never by any property of the string itself.

## 10. Denomination

$1\ \mathrm{AIWA} = 10^{18}$ base units, always integer, unchanged from
v2.0.

## 11. Partition and reconciliation

Each domain continues independently through partition; none decrements
state for another's unreachability, none awaits permission.
Reconciliation is signature, ancestry, and Mirror-observation
verification over newly available evidence — never a question of clock
authority.

**Channel versus data.** A transport session (`aiwa-platform`'s
`WebrtcTransport`, or any real link) is inherently temporary. Once real
data has crossed it, that data is verified and stored durably by each
side independently; losing the session never loses what already
crossed.

## 12. Explicit non-claims

Not solved: the human-identity oracle, physical-location verification,
absolute global time, Byzantine agreement without assumptions,
detection of every coalition of identities under one real actor. A
coalition can produce internally consistent history at real cost. The
claim is narrower: fabricated identities cannot fabricate authenticated
history *for free*.

## 13. Causal Tick

A domain's own $\mathrm{epoch}_D$ (§5) is unconditional and requires
zero external observers. Causal Tick is a complementary,
externally-corroborated position.

$$\hat{\theta}_X = \mathrm{median}_w\left(\{(\mathrm{obs}_i(X), w_i)\}\right), \qquad w_i = b_i \ (\S8)$$

the crossing-point weighted median: sort estimates by value, walk
cumulative weight, return the first value at or past half the total
real weight. Robust while adversarial weight stays below
$\sum w_i / 2$. **Never a correction** — reported, never applied to any
domain's own earned value.

### 13.1 Hardware roots (optional)

The evidence interface functions on software primitives alone. A
domain may optionally strengthen independence assurance with
physically-provisioned hardware roots; hardware never computes
$\hat\theta_X$, never scales $w_i$, never becomes required input.
$\geq 2$ distinct, independently-issued roots required.

## 14. Relative rate, without a clock

$$w = (\mathrm{observer}, e_O, \mathrm{target}, e_X, \mathrm{sourceEventId}), \qquad \rho = \frac{e_{X,2} - e_{X,1}}{e_{O,2} - e_{O,1}}$$

a purely structural ratio from two successive witnesses. **Purely
informational** — never feeds back into what any domain may claim.

### 14.1 Composition is unsafe without a freshness bound

$\rho_{AB} \cdot \rho_{BC} = \rho_{AC}$ holds mathematically, but is
unsafe to compose across an intermediate domain whose real rate may
have drifted between measurements. `composeRelativeRates` requires the
real, verified epoch gap on the intermediate domain to stay within a
caller-supplied `maxFreshnessGap`, refusing composition outright
otherwise — a mitigation, never a closure.

---

## 15. Generous transfer — deterministic, never chance

A donor may optionally, voluntarily attach a real, additional,
conditional bonus to an ordinary transfer — payable only if a specific,
real, future progression event of the *recipient's own* chain meets a
public threshold. No randomness anywhere: the outcome is a pure
function of public data, unpredictable only because one real input (a
real, sequential VDF output) genuinely does not exist yet — structurally
identical to mining's own real property.

$$h = \mathrm{SHA\text{-}256}(\mathrm{id}(c) \,\|\, \mathrm{vdfOutput}(e_q)) \qquad \text{win} \iff h \text{ has} \geq \mathrm{thresholdBits} \text{ leading zero bits}$$

where $e_q$'s own real VDF proof is independently re-verified (§6),
never trusted from the event's shape alone — two real vulnerabilities
(grinding via cheaply-variable event ids; a fabricated, never-computed
$\mathrm{vdfOutput}$) were found and closed here during v2.0's own
development, unchanged since. `generous-transfer.js`,
`matching-contract.js` (§15.1, a real, second, composing contract), and
the generic `contract-payout` extension point in `wallet.js` (§15.2) are
present and tested unchanged in the current `aiwa-core`.

## 16. Publishing a single contract's source, content-addressed

A plain string contract id (§15.1) carries no cryptographic anchor by
itself. `contract-registry.js` (present, unchanged, in `aiwa-core`)
closes this: a contract's own complete real source is embedded — never
only its hash — in a `contract-spec` event, genuinely recoverable by
anyone who receives it.

$$\mathrm{sourceHash} = \mathrm{SHA\text{-}256}(\mathrm{sourceCode})$$

**No canonical registry, deliberately.** Multiple, real, competing
contracts can coexist under different ids; wallets and users choose
which to trust. This mechanism is for **verifying one file's own
source** against a pinned hash before registering its `verifyPayout`
into `contractVerifiers` (§15.2) — a narrower, different job from §19
below, which publishes and serves a whole, independently-runnable
application.

---

## 17. Delegation — "sign once, then click as many times as you want"

New in this version; absent from v2.0. A real claim owner signs ONE
delegation — $\{\mathrm{delegate}, \mathrm{from}\}$, no amount cap, no
expiry by explicit design — after which a delegate key may move
**and split** the owner's already-owned claims repeatedly, each a
fresh, independent, delegate-signed event, without the owner's own root
key signing again.

$$\mathrm{delegation} = \big(\mathrm{delegate}, \mathrm{from}, \mathrm{ownerPubkey}, \mathrm{Sign}_{\mathrm{owner}}(\{\mathrm{delegate}, \mathrm{from}\})\big)$$

Each subsequent click — `'delegated-transfer'` or `'delegated-split'` —
carries the identical delegation record plus a fresh delegate signature
over the specific action's own fields. A verifier checks **two**
signatures, never one: the embedded delegation signature against
$\mathrm{ownerPubkey}$, and the action's own signature against the
delegate's key that actually signed it — closing the exact forgery §3's
own author/reducer separation warns about (a delegate that signed
something real, but not *this*, must never be accepted for *this*).

**No pre-funding, no escrow, by explicit design.** Issuing a delegation
moves zero funds. The delegate only ever authorizes moving what the
owner already, genuinely owns at click time — a compromised session key
threatens only funds the owner actually holds, for that one
counterparty, same as the root key already could.

**A channel is genuinely self-sufficient once opened, for any amount —
including splitting.** `aiwa-lib`'s `Channel` derives a deterministic
session key (`HMAC-SHA256`, keyed by the owner's own root secret,
seeded by the peer id) — recoverable after a crash, never a randomly
generated, losable throwaway. Because the SAME delegation authorizes
both `'delegated-transfer'` and `'delegated-split'`, a channel never
needs the owner's root key again for any send amount, not only ones
that happen to match an existing claim exactly. Verified directly:
`aiwa.disconnect()` (clearing the root key from memory) does not stop
an already-open channel from sending, splitting, or reporting its
balance.

**Honest limit, by explicit design.** No amount cap, no expiry, no
revocation. A deployment wanting either layers it into its own
`contractVerifiers` (§15.2) instead of forcing it on every caller here.

## 18. Bearer vouchers — a real withdrawal QR

New in this version; absent from v2.0. A real, classic hash-lock — the
same idea a Lightning HTLC or a Bitcoin pay-to-hash-of-a-preimage script
uses — for the one case delegation and ordinary transfer both structurally
cannot cover: **the recipient is unknown until redemption time.**

$$\mathrm{voucherAddress} = \mathrm{SHA\text{-}256}(\mathrm{secret})$$

Issuing needs no new protocol at all: §9's own observation that
`owner`/`from`/`to` are opaque, unvalidated strings means an ordinary,
already-existing signed transfer to $\mathrm{voucherAddress}$ works
today — the issuer's root key signs exactly once, moving already-owned
value to an address no real key controls.

**Redemption.** A `'voucher-redeem'` event reveals $\mathrm{secret}$ and
is signed by the real identity the redeemer wants the value to land in:

$$\mathrm{Sign}_{\mathrm{redeemer}}(\{\mathrm{claimId}, \mathrm{secret}, \mathrm{to}, \mathrm{nonce}, \mathrm{timestamp}\})$$

verified by checking (a) the redeemer's signature really derives $\mathrm{to}$
— closing the same forgery class §17 closes: a real secret, revealed by
someone who does *not* control the claimed destination identity, must
never move value there — and (b) delegating entirely to §9's own
`transfer()` for the actual state change, with $\mathrm{from}$ recomputed
as $\mathrm{SHA\text{-}256}(\mathrm{secret})$.

**"The QR can be copied, but only the first redemption succeeds" —
needed no new double-spend logic.** This is §9's own single-writer
conservation invariant, unmodified: a claim's `deactivate()` throws once
its status is no longer `active`; a second redemption of an
already-consumed voucher is rejected exactly like a replayed ordinary
transfer. Verified directly, at both the protocol layer (two real
redeemers racing for the identical secret — only the first applied
wins) and the wallet-API layer (two genuinely independent, unsynced
wallets, each honestly redeeming the same offline voucher, converge to
exactly one winner once their event logs are synced — never both,
never neither).

**Honest limit, stated plainly, same as any offline transfer (§11).**
This is real double-spend *detection* via reconciliation, not real-time
*prevention*. Two people can each, honestly, offline, redeem the
identical voucher; both believe they succeeded until their logs sync
with each other or the issuer.

---

## 19. Multi-file bundle publishing and sandboxed execution

New in this version; a different mechanism from §16, which publishes
one file's own source for *verification* against a pinned hash. This
publishes and serves a whole, independently-runnable application.

$$e_{\mathrm{file}} = \{\mathrm{type}: \texttt{bundle.file}, \mathrm{domain}, \mathrm{payload}: \{\mathrm{path}, \mathrm{content}\}, \mathrm{parents}: [\,], \mathrm{createdAt}: 0\}$$

$$e_{\mathrm{manifest}} = \{\mathrm{type}: \texttt{bundle.manifest}, \mathrm{domain}, \mathrm{payload}: \{\mathrm{name}, \mathrm{version}, \mathrm{files}: \{\mathrm{path} \mapsto \mathrm{id}(e_{\mathrm{file}})\}\}, \mathrm{parents}\}$$

A file event is deliberately parentless with `createdAt` fixed at 0 —
its own bytes don't causally depend on when or by whom they were
published, only their content does, which content-addressing (§3)
already captures. Publishing the identical file content again (an
unchanged file across two app versions) yields the identical event id —
`EventLog.append`'s own dedup makes this a real no-op, never
retransmitted or duplicated. A manifest's parents are every file event
it references plus the domain's own prior heads, so `EventLog.head()`
naturally resolves to the latest manifest, and a genuine fork (two
competing manifest heads) is surfaced to the caller, never silently
resolved.

**Attribution needs no new protocol either.** `listBundlesByAuthor(log,
authorId)` scans for `bundle.manifest` events whose `author` field —
already cryptographically verified on every append (§3) — matches. "Find
published code by its creator's real address" was already answerable
before this function existed; it only makes the scan convenient.

**Execution: genuine origin isolation, not a convention.** A published
bundle may be arbitrary, untrusted code. `AIWA_project`'s own "Browse
contracts" viewer loads a bundle's `index.html` into a sandboxed
`<iframe sandbox="allow-scripts">` — deliberately never
`allow-same-origin`. This is a real, well-established browser mechanism,
not custom security code: the iframe receives a genuinely opaque
origin, with zero access to the parent page's storage, DOM, or
in-memory identity, enforced by the browser itself. A malicious
contract's own JavaScript can run, but it cannot reach the wallet that
opened it — the isolation does not depend on the contract's own author
behaving.

**Honest limit.** Storage inside a fully opaque origin is unreliable —
a published contract cannot depend on `IndexedDB` persisting across
sessions the way the hosting wallet's own storage does; an in-memory
event log is the safe default for a contract's own internal state.

---

## Reference implementation

| Concept | Package | File |
|---|---|---|
| Identity | `aiwa-core` | `src/identity.js` |
| Event log, content addressing (§3) | `aiwa-core` | `src/event.js`, `src/event-log.js`, `src/adapt-event.js` |
| Sequential proof (§6) | `aiwa-core` | `src/vdf.js`, `src/wesolowski-vdf.js`, `src/bigint-math.js` |
| Progression (§5) | `aiwa-core` | `src/progression.js` |
| Accrual formula (§7) | `aiwa-core` | `src/reward.js`, `src/fixed-point-math.js` |
| Accrual position | `aiwa-core` | `src/accrual.js` |
| Genesis Commitment (§8) | `aiwa-core` | `src/identity-cost.js`, `src/solana-wallet.js` |
| Churn profitability check (§8) | `aiwa-core` | `src/churn-analysis.js` — parameter-specific, not a general guarantee |
| Conservation (§9) | `aiwa-core` | `src/conservation.js` |
| Denomination (§10) | `aiwa-core` | `src/units.js` |
| Mirror (§4) | `aiwa-core` | `src/mirror.js` |
| Causal Tick (§13) | `aiwa-core` | `src/causal-tick.js`, `src/weighted-median.js` |
| Hardware roots (§13.1) | `aiwa-core` | `src/hardware-attestation.js` |
| Relative rate (§14) | `aiwa-core` | `src/relative-rate.js` |
| Generous transfer (§15) | `aiwa-core` | `src/generous-transfer.js`, `src/matching-contract.js` |
| Single-file contract publishing (§16) | `aiwa-core` | `src/contract-registry.js` |
| Delegation, Channel (§17) | `aiwa-core` + `aiwa-lib` | `aiwa-core/src/wallet.js`, `aiwa-lib/src/wallet.js` (`Channel`) |
| Bearer vouchers (§18) | `aiwa-core` + `aiwa-lib` | `aiwa-core/src/wallet.js`, `aiwa-lib/src/wallet.js` (`issueVoucher`/`redeemVoucher`) |
| Coherent composition (wallet state) | `aiwa-core` | `src/wallet.js`, `src/materializer.js` |
| Transport, replication | `aiwa-platform` | `src/webrtc-transport.js`, `src/replicator.js`, `src/introducer.js` |
| Capability-gated storage | `aiwa-platform` | `src/capability.js`, `src/guarded-data-store.js`, `src/graph-store.js` |
| Multi-file bundle publishing (§19) | `aiwa-platform` | `src/bundle.js`, `src/serve-worker.js` |
| Public wallet API | `aiwa-lib` | `src/wallet.js` (`AIWA`) |
| Smart-contract/token SDK | `aiwa-lib` | `src/contract.js` |
| One concrete deployment | `AIWA_project` | `index.html` |

## Status

339 passing tests (`aiwa-core`), 72 (`aiwa-platform`), 27 (`aiwa-lib`).
Every package is independently, publicly testable; none depends on a
shared, centrally-hosted server to run its own suite.
