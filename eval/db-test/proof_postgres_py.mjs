#!/usr/bin/env node
// eval/db-test/proof_postgres_py.mjs — GATE T1.2 (SP-6)
//
// Prova il leak RLS di PY-S3 (fixture postgres-py) A RUNTIME, riusando il
// modulo di caratterizzazione rls_characterize.mjs (schema-agnostico,
// riconosce current_setting()).
//
// La directory delle migration e' risolta MANIFEST-DRIVEN tramite
// resolveRlsMigrationsDir (helper T1.0 / O-COL-011): legge
// manifest.oracles.rls.scan = ["migrations", "db/migrations", "supabase/migrations"]
// -> risolve 'migrations/' (la dir che esiste nella fixture postgres-py,
//    layout Postgres non-Supabase). NON si cabla 'supabase/migrations'.
//
// Asserisce:
//   - su public.invoices: il tenant A VEDE righe del tenant B (leak, PY-S3).
//   - su public.notes:    il tenant A NON vede righe del tenant B (isolata,
//                         contrasto current_setting('app.current_tenant')).
//
// Imposta TRUELINE_TEST_PSQL sul docker exec del container supabase_db_trueline-db-test
// (Postgres puro condiviso dallo stack eval/db-test). Se il DB non risponde,
// degrada DICHIARATO (runtime:false, degraded:true) con exit 0 + messaggio
// esplicito. Mai un falso verde (L-COL-006).
//
// GATE: `node eval/db-test/proof_postgres_py.mjs` esce 0 col leak riprodotto
// a runtime (DB su) oppure uscita 0 con SKIP dichiarato (DB non disponibile).
// Se il DB e' su ma la caratterizzazione degrada strutturalmente -> exit 1
// (regressione reale, non skip infra).
//
// Nessun git esterno toccato. Solo built-in Node ESM.

import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
// eval/db-test -> root e' 2 livelli sopra.
const ROOT = resolve(__dirname, '..', '..');
const FIXTURE = resolve(ROOT, 'eval', 'ecosystems', 'postgres-py', 'reference-app');
const RLS_CHARACTERIZE = resolve(ROOT, 'trueline', 'scripts', 'characterization', 'rls_characterize.mjs');
const MANIFEST_PATH = resolve(ROOT, 'trueline', 'references', 'ecosystems', 'postgres-py', 'ecosystem.json');

// Carica il manifest postgres-py per passarlo al resolver (O-COL-011).
// Questo fa si' che resolveRlsMigrationsDir legga manifest.oracles.rls.scan
// = ["migrations", "db/migrations", "supabase/migrations"] e risolva 'migrations/'
// (la dir che esiste nella fixture postgres-py) anziche' 'supabase/migrations'.
let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
} catch (e) {
  console.error(`ERRORE: impossibile leggere il manifest postgres-py: ${e.message}`);
  process.exit(1);
}

// Imposta il comando psql sul docker exec del container di test.
// rls_characterize legge TRUELINE_TEST_PSQL se opts.psqlCmd non e' fornito.
const DOCKER_PSQL = 'docker exec -i supabase_db_trueline-db-test psql -U postgres -d postgres';
process.env.TRUELINE_TEST_PSQL = DOCKER_PSQL;

console.log('============================================================');
console.log(' GATE T1.2 (SP-6) — DB-test RUNTIME proof postgres-py (PY-S3)');
console.log(`   fixture : ${FIXTURE}`);
console.log(`   psql    : ${DOCKER_PSQL}`);
console.log(`   manifest: ${MANIFEST_PATH}`);
console.log(`   rls.scan: ${JSON.stringify(manifest && manifest.oracles && manifest.oracles.rls && manifest.oracles.rls.scan)}`);
console.log('============================================================');
console.log('');

// Sonda il DB PRIMA di chiamare characterizeRls, in modo da distinguere
// "DB down -> SKIP onesto (exit 0)" da "DB su ma caratterizzazione degrada
// strutturalmente -> regressione reale (exit 1)".
// (FIX ROUND 1: la versione precedente collassava entrambi a exit 0 via il
// ramo SKIP, rendendo unreachable le asserzioni runtime su un DB healthy.)
function dbReachable() {
  const r = spawnSync(DOCKER_PSQL + ' -v ON_ERROR_STOP=1 -At', {
    input: 'SELECT 1;',
    shell: true,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  return !r.error && r.status === 0 && (r.stdout || '').trim().split('\n').includes('1');
}

const DB_UP = dbReachable();
console.log(`DB raggiungibile: ${DB_UP}`);
console.log('');

// Importa il modulo di caratterizzazione (ESM dinamico).
// Su Windows, pathToFileURL e' necessario per l'import dinamico con percorsi assoluti.
let characterizeRls;
try {
  const mod = await import(pathToFileURL(RLS_CHARACTERIZE).href);
  characterizeRls = mod.characterizeRls;
} catch (e) {
  console.error(`ERRORE: impossibile importare rls_characterize.mjs: ${e.message}`);
  process.exit(1);
}

// Esegui la caratterizzazione RLS sulla fixture postgres-py.
// Passa il manifest in modo che resolveRlsMigrationsDir usi la scan-list del
// manifest (["migrations", ...]) anziche' il default Supabase.
const result = characterizeRls(FIXTURE, { manifest });

console.log('Risultato caratterizzazione:');
console.log(JSON.stringify(result, null, 2));
console.log('');

// --- Degradazione dichiarata --------------------------------------------------
// SKIP onesto (exit 0): solo quando il DB non e' raggiungibile. In quel caso
// la degradazione e' un'infra-skip legittima.
// FAIL (exit 1): quando il DB e' su ma la caratterizzazione degrada strutturalmente.
// Questo distingue infra-skip da regressione reale (FIX ROUND 1 / L-COL-006).
if (result.degraded || !result.runtime) {
  if (!DB_UP) {
    console.log('============================================================');
    console.log(' [SKIP dichiarato] DB non disponibile (container non healthy).');
    console.log(` motivo: ${result.reason || '(nessun motivo fornito)'}`);
    console.log(' runtime:false / degraded:true + DB_UP:false => SKIP infra onesto.');
    console.log(' Riesegui col container supabase_db_trueline-db-test healthy.');
    console.log('============================================================');
    // Exit 0: lo SKIP e' un risultato legittimo dichiarato solo per infra-down.
    process.exit(0);
  } else {
    // DB su ma caratterizzazione degrada: e' una regressione strutturale, NON
    // un infra-skip. Uscita 1 per segnalare il gate ROSSO.
    console.log('============================================================');
    console.log(' [FAIL] DB raggiungibile ma caratterizzazione degradata strutturalmente.');
    console.log(` motivo: ${result.reason || '(nessun motivo fornito)'}`);
    console.log(' DB_UP:true + degraded:true => regressione reale, non infra-skip.');
    console.log(' Controlla rls_characterize.mjs e le migration della fixture.');
    console.log('============================================================');
    process.exit(1);
  }
}

// --- Asserzioni RUNTIME -------------------------------------------------------
// A questo punto runtime:true -> le assertion sono misurazioni reali di Postgres.

let pass = true;
const checks = [];

function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) pass = false;
}

// Trova le assertion per tabella.
const byTable = {};
for (const a of (result.assertions || [])) {
  byTable[a.target] = a;
}

// Asserzione 1: runtime:true (non degradato).
assert(
  'caratterizzazione a RUNTIME (non degradata)',
  result.runtime === true && result.degraded === false,
  `runtime=${result.runtime} degraded=${result.degraded}`,
);

// Asserzione 2: public.invoices — PY-S3 leak: il tenant A vede righe del tenant B.
// Policy USING (true) => isolamento finto (RLS003_PERMISSIVE_TRUE).
const invAssertion = byTable['invoices'];
assert(
  'assertion "rls:public.invoices" presente nei risultati',
  Boolean(invAssertion),
  invAssertion ? `id=${invAssertion.id}` : 'assente',
);
if (invAssertion) {
  assert(
    'PY-S3 LEAK RUNTIME: public.invoices — tenant A vede righe tenant B (sees_other_tenant=true)',
    invAssertion.observed && invAssertion.observed.sees_other_tenant === true,
    `observed=${JSON.stringify(invAssertion.observed)}`,
  );
  assert(
    'PY-S3 LEAK RUNTIME: public.invoices — visible_rows >= 2 (almeno una riga per tenant)',
    invAssertion.observed && invAssertion.observed.visible_rows >= 2,
    `visible_rows=${invAssertion.observed ? invAssertion.observed.visible_rows : 'N/A'}`,
  );
}

// Asserzione 3: public.notes — isolamento corretto: il tenant A NON vede righe del tenant B.
// Policy USING (tenant_id = current_setting('app.current_tenant')::uuid) => isolamento reale.
const notesAssertion = byTable['notes'];
assert(
  'assertion "rls:public.notes" presente nei risultati',
  Boolean(notesAssertion),
  notesAssertion ? `id=${notesAssertion.id}` : 'assente',
);
if (notesAssertion) {
  assert(
    'CONTRASTO RUNTIME: public.notes — tenant A NON vede righe tenant B (sees_other_tenant=false)',
    notesAssertion.observed && notesAssertion.observed.sees_other_tenant === false,
    `observed=${JSON.stringify(notesAssertion.observed)}`,
  );
  assert(
    'CONTRASTO RUNTIME: public.notes — visible_rows === 1 (solo le righe di tenant A)',
    notesAssertion.observed && notesAssertion.observed.visible_rows === 1,
    `visible_rows=${notesAssertion.observed ? notesAssertion.observed.visible_rows : 'N/A'}`,
  );
}

// --- Esito finale -------------------------------------------------------------
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE T1.2 RESULT: ${pass ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
if (pass) {
  console.log(' LEAK PY-S3 RIPRODOTTO A RUNTIME: tenant A vede righe del tenant B su public.invoices.');
  console.log(' CONTRASTO: public.notes isola correttamente (current_setting vincolato).');
}
console.log('------------------------------------------------------------');
process.exit(pass ? 0 : 1);
