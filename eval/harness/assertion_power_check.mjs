#!/usr/bin/env node
// assertion_power_check.mjs — KEYSTONE del potere dell'asserzione d'accettazione.
// Scritto PRIMA dell'oracolo: finche' ac_assertion_power_check.mjs non esiste, il
// rosso e' l'ESITO ATTESO. Verita' = FATTO d'oracolo (L-COL-002).
//
// ---------------------------------------------------------------------------
// IL PROBLEMA CHE GATA (misurato il 30/07/2026 su progetto-web-ai)
// ---------------------------------------------------------------------------
// Un test d'accettazione VERDE la cui asserzione non puo' FALLIRE: `config.mjs`
// importa `colors` da `tokens.mjs` e lo assegna per riferimento, quindi
// `assert.deepEqual(config.theme.extend.colors, colors)` confronta lo STESSO
// oggetto. Il controllo 4 del checkpoint lo timbra verde: e' un test che non
// misura niente, cioe' esattamente il falso verde che questo prodotto esiste per
// impedire. Il difetto NON e' "il test fallisce": e' che non potrebbe mai.
//
// ---------------------------------------------------------------------------
// IL CONTRATTO CHE QUESTO KEYSTONE PRETENDE (task 2 e 3 lo realizzano)
// ---------------------------------------------------------------------------
// trueline/scripts/blueprint/ac_assertion_power_check.mjs — Node ESM, solo built-in:
//
//   assertionPower(tasks, appDir, inScope, { runFileTpl }) -> {
//     ok: boolean,                 // false se c'e' anche un solo inerte o irrisolto
//     status: 'green'|'red'|'degraded'|'error',
//     inert:      [{ testFile, ... }],       // asserzioni provate INERTI
//     unresolved: [{ reason: string, ... }], // candidati NON aggiudicabili, DICHIARATI
//     coverage: {
//       scanned: n,                          // file in-scope esaminati
//       candidates: n,                       // asserzioni candidate trovate in totale
//       files: [{ file, candidates: n }],    // ogni target_test in-scope, col suo conto
//     },
//   }
// Il metodo e' la MUTAZIONE: si neutralizza un lato dell'asserzione e si riesegue il
// file. Se il test resta VERDE, l'asserzione e' inerte. L'albero dell'app va
// RIPRISTINATO bit-esatto (sotto-test 8): un albero sporco invalida ogni verdetto.
//
// TRE COMPORTAMENTI PORTANTI, che le fixture assumono in SILENZIO e che vanno onorati
// alla lettera. Ciascuno, da solo, produce un sotto-test BLOCCATO SUL ROSSO — e uno
// bloccato sul rosso e' indistinguibile da un oracolo non finito, quindi nessuno se ne
// accorge finche' non e' tardi (emersi in review del Task 1):
//
//   1. Si neutralizza SEMPRE il lato ATTESO — il secondo argomento (`rootB`) — mai
//      «quello che si riesce a risolvere». Sotto la regola alternativa,
//      unresolved/app/mirror.mjs (`export const mirror = thing;`, un initializer che e'
//      un identificatore) diventerebbe plausibilmente neutralizzabile, il candidato
//      verrebbe aggiudicato, `unresolved` resterebbe vuoto e i sotto-test 5 e 6
//      sarebbero rossi PER SEMPRE. E' l'assunzione portante dell'intero set di fixture.
//   2. `assertionPower` e' SINCRONA. Il keystone la chiama senza `await` e il suo
//      try/catch non cattura il reject di una promise: una versione `async` metterebbe
//      un Promise in `r`, tutti i sotto-test rossi con dettagli senza senso, piu' un
//      unhandled rejection. callOracle() lo RILEVA e lo dichiara, ma il contratto resta
//      questo: sincrona.
//   3. `testFile` (e `coverage.files[].file`) usano SEMPRE separatori `/`, mai `\`. Il
//      sotto-test 1 confronta `i.testFile === 'tests/tokens.test.mjs'`: su Windows un
//      join() non normalizzato darebbe `tests\tokens.test.mjs` e quel sotto-test non
//      diventerebbe verde mai. Normalizzare con .replace(/\\/g, '/'), come gia' fa
//      treeHash qui sotto.
//
// ---------------------------------------------------------------------------
// GLI 11 SOTTO-TEST (nomi ESATTI: sono il contratto col verificatore)
// ---------------------------------------------------------------------------
//  (1) inert:detected              inert-identity => ok:false + tests/tokens.test.mjs
//  (2) honest-parallel:not-flagged LOAD-BEARING — costanti indipendenti che si
//                                  toccano nel grafo NON sono inerti. Senza questo,
//                                  un oracolo che segnala tutto cio' che e' connesso
//                                  passerebbe il gate
//  (3) healthy:not-flagged         golden-fixture (costante attesa scritta a mano)
//  (4) fixtures:candidate-exists   ANTI-VACUO DEL GATE STESSO — honest-parallel,
//                                  healthy e unresolved devono avere >= 1 candidato
//                                  ciascuna, o i sotto-test 2, 3 e 5 sarebbero verdi
//                                  per ASSENZA D'ESAME. La prima stesura del piano ci
//                                  e' cascata: la fixture healthy dava 0 candidati
//  (5) unresolved:declared         forma non trattabile => dichiarata, con MOTIVO
//  (6) unresolved-only:degraded    tutti i candidati irrisolti => 'degraded', mai green
//  (7) zero-candidates:declared    zero candidati va SCRITTO, non taciuto (L-COL-006)
//  (8) restore:bit-exact           sha256 dell'albero identico prima/dopo, calcolato
//                                  DAL KEYSTONE (mai dall'oracolo che deve provare)
//  (9) coverage:declared           ogni target_test in-scope compare in coverage.files[]
// (10) wiring:control4             IMPORTA ED ESEGUE control4Conformance: la lezione
//                                  di scan-scope (keystone 12/12 verde sopra un wiring
//                                  neutralizzato). Innesto del task 4: rosso fino ad allora
// (11) bit-invariance:legacy       senza blueprintDir il ramo legacy resta invariato
//
// ESITO: exit 0 = tutti e 11 i sotto-test ESEGUITI e verdi (solo DOPO i task 2/3/4);
// exit 1 = almeno un rosso, o meno di 11 sotto-test eseguiti (alla nascita: tutti rossi
// tranne due). Il riepilogo esce SEMPRE, anche su eccezione: oracolo assente, oracolo
// rotto, e chiamante reale che lancia degradano tutti a rosso MOTIVATO — un crash non e'
// un verdetto (L-COL-002), e un harness che muore prima del riepilogo nasconde lo stato
// di tutti i sotto-test proprio quando serve leggerlo.
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const FX = join(ROOT, 'eval', 'assertion-power');
const MANIFEST = { test_runner: { run_file: 'node --test {file}' } };

// Radice privata per-pid + guardia di proprieta': spazza SOLO chi l'ha creata.
const TMP_ROOT = process.env.TRUELINE_TMP_VERIFY_ROOT
  ? join(process.env.TRUELINE_TMP_VERIFY_ROOT, `ap-${process.pid}`)
  : join(tmpdir(), `trueline-ap-${process.pid}`);
const OWNED = !existsSync(TMP_ROOT);

const checks = [];
function assert(name, ok, detail) { checks.push({ name, ok: Boolean(ok), detail }); }

// Chiamata DIFENSIVA all'oracolo (idioma di scan_scope_check::callSafe). L'import
// dinamico copre l'oracolo ASSENTE; questo copre l'oracolo PRESENTE MA ROTTO — export
// mancante o eccezione. In entrambi i casi il verdetto e' un ROSSO MOTIVATO dei
// sotto-test che ne dipendono, mai la morte dell'harness: un crash non e' un verdetto,
// e un oracolo rotto non deve nascondere lo stato degli altri 10 sotto-test.
const oracleErrors = [];
function callOracle(mod, tasks, app, inScope) {
  if (!mod) return null;
  if (typeof mod.assertionPower !== 'function') {
    oracleErrors.push("l'oracolo esiste ma non esporta assertionPower()");
    return null;
  }
  let r;
  try { r = mod.assertionPower(tasks, app, inScope, { runFileTpl: MANIFEST.test_runner.run_file }); }
  catch (e) { oracleErrors.push(`assertionPower ha lanciato: ${String((e && e.message) || e)}`); return null; }
  // Contratto 2: SINCRONA. Un oracolo async restituirebbe un Promise, e ogni sotto-test
  // sarebbe rosso con dettagli senza senso ("visto {}") piu' un unhandled rejection al
  // termine. Lo nominiamo invece di subirlo, e assorbiamo il reject: la rete anti-crash
  // deve coprire anche il caso per cui e' stata costruita.
  if (r && typeof r.then === 'function') {
    oracleErrors.push("assertionPower e' ASYNC: il contratto la vuole SINCRONA (il keystone la chiama senza await)");
    Promise.resolve(r).catch(() => { /* gia' riportato come oracolo rotto */ });
    return null;
  }
  return r;
}

// Stesso idioma per i CHIAMANTI REALI. Il task 4 innesta l'oracolo DENTRO control 4:
// mentre quell'innesto e' scritto a meta', un throw li' ucciderebbe l'harness prima del
// riepilogo — lo stesso difetto che callOracle chiude, un task piu' in la'. Il sentinel
// tiene leggibili `.status`/`.green` a valle, cosi' il sotto-test diventa un rosso
// MOTIVATO invece di uno stack trace.
function callControl4(fn, app, opts, label) {
  try { return fn(app, opts); }
  catch (e) {
    const msg = String((e && e.message) || e);
    oracleErrors.push(`control4Conformance ha lanciato su ${label}: ${msg}`);
    return { status: `ECCEZIONE(${msg})`, green: false };
  }
}

// sha256 ricorsivo dell'albero: prova del ripristino, calcolata DAL KEYSTONE.
function treeHash(dir) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else { h.update(relative(dir, p).replace(/\\/g, '/')); h.update(readFileSync(p)); }
    }
  };
  walk(dir);
  return h.digest('hex');
}

function stage(name) {
  const dst = join(TMP_ROOT, name);
  mkdirSync(dst, { recursive: true });
  cpSync(join(FX, name), dst, { recursive: true });
  return { app: join(dst, 'app'), bp: join(dst, 'blueprint') };
}

// I sotto-test che questo keystone DICHIARA di eseguire. Il conto e' asserito contro
// `checks.length`: un run interrotto a meta' non puo' riportare PASS avendo eseguito
// meno controlli di quanti ne promette — sarebbe la stessa vacuita' che il gate
// sorveglia nelle fixture, spostata nell'harness.
const TOTAL_SUBTESTS = 11;

// RIEPILOGO CHE ESCE SEMPRE — anche su eccezione. Un harness che muore prima di qui
// nasconde lo stato di TUTTI i sotto-test, e si perde il cleanup della temp dir.
function finish(fatal) {
  if (OWNED) { try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* never-throw */ } }

  const passed = checks.filter((c) => c.ok).length;
  const red = checks.filter((c) => !c.ok).map((c) => c.name);
  const complete = checks.length === TOTAL_SUBTESTS;
  const allOk = !fatal && complete && red.length === 0;
  console.log('');
  console.log('------------------------------------------------------------');
  console.log(`=== ORACOLO ASSERTION-POWER RESULT: ${allOk ? 'PASS' : 'FAIL'} ===`);
  if (fatal) console.log(`    INTERROTTO da un'eccezione: ${fatal}`);
  if (!complete) {
    console.log(`    sotto-test ESEGUITI: ${checks.length}/${TOTAL_SUBTESTS} — un run incompleto non e' un PASS.`);
  }
  if (red.length) {
    console.log(`    sotto-test ROSSI (${red.length}/${TOTAL_SUBTESTS}): ${red.join(', ')}`);
  }
  for (const e of [...new Set(oracleErrors)]) console.log(`    ORACOLO ROTTO: ${e}`);
  if (red.length || !complete) {
    console.log("    (fino a che trueline/scripts/blueprint/ac_assertion_power_check.mjs non esiste, il rosso e' l'ESITO ATTESO.)");
    for (const c of checks.filter((x) => !x.ok)) console.log(`      - ${c.name}: ${c.detail}`);
  }
  console.log(`assertion_power_check: ${passed}/${TOTAL_SUBTESTS} PASS`);
  console.log('------------------------------------------------------------');
  process.exit(allOk ? 0 : 1);
}

async function main() {
  let mod = null;
  try { mod = await import(pathToFileURL(join(ROOT, 'trueline', 'scripts', 'blueprint', 'ac_assertion_power_check.mjs')).href); }
  catch { /* non esiste ancora: tutti i sotto-test restano rossi, ed e' l'atteso */ }
  const { loadTasks } = await import(pathToFileURL(join(ROOT, 'trueline', 'scripts', 'blueprint', 'blueprint_tasks.mjs')).href);

  const run = (name) => {
    const { app, bp } = stage(name);
    const before = treeHash(app);
    const tasks = loadTasks(bp);
    const inScope = tasks.flatMap((t) => (t.target_tests || []).map((tt) => tt.file))
      .filter((f) => existsSync(join(app, f))).sort();
    const r = callOracle(mod, tasks, app, inScope);
    return { app, bp, tasks, inScope, r, before, after: treeHash(app) };
  };

  const inert = run('inert-identity');
  assert('inert:detected', inert.r && inert.r.ok === false
    && inert.r.inert.some((i) => i.testFile === 'tests/tokens.test.mjs'),
    `atteso ok:false + tests/tokens.test.mjs in inert, visto ${JSON.stringify(inert.r)}`);

  const honest = run('honest-parallel');
  assert('honest-parallel:not-flagged', honest.r && honest.r.ok === true && honest.r.inert.length === 0,
    `costanti indipendenti: NON e' inerte, visto ${JSON.stringify(honest.r)}`);

  const healthy = run('healthy');
  assert('healthy:not-flagged', healthy.r && healthy.r.ok === true && healthy.r.inert.length === 0,
    `golden-fixture: NON e' inerte, visto ${JSON.stringify(healthy.r)}`);

  const unres = run('unresolved');
  assert('fixtures:candidate-exists',
    [honest, healthy, unres].every((x) => x.r && x.r.coverage.candidates >= 1),
    'una fixture di controllo senza candidati renderebbe VACUI i sotto-test 2, 3 e 5');

  assert('unresolved:declared', unres.r && unres.r.unresolved.length === 1
    && typeof unres.r.unresolved[0].reason === 'string' && unres.r.inert.length === 0,
    `atteso 1 unresolved con reason, visto ${JSON.stringify(unres.r)}`);
  assert('unresolved-only:degraded', unres.r && unres.r.status === 'degraded' && unres.r.ok === false,
    'candidati non aggiudicati = copertura mancante, mai green (L-COL-006)');

  const none = run('no-candidates');
  assert('zero-candidates:declared', none.r && none.r.coverage.candidates === 0
    && none.r.coverage.scanned === 1 && none.r.status === 'green',
    `zero candidati va SCRITTO, visto ${JSON.stringify(none.r)}`);

  // `mod &&` NON e' difensivo: senza oracolo nessuna mutazione avviene, quindi
  // before === after e' vero PER COSTRUZIONE e il sotto-test sarebbe un verde che non
  // asserisce nulla — esattamente cio' che L-COL-006 vieta, dentro il keystone che lo fa
  // rispettare. (Difetto dello scheletro originale, colto in review.)
  assert('restore:bit-exact', mod && [inert, honest, healthy, unres, none].every((x) => x.before === x.after),
    'un albero non ripristinato bit-esatto invalida ogni verdetto');

  // `inScope.length >= 1` per la stessa ragione: [].every(...) e' true, quindi un
  // blueprint il cui `file:` smettesse di corrispondere al disco (typo, rename della
  // fixture, fence YAML che non parsa) renderebbe questo sotto-test verde avendo
  // confrontato ZERO file, ed existsSync lo scarterebbe in silenzio. E' calcolato dal
  // keystone, quindi non costa fiducia nell'oracolo.
  assert('coverage:declared', [inert, honest, healthy, unres, none].every(
    (x) => x.r && x.inScope.length >= 1 && x.inScope.every((f) => x.r.coverage.files.some((cf) => cf.file === f))),
    'ogni target_test in-scope deve comparire in coverage.files[]');

  // WIRING REALE — la lezione di scan-scope: il keystone deve guardare l'innesto.
  const { control4Conformance } = await import(pathToFileURL(join(ROOT, 'trueline', 'scripts', 'checkpoint', 'checkpoint.mjs')).href);
  const c4Inert = callControl4(control4Conformance, inert.app, { mode: 'build', blueprintDir: inert.bp, manifest: MANIFEST }, 'inert-identity');
  const c4Healthy = callControl4(control4Conformance, healthy.app, { mode: 'build', blueprintDir: healthy.bp, manifest: MANIFEST }, 'healthy');
  assert('wiring:control4', c4Inert.status === 'red' && c4Inert.green === false && c4Healthy.green === true,
    `inert->${c4Inert.status}, healthy->${c4Healthy.status}: l'innesto in control4 non c'e' o non regge`);

  const c4Legacy = callControl4(control4Conformance, none.app, { mode: 'build', manifest: MANIFEST }, 'no-candidates (ramo legacy)');
  assert('bit-invariance:legacy', c4Legacy.status === 'degraded' && c4Legacy.green === false,
    `senza blueprintDir il ramo legacy deve restare invariato, visto ${JSON.stringify(c4Legacy)}`);

  finish(null);
}

main().catch((e) => finish(String((e && e.stack) || e)));
