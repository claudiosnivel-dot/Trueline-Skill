#!/usr/bin/env node
// a0_authz_gate_check.mjs — keystone A0. Verita' = FATTO d'oracolo (L-COL-002).
// Per ogni pack con oracolo authz dichiarativo: il controllo 2 e' ROSSO sulla
// regola spalancata (open) e VERDE sul contrasto (scoped). + shipit + falsificabilita'.
import { runCheckpoint } from '../../trueline/scripts/checkpoint/checkpoint.mjs';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(HERE, '..', 'ecosystems', '_a0-fixtures');
const PACKS = ['firebase-jsts','firebase-py','appwrite-jsts','pocketbase-jsts','hasura-jsts','amplify-jsts'];
const RUN = { runId: 'a0', createdAt: '1970-01-01T00:00:00.000Z' };

let fails = 0;
const check = (name, cond, detail) => {
  if (!cond) { fails++; console.log(`  [FAIL] ${name} — ${detail}`); }
  else console.log(`  [ok]   ${name}`);
};
const control2 = (dir) => {
  const cp = runCheckpoint(dir, { mode: 'build', withOsv: false, runOpts: RUN });
  return cp.controls.find((c) => c.id === 2);
};

for (const p of PACKS) {
  const open = resolve(FIX, p, 'open');
  const scoped = resolve(FIX, p, 'scoped');
  if (!existsSync(open) || !existsSync(scoped)) { console.error(`precondizione: fixture ${p} assente`); process.exit(2); }
  const co = control2(open);
  check(`open:${p}`, co && co.green === false, `atteso controllo 2 ROSSO/degradato, visto green=${co && co.green} (${co && co.detail})`);
  const cs = control2(scoped);
  check(`scoped:${p}`, cs && cs.green === true, `atteso controllo 2 VERDE, visto green=${cs && cs.green} (${cs && cs.detail})`);
}

// shipit: intero checkpoint (firebase) — oggi verde col buco; dopo il fix, non-verde.
const shipit = resolve(FIX, 'firebase-jsts', 'shipit');
if (existsSync(shipit)) {
  const cp = runCheckpoint(shipit, { mode: 'build', withOsv: false, runOpts: RUN });
  check('shipit:firebase-jsts', cp.green === false, `atteso checkpoint NON-verde col buco authz, visto green=${cp.green}`);
}

console.log(fails === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
