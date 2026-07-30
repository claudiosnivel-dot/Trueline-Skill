import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neutralizeExport } from './ac_assertion_power_check.mjs';

test('neutralizeExport: oggetto -> {}', () => {
  const s = "export const colors = {\n  a: 'x',\n  b: { c: 'y' },\n};\n";
  assert.equal(neutralizeExport(s, 'colors'), 'export const colors = {};\n');
});

test('neutralizeExport: annotazione TS conservata', () => {
  const s = "export const colors: Record<string, string> = { a: 'x' };\n";
  assert.equal(neutralizeExport(s, 'colors'), 'export const colors: Record<string, string> = {};\n');
});

test('neutralizeExport: array -> []', () => {
  const s = 'export const xs = [1, 2, 3];\n';
  assert.equal(neutralizeExport(s, 'xs'), 'export const xs = [];\n');
});

test('neutralizeExport: stringa -> sentinella distinta', () => {
  const s = "export const name = 'ciao';\n";
  assert.match(neutralizeExport(s, 'name'), /TRUELINE_NEUTRALIZED/);
});

test('neutralizeExport: numero -> valore distinto', () => {
  const s = 'export const MAX = 60;\n';
  assert.equal(neutralizeExport(s, 'MAX'), 'export const MAX = -987654321;\n');
});

test('neutralizeExport: graffe dentro stringa non contano', () => {
  const s = "export const o = { a: '}' , b: 1 };\n";
  assert.equal(neutralizeExport(s, 'o'), 'export const o = {};\n');
});

test('neutralizeExport: forma non riconosciuta -> null', () => {
  assert.equal(neutralizeExport('export const t = make();\n', 't'), null);
});

test('neutralizeExport: binding assente -> null', () => {
  assert.equal(neutralizeExport('export const a = 1;\n', 'b'), null);
});

// Le tre forme in cui la dichiarazione COMMENTATA non e' quella da neutralizzare.
// Neutralizzare il commento lascia VIVA la dichiarazione vera e il file resta
// sintatticamente VALIDO: nessuno a valle se ne accorge, lo stadio 2 rilancia il test,
// lo trova verde e dichiara INERTE un progetto sano. E' il falso positivo che
// l'intestazione di questo modulo si vieta.
test('neutralizeExport: la vecchia versione commentata sopra la nuova non conta', () => {
  const s = "// export const colors = { primary: '#000' };\n"
    + "export const colors = { primary: '#111' };\n";
  assert.equal(neutralizeExport(s, 'colors'),
    "// export const colors = { primary: '#000' };\nexport const colors = {};\n");
});

test("neutralizeExport: un @example in JSDoc non e' la dichiarazione vera", () => {
  const s = '/** @example export const xs = [1]; */\nexport const xs = [2, 3];\n';
  assert.equal(neutralizeExport(s, 'xs'),
    '/** @example export const xs = [1]; */\nexport const xs = [];\n');
});

test('neutralizeExport: se esiste SOLO la forma commentata -> null', () => {
  // Niente di vivo da neutralizzare: si dichiara, non si indovina, e il candidato
  // finisce in unresolved invece di essere aggiudicato su una riga morta.
  assert.equal(neutralizeExport('// export const colors = { a: 1 };\n', 'colors'), null);
});

import { findCandidates } from './ac_assertion_power_check.mjs';
import { join } from 'node:path';
const FX = join(process.cwd(), 'eval', 'assertion-power');

test('findCandidates: coppia di binding importati -> candidato', () => {
  const c = findCandidates(join(FX, 'inert-identity', 'app'), 'tests/tokens.test.mjs');
  assert.equal(c.length, 1);
  assert.equal(c[0].bindingName, 'colors');
});

test('findCandidates: letterale a destra -> nessun candidato', () => {
  assert.equal(findCandidates(join(FX, 'no-candidates', 'app'), 'tests/add.test.mjs').length, 0);
});

test('findCandidates: sovra-inclusivo — il caso onesto E\' un candidato', () => {
  // Lo stadio 1 NON decide: honest-parallel deve arrivare allo stadio 2, che lo assolve.
  assert.equal(findCandidates(join(FX, 'honest-parallel', 'app'), 'tests/limits.test.mjs').length, 1);
});

// ---------- maskComments, e la sua conseguenza su findCandidates -------------
// Blocco NON previsto dal brief. Misurato: il matcher del brief dava 2 candidati su
// inert-identity invece di 1, perche' quella fixture CITA la propria asserzione
// nell'header di commento. Contarla sarebbe un FALSO POSITIVO (vedi il modulo), e il
// test del brief `c.length === 1` non poteva passare senza questa correzione.
// Stessa forma del fratello ac_assertion_trace_check.test.mjs: l'helper string-aware
// e' esportato e provato in diretta, perche' altrimenti i suoi rami non hanno copertura.
import { maskComments } from './ac_assertion_power_check.mjs';

test('maskComments: il commento di riga sparisce, il codice resta', () => {
  const s = 'a(); // assert.equal(x, y)\nb();';
  const out = maskComments(s);
  assert.equal(out.length, s.length); // gli indici non si spostano: `line` resta esatto
  assert.doesNotMatch(out, /assert\.equal/);
  assert.match(out, /a\(\);/);
  assert.match(out, /b\(\);/);
});

test("maskComments: un // dentro una stringa non apre un commento", () => {
  // Se lo aprisse, `assert.equal(u, 'http://x')` — forma comunissima — verrebbe
  // cancellata a meta' e il candidato REALE andrebbe perso.
  const s = "assert.equal(u, 'http://x'); // nota\n";
  const out = maskComments(s);
  assert.match(out, /assert\.equal\(u, 'http:\/\/x'\);/);
  assert.doesNotMatch(out, /nota/);
});

test('maskComments: una quote in un letterale regex non dilaga oltre la riga', () => {
  // `/'/` apre uno stato stringa sfasato. Se non lo si confina alla riga, da li' in poi
  // NIENTE viene piu' mascherato e ricompare esattamente il difetto che maskComments
  // esiste per chiudere. `.replace(/['"]/g, '')` in un file di test non e' esotico.
  const s = "const clean = s.replace(/'/g, '');\n"
    + '// assert.deepEqual(A, B)\n'
    + 'assert.deepEqual(C, D);\n';
  const out = maskComments(s);
  assert.doesNotMatch(out, /deepEqual\(A, B\)/);   // il commento DEVE sparire
  assert.match(out, /assert\.deepEqual\(C, D\);/); // il codice vivo resta intatto
});

test('maskComments: block comment multilinea, newline preservati', () => {
  const s = 'a();\n/* assert.equal(x, y)\n   ancora */\nb();';
  const out = maskComments(s);
  assert.equal(out.length, s.length);
  assert.equal(out.split('\n').length, s.split('\n').length); // il conteggio righe regge
  assert.doesNotMatch(out, /assert\.equal/);
  assert.doesNotMatch(out, /ancora/);
  assert.match(out, /b\(\);/);
});

test("findCandidates: un'asserzione dentro un commento NON e' un candidato", () => {
  // Quel codice non esegue mai: neutralizzarne il modulo lascerebbe il file verde e lo
  // stadio 2 la dichiarerebbe INERTE. E' la direzione d'errore che l'oracolo si vieta.
  const c = findCandidates(join(FX, 'inert-identity', 'app'), 'tests/tokens.test.mjs');
  assert.equal(c.length, 1);
  assert.equal(c[0].line, 14); // la riga ESEGUIBILE, non la riga 2 dell'header
});

// ---------- i filtri di scarto, su temp fixture ------------------------------
// Blocco NON previsto dal brief. Provato per mutazione: togliendo `rootA === rootB`,
// togliendo il filtro sui binding importati, o dando a importBindings il sorgente NON
// mascherato, la suite restava INTERAMENTE VERDE. Erano tre guardie di codice spedito
// senza un solo test che le tenesse: le tre forme che scartano stanno tutte qui, insieme
// a una che DEVE passare, cosi' il test non puo' passare per assenza d'esame.
import { resolveSpec } from './ac_assertion_power_check.mjs';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';

// App usa-e-getta da una mappa { 'src/a.mjs': '<corpo>' }: chiama fn(appDir) e ripulisce
// SEMPRE. pid nel nome, come il keystone, cosi' due run in parallelo non si pestano.
function withTempApp(files, fn) {
  const root = join(tmpdir(), `trueline-ap-unit-${process.pid}`);
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(root, 'app', rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
    return fn(join(root, 'app'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const SRC_ABX = {
  'src/a.mjs': 'export const A = { k: 1 };\n',
  'src/b.mjs': 'export const B = { k: 1 };\n',
  'src/x.mjs': 'export const X = { k: 1 };\n',
};

test('findCandidates: scarta stessa-radice, non-importato e import commentato', () => {
  withTempApp({
    ...SRC_ABX,
    'tests/t.test.mjs': [
      "import { A } from '../src/a.mjs';",
      "import { B } from '../src/b.mjs';",
      "// import { X } from '../src/x.mjs';",
      'const local = { k: 1 };',
      'assert.deepEqual(A, local);', // lato atteso non importato: niente da neutralizzare
      'assert.deepEqual(A.p, A.q);', // stessa radice: neutralizzarla toglierebbe entrambi i lati
      'assert.deepEqual(A, X);',     // X vive solo in un import COMMENTATO: non e' un binding
      'assert.deepEqual(A, B);',     // l'unica forma aggiudicabile
      '',
    ].join('\n'),
  }, (app) => {
    const c = findCandidates(app, 'tests/t.test.mjs');
    assert.equal(c.length, 1);
    assert.equal(c[0].actualRoot, 'A');
    assert.equal(c[0].expectedRoot, 'B'); // si neutralizza il lato ATTESO, il secondo
  });
});

test('findCandidates: doppi apici e `import * as ns` non sono silenzio', () => {
  // Prettier emette doppi apici di DEFAULT: riconoscendo i soli apici singoli l'oracolo
  // sarebbe cieco per costruzione su una fetta larga dei progetti bersaglio — un gate che
  // non spara mai, e in silenzio, che e' il modo peggiore di essere ciechi (L-COL-006).
  withTempApp({
    ...SRC_ABX,
    'tests/q.test.mjs': [
      'import { A } from "../src/a.mjs";',
      'import { B } from "../src/b.mjs";',
      'import * as ns from "../src/x.mjs";',
      'assert.deepEqual(A, B);',
      'assert.deepEqual(A, ns.X);', // namespace: candidato DICHIARATO, non scartato in silenzio
      '',
    ].join('\n'),
  }, (app) => {
    const c = findCandidates(app, 'tests/q.test.mjs');
    assert.equal(c.length, 2);
    assert.deepEqual(c.map((x) => x.expectedRoot), ['B', 'ns']);
  });
});

test('resolveSpec: alias @/, estensione inferita e index di cartella', () => {
  // Tre rami che nessuna fixture esercita (usano tutte specificatori relativi con
  // estensione esplicita) e che si potevano cancellare a suite verde. Il primo e' la
  // convenzione dominante dello stack bersaglio, Next.js/TS.
  withTempApp({
    'src/alias.mjs': 'export const AL = 1;\n',
    'src/b.mjs': 'export const B = 1;\n',
    'src/sub/index.mjs': 'export const S = 1;\n',
    'tests/t.test.mjs': '',
  }, (app) => {
    const from = join(app, 'tests', 't.test.mjs');
    assert.equal(resolveSpec(app, from, '@/alias'), join(app, 'src', 'alias.mjs'));
    assert.equal(resolveSpec(app, from, '../src/b'), join(app, 'src', 'b.mjs'));
    assert.equal(resolveSpec(app, from, '../src/sub'), join(app, 'src', 'sub', 'index.mjs'));
    assert.equal(resolveSpec(app, from, 'node:fs'), null);      // builtin: fuori scope
    assert.equal(resolveSpec(app, from, '../src/manca'), null);  // inesistente
  });
});

// ---------- stadio 2: i tre rami che il brief non prescriveva ---------------
// Aggiunti al Task 3 e pinnati qui perche' sono codice SPEDITO: senza un test, ognuno dei
// tre si potrebbe cancellare lasciando la suite verde — ed e' la classe di difetto che le
// review di questo repo trovano piu' spesso.
import { neutralizeFailureReason, assertionPower } from './ac_assertion_power_check.mjs';
import { readFileSync } from 'node:fs';

test('neutralizeFailureReason: i tre null non hanno lo stesso motivo', () => {
  // E' il testo che l'utente legge quando l'oracolo NON aggiudica. «Forma dell'export non
  // riconosciuta» su una dichiarazione che esiste solo commentata — o che non esiste
  // affatto, come per un import * as ns — lo manda a cercare il difetto dove non e'.
  assert.match(neutralizeFailureReason('export const t = make();\n', 't'), /initializer/);
  assert.match(neutralizeFailureReason('// export const c = { a: 1 };\n', 'c'), /SOLO in un commento/);
  assert.match(neutralizeFailureReason('export function ns() {}\n', 'ns'), /nessun 'export const ns'/);
});

const TASK1 = [{ id: 'T-1', target_tests: [{ file: 'tests/t.test.mjs', covers: ['AC-1'] }] }];

test('assertionPower: senza runner non si muta e non si finge un verdetto', () => {
  // Il template arriva dal manifest del progetto: se manca, runTargetFile lancerebbe
  // (template.trim() su undefined) e il crash risalirebbe fino a control 4. Un crash non
  // e' un verdetto (L-COL-002): si dichiara irrisolto, e l'albero non si tocca affatto.
  withTempApp({
    ...SRC_ABX,
    'tests/t.test.mjs': [
      "import { A } from '../src/a.mjs';",
      "import { B } from '../src/b.mjs';",
      'assert.deepEqual(A, B);',
      '',
    ].join('\n'),
  }, (app) => {
    const before = readFileSync(join(app, 'src', 'b.mjs'), 'utf8');
    const r = assertionPower(TASK1, app, ['tests/t.test.mjs'], {});
    assert.equal(r.status, 'degraded');
    assert.equal(r.unresolved.length, 1);
    assert.match(r.unresolved[0].reason, /test_runner\.run_file/);
    assert.equal(readFileSync(join(app, 'src', 'b.mjs'), 'utf8'), before);
  });
});

test("assertionPower: zero test eseguiti NON e' un'aggiudicazione", () => {
  // A E' B per riferimento, e l'asserzione sta al TOP LEVEL, fuori da ogni test():
  // node:test conta il file come 1 test implicito, che run_file sottrae -> testCount 0.
  // Il file resta VERDE dopo la neutralizzazione, ma un file che non esegue alcun test non
  // ha PROVATO niente: contarlo tra gli aggiudicati disinnescherebbe il floor anti-vacuo e
  // produrrebbe un verde che dichiara «1/1 aggiudicati» senza una sola prova sotto.
  withTempApp({
    'src/b.mjs': 'export const B = { k: 1 };\n',
    'src/a.mjs': "import { B } from './b.mjs';\nexport const A = B;\n",
    'tests/t.test.mjs': [
      "import assert from 'node:assert/strict';",
      "import { A } from '../src/a.mjs';",
      "import { B } from '../src/b.mjs';",
      'assert.deepEqual(A, B);',
      '',
    ].join('\n'),
  }, (app) => {
    const r = assertionPower(TASK1, app, ['tests/t.test.mjs'], { runFileTpl: 'node --test {file}' });
    assert.equal(r.coverage.candidates, 1);
    assert.equal(r.coverage.adjudicated, 0);
    assert.equal(r.inert.length, 0);
    assert.equal(r.status, 'degraded');
    assert.match(r.unresolved[0].reason, /non esegue alcun test/);
  });
});

test('assertionPower: coverage.files[].file usa sempre i separatori /', () => {
  // Contratto 3 del keystone. Al Task 2 la guardia gemella su testFile era rimasta NON
  // falsificabile (l'input arriva gia' con /, quindi toglierla non rompeva nulla): qui si
  // puo' provare davvero, perche' il separativo si passa in ingresso. Il file di test non
  // ha asserzioni APPOSTA — zero candidati, nessun processo lanciato, e l'esito e' lo
  // stesso su Windows e su POSIX, dove un \ nel nome non risolve nemmeno su disco.
  withTempApp({
    'tests/t.test.mjs': "import { test } from 'node:test';\ntest('x', () => {});\n",
  }, (app) => {
    const r = assertionPower([], app, ['tests\\t.test.mjs'], { runFileTpl: 'node --test {file}' });
    assert.equal(r.coverage.scanned, 1);
    assert.equal(r.coverage.files[0].file, 'tests/t.test.mjs');
  });
});

test('assertionPower: un binding fuori da appDir si dichiara e NON si muta', () => {
  // In un monorepo `import '../../packages/design/tokens.mjs'` da' un bindingModule fuori
  // dall'app. Il ripristino resterebbe corretto, ma il rilevatore INDIPENDENTE del keystone
  // e' treeHash(app), rootato sulla dir dell'app: li' e' CIECO. Sarebbe l'unico punto in cui
  // il gate non puo' controllare l'oracolo, ed e' proprio quello che l'oracolo raggiunge in
  // silenzio. Nessuna fixture lo esercita: senza questo test la guardia era cancellabile.
  withTempApp({
    'src/a.mjs': 'export const A = { k: 1 };\n',
    '../outside/b.mjs': 'export const B = { k: 1 };\n',
    'tests/t.test.mjs': [
      "import { A } from '../src/a.mjs';",
      "import { B } from '../../outside/b.mjs';",
      'assert.deepEqual(A, B);',
      '',
    ].join('\n'),
  }, (app) => {
    const outside = join(app, '..', 'outside', 'b.mjs');
    const before = readFileSync(outside, 'utf8');
    const r = assertionPower([], app, ['tests/t.test.mjs'], { runFileTpl: 'node --test {file}' });
    assert.equal(r.unresolved.length, 1);
    assert.equal(r.unresolved[0].kind, 'structural'); // il progetto non ha nulla che non va
    assert.match(r.unresolved[0].reason, /FUORI da appDir/);
    assert.equal(r.status, 'green');                  // structural non degrada
    assert.equal(readFileSync(outside, 'utf8'), before); // e soprattutto: NON e' stato toccato
  });
});

test('neutralizeExport: un binding con $ nel nome non e\' un buco silenzioso', () => {
  // `$` e' legale in un identificatore JS ed e' l'ancora di fine riga con il flag `m`:
  // senza escape il match non avviene MAI, e neutralizeFailureReason direbbe «nessun
  // export const $el nel modulo» mentre la dichiarazione e' li'. E' il motivo che manda
  // l'utente a cercare il difetto dove non e'.
  assert.equal(neutralizeExport('export const $el = { a: 1 };\n', '$el'), 'export const $el = {};\n');
  assert.match(neutralizeFailureReason('export const $el = make();\n', '$el'), /initializer/);
});

// ---------------------------------------------------------------------------
// ONDA DI CORREZIONE DEL 30/07/2026 — i rami che il round precedente non copriva
// ---------------------------------------------------------------------------
import { treeDirtyState, resetTreeDirtyState } from './ac_assertion_power_check.mjs';
import { chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Sorgente di un target_test che rende NON SCRIVIBILE il modulo del lato atteso, ma SOLO
// quando quel modulo e' gia' stato neutralizzato. E' la riproduzione FEDELE del guasto di
// I/O (EBUSY / antivirus / handle ancora aperto su Windows) senza iniettare nulla nel
// prodotto: il write di MUTAZIONE riesce, quello di RIPRISTINO fallisce EPERM.
// L'asserzione e' tautologica APPOSTA: solo cosi' il file resta verde a token azzerati,
// che e' la condizione senza la quale il falso verde di CR-1 non si manifesta.
const LOCKING_TEST = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { chmodSync } from 'node:fs';",
  "import { fileURLToPath } from 'node:url';",
  "import { config } from '../config.mjs';",
  "import { colors } from '../src/tokens.mjs';",
  'if (Object.keys(colors).length === 0) {',
  "  chmodSync(fileURLToPath(new URL('../src/tokens.mjs', import.meta.url)), 0o444);",
  '}',
  "test('t', () => { assert.deepEqual(config.theme.colors, colors); });",
  '',
].join('\n');

test("assertionPower: un ripristino fallito sporca l'albero, e il giro dopo NON e' un verde", () => {
  // CR-1, misurato il 30/07/2026. run_checkpoint.mjs:279-282 rilancia l'INTERO checkpoint
  // finche' un controllo esce 'error' (max 3 tentativi). Quel retry fu scritto per i tool
  // che non emettono JSON — un oracolo che NON HA GIRATO. Qui incontra un 'error' che
  // significa l'opposto: «ho MUTATO il sorgente e non sono riuscito a rimetterlo a posto».
  // Senza il flag d'albero sporco il secondo giro rileggeva il file GIA' neutralizzato,
  // trovava la neutralizzazione no-op, la dichiarava structural benigno e usciva GREEN: la
  // stessa asserzione tautologica che l'oracolo esiste per prendere passava da ROSSO a
  // VERDE per un EBUSY transitorio, e quel verde DESCRIVEVA il danno dell'oracolo come una
  // proprieta' benigna del progetto.
  withTempApp({
    'src/tokens.mjs': "export const colors = { bg: 'x' };\n",
    'config.mjs': "import { colors } from './src/tokens.mjs';\nexport const config = { theme: { colors } };\n",
    'tests/t.test.mjs': LOCKING_TEST,
  }, (app) => {
    const tokens = join(app, 'src', 'tokens.mjs');
    const before = readFileSync(tokens, 'utf8');
    try {
      const r1 = assertionPower(TASK1, app, ['tests/t.test.mjs'], { runFileTpl: 'node --test {file}' });
      assert.equal(r1.status, 'error');
      assert.equal(r1.ok, false);
      assert.match(r1.detail, /RIPRISTINO FALLITO/);
      // ANTI-VACUO: il file dev'essere DAVVERO rimasto mutato. Senza questa riga il test
      // passerebbe anche se l'error venisse da un'altra causa e non da una mutazione
      // lasciata sul disco — cioe' proverebbe qualcosa di diverso da cio' che dichiara.
      assert.notEqual(readFileSync(tokens, 'utf8'), before);
      assert.ok(treeDirtyState(), "il flag d'albero sporco dev'essere alzato");
      assert.equal(treeDirtyState().path, tokens);

      // IL GIRO DOPO, che e' esattamente cio' che il retry produce.
      const r2 = assertionPower(TASK1, app, ['tests/t.test.mjs'], { runFileTpl: 'node --test {file}' });
      assert.equal(r2.status, 'error');
      assert.equal(r2.ok, false);
      assert.match(r2.detail, /ALBERO SPORCO/);
      assert.match(r2.detail, /tokens\.mjs/);   // il file lasciato mutato si NOMINA
      assert.equal(r2.inert.length, 0);
      assert.equal(r2.coverage.candidates, 0);  // non ha guardato niente, e lo dichiara
    } finally {
      try { chmodSync(tokens, 0o644); } catch { /* il cleanup di withTempApp e' force */ }
      resetTreeDirtyState();
    }
  });
});

test("assertionPower: il write di MUTAZIONE che fallisce e' un verdetto, non un crash", () => {
  // Emerso costruendo la fixture restore-locked: con il modulo del lato atteso gia' in sola
  // lettura, l'EPERM del write di mutazione usciva da assertionPower, da control4Conformance
  // e da runCheckpoint, e run_checkpoint.mjs moriva con uno stack trace invece di emettere
  // il JSON del report — nessun verdetto, per NESSUN controllo. Un crash non e' un verdetto
  // (L-COL-002). Qui niente e' stato scritto, quindi l'albero e' PULITO: e' un FAILURE
  // (l'oracolo doveva farcela e non ci e' riuscito), che degrada, non un albero sporco.
  withTempApp({
    ...SRC_ABX,
    'tests/t.test.mjs': [
      "import { A } from '../src/a.mjs';",
      "import { B } from '../src/b.mjs';",
      'assert.deepEqual(A, B);',
      '',
    ].join('\n'),
  }, (app) => {
    const b = join(app, 'src', 'b.mjs');
    const before = readFileSync(b, 'utf8');
    chmodSync(b, 0o444);
    try {
      const r = assertionPower(TASK1, app, ['tests/t.test.mjs'], { runFileTpl: 'node --test {file}' });
      assert.equal(r.status, 'degraded');
      assert.equal(r.unresolved.length, 1);
      assert.equal(r.unresolved[0].kind, 'failure');
      assert.match(r.unresolved[0].reason, /impossibile scrivere la neutralizzazione/);
      assert.equal(readFileSync(b, 'utf8'), before);
      assert.equal(treeDirtyState(), null); // nulla e' stato scritto: l'albero NON e' sporco
    } finally {
      try { chmodSync(b, 0o644); } catch { /* ignore */ }
      resetTreeDirtyState();
    }
  });
});

test('assertionPower: il ramo no-op dichiara structural e non scrive un byte', () => {
  // Il ramo `mutated === src`: il lato atteso e' GIA' nella forma inerte, quindi non c'e'
  // mutazione da cui trarre un verdetto. Non aveva copertura, ed e' la porta d'ingresso del
  // falso verde di CR-1 — al secondo tentativo l'oracolo imboccava proprio questo ramo.
  // Il ramo in se' e' CORRETTO: si dichiara, non si scrive. Le tre meta' che servono:
  //   - green e ZERO inert: un no-op non prova l'inerzia, e chiamarlo inerte sarebbe il
  //     falso positivo che quest'oracolo si vieta;
  //   - structural col suo motivo, adjudicated 0;
  //   - il file INTATTO: e' la prova che il ramo esce prima di rememberOriginal e prima del
  //     write, cioe' quell'ordine di righe smette di essere un'assunzione tacita.
  withTempApp({
    'src/registry.mjs': 'export const registry = {};\n',
    'tests/expected.mjs': 'export const EXPECTED = {};\n',
    'tests/t.test.mjs': [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { registry } from '../src/registry.mjs';",
      "import { EXPECTED } from './expected.mjs';",
      "test('t', () => { assert.deepEqual(registry, EXPECTED); });",
      '',
    ].join('\n'),
  }, (app) => {
    const exp = join(app, 'tests', 'expected.mjs');
    const before = readFileSync(exp, 'utf8');
    const r = assertionPower(TASK1, app, ['tests/t.test.mjs'], { runFileTpl: 'node --test {file}' });
    assert.equal(r.status, 'green');
    assert.equal(r.ok, true);
    assert.equal(r.inert.length, 0);
    assert.equal(r.coverage.candidates, 1);
    assert.equal(r.coverage.adjudicated, 0);
    assert.equal(r.unresolved[0].kind, 'structural');
    assert.match(r.unresolved[0].reason, /no-op/);
    assert.equal(readFileSync(exp, 'utf8'), before);
  });
});

test('assertionPower: gli structural si dichiarano nel detail anche su RED', () => {
  // Prima stavano sul SOLO ramo verde, e l'effetto era il rovescio dell'intenzione: nei tre
  // stati in cui l'utente ha piu' bisogno di sapere cosa NON e' stato guardato — red,
  // degraded, error — la dichiarazione spariva da ogni output emesso. Il `detail` e' l'unico
  // canale che attraversa shapeControl e la proiezione del loop.
  withTempApp({
    'src/tokens.mjs': "export const colors = { bg: 'x' };\n",
    'config.mjs': "import { colors } from './src/tokens.mjs';\nexport const config = { theme: { colors } };\n",
    'src/thing.mjs': 'function make() { return { k: 1 }; }\nexport const thing = make();\n',
    'src/mirror.mjs': "import { thing } from './thing.mjs';\nexport const mirror = thing;\n",
    'tests/t.test.mjs': [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { config } from '../config.mjs';",
      "import { colors } from '../src/tokens.mjs';",
      "import { thing } from '../src/thing.mjs';",
      "import { mirror } from '../src/mirror.mjs';",
      "test('inerte', () => { assert.deepEqual(config.theme.colors, colors); });",
      "test('structural', () => { assert.deepEqual(mirror, thing); });",
      '',
    ].join('\n'),
  }, (app) => {
    const r = assertionPower(TASK1, app, ['tests/t.test.mjs'], { runFileTpl: 'node --test {file}' });
    assert.equal(r.status, 'red');
    assert.match(r.detail, /INERTE/);
    assert.match(r.detail, /fuori portata dell'oracolo/);
    assert.match(r.detail, /initializer di 'thing'/);
    assert.equal(r.coverage.declared.length, 1);
  });
});

test('assertionPower: gli structural si dichiarano nel detail anche su DEGRADED', () => {
  // L'altra meta' della stessa correzione. Il target_test non ha alcun `test()`, quindi dopo
  // la neutralizzazione esegue ZERO test -> FAILURE -> degraded; accanto c'e' uno structural
  // (`= make()`), che prima spariva da ogni output proprio qui.
  withTempApp({
    ...SRC_ABX,
    'src/thing.mjs': 'function make() { return { k: 1 }; }\nexport const thing = make();\n',
    'src/mirror.mjs': "import { thing } from './thing.mjs';\nexport const mirror = thing;\n",
    'tests/t.test.mjs': [
      "import assert from 'node:assert/strict';",
      "import { A } from '../src/a.mjs';",
      "import { B } from '../src/b.mjs';",
      "import { thing } from '../src/thing.mjs';",
      "import { mirror } from '../src/mirror.mjs';",
      'assert.deepEqual(A, B);',
      'assert.deepEqual(mirror, thing);',
      '',
    ].join('\n'),
  }, (app) => {
    const r = assertionPower(TASK1, app, ['tests/t.test.mjs'], { runFileTpl: 'node --test {file}' });
    assert.equal(r.status, 'degraded');
    assert.match(r.detail, /guasto dell'oracolo/);
    assert.match(r.detail, /fuori portata dell'oracolo/);
    assert.match(r.detail, /initializer di 'thing'/);
  });
});

test("la rete su exit rimette i BYTE VERI dopo un ripristino fallito", () => {
  // build-discipline.md ora PROMETTE questa rete all'utente, e una promessa spedita senza
  // un test e' la stessa classe di difetto di IM-1. Si prova nell'unico modo in cui e'
  // osservabile: in un PROCESSO FIGLIO, perche' la rete gira su `exit` e il verdetto e' lo
  // stato del file DOPO che il processo e' morto.
  //
  // Il figlio registra il proprio handler di `exit` PRIMA di chiamare l'oracolo, cosi' gira
  // per primo (Node li esegue in ordine di registrazione) e toglie il read-only: e' cio'
  // che nella realta' fa il lock transitorio quando si rilascia. Poi l'handler dell'oracolo
  // riscrive i byte tenuti in PENDING. Se quei byte fossero quelli NEUTRALIZZATI, o se la
  // rete non esistesse, il file resterebbe guasto e questo test sarebbe rosso.
  withTempApp({
    'src/tokens.mjs': "export const colors = { bg: 'x' };\n",
    'config.mjs': "import { colors } from './src/tokens.mjs';\nexport const config = { theme: { colors } };\n",
    'tests/t.test.mjs': LOCKING_TEST,
  }, (app) => {
    const tokens = join(app, 'src', 'tokens.mjs');
    const before = readFileSync(tokens, 'utf8');
    const oracleUrl = new URL('./ac_assertion_power_check.mjs', import.meta.url).href;
    const child = [
      "import { chmodSync } from 'node:fs';",
      `const TOKENS = ${JSON.stringify(tokens)};`,
      "process.on('exit', () => { try { chmodSync(TOKENS, 0o644); } catch { /* ignore */ } });",
      `const { assertionPower } = await import(${JSON.stringify(oracleUrl)});`,
      `const r = assertionPower(${JSON.stringify(TASK1)}, ${JSON.stringify(app)}, ['tests/t.test.mjs'], { runFileTpl: 'node --test {file}' });`,
      'console.log(r.status);',
    ].join('\n');
    const res = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8' });
    try {
      // ANTI-VACUO: il figlio deve aver DAVVERO incontrato il ripristino fallito. Senza
      // questa riga il test sarebbe verde anche se l'oracolo non avesse mai mutato nulla —
      // il file sarebbe intatto per non essere mai stato toccato.
      assert.equal(String(res.stdout).trim(), 'error', `stderr: ${String(res.stderr).slice(0, 400)}`);
      assert.equal(readFileSync(tokens, 'utf8'), before);
    } finally {
      try { chmodSync(tokens, 0o644); } catch { /* ignore */ }
    }
  });
});
