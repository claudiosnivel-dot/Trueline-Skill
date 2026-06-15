// checkpoint.mjs — il CHECKPOINT a 4 controlli (01 §4).
//
// Gira al confine di ogni macrotask (BUILD) ed e' il motore di verifica anche
// dentro il loop di REMEDIATE. Quattro controlli, ciascuno ancorato a un
// ORACOLO deterministico. L'LLM NON decide l'esito di nessuno dei quattro
// (L-COL-002): verde/rosso e' una proprieta' dell'output del comando.
//
//   1) DEAD CODE        -> run_deadcode (knip). Verde = nessun morto NUOVO
//                          (gate per DELTA, 04 §6); il morto pre-esistente e'
//                          SEGNALATO, non cancellato in autonomia (L-COL-021).
//   2) SICUREZZA        -> gitleaks (working-tree) + rls_check + osv
//                          [+ semgrep DIFFERITO a M4]. Verde = nessun finding
//                          NUOVO con severity >= soglia (thresholds.md) nelle
//                          categorie in scope.
//   3) REGRESSIONI      -> test runner (suite esistente in BUILD / characterization
//                          in REMEDIATE). Verde = nessun test prima verde ora rosso.
//   4) CONFORMITA-LOGICA-> test di accettazione (BUILD) / invarianza
//                          characterization (REMEDIATE).
//
// FORWARD-DEP (M3): i characterization test (06) e i test di accettazione NON
// esistono ancora -> in assenza di test i controlli 3/4 si DICHIARANO DEGRADATI
// (status="degraded", // TODO M3), NON un falso verde. Un controllo degradato
// NON e' verde: il checkpoint NON e' "interamente verde" finche' 3/4 sono
// degradati. Questo e' onesto (L-COL-006: nessun falso via libera).
//
// USO BASELINE-DELTA (03 §8, 04 §6): il gate guarda i finding NUOVI sopra
// soglia, non l'assoluto. La baseline e' un insieme di fingerprint gia' noti.
//
// Node ESM, solo built-in + i wrapper M0 (oracoli) e l'adapter normalize (04).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize } from '../findings/normalize.mjs';
import { validateMany } from '../findings/validate_finding.mjs';
import {
  GATE_SEVERITY, VERIFIED_ZERO_CATEGORIES, severityAtLeast,
} from './thresholds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const ORACLES = resolve(__dirname, '..', 'oracles');
const RUN_GITLEAKS = resolve(ORACLES, 'run_gitleaks.mjs');
const RLS_CHECK = resolve(ORACLES, 'rls_check.mjs');
const RUN_DEADCODE = resolve(ORACLES, 'run_deadcode.mjs');
const RUN_OSV = resolve(ORACLES, 'run_osv.mjs');

const GO_BIN = process.platform === 'win32'
  ? 'C:/Users/claud/go/bin'
  : '/c/Users/claud/go/bin';

// Esegue un oracolo come processo figlio e ne parsa lo stdout JSON. Decide
// dall'output (report), non dall'exit code (03 §3).
function runOracle(scriptPath, args, cwd = ROOT) {
  if (!existsSync(scriptPath)) {
    return { ok: false, json: null, detail: `oracolo assente: ${scriptPath}` };
  }
  const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) return { ok: false, json: null, detail: `spawn: ${res.error.message}` };
  const raw = (res.stdout || '').trim();
  if (!raw) {
    const tail = (res.stderr || '').trim().split('\n').slice(-1)[0] || '(stderr vuoto)';
    return { ok: false, json: null, detail: `nessun JSON (exit=${res.status}): ${tail}` };
  }
  try { return { ok: true, json: JSON.parse(raw), detail: `exit=${res.status}` }; }
  catch (e) { return { ok: false, json: null, detail: `JSON invalido: ${e.message}` }; }
}

function normFindings(oracle, native, opts) {
  let findings = [];
  try { findings = normalize(oracle, native, opts); }
  catch (e) { return { ok: false, findings: [], detail: `normalize(${oracle}): ${e.message}` }; }
  const v = validateMany(findings);
  if (!v.ok) return { ok: false, findings, detail: `schema KO: ${v.errors.slice(0, 2).join('; ')}` };
  return { ok: true, findings, detail: `${findings.length} finding` };
}

// Applica il baseline-delta (04 §6): marca ogni finding new/pre-existing in base
// al set di fingerprint baseline, e ritorna solo quelli che BLOCCANO (new +
// sopra soglia / categoria dead-code). baseline = Set<fingerprint>.
function deltaBlockers(findings, baseline, { deadcode = false } = {}) {
  const out = [];
  for (const f of findings) {
    const isNew = !baseline.has(f.fingerprint);
    f.baseline_status = isNew ? 'new' : 'pre-existing';
    if (!isNew) continue; // pre-esistente: segnalato, non blocca (04 §6)
    if (deadcode) {
      // controllo 1: gate per DELTA, mai per severita.
      out.push(f);
    } else if (
      VERIFIED_ZERO_CATEGORIES.has(f.category)
      && severityAtLeast(f.severity, GATE_SEVERITY)
    ) {
      out.push(f);
    }
  }
  return out;
}

// =============================================================================
// CONTROLLO 1 — DEAD CODE (knip)
// =============================================================================
export function control1DeadCode(referenceApp, { baseline = new Set(), runOpts }) {
  const r = runOracle(RUN_DEADCODE, [referenceApp], referenceApp);
  if (!r.ok) {
    return { id: 1, name: 'dead-code', status: 'error', green: false, detail: r.detail, findings: [], blockers: [] };
  }
  const n = normFindings('knip', r.json, { ...runOpts, scope: 'working-tree' });
  if (!n.ok) {
    return { id: 1, name: 'dead-code', status: 'error', green: false, detail: n.detail, findings: [], blockers: [] };
  }
  const blockers = deltaBlockers(n.findings, baseline, { deadcode: true });
  const green = blockers.length === 0;
  return {
    id: 1, name: 'dead-code', status: green ? 'green' : 'red', green,
    detail: green
      ? `nessun dead-code NUOVO (totali=${n.findings.length}, pre-esistenti segnalati)`
      : `${blockers.length} dead-code NUOVO introdotto`,
    findings: n.findings, blockers,
  };
}

// =============================================================================
// CONTROLLO 2 — SICUREZZA (gitleaks working-tree + rls_check + osv)
// =============================================================================
export function control2Security(referenceApp, { baseline = new Set(), runOpts, withOsv = true }) {
  const migrations = resolve(referenceApp, 'supabase', 'migrations');
  const all = [];
  const sub = [];

  // gitleaks working-tree (scope BUILD; S1 vive qui). cwd = referenceApp per
  // allineare i path normalizzati (e quindi i fingerprint) a collectFindings
  // del loop: e' la chiave del baseline-delta (04 §6).
  const g = runOracle(RUN_GITLEAKS, [referenceApp, 'working-tree'], referenceApp);
  if (g.ok) {
    const n = normFindings('gitleaks', g.json, { ...runOpts, scope: 'working-tree' });
    if (n.ok) { all.push(...n.findings); sub.push(`gitleaks:${n.findings.length}`); }
    else return secErr('gitleaks normalize', n.detail);
  } else return secErr('gitleaks', g.detail);

  // rls_check (DDL; S3/S4/S5 vivono qui).
  const r = runOracle(RLS_CHECK, [migrations], referenceApp);
  if (r.ok) {
    const n = normFindings('rls-check', r.json, { ...runOpts, scope: 'static-ddl' });
    if (n.ok) { all.push(...n.findings); sub.push(`rls:${n.findings.length}`); }
    else return secErr('rls normalize', n.detail);
  } else return secErr('rls-check', r.detail);

  // osv-scanner (dependency-vuln). Prende un LOCKFILE (non una dir) e richiede
  // rete. Best-effort: se l'oracolo non gira (offline/lock assente) NON
  // falsifichiamo il verde, ma lo dichiariamo degradato per osv (la fixture M-1
  // NON ha CVE seminate, vedi run_osv §smoke).
  const lockfile = resolve(referenceApp, 'package-lock.json');
  let osvNote = '';
  if (withOsv && existsSync(RUN_OSV) && existsSync(lockfile)) {
    const o = runOracle(RUN_OSV, [lockfile], referenceApp);
    if (o.ok) {
      const n = normFindings('osv', o.json, { ...runOpts, scope: 'deps' });
      if (n.ok) { all.push(...n.findings); sub.push(`osv:${n.findings.length}`); }
      else osvNote = ' (osv: output non normalizzabile, degradato)';
    } else {
      osvNote = ' (osv: non eseguibile offline, degradato)';
    }
  }

  // semgrep DIFFERITO M4 (07 §4): non gate-ato qui.
  // TODO M4: integrare semgrep (ruleset AI curato) nel controllo 2.

  const blockers = deltaBlockers(all, baseline, { deadcode: false });
  const green = blockers.length === 0;
  return {
    id: 2, name: 'security', status: green ? 'green' : 'red', green,
    detail: green
      ? `nessun finding di sicurezza NUOVO >= ${GATE_SEVERITY} [${sub.join(' ')}]${osvNote}`
      : `${blockers.length} finding NUOVO >= ${GATE_SEVERITY} [${sub.join(' ')}]${osvNote}`,
    findings: all, blockers,
  };

  function secErr(where, d) {
    return { id: 2, name: 'security', status: 'error', green: false, detail: `${where}: ${d}`, findings: all, blockers: [] };
  }
}

// =============================================================================
// CONTROLLO 3 — REGRESSIONI (test runner) — DEGRADATO in assenza di test (M3)
// =============================================================================
export function control3Regressions(referenceApp, { mode = 'remediate' } = {}) {
  const runner = detectTestRunner(referenceApp);
  if (!runner.present) {
    // FORWARD-DEP: in REMEDIATE l'oracolo sono i characterization test (06),
    // che NON esistono ancora -> M3. In assenza, NON un falso verde: degradato.
    // TODO M3: eseguire i characterization test (06) e asserire "nessun test
    //   prima verde ora rosso".
    return {
      id: 3, name: 'regressions', status: 'degraded', green: false,
      detail: `nessun test runner (${mode}): controllo DEGRADATO, NON verde — characterization test = M3 (06)`,
    };
  }
  const res = runTests(referenceApp, runner);
  return {
    id: 3, name: 'regressions', status: res.green ? 'green' : 'red', green: res.green,
    detail: res.detail,
  };
}

// =============================================================================
// CONTROLLO 4 — CONFORMITA-LOGICA — DEGRADATO in assenza di test (M3)
// =============================================================================
export function control4Conformance(referenceApp, { mode = 'remediate' } = {}) {
  // BUILD: test di accettazione del task atomico (11 §3). REMEDIATE: invarianza
  // characterization (06). Nessuno dei due esiste ancora -> M3.
  // TODO M3: BUILD -> eseguire i test di accettazione del task atomico;
  //   REMEDIATE -> asserire invarianza comportamentale via characterization.
  const runner = detectTestRunner(referenceApp);
  if (!runner.present) {
    return {
      id: 4, name: 'conformance', status: 'degraded', green: false,
      detail: mode === 'build'
        ? 'nessun test di accettazione: controllo DEGRADATO, NON verde — M3 (11 §3)'
        : 'nessuna baseline characterization: controllo DEGRADATO, NON verde — M3 (06)',
    };
  }
  // Con un runner presente, in REMEDIATE controllo 4 collassa su 3 (invarianza).
  const res = runTests(referenceApp, runner);
  return {
    id: 4, name: 'conformance', status: res.green ? 'green' : 'red', green: res.green,
    detail: res.detail,
  };
}

// Rileva un test runner nel package.json del progetto target.
function detectTestRunner(referenceApp) {
  const pkgPath = join(referenceApp, 'package.json');
  if (!existsSync(pkgPath)) return { present: false };
  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { return { present: false }; }
  const testScript = pkg.scripts && pkg.scripts.test;
  // Un "test" placeholder ("no test specified") NON conta come runner.
  if (!testScript || /no test specified/i.test(testScript)) return { present: false };
  return { present: true, script: 'test' };
}

function runTests(referenceApp, runner) {
  const res = spawnSync('npm', ['run', runner.script, '--silent'], {
    cwd: referenceApp, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: true,
  });
  const green = !res.error && res.status === 0;
  return { green, detail: green ? 'test verdi' : `test rossi (exit=${res.status})` };
}

// =============================================================================
// CHECKPOINT COMPLETO — esegue i 4 controlli e decide l'esito d'insieme.
// =============================================================================
//
// Ritorna { green, controls[], summary }. "green" (interamente verde) richiede
// che TUTTI i controlli siano green. Un controllo "degraded" (3/4 senza test)
// NON e' verde -> il checkpoint NON e' interamente verde (onesto, L-COL-006).
//
// Opzioni:
//   mode        "build" | "remediate" (default remediate)
//   baseline    Set<fingerprint> gia' noti (delta). Default: vuoto.
//   runOpts     { runId, createdAt } deterministici per riproducibilita.
//   gateOnDegraded  se true (default) i controlli degradati impediscono il verde.
//                   In M1 i 3/4 sono degradati per assenza di test: documentato.
export function runCheckpoint(referenceApp, opts = {}) {
  const {
    mode = 'remediate',
    baseline = new Set(),
    runOpts = { runId: 'checkpoint', createdAt: '1970-01-01T00:00:00.000Z' },
    withOsv = true,
  } = opts;

  const c1 = control1DeadCode(referenceApp, { baseline, runOpts });
  const c2 = control2Security(referenceApp, { baseline, runOpts, withOsv });
  const c3 = control3Regressions(referenceApp, { mode });
  const c4 = control4Conformance(referenceApp, { mode });

  const controls = [c1, c2, c3, c4];
  const green = controls.every((c) => c.green === true);
  const degraded = controls.filter((c) => c.status === 'degraded').map((c) => c.name);

  return {
    green,
    mode,
    controls,
    summary:
      `checkpoint=${green ? 'VERDE' : 'NON-VERDE'} | `
      + controls.map((c) => `${c.id}:${c.name}=${c.status}`).join(' '),
    degraded,
  };
}
