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
//     ok: boolean,                 // false su INERTE (red) o su un solo FAILURE (degraded)
//     status: 'green'|'red'|'degraded'|'error',
//     inert:      [{ testFile, ... }],              // asserzioni provate INERTI
//     unresolved: [{ kind, reason: string, ... }],  // candidati NON aggiudicati, DICHIARATI
//     coverage: {
//       scanned: n,                          // file in-scope esaminati
//       candidates: n,                       // asserzioni candidate trovate in totale
//       adjudicated: n,                      // candidati su cui il RUNNER ha dato un verdetto
//       unresolved: n,                       // e il dettaglio per tipo:
//       unresolved_structural: n, unresolved_failure: n,
//       declared: [{ file, line, binding, kind, reason }], // ognuno col suo motivo
//       files: [{ file, candidates: n }],    // ogni target_test in-scope, col suo conto
//     },
//   }
//
// I DUE TIPI DI IRRISOLTO (deciso dall'utente il 30/07/2026, su misura del reviewer del
// task 3). «Irrisolto» copriva due situazioni OPPOSTE, e trattarle uguali produceva un
// FALSO BLOCCO: un progetto sano il cui unico target_test usa `import * as ns` finiva
// degraded -> controllo 4 ROSSO, pur non avendo nulla che non va. E la regola precedente
// («verde se ho aggiudicato almeno un candidato») era una soglia SENZA PRINCIPIO: due
// candidati identici in due file diversi finivano trattati in modo opposto a seconda di
// cosa era successo nell'ALTRO file.
//
//   structural — l'oracolo NON PUO' giudicare per costruzione: binding di namespace,
//                initializer non riconosciuto (`= make()`), dichiarazione solo commentata,
//                binding fuori da appDir. NON degrada MAI: esce in coverage.declared col
//                suo motivo, e il gate resta verde. L-COL-006 e' rispettato dalla
//                DICHIARAZIONE, non dal rosso — precedente di scan_scope (L-COL-036).
//   failure    — l'oracolo DOVEVA farcela e qualcosa e' andato storto: runTargetFile in
//                errore, run che esegue ZERO test, runner non configurato. DEGRADA SEMPRE,
//                anche se e' l'unico e anche se altri candidati sono stati aggiudicati.
//
// Ordine del verdetto: inert.length > 0 -> red · un solo failure -> degraded · altrimenti green.
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
// I 20 SOTTO-TEST (nomi ESATTI: sono il contratto col verificatore)
// ---------------------------------------------------------------------------
//  (1) inert:detected              inert-identity => ok:false + tests/tokens.test.mjs
//  (2) honest-parallel:not-flagged LOAD-BEARING — costanti indipendenti che si
//                                  toccano nel grafo NON sono inerti. Senza questo,
//                                  un oracolo che segnala tutto cio' che e' connesso
//                                  passerebbe il gate
//  (3) healthy:not-flagged         golden-fixture (costante attesa scritta a mano)
//  (4) fixtures:candidate-exists   ANTI-VACUO DEL GATE STESSO — honest-parallel,
//                                  healthy, unresolved, unresolved-failure e mixed
//                                  devono avere >= 1 candidato ciascuna, o i sotto-test
//                                  2, 3, 5, 6, 7 e 8 sarebbero verdi per ASSENZA
//                                  D'ESAME. La prima stesura del piano ci e' cascata:
//                                  la fixture healthy dava 0 candidati
//  (5) unresolved:declared         forma non trattabile => dichiarata, con MOTIVO
//  (6) structural-unresolved:not-degraded
//                                  LOAD-BEARING sulla decisione del 30/07/2026: un
//                                  irrisolto STRUCTURAL (`= make()`) non degrada, esce
//                                  in coverage.declared e il gate resta VERDE. Sostituisce
//                                  `unresolved-only:degraded`, che sotto la regola nuova
//                                  sarebbe FALSO: pretendeva rosso su un progetto sano
//  (7) failure-unresolved:degraded L'ALTRA DIREZIONE, e senza di essa la (6) da sola
//                                  passerebbe anche a un oracolo che non degrada MAI:
//                                  un irrisolto FAILURE (dopo la neutralizzazione il file
//                                  esegue ZERO test) degrada, da solo e sempre
//  (8) mixed:green-with-declared   un candidato aggiudicato + uno structural nello stesso
//                                  file => green, adjudicated 1, unresolved 1. E' il caso
//                                  misto che nessun'altra fixture arbitra
//  (9) zero-candidates:declared    zero candidati va SCRITTO, non taciuto (L-COL-006)
// (10) restore:bit-exact           sha256 dell'albero identico prima/dopo, calcolato
//                                  DAL KEYSTONE (mai dall'oracolo che deve provare)
// (11) coverage:declared           ogni target_test in-scope compare in coverage.files[]
// (12) wiring:control4             IMPORTA ED ESEGUE control4Conformance: la lezione
//                                  di scan-scope (keystone 12/12 verde sopra un wiring
//                                  neutralizzato). Innesto del task 4: rosso fino ad allora
// (13) bit-invariance:legacy       senza blueprintDir il ramo legacy resta invariato
// (14) wiring:control4-degraded    L'ALTRO ESITO dell'innesto. La (12) guarda solo red e
//                                  green, quindi `status: power.status` — l'unica espressione
//                                  CALCOLATA del controllo 4 — sarebbe verde anche scritta
//                                  'red' fisso. E `degraded` non e' sinonimo di red a valle:
//                                  checkpoint.mjs:936 stampa `4:conformance=degraded`, ed e'
//                                  la sola riga per cui la decisione sui due kind raggiunge
//                                  l'utente. La (7) non copre questo: legge l'oracolo NUDO
// (15) bit-invariance:zero-candidates
//                                  LA CLAUSOLA 2, che prima dei fix era solo una frase in un
//                                  documento: a ZERO candidati il detail del controllo 4 e'
//                                  BYTE-IDENTICO a prima dell'innesto (confronto della stringa
//                                  INTERA, non una regex). Asserisce ANCHE coverage.candidates
//                                  === 0, o sarebbe verde pure se l'innesto sopprimesse `power`
//                                  a zero candidati — l'altro modo, opposto, di sbagliare
// (16) report:zero-candidates-declared
//                                  LA (15) SUL PRODOTTO, NON IN MEMORIA. La (15) ispeziona
//                                  il ritorno di control4Conformance, e da sola certifica
//                                  «una proprieta' che il prodotto non ha»: shapeControl e la
//                                  proiezione del loop tengono una whitelist e scartano
//                                  `power`, quindi l'utente riceveva un verde MUTO mentre la
//                                  (15) era verde. Qui si ESEGUE run_checkpoint.mjs e si
//                                  legge il JSON che stampa. E' la differenza che il round di
//                                  fix precedente non catturava, ed e' il motivo per cui il
//                                  keystone deve guardare l'output emesso almeno una volta
//
// (17) restore:bit-exact-via-control4
//                                  LA (10) SUL PERCORSO CHE SI SPEDISCE. La (10) confronta
//                                  hash catturati intorno alla chiamata NUDA ad
//                                  assertionPower, ed e' per giunta VALUTATA PRIMA che le
//                                  callControl4 girino: il percorso del prodotto e'
//                                  control4Conformance -> assertionPower, e quello non era
//                                  misurato da nessuno. E' il sotto-test che avrebbe preso
//                                  CR-1: un albero lasciato sporco da un ripristino fallito
//                                  passava sotto entrambe le reti
// (18) noop-neutralization:declared
//                                  IL RAMO NO-OP (`mutated === src`), che non aveva
//                                  copertura. E' la porta d'ingresso del falso verde di
//                                  CR-1: al secondo tentativo l'oracolo rilegge il file gia'
//                                  neutralizzato, la mutazione e' un no-op e il candidato
//                                  diventa uno structural benigno. Il ramo in se' e'
//                                  corretto — si dichiara, non si scrive un byte — e qui si
//                                  inchioda: green, 0 inert, 0 aggiudicati, albero intatto
// (20) report:declared-reaches-output
//                                  I MOTIVI, SUL REPORT EMESSO. La (16) guarda una fixture
//                                  a ZERO candidati, dove `declared` e' vuoto per
//                                  costruzione: certifica che il campo esiste, mai che porti
//                                  qualcosa. Qui si guida run_checkpoint su una fixture con
//                                  un irrisolto STRUCTURAL vero e si pretende il motivo nel
//                                  JSON E nella stringa detail — due canali diversi, gia'
//                                  persi uno alla volta. Misurato per mutazione: senza questo
//                                  sotto-test, togliere `declared` da powerSummary lasciava
//                                  l'intera batteria VERDE (IM-1)
// (19) dirty-tree:no-green-on-retry
//                                  CR-1, AL LIVELLO DEL WIRING E SENZA INIETTARE NULLA. La
//                                  fixture restore-locked rende il modulo del lato atteso
//                                  non scrivibile mentre l'oracolo lo tiene neutralizzato:
//                                  il write di ripristino fallisce EPERM per davvero. Il
//                                  controllo 4 dev'essere `error` a TUTTI E TRE i tentativi
//                                  che il retry di run_checkpoint produce. Senza il flag
//                                  d'albero sporco il tentativo 2 tornava VERDE — misurato
//                                  il 30/07/2026 — e il verde descriveva il danno
//                                  dell'oracolo come una proprieta' benigna del progetto
//
// ESITO: exit 0 = tutti e 20 i sotto-test ESEGUITI e verdi (solo DOPO i task 2/3/4);
// exit 1 = almeno un rosso, o meno di 20 sotto-test eseguiti (alla nascita: tutti rossi
// tranne due). Il riepilogo esce SEMPRE, anche su eccezione: oracolo assente, oracolo
// rotto, e chiamante reale che lancia degradano tutti a rosso MOTIVATO — un crash non e'
// un verdetto (L-COL-002), e un harness che muore prima del riepilogo nasconde lo stato
// di tutti i sotto-test proprio quando serve leggerlo.
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, statSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

function stage(name, alias = name) {
  const dst = join(TMP_ROOT, alias);
  mkdirSync(dst, { recursive: true });
  cpSync(join(FX, name), dst, { recursive: true });
  return { app: join(dst, 'app'), bp: join(dst, 'blueprint') };
}

// ---------------------------------------------------------------------------
// DRIVE DEL BINARIO SPEDITO — l'unico modo di guardare cio' che l'utente riceve.
// ---------------------------------------------------------------------------
// Ispezionare il ritorno di control4Conformance in-process NON basta: `power` esiste
// sull'oggetto ma shapeControl (run_checkpoint) e la proiezione dei controlli (run_loop)
// tengono una WHITELIST di campi e lo scartano. Un sotto-test in-process certificherebbe
// «una proprieta' che il prodotto non ha» — ed e' esattamente cio' che e' successo al
// round di fix precedente, dentro il keystone che esiste per impedirlo.
const RUN_CHECKPOINT = join(ROOT, 'trueline', 'scripts', 'checkpoint', 'run_checkpoint.mjs');
// Marcatori d'ecosistema. Solo `supabase-jsts` dichiara test_runner.run_file, senza il
// quale il ramo AC non si attiva e il controllo 4 cade al legacy. Stesso setup di fixture
// di anti_tamper_check::copyFixture, e legittimo per la stessa ragione: la fixture E'
// concettualmente un'app supabase-jsts, il suo target_test gira con quel run_file.
// SERVONO ENTRAMBI, e la scoperta e' costata un rosso: con il solo config.toml la
// classificazione resta AMBIGUA fra supabase-jsts e supabase-py (manca il segnale JS/TS)
// e `run_file` esce null — cioe' di nuovo il ramo legacy. Le fixture di anti_tamper hanno
// gia' il package.json nel repo; queste no, quindi si scrive qui, sulla COPIA.
const SUPABASE_CONFIG_TOML = 'project_id = "assertion-power-fixture"\n';
const FIXTURE_PKG_JSON = `${JSON.stringify({
  name: 'assertion-power-fixture', version: '1.0.0', private: true, type: 'module',
}, null, 2)}\n`;

function driveCheckpoint(app, bp) {
  const r = spawnSync(process.execPath,
    [RUN_CHECKPOINT, app, '--in-place', '--mode', 'build', '--no-osv', '--blueprint', bp],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let report = null;
  try { report = JSON.parse(r.stdout); } catch { /* il chiamante lo tratta come non-formato */ }
  return { report, c4: report && Array.isArray(report.controls) ? report.controls[3] : null, stderr: r.stderr };
}

// Retry SOLO su indicatori AMBIENTALI (niente JSON / controls[3] assente), mai su un
// verdetto reale: lezione BD-1 (k=2) gia' scritta in anti_tamper_check — su Windows un
// handle ancora aperto da un oracolo appena terminato puo' degradare la lettura. Un
// esito persistente resta tale: l'oracolo e' il giudice, non il numero di tentativi.
function driveCheckpointStable(app, bp, K = 2) {
  let last = null;
  for (let attempt = 1; attempt <= K; attempt += 1) {
    last = driveCheckpoint(app, bp);
    if (last.report && last.c4) return last;
  }
  return last;
}

// I sotto-test che questo keystone DICHIARA di eseguire. Il conto e' asserito contro
// `checks.length`: un run interrotto a meta' non puo' riportare PASS avendo eseguito
// meno controlli di quanti ne promette — sarebbe la stessa vacuita' che il gate
// sorveglia nelle fixture, spostata nell'harness.
const TOTAL_SUBTESTS = 20;

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
  const fail = run('unresolved-failure');
  const mixed = run('mixed');
  const noop = run('noop-neutral');
  assert('fixtures:candidate-exists',
    [honest, healthy, unres, fail, mixed, noop].every((x) => x.r && x.r.coverage.candidates >= 1),
    'una fixture di controllo senza candidati renderebbe VACUI i sotto-test 2, 3, 5, 6, 7, 8 e 18');

  assert('unresolved:declared', unres.r && unres.r.unresolved.length === 1
    && typeof unres.r.unresolved[0].reason === 'string' && unres.r.inert.length === 0,
    `atteso 1 unresolved con reason, visto ${JSON.stringify(unres.r)}`);

  // I DUE VERSI DELLA DECISIONE DEL 30/07/2026, e servono ENTRAMBI: la (6) da sola
  // passerebbe anche a un oracolo che non degrada mai, la (7) da sola a uno che degrada
  // sempre. Insieme inchiodano la regola, non una delle sue due meta'.
  assert('structural-unresolved:not-degraded',
    unres.r && unres.r.status === 'green' && unres.r.ok === true
      && unres.r.unresolved[0].kind === 'structural'
      && unres.r.coverage.unresolved_structural === 1 && unres.r.coverage.unresolved_failure === 0
      && unres.r.coverage.declared.length === 1
      && typeof unres.r.coverage.declared[0].reason === 'string'
      && unres.r.coverage.declared[0].reason.length > 0
      && unres.r.coverage.declared[0].kind === 'structural',
    `structural NON degrada e si DICHIARA in coverage, visto ${JSON.stringify(unres.r)}`);

  assert('failure-unresolved:degraded',
    fail.r && fail.r.status === 'degraded' && fail.r.ok === false
      && fail.r.unresolved.length === 1 && fail.r.unresolved[0].kind === 'failure'
      && fail.r.coverage.unresolved_failure === 1 && fail.r.inert.length === 0,
    `un failure degrada SEMPRE, anche da solo, visto ${JSON.stringify(fail.r)}`);

  assert('mixed:green-with-declared',
    mixed.r && mixed.r.status === 'green' && mixed.r.ok === true
      && mixed.r.coverage.adjudicated === 1 && mixed.r.coverage.unresolved === 1
      && mixed.r.unresolved[0].kind === 'structural' && mixed.r.inert.length === 0,
    `un aggiudicato + uno structural = green CON dichiarazione, visto ${JSON.stringify(mixed.r)}`);

  const none = run('no-candidates');
  assert('zero-candidates:declared', none.r && none.r.coverage.candidates === 0
    && none.r.coverage.scanned === 1 && none.r.status === 'green',
    `zero candidati va SCRITTO, visto ${JSON.stringify(none.r)}`);

  // `x.r &&` NON e' difensivo: senza un RISULTATO da quella fixture nessuna mutazione e'
  // avvenuta, quindi before === after e' vero PER COSTRUZIONE e il sotto-test sarebbe un
  // verde che non asserisce nulla — esattamente cio' che L-COL-006 vieta, dentro il
  // keystone che lo fa rispettare. (Difetto dello scheletro originale, colto in review.)
  // Sussume la vecchia guardia `mod &&`, che copriva il solo oracolo ASSENTE: dal task 2
  // il modulo esiste, e un oracolo presente ma che non muta nulla tornava a passare a
  // vuoto — proprio mentre il ripristino cominciava a esistere.
  assert('restore:bit-exact', [inert, honest, healthy, unres, none, fail, mixed, noop].every((x) => x.r && x.before === x.after),
    'un albero non ripristinato bit-esatto invalida ogni verdetto');

  // IL RAMO NO-OP, che non aveva copertura. Quando il lato atteso e' GIA' nella forma
  // inerte la mutazione non muta: l'oracolo non puo' aggiudicare, dichiara STRUCTURAL e
  // NON scrive un byte. Le tre meta' che servono insieme:
  //   - green + 0 inert: un no-op non e' una prova d'inerzia. Chiamarlo inerte sarebbe un
  //     FALSO POSITIVO, l'unica direzione d'errore che quest'oracolo si vieta;
  //   - structural CON motivo, e adjudicated 0: cio' che non si e' guardato si scrive;
  //   - `noop.before === noop.after`: la prova che il ramo esce PRIMA di ogni write. E' la
  //     meta' che inchioda l'ordine delle righe — il ramo ritorna prima di rememberOriginal
  //     e prima del write, e qui quell'ordine smette di essere un'assunzione tacita.
  assert('noop-neutralization:declared',
    noop.r && noop.r.status === 'green' && noop.r.ok === true
      && noop.r.inert.length === 0
      && noop.r.coverage.candidates === 1 && noop.r.coverage.adjudicated === 0
      && noop.r.unresolved.length === 1 && noop.r.unresolved[0].kind === 'structural'
      && /no-op/.test(String(noop.r.unresolved[0].reason))
      && noop.r.coverage.unresolved_structural === 1
      && noop.before === noop.after,
    `neutralizzazione no-op: green, dichiarata structural, ZERO write, visto ${JSON.stringify(noop.r)}`);

  // `inScope.length >= 1` per la stessa ragione: [].every(...) e' true, quindi un
  // blueprint il cui `file:` smettesse di corrispondere al disco (typo, rename della
  // fixture, fence YAML che non parsa) renderebbe questo sotto-test verde avendo
  // confrontato ZERO file, ed existsSync lo scarterebbe in silenzio. E' calcolato dal
  // keystone, quindi non costa fiducia nell'oracolo.
  assert('coverage:declared', [inert, honest, healthy, unres, none, fail, mixed, noop].every(
    (x) => x.r && x.inScope.length >= 1 && x.inScope.every((f) => x.r.coverage.files.some((cf) => cf.file === f))),
    'ogni target_test in-scope deve comparire in coverage.files[]');

  // WIRING REALE — la lezione di scan-scope: il keystone deve guardare l'innesto.
  const { control4Conformance } = await import(pathToFileURL(join(ROOT, 'trueline', 'scripts', 'checkpoint', 'checkpoint.mjs')).href);
  const c4Inert = callControl4(control4Conformance, inert.app, { mode: 'build', blueprintDir: inert.bp, manifest: MANIFEST }, 'inert-identity');
  const c4Healthy = callControl4(control4Conformance, healthy.app, { mode: 'build', blueprintDir: healthy.bp, manifest: MANIFEST }, 'healthy');
  assert('wiring:control4', c4Inert.status === 'red' && c4Inert.green === false && c4Healthy.green === true,
    `inert->${c4Inert.status}, healthy->${c4Healthy.status}: l'innesto in control4 non c'e' o non regge`);

  // L'ALTRO ESITO CHE L'INNESTO PUO' EMETTERE. `wiring:control4` guarda solo red e green,
  // quindi `status: power.status` sarebbe verde anche scritta `status: 'red'` fisso: e'
  // l'UNICA espressione calcolata del controllo 4 e nessun test committato la osservava.
  // Non e' un dettaglio di forma: `degraded` non e' sinonimo di `red` a valle —
  // checkpoint.mjs:928 costruisce `degraded[]` filtrando su status === 'degraded' e :936
  // stampa `4:conformance=degraded` nel riepilogo. La decisione sui due kind arriva
  // all'utente SOLO per quella riga, e un mutante che la fissa a 'red' trasforma «l'oracolo
  // non e' riuscito a giudicare» in «ho trovato un'asserzione inerte»: un progetto sano
  // etichettato difettoso. `failure-unresolved:degraded` non copre questo, perche' legge
  // `fail.r` — l'oracolo NUDO, mai control4Conformance.
  const c4Fail = callControl4(control4Conformance, fail.app, { mode: 'build', blueprintDir: fail.bp, manifest: MANIFEST }, 'unresolved-failure (via control4)');
  assert('wiring:control4-degraded',
    c4Fail.status === 'degraded' && c4Fail.green === false
      && c4Fail.power && c4Fail.power.status === 'degraded'
      && c4Fail.power.coverage.unresolved_failure === 1,
    `un failure deve arrivare all'utente come DEGRADED, non come red, visto ${JSON.stringify(c4Fail)}`);

  const c4Legacy = callControl4(control4Conformance, none.app, { mode: 'build', manifest: MANIFEST }, 'no-candidates (ramo legacy)');
  assert('bit-invariance:legacy', c4Legacy.status === 'degraded' && c4Legacy.green === false,
    `senza blueprintDir il ramo legacy deve restare invariato, visto ${JSON.stringify(c4Legacy)}`);

  // CLAUSOLA 2 DELLA BIT-INVARIANZA, che finora era una frase in un documento e nient'altro:
  // su un progetto SENZA candidati l'output del controllo 4 dev'essere BYTE-IDENTICO a prima
  // dell'innesto. Si confronta la stringa INTERA, non una regex: un `match` lascerebbe
  // passare qualunque suffisso, cioe' esattamente cio' che la clausola vieta.
  // La seconda meta' dell'asserzione e' L-COL-006 e non e' ridondante: senza di essa il
  // sotto-test sarebbe verde anche se l'innesto sopprimesse `power` del tutto a zero
  // candidati, che e' l'altro modo — opposto e altrettanto sbagliato — di ottenere la
  // stringa giusta. Invarianza E dichiarazione, o non e' passato.
  const c4None = callControl4(control4Conformance, none.app, { mode: 'build', blueprintDir: none.bp, manifest: MANIFEST }, 'no-candidates (ramo AC, zero candidati)');
  assert('bit-invariance:zero-candidates',
    c4None.status === 'green' && c4None.green === true
      && c4None.detail === 'accettazione AC: 1 target_test verdi'
      && c4None.power && c4None.power.coverage.candidates === 0
      && c4None.power.coverage.scanned === 1,
    `a zero candidati il detail dev'essere byte-identico E la coverage dichiarata, visto ${JSON.stringify(c4None)}`);

  // LO STESSO CONTROLLO, MA SUL REPORT EMESSO DAL BINARIO SPEDITO.
  // Il sotto-test (15) qui sopra guarda l'oggetto IN-PROCESS, e da solo e' insufficiente:
  // resta verde anche quando `power` non raggiunge alcun output: cioe' certifica una
  // proprieta' che il PRODOTTO non ha. E' successo davvero — shapeControl e la proiezione
  // del loop scartano `power`, e a zero candidati l'utente riceveva un verde MUTO. Qui si
  // esegue run_checkpoint.mjs come processo e si legge il JOSN che STAMPA.
  // Due meta', e servono entrambe: la clausola 2 (detail byte-identico) e L-COL-006 (la
  // dichiarazione ESISTE nell'output, non solo in memoria).
  const emitted = stage('no-candidates', 'no-candidates-emitted');
  mkdirSync(join(emitted.app, 'supabase'), { recursive: true });
  writeFileSync(join(emitted.app, 'supabase', 'config.toml'), SUPABASE_CONFIG_TOML);
  writeFileSync(join(emitted.app, 'package.json'), FIXTURE_PKG_JSON);
  const drv = driveCheckpointStable(emitted.app, emitted.bp);
  const ap = drv.report && drv.report.assertion_power;
  assert('report:zero-candidates-declared',
    Boolean(drv.c4) && drv.c4.status === 'green' && drv.c4.green === true
      && drv.c4.detail === 'accettazione AC: 1 target_test verdi'
      && Boolean(ap) && ap.candidates === 0 && ap.scanned === 1 && ap.status === 'green',
    `il REPORT EMESSO deve portare la dichiarazione a zero candidati, visto c4=${JSON.stringify(drv.c4)} assertion_power=${JSON.stringify(ap)}${drv.report ? '' : ` (nessun JSON; stderr: ${String(drv.stderr).slice(0, 300)})`}`);

  // I MOTIVI, SUL REPORT EMESSO — non i conteggi, e non in memoria.
  // La (16) guarda una fixture a ZERO candidati, dove `declared` e' vuoto per costruzione:
  // certifica che il campo esiste, mai che porti qualcosa. Qui si guida il binario spedito
  // su una fixture con un irrisolto STRUCTURAL vero e si pretende il MOTIVO nel JSON.
  // Senza questo sotto-test `coverage.declared` continuava a non raggiungere alcun
  // artefatto emesso mentre tre artefatti SPEDITI dicevano il contrario (IM-1): misurato
  // per mutazione il 30/07/2026 — togliendo `declared` da powerSummary l'intera batteria
  // restava verde. Due meta': il campo strutturato (una macchina lo rilegge) e la stringa
  // `detail` (una persona la legge), perche' passano per canali diversi e si sono gia'
  // persi uno alla volta.
  const emittedU = stage('unresolved', 'unresolved-emitted');
  mkdirSync(join(emittedU.app, 'supabase'), { recursive: true });
  writeFileSync(join(emittedU.app, 'supabase', 'config.toml'), SUPABASE_CONFIG_TOML);
  writeFileSync(join(emittedU.app, 'package.json'), FIXTURE_PKG_JSON);
  const drvU = driveCheckpointStable(emittedU.app, emittedU.bp);
  const apU = drvU.report && drvU.report.assertion_power;
  assert('report:declared-reaches-output',
    Boolean(drvU.c4) && drvU.c4.status === 'green' && drvU.c4.green === true
      && Boolean(apU) && apU.unresolved_structural === 1
      && Array.isArray(apU.declared) && apU.declared.length === 1
      && apU.declared[0].kind === 'structural'
      && apU.declared[0].file === 'tests/thing.test.mjs'
      && typeof apU.declared[0].reason === 'string' && apU.declared[0].reason.length > 0
      && /fuori portata dell'oracolo/.test(String(drvU.c4.detail)),
    `il MOTIVO di uno structural deve raggiungere il report emesso, in entrambi i canali. Visto c4.detail=${
      String(drvU.c4 && drvU.c4.detail)} assertion_power=${JSON.stringify(apU)}${
      drvU.report ? '' : ` (nessun JSON; stderr: ${String(drvU.stderr).slice(0, 300)})`}`);

  // IL RIPRISTINO, MISURATO SUL PERCORSO CHE SI SPEDISCE.
  // `restore:bit-exact` (10) confronta hash catturati dentro run(), intorno alla chiamata
  // NUDA ad assertionPower — e l'assert e' per giunta VALUTATO PRIMA che le callControl4
  // qui sopra girino. Il percorso del prodotto e' pero' control4Conformance ->
  // assertionPower, e le cinque callControl4 rilanciano l'oracolo SULLE STESSE DIR senza
  // che nessuno ricalcoli il treeHash. E' il sotto-test che avrebbe preso CR-1: un albero
  // lasciato sporco da un ripristino fallito non veniva visto da nessuna delle due reti.
  // treeHash e' calcolato DAL KEYSTONE, quindi non costa fiducia nell'oracolo che deve provare.
  const c4Runs = [
    { name: 'inert-identity', app: inert.app, before: inert.before, r: c4Inert },
    { name: 'healthy', app: healthy.app, before: healthy.before, r: c4Healthy },
    { name: 'unresolved-failure', app: fail.app, before: fail.before, r: c4Fail },
    { name: 'no-candidates (legacy)', app: none.app, before: none.before, r: c4Legacy },
    { name: 'no-candidates (ramo AC)', app: none.app, before: none.before, r: c4None },
  ];
  const c4Dirty = c4Runs.filter((x) => treeHash(x.app) !== x.before);
  // La guardia sul sentinel di callControl4 non e' difensiva: se control4Conformance ha
  // LANCIATO non ha ripristinato niente per definizione, e l'albero pulito sarebbe pulito
  // per non essere mai stato toccato — un verde per assenza d'esame, dentro il sotto-test
  // che esiste per impedirlo.
  const c4Ran = c4Runs.every((x) => x.r && typeof x.r.status === 'string' && !x.r.status.startsWith('ECCEZIONE'));
  assert('restore:bit-exact-via-control4', c4Ran && c4Dirty.length === 0,
    c4Ran
      ? `alberi NON ripristinati DOPO control4Conformance: ${c4Dirty.map((x) => x.name).join(', ')}`
      : `almeno una callControl4 ha lanciato: un albero intatto sarebbe intatto per non essere stato toccato — ${JSON.stringify(c4Runs.map((x) => [x.name, x.r && x.r.status]))}`);

  // ---------------------------------------------------------------------------
  // CR-1 — ULTIMO SOTTO-TEST, e l'ordine e' OBBLIGATO.
  // ---------------------------------------------------------------------------
  // Questa fixture alza il flag d'albero sporco NEL PROCESSO DEL KEYSTONE: da qui in poi
  // ogni assertionPower esce 'error' senza toccare nulla, che e' precisamente il
  // comportamento in prova. Anticiparlo renderebbe rossi tutti i sotto-test successivi.
  //
  // NON si inietta nulla nel prodotto: la fixture rende `src/tokens.mjs` non scrivibile
  // mentre l'oracolo lo tiene neutralizzato, quindi il write di ripristino fallisce EPERM
  // per davvero. I tre giri sono quelli che il retry di run_checkpoint.mjs:279-282 produce
  // rilanciando l'intero checkpoint finche' un controllo esce 'error'.
  const locked = stage('restore-locked');
  const lockedTokens = join(locked.app, 'src', 'tokens.mjs');
  const lockedBefore = readFileSync(lockedTokens);
  const lockedTries = [];
  for (let i = 1; i <= 3; i += 1) {
    lockedTries.push(callControl4(control4Conformance, locked.app,
      { mode: 'build', blueprintDir: locked.bp, manifest: MANIFEST }, `restore-locked (tentativo ${i})`));
  }
  // Il file resta NEUTRALIZZATO ed e' cio' che si asserisce: senza questa meta' il
  // sotto-test sarebbe verde anche se l'error venisse da un'altra causa (runner assente,
  // blueprint illeggibile) e non da una mutazione lasciata sul disco.
  const lockedStillDirty = !readFileSync(lockedTokens).equals(lockedBefore);
  try { chmodSync(lockedTokens, 0o644); } catch { /* il cleanup di finish() e' never-throw */ }
  // Si RESTITUISCE il processo pulito: il seam esiste per questo, ed e' l'unica chiamata.
  if (mod && typeof mod.resetTreeDirtyState === 'function') mod.resetTreeDirtyState();

  assert('dirty-tree:no-green-on-retry',
    lockedTries.length === 3
      && lockedTries.every((c) => c.status === 'error' && c.green === false)
      && /RIPRISTINO FALLITO/.test(String(lockedTries[0].detail))
      && /ALBERO SPORCO/.test(String(lockedTries[1].detail))
      && lockedStillDirty,
    `il retry non deve poter convertire un 'error' da mutazione in un verde. Visto: ${
      JSON.stringify(lockedTries.map((c) => c.status))}, file ancora mutato=${lockedStillDirty}, detail[0]=${
      String(lockedTries[0] && lockedTries[0].detail).slice(0, 200)}, detail[1]=${
      String(lockedTries[1] && lockedTries[1].detail).slice(0, 200)}`);

  finish(null);
}

main().catch((e) => finish(String((e && e.stack) || e)));
