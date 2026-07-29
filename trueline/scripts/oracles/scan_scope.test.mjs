// scan_scope.test.mjs — unit test del MODULO scan_scope (PLAN 2026-07-28 §3.1).
// Non prova il wiring (checkpoint/baseline/loop): prova il CONTRATTO del modulo,
// cioe' i punti dove questa logica si sbaglia in silenzio.
//
// Eseguibile con: node --test trueline/scripts/oracles/scan_scope.test.mjs
// Solo built-in (node:test, node:assert, node:fs, node:os, node:path).
//
// I FATTI asseriti (mai un parere): conteggi, identita' di oggetti, path risolti,
// eccezioni lanciate. Ogni gruppo copre uno dei modi noti di sbagliare:
//   1  default vuoto = BIT-invarianza      (l'invariante che tiene m5 56/56)
//   2  unione, non sovrascrittura + provenienza
//   3  matcher: prefisso-dir, `*`, `**`, e NIENTE regex utente
//   4  path: assoluti gitleaks + backslash Windows -> relativo POSIX
//   5  .trueline/scan-scope.json: assente ok, rotto/senza reason -> ERRORE
//   6  coverage: ogni pattern applicato dichiarato, anche con matched=0
//   7  protect: il file sotto fix non e' escludibile (niente `verified` gratis)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  DEFAULT_SCAN_EXCLUDE,
  PROJECT_SCOPE_FILE,
  SCAN_SCOPE_SOURCES,
  resolveScanScope,
  applyScanScope,
  scanScopeCoverage,
  readProjectScanScope,
  relativeScanPath,
  findingScanPath,
} from './scan_scope.mjs';

// --- helper -------------------------------------------------------------------

// Progetto temporaneo isolato (H-1: radice temp, mai dentro il repo).
function tmpProject(scopeJson) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-scope-'));
  if (scopeJson !== undefined) {
    mkdirSync(join(dir, '.trueline'), { recursive: true });
    const body = typeof scopeJson === 'string' ? scopeJson : JSON.stringify(scopeJson, null, 2);
    writeFileSync(join(dir, '.trueline', 'scan-scope.json'), body, 'utf8');
  }
  return dir;
}
function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}
// Finding nella forma NATIVA gitleaks (il modulo lavora prima della normalizzazione).
function gl(file, ruleId = 'generic-api-key') {
  return { RuleID: ruleId, File: file, StartLine: 1, Match: 'REDACTED', Secret: 'REDACTED' };
}

// =============================================================================
// 1) DEFAULT VUOTO = BIT-INVARIANZA
// =============================================================================

test('DEFAULT_SCAN_EXCLUDE e\' vuoto e congelato (bit-invarianza per costruzione)', () => {
  assert.ok(Array.isArray(DEFAULT_SCAN_EXCLUDE));
  assert.equal(DEFAULT_SCAN_EXCLUDE.length, 0);
  assert.ok(Object.isFrozen(DEFAULT_SCAN_EXCLUDE), 'il default deve essere immutabile');
});

test('no-declaration: resolveScanScope senza dichiarazioni -> zero pattern', () => {
  const dir = tmpProject(); // nessun .trueline/scan-scope.json
  try {
    const scope = resolveScanScope(dir);
    assert.deepEqual(scope.patterns, []);
    assert.deepEqual(scope.sources, { caller: 0, project: 0, manifest: 0 });
    assert.equal(scope.project_reason, null);
  } finally { cleanup(dir); }
});

test('no-declaration:bit-invariant — applyScanScope non esclude NULLA e conserva ordine e identita\'', () => {
  const dir = tmpProject();
  try {
    const findings = [gl('src/a.ts'), gl('dist/b.js'), gl('.next/c.js'), gl('backups/d.sql')];
    const scope = resolveScanScope(dir);
    const { kept, excluded } = applyScanScope(findings, scope, dir);
    assert.equal(excluded.length, 0, 'senza dichiarazioni non si esclude niente');
    assert.equal(kept.length, findings.length);
    for (let i = 0; i < findings.length; i += 1) {
      assert.equal(kept[i], findings[i], 'stesso oggetto, stessa posizione');
    }
    const cov = scanScopeCoverage(scope, excluded);
    assert.deepEqual(cov, { excluded_patterns: [], excluded_total: 0 });
  } finally { cleanup(dir); }
});

test('no-declaration:bit-invariant — anche uno scope malformato/assente non esclude', () => {
  const findings = [gl('dist/a.js')];
  for (const scope of [undefined, null, {}, { patterns: [] }, { patterns: 'nope' }]) {
    const { kept, excluded } = applyScanScope(findings, scope, '/proj');
    assert.equal(excluded.length, 0);
    assert.equal(kept.length, 1);
    assert.equal(kept[0], findings[0]);
  }
});

// =============================================================================
// 2) UNIONE, NON SOVRASCRITTURA — e ogni pattern porta la sua provenienza
// =============================================================================

test('union: caller + project + manifest si SOMMANO (nessuna fonte ne rimpiazza un\'altra)', () => {
  const dir = tmpProject({ exclude: ['backups/**'], reason: 'dump di dati, non codice d\'autore' });
  try {
    const scope = resolveScanScope(dir, {
      exclude: ['tmp/**'],
      manifest: { oracles: { secret: { exclude: ['.next/**', 'dist/**'] } } },
    });
    assert.equal(scope.patterns.length, 4, 'unione: 1 caller + 1 project + 2 manifest');
    assert.deepEqual(scope.sources, { caller: 1, project: 1, manifest: 2 });
    assert.deepEqual(
      scope.patterns.map((p) => [p.pattern, p.source]),
      [['tmp/**', 'caller'], ['backups/**', 'project'], ['.next/**', 'manifest'], ['dist/**', 'manifest']],
      'ordine = precedenza; ogni pattern porta la sua provenienza',
    );
    // La conoscenza d'ecosistema NON viene rimossa da una dichiarazione di progetto.
    const findings = [gl('tmp/x'), gl('backups/d.sql'), gl('.next/c.js'), gl('dist/b.js'), gl('src/a.ts')];
    const { kept, excluded } = applyScanScope(findings, scope, dir);
    assert.deepEqual(kept.map((f) => f.File), ['src/a.ts']);
    assert.equal(excluded.length, 4);
  } finally { cleanup(dir); }
});

test('union: le provenienze appartengono al vocabolario dichiarato', () => {
  const dir = tmpProject({ exclude: ['backups/**'], reason: 'dump' });
  try {
    const scope = resolveScanScope(dir, {
      exclude: ['tmp/**'],
      manifest: { oracles: { secret: { exclude: ['dist/**'] } } },
    });
    for (const p of scope.patterns) {
      assert.ok(SCAN_SCOPE_SOURCES.includes(p.source), `source ignota: ${p.source}`);
    }
  } finally { cleanup(dir); }
});

test('union: pattern duplicato fra fonti -> contato UNA volta, attribuito alla fonte di precedenza', () => {
  const dir = tmpProject({ exclude: ['dist/**'], reason: 'artefatti di build' });
  try {
    const scope = resolveScanScope(dir, {
      exclude: ['dist/**'],
      manifest: { oracles: { secret: { exclude: ['dist/**'] } } },
    });
    assert.equal(scope.patterns.length, 1);
    assert.equal(scope.patterns[0].source, 'caller');
    assert.deepEqual(scope.sources, { caller: 1, project: 0, manifest: 0 });
    // Il totale della coverage non deve raddoppiare per un duplicato.
    const { excluded } = applyScanScope([gl('dist/a.js')], scope, dir);
    assert.equal(scanScopeCoverage(scope, excluded).excluded_total, 1);
  } finally { cleanup(dir); }
});

test('manifest: si legge oracles.secret.exclude; una forma non-array e\' un errore esplicito', () => {
  const scope = resolveScanScope(null, { manifest: { oracles: { secret: { exclude: ['**/*.map'] } } } });
  assert.deepEqual(scope.sources, { caller: 0, project: 0, manifest: 1 });
  // Manifest senza la chiave: nessun pattern, nessun errore (additivo).
  assert.equal(resolveScanScope(null, { manifest: { oracles: { rls: { scan: ['x'] } } } }).patterns.length, 0);
  assert.throws(
    () => resolveScanScope(null, { manifest: { oracles: { secret: { exclude: 'dist/**' } } } }),
    /deve essere un array/,
  );
});

// =============================================================================
// 3) MATCHER — prefisso-directory, `*`, `**`, e nessuna regex utente
// =============================================================================

function matches(pattern, path, projectDir = '/proj') {
  const scope = resolveScanScope(null, { exclude: [pattern] });
  const { excluded } = applyScanScope([gl(path)], scope, projectDir);
  return excluded.length === 1;
}

test('matcher: prefisso-directory "dist/" prende tutto sotto dist/ e nulla di simile', () => {
  assert.ok(matches('dist/', 'dist/a.js'));
  assert.ok(matches('dist/', 'dist/assets/deep/b.js'));
  assert.ok(!matches('dist/', 'distant/a.js'), '"distant/" non e\' "dist/"');
  assert.ok(!matches('dist/', 'src/dist/a.js'), 'il pattern e\' ancorato alla radice del progetto');
  assert.ok(!matches('dist/', 'dist'), 'un FILE chiamato dist non e\' la directory dist/');
});

test('matcher: "*" NON attraversa "/"', () => {
  assert.ok(matches('src/*.ts', 'src/a.ts'));
  assert.ok(!matches('src/*.ts', 'src/lib/a.ts'), '* non deve scavalcare il separatore');
  assert.ok(!matches('*.ts', 'src/a.ts'));
  assert.ok(matches('*.ts', 'a.ts'));
});

test('matcher: "**" attraversa "/" e "**/" vale anche zero segmenti', () => {
  assert.ok(matches('.next/**', '.next/static/chunks/x.js'));
  assert.ok(matches('.next/**', '.next/a.js'));
  assert.ok(!matches('.next/**', 'app/.next/a.js'), 'ancorato alla radice');
  assert.ok(matches('**/*.map', 'dist/assets/index-abc.js.map'));
  assert.ok(matches('**/*.map', 'a.map'), '"**/" deve valere anche zero segmenti (file in radice)');
  assert.ok(matches('**/database.types.ts', 'src/lib/database.types.ts'), 'classe B: codegen tracciato in src/');
  assert.ok(matches('**/database.types.ts', 'database.types.ts'));
  assert.ok(!matches('**/database.types.ts', 'src/lib/database.types.tsx'));
});

test('matcher: match esatto per un pattern senza wildcard', () => {
  assert.ok(matches('src/config.ts', 'src/config.ts'));
  assert.ok(!matches('src/config.ts', 'src/config.ts.bak'));
  assert.ok(!matches('src/config.ts', 'other/src/config.ts'));
});

test('matcher: NIENTE regex utente — i metacaratteri sono letterali', () => {
  // Se il pattern finisse in una RegExp non escapata, "src/(a|b).ts" escluderebbe
  // src/a.ts: sarebbe un canale per iniettare comportamento nel motore.
  assert.ok(!matches('src/(a|b).ts', 'src/a.ts'));
  assert.ok(matches('src/(a|b).ts', 'src/(a|b).ts'));
  assert.ok(!matches('a.ts', 'axts'), '"." e\' un punto, non "un carattere qualsiasi"');
  assert.ok(!matches('src/a+.ts', 'src/aaa.ts'));
  assert.ok(!matches('src/.*', 'src/a.ts'), '".*" non e\' una regex');
  assert.ok(!matches('^src/a.ts$', 'src/a.ts'));
});

test('matcher: pattern malformati RIFIUTATI con errore esplicito (non ignorati)', () => {
  assert.throws(() => resolveScanScope(null, { exclude: [''] }), /pattern vuoto/);
  assert.throws(() => resolveScanScope(null, { exclude: ['/etc/passwd'] }), /devono essere relativi/);
  assert.throws(() => resolveScanScope(null, { exclude: ['C:/Windows/**'] }), /devono essere relativi/);
  assert.throws(() => resolveScanScope(null, { exclude: ['../altro/**'] }), /esce dal progetto/);
  assert.throws(() => resolveScanScope(null, { exclude: ['src/../../x'] }), /esce dal progetto/);
  assert.throws(() => resolveScanScope(null, { exclude: ['!src/a.ts'] }), /negazione non e' supportata/);
  assert.throws(() => resolveScanScope(null, { exclude: [42] }), /atteso una stringa/);
});

// =============================================================================
// 4) PATH — assoluti (gitleaks working-tree) e backslash (Windows)
// =============================================================================

test('path: gitleaks emette path ASSOLUTI -> il match e\' sul relativo a projectDir', () => {
  const proj = resolve('/proj/app');
  const scope = resolveScanScope(null, { exclude: ['dist/**'] });
  const abs = resolve(proj, 'dist/assets/x.js');
  const { kept, excluded } = applyScanScope([gl(abs), gl(resolve(proj, 'src/a.ts'))], scope, proj);
  assert.equal(excluded.length, 1);
  assert.equal(excluded[0].path, 'dist/assets/x.js', 'path relativo POSIX');
  assert.equal(kept.length, 1);
});

test('path: separatori Windows normalizzati a "/" (altrimenti non si escluderebbe nulla)', () => {
  const proj = resolve('/proj/app');
  const scope = resolveScanScope(null, { exclude: ['dist/'] });
  // Forma RELATIVA con backslash: vale su ogni piattaforma.
  const input = [gl('dist\\assets\\x.js')];
  const attesi = ['dist/assets/x.js'];
  // Forma ASSOLUTA con backslash: solo su win32 e' un path assoluto (su POSIX il
  // backslash e' un carattere di nome file legittimo, non un separatore).
  if (process.platform === 'win32') {
    input.push(gl(`${proj}\\dist\\assets\\y.js`));
    attesi.push('dist/assets/y.js');
  }
  const { excluded } = applyScanScope(input, scope, proj);
  assert.equal(excluded.length, attesi.length, 'i backslash devono essere normalizzati prima del match');
  assert.deepEqual(excluded.map((e) => e.path), attesi);
});

// NB (2026-07-29): questi due test usavano `**` come "il pattern piu' aggressivo
// possibile". `**` e' ora RIFIUTATO (escluderebbe l'intero progetto: e' l'oracolo
// spento, non un confine — vedi il test dedicato piu' sotto). Il pattern piu'
// aggressivo AMMESSO che serve qui e' `**/*.js`: prende qualunque `.js` a qualunque
// profondita', che e' esattamente la forma dei due path sotto esame. La proprieta'
// provata non cambia: fuori dal progetto, e senza path, non si esclude MAI.
test('path: un file FUORI da projectDir non e\' escludibile (si tiene)', () => {
  const proj = resolve('/proj/app');
  const scope = resolveScanScope(null, { exclude: ['**/*.js'] });
  const outside = resolve('/proj/altro/dist/x.js');
  const { kept, excluded } = applyScanScope([gl(outside)], scope, proj);
  assert.equal(excluded.length, 0);
  assert.equal(kept.length, 1);
  assert.equal(relativeScanPath(outside, proj), null);
});

test('path: un finding senza path utilizzabile viene TENUTO (mai perso in silenzio)', () => {
  const scope = resolveScanScope(null, { exclude: ['**/*.js'] });
  const orfani = [{ RuleID: 'x' }, { File: '' }, { File: null }, {}];
  const { kept, excluded } = applyScanScope(orfani, scope, '/proj');
  assert.equal(excluded.length, 0);
  assert.equal(kept.length, orfani.length);
  assert.equal(findingScanPath({ RuleID: 'x' }, '/proj'), null);
});

// --- Guardie sull'INPUT NON FIDATO (i pattern arrivano dal repo OSPITE) -------

test('pattern: un CATCH-ALL e\' rifiutato — spegnere l\'oracolo non e\' un confine', () => {
  // Riconoscimento PER COMPORTAMENTO, non per testo: tutte le scritture equivalenti
  // cadono, non solo la stringa "**".
  for (const p of ['**', '**/**', './**', '**/*']) {
    assert.throws(
      () => resolveScanScope(null, { exclude: [p] }),
      /escluderebbe l'INTERO progetto/,
      `il catch-all "${p}" doveva essere rifiutato`,
    );
  }
  // Aggressivo ma MIRATO: resta una scelta del progetto, dichiarata nella coverage.
  assert.equal(resolveScanScope(null, { exclude: ['**/*.js'] }).patterns.length, 1);
  assert.equal(resolveScanScope(null, { exclude: ['*/**'] }).patterns.length, 1);
});

test('pattern: normalizzazione SIMMETRICA a quella del path', () => {
  // `relativeScanPath` normalizza il PATH; se il PATTERN non fosse normalizzato allo
  // stesso modo, `./dist/**` sarebbe accettato e non matcherebbe MAI: una copertura
  // che il progetto crede attiva e non c'e' (L-COL-006).
  const m = (pat, file) => applyScanScope(
    [{ File: file }], resolveScanScope(null, { exclude: [pat] }), '/proj',
  ).excluded.length === 1;
  assert.equal(m('./dist/**', 'dist/a.js'), true, '"./dist/**" deve matchare come "dist/**"');
  assert.equal(m('a//b', 'a/b'), true, 'i separatori ripetuti vanno collassati');
  assert.equal(m('a/./b', 'a/b'), true, 'il segmento "." va rimosso');
  assert.equal(m('src/**', 'dist/a.js'), false, 'la normalizzazione non allarga il match');
});

test('pattern: i tetti anti-backtracking sono ESPLICITI, non silenziosi', () => {
  // Input non fidato: `**` compila in `.*` e piu' `**` alternati a letterali fanno
  // esplodere il backtracking (misurato: 4 `**` su un path di 400 char -> 1.7s).
  assert.throws(
    () => resolveScanScope(null, { exclude: ['**a**a**a**a**b'] }),
    /troppi `\*\*`/,
  );
  assert.throws(
    () => resolveScanScope(null, { exclude: ['a'.repeat(600)] }),
    /pattern troppo lungo/,
  );
  // Il tetto non tocca l'uso reale: i pattern del manifest hanno 1-2 `**`.
  assert.equal(resolveScanScope(null, { exclude: ['**/src/**/*.test.*'] }).patterns.length, 1);
});

test('path: si accetta anche la forma normalizzata (location.file) oltre a File', () => {
  const scope = resolveScanScope(null, { exclude: ['dist/**'] });
  const { excluded } = applyScanScope(
    [{ location: { file: 'dist/a.js' } }, { path: 'dist/b.js' }, { file: 'dist/c.js' }],
    scope, '/proj',
  );
  assert.equal(excluded.length, 3);
});

// =============================================================================
// 5) .trueline/scan-scope.json — assente OK, rotto/senza reason RIFIUTATO
// =============================================================================

test('project-scope: file ASSENTE e\' normale (nessun errore, nessun pattern)', () => {
  const dir = tmpProject();
  try {
    const r = readProjectScanScope(dir);
    assert.equal(r.present, false);
    assert.deepEqual(r.exclude, []);
    assert.equal(r.reason, null);
    assert.doesNotThrow(() => resolveScanScope(dir));
  } finally { cleanup(dir); }
});

test('project-scope:applied — exclude + reason validi -> pattern con source "project" e reason', () => {
  const dir = tmpProject({ exclude: ['backups/**'], reason: 'dump di dati, non codice d\'autore' });
  try {
    const scope = resolveScanScope(dir);
    assert.equal(scope.patterns.length, 1);
    assert.equal(scope.patterns[0].source, 'project');
    assert.equal(scope.patterns[0].reason, 'dump di dati, non codice d\'autore');
    assert.equal(scope.project_reason, 'dump di dati, non codice d\'autore');
    const { kept, excluded } = applyScanScope(
      [gl('backups/remote_data_1.sql'), gl('src/a.ts')], scope, dir,
    );
    assert.deepEqual(excluded.map((e) => e.path), ['backups/remote_data_1.sql']);
    assert.deepEqual(kept.map((f) => f.File), ['src/a.ts']);
  } finally { cleanup(dir); }
});

test('project-scope:reason-required — esclusione senza reason RIFIUTATA, non ignorata', () => {
  for (const bad of [
    { exclude: ['backups/**'] },
    { exclude: ['backups/**'], reason: '' },
    { exclude: ['backups/**'], reason: '   ' },
    { exclude: ['backups/**'], reason: 42 },
  ]) {
    const dir = tmpProject(bad);
    try {
      assert.throws(() => resolveScanScope(dir), /reason.*obbligatorio/s,
        `atteso rifiuto per ${JSON.stringify(bad)}`);
    } finally { cleanup(dir); }
  }
});

test('project-scope: exclude VUOTO senza reason e\' ammesso (non c\'e\' nulla da motivare)', () => {
  const dir = tmpProject({ exclude: [] });
  try {
    const scope = resolveScanScope(dir);
    assert.deepEqual(scope.patterns, []);
  } finally { cleanup(dir); }
});

test('project-scope: file MALFORMATO -> errore esplicito (mai un\'esclusione creduta e assente)', () => {
  const cases = [
    ['{ non json', /non e' JSON valido/],
    ['[]', /atteso un oggetto JSON/],
    ['"stringa"', /atteso un oggetto JSON/],
    ['null', /atteso un oggetto JSON/],
    ['{"reason":"x"}', /"exclude" mancante/],
    ['{"exclude":"backups\\/**","reason":"x"}', /"exclude" deve essere un array/],
    ['{"exclude":[7],"reason":"x"}', /atteso una stringa/],
    ['{"exclude":["/abs/**"],"reason":"x"}', /devono essere relativi/],
  ];
  for (const [body, re] of cases) {
    const dir = tmpProject(body);
    try {
      assert.throws(() => resolveScanScope(dir), re, `atteso rifiuto per: ${body}`);
    } finally { cleanup(dir); }
  }
});

// =============================================================================
// 6) COVERAGE — ogni pattern applicato dichiarato, anche a matched 0
// =============================================================================

test('coverage:declared — ogni pattern con pattern/source/matched, e il totale', () => {
  const dir = tmpProject({ exclude: ['backups/**'], reason: 'dump di dati' });
  try {
    const scope = resolveScanScope(dir, {
      exclude: ['tmp/**'],
      manifest: { oracles: { secret: { exclude: ['dist/**', '**/database.types.ts'] } } },
    });
    const findings = [
      gl('dist/a.js'), gl('dist/b.js'), gl('dist/c.js'),
      gl('src/lib/database.types.ts'),
      gl('backups/x.sql'), gl('backups/y.sql'),
      gl('src/app.ts'),
    ];
    const { kept, excluded } = applyScanScope(findings, scope, dir);
    assert.deepEqual(kept.map((f) => f.File), ['src/app.ts']);

    const cov = scanScopeCoverage(scope, excluded);
    assert.equal(cov.excluded_total, 6);
    assert.deepEqual(cov.excluded_patterns, [
      // Pattern dichiarato che NON matcha nulla: riportato lo stesso.
      { pattern: 'tmp/**', source: 'caller', matched: 0 },
      { pattern: 'backups/**', source: 'project', matched: 2, reason: 'dump di dati' },
      { pattern: 'dist/**', source: 'manifest', matched: 3 },
      { pattern: '**/database.types.ts', source: 'manifest', matched: 1 },
    ]);
    // Il totale dei matched coincide col numero di finding soppressi: nessun
    // finding contato due volte, nessuno sparito senza attribuzione.
    const somma = cov.excluded_patterns.reduce((a, r) => a + r.matched, 0);
    assert.equal(somma, cov.excluded_total);
  } finally { cleanup(dir); }
});

test('coverage: un finding coperto da PIU\' pattern e\' attribuito al PRIMO (contato una volta)', () => {
  const scope = resolveScanScope(null, { exclude: ['dist/**', '**/*.js'] });
  const { excluded } = applyScanScope([gl('dist/a.js')], scope, '/proj');
  const cov = scanScopeCoverage(scope, excluded);
  assert.equal(cov.excluded_total, 1);
  assert.deepEqual(cov.excluded_patterns, [
    { pattern: 'dist/**', source: 'caller', matched: 1 },
    { pattern: '**/*.js', source: 'caller', matched: 0 },
  ]);
});

test('coverage: scope vuoto -> dichiarazione vuota (nessun rumore nella coverage)', () => {
  assert.deepEqual(scanScopeCoverage({ patterns: [] }, []), { excluded_patterns: [], excluded_total: 0 });
  assert.deepEqual(scanScopeCoverage(null), { excluded_patterns: [], excluded_total: 0 });
});

// =============================================================================
// 7) PROTECT — il file sotto fix non e' escludibile (niente `verified` gratis)
// =============================================================================

test('loop:seed-file-never-excluded — il file protetto resta scansionato anche se il pattern lo prende', () => {
  const proj = resolve('/proj/app');
  const scope = resolveScanScope(null, { exclude: ['src/**'] });
  const findings = [gl('src/lib/config.ts'), gl('src/other.ts')];
  const { kept, excluded } = applyScanScope(findings, scope, proj, { protect: ['src/lib/config.ts'] });
  assert.deepEqual(kept.map((f) => f.File), ['src/lib/config.ts'],
    'il file sotto fix non e\' escludibile: il loop non deve poter timbrare verified senza fix');
  assert.deepEqual(excluded.map((e) => e.path), ['src/other.ts']);
});

test('loop:seed-file-never-excluded — protect accetta anche un path ASSOLUTO', () => {
  const proj = resolve('/proj/app');
  const scope = resolveScanScope(null, { exclude: ['src/**'] });
  const { kept } = applyScanScope([gl('src/lib/config.ts')], scope, proj, {
    protect: [resolve(proj, 'src/lib/config.ts')],
  });
  assert.equal(kept.length, 1);
});

test('protect assente/vuoto non cambia il comportamento', () => {
  const scope = resolveScanScope(null, { exclude: ['src/**'] });
  for (const opts of [undefined, {}, { protect: [] }, { protect: null }]) {
    const { kept, excluded } = applyScanScope([gl('src/a.ts')], scope, '/proj', opts);
    assert.equal(kept.length, 0);
    assert.equal(excluded.length, 1);
  }
});

// Costanti esportate: il vocabolario non si ricopia a mano nei chiamanti.
test('costanti esportate stabili', () => {
  assert.equal(PROJECT_SCOPE_FILE, '.trueline/scan-scope.json');
  assert.deepEqual([...SCAN_SCOPE_SOURCES], ['caller', 'project', 'manifest']);
});
