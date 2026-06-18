#!/usr/bin/env node
// detect_runner.test.mjs — test-runner dal manifest (SP-0, Task C5).
// Verifica: (1) un repo con package.json scripts.test -> present=true;
// (2) lista candidati dal manifest usata per arricchire la detection;
// (3) nessuna regressione con supabase-jsts (vitest/jest/node:test invariati).
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectRunner } from './detect_runner.mjs';

const results = [];
const check = (n, ok, d) => {
  results.push({ n, ok: Boolean(ok), d });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ` — ${d}` : ''}`);
};

// Helper: crea un repo temp con un package.json arbitrario.
function makePkgDir(pkg) {
  const d = mkdtempSync(join(tmpdir(), 'dr-'));
  writeFileSync(join(d, 'package.json'), JSON.stringify(pkg, null, 2));
  return d;
}

// ── Test 1: package.json con scripts.test non-placeholder → present=true ──────
{
  const dir = makePkgDir({ name: 'a', scripts: { test: 'vitest run' } });
  const r = detectRunner(dir);
  check('scripts.test vitest → present=true', r.present === true);
  check('scripts.test vitest → runner=vitest', r.runner === 'vitest');
  check('scripts.test vitest → degraded=false', r.degraded === false);
}

// ── Test 2: package.json con scripts.test jest → present=true ─────────────────
{
  const dir = makePkgDir({ name: 'b', scripts: { test: 'jest' } });
  const r = detectRunner(dir);
  check('scripts.test jest → present=true', r.present === true);
  check('scripts.test jest → runner=jest', r.runner === 'jest');
}

// ── Test 3: nessun runner riconosciuto (placeholder) → present=false, non degradato ──
{
  const dir = makePkgDir({ name: 'c', scripts: { test: 'echo "no test specified"' } });
  const r = detectRunner(dir);
  check('placeholder → present=false', r.present === false);
  check('placeholder → degraded=false (node:test impalcabile)', r.degraded === false);
}

// ── Test 4: nessun package.json → degraded=true ───────────────────────────────
{
  const d = mkdtempSync(join(tmpdir(), 'dr-empty-'));
  const r = detectRunner(d);
  check('no package.json → degraded=true', r.degraded === true);
  check('no package.json → present=false', r.present === false);
}

// ── Test 5: lista candidati dal manifest — candidato personalizzato riconosciuto ─
// Un manifest con detect:['mocha'] porta a rilevare mocha nello script test.
{
  const dir = makePkgDir({ name: 'd', scripts: { test: 'mocha --recursive' } });
  const manifest = { test_runner: { detect: ['mocha', 'vitest', 'jest', 'node:test'] } };
  const r = detectRunner(dir, manifest);
  check('manifest detect mocha → present=true', r.present === true);
  check('manifest detect mocha → runner=mocha', r.runner === 'mocha');
}

// ── Test 6: lista candidati dal manifest — candidato non in lista → non rilevato ─
// Un manifest con detect:['vitest'] NON rileva mocha (non in lista).
{
  const dir = makePkgDir({ name: 'e', scripts: { test: 'mocha --recursive' } });
  const manifest = { test_runner: { detect: ['vitest', 'jest', 'node:test'] } };
  const r = detectRunner(dir, manifest);
  check('manifest detect senza mocha → runner≠mocha', r.runner !== 'mocha');
  check('manifest detect senza mocha → present=false (fallback node:test)', r.present === false);
}

// ── Test 7: supabase-jsts manifest — nessuna regressione ──────────────────────
// Il manifest supabase-jsts ha detect:['vitest','jest','node:test'] — stesso
// comportamento del default (test di retro-compat).
{
  const manifest = { test_runner: { detect: ['vitest', 'jest', 'node:test'] } };

  // vitest
  const d1 = makePkgDir({ name: 'f', scripts: { test: 'vitest run' } });
  const r1 = detectRunner(d1, manifest);
  check('supabase-jsts manifest + vitest script → vitest', r1.runner === 'vitest');

  // jest
  const d2 = makePkgDir({ name: 'g', scripts: { test: 'jest' } });
  const r2 = detectRunner(d2, manifest);
  check('supabase-jsts manifest + jest script → jest', r2.runner === 'jest');

  // node:test
  const d3 = makePkgDir({ name: 'h', scripts: { test: 'node --test' } });
  const r3 = detectRunner(d3, manifest);
  check('supabase-jsts manifest + node:test script → node:test', r3.runner === 'node:test');
}

// ── Test 8: manifest senza test_runner → default invariato ───────────────────
{
  const dir = makePkgDir({ name: 'i', scripts: { test: 'vitest run' } });
  const manifestNoRunner = { id: 'other', oracles: {} };
  const r = detectRunner(dir, manifestNoRunner);
  check('manifest senza test_runner → default vitest rilevato', r.runner === 'vitest');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'OK' : 'FAIL'} — ${results.length - failed.length}/${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
