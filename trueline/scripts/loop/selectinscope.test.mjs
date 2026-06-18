#!/usr/bin/env node
// selectinscope.test.mjs — selectInScope guidato dal verified_set del manifest (SP-0, Task C4).
//
// Invariante: SENZA manifest, il comportamento e' IDENTICO al v1 cablato
// (set verificato-a-zero {secret, rls, dead-code}). CON un manifest il set
// IN-SCOPE per il loop e' esattamente `verifiedSetFrom(manifest)` — le categorie
// fuori dal verified_set non entrano nel loop (mai auto-promosse).
//
// Node ESM, solo built-in. Il "verde" e' l'exit/output REALE del comando (L-COL-002).
import { selectInScope } from './run_loop.mjs';

const results = [];
const check = (n, ok, d) => {
  results.push({ n, ok: Boolean(ok), d });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ` — ${d}` : ''}`);
};

// Finding fixture: copre le tre categorie del verified_set v1 (secret/rls/dead-code)
// rispettando i sotto-filtri per-finding gia' esistenti in selectInScope
// (S1 config.ts working-tree, S2 credentials.ts history, S8 unused.ts dead-code).
let fp = 0;
const mk = (over) => ({
  fingerprint: `fp-${++fp}`,
  category: 'secret',
  location: { file: 'x.ts' },
  _scope: 'working-tree',
  ...over,
});

const FINDINGS = [
  mk({ category: 'secret', location: { file: 'config.ts' }, _scope: 'working-tree' }),   // S1
  mk({ category: 'secret', location: { file: 'credentials.ts' }, _scope: 'history' }),   // S2
  mk({ category: 'rls', location: { file: 'supabase/migrations/001.sql' }, _scope: 'static-ddl' }), // S3..S5
  mk({ category: 'dead-code', location: { file: 'src/legacy/unused.ts' }, _scope: 'working-tree' }), // S8
];

const catsOf = (arr) => new Set(arr.map((f) => f.category));

// (1) SENZA manifest -> default v1: ammette secret + rls + dead-code.
{
  const out = selectInScope(FINDINGS);
  const cats = catsOf(out);
  check('default (no manifest) ammette secret', cats.has('secret'));
  check('default (no manifest) ammette rls', cats.has('rls'));
  check('default (no manifest) ammette dead-code', cats.has('dead-code'));
  check('default (no manifest) = 4 finding (v1 invariato)', out.length === 4, `len=${out.length}`);
}

// (2) manifest null esplicito -> identico al default.
{
  const out = selectInScope(FINDINGS, null);
  check('manifest=null identico al default', out.length === 4, `len=${out.length}`);
}

// (3) manifest con verified_set:['secret'] -> SOLO secret (rls/dead-code esclusi).
{
  const m = { verified_set: ['secret'], oracles: { secret: { tool: 'gitleaks' } } };
  const out = selectInScope(FINDINGS, m);
  const cats = catsOf(out);
  check('verified_set:[secret] ammette secret', cats.has('secret'));
  check('verified_set:[secret] ESCLUDE rls', !cats.has('rls'));
  check('verified_set:[secret] ESCLUDE dead-code', !cats.has('dead-code'));
  check('verified_set:[secret] = solo i 2 secret (S1+S2)', out.length === 2, `len=${out.length}`);
}

// (4) manifest con verified_set:['rls'] -> SOLO rls.
{
  const m = { verified_set: ['rls'], oracles: { rls: { tool: 'rls_check', role: 'authz-surface' } } };
  const out = selectInScope(FINDINGS, m);
  const cats = catsOf(out);
  check('verified_set:[rls] ammette rls', cats.has('rls'));
  check('verified_set:[rls] ESCLUDE secret', !cats.has('secret'));
  check('verified_set:[rls] = solo 1 finding rls', out.length === 1, `len=${out.length}`);
}

// (5) manifest che riproduce il v1 (secret/rls/dead-code) -> identico al default.
{
  const m = { verified_set: ['secret', 'rls', 'dead-code'], oracles: {} };
  const out = selectInScope(FINDINGS, m);
  check('verified_set v1 esplicito = default', out.length === 4, `len=${out.length}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'OK' : 'FAIL'} — ${results.length - failed.length}/${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
