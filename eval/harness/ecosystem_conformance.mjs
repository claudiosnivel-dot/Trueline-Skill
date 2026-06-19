#!/usr/bin/env node
// ecosystem_conformance.mjs <id> — GATE DI CONFORMITÀ PARAMETRICO (SP-0 §5.4 + SP-1).
//
// Dato un <id> di ecosistema, risolve il manifest spedito (via resolve.mjs:
// loadManifest) e asserisce i criteri della §5.4 dello spec. Due CORPI:
//
//   (a) RAMO DELEGATO (supabase-jsts) — INVARIATO da SP-0: la fixture del pack è
//       l'attuale `eval/reference-app` (S1..S8) + `eval/seeded-blueprint`, e
//       l'intera batteria A/B/C/D/E è GIÀ implementata dal gate v1
//       `eval/harness/m5_gate_check.mjs`. Qui, dopo il criterio 1
//       (validate_ecosystem), DELEGHIAMO a m5 e PROPAGHIAMO il suo exit code.
//       SP-1 NON tocca questo ramo (m5 resta 56/56).
//
//   (b) CORPO DETECTION-PARAMETRICO (SP-1, pack kind:'detection') — per i pack
//       NUOVI con fixture+registry on-disk (postgres-jsts). Letto da
//       manifest+registry+fixture, NON cablato al pack: i criteri sono FATTI di
//       ORACOLI REALI legati dal manifest, MAI un parere dell'LLM (L-COL-002).
//       Criteri implementati:
//         CRITERIO 1 — MANIFEST VALIDO (validate_ecosystem), come per ogni <id>.
//         CRITERIO 2 — DETECTION parity sul FLOOR, su COPIA ISOLATA: per ogni
//                      categoria di manifest.floor risolviamo l'ORACOLO LEGATO
//                      (oraclesFor(manifest)[cat].tool) e lo lanciamo sulla copia
//                      (verify_workspace.createVerifyWorkspace con .git, copia
//                      ISOLATA — assertIsolatedRepo inline). secret→run_gitleaks
//                      working-tree; dependency-vuln→run_osv sul lockfile;
//                      authz|injection|crypto→run_semgrep col ruleset del manifest.
//                      Normalizziamo (normalize) e ASSERIAMO che il SEED del
//                      registry per quella categoria sia PRESENTE nei finding e
//                      COLTO DALL'ORACOLO LEGATO (source_oracle combacia, ancora
//                      file/lockfile combacia, cwe/owasp dove dati). Coverage
//                      DICHIARATA; mai "sicuro"/"safe".
//         CRITERIO 3 — VERIFIED parity: verified_set vuoto ⇒ VACUO PASS, +
//                      nessun finding auto-promosso a `verified` (detection-only).
//         CRITERIO 5 — TRIGGERING (data-driven): classify(fixtureApp) === <id>
//                      (positivo) e classify(<dir vuota>) !== <id> (negativo);
//                      manifest.triggers non vuoto.
//         CRITERIO 6 — IGIENE/0-CONTAMINAZIONE: la fixture ORIGINALE è
//                      bit-identica (git -C <fixtureApp> status --porcelain vuoto
//                      E HEAD interno invariato), il workspace temp è ripulito, e
//                      l'HEAD del repo ESTERNO è invariato (isolamento provato).
//       (Criterio 4/BUILD non si applica ai pack detection-only — fase 1
//        L-COL-030: verified_set=[].)
//
// ESITO (mai un falso verde — L-COL-002, "verde" = exit/output reale di un comando):
//   exit 0  — criterio 1 PASS  E  (ramo delegato) m5 PASS  /  (corpo detection)
//             criteri 1+2+3+5+6 PASS;
//   exit 1  — un criterio FALLISCE, oppure m5 FAIL/precondizione assente, oppure
//             fixture del pack mancante (conformità non dimostrabile);
//   exit 2  — <id> sconosciuto / nessun manifest spedito per <id>: NON è un
//             fallimento di merito (esito DISTINTO), ma NON può essere un verde.
//
// FALSIFICABILITÀ (il gate detection NON è un timbro sempre-verde): se si rinomina
// il marker SEED:PG-S3 (rotta authz) o si svuota il ruleset del pack, il criterio 2
// FALLISCE (l'oracolo legato non coglie più il seed) → exit 1. Provato in T3.1.
//
// FLAG:
//   --validate-only  — esegue SOLO il criterio 1 (salta detection/delega):
//                      self-check LEGGERO (no DB/docker). exit 0/1.
//
// NON tocca git del repo ESTERNO (l'orchestratore possiede git): le uniche `git`
// sono in SOLA LETTURA (status/rev-parse/show-toplevel) su fixture/copia, mai
// mutazioni. Node ESM, solo built-in (+ normalize/resolve/verify_workspace, tutti
// dep-free). L'harness PUÒ usare docker/gli oracoli go (la SKILL resta generica).

import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdtempSync, rmSync, mkdirSync, readdirSync, readFileSync, cpSync,
} from 'node:fs';
import { resolve, dirname, delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  loadManifest, classify, oraclesFor, floorOf, verifiedSet,
} from '../../trueline/scripts/ecosystem/resolve.mjs';
import { validateEcosystem } from '../../trueline/scripts/ecosystem/validate_ecosystem.mjs';
import { normalize } from '../../trueline/scripts/findings/normalize.mjs';
import { cleanupAllVerifyWorkspaces } from '../../trueline/scripts/loop/verify_workspace.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const M5_GATE = resolve(ROOT, 'eval', 'harness', 'm5_gate_check.mjs');
const RUN_GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const RUN_OSV = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_osv.mjs');
const RUN_SEMGREP = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_semgrep.mjs');
// Oracolo RLS custom di Trueline (legato dal pack postgres-py per la categoria rls,
// ruolo authz-surface su Postgres non-Supabase via current_setting). Statico
// (analizza la DDL delle migration, NON esegue il DB): nessuna dipendenza docker.
const RLS_CHECK = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'rls_check.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';

// Immagine semgrep PINNATA (deve combaciare con run_semgrep.mjs / m5).
const SEMGREP_IMAGE = 'semgrep/semgrep:latest';

// runOpts deterministici per normalize (riproducibilità L-COL-002): niente Date.now.
const RUN_OPTS_BASE = { runId: 'eco-conformance', createdAt: '1970-01-01T00:00:00.000Z' };

// Fixture del pack per ecosistema.
//   - supabase-jsts: ramo DELEGATO (fixture = reference-app + seeded-bp; gate = m5).
//   - postgres-jsts: corpo DETECTION-PARAMETRICO (fixture+registry on-disk).
const PACK_FIXTURES = {
  'supabase-jsts': {
    kind: 'delegated',
    requires: [
      resolve(ROOT, 'eval', 'reference-app'),
      resolve(ROOT, 'eval', 'seeded-blueprint'),
    ],
    gate: M5_GATE,
  },
  'postgres-jsts': {
    kind: 'detection',
    fixtureApp: resolve(ROOT, 'eval', 'ecosystems', 'postgres-jsts', 'reference-app'),
    registry: resolve(ROOT, 'eval', 'ecosystems', 'postgres-jsts', 'registry.json'),
  },
  // postgres-py: corpo DETECTION-PARAMETRICO (SP-2). Floor=[secret,dependency-vuln,
  // rls]: NESSUN binding del floor è semgrep -> needsDocker=false (conformance SENZA
  // docker). Il ramo rls è legato a rls_check (oracolo statico custom, vedi RLS_CHECK).
  'postgres-py': {
    kind: 'detection',
    fixtureApp: resolve(ROOT, 'eval', 'ecosystems', 'postgres-py', 'reference-app'),
    registry: resolve(ROOT, 'eval', 'ecosystems', 'postgres-py', 'registry.json'),
  },
};

// ---------------------------------------------------------------------------
// Helper di esecuzione/IO comuni (mirror del pattern di m5_gate_check.mjs).
// ---------------------------------------------------------------------------
function nodeRun(script, args, cwd = ROOT) {
  const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '', error: res.error };
}

// git in SOLA LETTURA (status/rev-parse/show-toplevel). Non muta nulla.
function gitRead(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: res.status, stdout: (res.stdout || '').trim() };
}

const normSlash = (p) => String(p).replace(/\\/g, '/');
const fileOf = (f) => normSlash((f.location && f.location.file) || '');

// docker disponibile e immagine semgrep pinnata presente?
function dockerReady() {
  const v = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (v.error || v.status !== 0) return { ok: false, why: 'docker non risponde' };
  const img = spawnSync('docker', ['images', '-q', SEMGREP_IMAGE], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (img.error || img.status !== 0 || !(img.stdout || '').trim()) {
    return { ok: false, why: `immagine ${SEMGREP_IMAGE} non presente (docker pull ${SEMGREP_IMAGE})` };
  }
  return { ok: true };
}

// Mappa il source_oracle del registry (gitleaks|osv|semgrep|knip|rls-check) al
// nome canonico dell'oracolo prodotto da normalize (osv -> osv-scanner).
function canonOracle(name) {
  const n = String(name || '').toLowerCase();
  if (n === 'osv' || n === 'osv-scanner') return 'osv-scanner';
  if (n === 'rls' || n === 'rls-check' || n === 'rls_check') return 'rls-check';
  return n; // gitleaks | semgrep | knip
}

// ---------------------------------------------------------------------------
// Banco di asserzioni (stesso stile di m5_gate_check.mjs).
// ---------------------------------------------------------------------------
const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function usage(msg) {
  if (msg) console.error(msg);
  console.error('uso: node eval/harness/ecosystem_conformance.mjs <id> [--validate-only]');
}

// ---------------------------------------------------------------------------
// CORPO DETECTION-PARAMETRICO (kind:'detection'): criteri 1/2/3/5/6.
// Ritorna l'exit code (0 PASS / 1 FAIL). NON chiama process.exit (lo fa main).
// ---------------------------------------------------------------------------
function runDetectionBody(id, manifest, pack) {
  // Precondizione: fixtureApp + registry esistono.
  if (!existsSync(pack.fixtureApp)) {
    console.error(`[FAIL] fixture del pack <${id}> mancante: ${pack.fixtureApp}`);
    return 1;
  }
  if (!existsSync(pack.registry)) {
    console.error(`[FAIL] registry del pack <${id}> mancante: ${pack.registry}`);
    return 1;
  }

  // Carica il registry (schema di eval/harness/expected/registry.json).
  let registry = null;
  try {
    registry = JSON.parse(readFileSync(pack.registry, 'utf8'));
  } catch (e) {
    console.error(`[FAIL] registry <${id}> non parsabile: ${e.message}`);
    return 1;
  }
  const defects = Array.isArray(registry.defects) ? registry.defects : [];

  const floor = floorOf(manifest);
  const bindings = oraclesFor(manifest);

  // PREFLIGHT: il corpo detection lancia ORACOLI REALI (gitleaks/osv via go/bin,
  // semgrep via docker). Se la categoria authz/injection/crypto è nel floor,
  // serve docker. Senza -> NON possiamo provare la detection parity: ESCE 1
  // (precondizione assente: non un falso verde, ma nemmeno un verde possibile).
  const needsDocker = floor.some((c) => (bindings[c] || {}).tool === 'semgrep');
  if (needsDocker) {
    const dr = dockerReady();
    if (!dr.ok) {
      console.error(`[FAIL] oracolo semgrep NON disponibile — ${dr.why}`);
      console.error('       (il floor del pack include una categoria legata a semgrep: serve docker.)');
      return 1;
    }
  }

  // Snapshot d'integrità della fixture ORIGINALE (sola lettura) — criterio 6.
  const innerHeadBefore = gitRead(pack.fixtureApp, ['rev-parse', 'HEAD']).stdout;
  const innerStatusBefore = gitRead(pack.fixtureApp, ['status', '--porcelain']).stdout;
  const outerHeadBefore = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;

  // Sweep di eventuali copie temp orfane (come m4/m5).
  cleanupAllVerifyWorkspaces();

  console.log('');
  console.log(`  CORPO DETECTION-PARAMETRICO <${id}> (kind:detection) — floor=[${floor.join(', ')}]`);
  console.log(`    fixtureApp : ${pack.fixtureApp}`);
  console.log(`    registry   : ${pack.registry} (${defects.length} difetti seminati)`);

  // =========================================================================
  // CRITERIO 2 — DETECTION parity sul FLOOR, su COPIA ISOLATA.
  // =========================================================================
  console.log('');
  console.log('  Criterio 2 — DETECTION parity sul FLOOR (oracolo LEGATO dal manifest, su COPIA isolata):');

  assert('floor non vuoto (Barra-B fase 1: secret/dependency-vuln/authz)', floor.length > 0, `floor=${floor.length}`);

  // Crea la COPIA ISOLATA della fixtureApp (CON .git per lo scope history/igiene).
  // createVerifyWorkspace copia la reference-app CANONICA (eval/reference-app):
  // per i pack nuovi dobbiamo copiare la fixtureApp del pack -> usiamo
  // copyFixtureToWorkspace (mirror dell'isolamento, .tmp-verify gitignorata).
  let ws = null;
  let copyDir = null;
  let copyErr = null;
  try {
    ws = copyPackFixture(id, pack.fixtureApp);
    copyDir = ws.dir;
  } catch (e) {
    copyErr = e;
  }
  assert('copia ISOLATA della fixtureApp creata (eval/.tmp-verify, .git incluso)',
    Boolean(copyDir) && existsSync(copyDir), copyErr ? copyErr.message : copyDir);

  // ISOLAMENTO (assertIsolatedRepo inline, L-COL-024): la copia NON deve risolvere
  // al repo ESTERNO né alla fixtureApp originale (sarebbe contaminazione).
  let copyTop = '';
  if (copyDir) copyTop = gitRead(copyDir, ['rev-parse', '--show-toplevel']).stdout;
  const isIsolated = copyDir
    && normSlash(resolve(copyTop || copyDir)).toLowerCase() !== normSlash(resolve(ROOT)).toLowerCase()
    && normSlash(resolve(copyTop || copyDir)).toLowerCase() !== normSlash(resolve(pack.fixtureApp)).toLowerCase();
  assert('la copia è ISOLATA (toplevel ≠ repo esterno e ≠ fixtureApp originale)', isIsolated,
    copyDir ? `toplevel=${normSlash(copyTop)}` : 'copia assente');

  // Path della copia RELATIVO alla repo root (per la base di normalize).
  const copyBase = copyDir ? normSlash(relativeFromRoot(copyDir)) : '';

  // Per OGNI categoria del floor: lancia l'ORACOLO LEGATO sul copy, normalizza,
  // asserisci che il SEED del registry per quella categoria sia COLTO.
  if (copyDir) {
    for (const cat of floor) {
      const binding = bindings[cat] || {};
      const tool = binding.tool;
      const seed = defects.find((d) => d.category === cat);
      console.log('');
      console.log(`    floor[${cat}] — oracolo legato: ${tool || '(nessun binding!)'}`);

      assert(`[${cat}] esiste un binding-oracolo nel manifest`, Boolean(tool), tool || 'binding mancante');
      assert(`[${cat}] esiste un difetto seminato nel registry`, Boolean(seed),
        seed ? `id=${seed.id}` : 'nessun seed per questa categoria');
      if (!tool || !seed) continue;

      const detected = detectCategory({
        cat, tool, binding, copyDir, copyBase, manifest,
      });
      if (detected.error) {
        assert(`[${cat}] l'oracolo legato (${tool}) gira ed emette finding`, false, detected.error);
        continue;
      }
      assert(`[${cat}] l'oracolo legato (${tool}) gira ed emette finding`, detected.findings.length >= 0,
        `finding=${detected.findings.length}`);

      // Match del SEED (detection parity): categoria + ORACOLO LEGATO
      // (source_oracle del finding == source_oracle del registry) + ANCORA del
      // registry. L'ancora è discriminante e dipende dalla categoria:
      //   - file/lockfile: il path del finding TERMINA con l'ancora (la base di
      //     normalize è la copia; il registry ancora rispetto alla fixture);
      //   - symbol: per dependency-vuln il file è SOLO il lockfile, quindi il
      //     discriminante forte è anchor.symbol (es. "minimist@1.2.0") confrontato
      //     con location.symbol del finding (anche per suffisso, robusto al path).
      // cwe/owasp del registro: per i NOSTRI oracoli (semgrep curato, rls-check)
      // sono 2025-canonici e si ENFORZANO; per le fonti ESTERNE (osv-scanner) il
      // cwe/owasp arriva da una mappa PROVVISORIA (04/normalize) e può divergere
      // dal cwe a mano del registry → confronto SOFT (loggato, non bloccante), per
      // non mascherare un mis-match con un dato esterno fuori dal nostro controllo.
      const wantOracle = canonOracle(seed.source_oracle);
      const anchorFile = normSlash((seed.anchor && (seed.anchor.file || seed.anchor.lockfile)) || '');
      const anchorSymbol = String((seed.anchor && seed.anchor.symbol) || '');
      const externalSourceOracle = wantOracle === 'osv-scanner'; // cwe/owasp provvisori
      const symbolOf = (f) => String((f.location && f.location.symbol) || '');
      let cweOwaspNote = '';
      const match = detected.findings.find((f) => {
        if (f.category !== cat) return false;
        // l'oracolo che ha prodotto il finding combacia col source_oracle del registry.
        if (canonOracle(f.source_oracle && f.source_oracle.oracle) !== wantOracle) return false;
        // ancora-file: il path del finding TERMINA con l'ancora del registry.
        if (anchorFile && !fileOf(f).endsWith(anchorFile)) return false;
        // ancora-symbol (forte per dependency-vuln): location.symbol == anchor.symbol.
        if (anchorSymbol && symbolOf(f) !== anchorSymbol && !symbolOf(f).endsWith(anchorSymbol)) return false;
        // cwe/owasp: enforce solo per gli oracoli AUTORITATIVI (non esterni).
        if (!externalSourceOracle) {
          if (seed.cwe && f.cwe && f.cwe !== seed.cwe) return false;
          if (seed.owasp && f.owasp && f.owasp !== seed.owasp) return false;
        }
        return true;
      });
      if (match && externalSourceOracle) {
        // Confronto SOFT cwe/owasp per le fonti esterne: nota se differiscono dal
        // registry (mappa provvisoria 04), senza far fallire la detection parity.
        const cweDiff = seed.cwe && match.cwe && match.cwe !== seed.cwe;
        const owaDiff = seed.owasp && match.owasp && match.owasp !== seed.owasp;
        if (cweDiff || owaDiff) {
          cweOwaspNote = ` [nota: cwe/owasp registry(${seed.cwe || '-'}/${seed.owasp || '-'}) vs oracolo(${match.cwe || '-'}/${match.owasp || '-'}); fonte esterna, mappa provvisoria 04]`;
        }
      }
      const anchorLabel = anchorFile || (anchorSymbol ? `symbol:${anchorSymbol}` : '(ancora)');
      assert(`[${cat}] SEED ${seed.id} COLTO dall'oracolo legato (${wantOracle}) su ${anchorLabel}`,
        Boolean(match),
        match
          ? `rule=${(match.source_oracle && match.source_oracle.rule_id) || '?'} symbol=${symbolOf(match) || '-'} cwe=${match.cwe || '-'} owasp=${match.owasp || '-'}${cweOwaspNote}`
          : `nessun finding ${cat}@${anchorLabel} dall'oracolo ${wantOracle}`);
    }
  }

  // COVERAGE DICHIARATA, mai "sicuro" (L-COL-006): il pack è tier DETECTION
  // (verified_set vuoto, fase 1). Lo dichiariamo esplicitamente nel log.
  console.log('');
  console.log(`  [INFO] coverage DICHIARATA: tier=detection (verified_set vuoto), coverage_policy=${manifest.coverage_policy}.`);
  console.log('  [INFO] il floor è TROVATO/PRIORITIZZATO dagli oracoli legati, NON auto-fixato. Mai "sicuro".');

  // =========================================================================
  // CRITERIO 3 — VERIFIED parity: verified_set vuoto ⇒ VACUO PASS + nessun
  //              finding auto-promosso a `verified` (detection-only).
  // =========================================================================
  console.log('');
  console.log('  Criterio 3 — VERIFIED parity (verified_set vuoto ⇒ vacuo; nessun auto-promosso):');
  const vset = verifiedSet(manifest);
  assert('verified_set vuoto (tier detection, fase 1 L-COL-030) ⇒ criterio VACUO', vset.length === 0,
    `verified_set=[${vset.join(', ')}]`);
  // Nessun difetto del registry è dichiarato `verified`/auto-promosso: tutti
  // expected_fix_state detection-only (detection tier).
  const promoted = defects.filter((d) => /verified/i.test(String(d.expected_fix_state || '')));
  assert('nessun difetto del registry è auto-promosso a verified (tutti detection-only)', promoted.length === 0,
    promoted.length ? `${promoted.length} promossi (vietato!)` : 'nessuno');

  // =========================================================================
  // CRITERIO 5 — TRIGGERING (data-driven): classify positivo/negativo.
  // =========================================================================
  console.log('');
  console.log('  Criterio 5 — TRIGGERING (classify positivo su fixtureApp, negativo su dir vuota):');
  const triggers = Array.isArray(manifest.triggers) ? manifest.triggers : [];
  assert('manifest.triggers non vuoto', triggers.length > 0, `triggers=${triggers.length}`);
  // POSITIVO: classify(fixtureApp) === <id> (il pack riconosce la propria fixture).
  const clsPos = classify(pack.fixtureApp);
  assert(`classify(fixtureApp) === '${id}' (positivo)`, clsPos === id,
    `classify=${typeof clsPos === 'object' ? JSON.stringify(clsPos) : clsPos}`);
  // NEGATIVO: classify(<dir vuota temp>) !== <id> (una dir vuota non è il pack).
  let emptyDir = null;
  let clsNeg = null;
  try {
    emptyDir = mkdtempSync(join(tmpdir(), 'eco-empty-'));
    clsNeg = classify(emptyDir);
  } finally {
    if (emptyDir) { try { rmSync(emptyDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }
  assert(`classify(dir vuota) !== '${id}' (negativo)`, clsNeg !== id,
    `classify(vuota)=${typeof clsNeg === 'object' ? JSON.stringify(clsNeg) : clsNeg}`);

  // =========================================================================
  // CRITERIO 6 — IGIENE/0-CONTAMINAZIONE.
  // =========================================================================
  console.log('');
  console.log('  Criterio 6 — IGIENE/0-contaminazione (fixture originale bit-identica, temp ripulito, HEAD esterno invariato):');
  // Cleanup della copia.
  let cleanupOk = true;
  try { if (ws && ws.cleanup) ws.cleanup(); } catch { cleanupOk = false; }
  assert('copia temp ripulita senza errori', cleanupOk, cleanupOk ? 'cleanup OK' : 'cleanup fallito');
  assert('nessun residuo della copia temp (dir rimossa)', !copyDir || !existsSync(copyDir),
    copyDir && existsSync(copyDir) ? 'residuo presente' : 'rimossa');
  // La fixture ORIGINALE è bit-identica: status vuoto + HEAD interno invariato.
  const innerStatusAfter = gitRead(pack.fixtureApp, ['status', '--porcelain']).stdout;
  const innerHeadAfter = gitRead(pack.fixtureApp, ['rev-parse', 'HEAD']).stdout;
  assert('fixtureApp ORIGINALE bit-identica (git status --porcelain vuoto + HEAD interno invariato)',
    innerStatusAfter === '' && innerStatusAfter === innerStatusBefore && innerHeadAfter === innerHeadBefore,
    innerStatusAfter === '' && innerHeadAfter === innerHeadBefore ? 'invariata' : `status="${innerStatusAfter}" head=${innerHeadAfter.slice(0, 10)}`);
  // Nessun residuo .trueline/ del ruleset effimero nella fixture originale.
  assert('nessun residuo .trueline/ del ruleset nella fixtureApp originale',
    !existsSync(resolve(pack.fixtureApp, '.trueline')),
    existsSync(resolve(pack.fixtureApp, '.trueline')) ? '.trueline/ residuo' : 'pulito');
  // HEAD del repo ESTERNO invariato (isolamento provato).
  const outerHeadAfter = gitRead(ROOT, ['rev-parse', 'HEAD']).stdout;
  assert('HEAD del repo ESTERNO INVARIATO (0 contaminazione)', outerHeadAfter === outerHeadBefore,
    outerHeadAfter === outerHeadBefore ? `${outerHeadBefore.slice(0, 10)} (invariato)` : 'MUTATO (vietato!)');

  // --- Esito del corpo detection -------------------------------------------
  const allOk = checks.every((c) => c.ok);
  console.log('');
  console.log('------------------------------------------------------------');
  console.log(`=== CONFORMANCE <${id}> RESULT: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length} check; criteri 1/2/3/5/6, 3 vacuo)`);
  console.log('------------------------------------------------------------');
  return allOk ? 0 : 1;
}

// Esegue l'oracolo LEGATO per la categoria `cat` sulla copia e ritorna i finding
// NORMALIZZATI. La base di normalize è il path della copia (così l'ancora-file del
// registry combacia per suffisso). { findings:[...] } oppure { error }.
function detectCategory({ cat, tool, binding, copyDir, copyBase, manifest }) {
  const opts = { ...RUN_OPTS_BASE, base: copyBase };
  if (tool === 'gitleaks') {
    // secret -> run_gitleaks <copy> working-tree.
    const r = nodeRun(RUN_GITLEAKS, [copyDir, 'working-tree']);
    let native = null;
    try { native = JSON.parse(r.stdout); } catch { /* gestito */ }
    if (!Array.isArray(native)) return { error: `gitleaks: output non parsabile (exit=${r.status})` };
    return { findings: safeNormalize('gitleaks', native, opts) };
  }
  if (tool === 'osv') {
    // dependency-vuln -> run_osv <copy>/<lockfile>. Il lockfile dal binding/registry.
    const lockfiles = (binding.lockfiles && binding.lockfiles.length)
      ? binding.lockfiles : ['package-lock.json'];
    const lf = lockfiles.find((name) => existsSync(join(copyDir, name)));
    if (!lf) return { error: `osv: nessun lockfile presente (${lockfiles.join('|')})` };
    const r = nodeRun(RUN_OSV, [join(copyDir, lf)]);
    let native = null;
    try { native = JSON.parse(r.stdout); } catch { /* gestito */ }
    if (!native) return { error: `osv: output non parsabile (exit=${r.status})` };
    return { findings: safeNormalize('osv', native, opts) };
  }
  if (tool === 'semgrep') {
    // authz|injection|crypto -> run_semgrep <copy> <ruleset risolto dal manifest>.
    // Il ruleset del binding è relativo alla cartella del manifest del pack.
    const rulesetRel = binding.ruleset;
    if (!rulesetRel) return { error: 'semgrep: nessun ruleset nel binding del manifest' };
    const rulesetAbs = resolve(
      ROOT, 'trueline', 'references', 'ecosystems', manifest.id, rulesetRel,
    );
    if (!existsSync(rulesetAbs)) return { error: `semgrep: ruleset del manifest assente: ${rulesetAbs}` };
    const r = nodeRun(RUN_SEMGREP, [copyDir, rulesetAbs]);
    let native = null;
    try { native = JSON.parse(r.stdout); } catch { /* gestito */ }
    if (!native) return { error: `semgrep: output non parsabile (exit=${r.status}) ${(r.stderr || '').slice(-200)}` };
    return { findings: safeNormalize('semgrep', native, opts) };
  }
  if (tool === 'rls_check' || tool === 'rls' || tool === 'rls-check') {
    // rls -> rls_check <copy>/<scanDir>. La dir di scansione viene dal binding
    // (manifest.oracles.rls.scan), default ["migrations"]. rls_check è STATICO
    // (analizza la DDL, non esegue il DB) -> nessuna dipendenza docker nel floor.
    //
    // PATH-MATCHING (verificato EMPIRICAMENTE, T3.1): rls_check gira con cwd=ROOT
    // (nodeRun) ed emette location.file = relative(ROOT, file) in posix, quindi
    // "eval/.tmp-verify/eco-postgres-py-.../migrations/0001_init.sql". normalize
    // (ramo rls-check) prefissa con opts.base SOLO i path "nudi": un path che parte
    // già da "eval/" passa INVARIATO -> fileOf(finding) TERMINA con
    // "migrations/0001_init.sql" e il match per ancora-file del registry scatta.
    // opts.base resta copyBase (coerente con gli altri oracoli, non altera il path
    // eval/-ancorato): il seed PY-S3 è COLTO senza aggiustamenti speciali.
    const scanDirs = (binding.scan && binding.scan.length) ? binding.scan : ['migrations'];
    const scanned = scanDirs.find((d) => existsSync(join(copyDir, d)));
    const target = scanned ? join(copyDir, scanned) : copyDir;
    const r = nodeRun(RLS_CHECK, [target]);
    let native = null;
    try { native = JSON.parse(r.stdout); } catch { /* gestito */ }
    if (!native) return { error: `rls_check: output non parsabile (exit=${r.status})` };
    return { findings: safeNormalize('rls', native, opts) };
  }
  return { error: `oracolo non gestito per la categoria ${cat}: ${tool}` };
}

function safeNormalize(oracle, native, opts) {
  try { return normalize(oracle, native, opts); } catch { return []; }
}

// Copia la fixtureApp del PACK in una dir temp ISOLATA (eval/.tmp-verify/<id>,
// gitignorata), .git INCLUSO. Mirror dell'isolamento di verify_workspace, ma sulla
// fixture del pack (createVerifyWorkspace è cablato alla reference-app canonica).
// Ritorna { dir, cleanup }.
let __pfCounter = 0;
const TMP_VERIFY_ROOT = resolve(ROOT, 'eval', '.tmp-verify');
function copyPackFixture(id, fixtureApp) {
  try { mkdirSync(TMP_VERIFY_ROOT, { recursive: true }); } catch { /* esiste */ }
  // id unico per-run (pid + counter monotono), niente Date.now/Math.random.
  __pfCounter += 1;
  const dir = join(TMP_VERIFY_ROOT, `eco-${id}-pid${process.pid}-${__pfCounter}`);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  cpSync(fixtureApp, dir, { recursive: true, dereference: false });
  const cleanup = () => {
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* best-effort */ }
    try {
      if (existsSync(TMP_VERIFY_ROOT) && readdirSync(TMP_VERIFY_ROOT).length === 0) {
        rmSync(TMP_VERIFY_ROOT, { recursive: true, force: true });
      }
    } catch { /* best-effort: radice non vuota o lock concorrente non è un errore */ }
  };
  return { dir, cleanup };
}

function relativeFromRoot(abs) { return abs.startsWith(ROOT) ? abs.slice(ROOT.length + 1) : abs; }

// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  const validateOnly = args.includes('--validate-only');
  const id = args.find((a) => !a.startsWith('--'));

  if (!id) {
    usage('ERRORE: <id> ecosistema mancante.');
    process.exit(2);
  }

  console.log(`ecosystem_conformance — <${id}>${validateOnly ? ' (--validate-only)' : ''}`);
  console.log('------------------------------------------------------------');

  // Risoluzione del manifest spedito per <id> (resolve.mjs è la sorgente unica).
  const manifest = loadManifest(id);
  if (!manifest) {
    console.error(`[EXIT 2] nessun manifest spedito per <${id}>: ecosistema sconosciuto.`);
    console.error('         (mai un falso verde — id non risolvibile ≠ conformità.)');
    process.exit(2);
  }

  // --- CRITERIO 1: MANIFEST VALIDO (validate_ecosystem) ----------------------
  const v = validateEcosystem(manifest);
  if (!v.ok) {
    console.error('[FAIL] manifest NON valido (validate_ecosystem):');
    for (const e of v.errors) console.error(`         - ${e}`);
    process.exit(1);
  }
  console.log('[PASS] manifest valido (validate_ecosystem)');
  checks.push({ name: 'manifest valido (validate_ecosystem)', ok: true });

  if (validateOnly) {
    console.log('------------------------------------------------------------');
    console.log(`=== CONFORMANCE <${id}> RESULT: PASS (criterio 1, --validate-only) ===`);
    process.exit(0);
  }

  // --- CRITERI 2..6 ----------------------------------------------------------
  const pack = PACK_FIXTURES[id];
  if (!pack) {
    console.error(`[FAIL] manifest valido ma nessuna fixture/gate di conformità spedito per <${id}>.`);
    console.error('       (usa --validate-only per il solo criterio 1.)');
    process.exit(1);
  }

  // (b) Corpo DETECTION-PARAMETRICO per i pack nuovi (postgres-jsts).
  if (pack.kind === 'detection') {
    const code = runDetectionBody(id, manifest, pack);
    process.exit(code);
  }

  // (a) Ramo DELEGATO (supabase-jsts): individua la fixture e delega a m5 (INVARIATO).
  const missing = pack.requires.filter((p) => !existsSync(p));
  if (missing.length) {
    console.error(`[FAIL] fixture del pack <${id}> mancante:`);
    for (const m of missing) console.error(`         - ${m}`);
    process.exit(1);
  }
  console.log(`[INFO] fixture del pack individuata; delego a ${pack.gate.replace(ROOT, '.')}`);
  console.log('------------------------------------------------------------');

  const res = spawnSync(process.execPath, [pack.gate], { stdio: 'inherit' });
  if (res.error) {
    console.error(`[FAIL] impossibile lanciare il gate del pack: ${res.error.message}`);
    process.exit(1);
  }
  const code = typeof res.status === 'number' ? res.status : 1;

  console.log('------------------------------------------------------------');
  if (code === 0) {
    console.log(`=== CONFORMANCE <${id}> RESULT: PASS (criterio 1 + gate del pack) ===`);
  } else {
    console.log(`=== CONFORMANCE <${id}> RESULT: FAIL (gate del pack exit=${code}) ===`);
  }
  process.exit(code);
}

main();
