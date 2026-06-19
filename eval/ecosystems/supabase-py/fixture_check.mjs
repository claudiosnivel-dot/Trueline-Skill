#!/usr/bin/env node
// fixture_check.mjs — GATE di T1.2 (SP-3): self-check FALSIFICABILE della fixture
// vulnerabile `supabase-py` (FastAPI + psycopg su SUPABASE). Il "verde" e' un
// FATTO di oracoli REALI (gitleaks/osv/rls-check) + ispezione testuale dei marker
// bonus, MAI un parere dell'LLM (L-COL-002). Scritto TEST-FIRST: prima
// dell'esistenza della fixture questo script FALLISCE (exit 1).
//
// Cosa asserisce (tutti FATTI deterministici):
//   1) run_gitleaks <fixture> working-tree  -> >=1 secret nel file app/config.py (SPY-S1).
//   2) run_osv <fixture>/requirements.txt   -> >=1 vuln su `pyyaml` (SPY-S2).
//   3) rls_check <fixture>/supabase/migrations -> ESATTAMENTE 1 finding RLS003 su
//      public.invoices E 0 finding su public.notes (SPY-S3 + contrasto auth.uid()).
//   4) marker SEED:SPY-S4 in app/routes/bookings.py (injection bonus) E
//      marker SEED:SPY-S5 in app/dead.py (dead-code bonus) presenti.
//   5) la fixture e' un repo git INTERNO pulito (git -C <fixture> status --porcelain
//      vuoto) e l'HEAD del repo ESTERNO e' INVARIATO rispetto allo snapshot iniziale.
//   6) la fixture e' gitignorata dal repo esterno (git check-ignore la copre): il
//      repo esterno NON la traccia.
//   7) SEGNALE FORTE Supabase: supabase/config.toml presente (distingue da postgres-py).
//
// L'osv richiede /c/Users/claud/go/bin sul PATH; gitleaks idem. Questo script
// arricchisce il PATH per gli spawn (mirror dei wrapper). NON tocca il git esterno
// se non in SOLA LETTURA (rev-parse/status/check-ignore).
//
// Node ESM, solo built-in. Esce 0 sse TUTTI i check passano; 1 altrimenti.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// eval/ecosystems/supabase-py -> root e' 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = resolve(__dirname, 'reference-app');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const RUN_OSV = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_osv.mjs');
const RLS_CHECK = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'rls_check.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';

const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}
function readSafe(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }

function nodeRun(script, args, cwd = ROOT) {
  const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}
// git in SOLA LETTURA (mai mutazioni). cwd = la dir target.
function gitRead(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: res.status, stdout: (res.stdout || '').trim(), stderr: (res.stderr || '').trim() };
}

console.log('============================================================');
console.log(' GATE T1.2 — fixture vulnerabile supabase-py (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('============================================================');
console.log('');

// Snapshot iniziale dell'HEAD del repo ESTERNO (sola lettura).
const headBefore = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;

// Precondizione: la fixture esiste.
assert('la fixture reference-app esiste', existsSync(FIXTURE), FIXTURE);

// --- 0) SEGNALE FORTE Supabase: supabase/config.toml presente -----------------
console.log('');
console.log('0) SEGNALE Supabase — supabase/config.toml presente (distingue da postgres-py):');
const supaConfig = readSafe(join(FIXTURE, 'supabase', 'config.toml'));
assert('supabase/config.toml presente e non vuoto', supaConfig.length > 0,
  supaConfig.length ? `${supaConfig.length} byte` : 'assente/vuoto');
assert('supabase/config.toml contiene un project_id', /project_id\s*=/.test(supaConfig),
  /project_id\s*=/.test(supaConfig) ? 'project_id presente' : 'project_id assente');

// --- 1) SPY-S1: gitleaks working-tree trova un secret in app/config.py --------
console.log('');
console.log('1) SPY-S1 — gitleaks (working-tree) trova >=1 secret in app/config.py:');
const gl = nodeRun(RUN_GITLEAKS, [FIXTURE, 'working-tree']);
let glFindings = [];
try { glFindings = JSON.parse(gl.stdout); } catch { /* gestito sotto */ }
assert('run_gitleaks esce 0 ed emette un array JSON', gl.status === 0 && Array.isArray(glFindings),
  `exit=${gl.status} findings=${Array.isArray(glFindings) ? glFindings.length : 'N/A'}`);
const fileOfGl = (f) => String((f && (f.File || f.file)) || '').replace(/\\/g, '/');
const s1 = Array.isArray(glFindings)
  ? glFindings.filter((f) => /(^|\/)app\/config\.py$/.test(fileOfGl(f)))
  : [];
assert('SPY-S1: >=1 secret rilevato nel file app/config.py (gitleaks)', s1.length >= 1,
  s1.length ? `rule=${s1[0].RuleID || s1[0].ruleID || '?'}` : 'nessun finding su app/config.py');

// --- 2) SPY-S2: osv trova una vuln su pyyaml ----------------------------------
console.log('');
console.log('2) SPY-S2 — osv trova >=1 vulnerabilita su pyyaml (requirements.txt):');
const lockfile = join(FIXTURE, 'requirements.txt');
const osv = nodeRun(RUN_OSV, [lockfile]);
let osvNative = null;
try { osvNative = JSON.parse(osv.stdout); } catch { /* gestito sotto */ }
assert('run_osv esce 0 ed emette JSON', osv.status === 0 && osvNative,
  `exit=${osv.status} json=${Boolean(osvNative)}`);
// Scava i pacchetti vulnerabili dal JSON nativo osv (results[].packages[]).
let pyyamlVulns = [];
if (osvNative && Array.isArray(osvNative.results)) {
  for (const r of osvNative.results) {
    for (const p of (r.packages || [])) {
      const name = p.package && p.package.name;
      if (String(name).toLowerCase() === 'pyyaml') {
        for (const v of (p.vulnerabilities || [])) pyyamlVulns.push(v.id);
      }
    }
  }
}
assert('SPY-S2: >=1 vulnerabilita osv su pyyaml', pyyamlVulns.length >= 1,
  pyyamlVulns.length ? pyyamlVulns.join(',') : 'nessuna vuln su pyyaml');

// --- 3) SPY-S3: rls-check -> 1 RLS003 su public.invoices, 0 su public.notes ---
console.log('');
console.log('3) SPY-S3 — rls-check: 1 RLS003 su public.invoices, 0 su public.notes:');
const migrations = join(FIXTURE, 'supabase', 'migrations');
const rls = nodeRun(RLS_CHECK, [migrations]);
let rlsReport = null;
try { rlsReport = JSON.parse(rls.stdout); } catch { /* gestito sotto */ }
const rlsFindings = rlsReport && Array.isArray(rlsReport.findings) ? rlsReport.findings : null;
assert('rls_check esce 0 ed emette un report con findings[]', rls.status === 0 && Array.isArray(rlsFindings),
  `exit=${rls.status} findings=${Array.isArray(rlsFindings) ? rlsFindings.length : 'N/A'}`);
const onInvoices = (rlsFindings || []).filter((f) => f.table === 'public.invoices');
const onNotes = (rlsFindings || []).filter((f) => f.table === 'public.notes');
const inv003 = onInvoices.filter((f) => f.control_id === 'RLS003_PERMISSIVE_TRUE');
assert('SPY-S3: ESATTAMENTE 1 finding RLS003_PERMISSIVE_TRUE su public.invoices',
  inv003.length === 1 && onInvoices.length === 1,
  `invoices: ${onInvoices.length} finding (RLS003=${inv003.length}, policy=${inv003[0]?.policy || '?'})`);
assert('SPY-S3 contrasto: 0 finding su public.notes (auth.uid() isola davvero)',
  onNotes.length === 0,
  `notes: ${onNotes.length} finding`);
assert('rls-check: 1 SOLO finding sull intera migration (precisione)',
  (rlsFindings || []).length === 1,
  `totale finding = ${(rlsFindings || []).length}`);

// --- 4) marker bonus SEED:SPY-S4 (injection) + SEED:SPY-S5 (dead-code) --------
console.log('');
console.log('4) marker bonus: SEED:SPY-S4 (injection) + SEED:SPY-S5 (dead-code):');
const bookings = readSafe(join(FIXTURE, 'app', 'routes', 'bookings.py'));
assert('app/routes/bookings.py esiste e non e vuoto', bookings.length > 0,
  bookings.length ? `${bookings.length} byte` : 'assente/vuoto');
assert('SPY-S4: marker SEED:SPY-S4 presente in bookings.py (injection bonus)', /SEED:SPY-S4/.test(bookings),
  /SEED:SPY-S4/.test(bookings) ? 'presente' : 'assente');
// Contrasto parametrizzato presente: cur.execute con placeholder posizionale %s.
const PARAM_QUERY = /cur\.execute\(\s*["'][^"']*%s[^"']*["']\s*,/;
assert('SPY-S4 contrasto: una query parametrizzata (%s) presente in bookings.py', PARAM_QUERY.test(bookings),
  PARAM_QUERY.test(bookings) ? 'placeholder %s presente' : 'nessun contrasto parametrizzato');
const dead = readSafe(join(FIXTURE, 'app', 'dead.py'));
assert('app/dead.py esiste e non e vuoto', dead.length > 0,
  dead.length ? `${dead.length} byte` : 'assente/vuoto');
assert('SPY-S5: marker SEED:SPY-S5 presente in dead.py (dead-code bonus)', /SEED:SPY-S5/.test(dead),
  /SEED:SPY-S5/.test(dead) ? 'presente' : 'assente');
assert('SPY-S5: _unused_helper definito in dead.py', /def\s+_unused_helper\s*\(/.test(dead),
  /def\s+_unused_helper\s*\(/.test(dead) ? 'presente' : 'assente');
// Contrasto: used_helper definito e referenziato in main.py.
const mainPy = readSafe(join(FIXTURE, 'app', 'main.py'));
assert('SPY-S5 contrasto: used_helper definito in dead.py E chiamato in main.py',
  /def\s+used_helper\s*\(/.test(dead) && /used_helper\s*\(/.test(mainPy),
  /used_helper\s*\(/.test(mainPy) ? 'used_helper() chiamata in main.py' : 'used_helper non usata');

// --- 5) git INTERNO pulito + HEAD esterno invariato ---------------------------
console.log('');
console.log('5) git INTERNO della fixture pulito + HEAD del repo ESTERNO invariato:');
assert('la fixture e un repo git INTERNO (.git presente)', existsSync(join(FIXTURE, '.git')),
  existsSync(join(FIXTURE, '.git')) ? 'presente' : '.git assente (git -C <fixture> init mancante)');
const innerStatus = gitRead(FIXTURE, ['status', '--porcelain']);
assert('git -C <fixture> status --porcelain VUOTO (commit pulito)',
  innerStatus.status === 0 && innerStatus.stdout === '',
  innerStatus.stdout === '' ? 'pulito' : `sporco: ${innerStatus.stdout.split('\n').length} entry`);
const innerHead = gitRead(FIXTURE, ['rev-parse', 'HEAD']);
assert('la fixture ha almeno un commit (HEAD risolve)', innerHead.status === 0 && innerHead.stdout.length > 0,
  innerHead.stdout ? innerHead.stdout.slice(0, 10) : 'nessun commit');
const headAfter = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
assert('HEAD del repo ESTERNO INVARIATO', headBefore === headAfter,
  headBefore === headAfter ? `${headBefore.slice(0, 10)} (invariato)` : 'MUTATO (vietato!)');

// --- 6) la fixture e gitignorata dal repo esterno -----------------------------
console.log('');
console.log('6) la fixture e gitignorata dal repo ESTERNO (non tracciata):');
const ci = gitRead(ROOT, ['check-ignore', 'eval/ecosystems/supabase-py/reference-app']);
assert('git check-ignore copre la fixture (gitignored)', ci.status === 0 && ci.stdout.length > 0,
  ci.stdout || 'NON ignorata (rischio di tracciamento dal repo esterno!)');
// Nessun file della fixture e tracciato dal repo esterno.
const tracked = gitRead(ROOT, ['ls-files', 'eval/ecosystems/supabase-py/reference-app']);
assert('nessun file della fixture e tracciato dal repo esterno', tracked.stdout === '',
  tracked.stdout === '' ? 'nessun file tracciato' : `${tracked.stdout.split('\n').length} file tracciati (vietato!)`);

// --- Esito --------------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE T1.2 RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
