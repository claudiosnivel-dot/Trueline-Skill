#!/usr/bin/env node
// run_eval.mjs — harness di regressione/detection del banco di prova (10-EVALUATION §5).
// Node ESM, SOLO moduli built-in (fs, path, child_process, url): nessun npm install,
// nessuna dipendenza di rete. E l'aggancio che TUTTE le milestone successive
// consumano come gate dei task (DYNAMIC-WORKFLOWS §6).
//
// -----------------------------------------------------------------------------
// COSA FA OGGI (M-1) — auto-gate "present & inspectable".
// -----------------------------------------------------------------------------
// Per ogni voce S1..S8 del registry (expected/registry.json) verifica con
// controlli DETERMINISTICI built-in che il difetto seminato sia PRESENTE e
// ISPEZIONABILE (NON che sia gia corretto):
//   - anchor-grep nei sorgenti                  -> S1, S6, S7, S8
//   - condizione DDL nelle migration            -> S3 (niente ENABLE RLS),
//                                                   S4 (USING (true)),
//                                                   S5 (policy senza auth.uid()/tenant)
//   - ispezione della git history (child_process) -> S2 (add-then-remove,
//                                                   working tree pulito)
// Verifica anche che eval/seeded-blueprint sia strutturalmente valido,
// riusando la logica di T-1.3 (validate_blueprint.mjs invocato come processo).
//
// Stampa un report leggibile (S1..S8 OK/FAIL + blueprint OK/FAIL) ed esce con
// codice 0 SOLO se tutto e present+inspectable, altrimenti exit 1.
//
// -----------------------------------------------------------------------------
// COSA FARA (M0+) — vedi gli hook "// TODO M0:" / "// TODO M3:" / "// TODO M5:".
// -----------------------------------------------------------------------------
// Gli anchor-check di M-1 sono uno SCHELETRO dichiaratamente parziale: NON
// eseguono gli oracoli reali. In M0+ ogni anchor-check sara sostituito
// dall'esecuzione del VERO oracolo (gitleaks / Semgrep / rls-check / knip),
// normalizzato nel finding model (04), per asserire la DETECTION (10 §3,
// criterio 1). In M3/M5 si aggiungono le asserzioni dei due parity gate
// (gate di verifica, 10 §3; gate di build, 10 §4).

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = __dirname;
const EVAL_DIR = resolve(HARNESS_DIR, '..');
const ROOT_DIR = resolve(EVAL_DIR, '..');
const REFERENCE_APP = resolve(EVAL_DIR, 'reference-app');
const SEEDED_BLUEPRINT = resolve(EVAL_DIR, 'seeded-blueprint');
const REGISTRY_PATH = resolve(HARNESS_DIR, 'expected', 'registry.json');
const VALIDATE_BLUEPRINT = resolve(HARNESS_DIR, 'validate_blueprint.mjs');

// --- Helper di lettura/ricerca deterministici (solo built-in) ----------------

// Risolve un percorso del registry (relativo alla root del repo) in assoluto.
function abs(repoRelPath) {
  return resolve(ROOT_DIR, repoRelPath);
}

// Legge un file di testo; lancia se assente (un anchor mancante e un FAIL).
function readText(absPath) {
  return readFileSync(absPath, 'utf8');
}

// Vero se il file esiste e contiene la stringa-marker (anchor-grep letterale).
function fileContainsMarker(absPath, marker) {
  if (!existsSync(absPath)) return false;
  return readText(absPath).includes(marker);
}

// Esito singolo controllo. ok=boolean, detail=stringa leggibile.
function mk(ok, detail) {
  return { ok: Boolean(ok), detail };
}

// --- Controlli "present & inspectable" per categoria di scope ----------------

// Anchor-grep nei sorgenti: il marker "SEED:Sn" e presente nel file atteso.
// Usato per S1 (secret working-tree), S6 (injection), S7 (authz), S8 (dead-code).
// TODO M0: sostituire con l'esecuzione del vero oracolo e l'asserzione di
//   detection sul finding model (04): S1 -> gitleaks (working tree, redatto,
//   03 §5.2); S6/S7 -> Semgrep (ruleset AI curato, 07 §4); S8 -> knip
//   (export non referenziato). Qui M0 verifichera che l'oracolo EMETTA il
//   finding atteso con category/source_oracle/owasp coerenti col registry.
function checkAnchorGrep(entry) {
  const file = abs(entry.anchor.file);
  const marker = entry.anchor.marker;
  const ok = fileContainsMarker(file, marker);
  const rel = entry.anchor.file;
  return mk(
    ok,
    ok
      ? `anchor '${marker}' presente in ${rel}`
      : `anchor '${marker}' NON trovato in ${rel}`,
  );
}

// S3 — tabella in schema public SENZA "ENABLE ROW LEVEL SECURITY".
// Controllo DDL: la migration contiene il CREATE TABLE della tabella attesa
// e per quella tabella NON viene mai emesso "ENABLE ROW LEVEL SECURITY".
// TODO M0: sostituire con rls-check reale (03 §5/30) che parsa la DDL e emette
//   il finding 'rls-missing' (rule_id) normalizzato nel finding model.
function checkS3NoRls(entry) {
  const file = abs(entry.anchor.file);
  if (!existsSync(file)) return mk(false, `migration assente: ${entry.anchor.file}`);
  const sql = readText(file);
  const table = entry.anchor.table; // es. public.audit_logs
  const createsTable = new RegExp(
    `CREATE\\s+TABLE\\s+${escapeRe(table)}\\b`,
    'i',
  ).test(sql);
  // La tabella deve esistere come anchor (commento SEED:S3) e NON deve avere
  // un ALTER ... ENABLE ROW LEVEL SECURITY su di se.
  const enablesRls = new RegExp(
    `ALTER\\s+TABLE\\s+${escapeRe(table)}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
    'i',
  ).test(sql);
  const hasAnchor = sql.includes(entry.anchor.marker);
  const ok = hasAnchor && createsTable && !enablesRls;
  return mk(
    ok,
    ok
      ? `${table}: CREATE TABLE presente, nessun ENABLE ROW LEVEL SECURITY (RLS assente come atteso)`
      : `${table}: atteso CREATE TABLE senza ENABLE RLS [anchor=${hasAnchor} create=${createsTable} enablesRls=${enablesRls}]`,
  );
}

// S4 — policy con "USING (true)" (isolamento finto).
// Controllo DDL: la migration contiene una USING (true) marcata con l'anchor.
// TODO M0: sostituire con rls-check reale -> finding 'rls-using-true'.
function checkS4UsingTrue(entry) {
  const file = abs(entry.anchor.file);
  if (!existsSync(file)) return mk(false, `migration assente: ${entry.anchor.file}`);
  const sql = readText(file);
  const hasAnchor = sql.includes(entry.anchor.marker);
  // USING (true) con spazi flessibili.
  const hasUsingTrue = /USING\s*\(\s*true\s*\)/i.test(sql);
  const ok = hasAnchor && hasUsingTrue;
  return mk(
    ok,
    ok
      ? `policy ${entry.anchor.policy}: USING (true) presente (isolamento finto come atteso)`
      : `atteso USING (true) marcato ${entry.anchor.marker} [anchor=${hasAnchor} usingTrue=${hasUsingTrue}]`,
  );
}

// S5 — tabella multi-tenant la cui policy NON vincola per auth.uid()/tenant.
// Controllo DDL: isola il blocco della CREATE POLICY attesa e verifica che il
// suo predicato USING non referenzi ne auth.uid() ne tenant_id.
// TODO M0: questo difetto e DYNAMIC (scan_scope=dynamic-db): in M-1 lo ispezioniamo
//   staticamente sulla DDL; il vero controllo comportamentale gira sul DB di
//   test (rls-check [DB-test], 10 §2). Sostituire con l'asserzione runtime quando
//   il DB di test e attivo; degradazione dichiarata al checker statico se assente
//   (06 §6.1).
function checkS5NoTenantIsolation(entry) {
  const file = abs(entry.anchor.file);
  if (!existsSync(file)) return mk(false, `migration assente: ${entry.anchor.file}`);
  const sql = readText(file);
  const hasAnchor = sql.includes(entry.anchor.marker);
  const policy = entry.anchor.policy; // es. invoices_visible_when_not_draft
  // Estrae il testo della CREATE POLICY <policy> ... fino al ';' di chiusura.
  const policyBlock = extractPolicyBlock(sql, policy);
  let referencesAuthUid = false;
  let referencesTenant = false;
  if (policyBlock) {
    referencesAuthUid = /auth\.uid\s*\(\s*\)/i.test(policyBlock);
    referencesTenant = /tenant_id/i.test(policyBlock);
  }
  // Difetto presente sse: anchor c'e, il blocco policy esiste e NON vincola
  // ne per auth.uid() ne per tenant_id.
  const ok = hasAnchor && Boolean(policyBlock) && !referencesAuthUid && !referencesTenant;
  return mk(
    ok,
    ok
      ? `policy ${policy}: nessun riferimento a auth.uid()/tenant_id (isolamento multi-tenant assente come atteso)`
      : `atteso predicato policy ${policy} senza auth.uid()/tenant_id [anchor=${hasAnchor} block=${Boolean(policyBlock)} authUid=${referencesAuthUid} tenant=${referencesTenant}]`,
  );
}

// S2 — segreto SOLO nella git history della reference app.
// Ispeziona la history con git -C <reference-app> log -p -- <history_path>:
// deve mostrare un add-then-remove (il file e stato aggiunto e poi rimosso) e
// il working tree deve essere PULITO (il file non esiste piu).
// TODO M0: sostituire con gitleaks sulla HISTORY (scope REMEDIATE, 03 §5.2),
//   redatto (--redact), che emette il finding 'secret' -> mitigated-residual.
function checkS2History(entry) {
  const historyPath = entry.anchor.history_path; // relativo alla reference app
  if (!existsSync(REFERENCE_APP)) {
    return mk(false, `reference-app assente: ${REFERENCE_APP}`);
  }
  if (!existsSync(join(REFERENCE_APP, '.git'))) {
    return mk(false, `la reference-app non e un repo git (.git assente)`);
  }
  // 1) working tree pulito: il file NON deve esistere ora.
  const fileInWorkingTree = existsSync(join(REFERENCE_APP, historyPath));
  // 2) history: log -p del path deve mostrare sia un'aggiunta sia una rimozione.
  const log = spawnSync(
    'git',
    ['-C', REFERENCE_APP, 'log', '-p', '--', historyPath],
    { encoding: 'utf8' },
  );
  if (log.error) {
    return mk(false, `git non disponibile: ${log.error.message}`);
  }
  const out = log.stdout || '';
  const wasAdded = /new file mode/.test(out);
  const wasRemoved = /deleted file mode/.test(out);
  const ok = !fileInWorkingTree && wasAdded && wasRemoved;
  return mk(
    ok,
    ok
      ? `${historyPath}: add-then-remove nella history, working tree pulito (segreto solo in history come atteso)`
      : `atteso add-then-remove in history + working tree pulito [inWorkingTree=${fileInWorkingTree} added=${wasAdded} removed=${wasRemoved}]`,
  );
}

// --- Utilita di parsing -------------------------------------------------------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Estrae il testo dal "CREATE POLICY <name>" fino al primo ';' successivo.
// Sufficiente e deterministico per la fixture (policy senza ';' interni).
function extractPolicyBlock(sql, policyName) {
  const re = new RegExp(`CREATE\\s+POLICY\\s+${escapeRe(policyName)}\\b`, 'i');
  const m = re.exec(sql);
  if (!m) return null;
  const start = m.index;
  const semi = sql.indexOf(';', start);
  return sql.slice(start, semi === -1 ? sql.length : semi + 1);
}

// --- Dispatch per difetto: sceglie il controllo in base a scope/category -----

function runDefectCheck(entry) {
  switch (entry.id) {
    case 'S1':
    case 'S6':
    case 'S7':
    case 'S8':
      return checkAnchorGrep(entry);
    case 'S2':
      return checkS2History(entry);
    case 'S3':
      return checkS3NoRls(entry);
    case 'S4':
      return checkS4UsingTrue(entry);
    case 'S5':
      return checkS5NoTenantIsolation(entry);
    default:
      return mk(false, `id sconosciuto: ${entry.id}`);
  }
}

// --- Validazione del blueprint seminato (riuso logica T-1.3) ------------------
// Invoca validate_blueprint.mjs come processo figlio: l'esito (exit 0) e
// l'oracolo strutturale di 11 §5.1. Riusa la logica del controllo di T-1.3
// senza duplicarla.
function checkSeededBlueprint() {
  if (!existsSync(VALIDATE_BLUEPRINT)) {
    return { ok: false, detail: `validate_blueprint.mjs assente: ${VALIDATE_BLUEPRINT}`, output: '' };
  }
  const res = spawnSync(
    process.execPath,
    [VALIDATE_BLUEPRINT, SEEDED_BLUEPRINT],
    { encoding: 'utf8' },
  );
  const output = `${res.stdout || ''}${res.stderr || ''}`.trimEnd();
  const ok = res.status === 0;
  return {
    ok,
    detail: ok
      ? `validate_blueprint OK su ${SEEDED_BLUEPRINT}`
      : `validate_blueprint FAIL (exit=${res.status}) su ${SEEDED_BLUEPRINT}`,
    output,
  };
}

// --- Caricamento registry -----------------------------------------------------

function loadRegistry() {
  if (!existsSync(REGISTRY_PATH)) {
    console.error(`[ERRORE] registry assente: ${REGISTRY_PATH}`);
    process.exit(1);
  }
  let reg;
  try {
    reg = JSON.parse(readText(REGISTRY_PATH));
  } catch (e) {
    console.error(`[ERRORE] registry.json non parsabile: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(reg.defects) || reg.defects.length === 0) {
    console.error('[ERRORE] registry.json: campo "defects" assente o vuoto');
    process.exit(1);
  }
  return reg;
}

// --- Esecuzione ---------------------------------------------------------------

function main() {
  const reg = loadRegistry();
  // Ordina S1..S8 per output stabile.
  const defects = [...reg.defects].sort((a, b) => a.id.localeCompare(b.id));

  console.log('============================================================');
  console.log(' run_eval — auto-gate banco di prova (M-1: present & inspectable)');
  console.log(`   registry      : ${REGISTRY_PATH}`);
  console.log(`   reference-app : ${REFERENCE_APP}`);
  console.log(`   blueprint     : ${SEEDED_BLUEPRINT}`);
  console.log('============================================================');
  console.log('');
  console.log('Difetti seminati S1..S8 (presente & ispezionabile):');

  let allOk = true;
  for (const entry of defects) {
    const r = runDefectCheck(entry);
    if (!r.ok) allOk = false;
    const tag = `${entry.id} [${entry.category}/${entry.source_oracle}/${entry.scan_scope}]`;
    console.log(`  [${r.ok ? 'OK' : 'FAIL'}] ${tag} — ${r.detail}`);
  }

  console.log('');
  console.log('Blueprint seminato (strutturalmente valido, riuso T-1.3):');
  const bp = checkSeededBlueprint();
  if (!bp.ok) allOk = false;
  console.log(`  [${bp.ok ? 'OK' : 'FAIL'}] seeded-blueprint — ${bp.detail}`);
  if (bp.output) {
    for (const line of bp.output.split('\n')) console.log(`      | ${line}`);
  }

  // TODO M3: aggiungere qui le asserzioni del GATE DI VERIFICA (10 §3,
  //   criteri 1-4) sulla reference app in REMEDIATE: ogni difetto e finding
  //   DA ORACOLO (criterio 1); il set in scope (S1,S3-S5,S8) raggiunge
  //   fix_state=verified e S2 resta mitigated-residual (criterio 2); le
  //   detection-only (S6,S7) sono trovate/spiegate/prioritizzate ma NON
  //   auto-fixate e il report non dice mai "sicuro" (criterio 3); il run resta
  //   entro il budget pinnato O-COL-006 (criterio 4).
  // TODO M5: aggiungere qui le asserzioni del GATE DI BUILD (10 §4, criteri
  //   5-7) sul blueprint seminato (BOOTSTRAP -> BUILD): validate_blueprint +
  //   self-check (criterio 5); checkpoint a 4 controlli (criterio 6); git a
  //   strati / fail-safe deploy-coupling (criterio 7). M5 esegue qui i DUE
  //   parity gate completi -> v1 "fatto" (VISION §10).

  console.log('');
  console.log('------------------------------------------------------------');
  console.log(
    allOk
      ? 'RESULT: OK — tutti gli S1..S8 sono presenti/ispezionabili e il blueprint e valido'
      : 'RESULT: FAIL — almeno un difetto non e presente/ispezionabile o il blueprint non e valido',
  );
  console.log('------------------------------------------------------------');

  process.exit(allOk ? 0 : 1);
}

main();
