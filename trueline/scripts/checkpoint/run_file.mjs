// run_file.mjs — esegue UN file di test (oracolo d'accettazione AC, AT-1 Fase A).
// Due runner, via spawnSync ARRAY-ARGV (NIENTE shell:true), cwd=app, PATH+GO_BIN:
//   - `node --test {file}`: parsa il riassunto del test-runner per `testCount`/`passed`;
//   - `vitest run {file}` (VR-1): il vitest LOCALE del progetto, report JSON su file.
// Node ESM, solo built-in.
//
// NOTA sul formato dell'output (verificato su Node 25): quando `node --test` e'
// spawnato NON-TTY il reporter di default e' lo "spec" (righe `ℹ tests N`, `✔`/`✖`),
// non il TAP storico (`# tests N`, `ok`/`not ok`). Il parser gestisce ENTRAMBI i
// formati cosi' da restare robusto al reporter di default.
//
// FLOOR ANTI-VACUO: un file SENZA alcun `test()` viene comunque contato da node:test
// come 1 "test" implicito (il file stesso, mostrato col proprio PATH come nome). Quel
// wrapper implicito NON e' un test reale: lo sottraiamo, cosi' un file vuoto -> testCount 0.
//
// VITEST (VR-1, verificato con vitest 5.1.0). Il runner gira come `node <bin di vitest>`
// risolto dal package.json di <app>/node_modules/vitest: niente npx, niente .cmd (su
// Windows spawnSync('npx.cmd') senza shell da' EINVAL, e la shell mis-parserebbe i path
// con spazi). Il filtro e' il path ASSOLUTO con `/`: vitest confronta un filtro assoluto
// per PREFISSO, mentre uno relativo per SOTTOSTRINGA — `tests/a.test.ts` includerebbe
// anche `src/tests/a.test.ts`. Il report (`--reporter=json --outputFile`) va in una dir
// temporanea FUORI dal progetto, e si legge solo la voce del file target: `testCount` =
// test eseguiti (passed+failed; skipped/todo non contano). Un file che la config di
// vitest non include non compare nel report -> testCount 0 (lo dice il detail); un file
// senza test compare come suite fallita senza asserzioni -> testCount 0. In entrambi i
// casi il floor anti-vacuo a valle lo rende rosso, mai verde.
//
// QUALE RUNNER. Il template arriva dal progetto (resolveRunFile); il file puo' pero'
// dichiarare il proprio: chi importa da 'vitest' gira con vitest, chi importa
// 'node:test' gira con node --test. Senza import riconoscibile (vitest con `globals`)
// decide il template. Cosi' un progetto misto non manda un file node:test a vitest
// (che non vi troverebbe test) ne' un file vitest a node --test (dove l'import di
// vitest fallisce fuori dal suo runner).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, resolve } from 'node:path';

const GO_BIN = process.platform === 'win32'
  ? 'C:/Users/claud/go/bin'
  : '/c/Users/claud/go/bin';

const MAX_BUFFER = 32 * 1024 * 1024;
const NODE_TEST_RUN_FILE = 'node --test {file}';
export const VITEST_RUN_FILE = 'vitest run {file}';

const VITEST_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]vitest['"]/;
const NODE_TEST_IMPORT = /['"]node:test['"]/;

// Il template a livello di PROGETTO. Il `run_file` dichiarato dal manifest vince sempre
// (bit-invarianza dei pack che lo dichiarano). Altrimenti, se il manifest riconosce
// vitest tra i runner (`test_runner.detect`) e il progetto lo dichiara nel package.json,
// il template e' vitest. Nessuno dei due -> null: il controllo 4 resta sul ramo legacy.
export function resolveRunFile(appDir, manifest) {
  const tr = manifest && manifest.test_runner;
  if (!tr) return null;
  if (tr.run_file) return tr.run_file;
  const recognized = Array.isArray(tr.detect) && tr.detect.includes('vitest');
  return recognized && declaresDependency(appDir, 'vitest') ? VITEST_RUN_FILE : null;
}

function declaresDependency(appDir, name) {
  try {
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    return Boolean((pkg.dependencies && pkg.dependencies[name]) || (pkg.devDependencies && pkg.devDependencies[name]));
  } catch { return false; }
}

// Escapa i metacaratteri regex.
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pattern del percorso relativo `file`: segmenti escapati, separatore `/` o `\`
// (node:test echeggia il path-arg normalizzato al separatore dell'OS).
function pathPattern(file) {
  return file.split(/[\\/]/).filter(Boolean).map(escapeRe).join('[\\\\/]');
}

// Costruisce argv dal template sostituendo {file}.
// `node` viene mappato su process.execPath (stesso binario, deterministico; come checkpoint.mjs).
function buildArgv(template, file) {
  const parts = template.trim().split(/\s+/).map((p) => (p === '{file}' ? file : p));
  let cmd = parts[0];
  if (cmd === 'node') cmd = process.execPath;
  return { cmd, args: parts.slice(1) };
}

function pickRunner(appDir, file, template) {
  const src = readFileSync(join(appDir, file), 'utf8');
  const tplIsVitest = template.trim().split(/\s+/)[0] === 'vitest';
  if (VITEST_IMPORT.test(src)) {
    return { kind: 'vitest', why: tplIsVitest ? '' : ' (runner vitest: il file importa da vitest)' };
  }
  if (tplIsVitest && NODE_TEST_IMPORT.test(src)) {
    return { kind: 'node', template: NODE_TEST_RUN_FILE, why: ' (runner node:test: il file importa node:test)' };
  }
  return tplIsVitest ? { kind: 'vitest', why: '' } : { kind: 'node', template, why: '' };
}

export function runTargetFile(appDir, file, template) {
  if (!existsSync(join(appDir, file))) {
    return { error: true, testCount: 0, passed: false, detail: `file assente: ${file}` };
  }
  const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };
  // Se IL NOSTRO processo gira gia' sotto `node --test`, node:test imposta
  // NODE_TEST_CONTEXT: il figlio lo erediterebbe e SALTEREBBE l'esecuzione
  // ("run() is being called recursively"). Lo togliamo: il file target deve
  // essere eseguito come run di test INDIPENDENTE e pulito.
  delete env.NODE_TEST_CONTEXT;
  const runner = pickRunner(appDir, file, template);
  if (runner.kind === 'vitest') return runVitest(appDir, file, env, runner.why);
  return runNodeTest(appDir, file, runner.template, env, runner.why);
}

function runNodeTest(appDir, file, template, env, why) {
  const { cmd, args } = buildArgv(template, file);
  const res = spawnSync(cmd, args, { cwd: appDir, encoding: 'utf8', env, maxBuffer: MAX_BUFFER });
  if (res.error) return { error: true, testCount: 0, passed: false, detail: `spawn: ${res.error.message}` };

  const out = `${res.stdout || ''}\n${res.stderr || ''}`;
  const num = (re) => { const x = out.match(re); return x ? Number(x[1]) : null; };

  // Riassunto: spec usa "ℹ tests N"/"ℹ fail N", TAP usa "# tests N"/"# fail N".
  const summaryTests = num(/^[#ℹ]\s*tests\s+(\d+)/m) ?? 0;
  const failCount = num(/^[#ℹ]\s*fail\s+(\d+)/m) ?? (res.status === 0 ? 0 : 1);

  // Rileva il "test" implicito a livello di file (presente SOLO quando il file non ha
  // alcun test() reale): in quel caso node:test riporta il PATH del file come nome.
  // spec: `✔ <file> (Nms)` / `✖ ...`; TAP: `ok N - <file>` o `# Subtest: <file>`.
  // `<file>` = il path-arg relativo passato, eventualmente con un prefisso di dir.
  const pp = pathPattern(file);
  const implicitFileTest = (
    new RegExp(`^[✔✖]\\s+(?:.*[\\\\/])?${pp}\\s*\\(`, 'm').test(out) ||
    new RegExp(`^(?:ok|not ok)\\s+\\d+\\s+-\\s+(?:.*[\\\\/])?${pp}\\s*$`, 'm').test(out) ||
    new RegExp(`^#\\s*Subtest:\\s+(?:.*[\\\\/])?${pp}\\s*$`, 'm').test(out)
  );

  const testCount = Math.max(0, summaryTests - (implicitFileTest ? 1 : 0));
  const passed = res.status === 0 && failCount === 0;
  return {
    error: false,
    testCount,
    passed,
    detail: `exit=${res.status} tests=${testCount} fail=${failCount}${why}`,
  };
}

function vitestBin(appDir) {
  const dir = resolve(appDir, 'node_modules', 'vitest');
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && pkg.bin.vitest;
    const bin = rel ? join(dir, rel) : null;
    return bin && existsSync(bin) ? bin : null;
  } catch { return null; }
}

// Confronto dei path del report: `/` ovunque, e senza distinzione di maiuscole solo dove
// il filesystem non la fa.
function samePath(a, b) {
  const n = (p) => {
    const s = String(p || '').replace(/\\/g, '/');
    return process.platform === 'win32' ? s.toLowerCase() : s;
  };
  return n(a) === n(b);
}

function runVitest(appDir, file, env, why) {
  const bin = vitestBin(appDir);
  if (!bin) {
    return {
      error: true, testCount: 0, passed: false,
      detail: `vitest non installato in ${join(appDir, 'node_modules')}: serve npm install nel progetto${why}`,
    };
  }
  const abs = resolve(appDir, file).replace(/\\/g, '/');
  const outDir = mkdtempSync(join(tmpdir(), 'trueline-vitest-'));
  const reportPath = join(outDir, 'report.json');
  try {
    const res = spawnSync(
      process.execPath,
      [bin, 'run', abs, '--reporter=json', `--outputFile=${reportPath}`, '--passWithNoTests'],
      { cwd: appDir, encoding: 'utf8', env, maxBuffer: MAX_BUFFER },
    );
    if (res.error) return { error: true, testCount: 0, passed: false, detail: `spawn: ${res.error.message}` };
    let report;
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')); }
    catch {
      const tail = String(res.stderr || res.stdout || '').trim().slice(-300);
      return { error: true, testCount: 0, passed: false, detail: `vitest exit=${res.status} senza report JSON: ${tail}${why}` };
    }
    const results = Array.isArray(report.testResults) ? report.testResults : [];
    const mine = results.filter((r) => samePath(r.name, abs));
    const others = results.length - mine.length;
    const othersNote = others > 0 ? `; il filtro ha incluso anche altri ${others} file` : '';
    if (mine.length === 0) {
      return {
        error: false, testCount: 0, passed: false,
        detail: `vitest exit=${res.status} tests=0: file non incluso dalla configurazione di vitest${othersNote}${why}`,
      };
    }
    const assertions = mine.flatMap((r) => (Array.isArray(r.assertionResults) ? r.assertionResults : []));
    const testCount = assertions.filter((a) => a.status === 'passed' || a.status === 'failed').length;
    const failCount = assertions.filter((a) => a.status === 'failed').length;
    const suiteFailed = mine.some((r) => r.status !== 'passed');
    return {
      error: false,
      testCount,
      passed: res.status === 0 && failCount === 0 && !suiteFailed,
      detail: `vitest exit=${res.status} tests=${testCount} fail=${failCount}${suiteFailed && failCount === 0 ? ' (suite fallita)' : ''}${othersNote}${why}`,
    };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
