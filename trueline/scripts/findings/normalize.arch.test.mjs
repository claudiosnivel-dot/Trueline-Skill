import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './normalize.mjs';

const native = { oracle: 'arch', findings: [
  { from: 'ui', to: 'data', source_module: 'src/ui/p.ts', target_module: 'src/data/db.ts', path: ['src/ui/p.ts', 'src/data/db.ts'] },
  { from: 'ui', to: 'data', source_module: 'src/ui/legacy.ts', target_module: 'src/data/db.ts', path: ['src/ui/legacy.ts', 'src/data/db.ts'], accepted_exception: true },
] };

test('normalizeArch: category/owasp/cwe/severity e fix_state', () => {
  const out = normalize('arch', native, { base: 'src' });
  assert.equal(out.length, 2);
  assert.equal(out[0].category, 'architecture');
  assert.equal(out[0].source_oracle.oracle, 'arch');
  assert.equal(out[0].owasp, 'A04:2025');
  assert.equal(out[0].cwe, 'CWE-1061');
  assert.equal(out[0].severity, 'MEDIUM');
  assert.equal(out[0].fix_state, 'detected');
  assert.equal(out[1].fix_state, 'accepted-risk'); // eccezione allowlist
});

test('normalizeArch: fingerprint DIREZIONALE (from->to != to->from)', () => {
  const ab = normalize('arch', native, { base: 'src' })[0].fingerprint;
  const rev = normalize('arch', { oracle: 'arch', findings: [
    { from: 'data', to: 'ui', source_module: 'src/data/db.ts', target_module: 'src/ui/p.ts', path: [] }] }, { base: 'src' })[0].fingerprint;
  assert.notEqual(ab, rev);
});
