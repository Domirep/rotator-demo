#!/usr/bin/env node
/**
 * Refuses to let the site go live while llms.txt claims something the chain
 * does not support.
 *
 * llms.txt is written in the live voice on purpose — it is the launch-day
 * document. This script is what keeps that from becoming a false claim.
 *
 * The fee stream is held by a Meteora Dynamic Fee Sharing vault, not by a
 * program of ours. That program is upgradeable by Meteora and always will be,
 * so "upgrade authority is null" is the wrong thing to check. What is worth
 * checking, and what this does, is stronger:
 *
 *   1. no unfilled placeholders
 *   2. the fee vault exists and is owned by the Dynamic Fee Sharing program
 *   3. the recipients and shares ON CHAIN match the split published in the file
 *   4. the file discloses Meteora's upgrade authority, and it matches the chain
 *
 * (3) is the real guard: it compares what we tell people against what the vault
 * will actually pay, so the two cannot drift.
 *
 *   node scripts/preflight.js
 *
 * Exit 0 = safe to publish. Anything else = do not publish.
 */

import fs from 'node:fs';

const RPC = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
// Overridable ONLY so the gate itself can be tested against a real fee vault
// before launch day. Production always checks the real file.
const FILE = process.env.LLMS_FILE || 'llms.txt';
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const DFS_PROGRAM = 'dfsdo2UqvwfN8DuUVrMRNfQe11VaiNoKcMqLHVvDPzh';

const fail = [];
const warn = [];
const ok = [];

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 160));
  return j.result;
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes) {
  let d = [0];
  for (const by of bytes) {
    let c = by;
    for (let i = 0; i < d.length; i++) { c += d[i] << 8; d[i] = c % 58; c = (c / 58) | 0; }
    while (c) { d.push(c % 58); c = (c / 58) | 0; }
  }
  let s = '';
  for (const by of bytes) { if (by === 0) s += B58[0]; else break; }
  return s + d.reverse().map(x => B58[x]).join('');
}

const text = fs.readFileSync(FILE, 'utf8');
const row = (label) => {
  const m = text.match(new RegExp(`\\| ${label} \\| \`([^\`]+)\` \\|`));
  return m && m[1];
};

/* ---- 1. placeholders ---- */

const placeholders = [...text.matchAll(/__([A-Z_]+)__/g)].map(m => m[0]);
if (placeholders.length) {
  fail.push(`${FILE} still has unfilled placeholders: ${[...new Set(placeholders)].join(', ')}`);
} else {
  ok.push('no placeholders left in llms.txt');
}

const claimsLocked = /payout destinations are locked/i.test(text);
if (!claimsLocked) warn.push('llms.txt does not make the locked claim — nothing to enforce');

/* ---- 2. the program named in the file is the real one ---- */

const namedProgram = row('Meteora Dynamic Fee Sharing');
if (claimsLocked && namedProgram !== DFS_PROGRAM) {
  fail.push(`llms.txt names Dynamic Fee Sharing as ${namedProgram || '(missing)'}, expected ${DFS_PROGRAM}`);
}

/* ---- 3. the split the file publishes ---- */

// "crew      8000 bps   80%   ..." — the table the vault must actually implement.
const published = new Map();
for (const m of text.matchAll(/^(crew|dividend|team|ops)\s+(\d+)\s+bps/gim)) {
  published.set(m[1].toLowerCase(), Number(m[2]));
}
const publishedTotal = [...published.values()].reduce((a, b) => a + b, 0);
if (claimsLocked) {
  if (published.size !== 4) {
    fail.push(`could not read all four share rows from llms.txt (found ${published.size})`);
  } else if (publishedTotal !== 10_000) {
    fail.push(`the published split sums to ${publishedTotal} bps, not 10000`);
  } else {
    ok.push(`published split reads ${[...published.entries()].map(([k, v]) => `${k} ${v}`).join(', ')} = 10000 bps`);
  }
}

/* ---- 4. the vault on chain must match it ---- */

const vaultId = row('Fee vault');

if (claimsLocked && !placeholders.length) {
  if (!vaultId) {
    fail.push('llms.txt claims destinations are locked but names no fee vault');
  } else {
    try {
      // Deliberately the strictest commitment: a launch gate should not pass on
      // state that could still be rolled back. But a vault created minutes ago
      // is not yet finalized, and "does not exist" is a frightening and wrong
      // way to say "wait thirty seconds" — so distinguish the two.
      const acct = await rpc('getAccountInfo', [vaultId, { encoding: 'base64', commitment: 'finalized' }]);
      if (!acct?.value) {
        const soon = await rpc('getAccountInfo', [vaultId, { encoding: 'base64', commitment: 'confirmed' }]);
        if (soon?.value) {
          fail.push(`fee vault ${vaultId} exists but is not finalized yet — wait ~30s and run again`);
        } else {
          fail.push(`fee vault ${vaultId} does not exist on chain, but llms.txt says destinations are locked`);
        }
      } else if (acct.value.owner !== DFS_PROGRAM) {
        fail.push(`fee vault ${vaultId} is owned by ${acct.value.owner}, not the Dynamic Fee Sharing program`);
      } else {
        const b = Buffer.from(acct.value.data[0], 'base64');
        // FeeVault, after the 8-byte discriminator:
        //   0 owner, 32 token_mint, 64 token_vault, 112 total_share (u32),
        //   240 users[5] of 80 bytes: 0 address, 32 share (u32)
        const D = 8;
        if (b.length < D + 640) {
          fail.push(`fee vault account is ${b.length} bytes, too short to decode`);
        } else {
          const totalShare = b.readUInt32LE(D + 112);
          const users = [];
          for (let i = 0; i < 5; i++) {
            const o = D + 240 + i * 80;
            const share = b.readUInt32LE(o + 32);
            if (share === 0) continue;
            users.push({ address: b58(b.subarray(o, o + 32)), share });
          }

          const onChainTotal = users.reduce((a, u) => a + u.share, 0);
          if (onChainTotal !== totalShare) {
            warn.push(`vault total_share says ${totalShare} but the entries sum to ${onChainTotal}`);
          }

          // Shares are weights, so compare as basis points of the total.
          const asBps = users.map(u => ({ ...u, bps: Math.round(u.share * 10_000 / onChainTotal) }));
          for (const u of asBps) console.log(`  vault pays ${String(u.bps).padStart(5)} bps -> ${u.address}`);

          const teamWallet = row('Team wallet \\(5%\\)');
          const teamBps = published.get('team');
          const teamEntry = asBps.find(u => u.address === teamWallet);
          if (!teamWallet) {
            warn.push('llms.txt names no team wallet to check');
          } else if (!teamEntry) {
            fail.push(`team wallet ${teamWallet} is NOT a recipient of the fee vault, but llms.txt says it gets ${teamBps} bps`);
          } else if (teamEntry.bps !== teamBps) {
            fail.push(`vault pays the team wallet ${teamEntry.bps} bps, llms.txt publishes ${teamBps} bps`);
          } else {
            ok.push(`team wallet is an on-chain recipient at ${teamEntry.bps} bps, exactly as published`);
          }

          const want = [...published.values()].sort((a, b2) => a - b2).join(',');
          const got = asBps.map(u => u.bps).sort((a, b2) => a - b2).join(',');
          if (want !== got) {
            fail.push(`vault shares are [${got}] bps; llms.txt publishes [${want}] bps`);
          } else {
            ok.push('every on-chain share matches the published split');
          }
        }
      }
    } catch (e) {
      fail.push(`could not verify the fee vault: ${e.message}`);
    }
  }
}

/* ---- 5. the file must disclose who can upgrade the program ---- */

if (claimsLocked) {
  if (/no upgrade path|cannot be modified|bytecode is final/i.test(text)) {
    fail.push('llms.txt claims the program cannot be upgraded. Meteora can upgrade it. Do not publish that.');
  }
  try {
    const prog = await rpc('getAccountInfo', [DFS_PROGRAM, { encoding: 'base64' }]);
    if (prog?.value?.owner !== UPGRADEABLE_LOADER) {
      warn.push(`Dynamic Fee Sharing is owned by ${prog?.value?.owner}, not the upgradeable loader`);
    } else {
      const pd = b58(Buffer.from(prog.value.data[0], 'base64').subarray(4, 36));
      const pdAcct = await rpc('getAccountInfo', [pd, { encoding: 'base64' }]);
      const pdBuf = Buffer.from(pdAcct.value.data[0], 'base64');
      const authority = pdBuf[12] === 1 ? b58(pdBuf.subarray(13, 45)) : null;
      if (!authority) {
        warn.push('Dynamic Fee Sharing is now immutable — llms.txt still describes it as upgradeable');
      } else if (!text.includes(authority)) {
        fail.push(`llms.txt must disclose the upgrade authority ${authority}; it does not appear in the file`);
      } else {
        ok.push(`upgrade authority ${authority.slice(0, 8)}… is disclosed in llms.txt and matches the chain`);
      }
    }
  } catch (e) {
    fail.push(`could not check the program's upgrade authority: ${e.message}`);
  }
}

for (const m of ok) console.log(`  OK    ${m}`);
for (const m of warn) console.log(`  WARN  ${m}`);
for (const m of fail) console.error(`  FAIL  ${m}`);

if (fail.length) {
  console.error(`\nNOT SAFE TO PUBLISH — ${fail.length} blocking issue(s).`);
  process.exit(1);
}
console.log('\nSafe to publish.');
