# A2c — F1: Meccanismo baseline + pilota supabase-jsts + gate m5 falsificabile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attivare `dup_check`/`cycle_check` come gate BUILD delta-based su `supabase-jsts`, alimentati da un baseline d'igiene DICHIARATO catturabile via `capture`, mantenendo m5 verde (dup/cycle report-only in REMEDIATE) e provando il gate con un keystone falsificabile.

**Architecture:** Nessuna logica di gate nuova. Quattro cablaggi additivi: (1) `partitionBlockers` diventa mode-aware (in REMEDIATE `jscpd`/`cycle` sono report-only come `twin`; in BUILD gata-no sul delta); (2) `capture` (baseline.mjs) impara a eseguire jscpd/madge/twin; (3) `runCheckpoint` carica il baseline d'igiene committato (`<app>/.trueline/hygiene-baseline.json`) e unisce i suoi fingerprint, con vacuity guard (attivo in BUILD + baseline assente → degradato, mai verde); (4) `supabase-jsts` dichiara i due oracoli. Il refresh è la CLI `capture` esistente.

**Tech Stack:** Node ESM, solo built-in (`node:child_process`, `node:fs`, `node:path`, `node:test`, `node:crypto`, `node:os`). Tool esterni già spediti: `jscpd@4` (via `run_dupcheck.mjs`), `madge` (via `run_cyclecheck.mjs`/`module_graph.mjs`). Nessuna dipendenza nuova nel corpo skill.

## Global Constraints

- **`L-COL-002`** — il verdetto è un FATTO d'oracolo/harness, mai una frase dell'LLM.
- **`L-COL-006`** — oracolo non eseguito / baseline assente ≠ verde; coverage declaration sempre presente.
- **`L-COL-024/025`** — git solo nell'orchestratore; branch `feat/a2c-hygiene-activation` (già creato da `main` `7a3e361`); `main` intatto fino al merge human-gated; il gate NON muta git (il refresh è un atto umano). Provisioning `.git`/`node_modules` dei fixture = passo d'orchestratore.
- **`L-COL-028`** — `min_tokens` (dup) versionato nel manifest; cambia solo con commit umano.
- **`L-COL-030`** — detection-only in v1: nessun fix-provider deterministico dup/cycle spedito.
- **BIT-invarianza** — un pack senza `oracles.duplication`/`architecture` e senza baseline d'igiene committato → controllo 1 e VERDETTO byte-identici (m5/A2a/A0/A2b invarianti). Ogni default di funzione preserva i chiamanti legacy.
- **Modello baseline (decisione D1)** — committato, ricalcolo-al-refresh: tra refresh è autoritativo (fp nuovo blocca in BUILD, pre-esistente grandfathered); il refresh (`capture`) ricalcola → scarta il debito risolto (ratchet).
- **Nessun cambio a** `finding.schema.json` / `normalize.mjs` (le categorie `duplication`/`architecture`, i normalizer jscpd/cycle/twin e gli alias già esistono).
- **Windows** — path assoluti/quotati; `NUL` rompe `git add -A` → `rm -f ./NUL` prima di ogni commit.

**Precondizione ambiente (dichiarata, `L-COL-006`):** il gate m5 (`m5_gate_check.mjs`) richiede DB-live + docker/semgrep; su una macchina senza, `m5` esce **2** (precondizione non soddisfatta, NON regressione). Dove m5 non è ri-gateabile in loco, provalo su macchina capace (`eval/db-test/up.ps1`); l'additività resta provata staticamente (unit + keystone A2c + BIT-invarianza).

---

## File Structure

**Modificati:**
- `trueline/scripts/checkpoint/checkpoint.mjs` — `partitionBlockers` (mode-aware via param `detectionOnly`), `control1Hygiene` (calcola `detectionOnly` per-mode + vacuity guard `hygieneBaselineMissing`), `runCheckpoint` (carica+unisce il baseline d'igiene committato, calcola `hygieneBaselineMissing`).
- `trueline/scripts/findings/baseline.mjs` — `ORACLE_ALIASES` (+jscpd/cycle/twin), `oracleInvocation` (+3 case), path const dei wrapper, `opts.minTokens` per jscpd, `--hygiene` come zucchero CLI, `loadHygieneBaseline` esportata.
- `trueline/references/ecosystems/supabase-jsts/ecosystem.json` — `oracles.duplication` + `oracles.architecture`.
- `trueline/SKILL.md` + `trueline/references/modes/build.md` + `trueline/references/modes/remediate.md` — dispatch controllo 1 + coverage declaration.
- `00-INDEX.md` (§4 ledger), `SESSION-STATE.md`.

**Creati:**
- `trueline/scripts/checkpoint/checkpoint.a2c.test.mjs` — unit del gating mode-aware + vacuity guard.
- `trueline/scripts/findings/baseline.a2c.test.mjs` — unit di `capture` sugli oracoli d'igiene + `loadHygieneBaseline`.
- `eval/ecosystems/_a2c-fixtures/{dup-cycle-debt,clean}/…` + `provision_fixtures.sh` — fixture del gate (inner `.git`/`node_modules` provvigionati dall'orchestratore).
- `eval/harness/a2c_hygiene_activation_check.mjs` — keystone falsificabile.

---

## Task 1: Controllo 1 mode-aware (dup/cycle gata-no in BUILD, report-only in REMEDIATE)

Il perno che tiene m5 verde: m5 gira `run_loop --eval --mode=remediate`, quindi in REMEDIATE dup/cycle NON devono bloccare (come `twin`). In BUILD gata-no sul delta.

**Files:**
- Modify: `trueline/scripts/checkpoint/checkpoint.mjs` — `partitionBlockers` (`:166-182`), `control1Hygiene` (`:262`).
- Test: `trueline/scripts/checkpoint/checkpoint.a2c.test.mjs`

**Interfaces:**
- Consumes: `DETECTION_ONLY_ORACLES` (`:70`), `ABSOLUTE_GATE_ORACLES` (`:75`), `control1Hygiene` firma `(referenceApp, { baseline, runOpts, manifest, mode, blueprintDir })`.
- Produces: `partitionBlockers(findings, baseline, detectionOnly = DETECTION_ONLY_ORACLES)`; `control1Hygiene` passa un `detectionOnly` per-mode.

- [ ] **Step 1: Scrivere il test**

```js
// checkpoint.a2c.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionBlockers } from './checkpoint.mjs';

// finding sintetici minimali (partitionBlockers usa solo fingerprint + source_oracle.oracle + fix_state).
const mk = (oracle, fp) => ({ source_oracle: { oracle }, fingerprint: fp, category: 'x', severity: 'LOW' });
const EMPTY = new Set();

test('BUILD (default detectionOnly={twin}): dup/cycle NUOVI bloccano; twin no', () => {
  const findings = [mk('jscpd', 'a'), mk('cycle', 'b'), mk('twin', 'c')];
  const blockers = partitionBlockers(findings, EMPTY); // default = solo twin detection-only
  const oracles = blockers.map((f) => f.source_oracle.oracle).sort();
  assert.deepEqual(oracles, ['cycle', 'jscpd'], 'in BUILD dup/cycle bloccano, twin no');
});

test('REMEDIATE (detectionOnly={twin,jscpd,cycle}): dup/cycle NON bloccano', () => {
  const findings = [mk('jscpd', 'a'), mk('cycle', 'b'), mk('twin', 'c')];
  const detectionOnly = new Set(['twin', 'jscpd', 'cycle']);
  const blockers = partitionBlockers(findings, EMPTY, detectionOnly);
  assert.equal(blockers.length, 0, 'in REMEDIATE dup/cycle sono report-only');
});

test('pre-esistente (fp in baseline) non blocca in nessuna modalità', () => {
  const findings = [mk('jscpd', 'a')];
  const blockers = partitionBlockers(findings, new Set(['a'])); // BUILD default
  assert.equal(blockers.length, 0);
});
```

- [ ] **Step 2: Eseguire → FAIL** (partitionBlockers ignora il 3° argomento; il 2° test vede `jscpd`/`cycle` come blockers)

Run: `node --test trueline/scripts/checkpoint/checkpoint.a2c.test.mjs`
Expected: FAIL sul test REMEDIATE (`blockers.length` = 2, atteso 0).

- [ ] **Step 3: Rendere `partitionBlockers` parametrico (default = comportamento attuale)**

In `checkpoint.mjs`, sostituire la firma e il controllo detection-only (`:166` e `:178`):

```js
export function partitionBlockers(findings, baseline, detectionOnly = DETECTION_ONLY_ORACLES) {
  const out = [];
  for (const f of findings) {
    const oracle = f.source_oracle && f.source_oracle.oracle;
    const absolute = ABSOLUTE_GATE_ORACLES.has(oracle);
    const isNew = !baseline.has(f.fingerprint);
    f.baseline_status = isNew ? 'new' : 'pre-existing';
    if (f.fix_state === 'accepted-risk') continue;
    if (!isNew && !absolute) continue;
    if (detectionOnly.has(oracle)) continue; // detection-only: segnale, mai gate
    out.push(f);
  }
  return out;
}
```

- [ ] **Step 4: `control1Hygiene` calcola il set detection-only per-mode**

In `control1Hygiene`, sostituire la riga `const blockers = partitionBlockers(all, baseline);` (`:262`) con:

```js
  // Mode-aware (A2c): in BUILD dup/cycle gata-no sul DELTA (vs baseline d'igiene
  // committato); in REMEDIATE sono REPORT-ONLY (audit del debito, non gate — come
  // twin). twin resta detection-only in entrambe. BIT-invariante per i pack senza
  // dup/cycle dichiarati (nessun finding jscpd/cycle in `all`).
  const detectionOnly = mode === 'build'
    ? DETECTION_ONLY_ORACLES
    : new Set([...DETECTION_ONLY_ORACLES, 'jscpd', 'cycle']);
  const blockers = partitionBlockers(all, baseline, detectionOnly);
```

- [ ] **Step 5: Eseguire → PASS**

Run: `node --test trueline/scripts/checkpoint/checkpoint.a2c.test.mjs`
Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
rm -f ./NUL 2>/dev/null
git add trueline/scripts/checkpoint/checkpoint.mjs trueline/scripts/checkpoint/checkpoint.a2c.test.mjs
git commit -m "feat(a2c): controllo 1 mode-aware — dup/cycle gate in BUILD, report-only in REMEDIATE"
```

---

## Task 2: `capture` esegue jscpd/madge/twin (produce il baseline d'igiene)

`baseline.mjs::capture` oggi conosce solo gitleaks/rls-check/knip/osv. Per catturare un baseline d'igiene deve eseguire anche i tre wrapper. `normalize`/`normalizeAll` già conoscono jscpd/cycle/twin (normalize.mjs:1290-1409), quindi serve solo il dispatch d'INVOCAZIONE.

**Files:**
- Modify: `trueline/scripts/findings/baseline.mjs` — `ORACLE_ALIASES` (`:146-157`), `oracleInvocation` (`:122-142`), path const (dopo `:70`), `capture` (thread `opts.minTokens`), CLI (`--hygiene`).
- Test: `trueline/scripts/findings/baseline.a2c.test.mjs`

**Interfaces:**
- Consumes: `run_dupcheck.mjs <dir> [minTokens]` → `{oracle:'jscpd', minTokens, duplicates:[…]}`; `run_cyclecheck.mjs <dir>` → `{oracle:'cycle', tool:'madge', cycles:[…]}`; `twin_check.mjs <dir>` → `{oracle:'twin', twins:[…]}`; `normalizeAll(pairs, runOpts)`.
- Produces: `capture(dir, ['jscpd','cycle','twin'], { minTokens })` → snapshot con fingerprint di categoria `duplication`/`architecture`.

- [ ] **Step 1: Scrivere il test** (usa `twin_check`, deterministico e dep-free; jscpd con skip-se-assente)

```js
// baseline.a2c.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { capture, loadHygieneBaseline } from './baseline.mjs';

const OPTS = { runId: 'a2c', createdAt: '1970-01-01T00:00:00.000Z' };

test('capture con twin: due dir sorelle parallele -> snapshot con finding architecture(twin)', () => {
  const d = mkdtempSync(join(tmpdir(), 'a2c-cap-'));
  for (const [ent, files] of [['commesse', ['useAcconto', 'useElenco', 'Dettaglio']],
    ['preventivi', ['useAcconto', 'useElenco', 'Dettaglio']]]) {
    mkdirSync(join(d, ent), { recursive: true });
    for (const f of files) writeFileSync(join(d, ent, `${f}.ts`), 'export const x = 1;');
  }
  const res = capture(d, ['twin'], OPTS);
  rmSync(d, { recursive: true, force: true });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  const twins = res.findings.filter((f) => f.source_oracle.oracle === 'twin');
  assert.ok(twins.length >= 1, 'atteso >=1 finding twin nello snapshot');
  assert.equal(twins[0].category, 'architecture');
  assert.ok(Array.isArray(res.snapshot.fingerprints) && res.snapshot.fingerprints.includes(twins[0].fingerprint));
});

test('capture con jscpd: due file con blocco identico -> finding duplication (skip se jscpd assente)', () => {
  const d = mkdtempSync(join(tmpdir(), 'a2c-dup-'));
  const block = Array.from({ length: 20 }, (_, i) => `  const v${i} = compute(${i}) + helper(${i}) * 2;`).join('\n');
  writeFileSync(join(d, 'a.ts'), `export function a(){\n${block}\n  return 1;\n}`);
  writeFileSync(join(d, 'b.ts'), `export function b(){\n${block}\n  return 2;\n}`);
  const res = capture(d, ['jscpd'], { ...OPTS, minTokens: 50 });
  rmSync(d, { recursive: true, force: true });
  // jscpd offline (npx non risolve) -> capture dichiara l'errore, NON falsifica.
  const dup = (res.findings || []).filter((f) => f.category === 'duplication');
  if (res.ok && dup.length >= 1) {
    assert.equal(dup[0].source_oracle.oracle, 'jscpd');
  } else {
    assert.ok(res.errors.some((e) => /jscpd/i.test(e)), `jscpd assente dichiarato: ${JSON.stringify(res.errors)}`);
  }
});
```

- [ ] **Step 2: Eseguire → FAIL** (`capture` non conosce `twin`/`jscpd`; `loadHygieneBaseline` non esiste ancora → errore di import)

Run: `node --test trueline/scripts/findings/baseline.a2c.test.mjs`
Expected: FAIL — `loadHygieneBaseline` non esportata / `oracolo sconosciuto: twin`.

- [ ] **Step 3: Aggiungere i path const dei wrapper** (dopo `const RUN_OSV = …`, `:70`)

```js
// A2a/A2c — oracoli d'igiene (per catturare il baseline d'igiene delta).
const RUN_DUPCHECK = resolve(ORACLES, 'run_dupcheck.mjs');
const RUN_CYCLECHECK = resolve(ORACLES, 'run_cyclecheck.mjs');
const TWIN_CHECK = resolve(ORACLES, 'twin_check.mjs');
```

- [ ] **Step 4: Estendere `ORACLE_ALIASES`** (`:146-157`) con le voci d'igiene (prima della `}` di chiusura):

```js
  // A2c — oracoli d'igiene strutturale (baseline d'igiene delta).
  jscpd: 'jscpd',
  duplication: 'jscpd',
  'dup-check': 'jscpd',
  cycle: 'cycle',
  architecture: 'cycle',
  madge: 'cycle',
  'cycle-check': 'cycle',
  twin: 'twin',
  'twin-check': 'twin',
```

- [ ] **Step 5: Estendere `oracleInvocation`** (`:122-142`) con i tre case (prima di `default:`), threadando `minTokens`:

```js
    case 'jscpd':
      return { script: RUN_DUPCHECK, args: [projectDir, String(minTokens)], scope: 'working-tree', normOracle: 'jscpd' };
    case 'cycle':
      return { script: RUN_CYCLECHECK, args: [projectDir], scope: 'working-tree', normOracle: 'cycle' };
    case 'twin':
      return { script: TWIN_CHECK, args: [projectDir], scope: 'working-tree', normOracle: 'twin' };
```

Aggiornare la firma di `oracleInvocation` (`:122`) per ricevere `minTokens`:

```js
function oracleInvocation(canon, projectDir, minTokens = 50) {
```

E in `capture` (`:199`), passare il `minTokens` risolto dalle opzioni:

```js
    const inv = oracleInvocation(canon, dir, Number(opts.minTokens) || 50);
```

- [ ] **Step 6: Aggiungere `loadHygieneBaseline` esportata** (dopo `readBaseline`, `:338`)

```js
// A2c — carica il baseline d'igiene COMMITTATO di un progetto, se presente.
// Ritorna { present, set:Set<fingerprint> }. Path tracciato: <dir>/.trueline/
// hygiene-baseline.json (nel progetto utente va tracciato con negazione .gitignore;
// vedi references/modes). Assente -> { present:false, set:new Set() } (BIT-invarianza:
// il checkpoint unisce un set vuoto). Illeggibile/corrotto -> present:false (fail-safe:
// il vacuity guard del checkpoint lo tratta come "manca il baseline").
export function hygieneBaselinePath(projectDir) {
  return resolve(projectDir, '.trueline', 'hygiene-baseline.json');
}
export function loadHygieneBaseline(projectDir) {
  const p = hygieneBaselinePath(projectDir);
  if (!existsSync(p)) return { present: false, set: new Set() };
  try {
    const snap = JSON.parse(readFileSync(p, 'utf8'));
    const fps = Array.isArray(snap.fingerprints)
      ? snap.fingerprints
      : (snap.findings && typeof snap.findings === 'object' ? Object.keys(snap.findings) : []);
    return { present: true, set: new Set(fps) };
  } catch {
    return { present: false, set: new Set() };
  }
}
```

- [ ] **Step 7: Zucchero CLI `--hygiene`** — in `resolveOracleList` (`:366`), espandere `--hygiene` a `jscpd,cycle,twin`:

```js
function resolveOracleList(flags) {
  if (flags.hygiene) return ['jscpd', 'cycle', 'twin'];
  let list = flags.oracles
    ? String(flags.oracles).split(',').map((s) => s.trim()).filter(Boolean)
    : [...DEFAULT_ORACLES];
  if (flags['no-osv']) list = list.filter((o) => canonicalOracle(o) !== 'osv');
  return list;
}
```

E in `parseArgs` (`:356`), registrare `hygiene` fra le flag booleane:

```js
      if (key === 'no-osv' || key === 'hygiene') { flags[key] = true; continue; }
```

Threadare `minTokens` dalla CLI: in `main` (`:389`), aggiungere alle `runOpts` passate a `capture` il campo `minTokens: Number(flags['min-tokens']) || 50` (capture lo legge da `opts.minTokens`).

- [ ] **Step 8: Eseguire → PASS**

Run: `node --test trueline/scripts/findings/baseline.a2c.test.mjs`
Expected: PASS (2/2: twin sempre; jscpd PASS-o-skip-dichiarato). Poi la regressione: `node --test trueline/scripts/findings/baseline.test.mjs` (se presente) → invariato.

- [ ] **Step 9: Commit**

```bash
rm -f ./NUL 2>/dev/null
git add trueline/scripts/findings/baseline.mjs trueline/scripts/findings/baseline.a2c.test.mjs
git commit -m "feat(a2c): capture esegue jscpd/madge/twin + loadHygieneBaseline + --hygiene (baseline d'igiene delta)"
```

---

## Task 3: `runCheckpoint` carica il baseline d'igiene committato + vacuity guard

Il gate BUILD delta ha bisogno che i fingerprint pre-esistenti d'igiene siano nel `baseline`. Li carica `runCheckpoint` dal file committato e li unisce. Il vacuity guard (`L-COL-006`): in BUILD, oracoli d'igiene dichiarati MA baseline assente → controllo 1 **degradato/rosso** (non un verde silenzioso, non un'ondata cieca di blocker).

**Files:**
- Modify: `trueline/scripts/checkpoint/checkpoint.mjs` — import di `loadHygieneBaseline`; `runCheckpoint` (`:793`, union baseline + calcolo `hygieneBaselineMissing`); `control1Hygiene` (nuovo param + declassamento).
- Test: `trueline/scripts/checkpoint/checkpoint.a2c.test.mjs` (estende Task 1).

**Interfaces:**
- Consumes: `loadHygieneBaseline(projectDir)` → `{present,set}` (Task 2).
- Produces: `control1Hygiene(referenceApp, { …, hygieneBaselineMissing })` → se `true` in BUILD, `green=false` + status degradato.

- [ ] **Step 1: Scrivere il test** (aggiungere a `checkpoint.a2c.test.mjs`)

```js
import { control1Hygiene } from './checkpoint.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Un progetto minimale su cui control1Hygiene gira (dead-code via run_deadcode può
// degradare senza node_modules: il focus qui è il VACUITY GUARD, non i finding).
function miniApp() {
  const d = mkdtempSync(join(tmpdir(), 'a2c-app-'));
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'src', 'index.ts'), 'export const x = 1;\n');
  writeFileSync(join(d, 'package.json'), '{"name":"mini","version":"1.0.0"}\n');
  return d;
}
const DECL = { oracles: { duplication: { tool: 'jscpd', min_tokens: 50 }, architecture: { tool: 'madge' } }, languages: ['ts'] };
const RUN = { runId: 'a2c', createdAt: '1970-01-01T00:00:00.000Z' };

test('vacuity guard: BUILD + dup/cycle dichiarati + baseline assente -> control1 NON verde', () => {
  const d = miniApp();
  const c1 = control1Hygiene(d, { baseline: new Set(), runOpts: RUN, manifest: DECL, mode: 'build', hygieneBaselineMissing: true });
  rmSync(d, { recursive: true, force: true });
  assert.equal(c1.green, false, 'baseline d\'igiene mancante in BUILD -> non verde (L-COL-006)');
  assert.match(c1.detail, /baseline/i);
});

test('vacuity guard NON scatta in REMEDIATE (dup/cycle report-only, baseline irrilevante)', () => {
  const d = miniApp();
  const c1 = control1Hygiene(d, { baseline: new Set(), runOpts: RUN, manifest: DECL, mode: 'remediate', hygieneBaselineMissing: true });
  rmSync(d, { recursive: true, force: true });
  // In REMEDIATE non c'è gate d'igiene: il verdetto dipende solo dal dead-code (qui assente/degr),
  // MAI dal guard d'igiene. Asseriamo che il guard non abbia forzato un rosso "baseline".
  assert.doesNotMatch(c1.detail || '', /baseline d'igiene mancante/i);
});
```

- [ ] **Step 2: Eseguire → FAIL** (`control1Hygiene` ignora `hygieneBaselineMissing`)

Run: `node --test trueline/scripts/checkpoint/checkpoint.a2c.test.mjs`
Expected: FAIL sul primo nuovo test (`c1.green` = true).

- [ ] **Step 3: Import + parametro + declassamento in `control1Hygiene`**

In cima a `checkpoint.mjs` (accanto agli altri import da `../findings/`), aggiungere:

```js
import { loadHygieneBaseline } from '../findings/baseline.mjs';
```

Nella firma di `control1Hygiene` (`:195`), aggiungere il param:

```js
export function control1Hygiene(referenceApp, { baseline = new Set(), runOpts, manifest = null, mode = 'remediate', blueprintDir = null, hygieneBaselineMissing = false }) {
```

Subito dopo il calcolo di `blockers`/`green` (`:262-263`), applicare il declassamento (il guard è BUILD-only per costruzione: `hygieneBaselineMissing` sarà `true` solo in BUILD, vedi runCheckpoint):

```js
  const detectionOnly = mode === 'build'
    ? DETECTION_ONLY_ORACLES
    : new Set([...DETECTION_ONLY_ORACLES, 'jscpd', 'cycle']);
  const blockers = partitionBlockers(all, baseline, detectionOnly);
  // Vacuity guard (A2c, L-COL-006): oracoli d'igiene attivi in BUILD ma baseline
  // d'igiene DICHIARATO assente -> NON verde (né un'ondata cieca di blocker sul
  // debito legacy, né un verde silenzioso). Segnale chiaro: "esegui il refresh".
  const green = blockers.length === 0 && !archDegraded && !hygieneBaselineMissing;
  return {
    id: 1, name: 'dead-code', status: green ? 'green' : 'red', green,
    detail: hygieneBaselineMissing && blockers.length === 0 && !archDegraded
      ? `baseline d'igiene mancante (dup/cycle attivi in BUILD) — NON verde (L-COL-006): esegui \`baseline.mjs capture <dir> --hygiene\` [${sub.join(' ')}]`
      : green
        ? `nessuna regressione d'igiene NUOVA [${sub.join(' ')}] (pre-esistenti segnalati)`
        : archDegraded && blockers.length === 0
          ? `arch degradato (contratto vacuo / non eseguito) — NON verde (L-COL-006) [${sub.join(' ')}]`
          : `${blockers.length} finding d'igiene NUOVO introdotto [${sub.join(' ')}]`,
    findings: all, blockers,
  };
```

(Sostituisce il blocco `const blockers = …; const green = …; return {…}` esistente — NON duplicarlo: rimuovere il precedente Step 4 di Task 1 e questo lo assorbe. La riga `const detectionOnly …` compare UNA volta.)

- [ ] **Step 4: `runCheckpoint` unisce il baseline d'igiene + calcola `hygieneBaselineMissing`**

In `runCheckpoint`, prima delle chiamate ai controlli (`:793`), sostituire:

```js
  const c1 = control1Hygiene(referenceApp, { baseline, runOpts, manifest, mode, blueprintDir });
```

con:

```js
  // A2c — baseline d'igiene COMMITTATO: unisci i suoi fingerprint (disgiunti per
  // oracolo da quelli di sicurezza) al baseline in-run, così dup/cycle pre-esistenti
  // sono grandfathered in BUILD. Vacuity guard: in BUILD con dup/cycle dichiarati ma
  // file assente -> hygieneBaselineMissing (control1 non verde). BIT-invarianza: nessun
  // pack dichiara dup/cycle e nessun file presente -> union vuota, guard false.
  const hb = loadHygieneBaseline(referenceApp);
  const baselineWithHygiene = hb.set.size ? new Set([...baseline, ...hb.set]) : baseline;
  const declaresHygiene = Boolean(manifest && manifest.oracles
    && (manifest.oracles.duplication || manifest.oracles.architecture));
  const hygieneBaselineMissing = mode === 'build' && declaresHygiene && !hb.present;
  const c1 = control1Hygiene(referenceApp, {
    baseline: baselineWithHygiene, runOpts, manifest, mode, blueprintDir, hygieneBaselineMissing,
  });
```

(Nota: `control2Security`/3/4 continuano a ricevere `baseline` originale — i fingerprint d'igiene non li riguardano; unione solo per il controllo 1.)

- [ ] **Step 5: Eseguire → PASS**

Run: `node --test trueline/scripts/checkpoint/checkpoint.a2c.test.mjs`
Expected: PASS (5/5).

- [ ] **Step 6: Regressione unit checkpoint invariata**

Run: `node --test trueline/scripts/checkpoint/checkpoint.a2a.test.mjs trueline/scripts/checkpoint/checkpoint.a0.test.mjs` (se presenti)
Expected: PASS (BIT-invarianza: nessun pack dichiara dup/cycle, nessun file d'igiene → union vuota, guard false).

- [ ] **Step 7: Commit**

```bash
rm -f ./NUL 2>/dev/null
git add trueline/scripts/checkpoint/checkpoint.mjs trueline/scripts/checkpoint/checkpoint.a2c.test.mjs
git commit -m "feat(a2c): runCheckpoint carica+unisce il baseline d'igiene committato + vacuity guard BUILD-only"
```

---

## Task 4: Attivare `supabase-jsts` + verificare m5 verde

Il pilota. Dopo Task 1 (mode-aware), attivare i due oracoli su `supabase-jsts` NON deve rompere m5 (che gira REMEDIATE → dup/cycle report-only).

**Files:**
- Modify: `trueline/references/ecosystems/supabase-jsts/ecosystem.json` (`:8-16`).
- Test: `node trueline/scripts/ecosystem/validate_ecosystem.mjs …` + `node eval/harness/m5_gate_check.mjs`.

**Interfaces:**
- Consumes: `control1Hygiene` mode-aware (Task 1), `validate_ecosystem` (vocabolario categorie A0 già accetta duplication/architecture).

- [ ] **Step 1: Aggiungere i binding al manifest** — in `oracles` (dopo `"dead-code": { "tool": "knip" },`, `:14`):

```json
    "dead-code":       { "tool": "knip" },
    "duplication":     { "tool": "jscpd", "min_tokens": 50 },
    "architecture":    { "tool": "madge" },
```

- [ ] **Step 2: Validare il manifest**

Run: `node trueline/scripts/ecosystem/validate_ecosystem.mjs trueline/references/ecosystems/supabase-jsts/ecosystem.json`
Expected: OK (le categorie `duplication`/`architecture` sono nell'enum `finding.schema.json`; il guard vocabolario A0 le accetta).

- [ ] **Step 3: (Orchestratore) provisioning tool nel reference-app** — perché in m5 dup/cycle GIRINO (non `dup:degr`), copiare `jscpd`/`madge` nel `node_modules` del reference-app canonico (offline, come per gli altri fixture). Se non provvigionati, in REMEDIATE degradano `dup:degr`/`cycle:degr` e m5 resta comunque verde (report-only). Documentare quale delle due si è scelto.

Run (provisioning, esempio): `bash -c 'cp -R "$(npm root)/jscpd" eval/reference-app/node_modules/ 2>/dev/null; cp -R "$(npm root)/madge" eval/reference-app/node_modules/ 2>/dev/null; true'`

- [ ] **Step 4: Eseguire m5** (richiede DB-live + docker/semgrep; altrimenti exit 2 = precondizione, dichiarato)

Run: `node eval/harness/m5_gate_check.mjs`
Expected: **RESULT: PASS (56/56)** — il checkpoint (criterio 6) è verde: in REMEDIATE dup/cycle NON bloccano (report-only). Se esce **2**: precondizione ambiente non soddisfatta (DB/docker), NON regressione — ri-eseguire su macchina capace (`eval/db-test/up.ps1`).

- [ ] **Step 5: Commit**

```bash
rm -f ./NUL 2>/dev/null
git add trueline/references/ecosystems/supabase-jsts/ecosystem.json
git commit -m "feat(a2c): attiva dup/cycle su supabase-jsts (pilota); m5 56/56 (report-only in REMEDIATE)"
```

---

## Task 5: Keystone A2c + fixture (il gate falsificabile)

Prova end-to-end del gate BUILD: baseline grandfather-a il debito, il debito NUOVO blocca, il baseline è load-bearing, il vacuity guard scatta, twin segnala senza bloccare.

**Files:**
- Create: `eval/ecosystems/_a2c-fixtures/dup-cycle-debt/{package.json, supabase/config.toml, src/…}` + `provision_fixtures.sh`.
- Create: `eval/harness/a2c_hygiene_activation_check.mjs`.
- Modify: `.gitignore` (inner `.git`/`node_modules` dei fixture A2c gitignorati; sorgenti tracciati).

**Interfaces:**
- Consumes: `capture`/`writeBaseline`/`hygieneBaselinePath` (Task 2), `runCheckpoint`/`control1Hygiene` mode-aware + vacuity (Task 1/3).
- Produces: `a2c_hygiene_activation_check.mjs` → exit 0 se tutti i sotto-test passano; sotto-test `preexisting:green`, `newdebt:red`, `baseline-loadbearing`, `vacuity:missing-baseline`, `twin:signal-not-gate`, `falsifiable`.

- [ ] **Step 1: Costruire la fixture `dup-cycle-debt`**

Struttura minima classificabile come `supabase-jsts` (marker `supabase/config.toml` + `package.json`), con debito d'igiene REALE:
- `src/a.ts` e `src/b.ts` con un blocco ≥50 token identico (clone verbatim).
- `src/x.ts` ↔ `src/y.ts` con import circolare (`import './y'` / `import './x'`).
- `package.json` (name/version) + `supabase/config.toml` (vuoto, marker).

```bash
FX=eval/ecosystems/_a2c-fixtures/dup-cycle-debt
mkdir -p "$FX/src" "$FX/supabase"
printf '{"name":"a2c-dup-cycle-debt","version":"1.0.0","private":true}\n' > "$FX/package.json"
printf '# marker supabase-jsts (A2c fixture)\n' > "$FX/supabase/config.toml"
# clone verbatim >=50 token in due file
BLOCK=$(for i in $(seq 0 19); do printf '  const v%s = compute(%s) + helper(%s) * 2;\n' "$i" "$i" "$i"; done)
printf 'export function a(){\n%s\n  return 1;\n}\n' "$BLOCK" > "$FX/src/a.ts"
printf 'export function b(){\n%s\n  return 2;\n}\n' "$BLOCK" > "$FX/src/b.ts"
# ciclo import x<->y
printf "import './y';\nexport const x = 1;\n" > "$FX/src/x.ts"
printf "import './x';\nexport const y = 1;\n" > "$FX/src/y.ts"
```

- [ ] **Step 2: `.gitignore` — inner repo/deps dei fixture A2c**

Aggiungere in fondo a `.gitignore`:

```
# A2c: fixture del gate attivazione igiene — sorgenti TRACKED (materiale di gate);
# inner .git e node_modules (jscpd/madge) provvigionati a runtime dall'orchestratore.
eval/ecosystems/_a2c-fixtures/**/.git/
eval/ecosystems/_a2c-fixtures/**/node_modules/
eval/ecosystems/_a2c-fixtures/**/.trueline/
```

- [ ] **Step 3: `provision_fixtures.sh` (orchestratore)** — inner `.git` + `node_modules` (jscpd/madge) copiati offline.

```bash
# eval/ecosystems/_a2c-fixtures/provision_fixtures.sh
#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
for fx in dup-cycle-debt clean; do
  d="$here/$fx"; [ -d "$d" ] || continue
  ( cd "$d" && { [ -d .git ] || { git init -q && git add -A && git -c user.email=a@b.c -c user.name=t commit -qm init; }; } )
  mkdir -p "$d/node_modules"
  for pkg in jscpd madge; do
    src="$(node -e "process.stdout.write(require('path').dirname(require.resolve(process.argv[1]+'/package.json')))" "$pkg" 2>/dev/null || true)"
    [ -n "$src" ] && [ ! -d "$d/node_modules/$pkg" ] && cp -R "$src" "$d/node_modules/$pkg" || true
  done
done
```

- [ ] **Step 4: Costruire la fixture `clean`** (contrasto — nessun debito):

```bash
FX=eval/ecosystems/_a2c-fixtures/clean
mkdir -p "$FX/src" "$FX/supabase"
printf '{"name":"a2c-clean","version":"1.0.0","private":true}\n' > "$FX/package.json"
printf '# marker supabase-jsts (A2c fixture)\n' > "$FX/supabase/config.toml"
printf 'export const alpha = () => 1;\n' > "$FX/src/alpha.ts"
printf 'export const beta = () => 2;\n' > "$FX/src/beta.ts"
```

- [ ] **Step 5: Scrivere il keystone `a2c_hygiene_activation_check.mjs`**

```js
#!/usr/bin/env node
// a2c_hygiene_activation_check.mjs — keystone A2c. Verità = FATTO d'oracolo (L-COL-002).
// Prova il gate BUILD delta d'igiene: baseline grandfather-a il debito; il debito NUOVO
// blocca; il baseline è load-bearing; il vacuity guard scatta; twin segnala senza gatare.
import { control1Hygiene } from '../../trueline/scripts/checkpoint/checkpoint.mjs';
import { capture, writeBaseline, hygieneBaselinePath } from '../../trueline/scripts/findings/baseline.mjs';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = resolve(HERE, '..', 'ecosystems', '_a2c-fixtures', 'dup-cycle-debt');
const MANIFEST = { oracles: { duplication: { tool: 'jscpd', min_tokens: 50 }, architecture: { tool: 'madge' } }, languages: ['ts'] };
const RUN = { runId: 'a2c', createdAt: '1970-01-01T00:00:00.000Z' };

let fails = 0;
const check = (n, c, d) => { if (!c) { fails++; console.log(`  [FAIL] ${n} — ${d}`); } else console.log(`  [ok]   ${n}`); };

if (!existsSync(FIX)) { console.error(`precondizione: fixture ${FIX} assente (provision_fixtures.sh)`); process.exit(2); }
if (!existsSync(join(FIX, 'node_modules', 'jscpd')) || !existsSync(join(FIX, 'node_modules', 'madge'))) {
  console.error('precondizione: jscpd/madge non provvigionati nel fixture (provision_fixtures.sh)'); process.exit(2);
}

// Copia di lavoro (il capture solo legge, ma il gate ripetibile richiede una copia).
const work = mkdtempSync(join(tmpdir(), 'a2c-ks-'));
cpSync(FIX, work, { recursive: true });

(async () => {
  const { loadHygieneBaseline } = await import('../../trueline/scripts/findings/baseline.mjs');
  const c1 = (dir, missing) => {
    const hb = loadHygieneBaseline(dir);
    return control1Hygiene(dir, { baseline: hb.set, runOpts: RUN, manifest: MANIFEST, mode: 'build', hygieneBaselineMissing: missing });
  };

  // (0) vacuity: nessun baseline committato + dup/cycle attivi in BUILD -> NON verde.
  const vac = c1(work, true);
  check('vacuity:missing-baseline', vac.green === false && /baseline/i.test(vac.detail),
    `atteso non-verde con nota baseline, visto green=${vac.green} detail=${vac.detail}`);

  // (1) cattura il baseline d'igiene del debito esistente e scrivilo nel path tracciato.
  const cap = capture(work, ['jscpd', 'cycle', 'twin'], { ...RUN, minTokens: 50 });
  if (!cap.ok) { console.error(`capture fallita: ${cap.detail} ${JSON.stringify(cap.errors)}`); process.exit(2); }
  writeBaseline(hygieneBaselinePath(work), cap.snapshot);
  const dupCount = cap.findings.filter((f) => f.category === 'duplication').length;
  const cycCount = cap.findings.filter((f) => f.source_oracle.oracle === 'cycle').length;
  check('capture:non-vacuo', dupCount >= 1 && cycCount >= 1, `dup=${dupCount} cycle=${cycCount} (debito reale nel fixture)`);

  // (2) preexisting:green — con baseline, il debito pre-esistente è grandfathered.
  const pre = c1(work, false);
  check('preexisting:green', pre.green === true, `atteso verde (debito grandfathered), visto green=${pre.green} detail=${pre.detail}`);
  check('twin:signal-not-gate', pre.findings.some((f) => f.source_oracle.oracle === 'twin') === false || pre.green === true,
    'twin non deve gatare (segnale)');

  // (3) newdebt:red — introduci un clone NUOVO (oltre il baseline) -> blocca.
  const block = Array.from({ length: 20 }, (_, i) => `  const w${i} = tally(${i}) - shift(${i}) * 3;`).join('\n');
  writeFileSync(join(work, 'src', 'c.ts'), `export function c(){\n${block}\n  return 3;\n}\n`);
  writeFileSync(join(work, 'src', 'd.ts'), `export function d(){\n${block}\n  return 4;\n}\n`);
  const nu = c1(work, false); // baseline invariato (non ri-catturato)
  check('newdebt:red', nu.green === false && nu.blockers.some((b) => b.category === 'duplication'),
    `atteso rosso con blocker duplication NUOVO, visto green=${nu.green} blockers=${nu.blockers.length}`);

  // (4) baseline-loadbearing — svuota il baseline -> TUTTO il debito torna new -> rosso.
  writeBaseline(hygieneBaselinePath(work), { version: 1, fingerprints: [], findings: {} });
  const empty = c1(work, false);
  check('baseline-loadbearing', empty.green === false && empty.blockers.length >= dupCount,
    `baseline svuotato -> tutto il debito è new (rosso), visto green=${empty.green} blockers=${empty.blockers.length} (>=${dupCount})`);

  rmSync(work, { recursive: true, force: true });
  console.log(fails === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fails})`);
  process.exit(fails === 0 ? 0 : 1);
})();
```

- [ ] **Step 6: Provisionare ed eseguire il keystone**

Run: `bash eval/ecosystems/_a2c-fixtures/provision_fixtures.sh && node eval/harness/a2c_hygiene_activation_check.mjs`
Expected: `RESULT: PASS` — `vacuity:missing-baseline`, `capture:non-vacuo`, `preexisting:green`, `twin:signal-not-gate`, `newdebt:red`, `baseline-loadbearing`.

- [ ] **Step 7: Falsificabilità end-to-end** (documentare comando + output, nessuna modifica residua)

Neutralizzare (copia di lavoro) il ramo mode-aware in `control1Hygiene` — forzare `detectionOnly` a includere sempre `jscpd`/`cycle` anche in BUILD:

```js
// TEMPORANEO (falsificabilità): const detectionOnly = new Set([...DETECTION_ONLY_ORACLES,'jscpd','cycle']);
```

Run: `node eval/harness/a2c_hygiene_activation_check.mjs`
Expected: **FAIL** su `newdebt:red` (il debito nuovo non blocca più → il gate era davvero load-bearing). Poi RIPRISTINARE e ri-eseguire → PASS. Verificare `git diff --quiet trueline/scripts/checkpoint/checkpoint.mjs`.

- [ ] **Step 8: Commit**

```bash
rm -f ./NUL 2>/dev/null
git add eval/ecosystems/_a2c-fixtures eval/harness/a2c_hygiene_activation_check.mjs .gitignore
git commit -m "feat(a2c): keystone a2c_hygiene_activation_check + fixture (gate BUILD delta falsificabile)"
```

---

## Task 6: Gate integrale SERIALE + coverage declaration + ledger

Il gate della fase F1.

**Files:**
- Modify: `trueline/SKILL.md` + `trueline/references/modes/build.md` + `trueline/references/modes/remediate.md` (dispatch + coverage declaration), `00-INDEX.md` (§4), `SESSION-STATE.md`.

- [ ] **Step 1: Keystone A2c + unit A2c**

Run: `node eval/harness/a2c_hygiene_activation_check.mjs` → PASS; `node --test trueline/scripts/checkpoint/checkpoint.a2c.test.mjs trueline/scripts/findings/baseline.a2c.test.mjs` → tutti PASS.

- [ ] **Step 2: Non-regressione — BIT-invarianza (SERIALE, `L-COL-002`)**

Run (uno per volta): `node eval/harness/a2a_hygiene_check.mjs` (SYNTH_MANIFEST invariato) · `node eval/harness/a2b_arch_check.mjs` → 8/8 · `node eval/harness/a0_authz_gate_check.mjs` → 16/16 · `node eval/harness/anti_tamper_check.mjs` → 49/49 · `node eval/harness/build_discipline_check.mjs` → 21/21.
Expected: tutti invariati (nessun pack oltre supabase-jsts dichiara dup/cycle; nessun baseline d'igiene committato → union vuota, guard false → controllo 1 byte-identico).

- [ ] **Step 3: m5 + conformance + lint**

Run: `node eval/harness/m5_gate_check.mjs` → **56/56** (o exit 2 = precondizione ambiente, da ri-provare su macchina capace). `node eval/harness/ecosystem_conformance.mjs supabase-jsts` → invariante (il suo gate è m5). `node trueline/scripts/packaging/package_skill.mjs --out eval/.tmp-a2c-pkg/trueline.skill --json` → `ok:true`, lint VERDE (i wrapper/normalizer d'igiene già non-orfani; `SKILL.md` < 500 righe); poi `rm -rf eval/.tmp-a2c-pkg`.

- [ ] **Step 4: Coverage declaration + dispatch (docs)**

In `trueline/references/modes/build.md`: 1-2 righe — "Controllo 1 (igiene): dead-code (gate delta) + dup/cycle (gate delta vs baseline d'igiene committato, se il pack li dichiara; refresh `baseline.mjs capture --hygiene`) + twin (segnale). Coverage: duplicazione ≥`min_tokens` token verbatim; rinominati NON coperti → twin segnala; cicli solo JS/TS (madge); efficienza non gate-abile (Rice)."
In `trueline/references/modes/remediate.md`: 1 riga — "dup/cycle/twin in REMEDIATE sono REPORT-ONLY (audit del debito strutturale, non gate; mai auto-fixati, `L-COL-030`)."
In `trueline/SKILL.md`: se cita il controllo 1, aggiornare a "multi-oracolo igiene (dead-code + dup/cycle delta + twin segnale)". Verificare `SKILL.md` < 500 righe.

- [ ] **Step 5: Ledger + stato**

`00-INDEX.md §4`: nota A2c (attivazione per-pack dup/cycle; baseline d'igiene dichiarato committato ricalcolo-al-refresh; mode-aware BUILD-gate/REMEDIATE-report; vacuity guard; pilota supabase-jsts; nessun lock nuovo — raffinamento additivo di `L-COL-029`/`L-COL-030`; valutare se `L-COL-033` copre già "baseline d'igiene come contratto delta" o serve una nota).
`SESSION-STATE.md`: riga 9 (A2c F1 costruita/gateata) + §6/§7 (carry-over: F2 roll-out pack JS/TS, F3 report REMEDIATE come plan successivi).

- [ ] **Step 6: Commit ledger**

```bash
rm -f ./NUL 2>/dev/null
git add 00-INDEX.md SESSION-STATE.md trueline/SKILL.md trueline/references/modes
git commit -m "docs(a2c): ledger + stato + dispatch controllo 1 igiene + coverage declaration (F1)"
```

- [ ] **Step 7: STOP — merge human-gated**

NON mergeare in autonomia (`L-COL-024`). Riassumere all'utente: gate F1 verde (keystone A2c + m5 56/56 + non-regressione + BIT-invarianza), branch `feat/a2c-hygiene-activation` pronto, chiedere l'ok per merge `--no-ff` + push + install (plugin) riallineato — oppure procedere direttamente a **F2** (roll-out pack JS/TS) sullo stesso branch se si preferisce un merge unico a fine milestone (cadenza `L-COL-024` come nella eco-expansion).

---

## Self-Review

**1. Spec coverage** — §2.1 cattura baseline dup/cycle → Task 2; §2.2 attivazione per-pack → Task 4 (pilota; F2 il resto); §2.3 gate BUILD delta → Task 1+3+5; §2.4 report REMEDIATE → Task 1 (mode-aware report-only; il *reporting* in `collectFindings` è F3); §2.5 refresh → Task 2 (`--hygiene`); §2.6 vacuity guard → Task 3; §2.7 keystone+non-regressione → Task 5+6. §4 meccanismo baseline → Task 2+3; §5 attivazione → Task 4; §6 gate BUILD → Task 1+3; §7 report REMEDIATE → Task 1 (F1) + F3 (collectFindings); §9 testing → Task 5+6. **Correzione spec (§9.2/§1.1):** m5 resta verde via MODE-AWARENESS (REMEDIATE report-only), non via un baseline committato del fixture — il vincolo `fixtureApp→baseline vuoto` di `run_loop.mjs:389` lo impone; il baseline committato + gate BUILD è provato dal keystone A2c. Aggiornare la nota §9.2 dello spec di conseguenza al momento del ledger (Task 6 Step 5).

**2. Placeholder scan** — nessun "TBD"/"handle edge cases": ogni Step porta codice reale o comando con output atteso. Le note d'ancoraggio ("se presente", per test di regressione opzionali) indicano file + comando, con il gate che valida l'esito.

**3. Type consistency** — `partitionBlockers(findings, baseline, detectionOnly)` (Task 1) usato in `control1Hygiene` (Task 1/3); `loadHygieneBaseline`/`hygieneBaselinePath`/`writeBaseline`/`capture` (Task 2) usati in `runCheckpoint` (Task 3) e nel keystone (Task 5); `hygieneBaselineMissing` prodotto in `runCheckpoint` (Task 3) e consumato in `control1Hygiene` (Task 3); `oracleInvocation(canon, dir, minTokens)` (Task 2) coerente con `opts.minTokens` di `capture`; le chiavi manifest `duplication`/`architecture` (Task 4) lette in `control1Hygiene` (già esistente `:220-236`) e in `runCheckpoint::declaresHygiene` (Task 3).

**Rischi noti** — (a) `control1Hygiene`: Task 1 Step 4 e Task 3 Step 3 toccano lo STESSO blocco `blockers`/`green`/`return`; Task 3 lo ASSORBE (rimuovere la versione di Task 1, tenere quella con `hygieneBaselineMissing`). Il `git diff` finale deve mostrare `detectionOnly` UNA volta. (b) jscpd/madge offline → capture/keystone degradano dichiarati; il keystone li richiede provvigionati (exit 2 se assenti, mai falso PASS). (c) m5 su sandbox senza DB/docker → exit 2 (precondizione), da ri-gateare su macchina capace.
