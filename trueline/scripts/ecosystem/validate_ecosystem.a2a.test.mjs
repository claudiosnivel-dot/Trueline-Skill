// validate_ecosystem.a2a.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEcosystem } from './validate_ecosystem.mjs';

const base = () => ({
  id: 'x', version: '1.0.0', languages: ['js'], backend: 'x',
  detect: { files_any: ['a'] }, triggers: ['x'],
  oracles: { secret: { tool: 'gitleaks' }, authz: { tool: 'firestore_rules_check', role: 'authz-surface' } },
  floor: ['secret'], verified_set: ['secret'], coverage_policy: 'declared',
});

test('binding duplication/architecture ora ACCETTATO (enum esteso)', () => {
  const m = base();
  m.oracles.duplication = { tool: 'jscpd' };
  m.oracles.architecture = { tool: 'dependency-cruiser' };
  const r = validateEcosystem(m);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});
