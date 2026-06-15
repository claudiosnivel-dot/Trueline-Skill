// run_loop.mjs — orchestratore di SESSIONE del verify-fix loop (05 §2, §6).
//
// Mette insieme i pezzi su una COPIA TEMPORANEA della reference app:
//   1) crea la copia temp (verify_workspace) — il fixture canonico NON si tocca.
//   2) crea il branch di lavoro (git a strati, autonomo).
//   3) raccoglie i finding dagli ORACOLI (gitleaks wt+history, rls, knip),
//      normalizzati nel finding model (04).
//   4) per ogni finding del SET IN-SCOPE (verificato-a-zero), esegue il loop
//      per-finding (loop.mjs) col FIX PROVIDER iniettato (eval = deterministico).
//   5) RI-VALUTA il checkpoint intero (01 §4) sulla copia dopo le fix.
//   6) esercita le DECISIONI del modello git a strati (merge gated / distruttive).
//   7) cleanup della copia temp (rm -rf). Il fixture canonico resta bit-identico.
//
// Uso:
//   node run_loop.mjs [--eval] [--mode=build|remediate] [--keep]
//     --eval    auto-approva il gate umano in modo deterministico (solo-eval).
//     --mode    modalita per l'asimmetria git/checkpoint (default remediate).
//     --keep    NON cancella la copia temp (debug). Default: cleanup sempre.
//   Stampa un JSON di esito su stdout. Exit 0 sempre che la sessione giri
//   (l'esito di merito e' nel JSON; il GATE M1 e' in eval/harness).
//
// Node ESM, solo built-in + i moduli M0/M1.

import { delimiter, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { normalize } from '../findings/normalize.mjs';
import { validateMany } from '../findings/validate_finding.mjs';
import { createVerifyWorkspace } from './verify_workspace.mjs';
import { deterministicFixProvider } from './fix_provider.mjs';
import { runFindingLoop } from './loop.mjs';
import { runCheckpoint } from '../checkpoint/checkpoint.mjs';
import { LOOP_BUDGET } from '../checkpoint/thresholds.mjs';
import {
  createWorkBranch, decideMerge, requestDestructive, currentBranch,
} from '../git/layered_git.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORACLES = resolve(__dirname, '..', 'oracles');
const RUN_GITLEAKS = resolve(ORACLES, 'run_gitleaks.mjs');
const RLS_CHECK = resolve(ORACLES, 'rls_check.mjs');
const RUN_DEADCODE = resolve(ORACLES, 'run_deadcode.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';

const RUN_OPTS = { runId: 'loop-session', createdAt: '1970-01-01T00:00:00.000Z' };

function runOracle(script, args, cwd) {
  const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) return { ok: false, json: null };
  const raw = (res.stdout || '').trim();
  if (!raw) return { ok: false, json: null };
  try { return { ok: true, json: JSON.parse(raw) }; } catch { return { ok: false, json: null }; }
}

function norm(oracle, json, scope) {
  const f = normalize(oracle, json, { ...RUN_OPTS, scope });
  const v = validateMany(f);
  // Tagghiamo lo scope di provenienza su ogni finding (serve a distinguere
  // S1 working-tree da S2 history, e a scegliere il re-run corretto nel loop).
  const tagged = (v.ok ? f : []).map((x) => ({ ...x, _scope: scope }));
  return tagged;
}

// Raccoglie i finding dalla COPIA per il set verificato-a-zero (secret/rls/dead-code).
function collectFindings(dir) {
  const findings = [];
  const migrations = resolve(dir, 'supabase', 'migrations');

  const gwt = runOracle(RUN_GITLEAKS, [dir, 'working-tree'], dir);
  if (gwt.ok) findings.push(...norm('gitleaks', gwt.json, 'working-tree'));

  const gh = runOracle(RUN_GITLEAKS, [dir, 'history'], dir);
  if (gh.ok) findings.push(...norm('gitleaks', gh.json, 'history'));

  const rls = runOracle(RLS_CHECK, [migrations], dir);
  if (rls.ok) findings.push(...norm('rls-check', rls.json, 'static-ddl'));

  const dc = runOracle(RUN_DEADCODE, [dir], dir);
  if (dc.ok) findings.push(...norm('knip', dc.json, 'working-tree'));

  return findings;
}

const baseName = (p) => String(p).replace(/\\/g, '/').split('/').pop();

// Selettore del set IN-SCOPE per il loop (set verificato-a-zero, L-COL-010 +
// set seminato verificato-a-zero del prompt: S1, S2, S3, S4, S5, S8).
//
//   SECRET:
//     - S1 = secret in WORKING-TREE su config.ts        -> verified atteso
//     - S2 = secret SOLO in HISTORY su credentials.ts    -> mitigated-residual
//     Nota: S1 riappare anche nella history (stesso file config.ts in scope
//     history); lo IGNORIAMO la' (e' gia' coperto dal re-run working-tree).
//   RLS: S3/S4/S5 (tutti i finding rls).
//   DEAD-CODE: S8 = il FILE morto seminato src/legacy/unused.ts. Altro
//     dead-code incidentale (es. db.ts, legato a S6 detection-only) NON e' nel
//     set seminato in-scope di M1: e' baseline/pre-existing (resta nel report,
//     non entra nel loop di M1). // TODO M3+: remediation piena del residuo.
function selectInScope(findings) {
  const result = [];
  const fpSeen = new Set();
  const push = (f) => { if (!fpSeen.has(f.fingerprint)) { fpSeen.add(f.fingerprint); result.push(f); } };

  for (const f of findings) {
    if (f.category === 'rls') { push(f); continue; }

    if (f.category === 'dead-code') {
      // Solo il file morto seminato S8 (unused.ts).
      if (baseName(f.location.file) === 'unused.ts') push(f);
      continue;
    }

    if (f.category === 'secret') {
      const bn = baseName(f.location.file);
      // S1: working-tree su config.ts.
      if (bn === 'config.ts' && f._scope === 'working-tree') { push(f); continue; }
      // S2: history su credentials.ts (file assente dal working tree).
      if (bn === 'credentials.ts' && f._scope === 'history') { push(f); continue; }
      // config.ts in scope history = S1 gia' coperto -> ignora.
    }
  }
  return result;
}

function main() {
  const argv = process.argv.slice(2);
  const evalMode = argv.includes('--eval');
  const keep = argv.includes('--keep');
  const modeArg = (argv.find((a) => a.startsWith('--mode=')) || '').split('=')[1];
  const mode = modeArg === 'build' ? 'build' : 'remediate';

  const ws = createVerifyWorkspace({ id: `loop-${RUN_OPTS.runId}` });
  const report = {
    mode, evalMode, workspace: ws.dir, fixtureMutated: false, findings: [], checkpoint: null, git: {},
  };

  try {
    // (2) branch di lavoro autonomo (convenzione 05 §8.1).
    const branchName = `trueline/${mode}/loop-session`;
    createWorkBranch(ws.dir, branchName);
    report.git.branch = currentBranch(ws.dir);

    // (3) raccogli i finding dalla copia.
    const all = collectFindings(ws.dir);
    const inScope = selectInScope(all);

    // BASELINE (04 §6): fingerprint di TUTTO cio' che e' pre-esistente PRIMA
    // delle fix. Il checkpoint finale gate-a sui finding NUOVI (delta): il
    // dead-code incidentale di db.ts (residuo S6, fuori dal set seminato M1) e'
    // pre-existing -> NON blocca il controllo 1 (resta segnalato, non cancellato
    // in autonomia, L-COL-021). // TODO M3+: remediation piena del residuo.
    const baseline = new Set(all.map((f) => f.fingerprint));
    report.baselineSize = baseline.size;

    // (4) loop per-finding sul set in-scope.
    const provider = deterministicFixProvider();
    const budget = { startedAt: Date.now(), deadlineMs: Date.now() + LOOP_BUDGET.GLOBAL_WALL_CLOCK_MS };
    for (const finding of inScope) {
      const res = runFindingLoop(finding, { dir: ws.dir, fixProvider: provider, evalMode, runOpts: RUN_OPTS, budget });
      report.findings.push(res);
    }

    // (5) RI-VALUTA il checkpoint intero sulla copia (dopo le fix applicate),
    //     col baseline-delta: gate-a sui finding NUOVI sopra soglia (04 §6).
    //     I controlli 3/4 restano degradati (M3, niente test): documentato.
    const cp = runCheckpoint(ws.dir, { mode, runOpts: RUN_OPTS, withOsv: false, baseline });
    report.checkpoint = {
      green: cp.green, summary: cp.summary, degraded: cp.degraded,
      controls: cp.controls.map((c) => ({ id: c.id, name: c.name, status: c.status, green: c.green, detail: c.detail })),
    };

    // (6) DECISIONI del modello git a strati (esercitate, non eseguite su remote).
    //     a) merge gated dal checkpoint + deploy-coupling, per i tre casi.
    report.git.merge = {
      // BUILD verde + non-coupled (utente conferma) -> autonomo.
      build_noncoupled: decideMerge({ dir: ws.dir, mode: 'build', checkpointGreen: true, confirmedCoupled: false }),
      // BUILD verde + coupled (o unknown non confermato) -> sospeso.
      build_coupled: decideMerge({ dir: ws.dir, mode: 'build', checkpointGreen: true, confirmedCoupled: true }),
      build_unknown_unconfirmed: decideMerge({ dir: ws.dir, mode: 'build', checkpointGreen: true, confirmedCoupled: null }),
      // REMEDIATE -> sempre human-gated.
      remediate: decideMerge({ dir: ws.dir, mode: 'remediate', checkpointGreen: true, confirmedCoupled: false }),
    };
    //     b) operazione distruttiva -> sempre bloccata in autonomia.
    report.git.destructive = requestDestructive('history rewrite');

    report.ok = true;
  } catch (e) {
    report.ok = false;
    report.error = String(e && e.message ? e.message : e);
  } finally {
    // (7) cleanup SEMPRE (salvo --keep): il fixture canonico resta intatto.
    if (!keep) ws.cleanup();
    report.cleanedUp = !keep;
  }

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(0);
}

const __isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (__isMain) main();

export { collectFindings, selectInScope };
