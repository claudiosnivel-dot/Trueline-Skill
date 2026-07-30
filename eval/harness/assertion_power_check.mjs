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
// ESITO: exit 0 = tutti verdi (solo DOPO i task 2/3/4); exit 1 = almeno un rosso
// (alla nascita: tutti). Nessun crash: l'oracolo si importa DINAMICAMENTE, la sua
// assenza degrada a rosso motivato — un crash non e' un verdetto.
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
    const r = mod ? mod.assertionPower(tasks, app, inScope, { runFileTpl: MANIFEST.test_runner.run_file }) : null;
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

  assert('restore:bit-exact', [inert, honest, healthy, unres, none].every((x) => x.before === x.after),
    'un albero non ripristinato bit-esatto invalida ogni verdetto');

  assert('coverage:declared', [inert, honest, healthy, unres, none].every(
    (x) => x.r && x.inScope.every((f) => x.r.coverage.files.some((cf) => cf.file === f))),
    'ogni target_test in-scope deve comparire in coverage.files[]');

  // WIRING REALE — la lezione di scan-scope: il keystone deve guardare l'innesto.
  const { control4Conformance } = await import(pathToFileURL(join(ROOT, 'trueline', 'scripts', 'checkpoint', 'checkpoint.mjs')).href);
  const c4Inert = control4Conformance(inert.app, { mode: 'build', blueprintDir: inert.bp, manifest: MANIFEST });
  const c4Healthy = control4Conformance(healthy.app, { mode: 'build', blueprintDir: healthy.bp, manifest: MANIFEST });
  assert('wiring:control4', c4Inert.status === 'red' && c4Inert.green === false && c4Healthy.green === true,
    `inert->${c4Inert.status}, healthy->${c4Healthy.status}: l'innesto in control4 non c'e' o non regge`);

  const c4Legacy = control4Conformance(none.app, { mode: 'build', manifest: MANIFEST });
  assert('bit-invariance:legacy', c4Legacy.status === 'degraded' && c4Legacy.green === false,
    `senza blueprintDir il ramo legacy deve restare invariato, visto ${JSON.stringify(c4Legacy)}`);

  if (OWNED) { try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* never-throw */ } }

  const passed = checks.filter((c) => c.ok).length;
  const red = checks.filter((c) => !c.ok).map((c) => c.name);
  console.log('');
  console.log('------------------------------------------------------------');
  console.log(`=== ORACOLO ASSERTION-POWER RESULT: ${red.length === 0 ? 'PASS' : 'FAIL'} ===`);
  if (red.length) {
    console.log(`    sotto-test ROSSI (${red.length}/${checks.length}): ${red.join(', ')}`);
    console.log("    (fino a che trueline/scripts/blueprint/ac_assertion_power_check.mjs non esiste, il rosso e' l'ESITO ATTESO.)");
    for (const c of checks.filter((x) => !x.ok)) console.log(`      - ${c.name}: ${c.detail}`);
  }
  console.log(`assertion_power_check: ${passed}/${checks.length} PASS`);
  console.log('------------------------------------------------------------');
  process.exit(red.length === 0 ? 0 : 1);
}

main();
