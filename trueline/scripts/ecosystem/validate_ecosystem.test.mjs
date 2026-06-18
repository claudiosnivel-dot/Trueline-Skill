#!/usr/bin/env node
// validate_ecosystem.test.mjs — i controlli del manifest (SP-0).
import { validateEcosystem } from './validate_ecosystem.mjs';

const results = [];
const check = (n, ok, d) => { results.push({ n, ok: Boolean(ok), d }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ` — ${d}` : ''}`); };

// manifest valido (mirror di supabase-jsts, ridotto)
const VALID = {
  id: 'x', version: '1.0.0', languages: ['ts'], backend: 'postgres',
  detect: { files_any: ['a'] }, triggers: ['t1', 't2'],
  oracles: {
    secret: { tool: 'gitleaks', shared: true },
    'dependency-vuln': { tool: 'osv' },
    rls: { tool: 'rls_check', role: 'authz-surface' },
    'dead-code': { tool: 'knip' },
  },
  floor: ['secret', 'dependency-vuln', 'rls'],
  verified_set: ['secret', 'rls', 'dead-code'],
  coverage_policy: 'declared',
};
const clone = (o) => JSON.parse(JSON.stringify(o));

check('A valido -> ok', validateEcosystem(VALID).ok);

// (1) campi obbligatori mancanti -> reject
{ const m = clone(VALID); delete m.floor; check('manca floor -> reject', validateEcosystem(m).ok === false); }
// (2) floor non legato a un oracolo -> reject
{ const m = clone(VALID); m.floor = ['secret', 'nonlegata']; check('floor non legato -> reject', validateEcosystem(m).ok === false); }
// (3) nessun role authz-surface -> reject
{ const m = clone(VALID); delete m.oracles.rls.role; check('niente authz-surface -> reject', validateEcosystem(m).ok === false); }
// (3b) due role authz-surface -> reject
{ const m = clone(VALID); m.oracles.secret.role = 'authz-surface'; check('due authz-surface -> reject', validateEcosystem(m).ok === false); }
// (4) verified_set non sottoinsieme dei binding -> reject
{ const m = clone(VALID); m.verified_set = ['secret', 'fantasma']; check('verified_set non-subset -> reject', validateEcosystem(m).ok === false); }
// (5) binding senza tool -> reject
{ const m = clone(VALID); m.oracles.secret = { shared: true }; check('binding senza tool -> reject', validateEcosystem(m).ok === false); }
// (6) coverage_policy fuori dal set chiuso -> reject
{ const m = clone(VALID); m.coverage_policy = 'magic'; check('coverage_policy ignota -> reject', validateEcosystem(m).ok === false); }
// (7) manifest non-oggetto -> reject (esito binario anche sull'input degenere)
check('manifest non-oggetto -> reject', validateEcosystem(null).ok === false);

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'OK' : 'FAIL'} — ${results.length - failed.length}/${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
