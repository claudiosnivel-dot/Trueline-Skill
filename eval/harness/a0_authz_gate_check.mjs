#!/usr/bin/env node
// a0_authz_gate_check.mjs — keystone A0. Verita' = FATTO d'oracolo (L-COL-002).
// Per ogni pack con oracolo authz dichiarativo: il controllo 2 e' ROSSO sulla
// regola spalancata (open) e VERDE sul contrasto (scoped). + shipit + falsificabilita'.
import { runCheckpoint, control2Security } from '../../trueline/scripts/checkpoint/checkpoint.mjs';
import { existsSync, cpSync, rmSync } from 'node:fs';
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

// falsifiable: il rosso di open viene dall'ORACOLO authz, non da altro. Rimuovendo
// il file dichiarativo (firestore.rules) il difetto sparisce e il controllo 2 torna
// VERDE — prova che e' il finding dell'oracolo a produrre il rosso. La copia via
// cpSync recursive INCLUDE .git (senza .git gitleaks andrebbe in error, falsando).
const openFb = resolve(FIX, 'firebase-jsts', 'open');
const tmp = resolve(FIX, 'firebase-jsts', '.tmp-falsify');
rmSync(tmp, { recursive: true, force: true });
cpSync(openFb, tmp, { recursive: true });
rmSync(resolve(tmp, 'firestore.rules'), { force: true }); // rimuovi il difetto
const cf = control2(tmp);
check('falsifiable', cf && cf.green === true, `senza firestore.rules il controllo 2 deve tornare VERDE, visto green=${cf && cf.green} (${cf && cf.detail})`);
rmSync(tmp, { recursive: true, force: true });

// --- Task 4: rete strutturale — oracolo di FLOOR richiesto-ma-non-eseguito -----
// Un oracolo la cui categoria e' nel FLOOR e che e' RICHIESTO ma NON parte declassa
// il controllo 2 a degraded/green:false (L-COL-006). Testiamo control2Security
// DIRETTAMENTE con un manifest SINTETICO che lega un oracolo authz INESISTENTE
// (ghost_rules_check: nessun wrapper -> ramo default di runTool -> non eseguito) su
// un fixture open reale (ha gia' .git). Nessun bisogno di fixture _structural con
// .git: il manifest inline isola il comportamento. CONFINE (BIT-invarianza m5):
// - authz nel floor          -> degraded/green:false  (floor-miss)
// - authz FUORI floor         -> verde con nota         (detection-only, non declassa)
const structDir = resolve(FIX, 'firebase-jsts', 'open');
const ghostFloor = { oracles: { authz: { tool: 'ghost_rules_check' } }, floor: ['authz'] };
const c2floor = control2Security(structDir, { runOpts: RUN, withOsv: false, manifest: ghostFloor });
check('degraded-floor-miss',
  c2floor && c2floor.status === 'degraded' && c2floor.green === false,
  `atteso status=degraded green=false, visto status=${c2floor && c2floor.status} green=${c2floor && c2floor.green} (${c2floor && c2floor.detail})`);

const ghostDetect = { oracles: { authz: { tool: 'ghost_rules_check' } }, floor: ['secret'] };
const c2detect = control2Security(structDir, { runOpts: RUN, withOsv: false, manifest: ghostDetect });
check('degraded-detection-only',
  c2detect && c2detect.green === true && c2detect.status !== 'degraded',
  `atteso VERDE con nota (categoria fuori floor, non declassa), visto status=${c2detect && c2detect.status} green=${c2detect && c2detect.green} (${c2detect && c2detect.detail})`);

console.log(fails === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
