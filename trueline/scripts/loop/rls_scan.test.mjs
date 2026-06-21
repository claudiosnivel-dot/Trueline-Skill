#!/usr/bin/env node
// rls_scan.test.mjs — micro-test del SEAM RLS scan manifest-driven (T1.0, SP-6,
// O-COL-011). Asserisce la PRECEDENZA del resolver e la BIT-invarianza del
// fallback su un layout sconosciuto. Tutti FATTI deterministici (existsSync sui
// fixture reali + risoluzione di path), MAI un parere dell'LLM (L-COL-002).
//
// Cosa asserisce:
//   1) postgres-py reference-app (layout 'migrations/')  -> risolve '.../migrations'.
//   2) supabase-py reference-app (layout 'supabase/migrations/') -> risolve
//      '.../supabase/migrations' (BIT-invariante per il layout Supabase).
//   3) dir sconosciuta (nessuna candidata esiste) -> FALLBACK BIT-invariante a
//      '<dir>/supabase/migrations' (il path cablato storico).
//   4) precedenza opts.scan > manifest (esplicito vince).
//   5) precedenza manifest.oracles.rls.scan quando opts.scan assente.
//   6) resolveRlsMigrationFile: trova '0001_init.sql' nelle migration-dir risolte.
//
// Esce 0 sse TUTTE le asserzioni passano; 1 altrimenti. Node ESM, solo built-in.

import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import {
  resolveRlsMigrationsDir, resolveRlsMigrationFile, DEFAULT_RLS_SCAN,
} from './rls_scan.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// trueline/scripts/loop -> root e' 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const PG_APP = resolve(ROOT, 'eval', 'ecosystems', 'postgres-py', 'reference-app');
const SB_APP = resolve(ROOT, 'eval', 'ecosystems', 'supabase-py', 'reference-app');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}
// Confronto path normalizzato al separatore di sistema (assoluti).
function samePath(a, b) {
  return resolve(a) === resolve(b);
}
function tail(p, n = 2) {
  return String(p).replace(/\\/g, '/').split('/').slice(-n).join('/');
}

console.log('============================================================');
console.log(' MICRO-TEST T1.0 (SP-6) — resolveRlsMigrationsDir manifest-driven');
console.log('   O-COL-011: la migration-dir e\' chiesta al manifest, non cablata');
console.log('============================================================');
console.log('');

// Precondizioni: le due reference-app esistono col layout atteso.
check('precondizione: postgres-py reference-app/migrations esiste',
  existsSync(resolve(PG_APP, 'migrations')), tail(resolve(PG_APP, 'migrations'), 3));
check('precondizione: supabase-py reference-app/supabase/migrations esiste',
  existsSync(resolve(SB_APP, 'supabase', 'migrations')), tail(resolve(SB_APP, 'supabase', 'migrations'), 3));

// --- 1) postgres-py: layout 'migrations/' -> risolve '.../migrations' ---------
console.log('');
console.log('1) postgres-py (default probe-list) -> migrations/:');
const pgDir = resolveRlsMigrationsDir(PG_APP);
check('postgres-py risolve la dir .../migrations (NON supabase/migrations)',
  samePath(pgDir, resolve(PG_APP, 'migrations')),
  `risolto=${tail(pgDir, 3)}`);
check('postgres-py: il path risolto NON contiene supabase/',
  !/(^|[\\/])supabase[\\/]migrations$/.test(pgDir),
  pgDir.replace(/\\/g, '/'));

// --- 2) supabase-py: layout 'supabase/migrations/' -> BIT-invariante ----------
console.log('');
console.log('2) supabase-py (default probe-list) -> supabase/migrations/ (BIT-invariante):');
const sbDir = resolveRlsMigrationsDir(SB_APP);
check('supabase-py risolve la dir .../supabase/migrations',
  samePath(sbDir, resolve(SB_APP, 'supabase', 'migrations')),
  `risolto=${tail(sbDir, 3)}`);
// La default-list ha 'supabase/migrations' PRIMA: per la fixture Supabase
// coincide col path cablato storico -> nessun cambio di comportamento a valle.
check('supabase-py: DEFAULT_RLS_SCAN[0] === "supabase/migrations" (BIT-invariante)',
  DEFAULT_RLS_SCAN[0] === 'supabase/migrations',
  `default=[${DEFAULT_RLS_SCAN.join(', ')}]`);

// --- 3) dir sconosciuta -> FALLBACK BIT-invariante a supabase/migrations ------
console.log('');
console.log('3) dir sconosciuta (nessuna candidata) -> fallback supabase/migrations (BIT-invariante):');
const UNKNOWN = resolve(__dirname, '__nonexistent_dir_for_test__');
const unkDir = resolveRlsMigrationsDir(UNKNOWN);
check('dir sconosciuta -> fallback a <dir>/supabase/migrations (path cablato storico)',
  samePath(unkDir, resolve(UNKNOWN, 'supabase', 'migrations')),
  `risolto=${tail(unkDir, 3)}`);

// --- 4) precedenza opts.scan > manifest ---------------------------------------
console.log('');
console.log('4) precedenza: opts.scan esplicito vince sul manifest:');
// Su postgres-py, forziamo via opts.scan a preferire 'migrations' anche se il
// manifest dicesse altro: opts.scan vince. (qui scan=['migrations'] esiste.)
const pgExplicit = resolveRlsMigrationsDir(PG_APP, {
  scan: ['migrations'],
  manifest: { oracles: { rls: { scan: ['supabase/migrations'] } } },
});
check('opts.scan=["migrations"] vince sul manifest (-> .../migrations)',
  samePath(pgExplicit, resolve(PG_APP, 'migrations')),
  `risolto=${tail(pgExplicit, 3)}`);

// --- 5) precedenza manifest quando opts.scan assente --------------------------
console.log('');
console.log('5) precedenza: manifest.oracles.rls.scan usato quando opts.scan assente:');
// Il manifest postgres-py dichiara scan ['migrations','db/migrations','supabase/migrations'].
const pgManifest = resolveRlsMigrationsDir(PG_APP, {
  manifest: { oracles: { rls: { scan: ['migrations', 'db/migrations', 'supabase/migrations'] } } },
});
check('manifest postgres-py (scan=[migrations,...]) -> .../migrations',
  samePath(pgManifest, resolve(PG_APP, 'migrations')),
  `risolto=${tail(pgManifest, 3)}`);
// Manifest supabase-py: scan ['supabase/migrations','migrations','db/migrations'].
const sbManifest = resolveRlsMigrationsDir(SB_APP, {
  manifest: { oracles: { rls: { scan: ['supabase/migrations', 'migrations', 'db/migrations'] } } },
});
check('manifest supabase-py (scan=[supabase/migrations,...]) -> .../supabase/migrations',
  samePath(sbManifest, resolve(SB_APP, 'supabase', 'migrations')),
  `risolto=${tail(sbManifest, 3)}`);

// --- 6) resolveRlsMigrationFile: trova 0001_init.sql --------------------------
console.log('');
console.log('6) resolveRlsMigrationFile -> 0001_init.sql nella dir risolta:');
const pgFile = resolveRlsMigrationFile(PG_APP);
check('postgres-py: file primario === migrations/0001_init.sql',
  pgFile !== null && samePath(pgFile, resolve(PG_APP, 'migrations', '0001_init.sql')),
  pgFile ? tail(pgFile, 3) : 'null');
const sbFile = resolveRlsMigrationFile(SB_APP);
check('supabase-py: file primario === supabase/migrations/0001_init.sql',
  sbFile !== null && samePath(sbFile, resolve(SB_APP, 'supabase', 'migrations', '0001_init.sql')),
  sbFile ? tail(sbFile, 3) : 'null');
check('dir sconosciuta: resolveRlsMigrationFile -> null (nessun .sql)',
  resolveRlsMigrationFile(UNKNOWN) === null,
  String(resolveRlsMigrationFile(UNKNOWN)));

// --- Esito --------------------------------------------------------------------
const passed = results.filter((r) => r.ok).length;
const total = results.length;
const allOk = passed === total;
console.log('');
console.log('------------------------------------------------------------');
console.log(`PASS ${passed}/${total}`);
console.log(`=== MICRO-TEST T1.0 RESULT: ${allOk ? 'PASS' : 'FAIL'} ===`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
