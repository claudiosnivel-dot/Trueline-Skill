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

// SP-1 T2.1 — precedenza file-signal-forte (i casi nuovi).
// Caso 1 (anti-regressione): un repo Supabase REALE (package.json + supabase/config.toml)
// resta supabase-jsts ANCHE con postgres-jsts caricato (file_any forte vince sul lang_any-only).
const sbReal = mkdtempSync(join(tmpdir(), 'eco-sbreal-'));
writeFileSync(join(sbReal, 'package.json'), '{}');
mkdirSync(join(sbReal, 'supabase'), { recursive: true }); writeFileSync(join(sbReal, 'supabase', 'config.toml'), '');
check('classify(supabase reale: pkg+config.toml) = supabase-jsts (con postgres-jsts caricato)', classify(sbReal) === 'supabase-jsts');

// Caso 2: un repo con solo package.json (no supabase/config.toml) -> postgres-jsts (fallback lang_any-only).
const pgOnly = mkdtempSync(join(tmpdir(), 'eco-pgonly-'));
writeFileSync(join(pgOnly, 'package.json'), '{}');
check('classify(solo package.json) = postgres-jsts (fallback lang_any-only)', classify(pgOnly) === 'postgres-jsts');

// Caso 3: repo vuoto -> null.
const empty2 = mkdtempSync(join(tmpdir(), 'eco-empty2-'));
check('classify(repo vuoto, ribadito) = null', classify(empty2) === null);

// Caso 4 (anti-regressione M5, forma del FIXTURE CANONICO): un repo Supabase REALE
// può avere la dir `supabase/` (migrations) ma NON `supabase/config.toml` (progetto
// mid-setup / fixture eval). DEVE restare supabase-jsts: il marker forte è la dir
// `supabase/` (real-world Supabase), non solo il file config.toml. Senza questo,
// con postgres-jsts caricato il fixture canonico cade nel fallback lang_any-only
// (-> postgres-jsts), il loop seleziona un verified_set vuoto e M5 si rompe.
const sbDirOnly = mkdtempSync(join(tmpdir(), 'eco-sbdironly-'));
writeFileSync(join(sbDirOnly, 'package.json'), '{}');
mkdirSync(join(sbDirOnly, 'supabase', 'migrations'), { recursive: true });
writeFileSync(join(sbDirOnly, 'supabase', 'migrations', '0001_init.sql'), '-- ddl');
check('classify(supabase/ dir + migrations, NO config.toml, +package.json) = supabase-jsts (marker forte = dir supabase/)', classify(sbDirOnly) === 'supabase-jsts');

// Caso 5 (precisione del marker-dir): un repo postgres puro (package.json, NESSUNA
// dir supabase/) resta postgres-jsts — il marker-dir NON deve essere troppo lasco.
const pgPure = mkdtempSync(join(tmpdir(), 'eco-pgpure-'));
writeFileSync(join(pgPure, 'package.json'), '{}');
mkdirSync(join(pgPure, 'src'), { recursive: true });
writeFileSync(join(pgPure, 'src', 'index.ts'), '');
check('classify(package.json + src/, NESSUNA dir supabase/) = postgres-jsts (marker-dir non troppo lasco)', classify(pgPure) === 'postgres-jsts');

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'OK' : 'FAIL'} — ${results.length - failed.length}/${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
