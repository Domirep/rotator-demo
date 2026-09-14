# ROTATOR

**Live: https://galaxymet.pages.dev**

A 3-minute game on Solana. Eight real memecoins race. Every eligible holder of
$GALAXY is assigned to one. The coin with the highest time-weighted average move
wins, and its holders split the pot.

> ## Status: LIVE (launched 2026-09-14)
>
> **$GALAXY exists.** Mint `9n3AqW2xLVqh5qyMzaztZqKbgN4uudXgGTfbANoWv4bF`,
> 1,000,000,000 supply, mint/freeze authority both revoked, trading live via a
> Meteora DBC pool. The page in this repo talks to the real keeper: rounds,
> wallets, pots and payouts are real, paid in MET.
>
> **`llms.txt` is filled in and current** — `__GALAXY_MINT__` and
> `__FEE_VAULT__` were placeholders before launch; both are now real
> addresses. `scripts/preflight.js` decodes the live fee vault and checks it
> against the split `llms.txt` publishes; it exits 0 ("Safe to publish") as
> of this launch, and blocks publishing again the moment the two drift.
>
> Fees are held by Meteora's **Dynamic Fee Sharing** program
> (`dfsdo2UqvwfN8DuUVrMRNfQe11VaiNoKcMqLHVvDPzh`), not by a program of ours.
> It is open source, already live, and has no instruction that can edit a
> vault's recipient list — `transfer_pool_creator` has run, so that list is
> now permanent. Meteora itself can still upgrade the program; that's
> disclosed in `llms.txt`, not hidden.

## What's here

| | |
|---|---|
| `index.html` | the whole site — launch bay, explainer, FAQ, 3 languages |
| `i18n.js` | copy in English, 简体中文 and Español |
| `llms.txt` | every address and formula needed to recompute any round |
| `scripts/preflight.js` | blocks publishing until on-chain state matches the claims |

No build step. It is one HTML file, one JS file, one image.

## Running it

Serve the folder over HTTP and open `index.html`:

```bash
python -m http.server 8899
```

Useful query parameters:

| | |
|---|---|
| `?sim=1` | simulate price movement so a full round can be watched offline |
| `?at=172` | start a round already 172s in, for capturing the T-0 moment |
| `?lang=zh` / `?lang=es` | open directly in a language |
| `?api=<url>` | read rounds from a keeper instead of simulating |

Without `?api=`, or if the keeper is unreachable, the page falls back to a local
simulation and says so in the banner rather than sitting blank.

## Verification

The claim this project rests on is that you never have to trust the operator
about who won. Round seeds come from finalized Solana blockhashes, pad
assignment is `sha256(address ‖ seed) mod 8`, and every price sample is
published — so any round can be recomputed from public data.

The same formula runs in the browser and in the keeper, deliberately, so a
player checking their own assignment cannot disagree with the payout.

See `llms.txt` for the full method, including what is **not** yet true.

## Is it gambling

Assignment is random and money changes hands on the outcome. Treat it
accordingly. Rules vary by jurisdiction and are the player's responsibility.
