// normalize.a2a.test.mjs — normalizer A2a (jscpd/cycle/twin) -> finding validi.
// Ogni finding DEVE conformarsi a finding.schema.json (validateMany). Il fingerprint
// e' ANCORATO al CONTENUTO: frammento normalizzato (dup), set-moduli canonicalizzato
// e ordinato invariante alla rotazione (cycle), coppia-dir ordinata (twin).
// NB: 'cycle' (madge) sostituisce 'depcruise' (cambio ondata 1: dependency-cruiser
// ispezionava 0 moduli sui .ts reali su Node 25).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './normalize.mjs';
import { validateMany } from './validate_finding.mjs';

const OPTS = { runId: 'a2a', createdAt: '1970-01-01T00:00:00.000Z', scope: 'working-tree' };

test('normalizeJscpd: duplicate -> finding duplication valido, fingerprint sul contenuto', () => {
  const native = { oracle: 'jscpd', minTokens: 50, duplicates: [{
    firstFile: { name: 'src/a.ts', startLoc: { line: 10 }, endLoc: { line: 30 } },
    secondFile: { name: 'src/b.ts', startLoc: { line: 5 }, endLoc: { line: 25 } },
    lines: 20, tokens: 60, fragment: 'const x = compute();' }] };
  const f = normalize('jscpd', native, OPTS);
  assert.equal(f.length, 1);
  assert.equal(f[0].category, 'duplication');
  assert.equal(f[0].severity, 'LOW');
  assert.equal(f[0].source_oracle.oracle, 'jscpd');
  const v = validateMany(f);
  assert.ok(v.ok, JSON.stringify(v.errors));
  // fingerprint STABILE sul contenuto: stesso fragment+path -> stesso fp anche
  // con run_id diverso.
  const f2 = normalize('jscpd', native, { ...OPTS, runId: 'diverso' });
  assert.equal(f[0].fingerprint, f2[0].fingerprint);
});

test('normalizeCycle: cycle -> finding architecture valido, fingerprint invariante alla rotazione', () => {
  const native = { oracle: 'cycle', tool: 'madge', modulesScanned: 2, cycles: [{ modules: ['src/a.ts', 'src/b.ts'] }] };
  const f = normalize('cycle', native, OPTS);
  assert.equal(f.length, 1);
  assert.equal(f[0].category, 'architecture');
  assert.equal(f[0].source_oracle.oracle, 'cycle');
  const v = validateMany(f);
  assert.ok(v.ok, JSON.stringify(v.errors));
  // fingerprint invariante alla ROTAZIONE del ciclo (set-moduli canonicalizzato).
  const rotated = normalize('cycle', { oracle: 'cycle', tool: 'madge', modulesScanned: 2, cycles: [{ modules: ['src/b.ts', 'src/a.ts'] }] }, OPTS);
  assert.equal(f[0].fingerprint, rotated[0].fingerprint);
});

test('normalizeTwin: twin -> finding architecture, source_oracle=twin, coppia-dir ordinata', () => {
  const native = { oracle: 'twin', minParallel: 3, twins: [{ dirA: 'src/commesse', dirB: 'src/preventivi', entityA: 'commesse', entityB: 'preventivi', parallelFiles: ['a.ts', 'b.ts', 'c.ts'] }] };
  const f = normalize('twin', native, OPTS);
  assert.equal(f.length, 1);
  assert.equal(f[0].category, 'architecture');
  assert.equal(f[0].source_oracle.oracle, 'twin');
  const v = validateMany(f);
  assert.ok(v.ok, JSON.stringify(v.errors));
  // coppia-dir ordinata -> stesso fingerprint scambiando A/B.
  const swapped = normalize('twin', { oracle: 'twin', minParallel: 3, twins: [{ dirA: 'src/preventivi', dirB: 'src/commesse', entityA: 'preventivi', entityB: 'commesse', parallelFiles: ['a.ts', 'b.ts', 'c.ts'] }] }, OPTS);
  assert.equal(f[0].fingerprint, swapped[0].fingerprint);
});
