#!/usr/bin/env node
/**
 * Refuses to let the site go live while llms.txt claims something the chain
 * does not support.
 *
 * llms.txt is written in the live voice on purpose — it is the launch-day
 * document. This script is what keeps that from becoming a false claim: it
 * fails unless the placeholders are filled AND the vault program's upgrade
 * authority is actually null on mainnet.
 *
 *   node scripts/preflight.js
 *
 * Exit 0 = safe to publish. Anything else = do not publish.
 */

import fs from 'node:fs';

const RPC = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const FILE = 'llms.txt';
const UPGRADEABLE_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';

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

const text = fs.readFileSync(FILE, 'utf8');

// 1. placeholders
const placeholders = [...text.matchAll(/__([A-Z_]+)__/g)].map(m => m[0]);
if (placeholders.length) {
  fail.push(`${FILE} still has unfilled placeholders: ${[...new Set(placeholders)].join(', ')}`);
} else {
  ok.push('no placeholders left in llms.txt');
}

// 2. does the file make the locked claim at all?
const claimsLocked = /payout destinations are locked/i.test(text);
if (!claimsLocked) warn.push('llms.txt does not make the locked claim — nothing to enforce');

// 3. if it claims locked, the chain must agree
const vaultMatch = text.match(/\| Vault program \| `([^`]+)` \|/);
const vaultId = vaultMatch && vaultMatch[1];

if (claimsLocked) {
  if (!vaultId || vaultId.startsWith('__')) {
    fail.push('llms.txt claims destinations are locked but names no vault program');
  } else {
    try {
      const prog = await rpc('getAccountInfo', [vaultId, { encoding: 'base64' }]);
      if (!prog?.value) {
        fail.push(`vault program ${vaultId} does not exist on chain, but llms.txt says destinations are locked`);
      } else if (prog.value.owner !== UPGRADEABLE_LOADER) {
        warn.push(`vault program owner is ${prog.value.owner} (expected the upgradeable loader)`);
      } else {
        // program account = 4-byte enum + 32-byte ProgramData pubkey
        const buf = Buffer.from(prog.value.data[0], 'base64');
        const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        const enc = (b) => {
          let d = [0];
          for (const by of b) { let c = by; for (let i = 0; i < d.length; i++) { c += d[i] << 8; d[i] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } }
          let s = ''; for (const by of b) { if (by === 0) s += B58[0]; else break; }
          return s + d.reverse().map(x => B58[x]).join('');
        };
        const pd = enc(buf.subarray(4, 36));
        const pdAcct = await rpc('getAccountInfo', [pd, { encoding: 'base64' }]);
        const pdBuf = Buffer.from(pdAcct.value.data[0], 'base64');
        // ProgramData: 4-byte enum, 8-byte slot, 1-byte Option tag, 32-byte authority
        const hasAuthority = pdBuf[12] === 1;
        if (hasAuthority) {
          fail.push(`vault ${vaultId} STILL HAS AN UPGRADE AUTHORITY (${enc(pdBuf.subarray(13, 45))}). llms.txt claims the destinations are locked. Do not publish.`);
        } else {
          ok.push(`vault ${vaultId} upgrade authority is null — the locked claim holds`);
        }
      }
    } catch (e) {
      fail.push(`could not verify vault program: ${e.message}`);
    }
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
