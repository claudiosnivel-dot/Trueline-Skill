#!/usr/bin/env node
// fixture_check.mjs — GATE di T1.1 (SP-7: promuove postgres-jsts da detection a
// VERIFY-capable, parita JS con supabase-jsts). Self-check FALSIFICABILE della
// fixture vulnerabile `postgres-jsts` (Node/Express + pg su Postgres
// NON-Supabase, authz-surface = route-authz/semgrep, NIENTE RLS-al-DB). Il
// "verde" e' un FATTO di oracoli REALI (gitleaks/osv/knip) + ispezione testuale
// dei marker, MAI un parere dell'LLM (L-COL-002). Scritto TEST-FIRST.
//
// FALSIFICABILITA' SOSTANZIALE: i difetti del floor verified (PG-S1 secret-WT,
// PG-S5 dead-code) e PG-S6 (secret-in-history) sono colti dagli oracoli legati su
// una COPIA ISOLATA della fixture (eval/.tmp-fixture-jsts/<id>, .git INCLUSO):
// se un seed del floor non fosse colto, o il contrasto pulito producesse finding,
// o PG-S6 comparisse nel working-tree, il gate FALLISCE.
//
// Cosa asserisce (tutti FATTI deterministici), su COPIA ISOLATA dove indicato:
//   1) [ISOLATA] run_gitleaks <copia> working-tree  -> >=1 secret in src/config.ts (PG-S1)
//      E 0 secret in src/legacy/credentials.ts (PG-S6 assente dal WT).
//   2) [ISOLATA] run_osv <copia>/package-lock.json  -> >=1 vuln su minimist@1.2.0 (PG-S2).
//   3) [ISOLATA] run_deadcode (knip) <copia>        -> ESATTAMENTE 1 dead-code:
//      l'export unusedDeadHelper in src/dead.ts (PG-S5) E 0 su usedHelper (contrasto).
//   4) marker SEED:PG-S3 (route-authz) + rotta di CONTRASTO con auth check;
//      marker SEED:PG-S4 (injection bonus) presenti.
//   5) [ISOLATA] run_gitleaks <copia> history -> >=1 secret in src/legacy/credentials.ts
//      (PG-S6) MA working-tree pulito sullo stesso file (mitigated-residual).
//   6) il repo INTERNO della fixture e' pulito (status --porcelain vuoto) + HEAD
//      esterno INVARIATO + la copia e' ISOLATA (toplevel != fixture orig != repo esterno).
//   7) la fixture e' gitignorata dal repo esterno (check-ignore + ls-files vuoto).
//   8) REGISTRY: verified_set === [secret, dead-code]; ogni difetto ha
//      expected_fix_state nel set ammesso; la mappa id->stato combacia col contratto
//      (PG-S1/PG-S5 verified; PG-S2/PG-S3/PG-S4 detection-only; PG-S6 mitigated-residual);
//      coerenza categoria<->verified_set (history=mitigated-residual, in-set=verified,
//      fuori-set!=verified); PG-S2 ancora dependency-vuln = package@version.
//   9) GUARD suite JS (node:test): tests/characterization.test.mjs verde (rete di
//      sicurezza per la fix di T2.1), e il file GUARD esiste.
//
// L'osv/gitleaks richiedono C:/Users/claud/go/bin sul PATH; lo arricchiamo per gli
// spawn (mirror dei wrapper). NON tocca MAI il git del repo ESTERNO se non in SOLA
// LETTURA (rev-parse/status/check-ignore/ls-files). La COPIA porta il proprio .git
// INTERNO (isolato, L-COL-024); ogni operazione su disco avviene li'.
//
// Node ESM, solo built-in. Esce 0 sse TUTTI i check passano; 1 altrimenti.

import { spawnSync } from 'node:child_process';
import {
  existsSync, readFileSync, cpSync, rmSync, mkdirSync, readdirSync,
} from 'node:fs';
import { resolve, dirname, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// eval/ecosystems/postgres-jsts -> root e' 3 livelli sopra.
const ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE = resolve(__dirname, 'reference-app');
const REGISTRY = resolve(__dirname, 'registry.json');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const RUN_OSV = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_osv.mjs');
const RUN_DEADCODE = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_deadcode.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
const TMP_ROOT = resolve(ROOT, 'eval', '.tmp-fixture-jsts');

const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}
function readSafe(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }
const posix = (p) => String(p).replace(/\\/g, '/');
const fileOfGl = (f) => posix((f && (f.File || f.file)) || '');

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

// Crea una COPIA ISOLATA della fixture (eval/.tmp-fixture-jsts/<id>, .git INCLUSO,
// node_modules incluso cosi' knip gira sulla copia). Mirror di copyPackFixture
// (ecosystem_conformance): id unico per-run (pid + counter), niente Date.now.
let __c = 0;
function copyFixture() {
  try { mkdirSync(TMP_ROOT, { recursive: true }); } catch { /* esiste */ }
  __c += 1;
  const dir = join(TMP_ROOT, `fixture-jsts-pid${process.pid}-${__c}`);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  cpSync(FIXTURE, dir, { recursive: true, dereference: false });
  const cleanup = () => {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* best-effort */ }
    try {
      if (existsSync(TMP_ROOT) && readdirSync(TMP_ROOT).length === 0) {
        rmSync(TMP_ROOT, { recursive: true, force: true });
      }
    } catch { /* best-effort */ }
  };
  return { dir, cleanup };
}

console.log('============================================================');
console.log(' GATE T1.1 (SP-7) — fixture VERIFY-capable postgres-jsts (FATTI di oracoli reali)');
console.log(`   fixture : ${FIXTURE}`);
console.log('   verified_set atteso: [secret, dead-code] (no RLS: route-authz non-Supabase)');
console.log('============================================================');
console.log('');

// Snapshot d'integrita' iniziale (sola lettura) — repo ESTERNO + fixture INTERNA.
const outerHeadBefore = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
const innerHeadBefore = gitRead(FIXTURE, ['rev-parse', 'HEAD']).stdout;
const innerStatusBefore = gitRead(FIXTURE, ['status', '--porcelain']).stdout;

// Precondizione: la fixture esiste.
assert('la fixture reference-app esiste', existsSync(FIXTURE), FIXTURE);

// --- COPIA ISOLATA (falsificabilita' su copia, non sull'originale) ------------
let ws = null;
let dir = null;
try { ws = copyFixture(); dir = ws.dir; } catch (e) {
  assert('copia ISOLATA della fixture creata', false, e.message);
}
assert('copia ISOLATA della fixture creata (eval/.tmp-fixture-jsts, .git+node_modules inclusi)',
  Boolean(dir) && existsSync(dir), dir || 'assente');
// ISOLAMENTO: la copia NON deve risolvere al repo esterno ne' alla fixture orig.
if (dir) {
  const top = gitRead(dir, ['rev-parse', '--show-toplevel']).stdout;
  const isIsolated = posix(resolve(top || dir)).toLowerCase() !== posix(resolve(ROOT)).toLowerCase()
    && posix(resolve(top || dir)).toLowerCase() !== posix(resolve(FIXTURE)).toLowerCase();
  assert('la copia e ISOLATA (toplevel != repo esterno e != fixture originale)', isIsolated,
    `toplevel=${posix(top)}`);
}

// Oracoli sulla COPIA (read-only ma su disco isolato: knip puo' scrivere cache).
const SCAN_DIR = dir || FIXTURE;

// --- 1) PG-S1: gitleaks working-tree trova un secret in src/config.ts ---------
console.log('');
console.log('1) [ISOLATA] PG-S1 — gitleaks (working-tree) trova >=1 secret in src/config.ts:');
const gl = nodeRun(RUN_GITLEAKS, [SCAN_DIR, 'working-tree'], SCAN_DIR);
let glFindings = [];
try { glFindings = JSON.parse(gl.stdout); } catch { /* gestito sotto */ }
assert('run_gitleaks (working-tree) esce 0 ed emette un array JSON', gl.status === 0 && Array.isArray(glFindings),
  `exit=${gl.status} findings=${Array.isArray(glFindings) ? glFindings.length : 'N/A'}`);
const s1 = Array.isArray(glFindings)
  ? glFindings.filter((f) => /(^|\/)src\/config\.ts$/.test(fileOfGl(f)))
  : [];
assert('PG-S1: >=1 secret rilevato nel file src/config.ts (gitleaks working-tree)', s1.length >= 1,
  s1.length ? `rule=${s1[0].RuleID || s1[0].ruleID || '?'}` : 'nessun finding su src/config.ts');

// --- 2) PG-S2: osv trova una vuln su minimist@1.2.0 ---------------------------
console.log('');
console.log('2) [ISOLATA] PG-S2 — osv trova >=1 vulnerabilita su minimist (package-lock.json):');
const lockfile = join(SCAN_DIR, 'package-lock.json');
const osv = nodeRun(RUN_OSV, [lockfile], SCAN_DIR);
let osvNative = null;
try { osvNative = JSON.parse(osv.stdout); } catch { /* gestito sotto */ }
assert('run_osv esce 0 ed emette JSON', osv.status === 0 && osvNative,
  `exit=${osv.status} json=${Boolean(osvNative)}`);
let minimistVulns = [];
let minimistVersions = new Set();
if (osvNative && Array.isArray(osvNative.results)) {
  for (const r of osvNative.results) {
    for (const p of (r.packages || [])) {
      const name = p.package && p.package.name;
      if (String(name).toLowerCase() === 'minimist') {
        minimistVersions.add(p.package.version);
        for (const v of (p.vulnerabilities || [])) minimistVulns.push(v.id);
      }
    }
  }
}
assert('PG-S2: >=1 vulnerabilita osv su minimist', minimistVulns.length >= 1,
  minimistVulns.length ? minimistVulns.join(',') : 'nessuna vuln su minimist');
assert('PG-S2: la versione vulnerabile flaggata e 1.2.0 (pin del seed intatto)',
  minimistVersions.has('1.2.0'),
  minimistVersions.size ? `versioni=${[...minimistVersions].join(',')}` : 'nessuna versione minimist');

// --- 3) PG-S5: knip -> ESATTAMENTE 1 dead-code (unusedDeadHelper) --------------
console.log('');
console.log('3) [ISOLATA] PG-S5 — knip: ESATTAMENTE 1 dead-code (unusedDeadHelper in src/dead.ts), 0 su usedHelper:');
const dc = nodeRun(RUN_DEADCODE, [SCAN_DIR], SCAN_DIR);
let dcNative = null;
try { dcNative = JSON.parse(dc.stdout); } catch { /* gestito sotto */ }
assert('run_deadcode (knip) esce 0 ed emette JSON con issues[]',
  dc.status === 0 && dcNative && Array.isArray(dcNative.issues),
  `exit=${dc.status} issues=${dcNative && Array.isArray(dcNative.issues) ? dcNative.issues.length : 'N/A'}`);
// Estrai i simboli dead-code (export/type/enum/namespace) + i file interi morti.
const deadSymbols = [];
const deadFiles = [];
for (const issue of (dcNative && dcNative.issues) || []) {
  const f = posix(issue.file || '');
  for (const ff of issue.files || []) deadFiles.push(posix((typeof ff === 'string' ? ff : ff.name) || f));
  for (const bucket of ['exports', 'types', 'enumMembers', 'namespaceMembers']) {
    for (const sym of issue[bucket] || []) {
      deadSymbols.push({ file: f, name: typeof sym === 'string' ? sym : sym.name });
    }
  }
}
const s5 = deadSymbols.filter((s) => s.name === 'unusedDeadHelper' && /(^|\/)src\/dead\.ts$/.test(s.file));
assert('PG-S5: knip segnala unusedDeadHelper in src/dead.ts (dead-code)', s5.length >= 1,
  s5.length ? `file=${s5[0].file}` : `simboli=${deadSymbols.map((s) => s.name).join(',') || 'nessuno'}`);
assert('PG-S5 contrasto: knip NON segnala usedHelper (referenziato da src/index.ts)',
  !deadSymbols.some((s) => s.name === 'usedHelper'),
  deadSymbols.some((s) => s.name === 'usedHelper') ? 'usedHelper FLAGGATO (falso positivo!)' : 'usedHelper non flaggato (corretto)');
assert('knip: ESATTAMENTE 1 simbolo dead-code sull intera fixture (precisione, niente tipi spuri)',
  deadSymbols.length === 1 && deadFiles.length === 0,
  `simboli=${deadSymbols.length} (${deadSymbols.map((s) => s.name).join(',')}) file-morti=${deadFiles.length}`);

// --- 4) marker PG-S3 (route-authz) + contrasto + PG-S4 (injection) ------------
console.log('');
console.log('4) marker SEED:PG-S3 (route-authz) + rotta di contrasto + SEED:PG-S4 (injection bonus):');
const bookings = readSafe(join(FIXTURE, 'src', 'routes', 'bookings.ts'));
assert('src/routes/bookings.ts esiste e non e vuoto', bookings.length > 0,
  bookings.length ? `${bookings.length} byte` : 'assente/vuoto');
assert('PG-S3: marker SEED:PG-S3 presente in bookings.ts (route-authz)', /SEED:PG-S3/.test(bookings),
  /SEED:PG-S3/.test(bookings) ? 'presente' : 'assente');
const AUTH_CHECK = /req\.user|req\.session|getServerSession|requireAuth|ensureAuth|verifyToken|verifyJwt/;
const postHandlers = (bookings.match(/\b(router|bookingsRouter|[A-Za-z_$][\w$]*Router)\.post\s*\(/g) || []).length;
assert('>=2 rotte POST in bookings.ts (vulnerabile + contrasto)', postHandlers >= 2,
  `router.post(...) = ${postHandlers}`);
assert('PG-S3 contrasto: un auth check riconosciuto compare nel file (precisione)', AUTH_CHECK.test(bookings),
  AUTH_CHECK.test(bookings) ? 'auth check presente' : 'nessun auth check (contrasto mancante)');
const dbTs = readSafe(join(FIXTURE, 'src', 'db.ts'));
assert('PG-S4: marker SEED:PG-S4 presente in db.ts (injection bonus)', /SEED:PG-S4/.test(dbTs),
  /SEED:PG-S4/.test(dbTs) ? 'presente' : 'assente');
// Contrasto parametrizzato: una query con placeholder posizionale $1.
const PARAM_QUERY = /pool\.query[^;]*\$1/;
assert('PG-S4 contrasto: una query parametrizzata ($1) presente in db.ts', PARAM_QUERY.test(dbTs),
  PARAM_QUERY.test(dbTs) ? 'placeholder $1 presente' : 'nessun contrasto parametrizzato');

// --- 5) PG-S6: secret in HISTORY ma NON nel WORKING-TREE (mitigated-residual) --
console.log('');
console.log('5) [ISOLATA] PG-S6 — gitleaks: secret in HISTORY (src/legacy/credentials.ts) ma NON nel working-tree:');
const S6_FILE_RE = /(^|\/)src\/legacy\/credentials\.ts$/;
const glHist = nodeRun(RUN_GITLEAKS, [SCAN_DIR, 'history'], SCAN_DIR);
let glHistFindings = [];
try { glHistFindings = JSON.parse(glHist.stdout); } catch { /* gestito sotto */ }
assert('run_gitleaks <copia> history esce 0 ed emette un array JSON',
  glHist.status === 0 && Array.isArray(glHistFindings),
  `exit=${glHist.status} findings=${Array.isArray(glHistFindings) ? glHistFindings.length : 'N/A'}`);
const s6Hist = Array.isArray(glHistFindings)
  ? glHistFindings.filter((f) => S6_FILE_RE.test(fileOfGl(f)))
  : [];
assert('PG-S6: gitleaks HISTORY trova >=1 secret in src/legacy/credentials.ts',
  s6Hist.length >= 1,
  s6Hist.length ? `rule=${s6Hist[0].RuleID || s6Hist[0].ruleID || '?'}` : 'nessun finding su legacy/credentials.ts in history');
// WORKING-TREE: NON deve trovare PG-S6 (file rimosso dal disco). Riusa lo scan WT.
const s6Wt = Array.isArray(glFindings)
  ? glFindings.filter((f) => S6_FILE_RE.test(fileOfGl(f)))
  : [];
assert('PG-S6 contrasto: gitleaks WORKING-TREE NON trova il secret in legacy/credentials.ts (solo in history)',
  s6Wt.length === 0,
  s6Wt.length ? `${s6Wt.length} finding nel working-tree (il file NON e stato rimosso!)` : 'assente nel working-tree (corretto)');
assert('src/legacy/credentials.ts ASSENTE dal working tree della copia (vive solo in history)',
  !existsSync(join(SCAN_DIR, 'src', 'legacy', 'credentials.ts')),
  existsSync(join(SCAN_DIR, 'src', 'legacy', 'credentials.ts')) ? 'PRESENTE (working-tree non pulito!)' : 'assente');

// --- 6) git INTERNO pulito + HEAD esterno invariato + copia isolata ------------
console.log('');
console.log('6) git INTERNO della fixture pulito + HEAD del repo ESTERNO invariato:');
assert('la fixture e un repo git INTERNO (.git presente)', existsSync(join(FIXTURE, '.git')),
  existsSync(join(FIXTURE, '.git')) ? 'presente' : '.git assente');
const innerStatus = gitRead(FIXTURE, ['status', '--porcelain']);
assert('git -C <fixture> status --porcelain VUOTO (commit pulito, node_modules ignorato)',
  innerStatus.status === 0 && innerStatus.stdout === '',
  innerStatus.stdout === '' ? 'pulito' : `sporco: ${innerStatus.stdout.split('\n').length} entry`);
const innerHead = gitRead(FIXTURE, ['rev-parse', 'HEAD']);
assert('la fixture ha almeno un commit (HEAD risolve)', innerHead.status === 0 && innerHead.stdout.length > 0,
  innerHead.stdout ? innerHead.stdout.slice(0, 10) : 'nessun commit');
// La history INTERNA contiene il commit che RIMUOVE il file PG-S6 (secret-in-history).
const s6Log = gitRead(FIXTURE, ['log', '--oneline', '--', 'src/legacy/credentials.ts']);
assert('la history INTERNA traccia src/legacy/credentials.ts (add->remove, PG-S6)',
  s6Log.status === 0 && s6Log.stdout.split('\n').filter(Boolean).length >= 2,
  s6Log.stdout ? `${s6Log.stdout.split('\n').filter(Boolean).length} commit toccano il file` : 'nessun commit');

// --- 7) la fixture e gitignorata dal repo esterno -----------------------------
console.log('');
console.log('7) la fixture e gitignorata dal repo ESTERNO (non tracciata):');
const ci = gitRead(ROOT, ['check-ignore', 'eval/ecosystems/postgres-jsts/reference-app']);
assert('git check-ignore copre la fixture (gitignored)', ci.status === 0 && ci.stdout.length > 0,
  ci.stdout || 'NON ignorata (rischio di tracciamento dal repo esterno!)');
const tracked = gitRead(ROOT, ['ls-files', 'eval/ecosystems/postgres-jsts/reference-app']);
assert('nessun file della fixture e tracciato dal repo esterno', tracked.stdout === '',
  tracked.stdout === '' ? 'nessun file tracciato' : `${tracked.stdout.split('\n').length} file tracciati (vietato!)`);

// --- 8) REGISTRY: expected_fix_state coerente col tier VERIFIED ----------------
console.log('');
console.log('8) REGISTRY — expected_fix_state coerente col tier VERIFIED (verified_set=[secret,dead-code]):');
const ALLOWED_STATES = new Set(['verified', 'detection-only', 'mitigated-residual']);
const EXPECTED = {
  'PG-S1': 'verified',           // secret working-tree
  'PG-S2': 'detection-only',     // dependency-vuln (fuori dal verified_set)
  'PG-S3': 'detection-only',     // route-authz (fuori dal verified_set)
  'PG-S4': 'detection-only',     // injection bonus (fuori dal verified_set)
  'PG-S5': 'verified',           // dead-code
  'PG-S6': 'mitigated-residual', // secret-in-history (mai verified, L-COL-006/024)
};
let registry = null;
try { registry = JSON.parse(readSafe(REGISTRY)); } catch { /* gestito sotto */ }
assert('registry.json esiste ed e un JSON valido', registry && Array.isArray(registry.defects),
  registry && Array.isArray(registry.defects) ? `${registry.defects.length} difetti` : 'assente/non-parsabile');
const defects = (registry && Array.isArray(registry.defects)) ? registry.defects : [];
const vset = Array.isArray(registry && registry.verified_set) ? [...registry.verified_set].sort() : null;
const VSET_EXPECTED = ['dead-code', 'secret'];
assert('verified_set del registry === [secret, dead-code]',
  vset !== null && JSON.stringify(vset) === JSON.stringify(VSET_EXPECTED),
  vset ? `verified_set=[${vset.join(', ')}]` : 'verified_set assente');
const badState = defects.filter((d) => !ALLOWED_STATES.has(d.expected_fix_state));
assert('ogni difetto del registry ha expected_fix_state nel set {verified, detection-only, mitigated-residual}',
  defects.length > 0 && badState.length === 0,
  badState.length ? `stati invalidi: ${badState.map((d) => `${d.id}=${d.expected_fix_state}`).join(', ')}` : 'tutti validi');
const byId = Object.fromEntries(defects.map((d) => [d.id, d.expected_fix_state]));
const mismatches = Object.entries(EXPECTED).filter(([id, st]) => byId[id] !== st);
assert('mappa id->expected_fix_state === contratto verified (PG-S1/PG-S5 verified; PG-S2/S3/S4 detection-only; PG-S6 mitigated-residual)',
  Object.keys(EXPECTED).every((id) => id in byId) && mismatches.length === 0,
  mismatches.length ? `divergenze: ${mismatches.map(([id, st]) => `${id} atteso=${st} trovato=${byId[id] || 'ASSENTE'}`).join('; ')}`
    : 'tutti combaciano');
const vsetCats = new Set(registry && Array.isArray(registry.verified_set) ? registry.verified_set : []);
const inconsistencies = defects.filter((d) => {
  const inVset = vsetCats.has(d.category);
  if (d.scan_scope === 'history') return d.expected_fix_state !== 'mitigated-residual';
  if (inVset) return d.expected_fix_state !== 'verified';
  return d.expected_fix_state === 'verified'; // fuori dal verified_set non puo' essere verified
});
assert('coerenza categoria<->verified_set: in-set=verified, history=mitigated-residual, fuori-set!=verified',
  inconsistencies.length === 0,
  inconsistencies.length ? `incoerenti: ${inconsistencies.map((d) => `${d.id}(${d.category}/${d.scan_scope}=${d.expected_fix_state})`).join(', ')}` : 'coerenti');
const s2 = defects.find((d) => d.id === 'PG-S2');
const s2sym = s2 && s2.anchor && s2.anchor.symbol;
assert('PG-S2 ancora dependency-vuln = package@version (es. minimist@1.2.0, seed-match osv)',
  typeof s2sym === 'string' && /^[a-z0-9._-]+@[0-9][\w.+-]*$/i.test(s2sym),
  s2sym || 'symbol assente');
// PG-S5 ancora dead-code = simbolo (per il selettore del loop).
const s5def = defects.find((d) => d.id === 'PG-S5');
const s5sym = s5def && s5def.anchor && s5def.anchor.symbol;
assert('PG-S5 ancora dead-code = simbolo (unusedDeadHelper) per il selettore del loop',
  s5sym === 'unusedDeadHelper', s5sym || 'symbol assente');

// --- 9) GUARD suite JS (node:test) verde --------------------------------------
console.log('');
console.log('9) GUARD — suite di caratterizzazione JS (node:test) verde:');
const GUARD_FILE = join(FIXTURE, 'tests', 'characterization.test.mjs');
assert('la suite contiene il GUARD di caratterizzazione (tests/characterization.test.mjs)',
  existsSync(GUARD_FILE),
  existsSync(GUARD_FILE) ? 'presente' : 'assente');
// Gira node --test sulla COPIA (isolata) cosi' nessun artefatto tocca l'originale.
const guard = spawnSync(process.execPath, ['--test'], {
  cwd: SCAN_DIR, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
});
const guardOut = `${guard.stdout || ''}${guard.stderr || ''}`;
// node:test (default/spec reporter) emette righe-riepilogo "<glifo> pass N" /
// "<glifo> fail N" (il glifo e' il simbolo info U+2139, non '#'): matchiamo il
// conteggio ancorato alla parola, tollerando qualunque prefisso non-cifra.
const passLine = (guardOut.match(/(?:^|\s)pass\s+(\d+)/m) || [])[1];
const failLine = (guardOut.match(/(?:^|\s)fail\s+(\d+)/m) || [])[1];
assert('node --test (GUARD) sulla COPIA esce 0 (suite di caratterizzazione verde)',
  guard.status === 0,
  guard.error ? `node non eseguibile: ${guard.error.message}` : `exit=${guard.status} pass=${passLine || '?'} fail=${failLine || '?'}`);
assert('la GUARD esegue >=1 test e 0 falliti (rete di sicurezza reale, non vacua)',
  Number(passLine || 0) >= 1 && Number(failLine || 0) === 0,
  `pass=${passLine || '0'} fail=${failLine || '0'}`);

// --- IGIENE: ripulisci la copia + verifica l'originale invariato ---------------
console.log('');
console.log('IGIENE — copia temp ripulita + fixture originale bit-identica + HEAD esterno invariato:');
let cleanupOk = true;
try { if (ws && ws.cleanup) ws.cleanup(); } catch { cleanupOk = false; }
assert('copia temp ripulita senza errori', cleanupOk, cleanupOk ? 'cleanup OK' : 'cleanup fallito');
assert('nessun residuo della copia temp (dir rimossa)', !dir || !existsSync(dir),
  dir && existsSync(dir) ? 'residuo presente' : 'rimossa');
const innerStatusAfter = gitRead(FIXTURE, ['status', '--porcelain']).stdout;
const innerHeadAfter = gitRead(FIXTURE, ['rev-parse', 'HEAD']).stdout;
assert('fixture ORIGINALE bit-identica (status interno vuoto + HEAD interno invariato)',
  innerStatusAfter === '' && innerStatusAfter === innerStatusBefore && innerHeadAfter === innerHeadBefore,
  innerStatusAfter === '' && innerHeadAfter === innerHeadBefore ? 'invariata' : `status="${innerStatusAfter}" head=${innerHeadAfter.slice(0, 10)}`);
const outerHeadAfter = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
assert('HEAD del repo ESTERNO INVARIATO (0 contaminazione)', outerHeadAfter === outerHeadBefore,
  outerHeadAfter === outerHeadBefore ? `${outerHeadBefore.slice(0, 10)} (invariato)` : 'MUTATO (vietato!)');

// --- Esito --------------------------------------------------------------------
const allOk = checks.every((c) => c.ok);
console.log('');
console.log('------------------------------------------------------------');
console.log(`=== GATE T1.1 (SP-7) RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check)`);
console.log('------------------------------------------------------------');
process.exit(allOk ? 0 : 1);
