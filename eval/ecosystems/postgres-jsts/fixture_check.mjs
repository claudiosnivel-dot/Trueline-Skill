#!/usr/bin/env node
// fixture_check.mjs — GATE di T1.2 (SP-1): self-check FALSIFICABILE della fixture
// vulnerabile `postgres-jsts` (Node/Express + pg). Il "verde" è un FATTO di
// oracoli REALI (gitleaks/osv) + ispezione testuale dei marker, MAI un parere
// dell'LLM (L-COL-002). Scritto TEST-FIRST: prima dell'esistenza della fixture
// questo script FALLISCE (exit 1).
//
// Cosa asserisce (tutti FATTI deterministici):
//   1) run_gitleaks <fixture> working-tree  -> ≥1 secret nel file src/config.ts (PG-S1).
//   2) run_osv <fixture>/package-lock.json  -> ≥1 vuln su `minimist` (PG-S2).
//   3) marker SEED:PG-S3 presente in src/routes/bookings.ts (rotta mutante senza
//      auth check) E una rotta POST di CONTRASTO con auth check (precisione del
//      ruleset, T2.2). Anche SEED:PG-S4 (injection bonus) atteso presente.
//   4) la fixture è un repo git INTERNO pulito (git -C <fixture> status --porcelain
//      vuoto) e l'HEAD del repo ESTERNO è INVARIATO rispetto allo snapshot iniziale.
//   5) la fixture è gitignorata dal repo esterno (git check-ignore la copre): il
//      repo esterno NON la traccia.
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
// eval/ecosystems/postgres-jsts -> root è 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = resolve(__dirname, 'reference-app');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const RUN_OSV = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_osv.mjs');
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
console.log(' GATE T1.2 — fixture vulnerabile postgres-jsts (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('============================================================');
console.log('');

// Snapshot iniziale dell'HEAD del repo ESTERNO (sola lettura).
const headBefore = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;

// Precondizione: la fixture esiste.
assert('la fixture reference-app esiste', existsSync(FIXTURE), FIXTURE);

// --- 1) PG-S1: gitleaks working-tree trova un secret in src/config.ts ---------
console.log('');
console.log('1) PG-S1 — gitleaks (working-tree) trova ≥1 secret in src/config.ts:');
const gl = nodeRun(RUN_GITLEAKS, [FIXTURE, 'working-tree']);
let glFindings = [];
try { glFindings = JSON.parse(gl.stdout); } catch { /* gestito sotto */ }
assert('run_gitleaks esce 0 ed emette un array JSON', gl.status === 0 && Array.isArray(glFindings),
  `exit=${gl.status} findings=${Array.isArray(glFindings) ? glFindings.length : 'N/A'}`);
const fileOfGl = (f) => String((f && (f.File || f.file)) || '').replace(/\\/g, '/');
const s1 = Array.isArray(glFindings)
  ? glFindings.filter((f) => /(^|\/)src\/config\.ts$/.test(fileOfGl(f)))
  : [];
assert('PG-S1: ≥1 secret rilevato nel file src/config.ts (gitleaks)', s1.length >= 1,
  s1.length ? `rule=${s1[0].RuleID || s1[0].ruleID || '?'}` : 'nessun finding su src/config.ts');

// --- 2) PG-S2: osv trova una vuln su minimist ---------------------------------
console.log('');
console.log('2) PG-S2 — osv trova ≥1 vulnerabilità su minimist (package-lock.json):');
const lockfile = join(FIXTURE, 'package-lock.json');
const osv = nodeRun(RUN_OSV, [lockfile]);
let osvNative = null;
try { osvNative = JSON.parse(osv.stdout); } catch { /* gestito sotto */ }
assert('run_osv esce 0 ed emette JSON', osv.status === 0 && osvNative,
  `exit=${osv.status} json=${Boolean(osvNative)}`);
// Scava i pacchetti vulnerabili dal JSON nativo osv (results[].packages[]).
let minimistVulns = [];
if (osvNative && Array.isArray(osvNative.results)) {
  for (const r of osvNative.results) {
    for (const p of (r.packages || [])) {
      const name = p.package && p.package.name;
      if (name === 'minimist') {
        for (const v of (p.vulnerabilities || [])) minimistVulns.push(v.id);
      }
    }
  }
}
assert('PG-S2: ≥1 vulnerabilità osv su minimist', minimistVulns.length >= 1,
  minimistVulns.length ? minimistVulns.join(',') : 'nessuna vuln su minimist');

// --- 3) PG-S3 marker + rotta di CONTRASTO + PG-S4 -----------------------------
console.log('');
console.log('3) PG-S3 (marker + rotta di contrasto) + PG-S4 (injection bonus):');
const bookings = readSafe(join(FIXTURE, 'src', 'routes', 'bookings.ts'));
assert('src/routes/bookings.ts esiste e non è vuoto', bookings.length > 0,
  bookings.length ? `${bookings.length} byte` : 'assente/vuoto');
assert('PG-S3: marker SEED:PG-S3 presente in bookings.ts', /SEED:PG-S3/.test(bookings),
  /SEED:PG-S3/.test(bookings) ? 'presente' : 'assente');
// Auth-check riconosciuti (T2.2, NON Supabase): req.user / req.session / getServerSession /
// requireAuth/ensureAuth / verifyToken/verifyJwt. La rotta di contrasto ne usa ≥1.
const AUTH_CHECK = /req\.user|req\.session|getServerSession|requireAuth|ensureAuth|verifyToken|verifyJwt/;
// Almeno DUE router.post: la vulnerabile (PG-S3) + quella di contrasto (con auth check).
const postHandlers = (bookings.match(/\b(router|bookingsRouter|[A-Za-z_$][\w$]*Router)\.post\s*\(/g) || []).length;
assert('≥2 rotte POST in bookings.ts (vulnerabile + contrasto)', postHandlers >= 2,
  `router.post(...) = ${postHandlers}`);
assert('rotta di CONTRASTO presente: un auth check riconosciuto compare nel file', AUTH_CHECK.test(bookings),
  AUTH_CHECK.test(bookings) ? 'auth check presente' : 'nessun auth check (contrasto mancante)');
// PG-S4 injection bonus (marker presente nella fixture).
const fixtureSrc = bookings + readSafe(join(FIXTURE, 'src', 'db.ts'));
assert('PG-S4: marker SEED:PG-S4 presente (injection bonus)', /SEED:PG-S4/.test(fixtureSrc),
  /SEED:PG-S4/.test(fixtureSrc) ? 'presente' : 'assente');

// --- 4) git INTERNO pulito + HEAD esterno invariato ---------------------------
console.log('');
console.log('4) git INTERNO della fixture pulito + HEAD del repo ESTERNO invariato:');
assert('la fixture è un repo git INTERNO (.git presente)', existsSync(join(FIXTURE, '.git')),
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

// --- 5) la fixture è gitignorata dal repo esterno -----------------------------
console.log('');
console.log('5) la fixture è gitignorata dal repo ESTERNO (non tracciata):');
const ci = gitRead(ROOT, ['check-ignore', 'eval/ecosystems/postgres-jsts/reference-app']);
assert('git check-ignore copre la fixture (gitignored)', ci.status === 0 && ci.stdout.length > 0,
  ci.stdout || 'NON ignorata (rischio di tracciamento dal repo esterno!)');
// Nessun file della fixture è tracciato dal repo esterno.
const tracked = gitRead(ROOT, ['ls-files', 'eval/ecosystems/postgres-jsts/reference-app']);
assert('nessun file della fixture è tracciato dal repo esterno', tracked.stdout === '',
  tracked.stdout === '' ? 'nessun file tracciato' : `${tracked.stdout.split('\n').length} file tracciati (vietato!)`);

// --- Esito --------------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE T1.2 RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
