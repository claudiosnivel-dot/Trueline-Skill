#!/usr/bin/env node
// scan_scope_check.mjs — ORACOLO SCAN-SCOPE: IL CONFINE DELLO SCOPE DI SCANSIONE
// (KEYSTONE, scritto PRIMA dell'implementazione — L-COL-019 / L-COL-027).
//
// Gate del PLAN docs/superpowers/plans/2026-07-28-scan-scope-tre-leve.md §4.
// NASCE ROSSO PER COSTRUZIONE: il modulo che deve soddisfarlo
// (trueline/scripts/oracles/scan_scope.mjs) NON ESISTE ANCORA. Un keystone che passa
// il giorno in cui viene scritto e' un keystone vacuo: il rosso di oggi e' l'ESITO
// ATTESO, non un fallimento.
//
// ---------------------------------------------------------------------------
// IL PROBLEMA CHE GATA (misurato, non ipotizzato — PLAN §1)
// ---------------------------------------------------------------------------
// 192 finding su 4 progetti reali, SEGRETI VERI: 0. Cinque classi di rumore:
//   A artefatti di build (.next/, dist/)            32
//   B codegen TRACCIATO dentro src/                 28   <- ne' .gitignore ne' "cartelle
//                                                          di build" lo prendono
//   C dump di dati (backups/*.sql, gitignorati)    121   <- cresce di ~5/giorno
//   D chiavi demo dello stack locale                 9
//   E prosa in un .md                                1
// Il confine e' *generato vs d'autore*, non e' inferibile dal path di primo livello, e
// quindi va DICHIARATO. Tre leve: manifest d'ecosistema (1), allowlist dei valori demo
// in gitleaks.toml (2), dichiarazione di progetto .trueline/scan-scope.json (3).
//
// ---------------------------------------------------------------------------
// IL CONTRATTO CHE QUESTO ORACOLO PRETENDE (e che l'implementazione deve realizzare)
// ---------------------------------------------------------------------------
// trueline/scripts/oracles/scan_scope.mjs — Node ESM, SOLO built-in, nessuna dipendenza:
//
//   export const DEFAULT_SCAN_EXCLUDE = [];       // BIT-invarianza (sotto-test 11)
//
//   resolveScanScope(projectDir, opts) -> {
//     patterns: [{ pattern, source }],            // source: 'caller'|'project'|'manifest'
//     sources:  { caller: n, project: n, manifest: n },
//   }
//   // UNIONE, non sovrascrittura: 1) opts.exclude  2) <projectDir>/.trueline/scan-scope.json
//   // 3) opts.manifest.oracles.secret.exclude  4) DEFAULT_SCAN_EXCLUDE.
//   // Una dichiarazione di progetto SENZA `reason` e' RIFIUTATA A VOCE ALTA (sotto-test 8).
//
//   applyScanScope(findings, scope, projectDir[, opts]) -> { kept, excluded }
//   // match sul path RELATIVO a projectDir, separatore normalizzato a '/'.
//   // Matcher minimale: prefisso-directory (`dist/`), glob `*` (non attraversa '/'),
//   // glob `**` (attraversa). Niente regex utente.
//
//   scanScopeCoverage(scope, excluded) -> {
//     excluded_patterns: [{ pattern, source, matched: n, reason? }],
//     excluded_total: n,
//   }
//
// UN'ESTENSIONE che il keystone MISURA e il PLAN lascia aperta (§3.5, «da valutare in
// build»): nel loop lo scope NON si applica al file sotto fix, o il loop timbrerebbe
// `verified` per la SPARIZIONE di un fingerprint che in realta' e' stato solo NASCOSTO.
// Il sotto-test (10) pretende l'ESITO, non una firma precisa: accetta indifferentemente
//   a) la protezione che viaggia CON LO SCOPE   -> applyScanScope(f, {...scope, protect:[p]}, dir)
//   b) la protezione come OPZIONE del chiamante -> applyScanScope(f, scope, dir, { protect:[p] })
// Chi implementa scelga; chi non implementa nessuna delle due resta rosso.
//
// ---------------------------------------------------------------------------
// I 12 SOTTO-TEST (nomi ESATTI: sono il contratto col verificatore e con l'orchestratore)
// ---------------------------------------------------------------------------
//  (1) generated:not-scanned          segreto in build/ e .next/ => nessun finding
//  (2) codegen:not-scanned            segreto-simile in src/lib/database.types.ts
//                                     TRACCIATO => nessun finding
//  (3) source:still-found             LO STESSO literal in src/app.ts => finding
//                                     (l'esclusione non e' troppo larga: fra (1) e (3)
//                                     l'unica variabile e' il PATH)
//  (4) env-gitignored:still-found     .env GITIGNORATO con un segreto VERO => finding.
//                                     LOAD-BEARING: senza, la scorciatoia «escludi i
//                                     gitignorati» — che da sola chiuderebbe le classi
//                                     A e C — passerebbe il gate (PLAN §1, correzione 1)
//  (5) demo-key:not-flagged           JWT con iss=supabase-demo => nessun finding.
//                                     ANCORA DI NON-REGRESSIONE: vedi la NOTA sotto
//  (6) real-key:still-found           JWT identico ma con iss diverso => finding.
//                                     ANTI-VACUITA' della leva 2
//  (7) project-scope:applied          .trueline/scan-scope.json con backups/** =>
//                                     nessun finding li', e il pattern che li' matcha
//                                     ha provenienza 'project' (non e' il manifest a
//                                     fare il lavoro: sarebbe un'altra leva)
//  (8) project-scope:reason-required  esclusione senza `reason` => RIFIUTATA, non
//                                     ignorata in silenzio
//  (9) coverage:declared              ogni pattern applicato compare in coverage con
//                                     `source` e `matched`; i pattern 'project' portano
//                                     il `reason`; i conti tornano (PLAN §3, L-COL-006:
//                                     nessuna esclusione e' silenziosa)
// (10) loop:seed-file-never-excluded  il file sotto fix non e' escludibile (niente
//                                     `verified` gratis), e proteggerlo NON spegne il
//                                     resto dello scope
// (11) no-declaration:bit-invariant   progetto senza dichiarazioni => insieme dei
//                                     finding IDENTICO (per identita', non per conteggio)
// (12) falsificabile                  neutralizzo l'esclusione => (1) torna ROSSO;
//                                     ripristino => verde. E il manifest svuotato non
//                                     produce piu' pattern 'manifest': le esclusioni
//                                     vengono dai DATI, non da una lista hardcodata
// (13) wiring:baseline                 baseline.mjs::capture ESCLUDE davvero e DICHIARA
//                                     la coverage nello snapshot
// (14) wiring:checkpoint               checkpoint.mjs::control2Security ESCLUDE davvero
//                                     e fa risalire `scan_scope` nell'esito
// (15) wiring:run-loop                 run_loop.mjs::collectFindings ESCLUDE davvero e
//                                     riempie out.scanScope (-> report.coverage.scan_scope)
// (16) wiring:loop-seed-protetto       loop.mjs::rerunOracleFor applica lo scope MA il
//                                     fingerprint del seme sopravvive: niente `verified`
//                                     gratis. STRATO 1 in isolamento: tornano TUTTI i
//                                     finding del file sotto fix, non solo il seme
// (17) wiring:loop-rete-identita'      STRATO 2 in isolamento: con la protezione per
//                                     path disinnescata (path fasullo) il fingerprint
//                                     del seme torna comunque
//
// PERCHE' I SOTTO-TEST (13)-(16) ESISTONO — la lezione pagata il 2026-07-29.
// I sotto-test (1)-(12) esercitano il MODULO (import diretto di scan_scope.mjs). Un
// keystone che si ferma li' misura una libreria, non un prodotto: il 2026-07-29 i
// QUATTRO siti di innesto sono stati trovati sostituiti da no-op (sette punti marcati
// `NEUTRALIZZATO`: applyScanScope mai chiamata in checkpoint/baseline/run_loop, e nel
// loop chiamata SENZA `protect` con la rete per identita' spenta da `if (false && ...)`)
// e il keystone era comunque 12/12 PASS, exit 0. Una feature spenta nel prodotto con il
// gate verde e' esattamente il falso verde che questo prodotto esiste per impedire.
// Quindi (13)-(16) IMPORTANO ED ESEGUONO i quattro chiamanti reali: il gate diventa
// falsificabile rispetto al WIRING, non solo rispetto alla libreria.
//
// NOTA MISURATA SUL SOTTO-TEST (5) — onesta' dichiarata (L-COL-006).
// Misura per DIFFERENZA del 2026-07-29 (stesso file di fixture, stesso gitleaks, due sole
// config): con `git show HEAD:trueline/scripts/oracles/gitleaks.toml` — cioe' SENZA la
// leva 2 — il token demo produce `jwt` sulla riga 34; con il `gitleaks.toml` ATTUALE non
// lo produce piu'. La riga di CONTROLLO (31) resta rossa in entrambe le config.
// CONSEGUENZA: la leva 2 e' CAUSALMENTE NECESSARIA e (5) e' un rosso che diventa verde,
// non un'ancora di non-regressione. Il FLOOR resta comunque parte del sotto-test: nello
// STESSO file, su una riga di CONTROLLO, vive un segreto che DEVE essere segnalato — se
// sparisse anche quello, "nessun finding" vorrebbe dire "il file non e' stato guardato".
//
// CORREZIONE STORICA (tenuta a memoria): fino al 2026-07-29 questo stesso blocco
// affermava che il token demo era gia' soppresso dall'ALLOWLIST GLOBALE DI DEFAULT di
// gitleaks e che quindi il PLAN §3.3 andava ri-misurato perche' «il PLAN e la realta'
// divergono qui». Era la misura a essere sbagliata, non il PLAN. Il difetto non era
// cosmetico: un fatto falso dentro materiale di gate porta il lettore successivo a
// rimuovere una difesa credendola inerte.
//
// ---------------------------------------------------------------------------
// FIXTURE (eval/scan-scope/), PROVVIGIONAMENTO E PRECONDIZIONI
// ---------------------------------------------------------------------------
// Cio' che e' TRACCIATO e' `<fixture>/seed/`, dove ogni segmento che deve diventare un
// dot-file e' scritto `dot.<nome>`; cio' che GIRA e' `<fixture>/project/`, materializzato
// da eval/scan-scope/provision_fixtures.sh (passo d'ORCHESTRATORE: gli agenti non
// toccano git, L-COL-024) e interamente DERIVATO dal seed. La mappatura esiste perche'
// questa fixture ha bisogno, COME MATERIALE DI GATE, proprio dei path che ogni repo
// ignora (.env, .next/, .trueline/) e di un .gitignore ANNIDATO — che varrebbe anche
// per il repo esterno e nasconderebbe la fixture a se stessa.
//
// L'inner-.git non serve a gitleaks (lo scope working-tree legge i file su disco): serve
// a PROVARE che la fixture e' quello che dichiara di essere. Senza quelle prove i
// sotto-test (2) e (4) sono vacui, e un sotto-test vacuo non e' un verde:
//   - src/lib/database.types.ts TRACCIATO -> (2) non e' "un file ignorato che sparisce";
//   - .env e backups/ GITIGNORATI         -> (4) e (7) sono davvero il caso difficile.
// Se l'inner-.git manca, o se la ripartizione non e' quella dichiarata => exit 2.
//
// FLOOR ANTI-VACUO GLOBALE: prima di qualunque asserzione si verifica che la scansione
// GREZZA (nessuno scope applicato) produca almeno un finding in OGNI path bersaglio. Se
// gitleaks smettesse di accendersi su una delle fixture, i sotto-test "=> nessun finding"
// passerebbero per il motivo sbagliato: quello e' AMBIENTE (exit 2), mai un verde.
//
// ---------------------------------------------------------------------------
// ESITO (mai un falso verde — "verde" = exit/output reale, L-COL-002)
//   exit 0 — tutti i sotto-test PASS (sara' vero solo DOPO l'implementazione);
//   exit 1 — almeno un sotto-test FALLISCE (alla nascita: tutti quelli che dipendono da
//            scan_scope.mjs, cioe' 1,2,3,4,7,8,9,10,11,12);
//   exit 2 — PRECONDIZIONE/AMBIENTE (fixture non provvigionate, inner-.git assente,
//            gitleaks non eseguibile, floor anti-vacuo non raggiunto): MAI un falso rosso.
//
// DISCIPLINA: shebang + import SOLO built-in; ROOT da __dirname; radice temp PRIVATA
// per-pid (pattern H-1: eval/.tmp-ss-<pid> + TRUELINE_TMP_VERIFY_ROOT propagato, cleanup
// never-throw con backoff deterministico via Atomics.wait); NESSUN import statico di
// verify_workspace.mjs (in ESM gli import sono valutati PRIMA del corpo: la radice
// privata arriverebbe troppo tardi); nessun Date.now()/Math.random(); nessun retry che
// mascheri un flake; git usato SOLO IN LETTURA (ls-files / check-ignore), mai in
// scrittura (L-COL-024).

import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const IS_WINDOWS = process.platform === 'win32';

// --- Radice temp PRIVATA per-pid (pattern H-1) ------------------------------
// Stesso schema di eval/.tmp-bd-<pid> / .tmp-at-<pid> / .tmp-h1-<pid>, coperta da
// .gitignore "eval/.tmp-*/". Il pid sta nel SEGMENTO-RADICE, non in una copia appesa a
// una radice condivisa. La env viaggia ai figli: nessun figlio deve ricadere sulla
// radice CONDIVISA eval/.tmp-verify (e' il difetto che H-1 ha chiuso).
const TMP_SS_ROOT = resolve(ROOT, 'eval', `.tmp-ss-${process.pid}`);
process.env.TRUELINE_TMP_VERIFY_ROOT = TMP_SS_ROOT;

// --- Materiale sotto esame ---------------------------------------------------
const SCAN_SCOPE_MODULE = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'scan_scope.mjs');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
// I QUATTRO SITI DI INNESTO (sotto-test 13-16). Sono materiale di gate quanto il modulo:
// e' qui che una feature puo' essere spenta senza che nessun altro controllo se ne accorga.
const BASELINE_MODULE = resolve(ROOT, 'trueline', 'scripts', 'findings', 'baseline.mjs');
const CHECKPOINT_MODULE = resolve(ROOT, 'trueline', 'scripts', 'checkpoint', 'checkpoint.mjs');
const RUN_LOOP_MODULE = resolve(ROOT, 'trueline', 'scripts', 'loop', 'run_loop.mjs');
const LOOP_MODULE = resolve(ROOT, 'trueline', 'scripts', 'loop', 'loop.mjs');
const NORMALIZE_MODULE = resolve(ROOT, 'trueline', 'scripts', 'findings', 'normalize.mjs');
const ECOSYSTEM_MANIFEST = resolve(
  ROOT, 'trueline', 'references', 'ecosystems', 'supabase-jsts', 'ecosystem.json',
);
const FIXTURES_DIR = resolve(ROOT, 'eval', 'scan-scope');
const FIXTURE_DECLARED = join(FIXTURES_DIR, 'declared', 'project');
const FIXTURE_UNDECLARED = join(FIXTURES_DIR, 'undeclared', 'project');
const VARIANT_NOREASON = join(FIXTURES_DIR, 'declared', 'variants', 'scan-scope.noreason.json');
const PROVISION_CMD = 'bash eval/scan-scope/provision_fixtures.sh';

// --- Path bersaglio dentro la fixture `declared` ------------------------------
const P_BUILD = 'build/bundle.js';
const P_NEXT = '.next/static/chunks/app-1a2b3c.js';
const P_CODEGEN = 'src/lib/database.types.ts';
const P_SOURCE = 'src/app.ts';
const P_ENV = '.env';
const P_BACKUP = 'backups/remote_data_2026_07_20.sql';
const P_DEMO = 'src/lib/supabase-demo-client.ts';
const P_CLOUD = 'src/lib/supabase-cloud-client.ts';
const PROJECT_DECL = '.trueline/scan-scope.json';

// Discriminanti testuali per LOCALIZZARE le righe (mai un numero di riga hardcodato: il
// commento della fixture puo' crescere, la riga no).
const NEEDLE_DEMO_JWT = '.eyJpc3MiOiJzdXBhYmFzZS1kZW1v';   // base64url di {"iss":"supabase-demo"...
const NEEDLE_CLOUD_JWT = '.eyJpc3MiOiJzdXBhYmFzZSIs';       // base64url di {"iss":"supabase",...
const NEEDLE_CONTROL = 'tlfix_';                          // il segreto di CONTROLLO di (5)

const rel = (p) => String(p).replace(/\\/g, '/').replace(`${String(ROOT).replace(/\\/g, '/')}/`, '');

// ---------------------------------------------------------------------------
// Banco di asserzioni + uscite (stessa forma di h1_perpid_check / build_discipline_check).
// ---------------------------------------------------------------------------
const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// Backoff BLOCCANTE deterministico: assorbe un lock transitorio di Windows senza
// introdurre non-determinismo (niente setTimeout/Date.now/Math.random).
function settleDeterministic(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { /* Atomics non disponibile: prosegui senza attesa */ }
}

// Pulizia ROBUSTA della NOSTRA radice temp privata. NON lancia MAI: un lock transitorio
// su un file appena scritto non deve diventare un falso rosso exit-1.
function cleanSsTmp() {
  for (let i = 0; i < 6; i += 1) {
    try {
      if (!existsSync(TMP_SS_ROOT)) return;
      rmSync(TMP_SS_ROOT, { recursive: true, force: true, maxRetries: 4, retryDelay: 60 });
      if (!existsSync(TMP_SS_ROOT)) return;
    } catch { /* lock transitorio: ritenta col backoff sotto */ }
    if (i < 5) settleDeterministic(80 * (i + 1));
  }
  /* esaurito: NON lanciamo. Una radice vuota-ma-locked non e' un residuo. */
}

// Aborto AMBIENTALE (exit 2): una precondizione non e' soddisfatta. Mai un falso rosso,
// mai un falso verde.
function precondAbort(reason, hint) {
  console.log('');
  console.log('------------------------------------------------------------');
  console.log('=== ORACOLO SCAN-SCOPE: (precondizione mancante) ===');
  console.log(`  - ${reason}`);
  if (hint) console.log(`    -> ${hint}`);
  console.log('(exit 2 = precondizione/ambiente; mai un falso verde, mai un falso rosso.)');
  console.log('------------------------------------------------------------');
  cleanSsTmp();
  process.exit(2);
}

// id deterministico per le dir di scena: pid + contatore monotono.
let __sceneCounter = 0;
function sceneDir(label) {
  __sceneCounter += 1;
  const safe = String(label).replace(/[^A-Za-z0-9._-]/g, '-');
  const dir = join(TMP_SS_ROOT, `${safe}-pid${process.pid}-${__sceneCounter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Copia ISOLATA di una fixture nella nostra radice privata: ogni scena e' indipendente,
// cosi' le scene che MUTANO (8) e (12) non contaminano quelle che leggono.
function stageProject(srcProject, label) {
  const dir = sceneDir(label);
  const dst = join(dir, 'project');
  try { cpSync(srcProject, dst, { recursive: true }); }
  catch (e) { precondAbort(`copia della fixture non riuscita (${rel(srcProject)}): ${e.message}`); }
  return dst;
}

// ---------------------------------------------------------------------------
// git in SOLA LETTURA. Serve a PROVARE la ripartizione tracciato/gitignorato della
// fixture, che e' essa stessa materiale di gate. Nessuna scrittura, mai (L-COL-024).
// ---------------------------------------------------------------------------
function gitRead(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: res.status, stdout: res.stdout || '', error: res.error };
}
function gitTracked(repo, relPath) {
  const r = gitRead(repo, ['ls-files', '--error-unmatch', '--', relPath]);
  if (r.error) precondAbort(`git non eseguibile: ${r.error.message}`);
  return r.status === 0;
}
function gitIgnored(repo, relPath) {
  const r = gitRead(repo, ['check-ignore', '-q', '--', relPath]);
  if (r.error) precondAbort(`git non eseguibile: ${r.error.message}`);
  return r.status === 0;
}

// ---------------------------------------------------------------------------
// L'ORACOLO SPEDITO, invocato COM'E' (contratto invariato: stampa il JSON NATIVO).
// Un errore qui e' AMBIENTE, non un difetto del disegno.
// ---------------------------------------------------------------------------
function runGitleaks(dir) {
  const res = spawnSync(process.execPath, [RUN_GITLEAKS, dir, 'working-tree'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, TRUELINE_TMP_VERIFY_ROOT: TMP_SS_ROOT },
  });
  if (res.error) precondAbort(`run_gitleaks.mjs non eseguibile: ${res.error.message}`);
  if (res.status !== 0) {
    precondAbort(
      `run_gitleaks.mjs exit=${res.status} su ${rel(dir)}`,
      `stderr: ${String(res.stderr || '').trim().split('\n').slice(-1)[0] || '(vuoto)'}`,
    );
  }
  try {
    const data = JSON.parse(res.stdout || '');
    if (!Array.isArray(data)) throw new Error('output non e\' un array');
    return data;
  } catch (e) {
    precondAbort(`output di run_gitleaks.mjs non parsabile su ${rel(dir)}: ${e.message}`);
    return [];
  }
}

// Path RELATIVO al progetto, separatore '/'. gitleaks emette path ASSOLUTI in scope
// working-tree; tolleriamo anche la forma relativa, e su Windows il confronto del
// prefisso e' case-insensitive (la lettera di unita' puo' cambiare di maiuscola).
function relOf(file, projectDir) {
  const f = String(file).replace(/\\/g, '/');
  const p = String(projectDir).replace(/\\/g, '/').replace(/\/+$/, '');
  const cf = IS_WINDOWS ? f.toLowerCase() : f;
  const cp = IS_WINDOWS ? p.toLowerCase() : p;
  if (cf.startsWith(`${cp}/`)) return f.slice(p.length + 1);
  return f.replace(/^\.\//, '');
}

// TOLLERANZA DI FORMA (deliberata): un elemento di `kept`/`excluded` puo' essere il
// finding NUDO oppure un INVOLUCRO che lo annota con il pattern che lo ha colpito
// ({ finding, path, pattern, source } — forma piu' ricca, ed e' quella che serve alla
// coverage). Il gate misura l'ESITO, non la rappresentazione: qui si normalizza una
// volta sola, cosi' nessun sotto-test puo' passare "a vuoto" perche' stava leggendo
// `.File` su un involucro che non ce l'ha.
const findingOf = (e) => (e && typeof e === 'object' && e.finding ? e.finding : e);
function pathOf(e, dir) {
  if (e && typeof e === 'object' && typeof e.path === 'string' && !e.File) return e.path.replace(/\\/g, '/');
  const f = findingOf(e);
  return relOf(f && f.File, dir);
}

// Identita' STABILE di un finding: regola + path relativo + riga. Il VALORE non entra
// mai (e' redatto a monte) e non deve entrare.
const idOf = (e, dir) => `${findingOf(e).RuleID}|${pathOf(e, dir)}|${findingOf(e).StartLine}`;
const atPath = (list, dir, p) => list.filter((e) => pathOf(e, dir) === p);
const underDir = (list, dir, prefix) => list.filter((e) => pathOf(e, dir).startsWith(prefix));
const atLine = (list, dir, p, line) => list.filter(
  (e) => pathOf(e, dir) === p && Number(findingOf(e).StartLine) === line,
);
const pathsOf = (list, dir) => [...new Set(list.map((e) => pathOf(e, dir)))].sort();

// La riga (1-based) che contiene un discriminante testuale. DEVE essere unica: se non lo
// e', la fixture e' cambiata sotto i piedi al gate => precondizione, non rosso.
function lineOfNeedle(file, needle) {
  let src = '';
  try { src = readFileSync(file, 'utf8'); }
  catch (e) { precondAbort(`fixture non leggibile: ${rel(file)} (${e.message})`); }
  const hits = [];
  src.split(/\r?\n/).forEach((line, i) => { if (line.includes(needle)) hits.push(i + 1); });
  if (hits.length !== 1) {
    precondAbort(
      `discriminante "${needle}" trovato ${hits.length} volte in ${rel(file)} (atteso: 1)`,
      'la fixture e\' cambiata: il sotto-test che la usa sarebbe vacuo o ambiguo.',
    );
  }
  return hits[0];
}

// ---------------------------------------------------------------------------
// Il modulo SOTTO ESAME. Import DINAMICO: se non esiste (oggi) l'harness deve poterlo
// DIRE come rosso motivato, non morire con uno stack trace (un crash non e' un verdetto).
// ---------------------------------------------------------------------------
async function loadScanScope() {
  if (!existsSync(SCAN_SCOPE_MODULE)) {
    return { ok: false, why: `modulo ASSENTE: ${rel(SCAN_SCOPE_MODULE)} (non ancora implementato)` };
  }
  let mod;
  try { mod = await import(pathToFileURL(SCAN_SCOPE_MODULE).href); }
  catch (e) { return { ok: false, why: `import di ${rel(SCAN_SCOPE_MODULE)} fallito: ${e.message}` }; }
  const missing = ['resolveScanScope', 'applyScanScope', 'scanScopeCoverage']
    .filter((n) => typeof mod[n] !== 'function');
  if (!Array.isArray(mod.DEFAULT_SCAN_EXCLUDE)) missing.push('DEFAULT_SCAN_EXCLUDE (array)');
  if (missing.length > 0) {
    return { ok: false, why: `export mancanti in ${rel(SCAN_SCOPE_MODULE)}: ${missing.join(', ')}` };
  }
  return { ok: true, mod };
}

// Chiamata DIFENSIVA: un throw dell'implementazione e' un rosso MOTIVATO del sotto-test
// che l'ha provocato, non la morte dell'harness (gli altri 11 devono comunque parlare).
function callSafe(fn, args) {
  try { return { ok: true, value: fn(...args) }; }
  catch (e) { return { ok: false, error: e }; }
}

// Forma minima attesa di { kept, excluded }.
function shapeOfApply(v) {
  return v && Array.isArray(v.kept) && Array.isArray(v.excluded);
}

// ===========================================================================
// PRECONDIZIONI: fixture provvigionate, ripartizione git come DICHIARATA, floor
// anti-vacuo sulla scansione GREZZA.
// ===========================================================================
function requireFixtures() {
  for (const [label, dir] of [['declared', FIXTURE_DECLARED], ['undeclared', FIXTURE_UNDECLARED]]) {
    if (!existsSync(dir)) {
      precondAbort(`fixture "${label}" non provvigionata: ${rel(dir)} assente`, `esegui: ${PROVISION_CMD}`);
    }
    if (!existsSync(join(dir, '.git'))) {
      precondAbort(
        `fixture "${label}": inner-.git assente in ${rel(dir)}`,
        `senza inner-repo la ripartizione TRACCIATO/GITIGNORATO non e' provabile e i sotto-test (2)/(4) sarebbero vacui. Esegui: ${PROVISION_CMD}`,
      );
    }
  }
  if (!existsSync(VARIANT_NOREASON)) {
    precondAbort(`variante senza reason assente: ${rel(VARIANT_NOREASON)} (sotto-test 8 non esercitabile)`);
  }
  if (!existsSync(RUN_GITLEAKS)) precondAbort(`oracolo secret assente: ${rel(RUN_GITLEAKS)}`);
  if (!existsSync(ECOSYSTEM_MANIFEST)) precondAbort(`manifest d'ecosistema assente: ${rel(ECOSYSTEM_MANIFEST)}`);

  // La fixture e' quello che DICHIARA di essere? (git in sola lettura)
  if (!gitTracked(FIXTURE_DECLARED, P_CODEGEN)) {
    precondAbort(
      `fixture "declared": ${P_CODEGEN} NON e' tracciato dall'inner-repo`,
      'il sotto-test (2) esiste PERCHE\' il codegen e\' TRACCIATO: se non lo fosse, proverebbe un\'altra cosa.',
    );
  }
  for (const p of [P_ENV, P_BACKUP]) {
    if (!gitIgnored(FIXTURE_DECLARED, p)) {
      precondAbort(
        `fixture "declared": ${p} NON e' gitignorato dall'inner-repo`,
        'i sotto-test (4)/(7) misurano proprio il caso gitignorato: senza, sono vacui.',
      );
    }
  }
  if (existsSync(join(FIXTURE_UNDECLARED, PROJECT_DECL))) {
    precondAbort(
      `fixture "undeclared" contiene ${PROJECT_DECL}: non e' piu' "senza dichiarazioni"`,
      'il sotto-test (11) misura la BIT-invarianza in assenza TOTALE di dichiarazioni.',
    );
  }
  if (!existsSync(join(FIXTURE_DECLARED, PROJECT_DECL))) {
    precondAbort(`fixture "declared" priva di ${PROJECT_DECL}: la leva 3 non e' esercitabile`);
  }
}

// FLOOR ANTI-VACUO: la scansione GREZZA deve accendersi in OGNI path bersaglio. Se non
// lo fa, i sotto-test "=> nessun finding" passerebbero per il motivo sbagliato.
function requireRawFloor(raw, dir, wanted, label) {
  const missing = wanted.filter((p) => atPath(raw, dir, p).length === 0);
  if (missing.length > 0) {
    precondAbort(
      `floor anti-vacuo non raggiunto sulla fixture "${label}": nessun finding GREZZO in ${missing.join(', ')}`,
      `path con finding: ${pathsOf(raw, dir).join(', ') || '(nessuno)'} — se gitleaks non si accende sulla fixture, "nessun finding" non prova nulla.`,
    );
  }
}

// ===========================================================================
// I SOTTO-TEST
// ===========================================================================

// --- (1) generated:not-scanned ---------------------------------------------
function subTestGeneratedNotScanned(ctx) {
  console.log('');
  console.log('(1) generated:not-scanned — segreto in build/ e .next/ => nessun finding:');
  if (!ctx.applied) { assert('generated:not-scanned', false, ctx.blocked); return; }
  const leftovers = [
    ...underDir(ctx.applied.kept, ctx.dir, 'build/'),
    ...underDir(ctx.applied.kept, ctx.dir, '.next/'),
  ];
  assert('generated:not-scanned', leftovers.length === 0,
    leftovers.length === 0
      ? `${ctx.rawBuildNext} finding GREZZI su build/+.next/ esclusi tutti (kept=0)`
      : `${leftovers.length}/${ctx.rawBuildNext} finding di build/+.next/ sopravvivono: ${[...new Set(leftovers.map((f) => idOf(f, ctx.dir)))].join(' | ')}`);
}

// --- (2) codegen:not-scanned ------------------------------------------------
function subTestCodegenNotScanned(ctx) {
  console.log('');
  console.log(`(2) codegen:not-scanned — ${P_CODEGEN} TRACCIATO dentro src/ => nessun finding:`);
  if (!ctx.applied) { assert('codegen:not-scanned', false, ctx.blocked); return; }
  const left = atPath(ctx.applied.kept, ctx.dir, P_CODEGEN);
  const rawN = atPath(ctx.raw, ctx.dir, P_CODEGEN).length;
  assert('codegen:not-scanned', left.length === 0,
    left.length === 0
      ? `${rawN} finding GREZZI sul codegen TRACCIATO esclusi (ne' .gitignore ne' una lista di cartelle di build lo prendevano)`
      : `${left.length}/${rawN} finding sopravvivono su ${P_CODEGEN}: ${left.map((f) => idOf(f, ctx.dir)).join(' | ')}`);
}

// --- (3) source:still-found -------------------------------------------------
function subTestSourceStillFound(ctx) {
  console.log('');
  console.log(`(3) source:still-found — LO STESSO literal in ${P_SOURCE} => finding (l'unica variabile e' il PATH):`);
  if (!ctx.applied) { assert('source:still-found', false, ctx.blocked); return; }
  const rawN = atPath(ctx.raw, ctx.dir, P_SOURCE).length;
  const keptN = atPath(ctx.applied.kept, ctx.dir, P_SOURCE).length;
  assert('source:still-found', keptN === rawN && keptN > 0,
    keptN === rawN && keptN > 0
      ? `${keptN}/${rawN} finding del sorgente d'autore conservati`
      : `attesi ${rawN} finding su ${P_SOURCE}, ne sopravvivono ${keptN}: l'esclusione e' TROPPO LARGA`);
}

// --- (4) env-gitignored:still-found ----------------------------------------
function subTestEnvStillFound(ctx) {
  console.log('');
  console.log(`(4) env-gitignored:still-found — ${P_ENV} GITIGNORATO con un segreto VERO => finding [LOAD-BEARING]:`);
  if (!ctx.applied) { assert('env-gitignored:still-found', false, ctx.blocked); return; }
  const rawN = atPath(ctx.raw, ctx.dir, P_ENV).length;
  const keptN = atPath(ctx.applied.kept, ctx.dir, P_ENV).length;
  assert('env-gitignored:still-found', keptN === rawN && keptN > 0,
    keptN === rawN && keptN > 0
      ? `${keptN}/${rawN} finding conservati su un file GITIGNORATO: «escludi i gitignorati» non passa di qui`
      : `attesi ${rawN} finding su ${P_ENV} (gitignorato), ne sopravvivono ${keptN}: lo scope sta escludendo per .gitignore — PLAN §1, correzione 1`);
}

// --- (5) demo-key:not-flagged (rosso->verde per effetto della leva 2, con floor) ---
// La leva 2 e' CAUSALMENTE NECESSARIA: misurato per differenza, con il gitleaks.toml di
// HEAD il token demo produce `jwt`, con quello attuale no (vedi la nota in testa al file).
function subTestDemoKeyNotFlagged(ctx) {
  console.log('');
  console.log(`(5) demo-key:not-flagged — JWT iss=supabase-demo => nessun finding [effetto della LEVA 2 + floor]:`);
  const onToken = atLine(ctx.raw, ctx.dir, P_DEMO, ctx.demoLine);
  const onControl = atLine(ctx.raw, ctx.dir, P_DEMO, ctx.controlLine);
  const floorOk = onControl.length > 0;
  const ok = floorOk && onToken.length === 0;
  assert('demo-key:not-flagged', ok,
    !floorOk
      ? `FLOOR NON RAGGIUNTO: nessun finding sulla riga di CONTROLLO ${P_DEMO}:${ctx.controlLine} — "nessun finding" sul token non prova nulla se il file non viene guardato`
      : onToken.length === 0
        ? `0 finding su ${P_DEMO}:${ctx.demoLine} (token demo) e ${onControl.length} sulla riga di controllo :${ctx.controlLine} — il file E' scansionato, il token demo no`
        : `${onToken.length} finding sul token demo (${P_DEMO}:${ctx.demoLine}): ${onToken.map((f) => f.RuleID).join(', ')}`);
}

// --- (6) real-key:still-found (anti-vacuita' della leva 2) ------------------
function subTestRealKeyStillFound(ctx) {
  console.log('');
  console.log(`(6) real-key:still-found — JWT identico ma con iss DIVERSO => finding [ANTI-VACUITA' della leva 2]:`);
  const onToken = atLine(ctx.raw, ctx.dir, P_CLOUD, ctx.cloudLine);
  assert('real-key:still-found', onToken.length > 0,
    onToken.length > 0
      ? `${onToken.length} finding su ${P_CLOUD}:${ctx.cloudLine} (${onToken.map((f) => f.RuleID).join(', ')}): l'allowlist discrimina sull'issuer, non sui JWT`
      : `nessun finding su ${P_CLOUD}:${ctx.cloudLine} — l'allowlist e' TROPPO LARGA (o gitleaks ha smesso di riconoscere i JWT): una anon key di produzione non si spegne dentro un'allowlist (PLAN §2)`);
}

// --- (7) project-scope:applied ---------------------------------------------
function subTestProjectScopeApplied(ctx) {
  console.log('');
  console.log(`(7) project-scope:applied — .trueline/scan-scope.json con backups/** => nessun finding li':`);
  if (!ctx.applied) { assert('project-scope:applied', false, ctx.blocked); return; }
  const left = underDir(ctx.applied.kept, ctx.dir, 'backups/');
  const rawN = underDir(ctx.raw, ctx.dir, 'backups/').length;
  // ANTI-VACUITA': deve essere la LEVA 3 a farlo. Se `backups/**` arrivasse dal manifest
  // (o da nessuno), il sotto-test misurerebbe un'altra leva.
  const fromProject = (ctx.scope.patterns || []).filter((p) => p.source === 'project');
  const ok = left.length === 0 && fromProject.length > 0;
  assert('project-scope:applied', ok,
    left.length !== 0
      ? `${left.length}/${rawN} finding sopravvivono sotto backups/: ${[...new Set(left.map((f) => idOf(f, ctx.dir)))].slice(0, 4).join(' | ')}`
      : fromProject.length === 0
        ? `nessun finding sotto backups/ (${rawN} grezzi) MA lo scope non ha alcun pattern di provenienza 'project': a escludere e' stata un'altra leva — il sotto-test sarebbe vacuo`
        : `${rawN} finding esclusi da ${fromProject.map((p) => `${p.pattern}[project]`).join(', ')}`);
}

// --- (8) project-scope:reason-required -------------------------------------
function subTestReasonRequired(mod, blocked) {
  console.log('');
  console.log('(8) project-scope:reason-required — esclusione senza `reason` => RIFIUTATA, non ignorata:');
  if (!mod) { assert('project-scope:reason-required', false, blocked); return; }
  const scene = stageProject(FIXTURE_DECLARED, 'noreason');
  try {
    mkdirSync(join(scene, '.trueline'), { recursive: true });
    writeFileSync(join(scene, PROJECT_DECL), readFileSync(VARIANT_NOREASON, 'utf8'));
  } catch (e) { precondAbort(`scena (8) non allestibile: ${e.message}`); }

  const r = callSafe(mod.resolveScanScope, [scene, { manifest: null }]);
  if (!r.ok) {
    // Rifiuto RUMOROSO per eccezione: forma preferita. Il messaggio deve NOMINARE il
    // motivo, o l'utente non sa cosa aggiustare.
    const msg = String(r.error && r.error.message || r.error);
    const named = /reason/i.test(msg);
    assert('project-scope:reason-required', named,
      named
        ? `resolveScanScope ha RIFIUTATO con eccezione che nomina il motivo: "${msg.slice(0, 160)}"`
        : `eccezione sollevata ma il messaggio non nomina \`reason\`: "${msg.slice(0, 160)}" — un rifiuto che non si spiega non e' azionabile`);
    return;
  }
  // Rifiuto per VALORE: ammesso, purche' sia RUMOROSO (un segnale esplicito) E i pattern
  // del file NON entrino nello scope. Il silenzio — pattern applicati, o scartati senza
  // dirlo — e' esattamente cio' che il sotto-test vieta.
  const scope = r.value || {};
  const pats = Array.isArray(scope.patterns) ? scope.patterns : [];
  const fromProject = pats.filter((p) => p.source === 'project');
  const signals = ['rejected', 'errors', 'refused', 'invalid'].filter(
    (k) => Array.isArray(scope[k]) && scope[k].length > 0,
  );
  const ok = fromProject.length === 0 && signals.length > 0;
  assert('project-scope:reason-required', ok,
    fromProject.length > 0
      ? `la dichiarazione PRIVA di \`reason\` e' stata APPLICATA lo stesso (${fromProject.map((p) => p.pattern).join(', ')}): un'esclusione senza motivo dichiarato e' un bypass in incognito (PLAN §3.4)`
      : signals.length === 0
        ? 'la dichiarazione e\' stata ignorata IN SILENZIO (nessuna eccezione, nessun campo rejected/errors/refused/invalid): ignorare non e\' rifiutare — chi l\'ha scritta credera\' che sia attiva'
        : `rifiutata a voce alta: ${signals.map((k) => `${k}=${scope[k].length}`).join(', ')}, e nessun pattern 'project' nello scope`);
}

// --- (9) coverage:declared --------------------------------------------------
function subTestCoverageDeclared(ctx, mod) {
  console.log('');
  console.log('(9) coverage:declared — ogni pattern applicato compare in coverage con `source` e `matched`:');
  if (!ctx.applied || !mod) { assert('coverage:declared', false, ctx.blocked); return; }
  const c = callSafe(mod.scanScopeCoverage, [ctx.scope, ctx.applied.excluded]);
  if (!c.ok) {
    assert('coverage:declared', false, `scanScopeCoverage ha lanciato: ${String(c.error && c.error.message || c.error)}`);
    return;
  }
  const cov = c.value || {};
  const list = Array.isArray(cov.excluded_patterns) ? cov.excluded_patterns : null;
  const why = [];
  if (!list) why.push('excluded_patterns assente o non e\' un array');
  if (typeof cov.excluded_total !== 'number') why.push('excluded_total assente o non numerico');
  if (list && typeof cov.excluded_total === 'number') {
    if (cov.excluded_total !== ctx.applied.excluded.length) {
      why.push(`excluded_total=${cov.excluded_total} != finding esclusi realmente (${ctx.applied.excluded.length})`);
    }
    const sum = list.reduce((a, e) => a + (Number(e.matched) || 0), 0);
    if (sum !== cov.excluded_total) why.push(`somma dei matched=${sum} != excluded_total=${cov.excluded_total}`);
    const VALID = new Set(['caller', 'project', 'manifest']);
    // I pattern DICHIARATI nello scope: la coverage puo' elencarli tutti — anche quelli
    // con matched=0, che sono informazione e non rumore (un pattern che non colpisce piu'
    // niente dice o che il rumore e' sparito o che il pattern e' sbagliato; nasconderlo
    // toglie l'unico segnale che li distingue). Cio' che la coverage NON puo' fare e'
    // INVENTARE un pattern che nessuno ha dichiarato: quella sarebbe un'esclusione
    // invisibile all'utente, cioe' esattamente cio' che L-COL-006 vieta.
    const declared = new Set((ctx.scope.patterns || []).map((p) => `${p.source} ${p.pattern}`));
    for (const e of list) {
      if (!e || typeof e.pattern !== 'string' || e.pattern.length === 0) { why.push('una voce senza `pattern`'); continue; }
      if (!VALID.has(e.source)) why.push(`pattern "${e.pattern}" con source non valida (${JSON.stringify(e.source)})`);
      if (!(Number.isInteger(Number(e.matched)) && Number(e.matched) >= 0)) why.push(`pattern "${e.pattern}" con matched=${JSON.stringify(e.matched)} (atteso un intero >= 0)`);
      if (declared.size > 0 && !declared.has(`${e.source} ${e.pattern}`)) {
        why.push(`la coverage dichiara "${e.pattern}"[${e.source}] che non risulta nello scope risolto: un'esclusione che l'utente non ha dichiarato`);
      }
      // PLAN §3.4: il `reason` di progetto viene RIPORTATO nella coverage. E' l'unica
      // cosa che rende legittima la leva 3: un'esclusione motivata nero su bianco a
      // ogni giro non e' un bypass; una taciuta lo sarebbe.
      if (e.source === 'project' && !(typeof e.reason === 'string' && e.reason.trim().length > 0)) {
        why.push(`pattern "${e.pattern}" di provenienza 'project' senza \`reason\` nella coverage`);
      }
    }
    // La coverage deve essere ATTACCATA alla realta': se nessuna voce ha mai escluso
    // nulla mentre dei finding sono stati soppressi, il blocco e' scollegato dai fatti.
    if (cov.excluded_total > 0 && !list.some((e) => Number(e.matched) > 0)) {
      why.push(`${cov.excluded_total} finding soppressi ma nessuna voce con matched>0: la coverage non dice CHI li ha soppressi`);
    }
    // Il conteggio per pattern e' VERIFICATO contro i fatti quando `excluded` annota la
    // provenienza di ogni finding soppresso. Se non la annota, il controllo non e'
    // eseguibile e va DETTO — non dato per buono (L-COL-006).
    const annotated = ctx.applied.excluded.filter((e) => e && typeof e === 'object' && typeof e.pattern === 'string');
    if (annotated.length === ctx.applied.excluded.length && ctx.applied.excluded.length > 0) {
      const realCounts = new Map();
      for (const e of annotated) {
        const k = `${e.source} ${e.pattern}`;
        realCounts.set(k, (realCounts.get(k) || 0) + 1);
      }
      for (const [k, n] of realCounts) {
        const row = list.find((e) => `${e.source} ${e.pattern}` === k);
        if (!row) why.push(`il pattern ${k} ha escluso ${n} finding ma NON compare in coverage: soppressione silenziosa`);
        else if (Number(row.matched) !== n) why.push(`${k}: coverage dichiara matched=${row.matched}, esclusi reali=${n}`);
      }
    } else {
      console.log('       (nota: `excluded` non annota il pattern per ogni finding — il confronto per-pattern dei matched non e\' eseguibile; verificati solo i totali)');
    }
    const srcs = new Set(list.map((e) => e && e.source));
    if (!srcs.has('manifest')) why.push('nessuna voce di provenienza \'manifest\' (leva 1 non visibile nella coverage)');
    if (!srcs.has('project')) why.push('nessuna voce di provenienza \'project\' (leva 3 non visibile nella coverage)');
  }
  assert('coverage:declared', why.length === 0,
    why.length === 0
      ? `${list.length} pattern dichiarati (${list.filter((e) => Number(e.matched) > 0).length} con match), ${cov.excluded_total} finding soppressi, conti quadrati: ${list.filter((e) => Number(e.matched) > 0).map((e) => `${e.pattern}[${e.source}]=${e.matched}${e.reason ? ' +reason' : ''}`).join(' ')}`
      : why.join(' | '));
}

// --- (10) loop:seed-file-never-excluded ------------------------------------
function subTestSeedNeverExcluded(ctx, mod) {
  console.log('');
  console.log(`(10) loop:seed-file-never-excluded — il file sotto fix (${P_BUILD}) non e' escludibile:`);
  if (!ctx.applied || !mod) { assert('loop:seed-file-never-excluded', false, ctx.blocked); return; }
  const rawSeed = atPath(ctx.raw, ctx.dir, P_BUILD).length;
  // Il seme sta DI PROPOSITO sotto un pattern escluso (`build/**`): e' l'esatto
  // contrario del sotto-test (1), e per questo non e' vacuo. Se lo scope potesse
  // nascondere il file sotto fix, il loop vedrebbe sparire il fingerprint e
  // timbrerebbe `verified` SENZA che nessuno abbia corretto niente.
  // Riferimento per la seconda meta' della prova: quanti finding di .next/ sopravvivono
  // SENZA protezione. Proteggere il seme non deve CAMBIARE il resto dello scope — ne'
  // spegnerlo (sarebbe un'esclusione disattivata di straforo) ne' altro. Si confronta
  // col valore BASE, non con 0: se il manifest non escludesse .next/, pretendere 0
  // accuserebbe la protezione di una colpa che non ha.
  const baseNextLeft = underDir(ctx.applied.kept, ctx.dir, '.next/').length;
  const shapes = [
    { label: 'protect nello SCOPE', args: [ctx.raw, { ...ctx.scope, protect: [P_BUILD] }, ctx.dir] },
    { label: 'protect in OPTS', args: [ctx.raw, ctx.scope, ctx.dir, { protect: [P_BUILD] }] },
  ];
  let best = null;
  for (const s of shapes) {
    const r = callSafe(mod.applyScanScope, s.args);
    if (!r.ok || !shapeOfApply(r.value)) continue;
    const keptSeed = atPath(r.value.kept, ctx.dir, P_BUILD).length;
    const exclSeed = atPath(r.value.excluded, ctx.dir, P_BUILD).length;
    const otherLeft = underDir(r.value.kept, ctx.dir, '.next/').length;
    const ok = keptSeed === rawSeed && rawSeed > 0 && exclSeed === 0 && otherLeft === baseNextLeft;
    const cand = { label: s.label, ok, keptSeed, exclSeed, otherLeft };
    if (ok) { best = cand; break; }
    if (!best) best = cand;
  }
  if (!best) {
    assert('loop:seed-file-never-excluded', false,
      'nessuna delle due forme di protezione ha prodotto un { kept, excluded } utilizzabile');
    return;
  }
  assert('loop:seed-file-never-excluded', best.ok,
    best.ok
      ? `${best.label}: ${best.keptSeed}/${rawSeed} finding del file sotto fix conservati, 0 esclusi, e il resto dello scope non cambia (.next/ kept=${baseNextLeft} come senza protezione)`
      : `${best.label}: seme conservati=${best.keptSeed}/${rawSeed} esclusi=${best.exclSeed}`
        + (best.otherLeft !== baseNextLeft ? `; e proteggere il seme ha CAMBIATO il resto dello scope (.next/ kept ${baseNextLeft} -> ${best.otherLeft})` : '')
        + ' — il file sotto fix e\' escludibile: il loop timbrerebbe `verified` senza fix');
}

// --- (11) no-declaration:bit-invariant -------------------------------------
function subTestBitInvariant(mod, blocked) {
  console.log('');
  console.log('(11) no-declaration:bit-invariant — progetto senza dichiarazioni => insieme dei finding IDENTICO:');
  if (!mod) { assert('no-declaration:bit-invariant', false, blocked); return; }
  const scene = stageProject(FIXTURE_UNDECLARED, 'undeclared');
  const raw = runGitleaks(scene);
  requireRawFloor(raw, scene, ['src/app.ts', 'build/bundle.js'], 'undeclared');

  const why = [];
  if (mod.DEFAULT_SCAN_EXCLUDE.length !== 0) {
    why.push(`DEFAULT_SCAN_EXCLUDE non e' vuoto (${mod.DEFAULT_SCAN_EXCLUDE.length} pattern): il default DEVE essere vuoto o l'insieme dei finding cambia per tutti i progetti gia' esistenti`);
  }
  const r = callSafe(mod.resolveScanScope, [scene, {}]);
  if (!r.ok) {
    assert('no-declaration:bit-invariant', false, `resolveScanScope ha lanciato su un progetto senza dichiarazioni: ${String(r.error && r.error.message || r.error)}`);
    return;
  }
  const scope = r.value || {};
  const pats = Array.isArray(scope.patterns) ? scope.patterns : null;
  if (!pats) why.push('scope.patterns assente o non e\' un array');
  else if (pats.length !== 0) why.push(`scope non vuoto senza dichiarazioni: ${pats.map((p) => `${p.pattern}[${p.source}]`).join(', ')}`);

  const a = callSafe(mod.applyScanScope, [raw, scope, scene]);
  if (!a.ok || !shapeOfApply(a.value)) {
    why.push(a.ok ? 'applyScanScope non ha restituito { kept, excluded }' : `applyScanScope ha lanciato: ${String(a.error && a.error.message || a.error)}`);
  } else {
    const before = raw.map((f) => idOf(f, scene)).sort();
    const after = a.value.kept.map((f) => idOf(f, scene)).sort();
    // IDENTITA', non conteggio: due insiemi della stessa CARDINALITA' ma con elementi
    // diversi sarebbero una regressione invisibile a un contatore.
    if (before.join('\n') !== after.join('\n')) {
      const lost = before.filter((x) => !after.includes(x));
      const added = after.filter((x) => !before.includes(x));
      why.push(`insieme dei finding ALTERATO: -${lost.length} (${lost.slice(0, 3).join(' | ')}) +${added.length}`);
    }
    if (a.value.excluded.length !== 0) why.push(`excluded=${a.value.excluded.length} su un progetto senza dichiarazioni (atteso 0)`);
  }
  assert('no-declaration:bit-invariant', why.length === 0,
    why.length === 0
      ? `${raw.length} finding grezzi, ${raw.length} conservati, 0 esclusi, scope vuoto: BIT-invariante`
      : why.join(' | '));
}

// --- (12) falsificabile -----------------------------------------------------
function subTestFalsifiable(ctx, mod) {
  console.log('');
  console.log('(12) falsificabile — neutralizzo l\'esclusione => (1) DEVE tornare rosso; ripristino => verde:');
  if (!ctx.applied || !mod) { assert('falsificabile', false, ctx.blocked); return; }
  const why = [];

  // (a) NEUTRALIZZAZIONE dell'ESCLUSIONE: stesso identico insieme di finding, stesso
  //     projectDir, scope SVUOTATO. I finding di build/+.next/ devono RIAPPARIRE. Se non
  //     riappaiono, non e' applyScanScope a farli sparire: il sotto-test (1) misurerebbe
  //     un fenomeno estraneo (per esempio gitleaks che non guarda quei path) e sarebbe
  //     vacuo per costruzione.
  const empty = { patterns: [], sources: { caller: 0, project: 0, manifest: 0 } };
  const n = callSafe(mod.applyScanScope, [ctx.raw, empty, ctx.dir]);
  if (!n.ok || !shapeOfApply(n.value)) {
    why.push(n.ok ? 'applyScanScope con scope VUOTO non ha restituito { kept, excluded }' : `applyScanScope con scope VUOTO ha lanciato: ${String(n.error && n.error.message || n.error)}`);
  } else {
    const back = underDir(n.value.kept, ctx.dir, 'build/').length + underDir(n.value.kept, ctx.dir, '.next/').length;
    if (back !== ctx.rawBuildNext) {
      why.push(`con scope VUOTO riappaiono ${back}/${ctx.rawBuildNext} finding di build/+.next/: (1) non e' falsificabile — non e' l'esclusione a determinarne l'esito`);
    }
  }

  // (b) RIPRISTINO: con lo scope vero il verdetto di (1) torna verde. Le due meta' insieme
  //     provano che la variabile causale e' LO SCOPE, non la scena.
  const restored = underDir(ctx.applied.kept, ctx.dir, 'build/').length
    + underDir(ctx.applied.kept, ctx.dir, '.next/').length;
  if (restored !== 0) why.push(`ripristinando lo scope reale restano ${restored} finding su build/+.next/ (il ripristino non ripristina)`);

  // (c) NEUTRALIZZAZIONE della LEVA 1 alla SORGENTE: manifest svuotato => nessun pattern
  //     di provenienza 'manifest'. Prova che le esclusioni d'ecosistema vengono dai DATI
  //     del manifest e non da una lista hardcodata nel modulo (che sarebbe invisibile,
  //     non dichiarata e non spegnibile da chi usa un altro pack).
  const m = callSafe(mod.resolveScanScope, [ctx.dir, { manifest: { oracles: { secret: { exclude: [] } } } }]);
  if (!m.ok) {
    why.push(`resolveScanScope con manifest SVUOTATO ha lanciato: ${String(m.error && m.error.message || m.error)}`);
  } else {
    const fromManifest = ((m.value || {}).patterns || []).filter((p) => p.source === 'manifest');
    if (fromManifest.length !== 0) {
      why.push(`col manifest SVUOTATO restano ${fromManifest.length} pattern 'manifest' (${fromManifest.map((p) => p.pattern).join(', ')}): sono hardcodati nel modulo, non dichiarati nel manifest`);
    }
  }

  assert('falsificabile', why.length === 0,
    why.length === 0
      ? `neutralizzato: ${ctx.rawBuildNext} finding riappaiono; ripristinato: 0; manifest svuotato: 0 pattern 'manifest'`
      : why.join(' | '));
}

// ===========================================================================
// ===========================================================================
// (13)-(16) IL WIRING — i QUATTRO SITI DI INNESTO, eseguiti per davvero.
// ===========================================================================
//
// Nessuno di questi sotto-test reimplementa il filtro: importano il CHIAMANTE
// REALE e guardano cosa produce. Il criterio e' sempre lo stesso, e in due parti
// che devono valere INSIEME (L-COL-006):
//   a) i finding coperti dai pattern SPARISCONO davvero (la feature agisce);
//   b) la coverage ESISTE e dice chi li ha soppressi (l'esclusione non e' muta).
// Metterne solo una accetterebbe o una feature inerte con una bella dichiarazione,
// o un'esclusione in incognito. Sono i due modi di sbagliare gia' visti.

// I path (relativi al progetto) che DEVONO sparire e quelli che DEVONO restare.
// `build/**`, `.next/**`, `**/database.types.ts` vengono dal MANIFEST (leva 1),
// `backups/**` dalla DICHIARAZIONE DI PROGETTO (leva 3): un solo sotto-test che li
// guarda tutti prova che entrambe le leve sono innestate, non solo una.
const WIRED_OUT = [P_BUILD, P_NEXT, P_CODEGEN, P_BACKUP];
const WIRED_IN = [P_SOURCE, P_ENV];

// Path repo-relativo -> path progetto-relativo. I finding NORMALIZZATI portano
// `location.file` relativo alla RADICE DEL REPO (toRepoRel), non al progetto: il
// confronto va fatto sul suffisso, o il sotto-test misurerebbe la stringa sbagliata
// e passerebbe a vuoto.
const endsWithAny = (file, list) => {
  const f = String(file).replace(/\\/g, '/');
  return list.some((p) => f.endsWith(`/${p}`) || f === p);
};
const normFilesOut = (findings, list) => findings.filter(
  (f) => endsWithAny((f.location && f.location.file) || '', list),
);

async function importSafe(modulePath) {
  if (!existsSync(modulePath)) return { ok: false, why: `modulo ASSENTE: ${rel(modulePath)}` };
  try { return { ok: true, mod: await import(pathToFileURL(modulePath).href) }; }
  catch (e) { return { ok: false, why: `import di ${rel(modulePath)} fallito: ${e.message}` }; }
}

// Verdetto comune a (13)-(15): cosa e' sparito, cosa e' rimasto, cosa dichiara la coverage.
function judgeWiring(name, findings, cov, ctx) {
  const why = [];
  const leaked = normFilesOut(findings, WIRED_OUT);
  if (leaked.length > 0) {
    const where = [...new Set(leaked.map((f) => String(f.location.file).split('/').slice(-2).join('/')))];
    why.push(`${leaked.length} finding sotto pattern DICHIARATI sono ancora nell'insieme (${where.join(', ')}): lo scope NON e' applicato in questo sito`);
  }
  const kept = normFilesOut(findings, WIRED_IN);
  if (kept.length === 0) {
    why.push(`nessun finding sopravvive su ${WIRED_IN.join('/')} : il sito non ha guardato niente, "zero esclusi" sarebbe vacuo`);
  }
  if (!cov || !Array.isArray(cov.excluded_patterns)) {
    why.push('coverage ASSENTE: il sito esclude senza dichiarare che cosa (L-COL-006 — un\'esclusione muta e\' un bypass)');
  } else {
    if (!(Number(cov.excluded_total) > 0)) {
      why.push(`coverage presente ma excluded_total=${cov.excluded_total}: dichiara di non aver escluso nulla mentre ${ctx.rawExcludable} finding grezzi cadono sotto i pattern`);
    }
    const withMatch = cov.excluded_patterns.filter((p) => Number(p.matched) > 0);
    if (withMatch.length === 0) {
      why.push('nessun pattern con matched>0: la coverage non dice CHI ha soppresso');
    }
    const srcs = new Set(withMatch.map((p) => p.source));
    if (!srcs.has('manifest')) why.push('nessun pattern \'manifest\' con matched>0 (leva 1 non innestata qui)');
    if (!srcs.has('project')) why.push('nessun pattern \'project\' con matched>0 (leva 3 non innestata qui)');
  }
  assert(name, why.length === 0,
    why.length === 0
      ? `${findings.length} finding dopo lo scope (${ctx.raw.length} grezzi), 0 residui sotto i pattern dichiarati, ${kept.length} conservati su ${WIRED_IN.join('/')}, coverage: excluded_total=${cov.excluded_total} da ${cov.excluded_patterns.filter((p) => Number(p.matched) > 0).map((p) => `${p.pattern}[${p.source}]=${p.matched}`).join(' ')}`
      : why.join(' | '));
}

// --- (13) wiring:baseline ---------------------------------------------------
async function subTestWiringBaseline(ctx) {
  console.log('');
  console.log('(13) wiring:baseline — baseline.mjs::capture esclude DAVVERO e dichiara la coverage nello snapshot:');
  const m = await importSafe(BASELINE_MODULE);
  if (!m.ok || typeof m.mod.capture !== 'function') {
    assert('wiring:baseline', false, m.ok ? `capture non esportata da ${rel(BASELINE_MODULE)}` : m.why);
    return;
  }
  let r;
  try { r = m.mod.capture(ctx.dir, ['gitleaks'], ctx.runOpts); }
  catch (e) { assert('wiring:baseline', false, `capture ha lanciato: ${e.message}`); return; }
  if (!r || r.ok !== true) {
    assert('wiring:baseline', false, `capture non riuscita: ${(r && r.detail) || '(nessun dettaglio)'}`);
    return;
  }
  // La coverage deve stare NELLO SNAPSHOT, non solo nel valore di ritorno: e' il
  // baseline.json che qualcuno leggera' fra sei mesi.
  const cov = r.snapshot && r.snapshot.scan_scope;
  judgeWiring('wiring:baseline', r.findings || [], cov, ctx);
}

// --- (14) wiring:checkpoint -------------------------------------------------
async function subTestWiringCheckpoint(ctx) {
  console.log('');
  console.log('(14) wiring:checkpoint — checkpoint.mjs::control2Security esclude DAVVERO e fa risalire scan_scope:');
  const m = await importSafe(CHECKPOINT_MODULE);
  if (!m.ok || typeof m.mod.control2Security !== 'function') {
    assert('wiring:checkpoint', false, m.ok ? `control2Security non esportata da ${rel(CHECKPOINT_MODULE)}` : m.why);
    return;
  }
  let c2;
  try {
    c2 = m.mod.control2Security(ctx.dir, {
      baseline: new Set(), runOpts: ctx.runOpts, withOsv: false, manifest: null,
    });
  } catch (e) { assert('wiring:checkpoint', false, `control2Security ha lanciato: ${e.message}`); return; }
  // Il VERDETTO del controllo non e' in esame (la fixture ha segreti veri di proposito:
  // e' rosso, ed e' giusto). In esame c'e' l'INSIEME che ha guardato e cio' che dichiara.
  judgeWiring('wiring:checkpoint', (c2 && c2.findings) || [], c2 && c2.scan_scope, ctx);
}

// --- (15) wiring:run-loop ---------------------------------------------------
async function subTestWiringRunLoop(ctx) {
  console.log('');
  console.log('(15) wiring:run-loop — run_loop.mjs::collectFindings esclude DAVVERO e riempie out.scanScope:');
  const m = await importSafe(RUN_LOOP_MODULE);
  if (!m.ok || typeof m.mod.collectFindings !== 'function') {
    assert('wiring:run-loop', false, m.ok ? `collectFindings non esportata da ${rel(RUN_LOOP_MODULE)}` : m.why);
    return;
  }
  const out = {};
  let findings;
  try { findings = m.mod.collectFindings(ctx.dir, null, out); }
  catch (e) { assert('wiring:run-loop', false, `collectFindings ha lanciato: ${e.message}`); return; }
  // out.scanScope e' cio' che finisce in report.coverage.scan_scope del REMEDIATE:
  // se resta null, l'esclusione e' invisibile a chi legge il report (§3.4).
  judgeWiring('wiring:run-loop', findings || [], out.scanScope, ctx);
}

// --- (16) wiring:loop-seed-protetto -----------------------------------------
//
// IL SOTTO-TEST CHE VALE PIU' DI TUTTI. (10) prova che il MODULO sa proteggere il
// file sotto fix quando gli si passa `protect`. Questo prova che il CHIAMANTE glielo
// passa davvero — la differenza fra le due cose e' un `verified` regalato a un
// difetto mai corretto.
async function subTestWiringLoopSeed(ctx) {
  console.log(`\n(16) wiring:loop-seed-protetto — rerunOracleFor su un seme in ${P_BUILD} (coperto da build/**):`);
  const ml = await importSafe(LOOP_MODULE);
  const mn = await importSafe(NORMALIZE_MODULE);
  if (!ml.ok || typeof ml.mod.rerunOracleFor !== 'function') {
    assert('wiring:loop-seed-protetto', false, ml.ok ? `rerunOracleFor non esportata da ${rel(LOOP_MODULE)}` : ml.why);
    return;
  }
  if (!mn.ok || typeof mn.mod.normalize !== 'function') {
    assert('wiring:loop-seed-protetto', false, mn.ok ? `normalize non esportata da ${rel(NORMALIZE_MODULE)}` : mn.why);
    return;
  }
  // Il seme si costruisce dal GREZZO (non dalla baseline: la baseline lo esclude,
  // ed e' proprio il punto) con il fingerprint VERO prodotto da normalize.
  let all;
  try { all = mn.mod.normalize('gitleaks', ctx.raw, { ...ctx.runOpts, scope: 'working-tree' }); }
  catch (e) { assert('wiring:loop-seed-protetto', false, `normalize del grezzo ha lanciato: ${e.message}`); return; }
  const seed = all.find((f) => endsWithAny((f.location && f.location.file) || '', [P_BUILD]));
  if (!seed) {
    assert('wiring:loop-seed-protetto', false,
      `nessun finding grezzo su ${P_BUILD}: il sotto-test sarebbe VACUO (fixture cambiata?)`);
    return;
  }
  let rr;
  try { rr = ml.mod.rerunOracleFor(seed, ctx.dir, ctx.runOpts); }
  catch (e) { assert('wiring:loop-seed-protetto', false, `rerunOracleFor ha lanciato: ${e.message}`); return; }
  if (!rr || rr.ok !== true) {
    assert('wiring:loop-seed-protetto', false, `re-run non riuscito: ${(rr && rr.detail) || '(nessun dettaglio)'}`);
    return;
  }
  const why = [];
  const survives = rr.findings.some((f) => f.fingerprint === seed.fingerprint);
  if (!survives) {
    why.push(`il fingerprint del seme (${seed.fingerprint.slice(0, 12)}, ${P_BUILD}) NON e' nel re-run: stillPresent()=false -> il loop timbra \`verified\` SENZA che nessuna fix sia stata applicata`);
  }
  // STRATO 1 IN ISOLAMENTO — e' la parte che quasi sfugge. La difesa e' a DUE strati
  // (protezione per PATH + rete per IDENTITA' sul fingerprint) e sono ridondanti PER
  // DISEGNO: togliendo il solo `protect` dal sito di chiamata, la rete per identita'
  // rimette dentro il seme e il fingerprint sopravvive lo stesso — un gate che
  // guardasse solo il fingerprint resterebbe VERDE con meta' difesa spenta (misurato:
  // 10 -> 9 finding, e nessun sotto-test se ne accorgeva).
  // Discriminante: `protect` protegge il FILE, la rete per identita' il SOLO seme.
  // Quindi si pretende che TUTTI i finding grezzi del file sotto fix tornino nel re-run,
  // non solo quello col fingerprint del seme.
  const rawAtSeedFile = atPath(ctx.raw, ctx.dir, P_BUILD).length;
  const backAtSeedFile = normFilesOut(rr.findings, [P_BUILD]).length;
  if (rawAtSeedFile > 1 && backAtSeedFile < rawAtSeedFile) {
    why.push(`solo ${backAtSeedFile}/${rawAtSeedFile} finding del file sotto fix sono tornati: lo STRATO 1 (protect per path) non e' passato dal sito di chiamata — sopravvive il solo seme, grazie alla rete per identita'`);
  }
  // Anti-vacuita': se il re-run non escludesse NULLA, il seme sopravvivrebbe per
  // inerzia e il sotto-test non proverebbe la protezione. Deve valere insieme: lo
  // scope AGISCE (gli altri path coperti spariscono) e il SEME resta.
  const otherExcluded = normFilesOut(rr.findings, [P_NEXT, P_BACKUP, P_CODEGEN]);
  if (otherExcluded.length > 0) {
    why.push(`lo scope NON agisce nel re-run (${otherExcluded.length} finding ancora su .next//backups//database.types.ts): il seme sopravvive per inerzia, non per protezione`);
  }
  assert('wiring:loop-seed-protetto', why.length === 0,
    why.length === 0
      ? `seme ${seed.fingerprint.slice(0, 12)} conservato e ${backAtSeedFile}/${rawAtSeedFile} finding di ${P_BUILD} tornati (strato 1 attivo), .next//backups//database.types.ts esclusi (scope attivo), ${rr.findings.length} finding nel re-run`
      : why.join(' | '));

  // --- (17) wiring:loop-rete-identita' --------------------------------------
  // STRATO 2 IN ISOLAMENTO. Lo strato 1 aggancia per PATH, e il path normalizzato del
  // finding non coincide con quello nativo di gitleaks: se l'aggancio mancasse, la
  // protezione sarebbe INATTIVA in silenzio — un falso verde che nessuno vede. Per
  // questo esiste la rete per IDENTITA'. Qui si simula esattamente quel guasto: stesso
  // fingerprint del seme, PATH deliberatamente non agganciabile. Se il fingerprint
  // torna lo stesso, la rete c'e'; se non torna, la seconda difesa non esiste piu' e
  // basta un errore di path per regalare un `verified`.
  console.log('');
  console.log('(17) wiring:loop-rete-identita\' — stesso fingerprint, PATH non agganciabile: la rete per identita\' deve rimettere il seme:');
  const blindSeed = { ...seed, location: { ...seed.location, file: 'zz-path-non-agganciabile/bundle.js' } };
  let rr2;
  try { rr2 = ml.mod.rerunOracleFor(blindSeed, ctx.dir, ctx.runOpts); }
  catch (e) { assert('wiring:loop-rete-identita', false, `rerunOracleFor ha lanciato: ${e.message}`); return; }
  if (!rr2 || rr2.ok !== true) {
    assert('wiring:loop-rete-identita', false, `re-run non riuscito: ${(rr2 && rr2.detail) || '(nessun dettaglio)'}`);
    return;
  }
  const backById = rr2.findings.some((f) => f.fingerprint === seed.fingerprint);
  const stillExcluded = normFilesOut(rr2.findings, [P_NEXT, P_BACKUP, P_CODEGEN]).length === 0;
  assert('wiring:loop-rete-identita', backById && stillExcluded,
    backById && stillExcluded
      ? `con la protezione per path DISINNESCATA (path fasullo) il fingerprint ${seed.fingerprint.slice(0, 12)} torna comunque nel re-run, e il resto dello scope resta escluso: lo strato 2 e' vivo e indipendente dallo strato 1`
      : (!backById
        ? `il fingerprint del seme NON e' tornato: senza aggancio per path non resta NESSUNA difesa — un errore di path basta a timbrare \`verified\` un difetto mai corretto`
        : 'lo scope non ha escluso nulla in questo re-run: la prova sarebbe vacua'));
}

function printHeader() {
  console.log('============================================================');
  console.log(' ORACOLO SCAN-SCOPE — CONFINE DELLO SCOPE DI SCANSIONE (test-first, nasce ROSSO)');
  console.log(`   repo root   : ${ROOT}`);
  console.log(`   radice temp : ${rel(TMP_SS_ROOT)} (privata per-pid, pattern H-1)`);
  console.log(`   modulo      : ${rel(SCAN_SCOPE_MODULE)}`);
  console.log('    (1) generated:not-scanned           build/ e .next/ => nessun finding');
  console.log('    (2) codegen:not-scanned             database.types.ts TRACCIATO => nessun finding');
  console.log('    (3) source:still-found              stesso literal in src/ => finding');
  console.log('    (4) env-gitignored:still-found      .env gitignorato, segreto VERO => finding');
  console.log('    (5) demo-key:not-flagged            iss=supabase-demo => nessun finding (+ floor)');
  console.log('    (6) real-key:still-found            iss diverso => finding');
  console.log('    (7) project-scope:applied           backups/** dalla leva 3 => nessun finding');
  console.log('    (8) project-scope:reason-required   esclusione senza reason => RIFIUTATA');
  console.log('    (9) coverage:declared               pattern, source, matched, reason: i conti tornano');
  console.log('   (10) loop:seed-file-never-excluded   il file sotto fix non e\' escludibile');
  console.log('   (11) no-declaration:bit-invariant    nessuna dichiarazione => insieme identico');
  console.log('   (12) falsificabile                   neutralizzo => (1) rosso; ripristino => verde');
  console.log('   --- IL WIRING: i quattro siti di innesto, eseguiti per davvero ---');
  console.log('   (13) wiring:baseline                 capture() esclude e dichiara nello snapshot');
  console.log('   (14) wiring:checkpoint               control2Security() esclude e fa risalire scan_scope');
  console.log('   (15) wiring:run-loop                 collectFindings() esclude e riempie out.scanScope');
  console.log('   (16) wiring:loop-seed-protetto       rerunOracleFor(): il seme sopravvive, il resto no');
  console.log('   (17) wiring:loop-rete-identita\'      strato 2 in isolamento: path fasullo, fp che torna');
  console.log('============================================================');
}

async function main() {
  for (const arg of process.argv.slice(2)) {
    precondAbort(`argomento non riconosciuto: "${arg}" (questo oracolo non prende argomenti)`);
  }
  printHeader();

  cleanSsTmp();
  try { mkdirSync(TMP_SS_ROOT, { recursive: true }); }
  catch (e) { precondAbort(`radice temp non creabile (${rel(TMP_SS_ROOT)}): ${e.message}`); }

  // --- PRECONDIZIONI ------------------------------------------------------
  requireFixtures();

  let manifest = null;
  try { manifest = JSON.parse(readFileSync(ECOSYSTEM_MANIFEST, 'utf8')); }
  catch (e) { precondAbort(`manifest d'ecosistema non parsabile (${rel(ECOSYSTEM_MANIFEST)}): ${e.message}`); }
  const manifestExclude = (((manifest || {}).oracles || {}).secret || {}).exclude;

  const dir = stageProject(FIXTURE_DECLARED, 'declared');
  const raw = runGitleaks(dir);
  requireRawFloor(raw, dir, [P_BUILD, P_NEXT, P_CODEGEN, P_SOURCE, P_ENV, P_BACKUP], 'declared');

  const demoLine = lineOfNeedle(join(dir, P_DEMO), NEEDLE_DEMO_JWT);
  const controlLine = lineOfNeedle(join(dir, P_DEMO), NEEDLE_CONTROL);
  const cloudLine = lineOfNeedle(join(dir, P_CLOUD), NEEDLE_CLOUD_JWT);

  console.log('');
  console.log(`[PASS] precondizione: fixture provvigionate (inner-.git presente), ${P_CODEGEN} TRACCIATO, ${P_ENV} e ${P_BACKUP} GITIGNORATI.`);
  console.log(`       scansione grezza "declared": ${raw.length} finding su ${pathsOf(raw, dir).length} path — ${pathsOf(raw, dir).join(', ')}`);
  console.log(`       righe discriminanti: token demo ${P_DEMO}:${demoLine}, controllo :${controlLine}, token reale ${P_CLOUD}:${cloudLine}`);
  console.log(`       manifest ${rel(ECOSYSTEM_MANIFEST)} -> oracles.secret.exclude = ${Array.isArray(manifestExclude) ? `[${manifestExclude.length} pattern] ${manifestExclude.join(' ')}` : '(ASSENTE: leva 1 non ancora nel manifest)'}`);

  // --- IL MODULO SOTTO ESAME ----------------------------------------------
  const loaded = await loadScanScope();
  const mod = loaded.ok ? loaded.mod : null;
  const blocked = loaded.ok ? '' : `${loaded.why} — controllo NON eseguito, e un controllo non eseguito NON e' un verde (L-COL-006)`;
  console.log('');
  console.log(loaded.ok
    ? `[PASS] modulo caricato: ${rel(SCAN_SCOPE_MODULE)} (resolveScanScope, applyScanScope, scanScopeCoverage, DEFAULT_SCAN_EXCLUDE)`
    : `[INFO] ${loaded.why}`);

  // Pipeline reale: risolvi lo scope (leva 1 dal manifest + leva 3 dal progetto), applicalo.
  let scope = { patterns: [], sources: { caller: 0, project: 0, manifest: 0 } };
  let applied = null;
  if (mod) {
    const r = callSafe(mod.resolveScanScope, [dir, { manifest }]);
    if (!r.ok) {
      console.log(`[INFO] resolveScanScope ha lanciato sulla fixture "declared": ${String(r.error && r.error.message || r.error)}`);
    } else {
      scope = r.value || scope;
      const pats = Array.isArray(scope.patterns) ? scope.patterns : [];
      console.log(`       scope risolto: ${pats.length} pattern — ${pats.map((p) => `${p.pattern}[${p.source}]`).join(' ') || '(vuoto)'}`);
      const a = callSafe(mod.applyScanScope, [raw, scope, dir]);
      if (!a.ok) console.log(`[INFO] applyScanScope ha lanciato: ${String(a.error && a.error.message || a.error)}`);
      else if (!shapeOfApply(a.value)) console.log('[INFO] applyScanScope non ha restituito { kept, excluded }');
      else applied = a.value;
    }
  }

  const ctx = {
    dir,
    raw,
    scope,
    applied,
    blocked: applied ? '' : (blocked || 'pipeline scan-scope non eseguibile (resolveScanScope/applyScanScope non hanno prodotto un esito utilizzabile)'),
    rawBuildNext: underDir(raw, dir, 'build/').length + underDir(raw, dir, '.next/').length,
    demoLine,
    controlLine,
    cloudLine,
    // Materiale dei sotto-test (13)-(16): opzioni di run DETERMINISTICHE (nessun
    // Date.now/uuid: due esecuzioni devono dare gli stessi fingerprint) e il conteggio
    // dei finding GREZZI che cadono sotto i pattern dichiarati — il riferimento contro
    // cui si misura "il sito ha davvero escluso qualcosa".
    runOpts: { runId: `ss-wiring-${process.pid}`, createdAt: '1970-01-01T00:00:00.000Z' },
    rawExcludable: WIRED_OUT.reduce((n, p) => n + atPath(raw, dir, p).length, 0),
  };

  // --- I 12 SOTTO-TEST -----------------------------------------------------
  subTestGeneratedNotScanned(ctx);
  subTestCodegenNotScanned(ctx);
  subTestSourceStillFound(ctx);
  subTestEnvStillFound(ctx);
  subTestDemoKeyNotFlagged(ctx);
  subTestRealKeyStillFound(ctx);
  subTestProjectScopeApplied(ctx);
  subTestReasonRequired(mod, ctx.blocked);
  subTestCoverageDeclared(ctx, mod);
  subTestSeedNeverExcluded(ctx, mod);
  subTestBitInvariant(mod, ctx.blocked);
  subTestFalsifiable(ctx, mod);

  // --- IL WIRING (13)-(16): i chiamanti reali, non piu' solo la libreria ------
  await subTestWiringBaseline(ctx);
  await subTestWiringCheckpoint(ctx);
  await subTestWiringRunLoop(ctx);
  await subTestWiringLoopSeed(ctx);

  // --- IGIENE + ESITO ------------------------------------------------------
  cleanSsTmp();
  let residual = [];
  try { residual = existsSync(TMP_SS_ROOT) ? readdirSync(TMP_SS_ROOT) : []; }
  catch { residual = []; }

  const passed = checks.filter((c) => c.ok).length;
  const red = checks.filter((c) => !c.ok).map((c) => c.name);
  const allOk = red.length === 0;
  console.log('');
  console.log('------------------------------------------------------------');
  console.log(`=== ORACOLO SCAN-SCOPE RESULT: ${allOk ? 'PASS' : 'FAIL'} ===`);
  console.log(`    igiene: ${residual.length === 0 ? `nessun residuo in ${rel(TMP_SS_ROOT)}` : `RESIDUI: ${residual.join(', ')}`}`);
  if (!allOk) {
    console.log(`    sotto-test ROSSI (${red.length}/${checks.length}): ${red.join(', ')}`);
    console.log('    (fino a che trueline/scripts/oracles/scan_scope.mjs non esiste, il rosso e\' l\'ESITO ATTESO.)');
  }
  console.log(`scan_scope_check: ${passed}/${checks.length} PASS`);
  console.log('------------------------------------------------------------');
  process.exit(allOk ? 0 : 1);
}

main();
