// validate_ecosystem.a0.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEcosystem } from './validate_ecosystem.mjs';

const base = () => ({
  id: 'x', version: '1.0.0', languages: ['js'], backend: 'x',
  detect: { files_any: ['a'] }, triggers: ['x'],
  oracles: { secret: { tool: 'gitleaks' }, authz: { tool: 'firestore_rules_check', role: 'authz-surface' } },
  floor: ['secret'], verified_set: ['secret'], coverage_policy: 'declared',
});

test('categoria oracolo con refuso -> FAIL', () => {
  const m = base(); m.oracles.injecton = { tool: 'semgrep' };
  const r = validateEcosystem(m);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /injecton/.test(e)));
});

test('manifest valido -> OK', () => {
  assert.equal(validateEcosystem(base()).ok, true);
});
