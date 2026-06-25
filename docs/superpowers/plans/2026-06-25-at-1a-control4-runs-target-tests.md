# AT-1 Fase A — Controllo 4 esegue i target_test per-AC (test-gate reale) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Far sì che il controllo 4 in BUILD esegua i file specifici dei `target_test` per-AC del task (oggi gira `npm test`/characterization, blueprint-cieco), opt-in via flag esplicito `--blueprint`, BIT-invariante senza il flag.

**Architecture:** Plumbing additivo di `--blueprint` (+ `manifest`) end-to-end (`run_checkpoint`/`run_loop` → `runCheckpoint` → `control4Conformance`). Un ramo **opt-in** in `control4Conformance` (`mode==='build' && blueprintDir`) che **preempta** la characterization: risolve i `target_test` il cui file esiste su disco (via un loader replicato), li **esegue uno per uno** con `node --test {file}` (zero-install), e li esige verdi con **≥1 test eseguito** (floor anti-vacuo). Senza `--blueprint`, byte-identico a oggi. La Fase B (trace-check AC↔tag) ci salirà sopra in un plan successivo.

**Tech Stack:** Node ESM (solo built-in: `node:fs`, `node:path`, `node:url`, `node:child_process`), `node --test` (runner built-in), gli stessi pattern di `checkpoint.mjs`/`run_checkpoint.mjs`/`ac_observability_check.mjs`.

## Global Constraints

(Valgono per OGNI task — valori verbatim dalla spec.)

- **Node ESM, SOLO built-in** (+ moduli `trueline/scripts/*` dep-free). Nessun `npm install` di rete.
- **Determinismo (`L-COL-002`):** niente `Date.now()`/`Math.random()` in codice gate-eseguito; `RUN_OPTS.createdAt = '1970-01-01T00:00:00.000Z'`; ordine di scansione **stabile** (`.sort()`).
- **Oracle-as-judge (`L-COL-002`):** il "verde" è l'exit/output reale di un comando, mai una frase LLM.
- **BIT-invarianza:** senza `--blueprint`, output del checkpoint **byte-identico** a oggi (`m5` 56/56 invariato; `m5` gira `run_loop --mode=remediate`, non tocca il ramo build).
- **Onestà (`L-COL-006`):** VERDE controllo 4 = (file in scope ∧ ≥1 test eseguito ∧ esce 0). NON implica che l'asserzione eserciti l'AC (advisory).
- **`run_file` v1 = `node --test {file}`** (unico runner zero-install/provvigionabile offline). `spawnSync` **array-argv** (NON `shell:true`), `cwd=app`, PATH+GO_BIN.
- **Scope:** in scope = `target_test` il cui `file` **esiste** su disco; mancanti = saltati (mai RED); in-scope vuoto = **degradato** (non verde).
- **Lingua:** prosa/commenti in italiano; identificatori/`name`/schemi in inglese.
- **Git:** branch di lavoro; nessuna op git distruttiva autonoma; merge `main` human-gated (`L-COL-024`). Commit frequenti.
- **Loader:** `validate_blueprint.mjs` **non esporta nulla** → si crea un modulo nuovo `blueprint_tasks.mjs` (replica del loader) per i NUOVI consumatori (control4 + Fase B); `validate_blueprint`/`ac_observability_check` **non si toccano**.

---

## File structure

**Creati:**
- `trueline/scripts/blueprint/blueprint_tasks.mjs` — loader replicato + esportato (`loadTasks(dir) -> Task[]`). Sorgente unica per i NUOVI consumatori (control4, Fase B).
- `trueline/scripts/checkpoint/run_file.mjs` — `runTargetFile(appDir, file, template) -> { error, testCount, passed, detail }` (esegue `node --test`, parsa TAP).
- `eval/anti-tamper/<id>/{reference-app/, seeded-blueprint/}` (4 fixture: `faithful`, `failing`, `empty`, `partial`).
- `eval/anti-tamper/provision_fixtures.sh` — passo d'orchestratore (inner-`.git` + `node:test`, zero install).
- `eval/harness/anti_tamper_check.mjs` — harness d'accettazione Fase A.

**Modificati (additivi):**
- `trueline/scripts/checkpoint/checkpoint.mjs` — `control4Conformance` firma `+blueprintDir,+manifest` + ramo AC-acceptance; `runCheckpoint` passa `blueprintDir`+`manifest` a control4.
- `trueline/scripts/checkpoint/run_checkpoint.mjs` — `parseArgs` `+--blueprint`; `runOn`/`runCheckpoint` propagano `blueprintDir`.
- `trueline/scripts/loop/run_loop.mjs` — la chiamata `runCheckpoint` (≈r.353) passa `blueprintDir`.
- `trueline/references/ecosystems/supabase-jsts/ecosystem.json` — `test_runner.run_file: "node --test {file}"`.
- `.gitignore` — `+ eval/anti-tamper/*/reference-app/`.

**Interfacce-chiave (definite qui, consumate dai task):**
- `loadTasks(blueprintDir: string) -> Array<{ id, macrotask, acceptance_criteria:[{id,...}], target_tests:[{file:string, covers:string[]}] }>` — `covers` **sempre normalizzato ad array** (scalar→`[scalar]`).
- `runTargetFile(appDir, file, template) -> { error:boolean, testCount:number, passed:boolean, detail:string }`.
- `control4Conformance(app, { mode, characterization, finding, blueprintDir, manifest })` — invariata quando `blueprintDir==null`.

---

## Task A1: Loader replicato + esportato (`blueprint_tasks.mjs`)

**Files:**
- Create: `trueline/scripts/blueprint/blueprint_tasks.mjs`
- Test: `trueline/scripts/blueprint/blueprint_tasks.test.mjs`
- Reference (da cui REPLICARE il parser, verbatim): `trueline/scripts/blueprint/ac_observability_check.mjs` (funzioni `extractYamlBlocks`, `parseTasks`, `loadAllTasks`)

**Interfaces:**
- Produces: `export function loadTasks(blueprintDir) -> Task[]` (vedi shape sopra). `covers` normalizzato ad array.

- [ ] **Step 1: Scrivi il test che fallisce**

```js
// blueprint_tasks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTasks } from './blueprint_tasks.mjs';

test('loadTasks legge i task e normalizza covers scalare ad array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bt-'));
  writeFileSync(join(dir, '01.md'), [
    '```yaml',
    '- id: T-1',
    '  macrotask: m',
    '  objective: o',
    '  definition_of_done: [d]',
    '  acceptance_criteria:',
    '    - id: AC-1',
    '      given: g',
    '      when: w',
    '      then: t',
    '  target_tests:',
    '    - file: "tests/a.test.mjs"',
    '      covers: AC-1',            // scalare, non lista
    '```',
  ].join('\n'));
  const tasks = loadTasks(dir);
  assert.equal(tasks.length, 1);
  assert.deepEqual(tasks[0].target_tests[0].covers, ['AC-1']); // normalizzato
  assert.equal(tasks[0].target_tests[0].file, 'tests/a.test.mjs');
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisce**

Run: `node --test trueline/scripts/blueprint/blueprint_tasks.test.mjs`
Expected: FAIL (`Cannot find module './blueprint_tasks.mjs'`).

- [ ] **Step 3: Implementa il modulo (replica + normalizzazione + export)**

Copia **verbatim** da `ac_observability_check.mjs` le funzioni del loader (`extractYamlBlocks`, `parseTasks`, `loadAllTasks` e l'helper `nonEmptyStr`), poi esporta `loadTasks` che normalizza `covers`:

```js
// blueprint_tasks.mjs — loader del blueprint (replica di ac_observability_check;
// validate_blueprint non esporta nulla). Sorgente unica per i consumatori NUOVI
// (control4 AC-acceptance + Fase B trace-check). Node ESM, solo built-in.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// <<< INCOLLA QUI, VERBATIM, extractYamlBlocks + parseTasks + loadAllTasks + nonEmptyStr
//     da ac_observability_check.mjs (stesso comportamento, nessuna modifica) >>>

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === '') return [];
  return [v]; // scalare -> lista (coerente con validate_blueprint AC_COVERAGE)
}

export function loadTasks(blueprintDir) {
  const tasks = loadAllTasks(blueprintDir); // dalla replica
  for (const t of tasks) {
    for (const tt of (t.target_tests || [])) tt.covers = asArray(tt.covers);
  }
  return tasks;
}
```

- [ ] **Step 4: Esegui il test e verifica che passa**

Run: `node --test trueline/scripts/blueprint/blueprint_tasks.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add trueline/scripts/blueprint/blueprint_tasks.mjs trueline/scripts/blueprint/blueprint_tasks.test.mjs
git commit -m "feat(at-1a): blueprint_tasks loader (replica esportata, covers normalizzato)"
```

---

## Task A2: Esecutore single-file (`run_file.mjs`)

**Files:**
- Create: `trueline/scripts/checkpoint/run_file.mjs`
- Test: `trueline/scripts/checkpoint/run_file.test.mjs`

**Interfaces:**
- Consumes: nessuno.
- Produces: `export function runTargetFile(appDir, file, template) -> { error:boolean, testCount:number, passed:boolean, detail:string }`. `template` es. `"node --test {file}"`. Parsa l'output TAP di `node --test` per il conteggio (`# tests N`) e l'esito.

- [ ] **Step 1: Scrivi i test che falliscono** (file che passa; file vuoto = testCount 0; file che fallisce)

```js
// run_file.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTargetFile } from './run_file.mjs';

const TPL = 'node --test {file}';
function app(files) {
  const d = mkdtempSync(join(tmpdir(), 'rf-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(d, name), body);
  return d;
}

test('file con 1 test che passa -> passed, testCount 1', () => {
  const d = app({ 'a.test.mjs': "import {test} from 'node:test'; import a from 'node:assert/strict'; test('x',()=>a.equal(1,1));" });
  const r = runTargetFile(d, 'a.test.mjs', TPL);
  assert.equal(r.error, false); assert.equal(r.passed, true); assert.ok(r.testCount >= 1);
});

test('file SENZA test -> testCount 0 (floor anti-vacuo a valle)', () => {
  const d = app({ 'e.test.mjs': 'const x = 1; export default x;' });
  const r = runTargetFile(d, 'e.test.mjs', TPL);
  assert.equal(r.error, false); assert.equal(r.testCount, 0);
});

test('file con test che fallisce -> passed false', () => {
  const d = app({ 'f.test.mjs': "import {test} from 'node:test'; import a from 'node:assert/strict'; test('x',()=>a.equal(1,2));" });
  const r = runTargetFile(d, 'f.test.mjs', TPL);
  assert.equal(r.error, false); assert.equal(r.passed, false);
});
```

- [ ] **Step 2: Esegui e verifica che falliscono**

Run: `node --test trueline/scripts/checkpoint/run_file.test.mjs`
Expected: FAIL (`Cannot find module './run_file.mjs'`).

- [ ] **Step 3: Implementa `runTargetFile`**

```js
// run_file.mjs — esegue UN file di test (oracolo d'accettazione AC, AT-1 Fase A).
// node --test {file}, array-argv (no shell), parsa il riassunto TAP. Node ESM built-in.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';

const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';

// Costruisce argv dal template sostituendo {file}. v1: solo "node --test {file}".
function buildArgv(template, file) {
  const parts = template.trim().split(/\s+/).map((p) => p === '{file}' ? file : p);
  return { cmd: parts[0], args: parts.slice(1) };
}

export function runTargetFile(appDir, file, template) {
  if (!existsSync(join(appDir, file))) {
    return { error: true, testCount: 0, passed: false, detail: `file assente: ${file}` };
  }
  const { cmd, args } = buildArgv(template, file);
  const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };
  const res = spawnSync(cmd, args, { cwd: appDir, encoding: 'utf8', env, maxBuffer: 32 * 1024 * 1024 });
  if (res.error) return { error: true, testCount: 0, passed: false, detail: `spawn: ${res.error.message}` };
  const out = `${res.stdout || ''}\n${res.stderr || ''}`;
  // node --test stampa un riassunto TAP: "# tests N", "# pass N", "# fail N".
  const m = (re) => { const x = out.match(re); return x ? Number(x[1]) : null; };
  const testCount = m(/^#\s*tests\s+(\d+)/m) ?? 0;
  const failCount = m(/^#\s*fail\s+(\d+)/m) ?? (res.status === 0 ? 0 : 1);
  const passed = res.status === 0 && failCount === 0;
  return { error: false, testCount, passed, detail: `exit=${res.status} tests=${testCount} fail=${failCount}` };
}
```

- [ ] **Step 4: Esegui e verifica che passano**

Run: `node --test trueline/scripts/checkpoint/run_file.test.mjs`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add trueline/scripts/checkpoint/run_file.mjs trueline/scripts/checkpoint/run_file.test.mjs
git commit -m "feat(at-1a): run_file (node --test single-file, parsing TAP testCount/passed)"
```

---

## Task A3: `ecosystem.json` `run_file` per supabase-jsts

**Files:**
- Modify: `trueline/references/ecosystems/supabase-jsts/ecosystem.json` (oggetto `test_runner`)

**Interfaces:** Produces: `manifest.test_runner.run_file === "node --test {file}"`.

- [ ] **Step 1: Aggiungi il campo** (additivo; non rimuovere `detect`)

Nel blocco `"test_runner"`, aggiungi:
```json
"run_file": "node --test {file}"
```

- [ ] **Step 2: Verifica che il manifest resta valido**

Run: `node trueline/scripts/ecosystem/validate_ecosystem.mjs trueline/references/ecosystems/supabase-jsts/ecosystem.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add trueline/references/ecosystems/supabase-jsts/ecosystem.json
git commit -m "feat(at-1a): supabase-jsts manifest +test_runner.run_file=node --test"
```

---

## Task A4: Ramo AC-acceptance in `control4Conformance` + plumbing `runCheckpoint`

**Files:**
- Modify: `trueline/scripts/checkpoint/checkpoint.mjs` (`control4Conformance` r.423; `runCheckpoint` r.520/545)
- Test: `trueline/scripts/checkpoint/control4_ac.test.mjs`

**Interfaces:**
- Consumes: `loadTasks` (A1), `runTargetFile` (A2).
- Produces: `control4Conformance(app, { mode, characterization, finding, blueprintDir=null, manifest=null })` — quando `blueprintDir==null` output **invariato**.

- [ ] **Step 1: Scrivi i test** (default invariato golden; ramo AC verde/rosso/vacuo/scope-vuoto)

```js
// control4_ac.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { control4Conformance } from './checkpoint.mjs';

const MANIFEST = { test_runner: { run_file: 'node --test {file}' } };
function scaffold({ testBody, covers = 'AC-1' }) {
  const root = mkdtempSync(join(tmpdir(), 'c4-'));
  const app = join(root, 'app'); const bp = join(root, 'bp');
  mkdirSync(join(app, 'tests'), { recursive: true }); mkdirSync(bp, { recursive: true });
  if (testBody !== null) writeFileSync(join(app, 'tests', 'a.test.mjs'), testBody);
  writeFileSync(join(bp, '01.md'), [
    '```yaml', '- id: T-1', '  macrotask: m', '  objective: o', '  definition_of_done: [d]',
    '  acceptance_criteria:', '    - id: AC-1', '      given: g', '      when: w', '      then: t',
    '  target_tests:', '    - file: "tests/a.test.mjs"', `      covers: ${covers}`, '```',
  ].join('\n'));
  return { app, bp };
}

test('default (no blueprintDir) -> ramo legacy invariato (degradato senza test/charz)', () => {
  const { app } = scaffold({ testBody: null });
  const c = control4Conformance(app, { mode: 'build' });
  assert.equal(c.id, 4); assert.equal(c.green, false); assert.equal(c.status, 'degraded');
});

test('AC-acceptance: target_test verde -> controllo 4 verde', () => {
  const { app, bp } = scaffold({ testBody: "import {test} from 'node:test'; import a from 'node:assert/strict'; test('x',()=>a.equal(1,1));" });
  const c = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: MANIFEST });
  assert.equal(c.green, true);
});

test('AC-acceptance: target_test che fallisce -> RED', () => {
  const { app, bp } = scaffold({ testBody: "import {test} from 'node:test'; import a from 'node:assert/strict'; test('x',()=>a.equal(1,2));" });
  const c = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: MANIFEST });
  assert.equal(c.green, false);
});

test('AC-acceptance: file senza test (vacuo) -> RED (floor anti-vacuo)', () => {
  const { app, bp } = scaffold({ testBody: 'const x=1; export default x;' });
  const c = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: MANIFEST });
  assert.equal(c.green, false); assert.match(c.detail, /vacuo|alcun test/i);
});

test('AC-acceptance: nessun file materializzato -> degradato (non verde)', () => {
  const { app, bp } = scaffold({ testBody: null });
  const c = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: MANIFEST });
  assert.equal(c.green, false); assert.equal(c.status, 'degraded');
});

test('manifest senza run_file -> ramo legacy (guard)', () => {
  const { app, bp } = scaffold({ testBody: "import {test} from 'node:test'; test('x',()=>{});" });
  const c = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: { test_runner: {} } });
  assert.equal(c.status, 'degraded'); // non entra nel ramo AC
});
```

- [ ] **Step 2: Esegui e verifica che falliscono**

Run: `node --test trueline/scripts/checkpoint/control4_ac.test.mjs`
Expected: FAIL (i casi AC falliscono; il ramo non esiste ancora).

- [ ] **Step 3: Implementa il ramo** (in cima a `control4Conformance`, PRIMA del ramo characterization)

Aggiungi gli import in testa a `checkpoint.mjs`:
```js
import { existsSync } from 'node:fs';            // se non già importato
import { join } from 'node:path';                // se non già importato
import { loadTasks } from '../blueprint/blueprint_tasks.mjs';
import { runTargetFile } from './run_file.mjs';
```
Cambia la firma e aggiungi il ramo (PRECEDENZA: preempta characterization):
```js
export function control4Conformance(referenceApp, { mode = 'remediate', characterization = null, finding = null, blueprintDir = null, manifest = null } = {}) {
  // --- RAMO AC-ACCEPTANCE (AT-1 Fase A): build + blueprint esplicito + run_file nel manifest ---
  const runFileTpl = manifest && manifest.test_runner && manifest.test_runner.run_file;
  if (mode === 'build' && blueprintDir && runFileTpl) {
    let tasks;
    try { tasks = loadTasks(blueprintDir); }
    catch (e) { return { id: 4, name: 'conformance', status: 'error', green: false, detail: `blueprint non caricabile: ${e.message}` }; }
    const inScope = [];
    for (const t of tasks) for (const tt of (t.target_tests || [])) {
      if (existsSync(join(referenceApp, tt.file))) inScope.push(tt.file);
    }
    inScope.sort();
    if (inScope.length === 0) {
      return { id: 4, name: 'conformance', status: 'degraded', green: false, detail: 'nessun target_test materializzato sul disco (BUILD incrementale): controllo DEGRADATO, NON verde' };
    }
    const fails = [];
    for (const file of inScope) {
      const r = runTargetFile(referenceApp, file, runFileTpl);
      if (r.error) return { id: 4, name: 'conformance', status: 'error', green: false, detail: `errore d'esecuzione ${file}: ${r.detail}` };
      if (r.testCount < 1) fails.push(`${file} (vacuo: nessun test eseguito)`);
      else if (!r.passed) fails.push(`${file} (test rosso)`);
    }
    const green = fails.length === 0;
    return {
      id: 4, name: 'conformance', status: green ? 'green' : 'red', green,
      detail: green ? `accettazione AC: ${inScope.length} target_test verdi` : `accettazione AC fallita: ${fails.join('; ')}`,
    };
  }
  // --- RAMO LEGACY (invariato): characterization / npm test / degradato ---
  const charz = characterization || loadCharacterization(referenceApp);
  // ... (corpo legacy ESISTENTE, INVARIATO) ...
```
In `runCheckpoint` (r.545) passa `blueprintDir` e `manifest` a control4:
```js
  const c4 = control4Conformance(referenceApp, { mode, characterization, finding, blueprintDir, manifest });
```
e nella destrutturazione di `runCheckpoint` (r.520-540) aggiungi `blueprintDir = null,`.

- [ ] **Step 4: Esegui e verifica che passano**

Run: `node --test trueline/scripts/checkpoint/control4_ac.test.mjs`
Expected: PASS (6 test).

- [ ] **Step 5: Golden BIT-invarianza del default**

Run: `node eval/harness/m1_gate_check.mjs; echo "m1=$?"` (clean `eval/.tmp-verify` prima)
Expected: `m1=0` (default-path invariato).

- [ ] **Step 6: Commit**

```bash
git add trueline/scripts/checkpoint/checkpoint.mjs trueline/scripts/checkpoint/control4_ac.test.mjs
git commit -m "feat(at-1a): control4 ramo AC-acceptance (build+--blueprint, run_file, floor anti-vacuo, precedenza)"
```

---

## Task A5: Plumbing `--blueprint` in `run_checkpoint.mjs`

**Files:**
- Modify: `trueline/scripts/checkpoint/run_checkpoint.mjs` (`parseArgs` r.81; `runOn` r.258)

**Interfaces:** Produces: `run_checkpoint.mjs --in-place <app> --blueprint <dir> --mode build` attiva il ramo AC.

- [ ] **Step 1: Test (driva il binario su una copia)** — vedi harness Task A8 che lo esercita end-to-end; qui un micro-test di parsing.

```js
// run_checkpoint_args.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from './run_checkpoint.mjs';
test('--blueprint è parsato', () => {
  const { flags } = parseArgs(['--in-place', '--blueprint', '/tmp/bp', '--mode', 'build']);
  assert.equal(flags.blueprint, '/tmp/bp');
});
```

- [ ] **Step 2: Esegui e verifica che fallisce**

Run: `node --test trueline/scripts/checkpoint/run_checkpoint_args.test.mjs`
Expected: FAIL (`flags.blueprint` undefined).

- [ ] **Step 3: Implementa** — in `parseArgs` aggiungi (nel ciclo, accanto a `--baseline`):
```js
    else if (a === '--blueprint') flags.blueprint = argv[++i];
    else if (a.startsWith('--blueprint=')) flags.blueprint = a.slice('--blueprint='.length);
```
e nel default `flags` aggiungi `blueprint: null,`. In `runOn` (firma destrutturata r.258) aggiungi `blueprint` e passalo a `runCheckpoint`:
```js
function runOn(dir, { mode, eval: evalMode, noOsv, baseline, copied, workspace, blueprint }) {
  // ...
  let cp = runCheckpoint(dir, { mode, baseline, runOpts: RUN_OPTS, withOsv: !noOsv, blueprintDir: blueprint });
  // ... (idem nel retry-loop measureAttempts: aggiungi blueprintDir: blueprint)
```
e dove `runOn` è chiamato (r.195, r.229) passa `blueprint: flags.blueprint`.

- [ ] **Step 4: Esegui e verifica che passa**

Run: `node --test trueline/scripts/checkpoint/run_checkpoint_args.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add trueline/scripts/checkpoint/run_checkpoint.mjs trueline/scripts/checkpoint/run_checkpoint_args.test.mjs
git commit -m "feat(at-1a): run_checkpoint --blueprint flag + propagazione a runCheckpoint"
```

---

## Task A6: Forwarding `--blueprint` in `run_loop.mjs`

**Files:**
- Modify: `trueline/scripts/loop/run_loop.mjs` (la chiamata `runCheckpoint`, ≈r.353)

**Interfaces:** Produces: `run_loop --mode=build --blueprint <dir>` propaga `blueprintDir` al checkpoint.

- [ ] **Step 1: Individua la chiamata** — cerca `runCheckpoint(ws.dir` in `run_loop.mjs`.

Run: `grep -n "runCheckpoint(" trueline/scripts/loop/run_loop.mjs`
Expected: la riga ≈353 con `{ mode, runOpts, withOsv, baseline }`.

- [ ] **Step 2: Aggiungi `blueprintDir`** — `blueprintDir` è già letto dal flag (≈r.244). Passalo:
```js
  const cp = runCheckpoint(ws.dir, { mode, runOpts: RUN_OPTS, withOsv: false, baseline, blueprintDir });
```
(usa il nome di variabile reale già presente per il flag `--blueprint`).

- [ ] **Step 3: Verifica BIT-invarianza senza flag** (default-path identico)

Run (clean `eval/.tmp-verify` prima): `node trueline/scripts/loop/run_loop.mjs --eval --mode=remediate > /tmp/rl.json; echo $?`
Expected: exit 0, nessuna chiave nuova nel report rispetto a oggi (shape invariata).

- [ ] **Step 4: Commit**

```bash
git add trueline/scripts/loop/run_loop.mjs
git commit -m "feat(at-1a): run_loop inoltra --blueprint a runCheckpoint sul build-path"
```

---

## Task A7: Fixture `eval/anti-tamper/*` + provisioning

**Files:**
- Create: `eval/anti-tamper/{faithful,failing,empty,partial}/reference-app/{package.json,tests/*.test.mjs,src/index.mjs}`
- Create: `eval/anti-tamper/{faithful,failing,empty,partial}/seeded-blueprint/01.md`
- Create: `eval/anti-tamper/provision_fixtures.sh`
- Modify: `.gitignore` (`+ eval/anti-tamper/*/reference-app/`)

**Interfaces:** Produces: 4 fixture con file `node:test` reali (zero install) + inner-`.git`.
- `faithful` — `tests/a.test.mjs` con 1 test che passa.
- `failing` — `tests/a.test.mjs` con 1 test che fallisce.
- `empty` — `tests/a.test.mjs` senza alcun `test()`.
- `partial` — 2 target_test nel blueprint, solo 1 file su disco (l'altro = task non costruito → saltato).

- [ ] **Step 1: Crea i fixture** (ogni `reference-app/package.json` = `{"name":"x","type":"module","version":"1.0.0"}`; nessuna dipendenza). Esempi:

`faithful/reference-app/tests/a.test.mjs`:
```js
import { test } from 'node:test'; import assert from 'node:assert/strict';
test('accetta AC-1', () => { assert.equal(1, 1); });
```
`failing/reference-app/tests/a.test.mjs`: come sopra ma `assert.equal(1, 2);`.
`empty/reference-app/tests/a.test.mjs`: `const x = 1; export default x;` (nessun `test()`).
Ogni `seeded-blueprint/01.md` = un task `T-1` con `target_tests: [{ file: "tests/a.test.mjs", covers: [AC-1] }]` (formato di `eval/seeded-blueprint/01-prenotazioni.md`). Per `partial`, `target_tests` ha **due** voci (`tests/a.test.mjs` esiste, `tests/b.test.mjs` NO).

- [ ] **Step 2: `.gitignore`** — aggiungi `eval/anti-tamper/*/reference-app/`.

- [ ] **Step 3: `provision_fixtures.sh`** (mirror di `eval/build-discipline/provision_fixtures.sh`): per ogni fixture, `git init` + commit dei soli sorgenti (`package.json`, `src`, `tests`) con identità deterministica `Reference App Bot`; idempotente.

- [ ] **Step 4: Provisiona ed esegui smoke**

Run: `bash eval/anti-tamper/provision_fixtures.sh`
Run: `node trueline/scripts/checkpoint/run_file.mjs` non-CLI — invece smoke via control4: vedi A8.
Verifica: ogni `eval/anti-tamper/<id>/reference-app/.git` esiste; `git check-ignore eval/anti-tamper/faithful/reference-app/tests/a.test.mjs` lo conferma ignorato dal repo esterno.

- [ ] **Step 5: Commit** (solo i `seeded-blueprint` + lo script sono tracked)

```bash
git add eval/anti-tamper/*/seeded-blueprint eval/anti-tamper/provision_fixtures.sh .gitignore
git commit -m "test(at-1a): 4 fixture anti-tamper (node:test reali) + provisioning + .gitignore"
```

---

## Task A8: Harness d'accettazione Fase A (`anti_tamper_check.mjs`)

**Files:**
- Create: `eval/harness/anti_tamper_check.mjs`

**Interfaces:**
- Consumes: il binario SPEDITO `run_checkpoint.mjs --in-place <copia> --blueprint <bp> --mode build`; i fixture A7.
- Produces: gate parametrico Fase A, `exit 0/1/2`.

- [ ] **Step 1: Scrivi l'harness** (mirror di `build_discipline_check.mjs`: radice temp PRIVATA per-pid `eval/.tmp-at-<pid>`, `cleanBdTmp`-style never-throw, `assert(name,ok,detail)`, copia isolata per-fixture con `.git`, asserisce `controls[3].green`). Sotto-test:
  - **faithful** → `controls[3].green===true`.
  - **failing** → `controls[3].green===false` (detail "test rosso").
  - **empty** → `controls[3].green===false` (detail "vacuo").
  - **partial** → `controls[3].green===true` (il file mancante è saltato, l'esistente passa).
  - **not-built (in-scope vuoto)**: una copia senza `tests/` → `controls[3].status==='degraded'`.
  - **flag-not-disk (attivazione)**: sul fixture `faithful`, `run_checkpoint --in-place <copia>` **senza** `--blueprint` → `controls[3]` legacy (`degraded`) **≠** **con** `--blueprint` → `green`; asserisci che DIFFERISCONO.
  - **0-contaminazione**: HEAD esterno (`371776f`/quello corrente) + HEAD interni dei fixture invariati; nessun residuo `eval/.tmp-at-*`.
  - `process.exit(allOk?0:1)`; precondizione `.git`/`run_file` assenti → `exit 2`.

- [ ] **Step 2: Esegui (clean temp prima)**

Run: `rm -rf eval/.tmp-at-* eval/.tmp-verify; node eval/harness/anti_tamper_check.mjs; echo $?`
Expected: stampa i sotto-test PASS, `exit 0`.

- [ ] **Step 3: Falsificabilità** — neutralizza su COPIA il fixture `faithful` (rompi l'asserzione) → l'harness deve dare il sotto-test faithful FAIL; ripristina → PASS. (Documenta nel commit.)

- [ ] **Step 4: Determinismo back-to-back** (lezione BD-1)

Run: `for i in 1 2 3 4 5; do node eval/harness/anti_tamper_check.mjs >/dev/null 2>&1; echo "run$i=$?"; done`
Expected: `run*=0` ogni volta (nessun falso exit-1).

- [ ] **Step 5: Commit**

```bash
git add eval/harness/anti_tamper_check.mjs
git commit -m "test(at-1a): harness anti_tamper_check Fase A (driva run_checkpoint --blueprint spedito; 7 sotto-test)"
```

---

## Self-review (writing-plans) — copertura della spec (Fase A)

- spec §5.1 data-flow (5 edit) → **A4** (control4 firma + runCheckpoint) + **A5** (run_checkpoint flag) + **A6** (run_loop). §5.2 ramo AC + precedenza + scope + degradato → **A4**. §5.2bis run_file `node --test` + array-argv + testCount≥1 + guard !run_file→legacy → **A2** + **A4** + **A3**. §5.3 loader replicato/esportato → **A1**. §7 fixture nuove + provisioning + harness su `run_checkpoint` spedito + sotto-test (faithful/failing/empty/partial/not-built/flag-not-disk/0-contam) → **A7** + **A8**. §7.16 no-regressione → **A4 Step 5** (m1) + run finale (sotto). **Fase B (trace-check, §5.3 check (1), convenzione tag, sotto-test untagged/tag-in-stringa/multi-file/scalar/spurio/mixed) = plan successivo.**
- Placeholder scan: nessun "TBD"; la sola replica-da-codice-esistente (A1 Step 3) cita la fonte esatta (`ac_observability_check.mjs`, funzioni nominate) — istruzione concreta, non placeholder.
- Type consistency: `loadTasks`→`tasks[].target_tests[].{file,covers[]}` (A1) consumati identici in A4; `runTargetFile`→`{error,testCount,passed,detail}` (A2) consumati identici in A4; `control4Conformance(...,{blueprintDir,manifest})` (A4) ↔ `runCheckpoint`/`run_checkpoint`/`run_loop` (A4/A5/A6).

## No-regressione integrale (a fine Fase A, orchestratore, SERIALE — prima del merge)

`build_discipline_check` 21/21 · `m5` 56/56 · `ecosystem_conformance` 5 pack · `run_eval` · `package_skill` lint VERDE · `anti_tamper_check` Fase A verde + falsificabile · 0-contaminazione. Merge **human-gated** su `main` (`L-COL-024`).
