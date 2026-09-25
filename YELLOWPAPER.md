# AIWA Yellow Paper

**Causal Coordination and Local Value Accrual for Partition-Tolerant Networks**
Version 3.0 — formal specification, reference implementation

This is a revision of the original AIWA_chain Yellow Paper (v2.0), not a
copy of it — every section below was checked against the current
codebase, not carried over on trust. Sections marked **updated** describe
a mechanism that was redesigned, not merely relocated, during the split
into four repositories — the formula or field shape genuinely changed.
Two sections are new: Delegation (§17) and Bearer vouchers (§18), neither
of which existed in v2.0. A first pass at this revision condensed §11.1,
§12.1, §15.1, §15.2, and §16.1 out entirely without flagging the omission
— caught on review and restored here, updated rather than pasted back
unchanged: §12.1 originally documented a real regression (incremental
wallet materialization, present in v2.0, absent from the current
`aiwa-core` at the time) — **since fixed, along with the other two real
scalability limits it documented; see §12.1 for what changed and what
honest tradeoffs remain**. §16.1 documented a real capability v2.0 could
point to (cross-runtime Rust verification) that no longer existed as a
checked artifact in the current codebase — **since restored**, and now
covering a wider, more current surface than v2.0's own version did (a
real, fully signed event, not a simplified stand-in; a byte-identical,
independently re-derived Ed25519 signature, not merely one that
verifies).

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
  conservation, Mirror, Causal Tick, relative rate,
  content-addressed contract publishing, delegation, and bearer
  vouchers. Depends on nothing of its own — only `@noble/curves`,
  `@noble/hashes`, `@scure/bip39`, and an optional `@solana/web3.js`
  peer dependency for the genesis commitment (§8). 310 passing tests
  (309 pure-JS, plus a real Rust build+run cross-check — §16.1).
- **`aiwa-platform`** — distributed infrastructure with no protocol
  logic of its own: WebRTC transport, a replicator that syncs an
  `aiwa-core` event log between peers, capability-gated data stores, a
  graph materializer, and multi-file bundle publishing (§19). 72
  passing tests.
- **`aiwa-lib`** — the public, developer-facing facade. A real wallet
  API (`AIWA`) composing `aiwa-core`'s validation with `aiwa-platform`'s
  transport, and a smart-contract/token authoring SDK
  (`defineContract`/`Contract`/`signedAction`). 36 passing tests.
- **`AIWA_project`** — one concrete deployment: a single static page, no
  build step, no fixed server, wiring `aiwa-lib`'s API directly to DOM
  elements.

```
       ┌────────────────────────────────────────────────┐
       │ AIWA_project                                   │
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
cost makes churn strictly costlier, not free.

### 8.1 Whether churn pays

Existence of a real cost is not the same claim as sufficiency.
`churn-analysis.js`'s own `compareChurnVsStay` compares one domain that
commits once and matures for the full span against one that restarts
every $k$ epochs, repeatedly re-entering at low $q_{\text{total}}$
where $r$'s own denominator (§7) is smallest:

$$\text{stay} = r(S, N, N, 0) - \mathrm{cost}(0) \qquad \text{churn}(k) = \left\lfloor \frac{N}{k} \right\rfloor \cdot \big[r(S, k, k, 0) - \mathrm{cost}(\text{slot at cycle start})\big]$$

With zero real cost, churn wins outright; with a real, deliberately-chosen
cost curve, churn nets negative while staying nets positive — the
identical $r$, the only real difference being $\mathrm{cost}(\cdot)$'s own
magnitude. `findMostProfitableChurnInterval` sweeps $k$ over a real
candidate range to find an attacker's own real best case, rather than
checking one interval and declaring victory. This is present, unchanged
in purpose, in the current `aiwa-core` — a real calculator, computed per
deployment's own chosen $(\alpha,\beta,\gamma,C)$ and cost curve, never a
general proof that any given tuple is safe. Because §7's own formula
changed (patience rate $T$, restructured denominator), a v2.0-era churn
result does not carry over numerically — the calculator must be re-run
against the current `reward()`, not assumed from the old one.

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

```
Earth               e0 ── e1 ── e2 ── e3 ── e4
domain              (VDF-bound progression, entirely alone —
                      Mars need not exist for any of this)

Mars                                        m0 ── m1 ── m2
domain                                      (its own, independent
                                              progression — no
                                              awareness of Earth)

                                                      │
                          a real connection opens ────┘
                          (WebRTC, a file, anything)
                                                      │
                                                      ▼
Earth               e0 ── e1 ── e2 ── e3 ── e4 ─┐
domain                                          ├── r (Mirror reception
Mars                             m0 ── m1 ── m2 ┘     commitment: "I
domain                                                 observed these")
```

`r` is not a merge and not a correction of either chain — `e4` and
`m2` both remain exactly what they were. `r` is a new, additional
event: a signed statement, by whichever domain builds it, of what it
has now observed of the other. Nothing about `e0..e4` or `m0..m2`
changes; nothing is renumbered, rewritten, or invalidated. Independent
histories stay independent, and become causally correlated the moment
they interact — nothing here forces a shared timeline, a shared
height, or a shared next event.

**Channel versus data.** A transport session (`aiwa-platform`'s
`WebrtcTransport`, or any real link) is inherently temporary. Once real
data has crossed it, that data is verified and stored durably by each
side independently; losing the session never loses what already
crossed. Re-establishing a channel after a gap is a real, ordinary
event, not a failure — the reconciliation logic it feeds (§4) is
agnostic to which transport carried the bytes.

### 11.1 Positioning

Published interplanetary-cryptocurrency proposals generally extend one
Earth-anchored consensus chain across the latency gap — DTN transport,
timelocks widened to light-time, federated or merge-mined settlement —
leaving consensus and issuance untouched. This transfers already-created
value under latency; it leaves creation itself dominated by whichever
side has more compute (mining from Mars against Earth's hashpower is
acknowledged, in that literature, as structurally unprofitable).

AIWA removes value creation from any consensus chain: $\mathrm{epoch}_D$
requires no awareness of one. Reconciliation (§4, §14) is additive and
informational only. This closes the specific asymmetry above; it does
not address real byte transport under latency (deliberately pluggable
— `aiwa-platform`'s own `Replicator`/transport separation, shared
identically by `WebrtcTransport` and any future transport, with room
for a real DTN or dedicated-hardware transport later without touching
reconciliation logic at all) nor an exchange rate between economies
that grew apart.

## 12. Explicit non-claims

Not solved: the human-identity oracle, physical-location verification,
absolute global time, Byzantine agreement without assumptions,
detection of every coalition of identities under one real actor. A
coalition can produce internally consistent history at real cost. The
claim is narrower: fabricated identities cannot fabricate authenticated
history *for free*.

### 12.1 Scalability — three real limits, now addressed, with the honest tradeoffs each one makes

Cross-domain, this scales well by construction — no consensus, no
shared bottleneck. *Within* a single domain, three real costs used to
grow unboundedly. All three are now addressed; none was "solved away"
for free — each trades something explicit and documented, never hidden.

**Local storage — bounded via checkpoints.** A continuously-running
domain still accumulates one event per real progression epoch plus one
per real economic action, forever, *unless* pruned. `aiwa-core`'s
`checkpoint.js` adds a real, self-signed event embedding a domain's own
already-materialized state as of a specific set of log heads
(signer-scoped from the start: `verifyCheckpoint` requires
`event.author === event.payload.domain`, the identical discipline
§7's own `'claim'`/`'accrual'` signer-scoping fix established).
`EventLog.pruneBeforeCheckpoint()` then physically deletes every real
event the checkpoint's own state already accounts for. **Honest
tradeoff, stated plainly**: a peer who already independently verified
everything up to a checkpoint loses nothing by trusting it afterward —
it is genuinely their own, already-verified work, summarized. A
brand-new peer who receives *only* a pruned log can no longer
independently re-derive that state from genesis; they trade full
independent verifiability for a real, signed assertion by the domain's
own key about its own past — the identical tradeoff Ethereum's own
weak-subjectivity checkpoints make, not a flaw specific to this
implementation. Checkpointing is opt-in, not automatic: a domain that
never calls it keeps the original unbounded growth exactly as before.

**Wallet materialization — bounded via incremental folding.**
`materializeWallet` now accepts an optional `baseState` to fold new
events onto instead of replaying from genesis every call;
`aiwa-lib`'s own `AIWA._materializeWallet()` caches the last
materialized state and folds only what's genuinely new since. Three
real bugs surfaced and were fixed while wiring this together with
checkpointing specifically: (1) a checkpoint's own embedded
`progression.lastId` named an event that pruning could delete, fixed by
repointing it to the checkpoint's own id; (2) that fix exposed a
pre-existing, checkpoint-independent bug — `progression.js`'s
causal-chain check requires a domain's last accepted progression event
to be a *direct* parent, which silently broke the instant any other
event (an ordinary `recordCommitment()`, unrelated to checkpointing at
all) became the log's head in between, permanently halting
`claimable()`'s growth from then on — fixed with a new
`progressionParents(heads, lastId)` helper every real progression-event
builder must route through; (3) that fix, in turn, required the
incremental cache's own exclusion boundary to track the real, growing
set of already-covered ids rather than just the latest heads, since the
new helper's extra parent edge can reach past a heads-only boundary. No
tradeoff here beyond the cache being in-memory-per-instance, not
persisted across a reload by itself.

**Unbounded full-sync payload — bounded via chunked, ACK-gated
replication.** `aiwa-platform`'s `Replicator` no longer sends every
missing event (`EventLog.since()`, §3) in one message on connect; it
sorts them topologically and releases bounded chunks (`chunkSize`,
default 100) one at a time, the next only once the previous chunk's own
real ACK arrives — real backpressure, not a fixed delay. **Honest
limit**: the existing `HELLO`/`HELLO_ACK` handshake independently
computes and sends "what's missing" twice per connection by design; in
a narrow timing race, this can cause one redundant, harmless resend of
an already-delivered chunk (absorbed by `EventLog.append()`'s own
idempotency, never a correctness issue) — eliminating it fully would
mean redesigning that handshake, left as future work.

Together these three real fixes close every scalability gap this
section originally documented as open — each one found the next while
being built, none assumed correct without a dedicated test proving it.

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

## 15. Generous transfer — removed

Earlier revisions of this document described a "generous transfer"
contract: a donor optionally, voluntarily attaching a real, additional,
conditional bonus to an ordinary transfer, payable only if a specific,
real, future progression event of the *recipient's own* chain met a
public threshold — a deterministic mechanism, never chance, unpredictable
only because one real input (a real, sequential VDF output) genuinely
did not exist yet.

**No longer true.** `generous-transfer.js` and the composing
`matching-contract.js` (§15.1, below) were real, correctly-ported
AIWA_chain functionality — not invented without basis — but neither
was ever exposed by `aiwa-lib`'s public API nor by any interface built
on it (§15.2's own "honest gap" already said as much: "no equivalent
exists yet in `aiwa-lib` or `AIWA_project`"). Real code, real tests,
zero consumer anywhere in the actual product. Found and removed
together with `contract-scan.js` (a generic event-scanning helper
factored out for these two contracts and one other, adopted by none of
them). Neither `wallet.js`'s own generic `contract-payout`/
`contractVerifiers` extension point (§15.2) nor `contract-registry.js`
(§16) — both genuinely reusable, contract-agnostic infrastructure —
were touched by this removal.

### 15.1 Contract identity and composability — historical

This subsection documented how the now-removed contracts stayed
external to the core protocol: `CONTRACT_ID` embedded in a donor's own
signed commitment rather than mangled into an address (§2's own
address is already a direct cryptographic proof), and how
`registerVerifiedContract` (§16) closed a real collision risk — a
signature alone only ever proves "signed by this key, over this exact
content," never "this is really the trusted module it claims to be,"
so registration re-hashes a contract's own currently-deployed source
against a pinned expected value before trusting its `verifyPayout`.
That collision-risk mechanism (`registerVerifiedContract` itself) is
unchanged and still real — only its two example consumers are gone.

### 15.2 A generic payout mechanism

For a contract's own conditional outcome to move real, spendable AIWA,
some code must apply a real state transition to Conservation's own
claim ledger. `wallet.js` exposes one generic extension point — a
`contractVerifiers` map, $\{\mathrm{contractId} \mapsto
\mathrm{verifyPayout}\}$, supplied by the application, never
`wallet.js`'s own source — so a new contract needs no change to the
core protocol at all, only a growing application-level registry.

**Honest gap, stated plainly.** v2.0's own reference application (the
original AIWA_chain UI) had a real "Give" tab wiring generous transfer
directly into the wallet: sending a bonus alongside an ordinary
transfer, showing pending offers and their resolved outcomes. Neither
that UI nor the underlying `generous-transfer.js`/`matching-contract.js`
it wired into ever gained an `aiwa-lib`/`AIWA_project` equivalent
(§15) — the generic `contractVerifiers` extension point above is real
and tested; no concrete contract currently registers into it in the
current stack.

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

**The same honest gap as §15.2.** v2.0's reference UI had a "Publish a
contract" card and a `scanContractSpecs` listing. Neither has an
`aiwa-lib`/`AIWA_project` equivalent yet — `contract-registry.js` is
real and tested, unused by anything above it in the current stack.

### 16.1 Cross-runtime interoperability — restored, and now covers more than v2.0's own version did

v2.0 claimed a confirmed, independent Rust reproduction
(`interop/rust-vdf/`) of every primitive an external chain's own
adapter would need. An earlier revision of this document verified
directly that no such directory, and no cross-runtime test, existed in
`aiwa-core` at the time — a real, honestly-documented gap, not silently
dropped by omission. **That gap is now closed.** `aiwa-core/interop/rust-vdf/`
is a real, independent Rust implementation, ported from AIWA_chain's
own (the project this codebase was itself ported from) after directly
verifying that `vdf.js`, `weighted-median.js`, `conservation.js`'s
split invariant, `mirror.js`'s monotonicity check, `relative-rate.js`'s
central ratio, `causal-tick.js`'s consistency check,
`wesolowski-vdf.js`, `bigint-math.js`, and
§7's own reward formula (`reward.js`/`fixed-point-math.js`) are
algorithmically identical between the two codebases. (An earlier
revision of this cross-check also covered `generous-transfer.js`'s own
deterministic outcome hash — removed, on both the JS and Rust sides,
together with that file itself; see §15.)

`event.js`'s own canonical id format (§3) genuinely differs from
AIWA_chain's — this project's real, wider
`domain`/`author`/`authorPublicKey`/`parents`/`type`/`payload`/
`createdAt` shape, not a bare `{parents,payload}` pair — so that part
is a real, new implementation, checked against a real, fully signed
`aiwa-core` event rather than a simplified stand-in. It goes further
than v2.0's own version did: alongside recomputing the canonical id,
`ed25519-dalek` (a genuinely different library from this project's own
`@noble/curves`) independently *re-signs* the identical message with
the identical raw secret-key bytes and checks the result byte-for-byte
against the real signature `@noble/curves` produced. Since Ed25519
signing is deterministic (RFC 8032), this is a stronger claim than
mere verification: two independent, conforming implementations must
produce the *identical* signature, not merely one that happens to pass
the other's own check.

`test/rust-interop.test.mjs` builds the real Rust binary, runs it, and
compares its output against the live JS modules' own output for the
identical test vectors, byte for byte — including §7's reward formula
for two real test vectors (a basic case and a full year of continuous
progression, ~112M epochs), both matching AIWA_chain's own
independently-documented values digit for digit. Skips gracefully
(never fails) if no Rust toolchain is available in a given environment
— see `aiwa-core/interop/rust-vdf/README.md` for exactly what this
does and does not claim, and what remains real, separate, undone work
(a genuine multi-runtime implementation of the whole protocol, as
opposed to this cross-check of its most fundamental, custom
computations).

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
| Checkpoints, storage bound (§12.1) | `aiwa-core` | `src/checkpoint.js` |
| Causal Tick (§13) | `aiwa-core` | `src/causal-tick.js`, `src/weighted-median.js` |
| Hardware roots (§13.1) | `aiwa-core` | `src/hardware-attestation.js` |
| Relative rate (§14) | `aiwa-core` | `src/relative-rate.js` |
| Generous transfer (§15) | — | removed; see §15 |
| Single-file contract publishing (§16) | `aiwa-core` | `src/contract-registry.js` |
| Delegation, Channel (§17) | `aiwa-core` + `aiwa-lib` | `aiwa-core/src/wallet.js`, `aiwa-lib/src/wallet.js` (`Channel`) |
| Bearer vouchers (§18) | `aiwa-core` + `aiwa-lib` | `aiwa-core/src/wallet.js`, `aiwa-lib/src/wallet.js` (`issueVoucher`/`redeemVoucher`) |
| Coherent composition (wallet state) | `aiwa-core` | `src/wallet.js`, `src/materializer.js` |
| Transport, replication | `aiwa-platform` | `src/webrtc-transport.js`, `src/replicator.js`, `src/introducer.js` |
| Capability-gated storage | `aiwa-platform` | `src/capability.js`, `src/guarded-data-store.js`, `src/graph-store.js` |
| Multi-file bundle publishing (§19) | `aiwa-platform` | `src/bundle.js`, `src/serve-worker.js` |
| Public wallet API | `aiwa-lib` | `src/wallet.js` (`AIWA`) |
| Smart-contract/token SDK | `aiwa-lib` | `src/contract.js` |
| Cross-runtime interoperability (§16.1) | `aiwa-core` | `interop/rust-vdf/` (Rust), `test/rust-interop.test.mjs` |
| One concrete deployment | `AIWA_project` | `index.html` |

## Status

322 passing tests (`aiwa-core`, including a real Rust build+run
cross-check when a Rust toolchain is available), 77 (`aiwa-platform`),
41 (`aiwa-lib`). Every package is independently, publicly testable;
none depends on a shared, centrally-hosted server to run its own
suite.
