// run_loop.a2c-f3.test.mjs — F3: report.structural_debt (dup/cycle/twin) in REMEDIATE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStructuralDebt } from './run_loop.mjs';

const c1 = (findings) => [{ id: 1, name: 'dead-code', findings }, { id: 2, name: 'security', findings: [] }];

test('extractStructuralDebt: estrae SOLO i finding d\'igiene (jscpd/cycle/twin) del controllo 1', () => {
  const controls = c1([
    { fingerprint: 'a', category: 'dead-code', severity: 'LOW', source_oracle: { oracle: 'knip' }, location: {}, evidence: 'x', baseline_status: 'new' },
    { fingerprint: 'b', category: 'duplication', severity: 'LOW', source_oracle: { oracle: 'jscpd' }, location: { file: 'src/a.ts' }, evidence: 'clone', baseline_status: 'pre-existing' },
    { fingerprint: 'c', category: 'architecture', severity: 'LOW', source_oracle: { oracle: 'cycle' }, location: {}, evidence: 'cyc', baseline_status: 'pre-existing' },
    { fingerprint: 'd', category: 'architecture', severity: 'LOW', source_oracle: { oracle: 'twin' }, location: {}, evidence: 'twin', baseline_status: 'pre-existing' },
  ]);
  const sd = extractStructuralDebt(controls);
  assert.equal(sd.length, 3, 'dup+cycle+twin, NON dead-code');
  assert.deepEqual(sd.map((f) => f.oracle).sort(), ['cycle', 'jscpd', 'twin']);
  assert.ok(sd.every((f) => 'baseline_status' in f && 'fingerprint' in f));
  assert.ok(!sd.some((f) => f.oracle === 'knip'), 'dead-code NON e\' debito strutturale');
});

test('extractStructuralDebt: controllo 1 assente / senza igiene -> []', () => {
  assert.deepEqual(extractStructuralDebt([{ id: 2, name: 'security', findings: [] }]), []);
  assert.deepEqual(extractStructuralDebt(c1([{ fingerprint: 'a', category: 'dead-code', source_oracle: { oracle: 'knip' } }])), []);
  assert.deepEqual(extractStructuralDebt(null), []);
});
