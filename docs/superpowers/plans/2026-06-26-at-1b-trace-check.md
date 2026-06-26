# AT-1 Fase B — Trace-check AC↔tag `covers:` (anti-tamper della provenienza) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: questo plan si **costruisce via Dynamic Workflow** (`L-COL-027`, `DYNAMIC-WORKFLOWS.md`), non con subagent-driven-development generico. La mappa ondate/DAG è in **§Esecuzione (Dynamic Workflow)** in fondo. Gli step usano la sintassi checkbox (`- [ ]`). **Git è SOLO dell'orchestratore** (`L-COL-024`): gli agenti del workflow SCRIVONO FILE, **mai** `git`. Lo step "Commit" di ogni task è eseguito dall'**orchestratore** dopo il verde del gate del task.

**Goal:** Aggiungere al ramo AC-acceptance del controllo 4 (BUILD `--blueprint`, AT-1 Fase A) una **precondizione di trace**: ogni `acceptance_criteria` valutato deve essere *tracciato* da un tag `covers: <AC-id>` in un **commento** di almeno un suo `target_test` in-scope, altrimenti il controllo 4 è **RED prima di eseguire** — chiudendo la gameabilità "test verde che non dichiara quale AC esercita".

**Architecture:** Un nuovo oracolo sibling `ac_assertion_trace_check.mjs` (riusa il loader esportato `loadTasks` di Fase A — **nessuna 3ª replica del parser YAML**) esporta `assertionTrace(tasks, appDir, inScope)`. `control4Conformance` lo invoca come precondizione **tra** il calcolo di `inScope` e il loop d'esecuzione (additivo, BIT-invariante: vive solo nel ramo `mode==='build' && blueprintDir && runFileTpl`). Il keystone Fase A `anti_tamper_check.mjs` si **estende** con i sotto-test di trace su fixture nuove. La detezione del tag è **string-aware** (un `//` dentro una stringa non apre un commento) per resistere al tag-in-stringa.

**Tech Stack:** Node.js ESM, **solo moduli built-in** (`node:fs`, `node:path`, `node:url`, `node:test`, `node:child_process`). Nessun `npm install`. Esecuzione test fixture via `node --test`.

## Global Constraints

*(Ogni task eredita implicitamente questa sezione. Valori verbatim dal brief §8 e dalla spec.)*

- **Solo built-in** (+ moduli `trueline/scripts/*` dep-free). Nessuna dipendenza di rete.
- **Determinismo (`L-COL-002`):** nessun `Date.now()` / `Math.random()` nel codice spedito; ordine stabile (`.sort()` / `localeCompare`). Negli harness/test è ammesso `process.pid` (non `Date`/`Math.random`).
- **BIT-invarianza:** la precondizione trace vive **solo** nel ramo `mode==='build' && blueprintDir && runFileTpl` di `control4Conformance`. Il ramo legacy resta **byte-identico** → `m5` **56/56** + `ecosystem_conformance` 5 pack + `build_discipline_check` **21/21** + `anti_tamper_check` Fase A **invariati**.
- **Oracle-as-judge (`L-COL-002`):** il "verde" è exit/output reale (presenza/assenza fisica del tag), **mai** una frase LLM. La presenza-tag è **floor deterministico** (`L-COL-006`): NON prova di bontà semantica dell'asserzione (resta advisory).
- **Git solo nell'orchestratore (`L-COL-024`):** gli agenti scrivono file, NON toccano git; provisioning `.git` dei fixture + commit + merge = passi d'orchestratore; merge `main` **human-gated**.
- **Lezioni BD-1 (keystone):** radice temp PRIVATA per-pid (`eval/.tmp-at-<pid>`), cleanup **never-throw**, **la verità è la riesecuzione SERIALE** dell'orchestratore (mai il green/red sotto concorrenza del workflow).
- **Lingua:** prosa/commenti in italiano; identificatori / `name` / chiavi di schema in inglese (convenzione `00-INDEX`).
- **Branch:** `feat/at-1b-trace-check` (già creato da `main` @ `fdf0963`). **Nessun** merge su `main` senza il verde seriale + via libera umana.

---

## File Structure

| File | Responsabilità | Task |
|---|---|---|
| `trueline/scripts/blueprint/ac_assertion_trace_check.mjs` | **Create** — oracolo sibling: `textTracesAc` (detezione tag string-aware, pura) + `assertionTrace(tasks,appDir,inScope)` + CLI | 1 |
| `trueline/scripts/blueprint/ac_assertion_trace_check.test.mjs` | **Create** — unit test del checker (semantica commento + logica AC) | 1 |
| `eval/anti-tamper/{tampered-untagged,tag-in-stringa,ac-multi-file,covers-scalare,tag-spurio,mixed-coverage}/` | **Create** — 6 fixture di scenario trace (seeded-blueprint + reference-app) | 2 |
| `eval/anti-tamper/fixture_trace_check.mjs` | **Create** — gate standalone dei fixture: `validate_blueprint` PASS (ortogonalità) + stato-tag su disco atteso | 2 |
| `eval/anti-tamper/provision_fixtures.sh` | **Modify** — aggiungi i 6 fixture nuovi alla lista provisioning `.git` | 2 |
| `trueline/references/build-discipline.md` | **Modify §2 Momento 2** — documenta la convenzione `covers:` in commento; aggiorna il forward-ref righe 82–84 al meccanismo realizzato | 3 |
| `trueline/references/blueprint/atomic-task-schema.md` | **Modify** — nota sulla convenzione `covers:` nel commento del target_test (anti-tamper provenienza) | 3 |
| `trueline/scripts/checkpoint/checkpoint.mjs` | **Modify** — import `assertionTrace` + precondizione trace nel ramo AC (tra r.451 e r.452) | 4 |
| `trueline/scripts/checkpoint/checkpoint.trace.test.mjs` | **Create** — unit test del wiring: BIT-invarianza legacy + RED-trace-prima-dell'esecuzione | 4 |
| `eval/harness/anti_tamper_check.mjs` | **Modify** — estendi col fixture set trace + sotto-test (7)…(14) | 5 |
| `00-INDEX.md` | **Modify §4** — emenda `L-COL-032` col braccio trace-check | 6 (orchestratore) |
| `SESSION-STATE.md` | **Modify** — chiusura sessione AT-1 Fase B | 6 (orchestratore) |

---

## Task 1: Checker `ac_assertion_trace_check.mjs` (oracolo sibling + unit test)

**Files:**
- Create: `trueline/scripts/blueprint/ac_assertion_trace_check.mjs`
- Test: `trueline/scripts/blueprint/ac_assertion_trace_check.test.mjs`

**Interfaces:**
- Consumes: `loadTasks(blueprintDir)` da `trueline/scripts/blueprint/blueprint_tasks.mjs` (esportato in Fase A; normalizza `target_tests[].covers` scalar→array).
- Produces (consumati da Task 4 e Task 1-test):
  - `export function textTracesAc(text: string, acId: string): boolean` — true sse `covers:\s*<acId>\b` compare nella **porzione commentata** di una riga di `text` (string-aware, block-comment multilinea).
  - `export function assertionTrace(tasks, appDir, inScope): { ok: boolean, detail: string, untracked: {task_id, ac_id}[] }` — `ok=false` sse ≥1 AC **valutato** (≥1 file coprante in-scope) non è **tracciato** da alcun suo file coprante in-scope.
  - CLI: `node ac_assertion_trace_check.mjs <blueprint-dir> <app-dir> [--json]` → exit 0 (ok) / 1 (untracked) / 2 (uso errato).

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `trueline/scripts/blueprint/ac_assertion_trace_check.test.mjs`:

```js
// ac_assertion_trace_check.test.mjs — unit test del checker di trace (AT-1 Fase B).
// Due livelli: (A) textTracesAc PURA (semantica del commento, niente IO) — copre la
// gameabilita' tag-in-stringa e l'ancoraggio dell'id; (B) assertionTrace su una temp
// fixture pid-named sotto eval/.tmp-at1b-unit-<pid> (gitignorata) — copre la logica AC
// (valutato/saltato, per-AC globale, tag spurio). Solo built-in, deterministico (pid).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textTracesAc, assertionTrace } from './ac_assertion_trace_check.mjs';

// ---------- (A) textTracesAc — semantica del commento, string-aware ----------
test('tag su riga di commento dedicata → conta', () => {
  assert.equal(textTracesAc('// covers: AC-1', 'AC-1'), true);
});
test('tag in commento di coda (dopo codice) → conta', () => {
  assert.equal(textTracesAc('runTest();   // covers: AC-1', 'AC-1'), true);
});
test('covers dentro una stringa → NON conta (gameabilita tag-in-stringa)', () => {
  assert.equal(textTracesAc('const s = "// covers: AC-1";', 'AC-1'), false);
  assert.equal(textTracesAc('const s = "covers: AC-1";', 'AC-1'), false);
});
test('covers come codice nudo (nessun commento) → NON conta', () => {
  assert.equal(textTracesAc('covers: AC-1', 'AC-1'), false);
});
test('id ancorato: AC-1 non matcha AC-10 e viceversa', () => {
  assert.equal(textTracesAc('// covers: AC-10', 'AC-1'), false);
  assert.equal(textTracesAc('// covers: AC-1', 'AC-10'), false);
  assert.equal(textTracesAc('// covers: AC-10', 'AC-10'), true);
});
test('prefissi # e -- contano come commento', () => {
  assert.equal(textTracesAc('# covers: AC-2', 'AC-2'), true);
  assert.equal(textTracesAc('-- covers: AC-2', 'AC-2'), true);
});
test('block comment /* ... */ multilinea conta', () => {
  assert.equal(textTracesAc('/*\n  covers: AC-3\n*/', 'AC-3'), true);
});
test('tag dopo la chiusura di una stringa sulla stessa riga conta', () => {
  assert.equal(textTracesAc('foo("x"); // covers: AC-1', 'AC-1'), true);
});

// ---------- (B) assertionTrace — logica AC su temp fixture -------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const TMP = join(ROOT, 'eval', `.tmp-at1b-unit-${process.pid}`);
function writeApp(files) {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'tests'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) writeFileSync(join(TMP, rel), content);
}
const task = (ac, tt) => [{ id: 'T-1', acceptance_criteria: ac, target_tests: tt }];

test('AC valutato e tracciato → ok', () => {
  writeApp({ 'tests/a.test.mjs': '// covers: AC-1\n' });
  const r = assertionTrace(task([{ id: 'AC-1' }], [{ file: 'tests/a.test.mjs', covers: ['AC-1'] }]),
    TMP, ['tests/a.test.mjs']);
  assert.equal(r.ok, true);
});
test('AC valutato NON tracciato → red + untracked elencato', () => {
  writeApp({ 'tests/a.test.mjs': '// nessun tag qui\n' });
  const r = assertionTrace(task([{ id: 'AC-1' }], [{ file: 'tests/a.test.mjs', covers: ['AC-1'] }]),
    TMP, ['tests/a.test.mjs']);
  assert.equal(r.ok, false);
  assert.deepEqual(r.untracked, [{ task_id: 'T-1', ac_id: 'AC-1' }]);
});
test('file coprante mancante (fuori scope) → AC saltato, non red', () => {
  writeApp({ 'tests/a.test.mjs': '// covers: AC-1\n' });
  const r = assertionTrace(
    task([{ id: 'AC-1' }, { id: 'AC-2' }],
      [{ file: 'tests/a.test.mjs', covers: ['AC-1'] }, { file: 'tests/b.test.mjs', covers: ['AC-2'] }]),
    TMP, ['tests/a.test.mjs']); // b fuori scope → AC-2 saltato
  assert.equal(r.ok, true);
});
test('per-AC GLOBALE: due file copranti, basta uno taggato', () => {
  writeApp({ 'tests/a.test.mjs': '// covers: AC-1\n', 'tests/b.test.mjs': '// niente\n' });
  const r = assertionTrace(task([{ id: 'AC-1' }],
    [{ file: 'tests/a.test.mjs', covers: ['AC-1'] }, { file: 'tests/b.test.mjs', covers: ['AC-1'] }]),
    TMP, ['tests/a.test.mjs', 'tests/b.test.mjs']);
  assert.equal(r.ok, true);
});
test('tag spurio (AC-99 non dichiarato) ignorato, AC-1 reale traccia → ok', () => {
  writeApp({ 'tests/a.test.mjs': '// covers: AC-1\n// covers: AC-99\n' });
  const r = assertionTrace(task([{ id: 'AC-1' }], [{ file: 'tests/a.test.mjs', covers: ['AC-1'] }]),
    TMP, ['tests/a.test.mjs']);
  assert.equal(r.ok, true);
});
test('covers scalare → trattato come [scalare] dal chiamante (qui gia array)', () => {
  writeApp({ 'tests/a.test.mjs': '// covers: AC-1\n' });
  const r = assertionTrace(task([{ id: 'AC-1' }], [{ file: 'tests/a.test.mjs', covers: ['AC-1'] }]),
    TMP, ['tests/a.test.mjs']);
  assert.equal(r.ok, true);
});
test.after(() => { rmSync(TMP, { recursive: true, force: true }); });
```

- [ ] **Step 2: Esegui il test per verificare che FALLISCA**

Run: `node --test trueline/scripts/blueprint/ac_assertion_trace_check.test.mjs`
Expected: FAIL — `Cannot find module './ac_assertion_trace_check.mjs'` (il modulo non esiste ancora).

- [ ] **Step 3: Implementa il checker (codice minimo completo)**

Crea `trueline/scripts/blueprint/ac_assertion_trace_check.mjs`:

```js
#!/usr/bin/env node
// ac_assertion_trace_check.mjs — oracolo deterministico dell'ANTI-TAMPER della
// PROVENIENZA del test d'accettazione (AT-1 Fase B, spec §5.3; completa L-COL-032).
//
// FRATELLO (sibling) di validate_blueprint/ac_observability_check, NON una loro
// modifica. RIUSA il loader esportato loadTasks(dir) di blueprint_tasks.mjs (Fase A):
// NESSUNA replica del parser YAML (riduce il debito 3ª-copia annotato in L-COL-029).
//
// SEMANTICA (spec §5.3 / brief §5): ogni acceptance_criteria VALUTATO deve essere
// TRACCIATO da ≥1 suo file coprante IN-SCOPE, tramite un tag `covers: <AC-id>` dentro
// un COMMENTO del file. Un AC valutato non tracciato → assertionTrace { ok:false } →
// control4 RED PRIMA di eseguire: un target_test che non dichiara QUALE AC esercita non
// e' una provenienza d'accettazione valida.
//
//   - VALUTATO: un AC e' valutato sse ≥1 dei suoi file copranti (i target_tests del suo
//     task il cui covers include l'AC) e' IN-SCOPE (presente su disco). Tutti i copranti
//     mancanti → SALTATO (non RED), coerente con lo skip della Fase A.
//   - TRACCIATO (per-AC GLOBALE): basta UN file coprante in-scope che contenga il tag.
//   - covers normalizzato scalar→[scalar] a monte (loadTasks).
//   - Tag valido: `covers:\s*<id>\b` ancorato all'id esatto (AC-1 NON matcha AC-10) che
//     compaia nella PORZIONE COMMENTATA di una riga (string-aware: un // dentro una
//     stringa NON apre un commento → chiude la gameabilita' tag-in-stringa).
//   - Tag spurio (id non tra i covers dichiarati del file) → IGNORATO: e' semplicemente
//     mai interrogato (si cerca covers:<id> solo per gli AC valutati di quel task).
//
// L-COL-002 (oracle-as-judge): il verde e' un FATTO (presenza/assenza fisica del tag),
// MAI una frase LLM. L-COL-006: la presenza-tag e' un FLOOR deterministico, NON prova di
// bonta' semantica dell'asserzione (resta advisory). Determinismo: nessun Date.now()/
// Math.random(); ordine stabile (localeCompare).
//
// Node ESM, SOLO built-in (+ loadTasks dep-free). Nessun npm install.

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTasks } from './blueprint_tasks.mjs';

// --- escape per regex (l'id e' interpolato in un pattern) --------------------
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Porzione COMMENTATA di una riga, string-aware ---------------------------
// Scandisce la riga char-by-char tracciando lo stato di stringa (' " `) e di
// block-comment /* */ (propagato tra righe via `inBlock`). Ritorna { commented,
// inBlockAfter }: `commented` = concatenazione dei tratti DENTRO un commento (di
// riga // # --, o di blocco). Un marcatore di commento DENTRO una stringa NON apre
// un commento (gameabilita' tag-in-stringa chiusa). Lo stato di stringa NON e'
// propagato tra righe (le stringhe multilinea sono un limite advisory, brief §10).
function commentedPortion(line, inBlock) {
  let commented = '';
  let i = 0;
  let block = inBlock;
  let str = null; // null | "'" | '"' | '`'
  while (i < line.length) {
    const c = line[i];
    const c2 = i + 1 < line.length ? line[i + 1] : '';
    if (block) {
      if (c === '*' && c2 === '/') { commented += '*/'; block = false; i += 2; continue; }
      commented += c; i += 1; continue;
    }
    if (str) {
      if (c === '\\') { i += 2; continue; }       // escape: salta il prossimo char
      if (c === str) { str = null; i += 1; continue; }
      i += 1; continue;
    }
    if (c === '"' || c === "'" || c === '`') { str = c; i += 1; continue; }
    if (c === '/' && c2 === '*') { block = true; commented += '/*'; i += 2; continue; }
    if (c === '/' && c2 === '/') { commented += line.slice(i); break; } // line comment //
    if (c === '#') { commented += line.slice(i); break; }              // line comment #
    if (c === '-' && c2 === '-') { commented += line.slice(i); break; } // line comment -- (SQL)
    i += 1;
  }
  return { commented, inBlockAfter: block };
}

// --- Un testo traccia l'AC? (PURA, esportata per il test) --------------------
// True sse una porzione commentata di una qualunque riga contiene covers:<id>
// ancorato. Block-comment propagato tra righe.
export function textTracesAc(text, acId) {
  const re = new RegExp('covers:\\s*' + escapeRegex(acId) + '\\b');
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  let inBlock = false;
  for (const line of lines) {
    const { commented, inBlockAfter } = commentedPortion(line, inBlock);
    if (commented && re.test(commented)) return true;
    inBlock = inBlockAfter;
  }
  return false;
}

// --- Un file (in-scope) traccia l'AC? ----------------------------------------
function fileTracesAc(absFile, acId) {
  if (!existsSync(absFile)) return false;
  let text;
  try { text = readFileSync(absFile, 'utf8'); } catch { return false; }
  return textTracesAc(text, acId);
}

// --- API: assertionTrace -----------------------------------------------------
export function assertionTrace(tasks, appDir, inScope) {
  const inScopeSet = new Set(inScope || []);
  const untracked = [];
  for (const t of (tasks || [])) {
    const taskId = (typeof t.id === 'string' && t.id.trim()) ? t.id : '(?)';
    // Per AC: i file copranti IN-SCOPE di questo task (covers gia' array da loadTasks).
    const coveringInScope = new Map(); // acId -> [file, ...]
    for (const tt of (t.target_tests || [])) {
      if (!tt || typeof tt.file !== 'string') continue;
      if (!inScopeSet.has(tt.file)) continue; // fuori scope (mancante) → non contribuisce
      for (const acId of (tt.covers || [])) {
        if (!coveringInScope.has(acId)) coveringInScope.set(acId, []);
        coveringInScope.get(acId).push(tt.file);
      }
    }
    for (const ac of (t.acceptance_criteria || [])) {
      if (!ac || typeof ac !== 'object') continue;
      const acId = (typeof ac.id === 'string' && ac.id.trim()) ? ac.id : null;
      if (!acId) continue;
      const covering = coveringInScope.get(acId) || [];
      if (covering.length === 0) continue; // AC non valutato → saltato (non RED)
      const traced = covering.some((file) => fileTracesAc(join(appDir, file), acId));
      if (!traced) untracked.push({ task_id: taskId, ac_id: acId });
    }
  }
  untracked.sort((a, b) =>
    `${a.task_id}/${a.ac_id}`.localeCompare(`${b.task_id}/${b.ac_id}`));
  const ok = untracked.length === 0;
  const detail = ok
    ? "ogni AC valutato e' tracciato da un file coprante in-scope (tag covers: in commento)"
    : untracked.map((u) => `${u.task_id}/${u.ac_id}`).join(' | ');
  return { ok, detail, untracked };
}

// --- CLI (eseguita solo se il modulo e' invocato direttamente) ---------------
function mainCli() {
  const argv = process.argv.slice(2);
  const jsonMode = argv.includes('--json');
  const pos = argv.filter((a) => !a.startsWith('--'));
  const blueprintDir = pos[0];
  const appDir = pos[1];
  if (!blueprintDir || !appDir) {
    console.error('uso: node ac_assertion_trace_check.mjs <blueprint-dir> <app-dir> [--json]');
    process.exit(2);
  }
  const tasks = loadTasks(blueprintDir);
  const inScope = [];
  for (const t of tasks) {
    for (const tt of (t.target_tests || [])) {
      if (tt && typeof tt.file === 'string' && existsSync(join(appDir, tt.file))) inScope.push(tt.file);
    }
  }
  inScope.sort();
  const res = assertionTrace(tasks, appDir, inScope);
  if (jsonMode) {
    console.log(JSON.stringify({
      tool: 'ac_assertion_trace_check', blueprint_dir: blueprintDir, app_dir: appDir,
      in_scope: inScope, ok: res.ok, untracked: res.untracked,
    }, null, 2));
  } else {
    console.log(`ac_assertion_trace_check — blueprint: ${blueprintDir} · app: ${appDir}`);
    console.log(`  in-scope: ${inScope.length} target_test`);
    console.log(`  [${res.ok ? 'OK' : 'FAIL'}] AC_TRACE — ${res.detail}`);
    console.log(res.ok ? 'RESULT: OK' : 'RESULT: FAIL (AC valutato non tracciato)');
  }
  process.exit(res.ok ? 0 : 1);
}

const invokedDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirect) mainCli();
```

- [ ] **Step 4: Esegui il test per verificare che PASSI**

Run: `node --test trueline/scripts/blueprint/ac_assertion_trace_check.test.mjs`
Expected: PASS — tutti i test (≥14) verdi, 0 falliti.

- [ ] **Step 5: Commit (ORCHESTRATORE)**

```bash
git add trueline/scripts/blueprint/ac_assertion_trace_check.mjs trueline/scripts/blueprint/ac_assertion_trace_check.test.mjs
git commit -m "feat(at-1b): ac_assertion_trace_check — assertionTrace + textTracesAc string-aware (riusa loadTasks)"
```

---

## Task 2: Fixture di scenario trace + gate `fixture_trace_check.mjs`

**Files:**
- Create: `eval/anti-tamper/tampered-untagged/{seeded-blueprint/01.md, reference-app/{package.json, src/index.mjs, tests/a.test.mjs}}`
- Create: `eval/anti-tamper/tag-in-stringa/{seeded-blueprint/01.md, reference-app/{package.json, src/index.mjs, tests/a.test.mjs}}`
- Create: `eval/anti-tamper/ac-multi-file/{seeded-blueprint/01.md, reference-app/{package.json, src/index.mjs, tests/a.test.mjs, tests/b.test.mjs}}`
- Create: `eval/anti-tamper/covers-scalare/{seeded-blueprint/01.md, reference-app/{package.json, src/index.mjs, tests/a.test.mjs}}`
- Create: `eval/anti-tamper/tag-spurio/{seeded-blueprint/01.md, reference-app/{package.json, src/index.mjs, tests/a.test.mjs}}`
- Create: `eval/anti-tamper/mixed-coverage/{seeded-blueprint/01.md, reference-app/{package.json, src/index.mjs, tests/a.test.mjs}}` *(NB: `tests/b.test.mjs` NON esiste su disco — è il file mancante)*
- Create: `eval/anti-tamper/fixture_trace_check.mjs`
- Modify: `eval/anti-tamper/provision_fixtures.sh`

**Interfaces:**
- Consumes: `validate_blueprint.mjs` (CLI, exit 0/1), `loadTasks` (per la verifica covers).
- Produces: 6 fixture nello stato di scenario atteso (consumati da Task 5).

**Convenzioni comuni a OGNI reference-app** (mirror dei fixture Fase A):
- `package.json`: `{ "name": "anti-tamper-<id>", "version": "1.0.0", "private": true, "type": "module", "description": "<scenario>" }`
- `src/index.mjs`: `// Sorgente minimo del fixture anti-tamper (zero dipendenze).\nexport function add(a, b) {\n  return a + b;\n}\n`
- I test usano `node:test` reali e (salvo dove indicato) **passano**, così l'unico motivo di RED è il trace.

- [ ] **Step 1: Scrivi il gate dei fixture (test che fallisce)**

Crea `eval/anti-tamper/fixture_trace_check.mjs`:

```js
#!/usr/bin/env node
// fixture_trace_check.mjs — gate STANDALONE dei 6 fixture di trace (AT-1 Fase B).
// Asserisce, su FATTI (L-COL-002): (a) ORTOGONALITA' — validate_blueprint PASS su ogni
// seeded-blueprint (i fixture sono strutturalmente validi: il trace e' un concern di
// FILE, non di struttura del blueprint); (b) lo STATO-TAG su disco atteso per scenario,
// via textTracesAc sul file reale (cosi' il keystone Task 5 verifica solo il VERDETTO
// end-to-end). Node ESM, solo built-in. exit 0 = tutti PASS, 1 = un fail, 2 = precondizione.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTasks } from '../../trueline/scripts/blueprint/blueprint_tasks.mjs';
import { textTracesAc } from '../../trueline/scripts/blueprint/ac_assertion_trace_check.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const VALIDATE = resolve(ROOT, 'trueline', 'scripts', 'blueprint', 'validate_blueprint.mjs');
const FIX = __dirname;

const checks = [];
const assert = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const bp = (id) => resolve(FIX, id, 'seeded-blueprint');
const app = (id) => resolve(FIX, id, 'reference-app');
const fileHas = (id, rel, acId) => {
  const p = join(app(id), rel);
  return existsSync(p) && textTracesAc(readFileSync(p, 'utf8'), acId);
};
function validateOk(id) {
  const r = spawnSync(process.execPath, [VALIDATE, bp(id)], { encoding: 'utf8' });
  return r.status === 0;
}

const ALL = ['tampered-untagged', 'tag-in-stringa', 'ac-multi-file', 'covers-scalare', 'tag-spurio', 'mixed-coverage'];

// Precondizione: ogni fixture esiste (blueprint + reference-app).
const missing = ALL.filter((id) => !existsSync(bp(id)) || !existsSync(app(id)));
if (missing.length) {
  console.log(`=== fixture_trace_check: (precondizione mancante) === ${missing.join(', ')}`);
  process.exit(2);
}

// (a) ORTOGONALITA': validate_blueprint PASS su tutti.
for (const id of ALL) assert(`[${id}] validate_blueprint PASS (ortogonalita')`, validateOk(id), bp(id));

// (b) STATO-TAG atteso per scenario (sui file reali su disco).
assert('[tampered-untagged] a.test.mjs esiste ma NON traccia AC-1',
  existsSync(join(app('tampered-untagged'), 'tests/a.test.mjs')) && !fileHas('tampered-untagged', 'tests/a.test.mjs', 'AC-1'));
assert('[tag-in-stringa] a.test.mjs NON traccia AC-1 (covers solo in stringa)',
  !fileHas('tag-in-stringa', 'tests/a.test.mjs', 'AC-1'));
assert('[ac-multi-file] a.test.mjs traccia AC-1, b.test.mjs NO, entrambi su disco',
  fileHas('ac-multi-file', 'tests/a.test.mjs', 'AC-1') && !fileHas('ac-multi-file', 'tests/b.test.mjs', 'AC-1')
  && existsSync(join(app('ac-multi-file'), 'tests/b.test.mjs')));
assert('[covers-scalare] covers e\' SCALARE → loadTasks normalizza a [AC-1]; a.test.mjs traccia AC-1', (() => {
  const tasks = loadTasks(bp('covers-scalare'));
  const tt = tasks[0] && tasks[0].target_tests && tasks[0].target_tests[0];
  return tt && Array.isArray(tt.covers) && tt.covers.includes('AC-1') && fileHas('covers-scalare', 'tests/a.test.mjs', 'AC-1');
})());
assert('[tag-spurio] a.test.mjs traccia AC-1 reale (e contiene anche covers:AC-99 spurio)', (() => {
  const p = join(app('tag-spurio'), 'tests/a.test.mjs');
  const txt = existsSync(p) ? readFileSync(p, 'utf8') : '';
  return textTracesAc(txt, 'AC-1') && /covers:\s*AC-99\b/.test(txt);
})());
assert('[mixed-coverage] a.test.mjs traccia AC-1; b.test.mjs MANCANTE su disco',
  fileHas('mixed-coverage', 'tests/a.test.mjs', 'AC-1') && !existsSync(join(app('mixed-coverage'), 'tests/b.test.mjs')));

const allOk = checks.every((c) => c.ok);
console.log(`=== FIXTURE_TRACE_CHECK: ${allOk ? 'PASS' : 'FAIL'} === (${checks.filter((c) => c.ok).length}/${checks.length})`);
process.exit(allOk ? 0 : 1);
```

- [ ] **Step 2: Esegui il gate per verificare che FALLISCA**

Run: `node eval/anti-tamper/fixture_trace_check.mjs`
Expected: exit 2 — `(precondizione mancante)` (i fixture non esistono ancora).

- [ ] **Step 3: Crea i 6 fixture**

**3a — `tampered-untagged`** (RED atteso: file in-scope SENZA tag).

`eval/anti-tamper/tampered-untagged/seeded-blueprint/01.md`:
````markdown
# 01 — Macrotask `accept` (fixture AT-1 Fase B: tampered-untagged)

Task atomico secondo lo schema di `11-BLUEPRINT-ENGINE` §3 (`L-COL-019`).

```yaml
- id: T-1
  title: "Fixture tampered-untagged: target_test in-scope ma senza tag covers"
  macrotask: "accept"
  depends_on: []

  objective: >
    Il blueprint dichiara covers: [AC-1] ma il file tests/a.test.mjs (in-scope, e
    supererebbe l'esecuzione) NON porta il tag `covers: AC-1` in commento: la
    precondizione di trace deve rendere il controllo 4 RED prima di eseguire.

  definition_of_done:
    - "tests/a.test.mjs esiste e passerebbe l'esecuzione"
    - "il file NON contiene il tag covers: AC-1 in commento"

  acceptance_criteria:
    - id: AC-1
      given: "tests/a.test.mjs e' materializzato sul disco"
      when: "il controllo 4 verifica la tracciabilita' dell'AC"
      then: "il file non dichiara covers: AC-1 in commento, quindi il controllo 4 e' rosso"

  target_tests:
    - file: "tests/a.test.mjs"
      covers: [AC-1]
```
````

`eval/anti-tamper/tampered-untagged/reference-app/tests/a.test.mjs` (**senza** tag):
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/index.mjs';

// Nota: NESSUN tag `covers:` in commento (di proposito) — la trace deve fallire,
// anche se l'asserzione di per se' PASSEREBBE.
test('add somma due numeri', () => {
  assert.equal(add(1, 1), 2);
});
```

**3b — `tag-in-stringa`** (RED atteso: `covers:` solo dentro una stringa).

`eval/anti-tamper/tag-in-stringa/seeded-blueprint/01.md`: identico a 3a ma `title: "Fixture tag-in-stringa: covers solo dentro una stringa"`, `then: "il tag compare solo in una stringa (non in un commento), quindi il controllo 4 e' rosso"`, `target_tests` con `covers: [AC-1]`.

`eval/anti-tamper/tag-in-stringa/reference-app/tests/a.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/index.mjs';

// Il SOLO "covers: AC-1" del file e' dentro una STRINGA, non un commento:
// non deve contare come tracciamento (chiude la gameabilita' tag-in-stringa).
const fakeTag = "// covers: AC-1";
test('add somma due numeri (fakeTag = ' + fakeTag.length + ' char)', () => {
  assert.equal(add(2, 2), 4);
});
```

**3c — `ac-multi-file`** (green atteso: per-AC globale, A taggato, B no, entrambi in-scope).

`eval/anti-tamper/ac-multi-file/seeded-blueprint/01.md`:
````markdown
# 01 — Macrotask `accept` (fixture AT-1 Fase B: ac-multi-file)

```yaml
- id: T-1
  title: "Fixture ac-multi-file: AC-1 coperto da due file in-scope, tag solo in A"
  macrotask: "accept"
  depends_on: []

  objective: >
    AC-1 e' coperto da tests/a.test.mjs e tests/b.test.mjs (entrambi su disco). Solo
    A porta il tag covers: AC-1. Per-AC globale: basta un file coprante taggato → verde.

  definition_of_done:
    - "tests/a.test.mjs e tests/b.test.mjs esistono e passano"
    - "il tag covers: AC-1 e' presente in A (non necessariamente in B)"

  acceptance_criteria:
    - id: AC-1
      given: "A e B (copranti AC-1) sono materializzati sul disco"
      when: "il controllo 4 verifica la tracciabilita' dell'AC"
      then: "almeno un file coprante (A) dichiara covers: AC-1, quindi il controllo 4 e' verde"

  target_tests:
    - file: "tests/a.test.mjs"
      covers: [AC-1]
    - file: "tests/b.test.mjs"
      covers: [AC-1]
```
````

`ac-multi-file/reference-app/tests/a.test.mjs` (**con** tag):
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/index.mjs';

// covers: AC-1
test('A: add somma due numeri', () => {
  assert.equal(add(1, 2), 3);
});
```

`ac-multi-file/reference-app/tests/b.test.mjs` (**senza** tag, passa):
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/index.mjs';

// B copre AC-1 ma NON porta il tag: per-AC globale, basta A. Il file passa l'esecuzione.
test('B: add e\' commutativa', () => {
  assert.equal(add(2, 1), 3);
});
```

**3d — `covers-scalare`** (green atteso: `covers` scalare, file taggato).

`covers-scalare/seeded-blueprint/01.md` — come 3a ma con `covers` **scalare** (non lista):
```yaml
  target_tests:
    - file: "tests/a.test.mjs"
      covers: AC-1
```
(title: "Fixture covers-scalare: covers come scalare, file taggato"; `then: "il file dichiara covers: AC-1 in commento e covers e' scalare-normalizzato, quindi il controllo 4 e' verde"`.)

`covers-scalare/reference-app/tests/a.test.mjs` (**con** tag):
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/index.mjs';

// covers: AC-1
test('add somma due numeri', () => {
  assert.equal(add(3, 4), 7);
});
```

**3e — `tag-spurio`** (green atteso: tag reale AC-1 + tag spurio AC-99 ignorato).

`tag-spurio/seeded-blueprint/01.md` — come 3a (covers: [AC-1]), title "Fixture tag-spurio: tag reale + tag covers AC-99 non dichiarato", `then: "il file dichiara covers: AC-1 (reale) e covers: AC-99 (spurio, ignorato), quindi il controllo 4 e' verde"`.

`tag-spurio/reference-app/tests/a.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/index.mjs';

// covers: AC-1
// covers: AC-99   <- spurio: AC-99 non e' un AC dichiarato; va ignorato senza errori
test('add somma due numeri', () => {
  assert.equal(add(5, 5), 10);
});
```

**3f — `mixed-coverage`** (green atteso: A in-scope+taggato, B coprante AC-1 ma MANCANTE).

`mixed-coverage/seeded-blueprint/01.md`:
````markdown
# 01 — Macrotask `accept` (fixture AT-1 Fase B: mixed-coverage)

```yaml
- id: T-1
  title: "Fixture mixed-coverage: AC-1 coperto da A (presente, taggato) + B (mancante)"
  macrotask: "accept"
  depends_on: []

  objective: >
    AC-1 e' coperto da tests/a.test.mjs (presente, taggato) e tests/b.test.mjs
    (NON materializzato — task non costruito, saltato). Lo skip di B non maschera:
    A traccia AC-1 → verde. Se A perde il tag → rosso (provato dal keystone).

  definition_of_done:
    - "tests/a.test.mjs esiste, passa, e porta il tag covers: AC-1"
    - "tests/b.test.mjs NON esiste sul disco (task non costruito)"

  acceptance_criteria:
    - id: AC-1
      given: "A (coprante AC-1) e' su disco; B (coprante AC-1) e' mancante"
      when: "il controllo 4 verifica la tracciabilita' dell'AC"
      then: "il file in-scope A dichiara covers: AC-1, quindi il controllo 4 e' verde (lo skip di B non maschera)"

  target_tests:
    - file: "tests/a.test.mjs"
      covers: [AC-1]
    - file: "tests/b.test.mjs"
      covers: [AC-1]
```
````

`mixed-coverage/reference-app/tests/a.test.mjs` (**con** tag; NON creare `tests/b.test.mjs`):
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from '../src/index.mjs';

// covers: AC-1
test('add somma due numeri', () => {
  assert.equal(add(6, 1), 7);
});
```

Per **ogni** fixture, crea anche `reference-app/package.json` e `reference-app/src/index.mjs` come da "Convenzioni comuni" sopra (`name` = `anti-tamper-<id>`).

- [ ] **Step 4: Aggiorna `provision_fixtures.sh`**

In `eval/anti-tamper/provision_fixtures.sh`, sostituisci la riga della lista fixture:
```bash
FIXTURES="faithful failing empty partial"
```
con:
```bash
FIXTURES="faithful failing empty partial tampered-untagged tag-in-stringa ac-multi-file covers-scalare tag-spurio mixed-coverage"
```
Aggiorna anche il messaggio finale `echo "Fixtures AT-1 Fase A finalizzati ..."` in `echo "Fixtures AT-1 Fase A+B finalizzati (inner .git, zero node_modules)."`. *(Il `git add package.json src tests` è già robusto: aggiunge solo i path esistenti; `mixed-coverage` committa solo `tests/a.test.mjs`.)*

- [ ] **Step 5: Esegui il gate per verificare che PASSI**

> **Nota:** questo gate non richiede `.git` (legge solo file + lancia `validate_blueprint`); il `.git` interno è provisionato dall'orchestratore (Task 6) per il keystone.

Run: `node eval/anti-tamper/fixture_trace_check.mjs`
Expected: `=== FIXTURE_TRACE_CHECK: PASS ===` (12/12: 6 validate_blueprint + 6 stato-tag), exit 0.

- [ ] **Step 6: Commit (ORCHESTRATORE)**

```bash
git add eval/anti-tamper/tampered-untagged eval/anti-tamper/tag-in-stringa eval/anti-tamper/ac-multi-file eval/anti-tamper/covers-scalare eval/anti-tamper/tag-spurio eval/anti-tamper/mixed-coverage eval/anti-tamper/fixture_trace_check.mjs eval/anti-tamper/provision_fixtures.sh
git commit -m "test(at-1b): 6 fixture di scenario trace + fixture_trace_check (ortogonalita validate_blueprint)"
```
*(Le `reference-app/` sono gitignorate dal repo esterno — verrà tracciato ciò che `.gitignore` permette; i `seeded-blueprint/` sono tracked. Verifica con `git status` quali path entrano: i seeded-blueprint + i due script. Se le reference-app sono ignorate come per Fase A, restano su disco non tracciate, e l'inner-`.git` è provisionato in Task 6.)*

---

## Task 3: Convenzione `covers:` documentata

**Files:**
- Modify: `trueline/references/build-discipline.md` (§2 Momento 2)
- Modify: `trueline/references/blueprint/atomic-task-schema.md`

**Interfaces:** Nessuna API. Gate = presenza testuale + `SKILL.md` corpo invariato.

- [ ] **Step 1: Scrivi il test di presenza (che fallisce)**

Crea (temporaneo, eseguibile) il comando di verifica — sarà il gate del task:
```bash
grep -q "covers: <AC-id>" trueline/references/build-discipline.md \
  && grep -q "covers:" trueline/references/blueprint/atomic-task-schema.md \
  && grep -q "ac_assertion_trace_check" trueline/references/build-discipline.md \
  && echo "DOC-OK" || echo "DOC-MISSING"
```
Run ora: Expected `DOC-MISSING`.

- [ ] **Step 2: Aggiorna `build-discipline.md` §2 Momento 2**

Sostituisci il paragrafo finale del Momento 2 (righe 82–84, il forward-ref *"La meccanizzazione piena … fase moat successiva … qui il momento 2 è ristretto …"*) con:

```markdown
**Convenzione di provenienza (meccanizzata, AT-1 Fase B).** Ogni blocco del
`target_test` che esercita un AC porta un tag `covers: <AC-id>` **in un commento**
(`// covers: AC-1`, anche di coda: `expect(...); // covers: AC-1`). In BUILD con
`--blueprint`, il controllo 4 esige che ogni AC **valutato** sia tracciato da ≥1 suo
`target_test` in-scope così taggato: un AC non tracciato rende il controllo 4 **rosso
prima di eseguire** (oracolo `scripts/blueprint/ac_assertion_trace_check.mjs`, sibling
di `validate_blueprint`). È **per-AC globale** (basta un file coprante taggato) e
**ancorato all'id** (`AC-1` ≠ `AC-10`); un tag dentro una **stringa** non conta
(string-aware). La presenza-del-tag è un **floor deterministico** (`L-COL-006`): prova
*che* il file dichiara quale AC esercita, **non** che l'asserzione sia semanticamente
fedele (quello resta advisory). Lo schema del task e `validate_blueprint` **non
cambiano**: il tag vive nel file di test, non nel blueprint.
```

- [ ] **Step 3: Aggiorna `atomic-task-schema.md`**

Dopo il blocco "DoD vs acceptance_criteria" (riga 63–66), aggiungi:

```markdown
## Provenienza del target_test — tag `covers:` (anti-tamper, BUILD `--blueprint`)

Nel **file** del `target_test`, ogni blocco che esercita un AC porta `covers: <AC-id>`
**in un commento** (`// covers: AC-1`). È la controparte *eseguibile* del campo
`covers` del blueprint: in BUILD col controllo 4 attivo (`--blueprint`), un AC valutato
non tracciato da alcun suo target_test in-scope rende il controllo 4 **rosso prima di
eseguire** (`scripts/blueprint/ac_assertion_trace_check.mjs`). Per-AC globale, ancorato
all'id, string-aware. **Questo schema e `validate_blueprint` restano invariati**: il
tag è una convenzione del file di test, non un campo del task.
```

- [ ] **Step 4: Verifica presenza + `SKILL.md` invariato**

Run:
```bash
grep -q "covers: <AC-id>" trueline/references/build-discipline.md \
  && grep -q "ac_assertion_trace_check" trueline/references/build-discipline.md \
  && grep -q "covers:" trueline/references/blueprint/atomic-task-schema.md \
  && echo "DOC-OK"
git diff --quiet -- trueline/SKILL.md && echo "SKILL-UNCHANGED"
```
Expected: `DOC-OK` e `SKILL-UNCHANGED` (corpo `SKILL.md` < 500 righe, intatto, `L-COL-014`).

- [ ] **Step 5: Commit (ORCHESTRATORE)**

```bash
git add trueline/references/build-discipline.md trueline/references/blueprint/atomic-task-schema.md
git commit -m "docs(at-1b): convenzione tag covers: in commento (provenienza del target_test)"
```

---

## Task 4: Wiring in `checkpoint.mjs::control4Conformance`

**Files:**
- Modify: `trueline/scripts/checkpoint/checkpoint.mjs` (import ~r.45; precondizione trace tra r.451 e r.452)
- Test: `trueline/scripts/checkpoint/checkpoint.trace.test.mjs`

**Interfaces:**
- Consumes: `assertionTrace(tasks, appDir, inScope)` (Task 1), `control4Conformance(referenceApp, opts)` (esistente).
- Produces: il ramo AC-acceptance ritorna `{ id:4, name:'conformance', status:'red', green:false, detail }` quando `trace.ok===false`, **prima** del loop d'esecuzione.

- [ ] **Step 1: Scrivi il test del wiring (che fallisce)**

Crea `trueline/scripts/checkpoint/checkpoint.trace.test.mjs`:
```js
// checkpoint.trace.test.mjs — wiring della precondizione trace nel controllo 4 (Fase B).
// Niente DB/semgrep: chiama control4Conformance direttamente con un manifest fittizio
// (test_runner.run_file) e fixture su disco. Prova: (1) BIT-invarianza — senza
// blueprintDir il ramo legacy resta degraded (immutato); (2) con --blueprint su un
// fixture tampered-untagged → RED con detail di trace ("non tracciabile"), PRIMA
// dell'esecuzione (il file passerebbe). Solo built-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { control4Conformance } from './checkpoint.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const FIX = resolve(ROOT, 'eval', 'anti-tamper');
const MANIFEST = { test_runner: { run_file: 'node --test {file}' } };

test('BIT-invarianza: senza blueprintDir il controllo 4 resta legacy (degraded)', () => {
  const app = resolve(FIX, 'faithful', 'reference-app');
  const r = control4Conformance(app, { mode: 'build', manifest: MANIFEST }); // niente blueprintDir
  assert.equal(r.id, 4);
  assert.equal(r.green, false);
  assert.equal(r.status, 'degraded'); // ramo legacy invariato
});

test('trace RED prima dell\'esecuzione: tampered-untagged → red con detail di trace', () => {
  const app = resolve(FIX, 'tampered-untagged', 'reference-app');
  const bp = resolve(FIX, 'tampered-untagged', 'seeded-blueprint');
  const r = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: MANIFEST });
  assert.equal(r.green, false);
  assert.equal(r.status, 'red');
  assert.match(r.detail, /non tracciabile|oracolo non valido/i);
  // Prova che NON e' un fallimento d'esecuzione (il file passerebbe): il detail e' di trace.
  assert.doesNotMatch(r.detail, /test rosso|vacuo/i);
});

test('trace OK → il controllo 4 procede ed e\' verde (faithful, taggato)', () => {
  const app = resolve(FIX, 'faithful', 'reference-app');
  const bp = resolve(FIX, 'faithful', 'seeded-blueprint');
  const r = control4Conformance(app, { mode: 'build', blueprintDir: bp, manifest: MANIFEST });
  assert.equal(r.green, true);
  assert.equal(r.status, 'green');
});
```

- [ ] **Step 2: Esegui il test per verificare che FALLISCA**

Run: `node --test trueline/scripts/checkpoint/checkpoint.trace.test.mjs`
Expected: FAIL sul 2° test — senza il wiring, `tampered-untagged` con `--blueprint` **esegue** il test (che passa) → `green:true` invece di RED-trace.

- [ ] **Step 3: Implementa il wiring**

In `trueline/scripts/checkpoint/checkpoint.mjs`, **dopo** la riga 45 (`import { runTargetFile } from './run_file.mjs';`) aggiungi:
```js
import { assertionTrace } from '../blueprint/ac_assertion_trace_check.mjs';
```

Poi, nel ramo AC-acceptance di `control4Conformance`, **tra** il `return` di in-scope-vuoto (r.449–451) e `const fails = [];` (r.452), inserisci:
```js
    // <<< AT-1 Fase B — precondizione di TRACE (PRIMA di eseguire) >>>
    // Ogni AC valutato deve tracciare (tag covers: in commento) a un suo target_test
    // in-scope. Un AC valutato non tracciato → oracolo d'accettazione non valido →
    // controllo 4 RED PRIMA dell'esecuzione (anti-tamper della provenienza, L-COL-032/B).
    const trace = assertionTrace(tasks, referenceApp, inScope);
    if (!trace.ok) {
      return {
        id: 4, name: 'conformance', status: 'red', green: false,
        detail: `target_test non tracciabile all'AC — oracolo non valido: ${trace.detail}`,
      };
    }
```

- [ ] **Step 4: Esegui il test per verificare che PASSI**

Run: `node --test trueline/scripts/checkpoint/checkpoint.trace.test.mjs`
Expected: PASS — 3/3.

- [ ] **Step 5: BIT-invarianza locale (smoke)**

Run: `node --test trueline/scripts/blueprint/ac_assertion_trace_check.test.mjs trueline/scripts/checkpoint/checkpoint.trace.test.mjs`
Expected: PASS. *(La no-regressione integrale `m5` 56/56 è il passo SERIALE dell'orchestratore, Task 6 — qui basta provare che il ramo legacy resta degraded e il path manifest non è esercitato senza il flag.)*

- [ ] **Step 6: Commit (ORCHESTRATORE)**

```bash
git add trueline/scripts/checkpoint/checkpoint.mjs trueline/scripts/checkpoint/checkpoint.trace.test.mjs
git commit -m "feat(at-1b): control4 precondizione trace (RED prima di eseguire) — additivo, BIT-invariante"
```

---

## Task 5: Estensione del keystone `anti_tamper_check.mjs` (sotto-test di trace)

**Files:**
- Modify: `eval/harness/anti_tamper_check.mjs`

**Interfaces:**
- Consumes: il binario spedito `run_checkpoint.mjs --in-place <copia> --blueprint <bp> --mode build --no-osv` (driver esistente `driveCheckpointStable`), `copyFixture` (esistente, deposita `supabase/config.toml` per attivare il ramo AC).
- Produces: i sotto-test (7)…(14) sul fixture set di trace + falsificabilità su copia + 0-contaminazione estesa ai nuovi fixture. La Fase A (1)…(6) resta intatta.

> **Decisione (brief §10):** si **estende** il keystone (un solo gate Fase A+B), non si crea un sibling — meno duplicazione di provisioning/igiene.

- [ ] **Step 1: Aggiungi il fixture set di trace + estendi precondizione/igiene**

In `anti_tamper_check.mjs`, dopo la const `FIXTURES` (r.108–125) aggiungi:
```js
// Fixture di scenario TRACE (AT-1 Fase B). Stessa anatomia: reference-app inner-repo
// (provisionata dall'orchestratore) + seeded-blueprint. Il driver e l'igiene li
// trattano come i 4 Fase A.
const TRACE_FIXTURES = {
  'tampered-untagged': { referenceApp: resolve(FIX_ROOT, 'tampered-untagged', 'reference-app'), blueprint: resolve(FIX_ROOT, 'tampered-untagged', 'seeded-blueprint') },
  'tag-in-stringa':    { referenceApp: resolve(FIX_ROOT, 'tag-in-stringa', 'reference-app'),    blueprint: resolve(FIX_ROOT, 'tag-in-stringa', 'seeded-blueprint') },
  'ac-multi-file':     { referenceApp: resolve(FIX_ROOT, 'ac-multi-file', 'reference-app'),     blueprint: resolve(FIX_ROOT, 'ac-multi-file', 'seeded-blueprint') },
  'covers-scalare':    { referenceApp: resolve(FIX_ROOT, 'covers-scalare', 'reference-app'),    blueprint: resolve(FIX_ROOT, 'covers-scalare', 'seeded-blueprint') },
  'tag-spurio':        { referenceApp: resolve(FIX_ROOT, 'tag-spurio', 'reference-app'),        blueprint: resolve(FIX_ROOT, 'tag-spurio', 'seeded-blueprint') },
  'mixed-coverage':    { referenceApp: resolve(FIX_ROOT, 'mixed-coverage', 'reference-app'),    blueprint: resolve(FIX_ROOT, 'mixed-coverage', 'seeded-blueprint') },
};
// Unione per precondizione + igiene (Fase A + Fase B condividono .git/provisioning).
const ALL_FIXTURES = { ...FIXTURES, ...TRACE_FIXTURES };
```

In `checkPreconditions()` (r.262) e in `main()` dove si crea `snapshots` (r.488) e in `assertHygiene()` (r.429), sostituisci l'iterazione `Object.entries(FIXTURES)` con `Object.entries(ALL_FIXTURES)`. *(Le 3 occorrenze: precondizione `.git`/seeded-blueprint, snapshot 0-contam, e la verifica HEAD interno per-fixture.)*

- [ ] **Step 2: Aggiungi un helper per editare un tag su una COPIA (falsificabilità)**

Dopo `copyFixture` (r.204) aggiungi:
```js
// Rimuove/aggiunge il tag `covers: <acId>` in un file della COPIA (mai nell'originale):
// serve alle prove di falsificabilita' (untag → RED; tag → verde). Idempotente.
function retagInCopy(copyDir, relFile, { removeAc = null, addAc = null } = {}) {
  const p = join(copyDir, relFile);
  if (!existsSync(p)) return false;
  let txt = readFileSync(p, 'utf8');
  if (removeAc) {
    // Rimuove le righe-commento che taggano <acId> (i fixture usano righe dedicate;
    // gli AC-id sono alfanumerici+trattino → nessun metacarattere da escapare).
    const re = new RegExp('covers:\\s*' + removeAc + '\\b');
    txt = txt.split('\n').filter((l) => !(/^\s*(\/\/|#|--)/.test(l) && re.test(l))).join('\n');
  }
  if (addAc) txt = `// covers: ${addAc}\n${txt}`;
  writeFileSync(p, txt);
  return true;
}
```

- [ ] **Step 3: Aggiungi i sotto-test di trace (7)…(14)**

Dopo `subTestFlagNotDisk()` (r.420) aggiungi:
```js
// ===========================================================================
// (7) tampered-untagged — controls[3] RED (trace), detail "non tracciabile".
//     Falsificabilita': aggiungi il tag su una copia → verde (eseguito).
// ===========================================================================
function subTestTamperedUntagged() {
  console.log('');
  console.log('(7) tampered-untagged — target_test in-scope SENZA tag covers → controls[3] RED (trace):');
  const fx = TRACE_FIXTURES['tampered-untagged'];
  const copy = copyFixture('tampered-untagged', fx.referenceApp);
  try {
    const d = driveCheckpointStable(copy.dir, fx.blueprint, { requireGreen: false });
    if (!d.c4) { assert('(7) JSON ben formato', false, `exit=${d.status}`); return; }
    assert('(7) controls[3].green === false (AC non tracciato → RED)', d.c4.green === false,
      `green=${d.c4.green} status=${d.c4.status}`);
    assert('(7) detail menziona "non tracciabile" (trace, non esecuzione)',
      /non tracciabile|oracolo non valido/i.test(String(d.c4.detail || '')), `detail="${d.c4.detail}"`);
    // Precondizione PRIMA dell'esecuzione: il file PASSEREBBE; il detail NON e' d'esecuzione.
    assert('(7) il RED e\' di TRACE, non d\'esecuzione (no "test rosso"/"vacuo")',
      !/test rosso|vacuo/i.test(String(d.c4.detail || '')), `detail="${d.c4.detail}"`);
  } finally { copy.cleanup(); }
  // Falsificabilita': aggiungi il tag su una copia separata → verde.
  const copy2 = copyFixture('tampered-untagged-fix', fx.referenceApp);
  try {
    retagInCopy(copy2.dir, 'tests/a.test.mjs', { addAc: 'AC-1' });
    const d2 = driveCheckpointStable(copy2.dir, fx.blueprint, { requireGreen: true });
    assert('(7-falsif) aggiunto il tag covers: AC-1 → controls[3] verde (eseguito e passa)',
      d2.c4 && d2.c4.green === true, d2.c4 ? `status=${d2.c4.status}` : 'no c4');
  } finally { copy2.cleanup(); }
}

// ===========================================================================
// (8) tag-in-stringa — covers solo dentro una stringa → controls[3] RED (trace).
// ===========================================================================
function subTestTagInStringa() {
  console.log('');
  console.log('(8) tag-in-stringa — "covers" solo in una stringa (non commento) → controls[3] RED:');
  const fx = TRACE_FIXTURES['tag-in-stringa'];
  const copy = copyFixture('tag-in-stringa', fx.referenceApp);
  try {
    const d = driveCheckpointStable(copy.dir, fx.blueprint, { requireGreen: false });
    if (!d.c4) { assert('(8) JSON ben formato', false, `exit=${d.status}`); return; }
    assert('(8) controls[3].green === false (tag in stringa non conta → RED)', d.c4.green === false,
      `green=${d.c4.green} status=${d.c4.status}`);
    assert('(8) detail di trace ("non tracciabile")',
      /non tracciabile|oracolo non valido/i.test(String(d.c4.detail || '')), `detail="${d.c4.detail}"`);
  } finally { copy.cleanup(); }
}

// ===========================================================================
// (9) ac-multi-file — AC-1 coperto da A (taggato) + B (no), entrambi in-scope →
//     verde (per-AC globale). Falsificabilita': untag A → RED.
// ===========================================================================
function subTestAcMultiFile() {
  console.log('');
  console.log('(9) ac-multi-file — A taggato + B no (entrambi in-scope) → verde (per-AC globale):');
  const fx = TRACE_FIXTURES['ac-multi-file'];
  const copy = copyFixture('ac-multi-file', fx.referenceApp);
  try {
    const d = driveCheckpointStable(copy.dir, fx.blueprint, { requireGreen: true });
    assert('(9) controls[3].green === true (basta A taggato)', d.c4 && d.c4.green === true,
      d.c4 ? `status=${d.c4.status} detail="${d.c4.detail}"` : 'no c4');
  } finally { copy.cleanup(); }
  // Falsificabilita': togli il tag da A (B gia' senza) → nessun file coprante taggato → RED.
  const copy2 = copyFixture('ac-multi-file-untag', fx.referenceApp);
  try {
    retagInCopy(copy2.dir, 'tests/a.test.mjs', { removeAc: 'AC-1' });
    const d2 = driveCheckpointStable(copy2.dir, fx.blueprint, { requireGreen: false });
    assert('(9-falsif) tolto il tag da A → controls[3] RED (trace)',
      d2.c4 && d2.c4.green === false && /non tracciabile/i.test(String(d2.c4.detail || '')),
      d2.c4 ? `status=${d2.c4.status} detail="${d2.c4.detail}"` : 'no c4');
  } finally { copy2.cleanup(); }
}

// ===========================================================================
// (10) covers-scalare — covers scalare, file taggato → verde.
// ===========================================================================
function subTestCoversScalare() {
  console.log('');
  console.log('(10) covers-scalare — covers come scalare (non lista), file taggato → verde:');
  const fx = TRACE_FIXTURES['covers-scalare'];
  const copy = copyFixture('covers-scalare', fx.referenceApp);
  try {
    const d = driveCheckpointStable(copy.dir, fx.blueprint, { requireGreen: true });
    assert('(10) controls[3].green === true (covers scalare normalizzato + tag presente)',
      d.c4 && d.c4.green === true, d.c4 ? `status=${d.c4.status}` : 'no c4');
  } finally { copy.cleanup(); }
}

// ===========================================================================
// (11) tag-spurio — tag reale AC-1 + tag spurio AC-99 → verde (spurio ignorato).
// ===========================================================================
function subTestTagSpurio() {
  console.log('');
  console.log('(11) tag-spurio — covers: AC-1 (reale) + covers: AC-99 (spurio) → verde:');
  const fx = TRACE_FIXTURES['tag-spurio'];
  const copy = copyFixture('tag-spurio', fx.referenceApp);
  try {
    const d = driveCheckpointStable(copy.dir, fx.blueprint, { requireGreen: true });
    assert('(11) controls[3].green === true (AC-1 traccia; AC-99 ignorato senza errori)',
      d.c4 && d.c4.green === true, d.c4 ? `status=${d.c4.status} detail="${d.c4.detail}"` : 'no c4');
  } finally { copy.cleanup(); }
}

// ===========================================================================
// (12) mixed-coverage — A (presente, taggato) + B (mancante) → verde. Untag A → RED.
// ===========================================================================
function subTestMixedCoverage() {
  console.log('');
  console.log('(12) mixed-coverage — A presente+taggato, B mancante (saltato) → verde:');
  const fx = TRACE_FIXTURES['mixed-coverage'];
  const copy = copyFixture('mixed-coverage', fx.referenceApp);
  try {
    const d = driveCheckpointStable(copy.dir, fx.blueprint, { requireGreen: true });
    assert('(12) controls[3].green === true (A traccia; skip di B non maschera)',
      d.c4 && d.c4.green === true, d.c4 ? `status=${d.c4.status} detail="${d.c4.detail}"` : 'no c4');
  } finally { copy.cleanup(); }
  // Falsificabilita': untag A (B comunque mancante) → AC-1 non tracciato → RED.
  const copy2 = copyFixture('mixed-coverage-untag', fx.referenceApp);
  try {
    retagInCopy(copy2.dir, 'tests/a.test.mjs', { removeAc: 'AC-1' });
    const d2 = driveCheckpointStable(copy2.dir, fx.blueprint, { requireGreen: false });
    assert('(12-falsif) tolto il tag da A → controls[3] RED (lo skip di B non maschera)',
      d2.c4 && d2.c4.green === false && /non tracciabile/i.test(String(d2.c4.detail || '')),
      d2.c4 ? `status=${d2.c4.status} detail="${d2.c4.detail}"` : 'no c4');
  } finally { copy2.cleanup(); }
}

// ===========================================================================
// (13) ortogonalita' — validate_blueprint PASS su ogni fixture trace (struttura
//      valida) mentre il trace li DISTINGUE (verde/rosso sopra).
// ===========================================================================
function subTestOrthogonality() {
  console.log('');
  console.log('(13) ortogonalita\' — validate_blueprint PASS su tutti i fixture trace:');
  const VALIDATE = resolve(ROOT, 'trueline', 'scripts', 'blueprint', 'validate_blueprint.mjs');
  for (const [id, fx] of Object.entries(TRACE_FIXTURES)) {
    const r = nodeRun(VALIDATE, [fx.blueprint]);
    assert(`(13) [${id}] validate_blueprint exit 0 (struttura valida)`, r.status === 0,
      `exit=${r.status}`);
  }
}
```

- [ ] **Step 4: Cabla i nuovi sotto-test in `main()` e aggiorna il banner**

In `main()`, dopo `subTestFlagNotDisk();` (r.501) aggiungi:
```js
  subTestTamperedUntagged();
  subTestTagInStringa();
  subTestAcMultiFile();
  subTestCoversScalare();
  subTestTagSpurio();
  subTestMixedCoverage();
  subTestOrthogonality();
```
Aggiorna le righe di banner (r.456–461) aggiungendo, dopo la (6):
```js
  console.log('   (7)..(12) trace      — tampered-untagged/tag-in-stringa/ac-multi-file/covers-scalare/tag-spurio/mixed-coverage');
  console.log('   (13) ortogonalita    — validate_blueprint PASS su tutti i fixture trace');
```
E nel titolo (`GATE ANTI-TAMPER (AT-1 Fase A, ...)`, r.454) cambia in `GATE ANTI-TAMPER (AT-1 Fase A+B — esecuzione + trace, spec §7)`.

- [ ] **Step 5: Provisiona i `.git` dei nuovi fixture ed esegui il keystone (ORCHESTRATORE)**

```bash
bash eval/anti-tamper/provision_fixtures.sh        # crea inner .git per i 6 nuovi fixture
node eval/harness/anti_tamper_check.mjs
```
Expected: `=== GATE ANTI-TAMPER RESULT: PASS ===` — i 25 check Fase A **invariati** + i nuovi check trace ((7)…(13) + falsificabilità) + 0-contaminazione estesa (HEAD interno di tutti i 10 fixture invariato, HEAD esterno invariato, nessun residuo `.tmp-at`). exit 0.

- [ ] **Step 6: Falsificabilità manuale del keystone (prova che il gate morde)**

Rompi temporaneamente la precondizione trace (commenta l'`if (!trace.ok)` in `checkpoint.mjs`), esegui `node eval/harness/anti_tamper_check.mjs` → i sotto-test (7)/(8) **FALLISCONO** (verde dove ci si aspetta RED). Ripristina → PASS. *(Step di prova; nessun commit dello stato rotto.)*

- [ ] **Step 7: Commit (ORCHESTRATORE)**

```bash
git add eval/harness/anti_tamper_check.mjs
git commit -m "test(at-1b): keystone anti_tamper_check esteso con sotto-test di trace (7..13) + falsificabilita"
```

---

## Task 6: Integrazione finale (ORCHESTRATORE — SERIALE, non un agente)

**Files:**
- Modify: `00-INDEX.md` (§4, emendamento `L-COL-032`)
- Modify: `SESSION-STATE.md`

Questo è il passo d'orchestratore (`L-COL-024`): provisioning, gate seriale integrale, emendamento ledger, merge human-gated.

- [ ] **Step 1: Provisioning `.git` dei nuovi fixture**

```bash
bash eval/anti-tamper/provision_fixtures.sh
```
Expected: i 6 nuovi fixture stampano `inner .git creato`; i 4 Fase A `gia' presente`.

- [ ] **Step 2: Gate SERIALE integrale (la verità, `L-COL-002`)**

Esegui, **uno alla volta** (mai concorrenti — lezione BD-1), e registra l'esito:
```bash
node --test trueline/scripts/blueprint/ac_assertion_trace_check.test.mjs   # checker unit
node --test trueline/scripts/checkpoint/checkpoint.trace.test.mjs          # wiring unit
node eval/anti-tamper/fixture_trace_check.mjs                              # fixture 12/12
node eval/harness/anti_tamper_check.mjs                                    # KEYSTONE A+B (PASS)
node eval/harness/build_discipline_check.mjs                              # 21/21 (no-regressione)
node eval/harness/m5_gate_check.mjs                                       # 56/56 (DB live + semgrep)
node eval/harness/ecosystem_conformance.mjs supabase-jsts                 # = m5 56/56
node eval/harness/ecosystem_conformance.mjs supabase-py                   # 40/40
node eval/harness/ecosystem_conformance.mjs postgres-jsts                 # 36/36
node eval/harness/ecosystem_conformance.mjs postgres-py                   # 40/40
node eval/harness/ecosystem_conformance.mjs firebase-jsts                 # 26/26
node trueline/scripts/packaging/package_skill.mjs --lint                  # lint VERDE 5 pack
```
Expected: tutti verdi/PASS; il keystone Fase A+B PASS; **`m5` 56/56 invariato** (prova della BIT-invarianza end-to-end). Se un harness dà un transitorio rosso ambientale, **`rm -rf eval/.tmp-*`** e rie­segui **in isolamento** (la verità è la riesecuzione seriale).

- [ ] **Step 3: Emenda `L-COL-032` in `00-INDEX.md` §4**

Aggiungi alla riga `L-COL-032` (o come nota di riconciliazione AT-1 Fase B subito sotto la nota Fase A, riga ~122) il braccio trace-check. Testo della nota:
```markdown
> **Nota di riconciliazione (AT-1 Fase B, 26 giu 2026):** `L-COL-032` **completato** col
> braccio **trace-check** (anti-tamper della provenienza). In BUILD `--blueprint`, oltre a
> *eseguire* i `target_test` per-AC (Fase A), il controllo 4 esige ora che **ogni AC
> valutato sia tracciato** da ≥1 suo target_test in-scope tramite un tag `covers: <AC-id>`
> in un **commento**; un AC valutato non tracciato → controllo 4 **RED PRIMA di eseguire**
> (oracolo `ac_assertion_trace_check.mjs`, sibling di `validate_blueprint`, **riusa
> `loadTasks`** — niente 3ª replica del parser). Per-AC globale, ancorato all'id,
> **string-aware** (un `//` in una stringa non conta → chiusa la gameabilità
> tag-in-stringa). La presenza-tag è **floor deterministico** (`L-COL-006`): NON prova di
> fedeltà semantica (advisory). **BIT-invariante** (solo nel ramo `mode==='build' &&
> --blueprint && run_file`). Gate (riesecuzione **SERIALE**, `L-COL-002`):
> `anti_tamper_check` Fase A+B PASS (Fase A 25 invariati + sotto-test trace (7)…(13) +
> falsificabilità su copia: untag → RED → ritag → verde) + `fixture_trace_check` 12/12 +
> no-regressione integrale (`build_discipline_check` 21/21, `m5` **56/56**,
> `ecosystem_conformance` 5 pack, `package_skill` lint VERDE) + **0 contaminazione**.
> *Aggiornato anche `L-COL-032`: il braccio trace-check NON è più "plan successivo, non
> locked" — è **locked**.* Branch `feat/at-1b-trace-check`; **merge su `main`
> human-gated** (`L-COL-024`). → spec/plan AT-1 §5.3/§5.5/§7.
```
Inoltre, nella riga `L-COL-032` stessa, sostituisci la frase finale *"La **Fase B** … è plan successivo, **NON ancora locked**."* con *"La **Fase B** (trace-check AC↔tag `covers:`) è **locked** (vedi nota di riconciliazione AT-1 Fase B)."*

- [ ] **Step 4: Commit ledger + docs**

```bash
git add 00-INDEX.md
git commit -m "docs(ledger): L-COL-032 completato col braccio trace-check (AT-1 Fase B locked)"
```

- [ ] **Step 5: Aggiorna `SESSION-STATE.md` (chiusura sessione)**

Aggiorna l'header "Ultima sessione", §1bis/§3/§6 con l'esito AT-1 Fase B (costruita, gateata seriale, branch `feat/at-1b-trace-check`, `main` intatto fino al merge). Commit:
```bash
git add SESSION-STATE.md
git commit -m "docs(state): AT-1 Fase B costruita + gateata (trace-check); pronta al merge human-gated"
```

- [ ] **Step 6: Merge human-gated su `main` (`L-COL-024` — attendi "vai")**

Solo su via libera umana, dopo il ri-verde del gate seriale **su `main`** post-merge:
```bash
git checkout main
git merge --no-ff feat/at-1b-trace-check -m "merge(at-1b): trace-check AC<->tag covers (L-COL-032 completato)"
bash eval/anti-tamper/provision_fixtures.sh
node eval/harness/anti_tamper_check.mjs        # ri-verde su main
node eval/harness/m5_gate_check.mjs            # 56/56 su main
git push origin main
```
Poi riallinea l'install globale (copia-sopra da `dist/trueline.staging/.`, `pgsql-ast-parser` preservato) — passo post-merge come negli SP.

---

## Esecuzione (Dynamic Workflow) — mappa ondate/DAG

| Onda | Task | `dipende_da` | Builder | Verifier (k) |
|---|---|---|---|---|
| **W1** | T1 checker, T2 fixture, T3 doc | — (indipendenti) | T1 **Opus**, T2/T3 **Sonnet** | Opus (T1 **k=2**) |
| **W2** | T4 wiring | T1 | **Opus** | Opus |
| **W3** | T5 keystone | T1, T2, T4 | **Opus** | Opus **k=2** |
| **W4** | T6 integrazione | T5 (+ tutti) | — (orchestratore) | — |

- **Model policy** (`DYNAMIC-WORKFLOWS` §5): verifier **sempre Opus**; **niente Haiku**. Builder Opus per la logica delicata (checker string-aware, wiring BIT-invariante, keystone); Sonnet per fixture/doc (meccanici).
- **Pipeline per task:** build → verify(×k) vs il gate del task → fix-loop solo su rosso → l'orchestratore committa **solo sul verde**.
- **Git solo nell'orchestratore** (`L-COL-024`): gli agenti scrivono file; provisioning `.git`, commit, gate seriale, emendamento ledger e merge sono passi d'orchestratore.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-26-at-1b-trace-check.md`.**

Per questo progetto l'esecuzione è via **Dynamic Workflow** (`L-COL-027`): authoring del workflow di build (mirror di Fase A `2026-06-25-at-1a-build.js`) che istanzia le ondate W1→W3, poi T6 (integrazione SERIALE) eseguita dall'orchestratore. Il merge su `main` resta **human-gated** (`L-COL-024`).

---

## Self-Review

**1. Spec coverage** (brief §1–§9 / spec §5.3/§5.4/§5.5/§7):
- §1 obiettivo (anti-tamper provenienza, RED prima di eseguire) → Task 4 wiring + Task 1 checker ✓
- §2 seam esatto (tra r.451 e r.452) → Task 4 Step 3 ✓
- §3 riuso `loadTasks` (no 3ª replica) → Task 1 import ✓
- §4 deliverable 1–5 → Task 1 (checker), 4 (wiring), 3 (doc), 2 (fixture), 5 (harness) ✓
- §5 semantica (valutato/tracciato/per-AC globale/regex ancorata/commento string-aware/tag spurio/RED-prima) → `assertionTrace`+`textTracesAc` Task 1 + test ✓
- §6 fixture (tutte e 6 + ortogonalità) → Task 2 ✓
- §7 sotto-test (7.2/7.7/7.8/7.9/7.10/7.11/7.12 + precondizione) → Task 5 (7)…(13) ✓
- §8 vincoli build → Global Constraints ✓
- §9 ledger (emenda `L-COL-032`) → Task 6 Step 3 ✓
- §10 decisioni: harness=estendi (Task 5), ledger=emenda (Task 6), block-scalar floor=advisory (commento `commentedPortion` + test) ✓

**2. Placeholder scan:** nessun "TODO/TBD/handle edge cases"; ogni step di codice mostra il codice completo. ✓

**3. Type consistency:** `assertionTrace(tasks, appDir, inScope) → {ok, detail, untracked}` usato identico in Task 1 (test), Task 4 (wiring); `textTracesAc(text, acId) → boolean` in Task 1 + Task 2 gate; `control4Conformance(referenceApp, {mode, blueprintDir, manifest})` coerente col codice esistente (r.425). ✓
