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

// ── T2.3 — firebase-jsts: classificazione + accessor ──────────────────────────

// Caso Fb-1 (positivo): firebase.json + package.json -> firebase-jsts.
// Passata 1: files_any["firebase.json","firestore.rules"] -> hits=1 (firebase.json).
// firebase-jsts vince su tutti i lang_any-only (postgres-jsts, postgres-py) perché
// ha un segnale forte (files_any); supabase-jsts/supabase-py non combaciamo
// (nessun supabase/ o config.toml).
const fbJson = mkdtempSync(join(tmpdir(), 'eco-fbjson-'));
writeFileSync(join(fbJson, 'firebase.json'), '{}');
writeFileSync(join(fbJson, 'package.json'), '{}');
check(
  'classify(firebase.json + package.json) = firebase-jsts (positivo 1)',
  classify(fbJson) === 'firebase-jsts',
);

// Caso Fb-2 (positivo): firestore.rules + package.json -> firebase-jsts.
// Passata 1: hits=1 (firestore.rules). Stesso ragionamento di Fb-1.
const fbRules = mkdtempSync(join(tmpdir(), 'eco-fbrules-'));
writeFileSync(join(fbRules, 'firestore.rules'), 'rules_version = \'2\';\n');
writeFileSync(join(fbRules, 'package.json'), '{}');
check(
  'classify(firestore.rules + package.json) = firebase-jsts (positivo 2)',
  classify(fbRules) === 'firebase-jsts',
);

// Caso Fb-3 (negativo/precisione): package.json + src/ ma NESSUN firebase.json /
// firestore.rules -> NON firebase-jsts. Passata 1: firebase-jsts hits=0 (nessun
// segnale forte); postgres-jsts non ha files_any -> passata 2 lang_any-only ->
// postgres-jsts (fallback corretto).
const fbNeg = mkdtempSync(join(tmpdir(), 'eco-fbneg-'));
writeFileSync(join(fbNeg, 'package.json'), '{}');
mkdirSync(join(fbNeg, 'src'), { recursive: true });
writeFileSync(join(fbNeg, 'src', 'index.ts'), '');
check(
  'classify(package.json + src/, NESSUN firebase.json/firestore.rules) != firebase-jsts (precisione)',
  classify(fbNeg) !== 'firebase-jsts',
);
check(
  'classify(package.json + src/, NESSUN firebase.json/firestore.rules) = postgres-jsts (fallback corretto)',
  classify(fbNeg) === 'postgres-jsts',
);

// Anti-regressione con firebase-jsts caricato: le classificazioni precedenti devono
// restare stabili.
const fbAntiSb = mkdtempSync(join(tmpdir(), 'eco-fbantisb-'));
mkdirSync(join(fbAntiSb, 'supabase'), { recursive: true });
writeFileSync(join(fbAntiSb, 'supabase', 'config.toml'), '');
writeFileSync(join(fbAntiSb, 'package.json'), '{}');
check(
  'anti-regressione (con firebase-jsts): supabase/config.toml + package.json = supabase-jsts',
  classify(fbAntiSb) === 'supabase-jsts',
);

const fbAntiPg = mkdtempSync(join(tmpdir(), 'eco-fbantipg-'));
writeFileSync(join(fbAntiPg, 'package.json'), '{}');
check(
  'anti-regressione (con firebase-jsts): solo package.json = postgres-jsts',
  classify(fbAntiPg) === 'postgres-jsts',
);

const fbAntiEmpty = mkdtempSync(join(tmpdir(), 'eco-fbantiempty-'));
check(
  'anti-regressione (con firebase-jsts): repo vuoto = null',
  classify(fbAntiEmpty) === null,
);

// Accessor firebase-jsts: authzSurfaceCategory, oraclesFor, floorOf.
const mFb = all.find((x) => x.id === 'firebase-jsts');
check('firebase-jsts caricato nel manifest set', mFb !== undefined);
check('authzSurfaceCategory(firebase-jsts) = authz', authzSurfaceCategory(mFb) === 'authz');
check('oraclesFor(firebase-jsts).authz.tool = firestore_rules_check', oraclesFor(mFb).authz && oraclesFor(mFb).authz.tool === 'firestore_rules_check');
check('floorOf(firebase-jsts) include secret', floorOf(mFb).includes('secret'));
check('floorOf(firebase-jsts) include dependency-vuln', floorOf(mFb).includes('dependency-vuln'));
check('floorOf(firebase-jsts) include authz', floorOf(mFb).includes('authz'));

// ── F1 (eco-expansion) — firebase-py: tie-break per LINGUA su backend Firebase ──
// firebase-jsts e firebase-py condividono detect.files_any:["firebase.json",
// "firestore.rules"] (backend Firebase identico): su un repo Firebase pareggiano sul
// segnale forte (hits=1). Il tie-break conta i match lang_any per disambiguare la
// LINGUA — esattamente come supabase-jsts↔supabase-py su supabase/config.toml.
// (Gemelli dei casi Sp-Py / Sp-Ambig / Caso G, con firebase.json al posto di
// supabase/config.toml. firebase-jsts NON si tocca: lang_any:['package.json'].)

// Caso Fb-Py (positivo): firebase.json + requirements.txt (NO package.json) -> firebase-py.
// Passata 1: firebase.json -> fj e fp hits=1 (pari merito). Tie-break lang: fp lang=1
// (requirements.txt ∈ lang_any py), fj lang=0 (package.json assente) -> vince firebase-py.
const fbPy = mkdtempSync(join(tmpdir(), 'eco-fbpy-'));
writeFileSync(join(fbPy, 'firebase.json'), '{}');
writeFileSync(join(fbPy, 'requirements.txt'), 'firebase-admin==6.5.0\n');
check(
  'classify(firebase.json + requirements.txt, NO package.json) = firebase-py (tie-break per lingua)',
  classify(fbPy) === 'firebase-py',
);

// Caso Fb-Ambig: firebase.json + package.json + requirements.txt -> {ambiguous}.
// Passata 1: fj e fp hits=1 (firebase.json). Tie-break lang: fj lang=1 (package.json),
// fp lang=1 (requirements.txt) -> pareggiano ANCHE sulla lingua -> ambiguous (onesto).
const fbAmbig = mkdtempSync(join(tmpdir(), 'eco-fbambig-'));
writeFileSync(join(fbAmbig, 'firebase.json'), '{}');
writeFileSync(join(fbAmbig, 'package.json'), '{}');
writeFileSync(join(fbAmbig, 'requirements.txt'), 'firebase-admin==6.5.0\n');
const fbAmbigResult = classify(fbAmbig);
check(
  'classify(firebase.json + package.json + requirements.txt) = {ambiguous:true} (JS↔Py pari merito su lingua)',
  fbAmbigResult && fbAmbigResult.ambiguous === true &&
  Array.isArray(fbAmbigResult.candidates) &&
  fbAmbigResult.candidates.includes('firebase-jsts') &&
  fbAmbigResult.candidates.includes('firebase-py'),
);

// Caso Fb-NoLang: firebase.json SENZA alcun marker di lingua -> {ambiguous} (JS↔Py indecidibile).
// Passata 1: fj e fp hits=1 (firebase.json). Tie-break lang: entrambi lang=0 -> ambiguous.
const fbNoLang = mkdtempSync(join(tmpdir(), 'eco-fbnolang-'));
writeFileSync(join(fbNoLang, 'firebase.json'), '{}');
const fbNoLangResult = classify(fbNoLang);
check(
  'classify(firebase.json SENZA lingua) = {ambiguous:true} (JS↔Py indecidibile, onesto)',
  fbNoLangResult && fbNoLangResult.ambiguous === true &&
  Array.isArray(fbNoLangResult.candidates) &&
  fbNoLangResult.candidates.includes('firebase-jsts') &&
  fbNoLangResult.candidates.includes('firebase-py'),
);

// Caso Fb-JS (anti-regressione): firebase.json + package.json (NO requirements) -> resta firebase-jsts.
// Passata 1: fj e fp hits=1 (firebase.json). Tie-break lang: fj lang=1 (package.json),
// fp lang=0 -> vince firebase-jsts (il pack JS non viene dirottato dall'arrivo di firebase-py).
const fbJsAntiReg = mkdtempSync(join(tmpdir(), 'eco-fbjsanti-'));
writeFileSync(join(fbJsAntiReg, 'firebase.json'), '{}');
writeFileSync(join(fbJsAntiReg, 'package.json'), '{}');
check(
  'classify(firebase.json + package.json, NO requirements) = firebase-jsts (anti-regressione, con firebase-py caricato)',
  classify(fbJsAntiReg) === 'firebase-jsts',
);

// ── eco-F4 — laravel-php: classificazione (composer.json, lang_any-only) ──────
// detect.lang_any:["composer.json"] senza files_any -> passata 2 (fallback lang_any-only).

// Caso LP-1 (positivo): dir con solo composer.json -> laravel-php.
const lpPos = mkdtempSync(join(tmpdir(), 'eco-lppos-'));
writeFileSync(join(lpPos, 'composer.json'), '{"name":"test"}');
check(
  'classify(solo composer.json) = laravel-php (lang_any-only passata 2)',
  classify(lpPos) === 'laravel-php',
);

// Caso LP-2 (negativo/precisione): dir vuota -> NON laravel-php.
const lpNeg = mkdtempSync(join(tmpdir(), 'eco-lpneg-'));
check(
  'classify(repo vuoto) != laravel-php (precisione)',
  classify(lpNeg) !== 'laravel-php',
);

// ── eco-F4 — dotnet-cs: classificazione (app.csproj / global.json, lang_any-only) ─
// detect.lang_any:["global.json","app.csproj"] senza files_any -> passata 2 (fallback
// lang_any-only, match per NOME-FILE ESATTO via existsSync, NON glob). Marker .csproj
// citato come caso NON ovvio: lo blindiamo con un positivo + un negativo di precisione.

// Caso DN-1 (positivo): dir con solo app.csproj -> dotnet-cs.
const dnPos = mkdtempSync(join(tmpdir(), 'eco-dnpos-'));
writeFileSync(join(dnPos, 'app.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>');
check(
  'classify(solo app.csproj) = dotnet-cs (lang_any-only passata 2)',
  classify(dnPos) === 'dotnet-cs',
);

// Caso DN-2 (negativo/precisione): dir vuota -> NON dotnet-cs.
const dnNeg = mkdtempSync(join(tmpdir(), 'eco-dnneg-'));
check(
  'classify(repo vuoto) != dotnet-cs (precisione)',
  classify(dnNeg) !== 'dotnet-cs',
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'OK' : 'FAIL'} — ${results.length - failed.length}/${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
