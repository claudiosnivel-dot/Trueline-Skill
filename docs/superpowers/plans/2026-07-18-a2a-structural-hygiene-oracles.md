# A2a — Oracoli di igiene strutturale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere tre oracoli di igiene strutturale al controllo 1 del checkpoint — `dup_check` (duplicazione verbatim, gate delta), `cycle_check` (cicli di import, gate delta), `twin_check` (twinning per-entità, detection-only) — senza toccare il verdetto di sicurezza né la BIT-invarianza del percorso canonico.

**Architecture:** I tre oracoli seguono il template `dead-code`: wrapper esterno → `normalize` (categoria dedicata) → `deltaBlockers` nel controllo 1. Il controllo 1 diventa **multi-oracolo manifest-driven** (come il controllo 2 dopo A0); `twin_check` è escluso dai blockers per-**oracolo** (`DETECTION_ONLY_ORACLES = {'twin'}`), non per-categoria. `jscpd`/`dependency-cruiser` sono deps npm project-local (come `knip`); `twin_check` è custom ecosystem-agnostic.

**Tech Stack:** Node ESM (solo built-in: `node:child_process`, `node:fs`, `node:path`, `node:test`, `node:crypto`). Tool esterni: `jscpd@4` (verificato 4.2.5), `dependency-cruiser@16` (verificato 16.10.4 su Node 25). Nessuna dipendenza nuova nel corpo skill.

## Global Constraints

- **`L-COL-002`** — il verdetto è un FATTO d'oracolo, mai una frase dell'LLM.
- **`L-COL-006`** — oracolo non eseguito ≠ verde; coverage declaration sempre presente e specifica sul recall.
- **Solo DELTA-gate, mai assoluto** — i 263 cloni esistenti di ASV lo impongono; la baseline è la dichiarazione.
- **Soglia FILTRA, non costituisce il verdetto** — `--min-tokens 50` (dai dati reali) e `K` (twin) vivono nel manifest versionato, cambiabili solo con approvazione umana → commit (`L-COL-028`).
- **Detection-only in v1** (`L-COL-030`) — nessun fix-provider deterministico spedito; `twin_check` mai gate.
- **BIT-invarianza** — un pack che non dichiara i nuovi oracoli ha il controllo 1 byte-identico (solo dead-code); `m5` **56/56** e keystone A0 `a0_authz_gate_check` **16/16** invariati.
- **Fingerprint ancorato al CONTENUTO**, mai alla riga.
- **Git solo nell'orchestratore** (`L-COL-024`); branch `feat/a2a-structural-hygiene-oracles` (già creato), `main` intatto fino al merge human-gated. Provisioning `.git`/`node_modules` dei fixture = passo d'orchestratore.
- **Windows** — path con spazi → sempre assoluti/quotati; `NUL` rompe `git add -A` (rimuovilo).
- **Nessun lock nuovo** — raffinamenti additivi di `L-COL-029`.

---

## AGGIORNAMENTO in build (ondata 1 — leggere PRIMA di T3/T4/T5)

`cycle_check` **non usa più `dependency-cruiser`** (ispezionava 0 moduli sui `.ts` reali su
Node 25) ma **`madge`** (grafo import) + un DFS custom nel wrapper. Conseguenze per i task
rimanenti — la **fonte di verità è il codice già committato** (`run_cyclecheck.mjs` emette
`{oracle:'cycle', tool:'madge', modulesScanned, cycles:[{modules}]}`):
- **T3:** il normalizer si chiama **`normalizeCycle`**, il `case` è **`'cycle'`** (non
  `'depcruise'`), `source_oracle.oracle = 'cycle'`. Tutto il resto invariato.
- **T4:** `control1Hygiene` fa `normFindings('cycle', …)` per il ramo architecture.
- **T5:** il keystone `cycle:red` controlla `source_oracle.oracle === 'cycle'`; il preflight
  installa **`madge`** (non `dependency-cruiser`) accanto a `jscpd`.
- **File structure:** niente `depcruise-config/` (rimossa; madge non ha config).

---

## File Structure

**Creati:**
- `trueline/scripts/oracles/run_dupcheck.mjs` — wrapper `jscpd`, JSON nativo `{oracle:'jscpd', duplicates:[...]}`.
- `trueline/scripts/oracles/run_cyclecheck.mjs` — wrapper `dependency-cruiser`, JSON nativo `{oracle:'depcruise', cycles:[...]}`.
- `trueline/scripts/oracles/twin_check.mjs` — oracolo custom, JSON nativo `{oracle:'twin', twins:[...]}`.
- `trueline/references/oracles/depcruise-config/no-circular.cjs` — config vendorizzata (sola regola `no-circular`).
- `trueline/scripts/oracles/{run_dupcheck,run_cyclecheck,twin_check}.test.mjs` — unit.
- `eval/ecosystems/_a2a-fixtures/{dup,cycle,twin,clean}/…` — fixture del gate.
- `eval/harness/a2a_hygiene_check.mjs` — keystone.
- `eval/ecosystems/_a2a-fixtures/provision_fixtures.sh` — inner `.git` (orchestratore).

**Modificati:**
- `trueline/scripts/findings/finding.schema.json` — enum `category` += `duplication`, `architecture`.
- `trueline/scripts/findings/normalize.mjs` — `normalizeJscpd`/`normalizeDepcruise`/`normalizeTwin` + 3 `case` nel dispatch `normalize`.
- `trueline/scripts/checkpoint/checkpoint.mjs` — `control1DeadCode` → `control1Hygiene` (multi-oracolo manifest-driven, delta-gate, `DETECTION_ONLY_ORACLES`); `runCheckpoint` passa `manifest` al controllo 1.
- `trueline/scripts/preflight.mjs` — `jscpd`/`dependency-cruiser` fra le deps npm project-local.
- `trueline/references/ecosystems/supabase-jsts/ecosystem.json` — binding `duplication`/`architecture` (pack pilota).
- `trueline/SKILL.md` + `references/modes/*.md` — dispatch minimale + coverage declaration.

---

## Task 1: Enum categorie (`duplication`, `architecture`)

Sblocca tutto il resto: senza le categorie nell'enum, il guard vocabolario di A0 respinge i binding.

**Files:**
- Modify: `trueline/scripts/findings/finding.schema.json:32-42`
- Test: `trueline/scripts/ecosystem/validate_ecosystem.a2a.test.mjs`

**Interfaces:**
- Produces: enum `category` esteso a 11 valori (`…, duplication, architecture`).

- [ ] **Step 1: Scrivere il test**

```js
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
```

- [ ] **Step 2: Eseguire → FAIL** (oggi `duplication`/`architecture` fuori vocabolario)

Run: `node --test trueline/scripts/ecosystem/validate_ecosystem.a2a.test.mjs`
Expected: FAIL — `categoria oracolo fuori vocabolario: "duplication"`.

- [ ] **Step 3: Estendere l'enum**

In `finding.schema.json`, nell'array `enum` di `category`, aggiungere dopo `"misc"`:

```json
        "misc",
        "duplication",
        "architecture"
```

E in `normalize.mjs`, se esiste una lista `CATEGORY_ENUM`/validazione categoria speculare, aggiungere le due voci (cercare con `grep -n "duplication\|'misc'\|category" trueline/scripts/findings/normalize.mjs`; se `validate_finding.mjs` ha un enum replicato, allinearlo).

- [ ] **Step 4: Eseguire → PASS**

Run: `node --test trueline/scripts/ecosystem/validate_ecosystem.a2a.test.mjs`
Expected: PASS. Poi `node --test trueline/scripts/ecosystem/validate_ecosystem.a0.test.mjs` (A0 invariato) → PASS.

- [ ] **Step 5: Commit**

```bash
git add trueline/scripts/findings/finding.schema.json trueline/scripts/ecosystem/validate_ecosystem.a2a.test.mjs
git commit -m "feat(a2a): enum categorie += duplication, architecture (validate dal guard A0)"
```

---

## Task 2: I tre wrapper oracolo (JSON nativo, testabili stand-alone)

Tre file nuovi isolati. Ciascuno esegue il suo tool ed emette JSON nativo su stdout (verdetto nel payload, exit del tool ignorato, `03 §3`). Nessun `normalize` qui.

**Files:**
- Create: `trueline/scripts/oracles/run_dupcheck.mjs`, `run_cyclecheck.mjs`, `twin_check.mjs`
- Create: `trueline/references/oracles/depcruise-config/no-circular.cjs`
- Test: `trueline/scripts/oracles/{run_dupcheck,run_cyclecheck,twin_check}.test.mjs`

**Interfaces:**
- Produces:
  - `run_dupcheck.mjs <dir>` → stdout `{ oracle:'jscpd', minTokens:number, duplicates:[{ firstFile:{name,startLoc,endLoc}, secondFile:{...}, lines:number, tokens:number, fragment:string }] }`, exit 0 (report ok) / 2 (uso) / 1 (tool assente/non parsabile).
  - `run_cyclecheck.mjs <dir>` → stdout `{ oracle:'depcruise', cycles:[{ modules:string[] }] }`.
  - `twin_check.mjs <dir>` → stdout `{ oracle:'twin', minParallel:number, twins:[{ dirA:string, dirB:string, entityA:string, entityB:string, parallelFiles:string[] }] }`.

- [ ] **Step 1: Scrivere `run_dupcheck.mjs`**

```js
#!/usr/bin/env node
// run_dupcheck.mjs — wrapper jscpd (duplicazione verbatim). JSON nativo su stdout;
// il verdetto vive nel payload, l'exit del tool e' ignorato (03 §3). jscpd risolto
// da <dir>/node_modules (come knip) o via npx; assente -> exit 1 DICHIARATO, mai
// {duplicates:[]} nudo (L-COL-006).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const MIN_TOKENS_DEFAULT = 50;
function main() {
  const dir = process.argv[2];
  const minTokens = Number(process.argv[3] || MIN_TOKENS_DEFAULT);
  if (!dir || !existsSync(dir)) { console.error('uso: run_dupcheck.mjs <dir> [minTokens]'); process.exit(2); }
  const local = resolve(dir, 'node_modules', 'jscpd', 'bin', 'jscpd');
  const useLocal = existsSync(local);
  const out = mkdtempSync(join(tmpdir(), 'jscpd-'));
  const args = (useLocal ? [local] : ['--yes', 'jscpd@4'])
    .concat([resolve(dir), '--min-tokens', String(minTokens), '--reporters', 'json', '--silent',
      '--mode', 'strict', '--ignore', '**/*.test.ts,**/*.test.tsx,**/*.spec.ts,**/*.d.ts,**/node_modules/**',
      '--output', out]);
  const bin = useLocal ? process.execPath : 'npx';
  const res = spawnSync(bin, args, { cwd: dir, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  const report = join(out, 'jscpd-report.json');
  if (!existsSync(report)) {
    rmSync(out, { recursive: true, force: true });
    console.error(`jscpd non eseguito (exit=${res.status}): ${(res.stderr || '').slice(-200)}`);
    process.exit(1); // NON un verde: oracolo non eseguito (L-COL-006)
  }
  const j = JSON.parse(readFileSync(report, 'utf8'));
  rmSync(out, { recursive: true, force: true });
  const duplicates = (j.duplicates || []).map((d) => ({
    firstFile: { name: d.firstFile.name, startLoc: d.firstFile.startLoc, endLoc: d.firstFile.endLoc },
    secondFile: { name: d.secondFile.name, startLoc: d.secondFile.startLoc, endLoc: d.secondFile.endLoc },
    lines: d.lines, tokens: d.tokens, fragment: d.fragment || '',
  }));
  process.stdout.write(JSON.stringify({ oracle: 'jscpd', minTokens, duplicates }));
  process.exit(0);
}
main();
```

- [ ] **Step 2: Scrivere la config `no-circular.cjs`**

```js
// no-circular.cjs — config dependency-cruiser vendorizzata (A2a). Sola regola
// no-circular: i cicli sono l'unico invariante L0 gate-abile su delta. Version-pinned.
module.exports = {
  forbidden: [{
    name: 'no-circular',
    severity: 'error',
    from: {},
    to: { circular: true },
  }],
  options: { doNotFollow: { path: 'node_modules' }, tsConfig: {} },
};
```

- [ ] **Step 3: Scrivere `run_cyclecheck.mjs`**

```js
#!/usr/bin/env node
// run_cyclecheck.mjs — wrapper dependency-cruiser (cicli di import). JSON nativo;
// legge summary.violations filtrando rule 'no-circular'. depcruise da <dir>/node_modules
// o npx; assente -> exit 1 dichiarato (L-COL-006).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = resolve(HERE, '..', '..', 'references', 'oracles', 'depcruise-config', 'no-circular.cjs');

function main() {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) { console.error('uso: run_cyclecheck.mjs <dir>'); process.exit(2); }
  const local = resolve(dir, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.js');
  const useLocal = existsSync(local);
  const target = existsSync(resolve(dir, 'src')) ? resolve(dir, 'src') : resolve(dir);
  const argv = (useLocal ? [local] : ['--yes', 'dependency-cruiser@16'])
    .concat([target, '--config', CONFIG, '--output-type', 'json', '--no-progress']);
  const bin = useLocal ? process.execPath : 'npx';
  const res = spawnSync(bin, argv, { cwd: dir, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  const raw = (res.stdout || '').trim();
  if (!raw) { console.error(`depcruise non eseguito (exit=${res.status}): ${(res.stderr || '').slice(-200)}`); process.exit(1); }
  let j; try { j = JSON.parse(raw); } catch (e) { console.error(`JSON invalido: ${e.message}`); process.exit(1); }
  const viol = (j.summary && j.summary.violations) || [];
  const cyclesRaw = viol.filter((v) => v.rule && v.rule.name === 'no-circular');
  // ogni violazione porta il ciclo in v.cycle (lista di {name}) o via from/to; normalizza a lista di moduli.
  const cycles = cyclesRaw.map((v) => ({
    modules: Array.isArray(v.cycle) ? v.cycle.map((c) => (typeof c === 'string' ? c : c.name)) : [v.from, v.to].filter(Boolean),
  }));
  process.stdout.write(JSON.stringify({ oracle: 'depcruise', cycles }));
  process.exit(0);
}
main();
```

(Nota d'implementazione: la forma esatta di `v.cycle` varia per versione di dependency-cruiser — verificare su una fixture con un ciclo reale se è `v.cycle` (array di `{name}`) o `v.cycle` stringa; adattare il `.map`. Il test di Step 5 lo esercita.)

- [ ] **Step 4: Scrivere `twin_check.mjs`**

```js
#!/usr/bin/env node
// twin_check.mjs — oracolo CUSTOM detection-only (A2a): segnala directory sorelle
// con basename PARALLELI modulo un token-entita' (clone-and-rename per-entita').
// FATTO strutturale ispezionabile, NON giudizio: emette le due dir + i file paralleli.
// Ecosystem-agnostic. JSON nativo su stdout. MAI gate (il chiamante lo esclude dai blockers).
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const MIN_PARALLEL = 3; // soglia K: >=3 file paralleli -> segnale (filtra, non e' un verdetto: detection-only)

// normalizza un basename rimuovendo il token-entita' (case-insensitive) e l'estensione.
function stripEntity(name, entity) {
  const noExt = name.replace(/\.[jt]sx?$/, '');
  const re = new RegExp(entity, 'ig');
  return noExt.replace(re, '').replace(/[-_]/g, '').toLowerCase();
}
function listDirs(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).map((n) => join(root, n)).filter((p) => { try { return statSync(p).isDirectory() && basename(p) !== 'node_modules'; } catch { return false; } });
}
function filesOf(dir) {
  try { return readdirSync(dir).filter((n) => /\.[jt]sx?$/.test(n)); } catch { return []; }
}
function walk(root, acc) {
  for (const d of listDirs(root)) { acc.push(d); walk(d, acc); }
  return acc;
}
function main() {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) { console.error('uso: twin_check.mjs <dir>'); process.exit(2); }
  const src = existsSync(resolve(dir, 'src')) ? resolve(dir, 'src') : resolve(dir);
  const allDirs = walk(src, []);
  const twins = [];
  // per ogni coppia di directory-SORELLE (stesso parent), confronta i basename modulo il nome-dir.
  const byParent = new Map();
  for (const d of allDirs) { const p = resolve(d, '..'); (byParent.get(p) || byParent.set(p, []).get(p)).push(d); }
  for (const [, sibs] of byParent) {
    for (let i = 0; i < sibs.length; i++) for (let j = i + 1; j < sibs.length; j++) {
      const A = sibs[i], B = sibs[j];
      const entA = basename(A), entB = basename(B);
      const setA = new Set(filesOf(A).map((f) => stripEntity(f, entA)));
      const parallel = filesOf(B).filter((f) => setA.has(stripEntity(f, entB)));
      if (parallel.length >= MIN_PARALLEL) {
        twins.push({ dirA: A, dirB: B, entityA: entA, entityB: entB, parallelFiles: parallel });
      }
    }
  }
  process.stdout.write(JSON.stringify({ oracle: 'twin', minParallel: MIN_PARALLEL, twins }));
  process.exit(0);
}
main();
```

- [ ] **Step 5: Scrivere i test dei wrapper**

```js
// run_dupcheck.test.mjs — richiede jscpd via npx (rete) o node_modules; se assente, skip dichiarato.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(script, dir, extra = []) {
  const r = spawnSync(process.execPath, [script, dir, ...extra], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: (r.stdout || '').trim(), err: r.stderr };
}

test('run_dupcheck: due file con blocco identico -> >=1 duplicate', () => {
  const d = mkdtempSync(join(tmpdir(), 'dup-'));
  const block = Array.from({ length: 20 }, (_, i) => `  const x${i} = compute(${i}) + helper(${i}) * 2;`).join('\n');
  writeFileSync(join(d, 'a.ts'), `export function a(){\n${block}\n  return 1;\n}`);
  writeFileSync(join(d, 'b.ts'), `export function b(){\n${block}\n  return 2;\n}`);
  const r = run('trueline/scripts/oracles/run_dupcheck.mjs', d, ['50']);
  rmSync(d, { recursive: true, force: true });
  if (r.status === 1) { console.log('jscpd non disponibile — skip dichiarato'); return; }
  assert.equal(r.status, 0);
  const j = JSON.parse(r.out);
  assert.ok(j.duplicates.length >= 1, 'atteso >=1 clone verbatim');
});

test('twin_check: due dir sorelle con file paralleli -> segnale', () => {
  const d = mkdtempSync(join(tmpdir(), 'twin-'));
  for (const [ent, files] of [['commesse', ['useAccontoCommessa', 'useElencoCommessa', 'DettaglioCommessa']],
                              ['preventivi', ['useAccontoPreventivo', 'useElencoPreventivo', 'DettaglioPreventivo']]]) {
    mkdirSync(join(d, ent), { recursive: true });
    for (const f of files) writeFileSync(join(d, ent, `${f}.ts`), 'export const x = 1;');
  }
  const r = run('trueline/scripts/oracles/twin_check.mjs', d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(r.status, 0);
  const j = JSON.parse(r.out);
  assert.ok(j.twins.length >= 1, 'atteso >=1 twin');
  assert.deepEqual(j.twins[0].parallelFiles.sort(), ['DettaglioPreventivo.ts', 'useAccontoPreventivo.ts', 'useElencoPreventivo.ts'].sort());
});

test('twin_check: dir NON parallele -> nessun segnale (contrasto anti-vacuo)', () => {
  const d = mkdtempSync(join(tmpdir(), 'twin2-'));
  mkdirSync(join(d, 'auth'), { recursive: true }); writeFileSync(join(d, 'auth', 'login.ts'), 'export const x=1;');
  mkdirSync(join(d, 'billing'), { recursive: true }); writeFileSync(join(d, 'billing', 'invoice.ts'), 'export const y=1;');
  const r = run('trueline/scripts/oracles/twin_check.mjs', d);
  rmSync(d, { recursive: true, force: true });
  assert.equal(JSON.parse(r.out).twins.length, 0);
});
```

(Il test di `run_cyclecheck` è nel Task successivo insieme al normalize, perché richiede un progetto con `node_modules` risolvibili; qui basta `twin_check` — deterministico, senza tool esterni — e `run_dupcheck` con skip-se-assente.)

- [ ] **Step 6: Eseguire i test** — `twin_check` deve passare (no dipendenze esterne)

Run: `node --test trueline/scripts/oracles/twin_check.test.mjs trueline/scripts/oracles/run_dupcheck.test.mjs`
Expected: `twin_check` 2/2 PASS; `run_dupcheck` PASS o skip-dichiarato (se npx/jscpd non disponibile offline).

- [ ] **Step 7: Commit**

```bash
git add trueline/scripts/oracles/run_dupcheck.mjs trueline/scripts/oracles/run_cyclecheck.mjs trueline/scripts/oracles/twin_check.mjs trueline/references/oracles/depcruise-config/no-circular.cjs trueline/scripts/oracles/run_dupcheck.test.mjs trueline/scripts/oracles/twin_check.test.mjs
git commit -m "feat(a2a): wrapper oracoli dup_check/cycle_check/twin_check (JSON nativo)"
```

---

## Task 3: I tre normalizer (`normalize.mjs`)

Un solo task (stesso file). Ogni normalizer converte il JSON nativo del wrapper in finding validi, con fingerprint ancorato al contenuto.

**Files:**
- Modify: `trueline/scripts/findings/normalize.mjs` (aggiungere `normalizeJscpd`/`normalizeDepcruise`/`normalizeTwin` + 3 `case` nel dispatch `normalize`)
- Test: `trueline/scripts/findings/normalize.a2a.test.mjs`

**Interfaces:**
- Consumes: `fingerprintOf`/`matchSignature` esistenti in `normalize.mjs`; il JSON dei wrapper (Task 2).
- Produces: `normalize('jscpd'|'depcruise'|'twin', native, opts)` → finding[] validi (schema `04`), `category` `duplication`/`architecture`, `source_oracle.oracle` = `jscpd`/`depcruise`/`twin`.

- [ ] **Step 1: Scrivere il test**

```js
// normalize.a2a.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './normalize.mjs';
import { validateMany } from './validate_finding.mjs';

const OPTS = { runId: 'a2a', createdAt: '1970-01-01T00:00:00.000Z', scope: 'working-tree' };

test('normalizeJscpd: duplicate -> finding duplication valido, fingerprint sul contenuto', () => {
  const native = { oracle: 'jscpd', minTokens: 50, duplicates: [{
    firstFile: { name: 'src/a.ts', startLoc: { line: 10 }, endLoc: { line: 30 } },
    secondFile: { name: 'src/b.ts', startLoc: { line: 5 }, endLoc: { line: 25 } },
    lines: 20, tokens: 60, fragment: 'const x = compute();' }] };
  const f = normalize('jscpd', native, OPTS);
  assert.equal(f.length, 1);
  assert.equal(f[0].category, 'duplication');
  assert.equal(f[0].severity, 'LOW');
  assert.equal(f[0].source_oracle.oracle, 'jscpd');
  assert.ok(validateMany(f).ok, 'schema');
  // fingerprint STABILE sul contenuto: stesso fragment+path -> stesso fp
  const f2 = normalize('jscpd', native, { ...OPTS, runId: 'diverso' });
  assert.equal(f[0].fingerprint, f2[0].fingerprint);
});

test('normalizeDepcruise: cycle -> finding architecture valido', () => {
  const native = { oracle: 'depcruise', cycles: [{ modules: ['src/a.ts', 'src/b.ts'] }] };
  const f = normalize('depcruise', native, OPTS);
  assert.equal(f[0].category, 'architecture');
  assert.equal(f[0].source_oracle.oracle, 'depcruise');
  assert.ok(validateMany(f).ok);
  // fingerprint invariante alla rotazione del ciclo
  const rotated = normalize('depcruise', { oracle: 'depcruise', cycles: [{ modules: ['src/b.ts', 'src/a.ts'] }] }, OPTS);
  assert.equal(f[0].fingerprint, rotated[0].fingerprint);
});

test('normalizeTwin: twin -> finding architecture, source_oracle=twin', () => {
  const native = { oracle: 'twin', minParallel: 3, twins: [{ dirA: 'src/commesse', dirB: 'src/preventivi', entityA: 'commesse', entityB: 'preventivi', parallelFiles: ['a.ts', 'b.ts', 'c.ts'] }] };
  const f = normalize('twin', native, OPTS);
  assert.equal(f[0].category, 'architecture');
  assert.equal(f[0].source_oracle.oracle, 'twin');
  assert.ok(validateMany(f).ok);
});
```

- [ ] **Step 2: Eseguire → FAIL** (`normalize` non conosce `jscpd`/`depcruise`/`twin`)

Run: `node --test trueline/scripts/findings/normalize.a2a.test.mjs`
Expected: FAIL — categoria/oracolo sconosciuto o finding vuoto.

- [ ] **Step 3: Aggiungere i normalizer + i case**

Prima, individuare la firma esatta di `fingerprintOf`/`matchSignature`/`makeFinding` esistenti (`grep -n "fingerprintOf\|matchSignature\|function.*[Ff]inding\|normalizedPath" trueline/scripts/findings/normalize.mjs`) e ricalcarla. Poi aggiungere le tre funzioni (usare `node:crypto` per lo sha256 canonicalizzato) e i tre `case` nel `switch (oracle)` del dispatch `normalize`:

```js
import { createHash } from 'node:crypto'; // se non già importato

const sha32 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const normPath = (p) => String(p).replace(/\\/g, '/').replace(/^.*?\/(src\/.*)$/, '$1');

export function normalizeJscpd(native, opts) {
  return (native.duplicates || []).map((d) => {
    const frag = (d.fragment || '').replace(/\s+/g, ' ').trim();
    const path2 = normPath(d.secondFile.name);
    const fp = sha32(`jscpd|dup|${frag}|${path2}`);
    return {
      id: `DUP-${fp.slice(0, 6)}`, category: 'duplication', severity: 'LOW',
      owasp: '—', title: `Blocco duplicato (${d.lines} righe) tra ${normPath(d.firstFile.name)} e ${path2}`,
      location: { file: path2, start_line: d.secondFile.startLoc && d.secondFile.startLoc.line },
      rule_id: 'jscpd-duplicate', fingerprint: fp,
      source_oracle: { oracle: 'jscpd', tool_version: 'jscpd/4' },
      created_at: opts.createdAt, run_id: opts.runId,
    };
  });
}

export function normalizeDepcruise(native, opts) {
  return (native.cycles || []).map((c) => {
    const canon = [...(c.modules || [])].map(normPath).sort().join('->');
    const fp = sha32(`depcruise|cycle|${canon}`);
    return {
      id: `CYC-${fp.slice(0, 6)}`, category: 'architecture', severity: 'LOW',
      owasp: '—', title: `Ciclo di import: ${(c.modules || []).map(normPath).join(' -> ')}`,
      location: { file: normPath((c.modules || [])[0] || '') },
      rule_id: 'no-circular', fingerprint: fp,
      source_oracle: { oracle: 'depcruise', tool_version: 'dependency-cruiser/16' },
      created_at: opts.createdAt, run_id: opts.runId,
    };
  });
}

export function normalizeTwin(native, opts) {
  return (native.twins || []).map((t) => {
    const canon = [normPath(t.dirA), normPath(t.dirB)].sort().join('|');
    const fp = sha32(`twin|${canon}`);
    return {
      id: `TWIN-${fp.slice(0, 6)}`, category: 'architecture', severity: 'LOW',
      owasp: '—', title: `Directory parallele (sospetto clone-and-rename): ${normPath(t.dirA)} <-> ${normPath(t.dirB)} (${t.parallelFiles.length} file)`,
      location: { file: normPath(t.dirB) },
      rule_id: 'twin-directories', fingerprint: fp,
      source_oracle: { oracle: 'twin', tool_version: 'twin-check/1.0.0' },
      created_at: opts.createdAt, run_id: opts.runId,
    };
  });
}
```

E nel `switch (oracle)` del dispatch `normalize`, accanto agli altri `case`:

```js
    case 'jscpd': return normalizeJscpd(native, opts);
    case 'depcruise': return normalizeDepcruise(native, opts);
    case 'twin': return normalizeTwin(native, opts);
```

(Adattare i nomi dei campi del finding — `owasp`/`cwe`/`title`/`location`/`created_at`/`run_id` — a quelli ESATTI che gli altri normalizer emettono e che `validate_finding.mjs` esige; `grep` un normalizer esistente come `normalizeKnip` per ricalcare la shape byte-precisa. Il test di Step 4 valida contro lo schema.)

- [ ] **Step 4: Eseguire → PASS**

Run: `node --test trueline/scripts/findings/normalize.a2a.test.mjs`
Expected: PASS (3/3). Poi la regressione: `node --test trueline/scripts/oracles/run_deadcode.test.mjs` → invariato.

- [ ] **Step 5: Commit**

```bash
git add trueline/scripts/findings/normalize.mjs trueline/scripts/findings/normalize.a2a.test.mjs
git commit -m "feat(a2a): normalize jscpd/depcruise/twin -> finding duplication/architecture (fingerprint sul contenuto)"
```

---

## Task 4: Controllo 1 multi-oracolo (`control1Hygiene`)

Generalizza il controllo 1 da mono-oracolo (knip) a multi-oracolo manifest-driven, delta-gated, con `twin` escluso dai blockers per-oracolo. Stesso pattern del controllo 2 dopo A0.

**Files:**
- Modify: `trueline/scripts/checkpoint/checkpoint.mjs` (`control1DeadCode` → `control1Hygiene`, `:120-139`; `runCheckpoint` passa `manifest`, `:611+`)
- Test: `eval/harness/a2a_hygiene_check.mjs` (keystone, scritto qui in forma iniziale; ampliato in Task 5)

**Interfaces:**
- Consumes: `runOracle`/`normFindings`/`deltaBlockers` esistenti; i wrapper (Task 2) via path; `normalize` (Task 3).
- Produces: `control1Hygiene(referenceApp, { baseline, runOpts, manifest })` → `{ id:1, name:'hygiene', status, green, findings, blockers }`; `DETECTION_ONLY_ORACLES = new Set(['twin'])` esclusa dai blockers.

- [ ] **Step 1: Scrivere un test unitario del gating**

```js
// checkpoint.a2a.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { control1Hygiene } from './checkpoint.mjs';
// usa una fixture minimale con node_modules/jscpd assente -> dup degrada dichiarato;
// il focus qui e' il GATING: twin non blocca, dead-code/dup/cycle si'.
// (test end-to-end completo nel keystone Task 5; qui verifichiamo l'esclusione per-oracolo)

test('DETECTION_ONLY_ORACLES esclude twin dai blockers', async () => {
  // finding sintetici: uno dup (gate) + uno twin (detection-only), stessa categoria-famiglia
  const { partitionBlockers } = await import('./checkpoint.mjs'); // helper esportato per il test
  const findings = [
    { category: 'duplication', source_oracle: { oracle: 'jscpd' }, fingerprint: 'a', baseline_status: 'new', severity: 'LOW' },
    { category: 'architecture', source_oracle: { oracle: 'twin' }, fingerprint: 'b', baseline_status: 'new', severity: 'LOW' },
  ];
  const blockers = partitionBlockers(findings, new Set());
  assert.equal(blockers.length, 1);
  assert.equal(blockers[0].source_oracle.oracle, 'jscpd');
});
```

- [ ] **Step 2: Eseguire → FAIL** (`control1Hygiene`/`partitionBlockers` non esistono)

Run: `node --test trueline/scripts/checkpoint/checkpoint.a2a.test.mjs`
Expected: FAIL — export mancante.

- [ ] **Step 3: Riscrivere il controllo 1 come multi-oracolo**

Sostituire `control1DeadCode` (`:120-139`) con `control1Hygiene`. Aggiungere in cima al file i path dei wrapper (`RUN_DUPCHECK`/`RUN_CYCLECHECK`/`TWIN_CHECK`) e `DETECTION_ONLY_ORACLES`. Struttura (ricalcando `control2Security` di A0 per il loop manifest-driven):

```js
const RUN_DUPCHECK = resolve(__dirname, '..', 'oracles', 'run_dupcheck.mjs');
const RUN_CYCLECHECK = resolve(__dirname, '..', 'oracles', 'run_cyclecheck.mjs');
const TWIN_CHECK = resolve(__dirname, '..', 'oracles', 'twin_check.mjs');
const DETECTION_ONLY_ORACLES = new Set(['twin']);

// esclude dai blockers i finding NUOVI prodotti da un oracolo detection-only.
export function partitionBlockers(findings, baseline) {
  return findings.filter((f) => {
    if (baseline.has(f.fingerprint)) return false;               // pre-esistente (delta)
    if (DETECTION_ONLY_ORACLES.has(f.source_oracle && f.source_oracle.oracle)) return false; // detection-only
    return true;
  });
}

export function control1Hygiene(referenceApp, { baseline = new Set(), runOpts, manifest = null }) {
  const all = [];
  const sub = [];
  // dead-code (invariato: knip/vulture/... via run_deadcode), poi gli oracoli A2a se dichiarati.
  const dc = runOracle(RUN_DEADCODE, [referenceApp], referenceApp);
  if (!dc.ok) return { id: 1, name: 'hygiene', status: 'error', green: false, detail: dc.detail, findings: [], blockers: [] };
  const ndc = normFindings('knip', dc.json, { ...runOpts, scope: 'working-tree' });
  if (!ndc.ok) return { id: 1, name: 'hygiene', status: 'error', green: false, detail: ndc.detail, findings: [], blockers: [] };
  all.push(...ndc.findings); sub.push(`dead-code:${ndc.findings.length}`);

  // A2a: esegui gli oracoli di igiene DICHIARATI dal manifest + twin (sempre, ecosystem-agnostic).
  const decl = manifest && manifest.oracles ? manifest.oracles : {};
  if (decl.duplication) {
    const minT = decl.duplication.min_tokens || 50;
    const r = runOracle(RUN_DUPCHECK, [referenceApp, String(minT)], referenceApp);
    if (r.ok) { const n = normFindings('jscpd', r.json, { ...runOpts, scope: 'working-tree' }); if (n.ok) { all.push(...n.findings); sub.push(`dup:${n.findings.length}`); } else sub.push('dup:degr'); }
    else sub.push('dup:degr'); // oracolo non eseguito: DICHIARATO, non un verde (L-COL-006)
  }
  if (decl.architecture) {
    const r = runOracle(RUN_CYCLECHECK, [referenceApp], referenceApp);
    if (r.ok) { const n = normFindings('depcruise', r.json, { ...runOpts, scope: 'working-tree' }); if (n.ok) { all.push(...n.findings); sub.push(`cycle:${n.findings.length}`); } else sub.push('cycle:degr'); }
    else sub.push('cycle:degr');
  }
  // twin: SEMPRE (detection-only, non dipende dal manifest).
  const tw = runOracle(TWIN_CHECK, [referenceApp], referenceApp);
  if (tw.ok) { const n = normFindings('twin', tw.json, { ...runOpts, scope: 'working-tree' }); if (n.ok) { all.push(...n.findings); sub.push(`twin:${n.findings.length}`); } }

  const blockers = partitionBlockers(all, baseline);
  const green = blockers.length === 0;
  return {
    id: 1, name: 'hygiene', status: green ? 'green' : 'red', green,
    detail: green ? `nessuna regressione d'igiene NUOVA [${sub.join(' ')}]` : `${blockers.length} finding d'igiene NUOVO [${sub.join(' ')}]`,
    findings: all, blockers,
  };
}

// alias di compatibilità: i chiamanti storici importano control1DeadCode.
export const control1DeadCode = control1Hygiene;
```

Poi in `runCheckpoint` (`:611+`), passare `manifest` al controllo 1: `control1Hygiene(referenceApp, { baseline, runOpts, manifest })`.

**BIT-invarianza:** un pack senza `oracles.duplication`/`architecture` esegue solo dead-code + twin. `twin` è detection-only (mai blocca) e su un progetto senza directory parallele emette `twins:[]` → 0 finding → controllo 1 byte-equivalente al vecchio per il VERDETTO. (Verificare in Task 6 che `m5` resta 56/56: se il costo di `twin` su reference-app fosse non-nullo, gate-are `twin` dietro un flag o accettare che aggiunge solo finding non-bloccanti — il verdetto non cambia.)

- [ ] **Step 4: Eseguire → PASS**

Run: `node --test trueline/scripts/checkpoint/checkpoint.a2a.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add trueline/scripts/checkpoint/checkpoint.mjs trueline/scripts/checkpoint/checkpoint.a2a.test.mjs
git commit -m "fix(a2a): controllo 1 multi-oracolo (dead-code+dup+cycle gate, twin detection-only per-oracolo)"
```

---

## Task 5: Fixture, keystone, preflight, manifest pilota

Il gate falsificabile della milestone + il cablaggio d'ambiente.

**Files:**
- Create: `eval/ecosystems/_a2a-fixtures/{dup,cycle,twin,clean}/…` + `provision_fixtures.sh`
- Create/Modify: `eval/harness/a2a_hygiene_check.mjs`
- Modify: `trueline/scripts/preflight.mjs` (jscpd/dependency-cruiser deps npm project-local)
- Modify: `trueline/references/ecosystems/supabase-jsts/ecosystem.json` (binding `duplication`/`architecture`)

**Interfaces:**
- Consumes: `runCheckpoint`/`control1Hygiene` (Task 4).
- Produces: `a2a_hygiene_check.mjs` → exit 0 se tutti i sotto-test passano; sotto-test `dup:red`, `cycle:red`, `twin:signal-not-gate`, `clean:green`, `delta:preexisting-ok`, `falsifiable`.

- [ ] **Step 1: Costruire le 4 fixture**

- `dup/`: due file `.ts` con un blocco ≥50 token identico (unico difetto) + `package.json` classificabile.
- `cycle/`: `a.ts`↔`b.ts` con import circolare.
- `twin/`: `commesse/`+`preventivi/` con ≥3 file paralleli.
- `clean/`: codice senza duplicazione, cicli, o directory parallele (contrasto — tutto verde).

Ciascuna con la struttura minima perché `classify()` risolva `supabase-jsts` (o un manifest di test) e `runCheckpoint` giri (inner `.git` + `node_modules` provisionati dall'orchestratore per gli oracoli che li richiedono).

- [ ] **Step 2: Scrivere il keystone `a2a_hygiene_check.mjs`**

```js
#!/usr/bin/env node
// a2a_hygiene_check.mjs — keystone A2a. Verita' = FATTO d'oracolo (L-COL-002).
import { runCheckpoint } from '../../trueline/scripts/checkpoint/checkpoint.mjs';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'ecosystems', '_a2a-fixtures');
const RUN = { runId: 'a2a', createdAt: '1970-01-01T00:00:00.000Z' };
let fails = 0;
const check = (n, c, d) => { if (!c) { fails++; console.log(`  [FAIL] ${n} — ${d}`); } else console.log(`  [ok]   ${n}`); };
const c1 = (dir) => { const cp = runCheckpoint(dir, { mode: 'build', withOsv: false, runOpts: RUN }); return cp.controls.find((c) => c.id === 1); };

for (const [name, cond] of [
  ['dup:red', (h) => h.green === false && h.blockers.some((b) => b.category === 'duplication')],
  ['cycle:red', (h) => h.green === false && h.blockers.some((b) => b.category === 'architecture' && b.source_oracle.oracle === 'depcruise')],
  ['clean:green', (h) => h.green === true],
]) {
  const dir = resolve(FIX, name.split(':')[0]);
  if (!existsSync(dir)) { console.error(`precondizione: fixture ${dir} assente`); process.exit(2); }
  const h = c1(dir);
  check(name, cond(h), `visto green=${h && h.green} detail=${h && h.detail}`);
}
// twin: SEGNALA ma NON blocca (detection-only).
const tw = c1(resolve(FIX, 'twin'));
check('twin:signal-not-gate', tw.green === true && tw.findings.some((f) => f.source_oracle.oracle === 'twin'),
  `atteso VERDE con >=1 finding twin (segnale, non gate), visto green=${tw.green}`);
console.log(fails === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 3: Provisionare i fixture (ORCHESTRATORE) ed eseguire il keystone**

Provisioning via `provision_fixtures.sh` (inner `.git`) + `node_modules` (jscpd/dependency-cruiser) copiati offline dove serve. Poi:

Run: `node eval/harness/a2a_hygiene_check.mjs`
Expected: `RESULT: PASS` — `dup:red`, `cycle:red`, `clean:green`, `twin:signal-not-gate`.

- [ ] **Step 4: Preflight — jscpd/dependency-cruiser project-local**

In `preflight.mjs`, aggiungere `jscpd` e `dependency-cruiser` alla lista delle dipendenze npm installabili project-local (accanto a `knip`), con degradazione dichiarata se assenti. (Individuare la struttura esistente per `knip` — `grep -n "knip" trueline/scripts/preflight.mjs` — e ricalcarla.)

- [ ] **Step 5: Manifest pilota**

In `supabase-jsts/ecosystem.json`, aggiungere i binding (additivi):

```json
    "duplication":  { "tool": "jscpd", "min_tokens": 50 },
    "architecture": { "tool": "dependency-cruiser" }
```

Verificare: `node trueline/scripts/ecosystem/validate_ecosystem.mjs trueline/references/ecosystems/supabase-jsts/ecosystem.json` → OK.

- [ ] **Step 6: Commit**

```bash
rm -f ./NUL 2>/dev/null
git add eval/ecosystems/_a2a-fixtures eval/harness/a2a_hygiene_check.mjs trueline/scripts/preflight.mjs trueline/references/ecosystems/supabase-jsts/ecosystem.json
git commit -m "feat(a2a): fixture + keystone a2a_hygiene_check + preflight deps + manifest pilota supabase-jsts"
```

---

## Task 6: Gate integrale SERIALE + measure reale + ledger

Il gate della milestone.

**Files:**
- Modify: `00-INDEX.md` (§4 ledger — nota A2a, nessun lock), `SESSION-STATE.md`, `trueline/SKILL.md` + `references/modes/*.md` (dispatch + coverage declaration).

- [ ] **Step 1: Keystone A2a + unit**

Run: `node eval/harness/a2a_hygiene_check.mjs` → PASS; `node --test trueline/scripts/oracles/twin_check.test.mjs trueline/scripts/findings/normalize.a2a.test.mjs trueline/scripts/checkpoint/checkpoint.a2a.test.mjs trueline/scripts/ecosystem/validate_ecosystem.a2a.test.mjs` → tutti PASS.

- [ ] **Step 2: Non-regressione — BIT-invarianza**

Run (SERIALE): `node eval/harness/m5_gate_check.mjs` → **56/56** (controllo 1 invariante per il verdetto sui pack senza i nuovi oracoli). `node eval/harness/a0_authz_gate_check.mjs` → **16/16** (A0 intatto). `node eval/harness/anti_tamper_check.mjs` → 49/49. `node eval/harness/build_discipline_check.mjs` → 21/21.

Se `m5` regredisce a causa del costo/finding di `twin` sul reference-app canonico: gate-are `twin` solo quando ci sono ≥2 directory-sorelle candidate (già implicito) o accettare che aggiunge finding non-bloccanti (il verdetto `green` deve restare identico). Diagnosi prima di procedere.

- [ ] **Step 3: Conformance dei pack toccati + lint**

Run: `node eval/harness/ecosystem_conformance.mjs supabase-jsts` (il pack pilota; il suo gate è `m5`, già coperto) e un paio di pack non-pilota per confermare l'additività. `node trueline/scripts/packaging/package_skill.mjs --json` → `ok:true`, lint VERDE (i 3 wrapper + config depcruise non-orfani; `SKILL.md` < 500 righe).

- [ ] **Step 4: Falsificabilità end-to-end**

Neutralizzare (orchestratore, copia di lavoro) il ramo `decl.duplication` in `control1Hygiene` → il keystone `dup:red` deve tornare **FAIL** (il gate dipende davvero dall'oracolo) → ripristinare → PASS. Documentare comando + output; nessuna modifica residua (`git diff --quiet checkpoint.mjs`).

- [ ] **Step 5: Measure reale su ASV Officina (report, non gate)**

Run (sola lettura, senza modificare il repo): `node trueline/scripts/oracles/run_dupcheck.mjs "C:/Users/claud/Desktop/ASV Officina" 50`, `run_cyclecheck.mjs`, `twin_check.mjs` — confermare che i tre oracoli **girano e producono un report** su un progetto reale (i 263 cloni / eventuali cicli / le coppie commesse-preventivi appaiono). È la prova di "gira sul reale"; NON un gate.

- [ ] **Step 6: Ledger + stato + dispatch**

`00-INDEX.md §4`: nota A2a (3 oracoli igiene, delta-gate, twin detection-only, categorie duplication/architecture, tarati sulla misura ASV; nessun lock nuovo). `SESSION-STATE.md`: riga 9 + §6/§7. `SKILL.md`/`references/modes/*.md`: 1-2 righe di dispatch del controllo 1 multi-oracolo + coverage declaration ("verbatim ≥50 token; rinominati non coperti → twin segnala; efficienza non gate-abile").

- [ ] **Step 7: Commit ledger**

```bash
rm -f ./NUL 2>/dev/null
git add 00-INDEX.md SESSION-STATE.md trueline/SKILL.md trueline/references
git commit -m "docs(a2a): ledger + stato + dispatch controllo 1 multi-oracolo + coverage declaration"
```

- [ ] **Step 8: STOP — merge human-gated**

NON mergeare in autonomia (`L-COL-024`). Riassumere all'utente: gate verde, branch pronto, chiedere l'ok per merge `--no-ff` + push + install riallineato.

---

## Self-Review

**1. Spec coverage** — §3.1 dup_check → Task 2/3/4/5; §3.2 cycle_check → Task 2/3/4/5; §3.3 twin_check (detection-only, per-oracolo) → Task 2/3/4 (`DETECTION_ONLY_ORACLES`/`partitionBlockers`); §4 finding model (enum) → Task 1; §5 controllo 1 multi-oracolo → Task 4; §6 BUILD/REMEDIATE → Task 4 (delta) + Task 6 Step 5 (report reale); §7 testing → Task 5 keystone + Task 6 gate; §8 invarianti → Global Constraints + Task 4/6. Coperta.

**2. Placeholder scan** — le note "adattare la shape ai campi esatti che validate_finding esige" (Task 3) e "individuare la struttura knip nel preflight" (Task 5) sono istruzioni di ancoraggio al codice reale, non placeholder vaghi: indicano il file e il metodo (grep + ricalco), con il test che valida l'esito. La forma di `v.cycle` di dependency-cruiser (Task 2 Step 3) è dichiarata come da-verificare-su-fixture con il test che la esercita. Nessun "TBD"/"handle edge cases".

**3. Type consistency** — `normalize('jscpd'|'depcruise'|'twin', …)` (Task 3) coerente coi wrapper `{oracle:'jscpd'|'depcruise'|'twin', …}` (Task 2) e con `source_oracle.oracle` usato da `DETECTION_ONLY_ORACLES`/keystone (Task 4/5). `control1Hygiene`/`partitionBlockers`/`DETECTION_ONLY_ORACLES` definiti in Task 4, usati in Task 5/6. `min_tokens` nel manifest (Task 5) letto in `control1Hygiene` (Task 4). Categorie `duplication`/`architecture` (Task 1) emesse dai normalizer (Task 3).

**Rischi noti** — (a) `v.cycle` shape version-dipendente → verificato su fixture in Task 2/5. (b) `twin` sul reference-app canonico potrebbe emettere finding (non-bloccanti) → verificare `m5` 56/56 in Task 6 Step 2, il VERDETTO deve restare identico. (c) `jscpd`/`dependency-cruiser` offline → wrapper degradano dichiarati (exit 1), keystone li richiede provisionati.
