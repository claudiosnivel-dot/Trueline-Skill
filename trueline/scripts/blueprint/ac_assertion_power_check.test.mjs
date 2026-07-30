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
