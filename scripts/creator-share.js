#!/usr/bin/env node
/**
 * What share of the trade tax actually reaches the creator?
 *
 *   node scripts/creator-share.js
 *
 * Ember documents 50%. Their API cannot confirm it: fees24hUsd is exactly
 * 1.000% of volume whatever feeBps is, which would imply a 100% creator share
 * at feeBps 100, so that field is a display convention.
 *
 * This measures money that actually moved instead. For keep-mode tokens -- the
 * only mode where Ember routes nothing to holders or burns -- allTime.paidUsd
 * is what reached the creator and allTime.volumeUsd is what was traded, so
 *
 *     share = (paidUsd / volumeUsd) / (feeBps / 10000)
 *
 * Readings BELOW the true share are expected: paidUsd lags what has been
 * claimed. So the tight upper cluster is the answer, not the average.
 *
 * This is a standalone copy of the same script the (private) keeper ships as
 * scripts/creator-share.js, with the three constants it reads from the
 * keeper's config.js inlined below instead of imported, so it needs nothing
 * from that private repo to run. Re-run it if Ember changes terms.
 */

const EMBER_API = 'https://embercurve.fun/api/solana';
const TAX_BPS = 300;               // $GALAXY's trade tax, 3% -- see llms.txt
const CREATOR_SHARE_BPS = 8_000;   // what llms.txt currently publishes as measured

const MIN_VOLUME_USD = 15_000;

const markets = await fetch(`${EMBER_API}/markets`, { headers: { accept: 'application/json' } })
  .then((r) => r.json())
  .then((j) => j.markets || []);

const rows = markets
  .filter((t) => t.mode === 'keep' && t.allTime && t.allTime.volumeUsd > MIN_VOLUME_USD
    && t.allTime.paidUsd > 0 && t.feeBps)
  .map((t) => ({
    sym: t.symbol || '?',
    feeBps: t.feeBps,
    vol: t.allTime.volumeUsd,
    paid: t.allTime.paidUsd,
    share: (t.allTime.paidUsd / t.allTime.volumeUsd) / (t.feeBps / 10_000),
  }))
  .sort((a, b) => b.share - a.share);

console.log(`keep-mode tokens above $${MIN_VOLUME_USD.toLocaleString('en-US')} volume: ${rows.length}\n`);
console.log('token        feeBps      volume        paid   implied share');
for (const r of rows) {
  console.log(`  ${r.sym.slice(0, 10).padEnd(11)}${String(r.feeBps).padStart(4)}  $${String(Math.round(r.vol)).padStart(9)}  $${String(Math.round(r.paid)).padStart(8)}   ${(r.share * 100).toFixed(1)}%`);
}

/* The cluster: the tightest band holding at least three tokens. Claim lag drags
 * readings down, never up, so the answer is the top of the distribution and not
 * its middle. */
const shares = rows.map((r) => r.share).filter((s) => s > 0.5 && s <= 1);
let best = null;
for (const centre of shares) {
  const near = shares.filter((s) => Math.abs(s - centre) < 0.01);
  if (near.length >= 3 && (!best || near.length > best.n)) {
    best = { n: near.length, mid: near.reduce((a, b) => a + b, 0) / near.length };
  }
}

console.log('');
if (best) {
  const pct = best.mid * 100;
  console.log(`tightest cluster: ${best.n} tokens within 1 point of ${pct.toFixed(1)}%`);
  console.log(`llms.txt currently publishes CREATOR_SHARE_BPS = ${CREATOR_SHARE_BPS} (${CREATOR_SHARE_BPS / 100}%)`);
  const drift = Math.abs(pct - CREATOR_SHARE_BPS / 100);
  console.log(drift > 3
    ? `  MISMATCH -- measured ${pct.toFixed(1)}%, published ${CREATOR_SHARE_BPS / 100}%. Worth a re-check.`
    : '  matches the published value.');
  console.log(`\nat a ${TAX_BPS / 100}% tax that puts ${(TAX_BPS / 10_000 * best.mid * 100).toFixed(2)}% of traded volume into the vault.`);
} else {
  console.log('no cluster found -- not enough keep-mode tokens with paid fees yet.');
}
