# Releasing the Aiwa repositories

They depend on each other **by commit** (lock files; YourMine's `package.json`), so a change is only in the next repository once
its pin moves. One direction, one order:

```
Aiwa_core → Aiwa_platform → Aiwa_lib → Aiwa_project → YourMinedApp
                                          │              ▲
                                          └ Pages build publishes aiwa.bundle.js, which YourMine LOADS WHEN IT RUNS
```

1. **Core** change: push it; CI green.
2. **Platform** / **Lib**: move their pins to the new core (`package-lock.json`, the `resolved` hash of `aiwa-core`), push; CI green.
3. **Project**: move its pins (lib, core, platform), push. **Wait for the Pages deploy** (Actions → "Deploy to GitHub Pages"):
   until it is done, `aiwa.bundle.js` is the old one.
4. **YourMine**: only now, if its code needs something new from the bundle (a function of the lib it calls). Its `package.json`
   pins core for the validator (`validate.js`, run by the GitHub Action).
5. `node scripts/check-pins.mjs` says which pin is behind the HEAD of what it depends on. "Behind" is not always wrong (a
   README-only commit upstream changes nothing for the dependant); look at the commits after the pinned one before moving it.

The widget (`Aiwa_widget`) is independent of this chain: its CI builds the APK, its backend runs in Termux.

## Formats are frozen (v1)

The signed shapes — the payload of progression, accrual and claim events (including `previous`), the starting point of the work of
an epoch, the checkpoint and the backup, the archive node's protocol — are **version 1 and frozen since 2026-10-02**. Changing any of
them resets the wallets that already exist (it did, three times, on 2026-10-01); from now on that is a version 2, with a way for
v1 wallets to carry over, decided before it is written — not a fix made on the way.

## Before calling something done

`npm run e2e:fake` (a dry run of the whole path) always; `npm run e2e:devnet` (the same on the real Solana devnet) before
anything that touches the burn, the verifier or the backup. See the README.
