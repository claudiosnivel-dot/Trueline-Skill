#!/usr/bin/env node
// control2.test.mjs — micro-test mirato (SP-0, Task C2): control2Security
// guidato dai binding del manifest. Il ramo CON manifest (supabase-jsts) deve
// riprodurre ESATTAMENTE i finding del ramo legacy (default cablato) — il
// manifest retro-descrive il v1. Il "verde" e' un FATTO del comando (L-COL-002).
//
// Richiede gitleaks + semgrep via Docker (entrambi presenti): se un oracolo non
// gira, i finding cambiano e il test fallisce (mai falso verde).
import { control2Security } from './checkpoint.mjs';
import { loadManifest } from '../ecosystem/resolve.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REF = resolve(ROOT, 'eval', 'reference-app');
const m = loadManifest('supabase-jsts');

const runOpts = { runId: 't', createdAt: '1970-01-01T00:00:00.000Z' };
const withM = control2Security(REF, { runOpts, manifest: m, withOsv: false });
const without = control2Security(REF, { runOpts, withOsv: false });

// (1) PARITY: il manifest supabase-jsts riproduce ESATTAMENTE il cablato ->
//     stesso numero di finding di sicurezza del ramo legacy.
const parity = withM.findings.length === without.findings.length;

// (2) NON-TAUTOLOGICO (falsificabilita, L-COL-006): un manifest RIDOTTO al solo
//     binding secret->gitleaks deve far girare SOLO gitleaks -> strettamente meno
//     finding del cablato completo (gitleaks+rls+semgrep). Se il `manifest` venisse
//     ignorato (codice non modificato) questo ramo girerebbe tutti gli oracoli e
//     l'assert fallirebbe: prova che l'argomento `manifest` guida davvero la scelta.
const reduced = { ...m, oracles: { secret: m.oracles.secret } };
const withReduced = control2Security(REF, { runOpts, manifest: reduced, withOsv: false });
const drivesSelection = withReduced.findings.length < without.findings.length;

const ok = parity && drivesSelection;
console.log(ok ? 'OK' : 'FAIL');
console.log(`  [${parity ? 'PASS' : 'FAIL'}] parity manifest==legacy — ${withM.findings.length} vs ${without.findings.length}`);
console.log(`  [${drivesSelection ? 'PASS' : 'FAIL'}] manifest ridotto guida la selezione — ${withReduced.findings.length} < ${without.findings.length}`);
process.exit(ok ? 0 : 1);
