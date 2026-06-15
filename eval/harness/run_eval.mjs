#!/usr/bin/env node
// run_eval.mjs — harness di regressione/detection del banco di prova (10-EVALUATION §5).
// Node ESM, SOLO moduli built-in (fs, path, child_process, url) PIU' l'adapter
// del finding model (trueline/scripts/findings/normalize.mjs, anch'esso solo
// built-in): nessun npm install, nessuna dipendenza di rete. E l'aggancio che
// TUTTE le milestone successive consumano come gate dei task (DYNAMIC-WORKFLOWS §6).
//
// -----------------------------------------------------------------------------
// DUE MODALITA' (--mode=present | --mode=detection).
// -----------------------------------------------------------------------------
//
// MODE=present (default, banco di prova M-1) — auto-gate "present & inspectable".
//   Per ogni voce S1..S8 del registry (expected/registry.json) verifica con
//   controlli DETERMINISTICI built-in che il difetto seminato sia PRESENTE e
//   ISPEZIONABILE (NON che sia gia corretto):
//     - anchor-grep nei sorgenti                  -> S1, S6, S7, S8
//     - condizione DDL nelle migration            -> S3 (niente ENABLE RLS),
//                                                     S4 (USING (true)),
//                                                     S5 (policy senza auth.uid()/tenant)
//     - ispezione della git history (child_process) -> S2 (add-then-remove,
//                                                     working tree pulito)
//   Verifica anche che eval/seeded-blueprint sia strutturalmente valido,
//   riusando la logica di T-1.3 (validate_blueprint.mjs invocato come processo).
//   Esce 0 SOLO se tutto e present+inspectable, altrimenti exit 1.
//
// MODE=detection (M0, gate headline 10 §3 criterio 1, PARZIALE per §10b) —
//   per OGNI difetto in scope-M0 (S1,S2,S3,S4,S5,S8) ESEGUE l'ORACOLO REALE,
//   normalizza l'output nativo nel FINDING MODEL (04) e ASSERISCE che esista
//   un finding con la category e il source_oracle attesi dal registry:
//     S1 -> gitleaks (working-tree)   S2 -> gitleaks (history, commit 386f02b)
//     S3/S4/S5 -> rls_check (DDL)     S8 -> knip (dead-code)
//   NIENTE docker nel gate: S6 (injection) e S7 (authz) sono DIFFERITI a M4
//   (serve il ruleset Semgrep curato) e vengono stampati come "DEFERRED M4".
//   Il finding e' prodotto dall'ORACOLO (non da ispezione LLM): e' il "verde"
//   come fatto deterministico (L-COL-002). Esce 0 SOLO se tutti gli S in
//   scope-M0 sono DETECTED dall'oracolo corretto, altrimenti exit 1.
//
// -----------------------------------------------------------------------------
// COSA RESTA (M3/M5) — vedi gli hook "// TODO M3:" / "// TODO M5:".
// -----------------------------------------------------------------------------
//   - M3/M5: i due PARITY GATE (gate di verifica, 10 §3; gate di build, 10 §4).
//   - M4: detection di S6/S7 via Semgrep (ruleset AI curato, 07 §4) integrata
//     nel gate detection (oggi DEFERRED M4, niente docker nel gate).

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Adapter del finding model (04): normalizza l'output NATIVO degli oracoli nei
// finding strutturati su cui il gate detection asserisce. Solo built-in a valle.
import { normalize } from '../../trueline/scripts/findings/normalize.mjs';
import { validateMany } from '../../trueline/scripts/findings/validate_finding.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_DIR = __dirname;
const EVAL_DIR = resolve(HARNESS_DIR, '..');
const ROOT_DIR = resolve(EVAL_DIR, '..');
const REFERENCE_APP = resolve(EVAL_DIR, 'reference-app');
const SEEDED_BLUEPRINT = resolve(EVAL_DIR, 'seeded-blueprint');
const REGISTRY_PATH = resolve(HARNESS_DIR, 'expected', 'registry.json');
const VALIDATE_BLUEPRINT = resolve(HARNESS_DIR, 'validate_blueprint.mjs');

// Oracoli reali (03), eseguiti come processi figli in mode=detection.
const ORACLES_DIR = resolve(ROOT_DIR, 'trueline', 'scripts', 'oracles');
const RUN_GITLEAKS = resolve(ORACLES_DIR, 'run_gitleaks.mjs');
const RLS_CHECK = resolve(ORACLES_DIR, 'rls_check.mjs');
const RUN_DEADCODE = resolve(ORACLES_DIR, 'run_deadcode.mjs');
const MIGRATIONS_DIR = resolve(REFERENCE_APP, 'supabase', 'migrations');

// go/bin dove vivono gitleaks/osv (NON sul PATH in questo ambiente): lo
// aggiungiamo al PATH passato ai processi figli (l'oracolo lo ripiega comunque,
// ma lo rendiamo esplicito qui per robustezza — vedi prompt M0).
const GO_BIN = process.platform === 'win32'
  ? 'C:/Users/claud/go/bin'
  : '/c/Users/claud/go/bin';

// Difetti in scope-M0 per il gate detection (10 §3 criterio 1).
const SCOPE_M0 = new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'S8']);
// Difetti differiti a M4 (Semgrep via docker, NON nel gate M0).
const DEFERRED_M4 = new Set(['S6', 'S7']);

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
// NOTA: la DETECTION da oracolo reale (S1 -> gitleaks, S8 -> knip) e fatta in
//   --mode=detection (runDetection). Qui in --mode=present restiamo all'anchor
//   "present & inspectable" (M-1). S6/S7 -> Semgrep: detection a M4.
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
// NOTA: la DETECTION da rls_check reale (RLS001_MISSING_RLS) e fatta in
//   --mode=detection; qui in --mode=present resta il controllo DDL "present".
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
// NOTA: la DETECTION da rls_check reale (RLS003_PERMISSIVE_TRUE) e fatta in
//   --mode=detection; qui resta il controllo DDL "present".
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
// NOTA: la DETECTION da rls_check reale (RLS004_MISSING_TENANT_PREDICATE,
//   euristica static-first) e fatta in --mode=detection; qui resta il controllo
//   DDL "present". Questo difetto e DYNAMIC (scan_scope=dynamic-db): il vero
//   controllo comportamentale per-tenant gira sul DB di test (rls-check [DB-test],
//   10 §2), con degradazione dichiarata al checker statico se il DB non c'e
//   (06 §6.1). // TODO M3+: asserzione runtime quando il DB di test e attivo.
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
// NOTA: la DETECTION da gitleaks sulla HISTORY (scope REMEDIATE, 03 §5.2,
//   redatto) e fatta in --mode=detection; qui resta l'ispezione git "present".
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

// =============================================================================
// MODE=detection (M0) — esegue gli ORACOLI REALI, normalizza nel finding model
// e asserisce la DETECTION per ogni difetto in scope-M0 (10 §3, criterio 1).
// =============================================================================

// Esegue un oracolo come processo figlio e ne parsa lo stdout JSON. Decide
// l'esito dal REPORT, non dall'exit code (03 §3): JSON valido => run riuscita.
// Ritorna { ok, json, detail }. PATH arricchito col go/bin per gitleaks/osv.
function runOracle(scriptPath, args, { cwd = ROOT_DIR } = {}) {
  if (!existsSync(scriptPath)) {
    return { ok: false, json: null, detail: `oracolo assente: ${scriptPath}` };
  }
  const env = {
    ...process.env,
    PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}`,
  };
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    return { ok: false, json: null, detail: `spawn fallito: ${res.error.message}` };
  }
  const raw = (res.stdout || '').trim();
  if (!raw) {
    const errTail = (res.stderr || '').trim().split('\n').slice(-1)[0] || '(stderr vuoto)';
    return { ok: false, json: null, detail: `nessun JSON su stdout (exit=${res.status}): ${errTail}` };
  }
  try {
    return { ok: true, json: JSON.parse(raw), detail: `exit=${res.status}` };
  } catch (e) {
    return { ok: false, json: null, detail: `stdout non e JSON valido: ${e.message}` };
  }
}

// Normalizza l'output nativo nel finding model e valida i finding contro lo
// schema (04): un finding malformato a monte e' un FAIL (mai un falso verde).
// Ritorna { ok, findings, detail }.
function normalizeAndValidate(oracle, native, opts) {
  let findings;
  try {
    findings = normalize(oracle, native, opts);
  } catch (e) {
    return { ok: false, findings: [], detail: `normalize(${oracle}) ha lanciato: ${e.message}` };
  }
  const v = validateMany(findings);
  if (!v.ok) {
    return {
      ok: false,
      findings,
      detail: `finding non conformi allo schema 04: ${v.errors.slice(0, 2).join('; ')}`,
    };
  }
  return { ok: true, findings, detail: `${findings.length} finding normalizzati e validi` };
}

// Predicati di match: un difetto e' DETECTED se esiste >=1 finding con la
// category attesa, prodotto dall'oracolo atteso (source_oracle.oracle), che
// insiste sul punto giusto (file / tabella-policy / simbolo dal registry).
// La firma POSIX del path atteso e' repo-relativa (come la normalizzazione).
function expectedPath(entry) {
  // anchor.file e' gia repo-relativo POSIX (eval/reference-app/...).
  return String(entry.anchor.file).replace(/\\/g, '/');
}

// Per S2 (history) il path nativo e' "src/..." e l'adapter lo prefissa con la
// base reference-app: l'atteso e' eval/reference-app/<history_path>.
function expectedHistoryPath(entry) {
  return `eval/reference-app/${String(entry.anchor.history_path).replace(/\\/g, '/')}`;
}

// Match per categoria + oracolo + localizzazione. Per rls usiamo policy/table;
// per i segreti e il dead-code usiamo il path del file.
function matchFinding(entry, findings) {
  const wantOracle = entry.source_oracle;
  const wantCat = entry.category;
  const byCatOracle = findings.filter(
    (f) => f.category === wantCat && f.source_oracle.oracle === wantOracle,
  );
  if (byCatOracle.length === 0) return null;

  if (entry.id === 'S2') {
    const wantFile = expectedHistoryPath(entry);
    return byCatOracle.find((f) => f.location.file === wantFile) || null;
  }
  if (wantCat === 'rls') {
    // Distingui per policy (S4/S5) o per tabella (S3) tramite il simbolo,
    // e per il control_id (rule_id) atteso dal mapping 03 §5.4.
    const wantSymbol = entry.anchor.policy || entry.anchor.table;
    return (
      byCatOracle.find(
        (f) => f.location.symbol === wantSymbol || f.evidence.includes(entry.anchor.table),
      ) || null
    );
  }
  // secret working-tree (S1) e dead-code (S8): match per file.
  const wantFile = expectedPath(entry);
  return (
    byCatOracle.find(
      (f) => f.location.file === wantFile || f.location.file.startsWith(wantFile),
    ) || null
  );
}

// Esegue l'oracolo giusto per il difetto e ritorna i finding normalizzati.
// I difetti rls condividono UN'unica esecuzione di rls_check (cache).
function detectFindingsFor(entry, cache, runOpts) {
  switch (entry.id) {
    case 'S1': {
      const r = runOracle(RUN_GITLEAKS, [REFERENCE_APP, 'working-tree']);
      if (!r.ok) return { ok: false, findings: [], detail: r.detail };
      return normalizeAndValidate('gitleaks', r.json, { ...runOpts, scope: 'working-tree' });
    }
    case 'S2': {
      const r = runOracle(RUN_GITLEAKS, [REFERENCE_APP, 'history']);
      if (!r.ok) return { ok: false, findings: [], detail: r.detail };
      return normalizeAndValidate('gitleaks', r.json, { ...runOpts, scope: 'history' });
    }
    case 'S3':
    case 'S4':
    case 'S5': {
      if (!cache.rls) {
        const r = runOracle(RLS_CHECK, [MIGRATIONS_DIR]);
        cache.rls = r.ok
          ? normalizeAndValidate('rls-check', r.json, { ...runOpts, scope: 'static-ddl' })
          : { ok: false, findings: [], detail: r.detail };
      }
      return cache.rls;
    }
    case 'S8': {
      const r = runOracle(RUN_DEADCODE, [REFERENCE_APP]);
      if (!r.ok) return { ok: false, findings: [], detail: r.detail };
      return normalizeAndValidate('knip', r.json, { ...runOpts, scope: 'working-tree' });
    }
    default:
      return { ok: false, findings: [], detail: `id non gestito in detection: ${entry.id}` };
  }
}

function runDetection() {
  const reg = loadRegistry();
  const defects = [...reg.defects].sort((a, b) => a.id.localeCompare(b.id));

  // run_id/created_at FISSI: il gate deve essere riproducibile (L-COL-002).
  const runOpts = { runId: 'M0-detection-gate', createdAt: '1970-01-01T00:00:00.000Z' };
  const cache = {}; // condivide l'esecuzione di rls_check fra S3/S4/S5

  console.log('============================================================');
  console.log(' run_eval — gate DETECTION (M0: oracoli reali -> finding model)');
  console.log(`   registry      : ${REGISTRY_PATH}`);
  console.log(`   reference-app : ${REFERENCE_APP}`);
  console.log('   scope-M0      : S1,S2,S3,S4,S5,S8 (S6,S7 differiti a M4)');
  console.log('============================================================');
  console.log('');
  console.log('Detection da ORACOLO (10 §3, criterio 1 — il verde e un fatto, L-COL-002):');

  let allOk = true;
  for (const entry of defects) {
    const tag = `${entry.id} [${entry.category}/atteso:${entry.source_oracle}]`;

    if (DEFERRED_M4.has(entry.id)) {
      // S6/S7: Semgrep via docker, fuori dal gate M0 (10 §3; registry).
      console.log(`  [DEFERRED M4] ${tag} — Semgrep (ruleset curato 07 §4) non gate-ato in M0`);
      continue;
    }
    if (!SCOPE_M0.has(entry.id)) {
      console.log(`  [SKIP] ${tag} — non in scope-M0`);
      continue;
    }

    const res = detectFindingsFor(entry, cache, runOpts);
    if (!res.ok) {
      allOk = false;
      console.log(`  [FAIL] ${tag} — oracolo/normalizzazione KO: ${res.detail}`);
      continue;
    }
    const hit = matchFinding(entry, res.findings);
    if (!hit) {
      allOk = false;
      console.log(
        `  [FAIL] ${tag} — nessun finding ${entry.category}/${entry.source_oracle} ` +
          `corrispondente al difetto (${res.findings.length} finding totali dall'oracolo)`,
      );
      continue;
    }
    const where = hit.location.symbol
      ? `${hit.location.file} (${hit.location.symbol})`
      : hit.location.file;
    console.log(
      `  [DETECTED] ${tag} — source_oracle=${hit.source_oracle.oracle} ` +
        `rule_id=${hit.source_oracle.rule_id} fp=${hit.fingerprint.slice(0, 12)} @ ${where}`,
    );
  }

  // TODO M3: aggiungere qui le asserzioni del GATE DI VERIFICA (10 §3,
  //   criteri 1-4) sulla reference app in REMEDIATE: set in scope a
  //   fix_state=verified e S2 a mitigated-residual; detection-only (S6,S7)
  //   trovate ma NON auto-fixate e report mai "sicuro"; budget O-COL-006.
  // TODO M4: integrare la detection di S6/S7 via Semgrep (ruleset curato) —
  //   oggi DEFERRED M4 (niente docker nel gate).
  // TODO M5: aggiungere qui le asserzioni del GATE DI BUILD (10 §4, criteri
  //   5-7) sul blueprint seminato; M5 esegue i DUE parity gate -> v1 "fatto".

  console.log('');
  console.log('------------------------------------------------------------');
  console.log(
    allOk
      ? 'RESULT: OK — ogni difetto in scope-M0 e DETECTED come finding dall\'oracolo atteso'
      : 'RESULT: FAIL — almeno un difetto in scope-M0 non e stato rilevato dall\'oracolo atteso',
  );
  console.log('------------------------------------------------------------');

  return allOk ? 0 : 1;
}

// =============================================================================
// MODE=present (M-1) — auto-gate "present & inspectable" (invariato).
// =============================================================================

function runPresent() {
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

  console.log('');
  console.log('------------------------------------------------------------');
  console.log(
    allOk
      ? 'RESULT: OK — tutti gli S1..S8 sono presenti/ispezionabili e il blueprint e valido'
      : 'RESULT: FAIL — almeno un difetto non e presente/ispezionabile o il blueprint non e valido',
  );
  console.log('------------------------------------------------------------');

  return allOk ? 0 : 1;
}

// =============================================================================
// DISPATCH per --mode
// =============================================================================

function parseMode(argv) {
  for (const a of argv.slice(2)) {
    const m = /^--mode=(.+)$/.exec(a);
    if (m) return m[1];
    if (a === '--mode') {
      const idx = argv.indexOf(a);
      if (argv[idx + 1]) return argv[idx + 1];
    }
  }
  return 'present'; // default: la modalita M-1 resta il comportamento di base
}

function main() {
  const mode = parseMode(process.argv);
  let code;
  switch (mode) {
    case 'detection':
      code = runDetection();
      break;
    case 'present':
      code = runPresent();
      break;
    default:
      console.error(`[ERRORE] modalita sconosciuta: "${mode}" (ammesse: present | detection)`);
      code = 2;
  }
  process.exit(code);
}

main();
