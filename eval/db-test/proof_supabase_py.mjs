#!/usr/bin/env node
// eval/db-test/proof_supabase_py.mjs — GATE T1.2 (SP-4)
//
// Prova il leak RLS di SPY-S3 (fixture supabase-py) A RUNTIME, riusando il
// modulo di caratterizzazione rls_characterize.mjs.
//
// Asserisce:
//   - su public.invoices: il tenant A VEDE righe del tenant B (leak, runtime:true).
//   - su public.notes:    il tenant A NON vede righe del tenant B (isolata).
//
// Imposta TRUELINE_TEST_PSQL sul docker exec del container supabase_db_trueline-db-test
// (avviato dallo stack eval/db-test). Se il DB non risponde, degrada DICHIARATO
// (runtime:false, degraded:true) e SKIPPA con exit 0 + messaggio esplicito.
// Mai un falso verde: la degradazione non produce un PASS silenzioso.
//
// GATE: `node eval/db-test/proof_supabase_py.mjs` esce 0 col leak riprodotto
// a runtime (DB su) oppure uscita 0 con SKIP dichiarato (DB non disponibile).
//
// Nessun git esterno toccato. Solo built-in Node ESM.

import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// eval/db-test -> root e' 2 livelli sopra.
const ROOT = resolve(__dirname, '..', '..');
const FIXTURE = resolve(ROOT, 'eval', 'ecosystems', 'supabase-py', 'reference-app');
const RLS_CHARACTERIZE = resolve(ROOT, 'trueline', 'scripts', 'characterization', 'rls_characterize.mjs');

// Imposta il comando psql sul docker exec del container di test.
// rls_characterize legge TRUELINE_TEST_PSQL se opts.psqlCmd non e' fornito.
const DOCKER_PSQL = 'docker exec -i supabase_db_trueline-db-test psql -U postgres -d postgres';
process.env.TRUELINE_TEST_PSQL = DOCKER_PSQL;

console.log('============================================================');
console.log(' GATE T1.2 (SP-4) — DB-test RUNTIME proof supabase-py (SPY-S3)');
console.log(`   fixture : ${FIXTURE}`);
console.log(`   psql    : ${DOCKER_PSQL}`);
console.log('============================================================');
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

// Esegui la caratterizzazione RLS sulla fixture supabase-py.
const result = characterizeRls(FIXTURE);

console.log('Risultato caratterizzazione:');
console.log(JSON.stringify(result, null, 2));
console.log('');

// --- Degradazione dichiarata --------------------------------------------------
// Se il DB non e' raggiungibile o la caratterizzazione e' degradata, SKIPPA
// con exit 0 + messaggio esplicito (non un falso verde — il GATE segnala SKIP).
if (result.degraded || !result.runtime) {
  console.log('============================================================');
  console.log(' [SKIP dichiarato] DB non disponibile o caratterizzazione degradata.');
  console.log(` motivo: ${result.reason || '(nessun motivo fornito)'}`);
  console.log(' runtime:false / degraded:true => SKIP onesto, non un falso verde.');
  console.log(' Riesegui col container supabase_db_trueline-db-test healthy.');
  console.log('============================================================');
  // Exit 0: lo SKIP e' un risultato legittimo dichiarato. Il gate non e' ROSSO
  // per motivi infrastrutturali, ma non e' nemmeno un verde silenzioso:
  // il messaggio sopra dichiara esplicitamente il confine (L-COL-006).
  process.exit(0);
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

// Asserzione 2: public.invoices — SPY-S3 leak: il tenant A vede righe del tenant B.
const invAssertion = byTable['invoices'];
assert(
  'assertion "rls:public.invoices" presente nei risultati',
  Boolean(invAssertion),
  invAssertion ? `id=${invAssertion.id}` : 'assente',
);
if (invAssertion) {
  assert(
    'SPY-S3 LEAK RUNTIME: public.invoices — tenant A vede righe tenant B (sees_other_tenant=true)',
    invAssertion.observed && invAssertion.observed.sees_other_tenant === true,
    `observed=${JSON.stringify(invAssertion.observed)}`,
  );
  assert(
    'SPY-S3 LEAK RUNTIME: public.invoices — visible_rows >= 2 (almeno una riga per tenant)',
    invAssertion.observed && invAssertion.observed.visible_rows >= 2,
    `visible_rows=${invAssertion.observed ? invAssertion.observed.visible_rows : 'N/A'}`,
  );
}

// Asserzione 3: public.notes — isolamento corretto: il tenant A NON vede righe del tenant B.
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
  console.log(' LEAK SPY-S3 RIPRODOTTO A RUNTIME: tenant A vede righe del tenant B su public.invoices.');
  console.log(' CONTRASTO: public.notes isola correttamente (auth.uid() vincolato).');
}
console.log('------------------------------------------------------------');
process.exit(pass ? 0 : 1);
