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
import { partition } from '../characterization/partition.mjs';
import {
  GATE_SEVERITY, VERIFIED_ZERO_CATEGORIES, CONTROL2_GATE_CATEGORIES, severityAtLeast,
} from './thresholds.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const ORACLES = resolve(__dirname, '..', 'oracles');
const RUN_GITLEAKS = resolve(ORACLES, 'run_gitleaks.mjs');
const RLS_CHECK = resolve(ORACLES, 'rls_check.mjs');
const RUN_DEADCODE = resolve(ORACLES, 'run_deadcode.mjs');
const RUN_OSV = resolve(ORACLES, 'run_osv.mjs');
const RUN_SEMGREP = resolve(ORACLES, 'run_semgrep.mjs');

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
// sopra soglia nelle categorie gate / categoria dead-code). baseline = Set<fingerprint>.
//
// gateCategories: l'insieme di categorie che bloccano il controllo. Il controllo 1
// (dead-code) usa deadcode=true (gate per delta, mai per severita). Il controllo 2
// (sicurezza) passa CONTROL2_GATE_CATEGORIES (secret/rls + detection-blocking
// injection/authz). Default = VERIFIED_ZERO_CATEGORIES per i chiamanti legacy.
function deltaBlockers(findings, baseline, { deadcode = false, gateCategories = VERIFIED_ZERO_CATEGORIES } = {}) {
  const out = [];
  for (const f of findings) {
    const isNew = !baseline.has(f.fingerprint);
    f.baseline_status = isNew ? 'new' : 'pre-existing';
    if (!isNew) continue; // pre-esistente: segnalato, non blocca (04 §6)
    if (deadcode) {
      // controllo 1: gate per DELTA, mai per severita.
      out.push(f);
    } else if (
      gateCategories.has(f.category)
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

  // semgrep (07 §4) — oracolo AI curato per i pattern vietati injection/authz/
  // crypto/sink (S6 injection, S7 authz). Gira VIA DOCKER (run_semgrep.mjs): la
  // SKILL resta dep-free, il container ha semgrep pinnato. BEST-EFFORT come osv:
  // se docker/l'immagine non e' disponibile NON falsifichiamo il verde, ma lo
  // dichiariamo DEGRADATO per semgrep (un oracolo che non gira NON e' verde,
  // L-COL-006/L-COL-002) — MAI contato come pulito. Il path normalizzato dei
  // finding semgrep (stripContainerSrc -> base "eval/reference-app") coincide con
  // quello di gitleaks/rls, quindi i fingerprint sono coerenti col baseline-delta.
  let semgrepNote = '';
  if (existsSync(RUN_SEMGREP)) {
    // run_semgrep.mjs emette il JSON nativo su stdout (diagnostiche su stderr) e
    // monta la dir target in /src. Gli passiamo la dir target (la copia temp del
    // checkpoint), eseguito con cwd=referenceApp come gli altri oracoli.
    const s = runOracle(RUN_SEMGREP, [referenceApp], referenceApp);
    if (s.ok && s.json && Array.isArray(s.json.results)) {
      // NIENTE override di base: i path semgrep arrivano come "/src/<rel>" e
      // normalize li strippa a "eval/reference-app/<rel>" (DEFAULT_BASE), ESATTAMENTE
      // come gitleaks/rls. Cosi i fingerprint sono coerenti col baseline-delta e col
      // run di sezione 2 del gate (che usa base eval/reference-app).
      const n = normFindings('semgrep', s.json, { ...runOpts, scope: 'working-tree' });
      if (n.ok) { all.push(...n.findings); sub.push(`semgrep:${n.findings.length}`); }
      else semgrepNote = ` (semgrep: output non normalizzabile, degradato — ${n.detail})`;
    } else {
      // docker assente / immagine non pinnata / JSON non valido: DEGRADATO, non verde.
      semgrepNote = ` (semgrep: oracolo non disponibile via docker, degradato — ${s.detail})`;
    }
  } else {
    semgrepNote = ' (semgrep: wrapper assente, degradato)';
  }

  // CONTROL2_GATE_CATEGORIES (thresholds): secret/rls (verificato-a-zero) PIU' le
  // detection-blocking injection/authz (M4). Un NUOVO finding semgrep injection/
  // authz sopra soglia BLOCCA; un S6/S7 PRE-ESISTENTE (gia' in baseline) no.
  const blockers = deltaBlockers(all, baseline, { deadcode: false, gateCategories: CONTROL2_GATE_CATEGORIES });
  const green = blockers.length === 0;
  return {
    id: 2, name: 'security', status: green ? 'green' : 'red', green,
    detail: green
      ? `nessun finding di sicurezza NUOVO >= ${GATE_SEVERITY} [${sub.join(' ')}]${osvNote}${semgrepNote}`
      : `${blockers.length} finding NUOVO >= ${GATE_SEVERITY} [${sub.join(' ')}]${osvNote}${semgrepNote}`,
    findings: all, blockers,
  };

  function secErr(where, d) {
    return { id: 2, name: 'security', status: 'error', green: false, detail: `${where}: ${d}`, findings: all, blockers: [] };
  }
}

// =============================================================================
// CHARACTERIZATION SNAPSHOT (06): baseline congelata + recompute corrente.
// =============================================================================
//
// La suite di characterization scrive:
//   test/characterization/baseline.json = { assertions:[{id,...,observed}], ... }
//   test/characterization/run.mjs       = recomputer -> { assertions:[{id,observed}] }
// L'INVARIANZA (06 §4) confronta l'observed CORRENTE (recompute) con la baseline,
// partizionando le assertion in GUARD vs IMPACTED rispetto a un finding (la fix
// puo' cambiare legittimamente le IMPACTED, mai le GUARD).

const CHARZ_REL_BASELINE = 'test/characterization/baseline.json';
const CHARZ_REL_RUNNER = 'test/characterization/run.mjs';

// deep-equal strutturale (ordine-insensibile sulle chiavi), per confrontare due
// observed JSON. Niente dipendenze: confronto ricorsivo deterministico.
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  if (!ka.every((k, i) => k === kb[i])) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

// Rileva se il progetto ha una suite di characterization VALUE-BASED (baseline +
// runner). In assenza -> null (il chiamante ricade sul comportamento degradato,
// preservando M1: un progetto senza characterization NON regredisce).
export function loadCharacterization(referenceApp) {
  const baselinePath = join(referenceApp, CHARZ_REL_BASELINE);
  const runnerPath = join(referenceApp, CHARZ_REL_RUNNER);
  if (!existsSync(baselinePath) || !existsSync(runnerPath)) return null;
  let baseline;
  try { baseline = JSON.parse(readFileSync(baselinePath, 'utf8')); } catch { return null; }
  if (!baseline || !Array.isArray(baseline.assertions)) return null;
  return { baseline, runnerPath };
}

// Esegue run.mjs (recomputer) sul codice CORRENTE e ritorna una Map id->observed.
function recomputeObserved(referenceApp, runnerPath) {
  const res = spawnSync(process.execPath, [runnerPath], {
    cwd: referenceApp, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) return { ok: false, detail: `spawn run.mjs: ${res.error.message}` };
  if (res.status !== 0) {
    return { ok: false, detail: `run.mjs exit=${res.status}: ${(res.stderr || res.stdout || '').trim().slice(-300)}` };
  }
  const lines = (res.stdout || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { ok: false, detail: 'run.mjs: nessun output' };
  let parsed;
  try { parsed = JSON.parse(lines[lines.length - 1]); }
  catch (e) { return { ok: false, detail: `run.mjs JSON invalido: ${e.message}` }; }
  const map = new Map((parsed.assertions || []).map((a) => [a.id, a.observed]));
  return { ok: true, map };
}

// characterizationInvariance — il NODO 06 §4. Confronta l'observed corrente con
// la baseline, partizionato per finding:
//   - control 3 (regressioni): ogni GUARD deve deep-equal il suo observed di
//     baseline; una guard cambiata = regressione (red).
//   - control 4 (invarianza): GUARD invariante; le IMPACTED sono RI-BASELINED al
//     post-fix (la fix cambia legittimamente l'impacted). Green = guard invarianti.
// Senza finding (partitionCtx null) -> invarianza PURA: TUTTE guard.
//
// Ritorna { ok, green, detail, guard, impacted, changedGuards }.
export function characterizationInvariance(referenceApp, charz, finding) {
  const recomputed = recomputeObserved(referenceApp, charz.runnerPath);
  if (!recomputed.ok) {
    return { ok: false, green: false, detail: `recompute KO: ${recomputed.detail}` };
  }
  const assertions = charz.baseline.assertions;
  // partition() decide GUARD vs IMPACTED. Senza finding, tutte le assertion sono
  // GUARD (invarianza pura): passiamo un finding "vuoto" che non impatta nulla
  // (categoria sconosciuta, nessuna location) MA forziamo impacted=[] noi stessi.
  let guardIds; let impactedIds;
  if (finding) {
    const part = partition(finding, assertions);
    guardIds = new Set(part.guard);
    impactedIds = new Set(part.impacted);
  } else {
    guardIds = new Set(assertions.map((a) => a.id));
    impactedIds = new Set();
  }

  const changedGuards = [];
  const missingGuards = [];
  for (const a of assertions) {
    if (!guardIds.has(a.id)) continue; // impacted: re-baselined, non vincola.
    if (!recomputed.map.has(a.id)) { missingGuards.push(a.id); continue; }
    if (!deepEqual(recomputed.map.get(a.id), a.observed)) changedGuards.push(a.id);
  }

  const green = changedGuards.length === 0 && missingGuards.length === 0;
  const detail = green
    ? `invarianza OK: ${guardIds.size} guard invarianti${impactedIds.size ? `, ${impactedIds.size} impacted re-baselined` : ''}`
    : `invarianza VIOLATA: guard cambiate=[${changedGuards.join(',')}]`
      + (missingGuards.length ? ` guard mancanti=[${missingGuards.join(',')}]` : '');
  return {
    ok: true, green, detail,
    guard: [...guardIds], impacted: [...impactedIds], changedGuards, missingGuards,
  };
}

// =============================================================================
// CONTROLLO 3 — REGRESSIONI — characterization (06) o degradato (backward-compat).
// =============================================================================
//
// Con una suite di characterization VALUE-BASED presente: ogni GUARD deve restare
// invariante vs baseline (recompute observed deep-equal). Le IMPACTED dal finding
// (se passato) sono ri-baselined: non vincolano (la fix le cambia legittimamente).
// SENZA characterization: comportamento M1 invariato (degradato onesto, NON verde).
export function control3Regressions(referenceApp, { mode = 'remediate', characterization = null, finding = null } = {}) {
  const charz = characterization || loadCharacterization(referenceApp);
  if (charz) {
    const inv = characterizationInvariance(referenceApp, charz, finding);
    if (!inv.ok) {
      return { id: 3, name: 'regressions', status: 'error', green: false, detail: inv.detail };
    }
    return {
      id: 3, name: 'regressions', status: inv.green ? 'green' : 'red', green: inv.green,
      detail: `characterization (06 §4): ${inv.detail}`,
      guard: inv.guard, impacted: inv.impacted, changedGuards: inv.changedGuards,
    };
  }
  // BACKWARD-COMPAT: nessuna characterization -> M1 invariato.
  const runner = detectTestRunner(referenceApp);
  if (!runner.present) {
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
// CONTROLLO 4 — CONFORMITA-LOGICA / INVARIANZA — characterization o degradato.
// =============================================================================
//
// REMEDIATE: invarianza comportamentale (06 §4) — identica logica del controllo 3
// con la partition (GUARD invarianti, IMPACTED re-baselined). Con una suite
// presente, green = guard invarianti. SENZA characterization: M1 invariato.
export function control4Conformance(referenceApp, { mode = 'remediate', characterization = null, finding = null } = {}) {
  const charz = characterization || loadCharacterization(referenceApp);
  if (charz) {
    const inv = characterizationInvariance(referenceApp, charz, finding);
    if (!inv.ok) {
      return { id: 4, name: 'conformance', status: 'error', green: false, detail: inv.detail };
    }
    return {
      id: 4, name: 'conformance', status: inv.green ? 'green' : 'red', green: inv.green,
      detail: `invarianza characterization (06 §4): ${inv.detail}`,
      guard: inv.guard, impacted: inv.impacted, changedGuards: inv.changedGuards,
    };
  }
  // BACKWARD-COMPAT: nessuna characterization -> M1 invariato.
  const runner = detectTestRunner(referenceApp);
  if (!runner.present) {
    return {
      id: 4, name: 'conformance', status: 'degraded', green: false,
      detail: mode === 'build'
        ? 'nessun test di accettazione: controllo DEGRADATO, NON verde — M3 (11 §3)'
        : 'nessuna baseline characterization: controllo DEGRADATO, NON verde — M3 (06)',
    };
  }
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
    // finding: contesto per la partition GUARD/IMPACTED dei controlli 3/4 (06 §4).
    //   - presente (REMEDIATE su una fix): le assertion sulla stessa regione/tabella
    //     sono IMPACTED (re-baselined); le altre GUARD (invarianti).
    //   - assente (run_checkpoint "puro"): TUTTE le assertion sono GUARD
    //     (invarianza pura: tutto deve restare invariato vs baseline).
    finding = null,
    // characterization: snapshot pre-caricato { baseline, runnerPath }. Se null,
    // viene auto-rilevato da referenceApp (test/characterization/*).
    characterization = null,
  } = opts;

  const c1 = control1DeadCode(referenceApp, { baseline, runOpts });
  const c2 = control2Security(referenceApp, { baseline, runOpts, withOsv });
  const c3 = control3Regressions(referenceApp, { mode, characterization, finding });
  const c4 = control4Conformance(referenceApp, { mode, characterization, finding });

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
