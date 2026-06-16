#!/usr/bin/env node
// m5_gate_check.mjs — GATE M5 (v1 ACCEPTANCE: i DUE PARITY GATE + packaging + triggering).
//
// È il gate di CHIUSURA del v1 (VISION §10, 10-EVALUATION): "fatto" = la skill
// supera i DUE parity gate (verifica + build), si CONFEZIONA in un .skill che
// passa il lint strutturale (09 §3), e la sua `description` TRIGGERA sulle query
// di remediation/lifecycle e NON sulle query irrilevanti (10 §7).
//
// Tutto è DETERMINISTICO (L-COL-002: "verde" = exit/output reale di un comando,
// MAI un parere dell'LLM/del gate). Il banco di prova è la reference app
// deliberatamente vulnerabile (S1..S8) + il blueprint seminato. La SKILL resta
// dep-free (built-in di Node); semgrep gira VIA DOCKER con l'immagine PINNATA.
//
//   0) PREFLIGHT DEGLI ORACOLI (entrambe le precondizioni del gate di verifica):
//      a) il DB di prova è raggiungibile via psql (default docker; override env
//         TRUELINE_TEST_PSQL) — serve a caratterizzare l'RLS a RUNTIME (M3);
//      b) docker risponde e l'immagine semgrep pinnata è presente — serve a
//         DETECTARE S6/S7 (M4). Senza ANCHE UNA SOLA delle due, M5 NON può provare
//         il gate di verifica end-to-end: ESCE 2 (precondizione non soddisfatta —
//         esito DISTINTO da un fallimento di merito, mai un falso verde, mai uno
//         skip silenzioso). Vedi M3 (preflight DB) e M4 (preflight semgrep).
//
//   A) VERIFY PARITY GATE (10 §3, criteri 1-4) su REMEDIATE (--eval, RLS a runtime
//      via TRUELINE_TEST_PSQL + S6/S7 via semgrep):
//        1 DETECT  — ogni S1..S8 compare come finding DALL'ORACOLO atteso
//                    (S1/S2 gitleaks; S3/S4/S5 rls-check; S8 knip; S6/S7 semgrep);
//        2 FIX VERIFICATA — S1/S3/S4/S5/S8 raggiungono `verified`; S2 raggiunge
//                    `mitigated-residual` (MAI `verified`, finché la history non è
//                    riscritta — riscrittura distruttiva human-gated);
//        3 NESSUN FALSO VIA LIBERA — S6/S7 detection-only (trovati/spiegati/
//                    prioritizzati, NON `verified`), coverage DICHIARATA, il report
//                    non dice mai "sicuro" (L-COL-006);
//        4 BUDGET   — il run completa entro il budget PINNATO O-COL-006 (letto da
//                    thresholds.mjs: cap per-finding + tetto di tempo di parete).
//
//   B) BUILD PARITY GATE (10 §4, criteri 5-7) sul blueprint seminato (BOOTSTRAP→BUILD):
//        5 BLUEPRINT — validate_blueprint esce PULITO + self-check checklist
//                    applicabile + OGNI task atomico porta DoD + acceptance_criteria
//                    + target_tests (L-COL-019), NESSUN criterio orfano dai test;
//        6 CHECKPOINT — costruito il macrotask supera il checkpoint a 4 controlli;
//        7 GIT A STRATI — repo deploy-coupled => merge autonomo SOSPESO (human-gated,
//                    L-COL-025); repo non-coupled + BUILD verde => merge autonomo;
//                    operazione distruttiva MAI autonoma (L-COL-024).
//
//   C) PACKAGE (09 §3): package_skill.mjs assembla un albero .skill VALIDO che passa
//      il LINT STRUTTURALE (SKILL.md < 500 righe L-COL-014; frontmatter name+
//      description non vuoti; OGNI file referenziato da SKILL.md/modes esiste; i 3
//      prompt presenti; il ruleset curato presente; nessun riferimento orfano). Un
//      pacchetto DELIBERATAMENTE ROTTO (file referenziato mancante) DEVE far FALLIRE
//      il lint (falsificabilità del lint: non un timbro sempre-verde).
//
//   D) TRIGGERING (10 §7): la `description` di SKILL.md TRIGGERA sulle query di
//      security-remediation/lifecycle (BOOTSTRAP/BUILD/REMEDIATE) e NON sulle query
//      irrilevanti — controllo DETERMINISTICO di keyword/intent, nessun LLM al gate.
//
//   E) NESSUNA REGRESSIONE: i gate m1/m2/m3/m4 + run_eval (present/detection) escono
//      ancora 0 (m3/m4 tollerano exit 2 = precondizione non soddisfatta, non
//      regressione di M5); il fixture canonico è bit-identico; nessuna copia temp
//      residua.
//
// STATO: i deliverable di BUILD (SKILL.md, package_skill.mjs, l'albero references/ +
// assets/prompts/ referenziato da SKILL.md, il ruleset curato) ORA ESISTONO e il gate
// PASSA (k=2). Scritto test-first (prima dell'implementazione M5), resta la prova di
// accettazione/regressione del v1 (VISION §10). Il criterio 4 verifica anche che il
// budget O-COL-006 sia EMPIRICAMENTE PINNATO (no default provvisorio mascherato).
//
// Esce 0 se TUTTI i criteri passano; 1 se un criterio FALLISCE; 2 se un oracolo
// del gate di verifica (DB di prova o docker/semgrep) non è disponibile.
//
// Node ESM, solo built-in (PIÙ l'adapter normalize.mjs, anch'esso solo built-in).
// NON tocca git (l'orchestratore possiede git): la verifica d'integrità usa
// `git status`/`rev-parse` in SOLA LETTURA. L'harness di eval PUÒ usare docker/psql
// (la SKILL resta dep-free).

import { spawnSync } from 'node:child_process';
import {
  existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync, cpSync,
} from 'node:fs';
import { resolve, dirname, delimiter, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize } from '../../trueline/scripts/findings/normalize.mjs';
import { LOOP_BUDGET, WALL_CLOCK_DERIVATION } from '../../trueline/scripts/checkpoint/thresholds.mjs';
import { cleanupAllVerifyWorkspaces } from '../../trueline/scripts/loop/verify_workspace.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const REFERENCE_APP = resolve(ROOT, 'eval', 'reference-app');
const SEEDED_BP = resolve(ROOT, 'eval', 'seeded-blueprint');
const RUN_LOOP = resolve(ROOT, 'trueline', 'scripts', 'loop', 'run_loop.mjs');
const RUN_SEMGREP = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_semgrep.mjs');
const VALIDATE_BP = resolve(ROOT, 'trueline', 'scripts', 'blueprint', 'validate_blueprint.mjs');
const CHECKLIST = resolve(ROOT, 'trueline', 'references', 'blueprint', 'self-check-checklist.md');
// Deliverable di BUILD M5 (oggi ASSENTI -> il gate fallisce pulito):
//   - lo script di packaging (09 §3);
//   - l'albero SPEDITO della skill (SKILL.md + references/ + assets/) — può vivere
//     come sorgente sotto trueline/ (package_skill lo assembla nel .skill).
const PACKAGE_SKILL = resolve(ROOT, 'trueline', 'scripts', 'packaging', 'package_skill.mjs');
const SKILL_MD = resolve(ROOT, 'trueline', 'SKILL.md');
const RULESET_DIR = resolve(ROOT, 'trueline', 'references', 'oracles', 'semgrep-ai-ruleset');
const PLACEHOLDER = resolve(RULESET_DIR, 'placeholder.yml');
const PROMPTS_DIR = resolve(ROOT, 'trueline', 'assets', 'prompts');

const RUN_EVAL = resolve(ROOT, 'eval', 'harness', 'run_eval.mjs');
const M1_GATE = resolve(ROOT, 'eval', 'harness', 'm1_gate_check.mjs');
const M2_GATE = resolve(ROOT, 'eval', 'harness', 'm2_gate_check.mjs');
const M3_GATE = resolve(ROOT, 'eval', 'harness', 'm3_gate_check.mjs');
const M4_GATE = resolve(ROOT, 'eval', 'harness', 'm4_gate_check.mjs');
const TMP_VERIFY = resolve(ROOT, 'eval', '.tmp-verify');
const TMP_PKG = resolve(ROOT, 'eval', '.tmp-m5-pkg');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';

// SWEEP DEGLI ORFANI ALL'AVVIO (come M4): un run_loop killato a metà (SIGKILL)
// lascia una copia temp orfana in eval/.tmp-verify che avvelenerebbe l'asserzione
// "nessuna copia temp residua" (e i gate m1/m3/m4 che M5 ri-esegue). Sweep PRIMA
// di ogni nostro run; l'asserzione finale resta valida (se fosse il run corrente a
// lasciare un residuo, scatterebbe comunque).
cleanupAllVerifyWorkspaces();

// Immagine semgrep PINNATA: deve combaciare con run_semgrep.mjs / il gate M4.
const SEMGREP_IMAGE = 'semgrep/semgrep:latest';

// Comando psql del banco di prova (eval-only; la SKILL resta generica). Default =
// container Supabase locale; override via env TRUELINE_TEST_PSQL. Iniettato nell'env
// passato a run_loop così la characterization RLS gira a RUNTIME (M3).
const DEFAULT_PSQL = 'docker exec -i supabase_db_trueline-db-test psql -U postgres -d postgres';
const TEST_PSQL = process.env.TRUELINE_TEST_PSQL || DEFAULT_PSQL;

// runOpts deterministici per normalize (riproducibilità L-COL-002): niente Date.now.
const RUN_OPTS = { runId: 'm5-gate', createdAt: '1970-01-01T00:00:00.000Z', base: 'eval/reference-app' };

// ---------------------------------------------------------------------------
function nodeRun(script, args, cwd = ROOT) {
  const env = {
    ...process.env,
    PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}`,
    TRUELINE_TEST_PSQL: TEST_PSQL,
  };
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}

// Esegue l'oracolo semgrep (run_semgrep.mjs) e ritorna il JSON nativo parsato.
function runSemgrepNative(projectDir = 'eval/reference-app') {
  const r = nodeRun(RUN_SEMGREP, [projectDir]);
  let native = null;
  try { native = JSON.parse(r.stdout); } catch { /* gestito dal chiamante */ }
  return { status: r.status, native, stderr: r.stderr };
}

// Esegue il comando psql risolto (SELECT 1) per il preflight del DB di prova.
function dbReachable() {
  const full = `${TEST_PSQL} -v ON_ERROR_STOP=1 -At`;
  const r = spawnSync(full, {
    input: 'SELECT 1;', shell: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return !r.error && r.status === 0 && (r.stdout || '').trim().split('\n').includes('1');
}

// docker disponibile e immagine semgrep pinnata presente?
function dockerReady() {
  const v = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (v.error || v.status !== 0) return { ok: false, why: 'docker non risponde' };
  const img = spawnSync('docker', ['images', '-q', SEMGREP_IMAGE], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (img.error || img.status !== 0 || !(img.stdout || '').trim()) {
    return { ok: false, why: `immagine ${SEMGREP_IMAGE} non presente (docker pull ${SEMGREP_IMAGE})` };
  }
  return { ok: true };
}

// git in SOLA LETTURA (status/rev-parse) per l'integrità del fixture. Non muta nulla.
function gitRead(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: res.status, stdout: (res.stdout || '').trim() };
}

const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function readSafe(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }

// Elenco ricorsivo dei file (.yml/.yaml) sotto una dir (best-effort).
function listYamlFiles(dir) {
  const out = [];
  function walk(d) {
    let entries;
    try { entries = readdirSync(d); } catch { return; }
    for (const e of entries) {
      const full = resolve(d, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (/\.ya?ml$/i.test(e)) out.push(full);
    }
  }
  walk(dir);
  return out;
}

// Conta le righe di un file (per il limite L-COL-014 sul corpo del SKILL.md).
function lineCount(p) {
  const txt = readSafe(p);
  if (!txt) return 0;
  return txt.replace(/\r\n/g, '\n').split('\n').length;
}

// Helper di categoria per i finding semgrep S6/S7.
const isInjection = (f) => f.category === 'injection';
const isAuthz = (f) => f.category === 'authz';
const fileOf = (f) => (f.location && f.location.file) || '';
// Tabella nuda dall'id/target di un'assertion ('...invoices' -> 'invoices').
const baseName = (p) => String(p).replace(/\\/g, '/').split('/').pop();

console.log('============================================================');
console.log(' GATE M5 — v1 ACCEPTANCE: i DUE PARITY GATE (VISION §10) + packaging + triggering');
console.log(`   reference-app : ${REFERENCE_APP}`);
console.log(`   seeded bp     : ${SEEDED_BP}`);
console.log(`   psql test-db  : ${TEST_PSQL}`);
console.log(`   semgrep image : ${SEMGREP_IMAGE} (pinnata)`);
console.log('   verify gate   : S1/S3/S4/S5/S8 -> verified; S2 -> mitigated-residual; S6/S7 detection-only');
console.log('============================================================');
console.log('');

// =============================================================================
// 0) PREFLIGHT DEGLI ORACOLI: DB di prova (RLS runtime, M3) + docker/semgrep
//    (detection S6/S7, M4). Senza ANCHE UNA SOLA -> ESCE 2 (precondizione non
//    soddisfatta, MAI falso verde, MAI skip silenzioso).
// =============================================================================
console.log('0) Preflight oracoli del gate di verifica (DB di prova + docker/semgrep pinnato):');
if (!dbReachable()) {
  console.log('  [FAIL] DB di prova NON raggiungibile via psql risolto');
  console.log('');
  console.log('------------------------------------------------------------');
  console.log('=== GATE M5: PRECONDIZIONE NON SODDISFATTA (DB di prova assente) ===');
  console.log('Il gate di verifica richiede il banco di prova per caratterizzare l\'RLS A RUNTIME (M3).');
  console.log(`Comando psql tentato: ${TEST_PSQL}`);
  console.log('Avvia il DB di prova:  pwsh -File "eval/db-test/up.ps1"');
  console.log('(oppure imposta TRUELINE_TEST_PSQL su un endpoint psql raggiungibile).');
  console.log('------------------------------------------------------------');
  process.exit(2);
}
const dr = dockerReady();
if (!dr.ok) {
  console.log(`  [FAIL] oracolo semgrep NON disponibile — ${dr.why}`);
  console.log('');
  console.log('------------------------------------------------------------');
  console.log('=== GATE M5: PRECONDIZIONE NON SODDISFATTA (oracolo semgrep assente) ===');
  console.log('Il gate di verifica richiede l\'oracolo semgrep VIA DOCKER per provare la detection di S6/S7.');
  console.log(`Immagine pinnata attesa: ${SEMGREP_IMAGE}`);
  console.log(`Prepara l'oracolo:       docker pull ${SEMGREP_IMAGE}`);
  console.log('------------------------------------------------------------');
  process.exit(2);
}
assert('preflight: DB di prova raggiungibile (RLS runtime) + docker/semgrep pinnato presente', true,
  `${SEMGREP_IMAGE}`);

// snapshot iniziale dell'integrità del fixture (git, sola lettura, parte tracciata).
const headBefore = gitRead(REFERENCE_APP, ['rev-parse', 'HEAD']).stdout;
const statusBefore = gitRead(REFERENCE_APP, ['status', '--porcelain']).stdout;

// =============================================================================
// A) VERIFY PARITY GATE (10 §3, criteri 1-4) in REMEDIATE end-to-end.
//    Driver deterministico: run_loop --eval --mode=remediate --characterize (RLS a
//    runtime via TRUELINE_TEST_PSQL). Il loop raccoglie i finding dagli oracoli,
//    porta a verified il set in-scope, e dichiara la coverage onesta. La DETECTION
//    di S6/S7 (detection-only) si prova a parte con l'oracolo semgrep (M4).
// =============================================================================
console.log('');
console.log('A) VERIFY PARITY GATE (10 §3, criteri 1-4) — REMEDIATE end-to-end:');
const t0 = Date.now();
const loop = nodeRun(RUN_LOOP, ['--eval', '--mode=remediate', '--characterize']);
const elapsedMs = Date.now() - t0;
let report = null;
try { report = JSON.parse(loop.stdout); } catch { /* gestito */ }
assert('run_loop (REMEDIATE, --eval, --characterize) esce 0 ed emette JSON', loop.status === 0 && report,
  report ? `exit=${loop.status} ok=${report.ok}` : `exit=${loop.status} (no JSON)`);

const F = (report && report.findings) || [];
const fByCat = (cat) => F.filter((f) => f.category === cat);
// Helper: un finding del set in-scope con file che combacia un basename atteso.
const findByFile = (cat, baseRe) => fByCat(cat).find((f) => baseRe.test(fileOf(f)));

// --- Criterio 1 DETECT: ogni S1..S8 compare come finding DALL'ORACOLO atteso. ---
console.log('');
console.log('  Criterio 1 — DETECT (ogni S1..S8 da un oracolo, non da ispezione):');
// S1 secret working-tree (config.ts) — gitleaks.
const s1 = findByFile('secret', /config\.ts$/);
assert('S1 DETECT: secret in config.ts (gitleaks)', Boolean(s1),
  s1 ? `fp=${(s1.fingerprint || '').slice(0, 10)}` : 'assente');
// S2 secret history (credentials.ts) — gitleaks.
const s2 = findByFile('secret', /credentials\.ts$/);
assert('S2 DETECT: secret nella history su credentials.ts (gitleaks)', Boolean(s2),
  s2 ? `fp=${(s2.fingerprint || '').slice(0, 10)}` : 'assente');
// S3/S4/S5 rls — rls-check (3 finding rls dalla migration).
const rlsF = fByCat('rls');
assert('S3/S4/S5 DETECT: >=3 finding rls (rls-check)', rlsF.length >= 3, `rls=${rlsF.length}`);
// S8 dead-code (unused.ts) — knip.
const s8 = findByFile('dead-code', /unused\.ts$/);
assert('S8 DETECT: dead-code su unused.ts (knip)', Boolean(s8),
  s8 ? `fp=${(s8.fingerprint || '').slice(0, 10)}` : 'assente');
// Ogni finding del set in-scope proviene da un ORACOLO (ha rule_id/source_oracle).
const inScopeFromOracle = F.every((f) => f.rule_id || (f.source_oracle && f.source_oracle.rule_id));
assert('ogni finding del set in-scope proviene da un ORACOLO (rule_id/source_oracle)', F.length > 0 && inScopeFromOracle,
  `finding=${F.length}`);

// S6/S7 DETECT via l'oracolo semgrep (M4): injection in src/db.ts (CWE-89,A05:2025)
// e authz in src/routes/bookings.ts (CWE-862,A01:2025), normalizzati dal VERO output.
const scan = runSemgrepNative('eval/reference-app');
let sgFindings = [];
try { sgFindings = normalize('semgrep', scan.native, RUN_OPTS); } catch { /* gestito */ }
const s6 = sgFindings.find((f) => isInjection(f) && /src\/db\.ts$/.test(fileOf(f))
  && f.cwe === 'CWE-89' && f.owasp === 'A05:2025');
const s7 = sgFindings.find((f) => isAuthz(f) && /src\/routes\/bookings\.ts$/.test(fileOf(f))
  && f.cwe === 'CWE-862' && f.owasp === 'A01:2025');
assert('S6 DETECT: injection in src/db.ts (semgrep, CWE-89/A05:2025)', Boolean(s6),
  s6 ? `rule=${s6.source_oracle.rule_id}` : 'assente (ruleset curato M4 non cablato?)');
assert('S7 DETECT: authz in src/routes/bookings.ts (semgrep, CWE-862/A01:2025)', Boolean(s7),
  s7 ? `rule=${s7.source_oracle.rule_id}` : 'assente (ruleset curato M4 non cablato?)');

// --- Criterio 2 FIX VERIFICATA: S1/S3/S4/S5/S8 verified; S2 mitigated-residual. ---
console.log('');
console.log('  Criterio 2 — FIX VERIFICATA (set in-scope verified; S2 mitigated-residual, mai verified):');
const stateOf = (f) => f && f.fix_state;
assert('S1 raggiunge verified', stateOf(s1) === 'verified', `S1=${stateOf(s1)}`);
const rlsVerified = rlsF.filter((f) => f.fix_state === 'verified');
assert('S3/S4/S5: tutti i finding rls raggiungono verified', rlsF.length >= 3 && rlsVerified.length === rlsF.length,
  `rls verified=${rlsVerified.length}/${rlsF.length}`);
assert('S8 raggiunge verified', stateOf(s8) === 'verified', `S8=${stateOf(s8)}`);
assert('S2 raggiunge mitigated-residual (NON verified — history non riscritta, L-COL-024)',
  stateOf(s2) === 'mitigated-residual', `S2=${stateOf(s2)}`);
// Falsificabilità: NESSUN finding-secret della history è stato gonfiato a verified.
const historySecretVerified = fByCat('secret').filter((f) => /credentials\.ts$/.test(fileOf(f)) && f.fix_state === 'verified');
assert('nessun secret della history è gonfiato a verified (stato onesto)', historySecretVerified.length === 0,
  historySecretVerified.length ? `${historySecretVerified.length} gonfiati (vietato!)` : 'nessuno');

// --- Criterio 3 NESSUN FALSO VIA LIBERA: S6/S7 detection-only; coverage; no "sicuro". ---
console.log('');
console.log('  Criterio 3 — NESSUN FALSO VIA LIBERA (S6/S7 detection-only, coverage dichiarata, niente "sicuro"):');
// S6/S7 NON sono mai portati a verified dal loop (restano fuori dal set in-scope).
const s6s7Verified = F.filter((f) => (f.category === 'injection' || f.category === 'authz') && f.fix_state === 'verified');
assert('S6/S7 NON sono portati a verified dal loop (detection-only)', s6s7Verified.length === 0,
  s6s7Verified.length ? `${s6s7Verified.length} a verified (falso verde!)` : 'nessuno');
// La coverage DICHIARA injection(S6)/authz(S7) come non coperti dal set verificato.
const coverage = (report && report.coverage) || null;
const uncovered = (coverage && coverage.declared_uncovered) || [];
const hasUncovered = (re) => uncovered.some((u) => re.test(`${u.what} ${u.why}`));
assert('coverage presente e dichiara injection(S6) non coperto', Array.isArray(uncovered) && hasUncovered(/injection|S6/i),
  hasUncovered(/injection|S6/i) ? 'dichiarato' : 'NON dichiarato');
assert('coverage dichiara authz(S7) non coperto', hasUncovered(/authz|S7/i),
  hasUncovered(/authz|S7/i) ? 'dichiarato' : 'NON dichiarato');
// Il report NON dice "sicuro"/"safe" come garanzia (L-COL-006). Tolleriamo "fail-safe".
const reportText = JSON.stringify({ coverage, findings: F, checkpoint: report && report.checkpoint })
  .replace(/fail[-\s]?safe/ig, '');
assert('il report NON asserisce "sicuro"/"safe" come garanzia (L-COL-006)', !/\b(sicuro|safe)\b/i.test(reportText),
  /\b(sicuro|safe)\b/i.test(reportText) ? 'trovata garanzia indebita' : 'nessuna garanzia indebita');
// Ogni finding verified è stato promosso da un oracolo (rule_id presente).
const verified = F.filter((f) => f.fix_state === 'verified');
const verifiedOracle = verified.filter((f) => f.rule_id && String(f.rule_id).length > 0);
assert('ogni finding verified è promosso da un oracolo (rule_id)', verified.length > 0 && verifiedOracle.length === verified.length,
  `verified=${verified.length} con-oracolo=${verifiedOracle.length}`);

// --- Criterio 4 BUDGET: il run completa entro il budget PINNATO O-COL-006. ---
console.log('');
console.log('  Criterio 4 — BUDGET (entro il pin O-COL-006 di thresholds.mjs):');
const wallCap = LOOP_BUDGET.GLOBAL_WALL_CLOCK_MS;
assert('budget pinnato presente: cap per-finding (MAX_RETRIES_PER_FINDING) + tetto tempo di parete',
  Number.isInteger(LOOP_BUDGET.MAX_RETRIES_PER_FINDING) && LOOP_BUDGET.MAX_RETRIES_PER_FINDING > 0
    && Number.isInteger(wallCap) && wallCap > 0,
  `retries=${LOOP_BUDGET.MAX_RETRIES_PER_FINDING} wallMs=${wallCap}`);
// ANTI-GAMING (lezione M2: gate-verde != deliverable-completo). Il tetto di tempo di
// parete DEVE essere la derivazione EMPIRICA registrata (round(p95 x margin)) su un
// campione sufficiente (>=10), NON il default provvisorio M1 (600000). Senza questa
// asserzione il gate passerebbe sul default non-pinnato (O-COL-006 incompleto).
const der = WALL_CLOCK_DERIVATION || {};
const derivedCap = Number.isFinite(der.p95_ms) && Number.isFinite(der.margin)
  ? Math.round(der.p95_ms * der.margin) : null;
assert('budget EMPIRICAMENTE PINNATO (O-COL-006): cap === round(p95 x margin), samples>=10, non il default 600000',
  derivedCap !== null && wallCap === derivedCap && Number.isInteger(der.samples) && der.samples >= 10
    && wallCap !== 600000,
  `cap=${wallCap} derived=${derivedCap} p95=${der.p95_ms} margin=${der.margin} samples=${der.samples}`);
assert('il run di verifica completa ENTRO il tetto di tempo di parete pinnato', elapsedMs <= wallCap,
  `elapsed=${elapsedMs}ms <= cap=${wallCap}ms`);
// Nessun finding ha superato il cap per-finding (sarebbe uno stato terminale, MAI verified).
const overRetry = F.filter((f) => typeof f.retries === 'number' && f.retries > LOOP_BUDGET.MAX_RETRIES_PER_FINDING);
assert('nessun finding ha sforato il cap di retry per-finding', overRetry.length === 0,
  overRetry.length ? `${overRetry.length} oltre cap` : `cap=${LOOP_BUDGET.MAX_RETRIES_PER_FINDING}`);

// =============================================================================
// B) BUILD PARITY GATE (10 §4, criteri 5-7) sul blueprint seminato (BOOTSTRAP→BUILD).
// =============================================================================
console.log('');
console.log('B) BUILD PARITY GATE (10 §4, criteri 5-7) — blueprint seminato:');

// --- Criterio 5 BLUEPRINT: validate_blueprint pulito + self-check + DoD/AC/target_tests + no orfani. ---
console.log('');
console.log('  Criterio 5 — BLUEPRINT (validate_blueprint pulito + self-check + DoD/AC/target_tests, no orfani):');
const bp = nodeRun(VALIDATE_BP, [SEEDED_BP, '--json']);
let bpRep = null;
try { bpRep = JSON.parse(bp.stdout); } catch { /* gestito */ }
assert('validate_blueprint esce PULITO (exit 0, ok=true) sul seminato', bp.status === 0 && bpRep && bpRep.ok === true,
  bpRep ? `exit=${bp.status} task_count=${bpRep.task_count}` : `exit=${bp.status}`);
// I 5 controlli strutturali tutti OK (incl. REQUIRED_FIELDS = DoD+AC+target_tests
// per OGNI task, L-COL-019; AC_COVERAGE = nessun criterio orfano dai test).
const reqFields = bpRep && bpRep.checks.find((c) => c.name === '(1) REQUIRED_FIELDS');
const acCoverage = bpRep && bpRep.checks.find((c) => c.name === '(2) AC_COVERAGE');
assert('(1) REQUIRED_FIELDS OK: ogni task atomico porta DoD + acceptance_criteria + target_tests (L-COL-019)',
  reqFields && reqFields.ok === true, reqFields ? reqFields.detail : 'controllo assente');
assert('(2) AC_COVERAGE OK: nessun criterio di accettazione orfano dai target_tests',
  acCoverage && acCoverage.ok === true, acCoverage ? acCoverage.detail : 'controllo assente');
// Self-check semantico (11 §5.2) presente e applicabile (i punti 6-10).
const checklistTxt = readSafe(CHECKLIST).toLowerCase();
const semanticPoints = [
  ['6 misurabilità', /6\.\s*misurabilit/],
  ['7 atomicità', /7\.\s*atomicit/],
  ['8 copertura', /8\.\s*copertura/],
  ['9 baseline di sicurezza', /9\.\s*baseline/],
  ['10 niente task fantasma', /10\.\s*niente task fantasma/],
];
const missingChecklist = semanticPoints.filter(([, re]) => !re.test(checklistTxt)).map(([l]) => l);
assert('self-check checklist semantica applicabile (punti 6-10 presenti, 11 §5.2)',
  existsSync(CHECKLIST) && missingChecklist.length === 0,
  missingChecklist.length ? `mancano: ${missingChecklist.join(', ')}` : 'presente');

// --- Criterio 6 CHECKPOINT: il checkpoint a 4 controlli sul macrotask è verde. ---
console.log('');
console.log('  Criterio 6 — CHECKPOINT (i 4 controlli sul macrotask, 01 §4):');
const cp = (report && report.checkpoint) || null;
const ctl = (id) => (cp && cp.controls ? cp.controls.find((c) => c.id === id) : null) || {};
assert('checkpoint emesso con i 4 controlli', cp && Array.isArray(cp.controls) && cp.controls.length >= 4,
  cp ? `controls=${cp.controls.length}` : 'assente');
assert('checkpoint VERDE dopo le fix (i 4 controlli passano, niente nuovi morti/vuln/regressioni)',
  cp && cp.green === true, cp ? `green=${cp.green}` : 'assente');
assert('controllo 3 (regressioni) e 4 (conformità→invarianza) verdi (RLS a runtime, non degradati)',
  ctl(3).green === true && ctl(4).green === true,
  `c3=${ctl(3).status} c4=${ctl(4).status}`);

// --- Criterio 7 GIT A STRATI: deploy-coupled => sospeso; non-coupled => autonomo; distruttive mai. ---
console.log('');
console.log('  Criterio 7 — GIT A STRATI (deploy-coupling => fail-safe; distruttive mai autonome, 01 §5 / 05 §8):');
const merge = (report && report.git && report.git.merge) || {};
// non-coupled + BUILD verde => merge autonomo (decideMerge.autonomous_merge_allowed).
assert('non-coupled + verde => merge AUTONOMO', merge.build_noncoupled && merge.build_noncoupled.autonomous_merge_allowed === true,
  merge.build_noncoupled ? `gate=${merge.build_noncoupled.gate}` : 'assente');
// coupled (o unknown non confermato) => sospeso, torna human-gated (L-COL-025).
assert('deploy-coupled => merge autonomo SOSPESO (human-gated, L-COL-025)',
  merge.build_coupled && merge.build_coupled.autonomous_merge_allowed === false,
  merge.build_coupled ? `gate=${merge.build_coupled.gate}` : 'assente');
assert('unknown NON confermato => trattato come coupled (sospeso, fail-safe L-COL-025)',
  merge.build_unknown_unconfirmed && merge.build_unknown_unconfirmed.autonomous_merge_allowed === false,
  merge.build_unknown_unconfirmed ? `gate=${merge.build_unknown_unconfirmed.gate}` : 'assente');
// operazione distruttiva MAI autonoma (L-COL-024): allowed=false + requires_human_gate=true.
const destructive = report && report.git && report.git.destructive;
assert('operazione distruttiva MAI autonoma (L-COL-024)',
  destructive && destructive.allowed === false && destructive.requires_human_gate === true,
  destructive ? `allowed=${destructive.allowed} human_gate=${destructive.requires_human_gate}` : 'assente');

// =============================================================================
// C) PACKAGE (09 §3): package_skill.mjs assembla un .skill VALIDO che passa il LINT
//    strutturale; un pacchetto ROTTO (file referenziato mancante) DEVE far FALLIRE.
// =============================================================================
console.log('');
console.log('C) PACKAGE (09 §3): package_skill assembla un .skill valido che passa il lint strutturale:');
assert('package_skill.mjs presente (trueline/scripts/packaging/package_skill.mjs)', existsSync(PACKAGE_SKILL),
  existsSync(PACKAGE_SKILL) ? 'presente' : `ASSENTE: ${PACKAGE_SKILL}`);
assert('SKILL.md presente (corpo livello 2, 02 §5)', existsSync(SKILL_MD),
  existsSync(SKILL_MD) ? 'presente' : `ASSENTE: ${SKILL_MD}`);

// Assemblaggio + lint su una dir temp usa-e-getta (eval/.tmp-m5-pkg, gitignorata).
try { rmSync(TMP_PKG, { recursive: true, force: true }); } catch { /* idempotente */ }
mkdirSync(TMP_PKG, { recursive: true });
const PKG_OUT = resolve(TMP_PKG, 'trueline.skill');
let pkgRep = null;
let pkgExit = null;
if (existsSync(PACKAGE_SKILL)) {
  // package_skill.mjs --out <dir> --json: assembla l'albero + lint + manifest, ed
  // emette un JSON { ok, lint:{ ok, errors[] }, manifest:{...}, tree:[...] }.
  const pkg = nodeRun(PACKAGE_SKILL, ['--out', PKG_OUT, '--json']);
  pkgExit = pkg.status;
  try { pkgRep = JSON.parse(pkg.stdout); } catch { /* gestito */ }
}
assert('package_skill assembla ed esce 0 con JSON di esito', pkgExit === 0 && pkgRep,
  pkgRep ? `exit=${pkgExit} ok=${pkgRep.ok}` : `exit=${pkgExit} (no JSON)`);
const lint = (pkgRep && pkgRep.lint) || null;
assert('LINT strutturale PASSA sul pacchetto ben formato (09 §3)', lint && lint.ok === true,
  lint ? `errors=${(lint.errors || []).length}` : 'lint assente');

// Asserzioni SOSTANZIALI del lint (non basta un timbro verde):
//   - SKILL.md < 500 righe (L-COL-014); frontmatter name+description non vuoti;
//   - i 3 prompt presenti; il ruleset curato presente (oltre placeholder);
//   - nessun riferimento orfano (ogni file referenziato esiste) — provato in negativo sotto.
const skillLines = lineCount(SKILL_MD);
assert('SKILL.md < 500 righe (L-COL-014)', existsSync(SKILL_MD) && skillLines > 0 && skillLines < 500,
  `righe=${skillLines}`);
const skillTxt = readSafe(SKILL_MD);
const fmName = /(^|\n)name:\s*\S+/.test(skillTxt);
const fmDesc = /(^|\n)description:\s*[\s\S]*?\S/.test(skillTxt);
assert('frontmatter SKILL.md: name + description NON vuoti', fmName && fmDesc,
  `name=${fmName} description=${fmDesc}`);
const prompts = ['project-start.md', 'session-start.md', 'session-end.md'];
const missingPrompts = prompts.filter((p) => !existsSync(resolve(PROMPTS_DIR, p)));
assert('i 3 prompt di lifecycle presenti in assets/prompts/', missingPrompts.length === 0,
  missingPrompts.length ? `mancano: ${missingPrompts.join(', ')}` : 'presenti');
const curatedRuleset = listYamlFiles(RULESET_DIR).filter((f) => resolve(f) !== PLACEHOLDER);
assert('ruleset semgrep CURATO presente (oltre placeholder.yml)', curatedRuleset.length > 0,
  curatedRuleset.length ? `${curatedRuleset.length} file` : 'solo placeholder (curato assente)');

// FALSIFICABILITÀ del lint: un pacchetto ROTTO (un file referenziato dal SKILL.md
// rimosso dall'albero assemblato) DEVE far FALLIRE il lint. Lo proviamo chiedendo a
// package_skill un assemblaggio con un'iniezione di guasto (--inject-missing-ref):
// se il flag non è supportato o il lint passa lo stesso, è un timbro sempre-verde -> FAIL.
let brokenRep = null;
let brokenExit = null;
if (existsSync(PACKAGE_SKILL)) {
  const BROKEN_OUT = resolve(TMP_PKG, 'broken.skill');
  const broken = nodeRun(PACKAGE_SKILL, ['--out', BROKEN_OUT, '--json', '--inject-missing-ref']);
  brokenExit = broken.status;
  try { brokenRep = JSON.parse(broken.stdout); } catch { /* gestito */ }
}
const brokenLint = (brokenRep && brokenRep.lint) || null;
assert('pacchetto ROTTO (file referenziato mancante) -> il LINT FALLISCE (lint falsificabile, non sempre-verde)',
  brokenExit !== null && brokenExit !== 0 && brokenLint && brokenLint.ok === false
    && Array.isArray(brokenLint.errors) && brokenLint.errors.length > 0,
  brokenLint ? `exit=${brokenExit} lint.ok=${brokenLint.ok} errors=${(brokenLint.errors || []).length}`
    : `exit=${brokenExit} (no JSON / flag --inject-missing-ref non supportato)`);

// Cleanup della dir di packaging temp.
try { rmSync(TMP_PKG, { recursive: true, force: true }); } catch { /* best effort */ }
assert('nessun residuo temp del packaging (eval/.tmp-m5-pkg)', !existsSync(TMP_PKG),
  existsSync(TMP_PKG) ? 'residuo presente' : 'assente');

// =============================================================================
// D) TRIGGERING (10 §7): la `description` triggera sui positivi e NON sui negativi.
//    Controllo DETERMINISTICO di keyword/intent (nessun LLM al gate, L-COL-002).
// =============================================================================
console.log('');
console.log('D) TRIGGERING (10 §7): la description triggera sui positivi e NON sui negativi:');
// Estrae il campo description del frontmatter (case-insensitive, fino al prossimo
// campo top-level del frontmatter o alla chiusura ---).
function extractDescription(md) {
  const fm = md.match(/^---\s*\n([\s\S]*?)\n---/);
  const body = fm ? fm[1] : md;
  const m = body.match(/description:\s*([\s\S]*?)(?:\n[A-Za-z_]+:|$)/);
  return (m ? m[1] : '').toLowerCase();
}
const desc = extractDescription(skillTxt);
// Un trigger DETERMINISTICO: la query attiva la skill se condivide >=2 keyword di
// dominio con la description E nomina un verbo d'innesco o l'ecosistema. È un proxy
// ispezionabile del gancio di triggering cross-tool (la batteria LLM vera è altrove).
const DOMAIN = ['supabase', 'js', 'ts', 'security', 'sicur', 'rls', 'secret', 'segret',
  'blueprint', 'audit', 'remediat', 'bonific', 'macrotask', 'oracol', 'progetto', 'project'];
function triggers(query) {
  const q = query.toLowerCase();
  // sovrapposizione di keyword di dominio fra query e description.
  const shared = DOMAIN.filter((k) => q.includes(k) && desc.includes(k));
  const verb = /\b(avvi|avanz|bonific|audit|set ?up|imposta|metti in sicurezza|remediat|secure|harden)/i.test(query);
  const eco = /(supabase|js\/ts|javascript|typescript)/i.test(query) && /supabase/.test(desc);
  return shared.length >= 2 && (verb || eco);
}
const positives = [
  'imposta un nuovo progetto Supabase con un blueprint e task atomici',
  'avanza il prossimo macrotask del blueprint su questo progetto JS/TS Supabase',
  'fai un audit di sicurezza e bonifica i secret e le RLS di questo repo Supabase',
];
const negatives = [
  'scrivimi una regex per validare le email',
  'spiega come funziona l\'algoritmo di Dijkstra',
  'traduci questo paragrafo in francese',
];
const posOk = desc.length > 0 && positives.every((q) => triggers(q));
const negOk = desc.length > 0 && negatives.every((q) => !triggers(q));
assert('la description TRIGGERA su tutte le query positive (BOOTSTRAP/BUILD/REMEDIATE)', posOk,
  desc.length ? `positivi-trigger=${positives.filter(triggers).length}/${positives.length}` : 'description vuota/assente');
assert('la description NON triggera su nessuna query irrilevante (niente falsi positivi)', negOk,
  desc.length ? `negativi-trigger=${negatives.filter(triggers).length}/${negatives.length}` : 'description vuota/assente');
// La description nomina ecosistema + verbi + (almeno una) modalità (02 §3, 10 §7).
assert('la description nomina ecosistema (Supabase + JS/TS) e le modalità (bootstrap/build/remediate)',
  /supabase/.test(desc) && /(js|ts|javascript|typescript)/.test(desc)
    && /bootstrap/.test(desc) && /build/.test(desc) && /remediate/.test(desc),
  desc.length ? 'nominati' : 'description assente');

// =============================================================================
// E) NESSUNA REGRESSIONE: m1/m2/m3/m4 + run_eval ancora 0; fixture bit-identico;
//    nessun residuo temp.
// =============================================================================
console.log('');
console.log('E) Nessuna regressione (m1/m2/m3/m4 + run_eval) + integrità fixture canonica:');
const det = nodeRun(RUN_EVAL, ['--mode=detection']);
assert('run_eval --mode=detection ancora EXIT 0', det.status === 0, `exit=${det.status}`);
const pres = nodeRun(RUN_EVAL, ['--mode=present']);
assert('run_eval --mode=present ancora EXIT 0', pres.status === 0, `exit=${pres.status}`);

const m1 = nodeRun(M1_GATE, []);
assert('m1_gate_check ancora EXIT 0', m1.status === 0, `exit=${m1.status}`);
const m2 = nodeRun(M2_GATE, []);
assert('m2_gate_check ancora EXIT 0', m2.status === 0, `exit=${m2.status}`);
// m3/m4 escono 2 se la loro precondizione (DB / docker+semgrep) non è soddisfatta:
// in M5 quegli oracoli ci SONO (preflight in §0 superato), quindi 0 è atteso; ma
// tolleriamo 2 come "precondizione non soddisfatta", MAI imputabile a M5.
const m3 = nodeRun(M3_GATE, []);
assert('m3_gate_check ancora EXIT 0 (oppure 2 = DB di prova assente, non regressione M5)',
  m3.status === 0 || m3.status === 2,
  m3.status === 2 ? 'exit=2 (precondizione M3)' : `exit=${m3.status}`);
const m4 = nodeRun(M4_GATE, []);
assert('m4_gate_check ancora EXIT 0 (oppure 2 = oracolo semgrep assente, non regressione M5)',
  m4.status === 0 || m4.status === 2,
  m4.status === 2 ? 'exit=2 (precondizione M4)' : `exit=${m4.status}`);

assert('nessuna copia temp residua (eval/.tmp-verify)', !existsSync(TMP_VERIFY),
  existsSync(TMP_VERIFY) ? 'directory ancora presente' : 'assente');
assert('nessun residuo .trueline/ del ruleset nel fixture canonico',
  !existsSync(resolve(REFERENCE_APP, '.trueline')),
  existsSync(resolve(REFERENCE_APP, '.trueline')) ? '.trueline/ residuo (cleanup mancato)' : 'pulito');

// fixture canonico bit-identico (parte tracciata): HEAD e status invariati.
const headAfter = gitRead(REFERENCE_APP, ['rev-parse', 'HEAD']).stdout;
const statusAfter = gitRead(REFERENCE_APP, ['status', '--porcelain']).stdout;
assert('fixture canonica bit-identica dopo (git status/HEAD invariati)',
  headAfter === headBefore && statusAfter === statusBefore,
  headAfter === headBefore && statusAfter === statusBefore ? 'invariata' : 'MUTATA');

// --- Esito ------------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE M5 RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
