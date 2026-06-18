#!/usr/bin/env node
// resolve.test.mjs — classificazione e accessor dei binding (SP-0).
import { loadEcosystems, classify, oraclesFor, deadCodeTool, testRunnerDetect, verifiedSet, floorOf, authzSurfaceCategory } from './resolve.mjs';

const results = [];
const check = (n, ok, d) => { results.push({ ok: Boolean(ok) }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ` — ${d}` : ''}`); };

const all = loadEcosystems();
check('carica almeno supabase-jsts', all.some((m) => m.id === 'supabase-jsts'));

const m = all.find((x) => x.id === 'supabase-jsts');
check('authzSurfaceCategory = rls', authzSurfaceCategory(m) === 'rls');
check('verifiedSet contiene rls', verifiedSet(m).includes('rls'));
check('floor contiene secret+dependency-vuln+rls', ['secret','dependency-vuln','rls'].every((c) => floorOf(m).includes(c)));
check('deadCodeTool = knip', deadCodeTool(m) === 'knip');
check('testRunnerDetect include vitest', testRunnerDetect(m).includes('vitest'));
check('oraclesFor mappa secret->gitleaks', oraclesFor(m).secret.tool === 'gitleaks');

// classify: una dir con supabase/config.toml risolve a supabase-jsts; una vuota -> null.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const d = mkdtempSync(join(tmpdir(), 'eco-'));
mkdirSync(join(d, 'supabase'), { recursive: true }); writeFileSync(join(d, 'supabase', 'config.toml'), '');
check('classify(supabase repo) = supabase-jsts', classify(d) === 'supabase-jsts');
const empty = mkdtempSync(join(tmpdir(), 'eco-empty-'));
check('classify(repo vuoto) = null (non supportato, onesto)', classify(empty) === null);

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'OK' : 'FAIL'} — ${results.length - failed.length}/${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
