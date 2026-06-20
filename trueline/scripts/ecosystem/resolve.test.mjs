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
// SP-3 T2.1 — un repo Supabase REALE ha un marker di lingua: aggiungiamo package.json
// (vero progetto JS+Supabase). supabase-jsts e supabase-py PAREGGIANO sul segnale forte
// `supabase/config.toml` (entrambi hits=1); il tie-break per LINGUA conta lang_any:
// supabase-jsts (package.json) vince su supabase-py (lang Python assente). Il caso
// "config.toml SENZA alcuna lingua -> ambiguous" è coperto dal nuovo Caso G esplicito.
mkdirSync(join(d, 'supabase'), { recursive: true }); writeFileSync(join(d, 'supabase', 'config.toml'), '');
writeFileSync(join(d, 'package.json'), '{}');
check('classify(supabase repo JS: config.toml + package.json) = supabase-jsts', classify(d) === 'supabase-jsts');
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

// ── SP-2 T2.1 — classificazione Python (postgres-py) ────────────────────────

// Caso A: repo con SOLO pyproject.toml (niente package.json, niente supabase/)
// -> passata 2 lang_any-only: postgres-py vince (hits=1), postgres-jsts hits=0.
const pyPrj = mkdtempSync(join(tmpdir(), 'eco-pyprj-'));
writeFileSync(join(pyPrj, 'pyproject.toml'), '[tool.poetry]\nname = "myapp"\n');
check(
  'classify(solo pyproject.toml) = postgres-py (lang_any-only, passata 2)',
  classify(pyPrj) === 'postgres-py',
);

// Caso B: repo con SOLO requirements.txt (niente package.json, niente supabase/)
// -> passata 2: postgres-py hits=1, postgres-jsts hits=0 -> postgres-py.
const pyReq = mkdtempSync(join(tmpdir(), 'eco-pyreq-'));
writeFileSync(join(pyReq, 'requirements.txt'), 'psycopg2==2.9.9\n');
check(
  'classify(solo requirements.txt) = postgres-py (lang_any-only, passata 2)',
  classify(pyReq) === 'postgres-py',
);

// Caso C (anti-regressione): repo Supabase JS REALE (supabase/config.toml + package.json)
// -> resta supabase-jsts. Passata 1: supabase-jsts e supabase-py pareggiano sul segnale
// forte config.toml (hits=1 entrambi); il tie-break per LINGUA conta lang_any e
// supabase-jsts (package.json) vince su supabase-py (lang Python assente). Aggiungiamo
// package.json perché un repo Supabase reale ha SEMPRE un marker di lingua; il caso
// "config.toml senza lingua -> ambiguous" è coperto dal nuovo Caso G esplicito.
const sbAntiReg = mkdtempSync(join(tmpdir(), 'eco-sbanti-'));
mkdirSync(join(sbAntiReg, 'supabase'), { recursive: true });
writeFileSync(join(sbAntiReg, 'supabase', 'config.toml'), '');
writeFileSync(join(sbAntiReg, 'package.json'), '{}');
check(
  'classify(supabase/config.toml + package.json) = supabase-jsts (tie-break per lingua, postgres-py + supabase-py caricati)',
  classify(sbAntiReg) === 'supabase-jsts',
);

// Caso D (anti-regressione): repo con SOLO package.json -> postgres-jsts (non postgres-py).
const pkgAntiReg = mkdtempSync(join(tmpdir(), 'eco-pkganti-'));
writeFileSync(join(pkgAntiReg, 'package.json'), '{}');
check(
  'classify(solo package.json) = postgres-jsts (anti-regressione con postgres-py caricato)',
  classify(pkgAntiReg) === 'postgres-jsts',
);

// Caso E (ambiguità): repo con SIA package.json SIA requirements.txt.
// Passata 2: postgres-jsts hits=1 (package.json), postgres-py hits=1 (requirements.txt).
// Pari merito -> ambiguous. Mai un verde silenzioso.
const ambig = mkdtempSync(join(tmpdir(), 'eco-ambig-'));
writeFileSync(join(ambig, 'package.json'), '{}');
writeFileSync(join(ambig, 'requirements.txt'), 'psycopg2==2.9.9\n');
const ambigResult = classify(ambig);
check(
  'classify(package.json + requirements.txt) = {ambiguous:true} (pari merito, proponi+conferma)',
  ambigResult && ambigResult.ambiguous === true &&
  Array.isArray(ambigResult.candidates) &&
  ambigResult.candidates.includes('postgres-jsts') &&
  ambigResult.candidates.includes('postgres-py'),
);

// Caso F (repo vuoto, ribadito con postgres-py caricato) -> null.
const emptyPy = mkdtempSync(join(tmpdir(), 'eco-emptpy-'));
check(
  'classify(repo vuoto, con postgres-py caricato) = null',
  classify(emptyPy) === null,
);

// ── SP-3 T2.1 — tie-break per LINGUA su backend Supabase (supabase-jsts ↔ supabase-py) ──
// supabase-jsts e supabase-py condividono files_any:["supabase/config.toml"]: su un repo
// Supabase pareggiano sul segnale forte (hits=1 entrambi). Il tie-break conta i match
// lang_any nel projectDir per disambiguare il BACKEND per LINGUA.

// Caso Sp-Py: supabase/config.toml + requirements.txt (NO package.json) -> supabase-py.
// Passata 1: config.toml -> sj e sp hits=1 (pari merito). Tie-break lang: sp lang=1
// (requirements.txt), sj lang=0 (package.json assente) -> vince supabase-py.
const sbPy = mkdtempSync(join(tmpdir(), 'eco-sbpy-'));
mkdirSync(join(sbPy, 'supabase'), { recursive: true });
writeFileSync(join(sbPy, 'supabase', 'config.toml'), '');
writeFileSync(join(sbPy, 'requirements.txt'), 'supabase==2.4.0\n');
check(
  'classify(supabase/config.toml + requirements.txt, NO package.json) = supabase-py (tie-break per lingua)',
  classify(sbPy) === 'supabase-py',
);

// Caso Sp-Py-pyproject: variante con pyproject.toml al posto di requirements.txt -> supabase-py.
const sbPyPrj = mkdtempSync(join(tmpdir(), 'eco-sbpyprj-'));
mkdirSync(join(sbPyPrj, 'supabase'), { recursive: true });
writeFileSync(join(sbPyPrj, 'supabase', 'config.toml'), '');
writeFileSync(join(sbPyPrj, 'pyproject.toml'), '[tool.poetry]\nname = "myapp"\n');
check(
  'classify(supabase/config.toml + pyproject.toml, NO package.json) = supabase-py (tie-break per lingua)',
  classify(sbPyPrj) === 'supabase-py',
);

// Caso Sp-Ambig: supabase/config.toml + package.json + requirements.txt -> {ambiguous}.
// Passata 1: sj e sp hits=1 (config.toml). Tie-break lang: sj lang=1 (package.json),
// sp lang=1 (requirements.txt) -> pareggiano ANCHE sulla lingua -> ambiguous (onesto).
const sbAmbig = mkdtempSync(join(tmpdir(), 'eco-sbambig-'));
mkdirSync(join(sbAmbig, 'supabase'), { recursive: true });
writeFileSync(join(sbAmbig, 'supabase', 'config.toml'), '');
writeFileSync(join(sbAmbig, 'package.json'), '{}');
writeFileSync(join(sbAmbig, 'requirements.txt'), 'supabase==2.4.0\n');
const sbAmbigResult = classify(sbAmbig);
check(
  'classify(supabase/config.toml + package.json + requirements.txt) = {ambiguous:true} (JS↔Py pari merito su lingua)',
  sbAmbigResult && sbAmbigResult.ambiguous === true &&
  Array.isArray(sbAmbigResult.candidates) &&
  sbAmbigResult.candidates.includes('supabase-jsts') &&
  sbAmbigResult.candidates.includes('supabase-py'),
);

// Caso G: supabase/config.toml SENZA alcun marker di lingua -> {ambiguous} (JS↔Py indecidibile).
// Passata 1: sj e sp hits=1 (config.toml). Tie-break lang: entrambi lang=0 -> ambiguous.
const sbNoLang = mkdtempSync(join(tmpdir(), 'eco-sbnolang-'));
mkdirSync(join(sbNoLang, 'supabase'), { recursive: true });
writeFileSync(join(sbNoLang, 'supabase', 'config.toml'), '');
const sbNoLangResult = classify(sbNoLang);
check(
  'classify(supabase/config.toml SENZA lingua) = {ambiguous:true} (JS↔Py indecidibile, onesto)',
  sbNoLangResult && sbNoLangResult.ambiguous === true &&
  Array.isArray(sbNoLangResult.candidates) &&
  sbNoLangResult.candidates.includes('supabase-jsts') &&
  sbNoLangResult.candidates.includes('supabase-py'),
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'OK' : 'FAIL'} — ${results.length - failed.length}/${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
