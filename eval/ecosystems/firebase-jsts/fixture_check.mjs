#!/usr/bin/env node
// fixture_check.mjs — GATE di T1.2 (SP-5): self-check FALSIFICABILE della fixture
// vulnerabile `firebase-jsts` (Firebase-admin + Firestore security rules). Il
// "verde" e' un FATTO di oracoli REALI (gitleaks/osv/firestore-rules) + ispezione
// testuale dei marker bonus, MAI un parere dell'LLM (L-COL-002). Gemello
// strutturale di eval/ecosystems/postgres-py/fixture_check.mjs.
//
// Cosa asserisce (tutti FATTI deterministici):
//   1) run_gitleaks <fixture> working-tree  -> >=1 secret nel file serviceAccount.json
//      (FB-S1). [GIT-DIPENDENTE: gitleaks scansiona il working-tree del repo
//      INTERNO; finche' l'orchestrator non fa `git init` sulla fixture questo
//      gruppo FALLISCE — atteso.]
//   2) run_osv <fixture>/package-lock.json   -> >=1 vuln su `lodash` (FB-S2).
//   3) firestore_rules_check <fixture>/firestore.rules -> ESATTAMENTE 1 finding
//      FIRESTORE001_PUBLIC_ALLOW sulla collection SEED public_notes E 0 finding
//      sulla collection di contrasto owner-scoped private_docs (FB-S3 + precisione).
//   4) marker SEED:FB-S4 in src/routes/search.ts (injection bonus) + contrasto
//      sicuro (execFile, niente shell), E marker SEED:FB-S5 in src/dead.ts
//      (dead-code bonus) con unusedHelper definito E usedHelper definito,
//      importato e chiamato da src/index.ts.
//   5) la fixture e' un repo git INTERNO pulito (git -C <fixture> status --porcelain
//      vuoto) e l'HEAD del repo ESTERNO e' INVARIATO rispetto allo snapshot iniziale.
//      [GIT-DIPENDENTE: la fixture NON e' ancora un repo git — l'orchestrator la
//      inizializza piu' tardi. Questo gruppo FALLISCE finche' non lo fa — atteso.]
//   6) la fixture e' gitignorata dal repo esterno (git check-ignore la copre): il
//      repo esterno NON la traccia. [GIT-DIPENDENTE come sopra — atteso fallire
//      finche' l'orchestrator non gitignora/commit-a il pack.]
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
// eval/ecosystems/firebase-jsts -> root e' 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = resolve(__dirname, 'reference-app');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const RUN_OSV = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_osv.mjs');
const FIRESTORE_RULES_CHECK = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'firestore_rules_check.mjs');
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
console.log(' GATE T1.2 — fixture vulnerabile firebase-jsts (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('============================================================');
console.log('');

// Snapshot iniziale dell'HEAD del repo ESTERNO (sola lettura).
const headBefore = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;

// Precondizione: la fixture esiste.
assert('la fixture reference-app esiste', existsSync(FIXTURE), FIXTURE);

// --- 1) FB-S1: gitleaks working-tree trova un secret in serviceAccount.json ----
console.log('');
console.log('1) FB-S1 — gitleaks (working-tree) trova >=1 secret in serviceAccount.json:');
const gl = nodeRun(RUN_GITLEAKS, [FIXTURE, 'working-tree']);
let glFindings = [];
try { glFindings = JSON.parse(gl.stdout); } catch { /* gestito sotto */ }
assert('run_gitleaks esce 0 ed emette un array JSON', gl.status === 0 && Array.isArray(glFindings),
  `exit=${gl.status} findings=${Array.isArray(glFindings) ? glFindings.length : 'N/A'}`);
const fileOfGl = (f) => String((f && (f.File || f.file)) || '').replace(/\\/g, '/');
const s1 = Array.isArray(glFindings)
  ? glFindings.filter((f) => /(^|\/)serviceAccount\.json$/.test(fileOfGl(f)))
  : [];
assert('FB-S1: >=1 secret rilevato nel file serviceAccount.json (gitleaks)', s1.length >= 1,
  s1.length ? `rule=${s1[0].RuleID || s1[0].ruleID || '?'}` : 'nessun finding su serviceAccount.json');

// --- 2) FB-S2: osv trova una vuln su lodash -----------------------------------
console.log('');
console.log('2) FB-S2 — osv trova >=1 vulnerabilita su lodash (package-lock.json):');
const lockfile = join(FIXTURE, 'package-lock.json');
const osv = nodeRun(RUN_OSV, [lockfile]);
let osvNative = null;
try { osvNative = JSON.parse(osv.stdout); } catch { /* gestito sotto */ }
assert('run_osv esce 0 ed emette JSON', osv.status === 0 && osvNative,
  `exit=${osv.status} json=${Boolean(osvNative)}`);
// Scava i pacchetti vulnerabili dal JSON nativo osv (results[].packages[]).
let lodashVulns = [];
if (osvNative && Array.isArray(osvNative.results)) {
  for (const r of osvNative.results) {
    for (const p of (r.packages || [])) {
      const name = p.package && p.package.name;
      if (String(name).toLowerCase() === 'lodash') {
        for (const v of (p.vulnerabilities || [])) lodashVulns.push(v.id);
      }
    }
  }
}
assert('FB-S2: >=1 vulnerabilita osv su lodash', lodashVulns.length >= 1,
  lodashVulns.length ? lodashVulns.join(',') : 'nessuna vuln su lodash');

// --- 3) FB-S3: firestore-rules -> 1 FIRESTORE001 su public_notes, 0 su private_docs ---
console.log('');
console.log('3) FB-S3 — firestore-rules: 1 FIRESTORE001_PUBLIC_ALLOW su public_notes, 0 su private_docs:');
const rulesFile = join(FIXTURE, 'firestore.rules');
const fr = nodeRun(FIRESTORE_RULES_CHECK, [rulesFile]);
let frReport = null;
try { frReport = JSON.parse(fr.stdout); } catch { /* gestito sotto */ }
const frFindings = frReport && Array.isArray(frReport.findings) ? frReport.findings : null;
assert('firestore_rules_check esce 0 ed emette un report con findings[]',
  fr.status === 0 && Array.isArray(frFindings),
  `exit=${fr.status} findings=${Array.isArray(frFindings) ? frFindings.length : 'N/A'}`);
// La collection SEED e' public_notes; il contrasto owner-scoped e' private_docs.
const mp = (f) => String((f && f.match_path) || '');
const onPublic = (frFindings || []).filter((f) => /\/public_notes\//.test(mp(f)));
const onPrivate = (frFindings || []).filter((f) => /\/private_docs\//.test(mp(f)));
const pub001 = onPublic.filter((f) => f.control_id === 'FIRESTORE001_PUBLIC_ALLOW');
assert('FB-S3: ESATTAMENTE 1 finding FIRESTORE001_PUBLIC_ALLOW su public_notes',
  pub001.length === 1 && onPublic.length === 1,
  `public_notes: ${onPublic.length} finding (FIRESTORE001=${pub001.length}, allow=${pub001[0]?.allow || '?'})`);
assert('FB-S3 contrasto: 0 finding su private_docs (owner-scoped isola davvero)',
  onPrivate.length === 0,
  `private_docs: ${onPrivate.length} finding`);
assert('firestore-rules: 1 SOLO finding sull intero file (precisione)',
  (frFindings || []).length === 1,
  `totale finding = ${(frFindings || []).length}`);

// --- 4) marker bonus SEED:FB-S4 (injection) + SEED:FB-S5 (dead-code) ----------
console.log('');
console.log('4) marker bonus: SEED:FB-S4 (injection) + SEED:FB-S5 (dead-code):');
const search = readSafe(join(FIXTURE, 'src', 'routes', 'search.ts'));
assert('src/routes/search.ts esiste e non e vuoto', search.length > 0,
  search.length ? `${search.length} byte` : 'assente/vuoto');
assert('FB-S4: marker SEED:FB-S4 presente in search.ts (injection bonus)', /SEED:FB-S4/.test(search),
  /SEED:FB-S4/.test(search) ? 'presente' : 'assente');
// Contrasto sicuro presente: execFile (array di argomenti, niente shell-string).
const SAFE_CONTRAST = /execFile\(\s*["']grep["']\s*,\s*\[/;
assert('FB-S4 contrasto: una chiamata sicura execFile([...]) presente in search.ts',
  SAFE_CONTRAST.test(search),
  SAFE_CONTRAST.test(search) ? 'execFile([...]) presente' : 'nessun contrasto execFile');
const dead = readSafe(join(FIXTURE, 'src', 'dead.ts'));
assert('src/dead.ts esiste e non e vuoto', dead.length > 0,
  dead.length ? `${dead.length} byte` : 'assente/vuoto');
assert('FB-S5: marker SEED:FB-S5 presente in dead.ts (dead-code bonus)', /SEED:FB-S5/.test(dead),
  /SEED:FB-S5/.test(dead) ? 'presente' : 'assente');
assert('FB-S5: unusedHelper definito in dead.ts', /function\s+unusedHelper\s*\(/.test(dead),
  /function\s+unusedHelper\s*\(/.test(dead) ? 'presente' : 'assente');
// Contrasto: usedHelper definito in dead.ts E importato/chiamato in index.ts.
const indexTs = readSafe(join(FIXTURE, 'src', 'index.ts'));
const usedDefined = /function\s+usedHelper\s*\(/.test(dead);
const usedImported = /import\s*\{[^}]*\busedHelper\b[^}]*\}\s*from\s*["'][^"']*dead(\.js)?["']/.test(indexTs);
const usedCalled = /usedHelper\s*\(/.test(indexTs);
assert('FB-S5 contrasto: usedHelper definito in dead.ts E importato/chiamato in index.ts',
  usedDefined && usedImported && usedCalled,
  `definito=${usedDefined} importato=${usedImported} chiamato=${usedCalled}`);

// --- 5) git INTERNO pulito + HEAD esterno invariato ---------------------------
console.log('');
console.log('5) git INTERNO della fixture pulito + HEAD del repo ESTERNO invariato:');
assert('la fixture e un repo git INTERNO (.git presente)', existsSync(join(FIXTURE, '.git')),
  existsSync(join(FIXTURE, '.git')) ? 'presente' : '.git assente (git -C <fixture> init mancante)');
const innerStatus = gitRead(FIXTURE, ['status', '--porcelain']);
assert('git -C <fixture> status --porcelain VUOTO (commit pulito)',
  innerStatus.status === 0 && innerStatus.stdout === '',
  innerStatus.status !== 0 ? 'fixture non e un repo git' : (innerStatus.stdout === '' ? 'pulito' : `sporco: ${innerStatus.stdout.split('\n').length} entry`));
const innerHead = gitRead(FIXTURE, ['rev-parse', 'HEAD']);
assert('la fixture ha almeno un commit (HEAD risolve)', innerHead.status === 0 && innerHead.stdout.length > 0,
  innerHead.stdout ? innerHead.stdout.slice(0, 10) : 'nessun commit');
const headAfter = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
assert('HEAD del repo ESTERNO INVARIATO', headBefore === headAfter,
  headBefore === headAfter ? `${headBefore.slice(0, 10)} (invariato)` : 'MUTATO (vietato!)');

// --- 6) la fixture e gitignorata dal repo esterno -----------------------------
console.log('');
console.log('6) la fixture e gitignorata dal repo ESTERNO (non tracciata):');
const ci = gitRead(ROOT, ['check-ignore', 'eval/ecosystems/firebase-jsts/reference-app']);
assert('git check-ignore copre la fixture (gitignored)', ci.status === 0 && ci.stdout.length > 0,
  ci.stdout || 'NON ignorata (rischio di tracciamento dal repo esterno!)');
// Nessun file della fixture e tracciato dal repo esterno.
const tracked = gitRead(ROOT, ['ls-files', 'eval/ecosystems/firebase-jsts/reference-app']);
assert('nessun file della fixture e tracciato dal repo esterno', tracked.stdout === '',
  tracked.stdout === '' ? 'nessun file tracciato' : `${tracked.stdout.split('\n').length} file tracciati (vietato!)`);

// --- Esito --------------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE T1.2 RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
