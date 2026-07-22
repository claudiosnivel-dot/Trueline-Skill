# A2b — `arch_check` (altitudine come contratto del blueprint) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Build method di progetto:** Dynamic Workflows (`DYNAMIC-WORKFLOWS.md`, `L-COL-027`) — builder→verifier(Opus, k≥1) per task, ondate secondo il DAG sotto, git SOLO nell'orchestratore (`L-COL-024`).

**Goal:** Aggiungere `arch_check`, un oracolo dichiarativo che verifica il contratto di altitudine (strati + regole `forbidden`) dichiarato nel blueprint contro il grafo import reale (madge), come **gate assoluto BUILD-only** con vacuity guard obbligatorio.

**Architecture:** Il blueprint dichiara `architecture: { layers, forbidden, allow }` in un blocco YAML in `00-INDEX.md`. `validate_blueprint` ne valida la forma (plan-time, condizionale). `arch_check.mjs` costruisce il grafo import via un `module_graph.mjs` condiviso (estratto da `run_cyclecheck.mjs`), mappa i moduli agli strati per glob, applica le regole (reachability transitiva di default, `mode:direct` opzionale), emette finding `category:'architecture'`. Il checkpoint attiva l'oracolo solo in BUILD con blueprint+ecosistema JS/TS, e lo gata in modo **assoluto** (bypassa il delta) via `ABSOLUTE_GATE_ORACLES`, con allowlist audita (`fix_state:'accepted-risk'`).

**Tech Stack:** Node ESM (solo built-in + madge esterno via preflight), `node:test`, mini-parser YAML dep-free, `pgsql-ast-parser` NON coinvolto.

## Global Constraints

- **`L-COL-002`** — il verde è un FATTO d'oracolo, mai una frase LLM. Ogni gate = comando deterministico.
- **`L-COL-006`** — nessun falso via-libera: un controllo non eseguito / un contratto vacuo NON è verde; copertura sempre dichiarata.
- **`L-COL-024`** — git SOLO nell'orchestratore; branch `feat/a2b-arch-contract`, `main` intatto fino al merge human-gated; provisioning `.git`/`node_modules` dei fixture = passo d'orchestratore.
- **BIT-invarianza** — nessun `--blueprint` / no blocco `architecture:` / REMEDIATE / ecosistema non-JS-TS ⇒ controllo 1 **byte-identico**. Testimone: `m5` **56/56** e keystone A2a `a2a_hygiene_check` invariati. **NON modificare `eval/seeded-blueprint/`** (aggiungervi un blocco `architecture:` romperebbe la BIT-invarianza di m5).
- **`fix_state` enum** (chiuso, `finding.schema.json`): usa `accepted-risk` per le eccezioni allowlist (già nell'enum; nessuna modifica allo schema). `finding.schema.json` ha `additionalProperties:false` → NON aggiungere campi al finding.
- **`category:'architecture'`** già nell'enum di `finding.schema.json` e in `CATEGORY_ENUM` di `validate_ecosystem` — riuso, nessuna modifica.
- **Determinismo** (`L-COL-002`): niente `Date.now()`/`Math.random()`; ordinamenti stabili (`.sort()`), fingerprint ancorato al contenuto.
- **Fixture root** — `eval/ecosystems/_a2b-fixtures/` (come `_a2a-fixtures/`); keystone in `eval/harness/`.
- Spec di riferimento: `docs/superpowers/specs/2026-07-22-a2b-arch-contract-design.md`.

---

## File Structure

**Create:**
- `trueline/scripts/oracles/module_graph.mjs` — grafo import madge condiviso (`buildModuleGraph`, `findCycles`, `npxCli`).
- `trueline/scripts/oracles/module_graph.test.mjs` — unit del grafo.
- `trueline/scripts/blueprint/arch_contract.mjs` — loader+validatore del contratto (`loadArchContract`, `validateArchContract`).
- `trueline/scripts/blueprint/arch_contract.test.mjs` — unit del loader/validatore.
- `trueline/scripts/oracles/arch_check.mjs` — l'oracolo.
- `trueline/scripts/oracles/arch_check.test.mjs` — unit dell'oracolo.
- `eval/ecosystems/_a2b-fixtures/{direct,transitive,conformant,vacuous-deadrule,allowlisted}/…` — fixture (codice + `blueprint/00-INDEX.md`).
- `eval/ecosystems/_a2b-fixtures/provision_fixtures.sh` — passo d'orchestratore (inner `.git`, `node_modules/knip`/`madge`).
- `eval/harness/a2b_arch_check.mjs` — keystone falsificabile.

**Modify:**
- `trueline/scripts/oracles/run_cyclecheck.mjs` — importa `module_graph.mjs` (refactor a comportamento invariato).
- `trueline/scripts/blueprint/validate_blueprint.mjs` — 6° controllo condizionale `ARCH_CONTRACT_WELL_FORMED`.
- `trueline/scripts/findings/normalize.mjs` — `normalizeArch` + alias + `toolVersions.arch` + `case 'arch'`.
- `trueline/scripts/checkpoint/checkpoint.mjs` — `ARCH_CHECK`, `ABSOLUTE_GATE_ORACLES`, `partitionBlockers`, ramo arch in `control1Hygiene` (+ `mode`/`blueprintDir`), helper `graphCapable`/`archContractPresent`, threading in `runCheckpoint`.
- `trueline/references/blueprint/atomic-task-schema.md` — documenta il blocco `architecture:`.
- `trueline/references/blueprint/template/00-INDEX.template.md` — template del blocco.
- `11-BLUEPRINT-ENGINE.md` — prosa §3/§5.1 (dichiarazione strati).

**DAG (ondate):** T1 (module_graph) ‖ T2 (arch_contract) → T3 (validate_blueprint, dep T2) ‖ T4 (normalizeArch) → T5 (arch_check, dep T1+T2) → T6 (checkpoint wiring, dep T4+T5) → T7 (fixture+keystone, dep T3+T5+T6) → T8 (docs) → T-final (batteria SERIALE).

---

### Task 1: `module_graph.mjs` — estrazione del grafo madge (refactor invariante)

**Files:**
- Create: `trueline/scripts/oracles/module_graph.mjs`
- Create: `trueline/scripts/oracles/module_graph.test.mjs`
- Modify: `trueline/scripts/oracles/run_cyclecheck.mjs` (intero corpo → import dal modulo)

**Interfaces:**
- Produces: `buildModuleGraph(dir) → { graph, modules, degraded, detail }` (graph = adiacenza madge `{mod:[deps]}` o `null`; modules = `string[]`; degraded = `boolean`; detail = `string`). `findCycles(graph) → string[][]`. `npxCli() → string|null`.

- [ ] **Step 1: Write the failing test** — `trueline/scripts/oracles/module_graph.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCycles } from './module_graph.mjs';

test('findCycles trova un ciclo elementare e lo deduplica per set', () => {
  const graph = { 'a.ts': ['b.ts'], 'b.ts': ['a.ts'], 'c.ts': [] };
  const cycles = findCycles(graph);
  assert.equal(cycles.length, 1);
  assert.deepEqual([...cycles[0]].sort(), ['a.ts', 'b.ts']);
});

test('findCycles: DAG pulito -> nessun ciclo', () => {
  assert.equal(findCycles({ 'a.ts': ['b.ts'], 'b.ts': [] }).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test trueline/scripts/oracles/module_graph.test.mjs`
Expected: FAIL — `Cannot find module '.../module_graph.mjs'`.

- [ ] **Step 3: Create `module_graph.mjs`** (funzioni estratte VERBATIM da `run_cyclecheck.mjs`, `buildModuleGraph` ritorna invece di `process.exit`)

```js
// module_graph.mjs — grafo import madge CONDIVISO (A2b). Estratto da run_cyclecheck.mjs
// (A2a) a comportamento invariato: madge costruisce il grafo (.ts-aware, dove
// dependency-cruiser è cieco); i consumatori (run_cyclecheck: cicli; arch_check:
// regole forbidden fra strati) lo usano. buildModuleGraph RITORNA lo stato (niente
// process.exit): il chiamante decide l'esito (L-COL-006: grafo vuoto = degradato,
// mai un verde). Node ESM, solo built-in.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

// Su Windows npx è npx.cmd: spawnSync('npx')->ENOENT, spawnSync('npx.cmd')->EINVAL
// (CVE-2024-27980). Invochiamo npx via node sul suo cli JS.
export function npxCli() {
  const nodeDir = dirname(process.execPath);
  const candidates = process.platform === 'win32'
    ? [join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js')]
    : [join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js')];
  return candidates.find((p) => existsSync(p)) || null;
}

// Costruisce il grafo import con madge. Ritorna { graph, modules, degraded, detail }.
// degraded=true (grafo null/vuoto) = oracolo NON eseguito, MAI un verde (L-COL-006).
export function buildModuleGraph(dir) {
  const localBin = resolve(dir, 'node_modules', 'madge', 'bin', 'cli.js');
  const useLocal = existsSync(localBin);
  const target = existsSync(resolve(dir, 'src')) ? 'src' : '.';
  const NPX_CLI = useLocal ? null : npxCli();
  const head = useLocal ? [localBin] : (NPX_CLI ? [NPX_CLI, '--yes', 'madge'] : ['--yes', 'madge']);
  const argv = head.concat(['--json', '--extensions', 'ts,tsx,js,jsx,mjs,cjs', target]);
  const bin = (useLocal || NPX_CLI) ? process.execPath : 'npx';
  const res = spawnSync(bin, argv, { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const rawOut = (res.stdout || '').trim();
  if (!rawOut) return { graph: null, modules: [], degraded: true, detail: `madge non eseguito (exit=${res.status}): ${(res.stderr || '').slice(-200)}` };
  let graph;
  try { graph = JSON.parse(rawOut); } catch (e) { return { graph: null, modules: [], degraded: true, detail: `JSON invalido: ${e.message}` }; }
  const modules = Object.keys(graph || {});
  if (modules.length === 0) return { graph, modules, degraded: true, detail: 'madge ha costruito un grafo VUOTO (0 moduli): resolver/estensioni?' };
  return { graph, modules, degraded: false, detail: `${modules.length} moduli` };
}

// Cicli elementari via DFS con rilevamento di back-edge sullo stack corrente.
export function findCycles(graph) {
  const cycles = [];
  const done = new Set();
  const stack = [];
  const onStack = new Set();
  function dfs(node) {
    stack.push(node); onStack.add(node);
    for (const dep of (graph[node] || [])) {
      if (onStack.has(dep)) {
        const idx = stack.indexOf(dep);
        if (idx >= 0) cycles.push(stack.slice(idx));
      } else if (!done.has(dep) && graph[dep] !== undefined) {
        dfs(dep);
      }
    }
    stack.pop(); onStack.delete(node); done.add(node);
  }
  for (const n of Object.keys(graph)) if (!done.has(n)) dfs(n);
  const uniq = new Map();
  for (const c of cycles) { const key = [...c].sort().join('|'); if (!uniq.has(key)) uniq.set(key, c); }
  return [...uniq.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test trueline/scripts/oracles/module_graph.test.mjs`
Expected: PASS (2 test).

- [ ] **Step 5: Refactor `run_cyclecheck.mjs` to import the shared module** (comportamento invariato)

Sostituisci l'INTERO corpo di `trueline/scripts/oracles/run_cyclecheck.mjs` con:

```js
#!/usr/bin/env node
// run_cyclecheck.mjs — oracolo CICLI DI IMPORT (A2a). Il grafo madge e il DFS
// vivono in module_graph.mjs (condiviso con arch_check, A2b). Comportamento
// INVARIATO: grafo vuoto/non eseguito -> exit 1 DICHIARATO (L-COL-006), mai
// {cycles:[]} nudo; JSON nativo su stdout col verdetto nel payload (03 §3).
import { existsSync } from 'node:fs';
import { buildModuleGraph, findCycles } from './module_graph.mjs';

function main() {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) { console.error('uso: run_cyclecheck.mjs <dir>'); process.exit(2); }
  const { graph, modules, degraded, detail } = buildModuleGraph(dir);
  if (degraded) { console.error(`${detail}: oracolo non eseguito`); process.exit(1); } // non un verde (L-COL-006)
  const cycles = findCycles(graph).map((c) => ({ modules: c }));
  process.stdout.write(JSON.stringify({ oracle: 'cycle', tool: 'madge', modulesScanned: modules.length, cycles }));
  process.exit(0);
}
main();
```

- [ ] **Step 6: Verify the A2a keystone is invariant** (testimone del refactor)

Run: `node eval/harness/a2a_hygiene_check.mjs`
Expected: `RESULT: PASS` (5/5 — in particolare `cycle:red` e `clean:green` provano che il grafo/DFS estratto è funzionalmente identico). *Precondizione: fixture A2a provisionate (`node_modules/knip`, inner `.git`).* Se le fixture non sono provisionate: exit 2 (precondizione), NON un fallimento del refactor.

- [ ] **Step 7: Commit**

```bash
git add trueline/scripts/oracles/module_graph.mjs trueline/scripts/oracles/module_graph.test.mjs trueline/scripts/oracles/run_cyclecheck.mjs
git commit -m "refactor(a2b): estrai module_graph.mjs da run_cyclecheck (invariante)"
```

---

### Task 2: `arch_contract.mjs` — loader + validatore del contratto

**Files:**
- Create: `trueline/scripts/blueprint/arch_contract.mjs`
- Create: `trueline/scripts/blueprint/arch_contract.test.mjs`

**Interfaces:**
- Consumes: `extractYamlBlocks` idioma (replicato — i loader NON si toccano, `L-COL-029`).
- Produces: `loadArchContract(blueprintDir) → { layers:{name:glob}, forbidden:[{from,to,mode?}], allow:[{from,to,module,note?}], raw:string } | null` (null = nessun blocco `architecture:`). `validateArchContract(contract) → { ok:boolean, errors:string[] }`.

- [ ] **Step 1: Write the failing test** — `trueline/scripts/blueprint/arch_contract.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadArchContract, validateArchContract } from './arch_contract.mjs';

function bp(indexBody) {
  const dir = mkdtempSync(join(tmpdir(), 'a2b-bp-'));
  writeFileSync(join(dir, '00-INDEX.md'), indexBody, 'utf8');
  return dir;
}

const GOOD = [
  '# INDEX', '', '```yaml', 'architecture:', '  layers:',
  '    ui: "src/ui/**"', '    data: "src/data/**"', '  forbidden:',
  '    - { from: ui, to: data }', '    - { from: data, to: ui, mode: direct }',
  '  allow:', '    - { from: ui, to: data, module: "src/ui/legacy.ts", note: "TICKET-1" }',
  '```', '',
].join('\n');

test('loadArchContract parsa layers/forbidden/allow', () => {
  const c = loadArchContract(bp(GOOD));
  assert.deepEqual(c.layers, { ui: 'src/ui/**', data: 'src/data/**' });
  assert.equal(c.forbidden.length, 2);
  assert.deepEqual(c.forbidden[0], { from: 'ui', to: 'data' });
  assert.equal(c.forbidden[1].mode, 'direct');
  assert.equal(c.allow[0].module, 'src/ui/legacy.ts');
});

test('loadArchContract: nessun blocco architecture -> null', () => {
  assert.equal(loadArchContract(bp('# solo prosa, nessun yaml')), null);
});

test('validateArchContract accetta un contratto ben formato', () => {
  assert.equal(validateArchContract(loadArchContract(bp(GOOD))).ok, true);
});

test('validateArchContract rifiuta: 0 regole, glob vuoto, strato non dichiarato', () => {
  assert.equal(validateArchContract({ layers: {}, forbidden: [] }).ok, false);
  assert.equal(validateArchContract({ layers: { ui: '' }, forbidden: [{ from: 'ui', to: 'ui' }] }).ok, false);
  assert.equal(validateArchContract({ layers: { ui: 'a/**' }, forbidden: [{ from: 'ui', to: 'ghost' }] }).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test trueline/scripts/blueprint/arch_contract.test.mjs`
Expected: FAIL — modulo assente.

- [ ] **Step 3: Create `arch_contract.mjs`**

```js
// arch_contract.mjs — loader + validatore del CONTRATTO DI ALTITUDINE (A2b).
// Il blueprint dichiara `architecture: { layers, forbidden, allow }` in un blocco
// ```yaml di 00-INDEX.md. Questo è un CONSUMATORE NUOVO: replica l'idioma
// extractYamlBlocks (i loader di validate_blueprint/blueprint_tasks NON si toccano,
// L-COL-029) e parsa il solo sotto-schema `architecture:` (layers = mapping
// name->glob; forbidden/allow = liste di flow-map inline `- { k: v, ... }`).
// Deterministico, solo built-in.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function extractYamlBlocks(text) {
  const blocks = [];
  const re = /```ya?ml\s*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

const unquote = (v) => {
  v = String(v).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
};

// Divide "from: ui, to: data" sul primo livello, rispettando gli apici.
function splitTopComma(s) {
  const out = [];
  let cur = '', inS = false, inD = false;
  for (const c of s) {
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    if (c === ',' && !inS && !inD) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// "{ from: ui, to: data, mode: direct }" -> { from:'ui', to:'data', mode:'direct' }
function parseFlowMap(s) {
  const inner = s.trim().replace(/^\{/, '').replace(/\}$/, '').trim();
  const obj = {};
  if (!inner) return obj;
  for (const part of splitTopComma(inner)) {
    const idx = part.indexOf(':');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = unquote(part.slice(idx + 1));
    if (k) obj[k] = v;
  }
  return obj;
}

// Parsa il blocco YAML se contiene un top-level `architecture:`. Ritorna il
// contratto o null. indentOf per distinguere layers (mapping) da forbidden/allow.
function parseArchBlock(yaml) {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n');
  const indentOf = (l) => l.length - l.trimStart().length;
  let i = 0;
  // trova `architecture:` al livello top (indent 0)
  while (i < lines.length && !/^architecture:\s*$/.test(lines[i])) i++;
  if (i >= lines.length) return null;
  i++;
  const contract = { layers: {}, forbidden: [], allow: [], raw: yaml };
  let section = null; // 'layers' | 'forbidden' | 'allow'
  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    const ind = indentOf(raw);
    if (ind === 0) break; // fine del blocco architecture
    const t = raw.trim();
    const sec = t.match(/^(layers|forbidden|allow):\s*$/);
    if (sec && ind <= 2) { section = sec[1]; continue; }
    if (section === 'layers') {
      const kv = t.match(/^([A-Za-z_][\w-]*):\s*(.+)$/);
      if (kv) contract.layers[kv[1]] = unquote(kv[2]);
    } else if (section === 'forbidden' || section === 'allow') {
      const item = t.match(/^-\s*(\{.*\})\s*$/);
      if (item) contract[section].push(parseFlowMap(item[1]));
    }
  }
  return contract;
}

// Carica il contratto dai file .md del blueprint (00-INDEX.md per convenzione, ma
// scansiona tutti i .md: il primo blocco con `architecture:` vince). null se assente.
export function loadArchContract(blueprintDir) {
  if (!existsSync(blueprintDir) || !statSync(blueprintDir).isDirectory()) return null;
  const files = readdirSync(blueprintDir).filter((f) => f.endsWith('.md')).sort();
  for (const f of files) {
    const text = readFileSync(join(blueprintDir, f), 'utf8');
    for (const block of extractYamlBlocks(text)) {
      if (/^architecture:\s*$/m.test(block)) {
        const c = parseArchBlock(block);
        if (c) return c;
      }
    }
  }
  return null;
}

// Validazione STRUTTURALE (plan-time): forma ben formata, NON aggancio al codice
// (quello è arch_check, build-time). >=1 strato con glob non vuoto, >=1 regola,
// from/to dichiarati, mode noto, allow verso strati dichiarati.
export function validateArchContract(c) {
  const errors = [];
  const layers = c && c.layers ? c.layers : {};
  const layerNames = Object.keys(layers);
  if (layerNames.length === 0) errors.push('nessuno strato dichiarato (layers vuoto)');
  for (const [name, glob] of Object.entries(layers)) {
    if (!glob || !String(glob).trim()) errors.push(`strato "${name}" senza selettore glob`);
  }
  const rules = (c && c.forbidden) || [];
  if (rules.length === 0) errors.push('nessuna regola forbidden (contratto vacuo)');
  const set = new Set(layerNames);
  for (const r of rules) {
    if (!set.has(r.from)) errors.push(`regola forbidden con from="${r.from}" non dichiarato`);
    if (!set.has(r.to)) errors.push(`regola forbidden con to="${r.to}" non dichiarato`);
    if (r.mode && !['direct', 'transitive'].includes(r.mode)) errors.push(`regola con mode="${r.mode}" ignoto (direct|transitive)`);
  }
  for (const a of (c && c.allow) || []) {
    if (!set.has(a.from) || !set.has(a.to)) errors.push(`allow con strato non dichiarato (${a.from}->${a.to})`);
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test trueline/scripts/blueprint/arch_contract.test.mjs`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add trueline/scripts/blueprint/arch_contract.mjs trueline/scripts/blueprint/arch_contract.test.mjs
git commit -m "feat(a2b): arch_contract loader+validatore (layers/forbidden/allow)"
```

---

### Task 3: `validate_blueprint.mjs` — 6° controllo condizionale + doc schema

**Files:**
- Modify: `trueline/scripts/blueprint/validate_blueprint.mjs` (import in testa + blocco (6) dopo il controllo (5), riga ~396)
- Modify: `trueline/references/blueprint/atomic-task-schema.md` (documenta il blocco `architecture:`)
- Modify: `11-BLUEPRINT-ENGINE.md` (prosa §3/§5.1 — dichiarazione strati)
- Test: `trueline/scripts/blueprint/validate_blueprint.arch.test.mjs`

**Interfaces:**
- Consumes: `loadArchContract`, `validateArchContract` da `arch_contract.mjs` (Task 2).

- [ ] **Step 1: Write the failing test** — `trueline/scripts/blueprint/validate_blueprint.arch.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALIDATE = resolve(HERE, 'validate_blueprint.mjs');
const TASK = [
  '```yaml', '- id: T-1', '  macrotask: m', '  objective: o',
  '  definition_of_done: [d]', '  acceptance_criteria:',
  '    - id: AC-1', '      given: g', '      when: w', '      then: t',
  '  target_tests:', '    - file: t.test.ts', '      covers: [AC-1]', '```',
].join('\n');

function bp(extraIndex) {
  const dir = mkdtempSync(join(tmpdir(), 'a2b-vb-'));
  writeFileSync(join(dir, '00-INDEX.md'), (extraIndex || '') + '\n' + TASK, 'utf8');
  return dir;
}
const run = (dir) => spawnSync(process.execPath, [VALIDATE, dir], { encoding: 'utf8' });

test('blueprint senza blocco architecture: 5 controlli, exit 0', () => {
  const r = run(bp(''));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /ARCH_CONTRACT/);
});

test('blocco architecture ben formato: exit 0 con (6) ARCH_CONTRACT_WELL_FORMED OK', () => {
  const arch = ['```yaml', 'architecture:', '  layers:', '    ui: "src/ui/**"', '    data: "src/data/**"',
    '  forbidden:', '    - { from: ui, to: data }', '```'].join('\n');
  const r = run(bp(arch));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\[OK\] \(6\) ARCH_CONTRACT_WELL_FORMED/);
});

test('blocco architecture malformato (regola verso strato non dichiarato): exit 1', () => {
  const arch = ['```yaml', 'architecture:', '  layers:', '    ui: "src/ui/**"',
    '  forbidden:', '    - { from: ui, to: ghost }', '```'].join('\n');
  const r = run(bp(arch));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ARCH_CONTRACT_WELL_FORMED/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test trueline/scripts/blueprint/validate_blueprint.arch.test.mjs`
Expected: FAIL sui casi 2/3 (nessun controllo (6) ancora).

- [ ] **Step 3: Add the import** in `validate_blueprint.mjs` (dopo la riga 39, `import { fileURLToPath } ...`)

```js
import { loadArchContract, validateArchContract } from './arch_contract.mjs';
```

- [ ] **Step 4: Add the 6th conditional check** — in `validate_blueprint.mjs`, DENTRO il blocco `if (!error && tasks.length > 0) { … }`, subito DOPO il controllo `(5) MACROTASK_OWNERSHIP` (dopo la riga `}` che chiude il blocco (5), ~riga 396):

```js
  // (6) ARCH_CONTRACT_WELL_FORMED — CONDIZIONALE (A2b): solo se il blueprint
  //     dichiara un blocco `architecture:`. Assente -> nessun controllo (skip):
  //     la fixture seeded senza strati resta verde (BIT-invarianza).
  {
    let contract = null, parseErr = null;
    try { contract = loadArchContract(blueprintDir); } catch (e) { parseErr = e.message; }
    if (parseErr) {
      check('(6) ARCH_CONTRACT_WELL_FORMED', false, `contratto architettura non parsabile: ${parseErr}`);
    } else if (contract) {
      const v = validateArchContract(contract);
      check('(6) ARCH_CONTRACT_WELL_FORMED', v.ok,
        v.ok ? 'contratto strati/forbidden ben formato' : v.errors.join(' | '));
    }
    // contract === null -> nessun blocco architecture -> nessun check (skip legittimo)
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test trueline/scripts/blueprint/validate_blueprint.arch.test.mjs`
Expected: PASS (3 test).

- [ ] **Step 6: Verify the seeded fixture is still green** (BIT-invarianza plan-time)

Run: `node trueline/scripts/blueprint/validate_blueprint.mjs`
Expected: `RESULT: OK` — 5 controlli, NESSUN `(6)` (la seeded non dichiara `architecture:`).

- [ ] **Step 7: Document the block** — append a `trueline/references/blueprint/atomic-task-schema.md`:

````markdown

## Contratto di altitudine — blocco `architecture:` (BUILD, A2b)

Il blueprint può dichiarare l'**altitudine** (gli strati architetturali e le
dipendenze vietate) in un blocco `architecture:` **globale** in `00-INDEX.md`
(non per-task: gli strati sono una proprietà del progetto). `validate_blueprint`
ne valida la forma (condizionale); in BUILD `arch_check` verifica le regole
`forbidden` contro il grafo import reale (madge), come **gate assoluto**.

```yaml
architecture:
  layers:                         # nome-strato -> selettore glob (path repo-relative)
    ui:     "src/ui/**"
    domain: "src/domain/**"
    data:   "src/data/**"
  forbidden:                      # regole direzionali; `mode` opzionale (default transitive)
    - { from: ui,     to: data }              # ui non deve RAGGIUNGERE data (anche via terzi)
    - { from: domain, to: ui, mode: direct }  # solo edge diretti domain->ui
  allow:                          # eccezioni ACCETTATE (audite, mai silenziose) — opzionale
    - { from: ui, to: data, module: "src/ui/LegacyGrid.tsx", note: "temp, TICKET-123" }
```

| Campo | Regola (validate_blueprint, se il blocco è presente) |
|---|---|
| `layers` | ≥1 strato; ogni strato con selettore glob non vuoto |
| `forbidden` | ≥1 regola; `from`/`to` = strati dichiarati; `mode` ∈ {direct, transitive} |
| `allow` | opzionale; `from`/`to` = strati dichiarati; `module` + `note` |

**Vacuity guard (`arch_check`, build-time, `L-COL-006`):** grafo vuoto, 0 regole,
o una regola il cui `from`/`to` mappa a 0 moduli reali ⇒ **non-verde dichiarato**,
mai un pass vacuo. **BUILD-only**: in REMEDIATE non c'è blueprint → non applicabile.
````

- [ ] **Step 8: Extend `11-BLUEPRINT-ENGINE.md`** — aggiungi in §3 (dopo lo schema del task) e §5.1 (dopo i 5 controlli) una nota che rimanda al blocco `architecture:` e al controllo `(6) ARCH_CONTRACT_WELL_FORMED` condizionale (prosa breve, allineata al doc dello schema; NON duplicare lo YAML — rimanda a `atomic-task-schema.md`).

- [ ] **Step 9: Commit**

```bash
git add trueline/scripts/blueprint/validate_blueprint.mjs trueline/scripts/blueprint/validate_blueprint.arch.test.mjs trueline/references/blueprint/atomic-task-schema.md 11-BLUEPRINT-ENGINE.md
git commit -m "feat(a2b): validate_blueprint 6o controllo condizionale ARCH_CONTRACT + doc schema"
```

---

### Task 4: `normalizeArch` — adapter native→finding

**Files:**
- Modify: `trueline/scripts/findings/normalize.mjs` (funzione `normalizeArch` accanto a `normalizeCycle` ~riga 900; `ORACLE_ALIASES` ~riga 1305; `toolVersions` ~riga 1341; `switch` ~riga 1377)
- Test: `trueline/scripts/findings/normalize.arch.test.mjs`

**Interfaces:**
- Consumes: `native = { oracle:'arch', findings:[{from,to,source_module,target_module,path,accepted_exception?}] }`.
- Produces: finding `category:'architecture'`, `source_oracle.oracle:'arch'`, `owasp:'A04:2025'`, `cwe:'CWE-1061'`, `severity:'MEDIUM'`, fingerprint DIREZIONALE; `fix_state:'accepted-risk'` se `accepted_exception`.

- [ ] **Step 1: Write the failing test** — `trueline/scripts/findings/normalize.arch.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './normalize.mjs';

const native = { oracle: 'arch', findings: [
  { from: 'ui', to: 'data', source_module: 'src/ui/p.ts', target_module: 'src/data/db.ts', path: ['src/ui/p.ts', 'src/data/db.ts'] },
  { from: 'ui', to: 'data', source_module: 'src/ui/legacy.ts', target_module: 'src/data/db.ts', path: ['src/ui/legacy.ts', 'src/data/db.ts'], accepted_exception: true },
] };

test('normalizeArch: category/owasp/cwe/severity e fix_state', () => {
  const out = normalize('arch', native, { base: 'src' });
  assert.equal(out.length, 2);
  assert.equal(out[0].category, 'architecture');
  assert.equal(out[0].source_oracle.oracle, 'arch');
  assert.equal(out[0].owasp, 'A04:2025');
  assert.equal(out[0].cwe, 'CWE-1061');
  assert.equal(out[0].severity, 'MEDIUM');
  assert.equal(out[0].fix_state, 'detected');
  assert.equal(out[1].fix_state, 'accepted-risk'); // eccezione allowlist
});

test('normalizeArch: fingerprint DIREZIONALE (from->to != to->from)', () => {
  const ab = normalize('arch', native, { base: 'src' })[0].fingerprint;
  const rev = normalize('arch', { oracle: 'arch', findings: [
    { from: 'data', to: 'ui', source_module: 'src/data/db.ts', target_module: 'src/ui/p.ts', path: [] }] }, { base: 'src' })[0].fingerprint;
  assert.notEqual(ab, rev);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test trueline/scripts/findings/normalize.arch.test.mjs`
Expected: FAIL — `oracolo sconosciuto: "arch"` (alias assente).

- [ ] **Step 3: Add `normalizeArch`** in `normalize.mjs`, subito dopo `normalizeTwin` (dopo la riga 934):

```js
// --- arch (architecture — A2b, contratto di altitudine dichiarato) -----------
// Nativo (da arch_check.mjs): { oracle:'arch', findings:[{ from, to, source_module,
//   target_module, path[], accepted_exception?, accept_note? }] }. category=
//   architecture; severity=MEDIUM (breccia di CONTRATTO dichiarato, sopra l'igiene
//   LOW di cycle/twin). owasp A04:2025 (Insecure Design) + CWE-1061. Il fingerprint è
//   DIREZIONALE (from->to != to->from): NON si ordina. Una violazione allow-matched
//   diventa fix_state='accepted-risk' -> il chiamante la riporta ma non la gata.
function normalizeArch(native, ctx) {
  const violations = native && Array.isArray(native.findings) ? native.findings : [];
  const out = [];
  for (const v of violations) {
    const src = normalizePath(v.source_module || '', { base: ctx.base });
    const tgt = normalizePath(v.target_module || '', { base: ctx.base });
    const ruleId = 'forbidden-dependency';
    const matchSignature = [ruleId, v.from, v.to, src, tgt].join('|'); // direzionale
    const path = Array.isArray(v.path) && v.path.length
      ? v.path.map((p) => normalizePath(p, { base: ctx.base })) : [src, tgt];
    const f = baseFinding(ctx, {
      category: 'architecture',
      severity: 'MEDIUM',
      location: { file: src || '(arch)', start_line: 0, end_line: 0 },
      evidence: `Violazione di altitudine: lo strato "${v.from}" non deve dipendere da "${v.to}" — ${path.join(' -> ')} (arch-check).`,
      owasp: 'A04:2025',
      cwe: 'CWE-1061',
      source_oracle: { oracle: 'arch', tool_version: ctx.toolVersions.arch, rule_id: ruleId },
      fingerprint: fingerprintOf({ oracle: 'arch', ruleId, normalizedPath: src, matchSignature }),
      remediation_hint: 'Invertire/spezzare la dipendenza fra strati (decisione architetturale umana; nessun fix automatico).',
    });
    if (v.accepted_exception) f.fix_state = 'accepted-risk';
    out.push(f);
  }
  return out;
}
```

- [ ] **Step 5: Wire the dispatch** — tre modifiche in `normalize.mjs`:

In `ORACLE_ALIASES` (dopo `twincheck: 'twin',`, riga 1304):
```js
  arch: 'arch',
  'arch-check': 'arch',
  arch_check: 'arch',
  archcheck: 'arch',
```
In `ctx.toolVersions` (dopo `twin: 'twin-check@1.0.0',`, riga 1341):
```js
      arch: 'arch-check@trueline',
```
In `switch (canon)` (dopo `case 'twin': return normalizeTwin(native, ctx);`, riga 1377):
```js
    case 'arch':
      return normalizeArch(native, ctx);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test trueline/scripts/findings/normalize.arch.test.mjs`
Expected: PASS (2 test).

- [ ] **Step 7: Commit**

```bash
git add trueline/scripts/findings/normalize.mjs trueline/scripts/findings/normalize.arch.test.mjs
git commit -m "feat(a2b): normalizeArch (architecture/A04:2025/CWE-1061, fingerprint direzionale)"
```

---

### Task 5: `arch_check.mjs` — l'oracolo (glob, reachability, vacuity, allow)

**Files:**
- Create: `trueline/scripts/oracles/arch_check.mjs`
- Create: `trueline/scripts/oracles/arch_check.test.mjs`

**Interfaces:**
- CLI: `node arch_check.mjs <codeDir> --blueprint <blueprintDir>`; exit 2 senza args; **vacuity → exit 1 (stderr, stdout vuoto)**; normale → stdout JSON `{ oracle:'arch', tool_version, coverage, coverage_note, scanned_files, parse_warnings, findings:[…] }` exit 0.
- Consumes: `buildModuleGraph` (Task 1), `loadArchContract`/`validateArchContract` (Task 2).
- Produces (per test): funzioni pure esportate `layerOf(modulePath, layers)`, `evaluateContract(graph, contract) → { degraded, detail, violations }`.

- [ ] **Step 1: Write the failing test** — `trueline/scripts/oracles/arch_check.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerOf, evaluateContract } from './arch_check.mjs';

const layers = { ui: 'src/ui/**', domain: 'src/domain/**', data: 'src/data/**' };

test('layerOf: glob, più-specifico vince, non-assegnato -> null', () => {
  assert.equal(layerOf('src/ui/panel.ts', layers), 'ui');
  assert.equal(layerOf('src/data/db.ts', layers), 'data');
  assert.equal(layerOf('src/util/x.ts', layers), null);
});

test('violazione DIRETTA rilevata', () => {
  const graph = { 'src/ui/p.ts': ['src/data/db.ts'], 'src/data/db.ts': [] };
  const r = evaluateContract(graph, { layers, forbidden: [{ from: 'ui', to: 'data' }] });
  assert.equal(r.degraded, false);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].source_module, 'src/ui/p.ts');
});

test('laundering TRANSITIVO (default) rilevato; mode:direct lo IGNORA', () => {
  const graph = { 'src/ui/p.ts': ['src/domain/s.ts'], 'src/domain/s.ts': ['src/data/db.ts'], 'src/data/db.ts': [] };
  const trans = evaluateContract(graph, { layers, forbidden: [{ from: 'ui', to: 'data' }] });
  assert.equal(trans.violations.length, 1, 'transitive deve catturare ui->domain->data');
  const direct = evaluateContract(graph, { layers, forbidden: [{ from: 'ui', to: 'data', mode: 'direct' }] });
  assert.equal(direct.violations.length, 0, 'direct NON deve catturare il laundering');
});

test('conforme -> 0 violazioni (verde legittimo)', () => {
  const graph = { 'src/ui/p.ts': ['src/domain/s.ts'], 'src/domain/s.ts': ['src/data/db.ts'], 'src/data/db.ts': [] };
  const r = evaluateContract(graph, { layers, forbidden: [{ from: 'data', to: 'ui' }] });
  assert.equal(r.violations.length, 0);
  assert.equal(r.degraded, false);
});

test('vacuity: regola con strato che mappa 0 moduli -> degraded', () => {
  const graph = { 'src/ui/p.ts': [], 'src/domain/s.ts': [] }; // nessun modulo data
  const r = evaluateContract(graph, { layers, forbidden: [{ from: 'ui', to: 'data' }] });
  assert.equal(r.degraded, true);
});

test('allow-list: la violazione è marcata accepted_exception', () => {
  const graph = { 'src/ui/legacy.ts': ['src/data/db.ts'], 'src/data/db.ts': [] };
  const r = evaluateContract(graph, { layers, forbidden: [{ from: 'ui', to: 'data' }],
    allow: [{ from: 'ui', to: 'data', module: 'src/ui/legacy.ts' }] });
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].accepted_exception, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test trueline/scripts/oracles/arch_check.test.mjs`
Expected: FAIL — modulo assente.

- [ ] **Step 3: Create `arch_check.mjs`**

```js
#!/usr/bin/env node
// arch_check.mjs — oracolo ALTITUDINE (A2b). Verifica il contratto strati/forbidden
// dichiarato nel blueprint contro il grafo import reale (madge, via module_graph).
// Famiglia dichiarativa (rls_check/firestore_rules_check): JSON nativo su stdout, il
// verdetto vive nel payload; il PARSER non fa throw. VACUITY GUARD obbligatorio
// (L-COL-006): grafo vuoto / 0 regole / regola con strato a 0 moduli -> exit 1
// DICHIARATO (stderr, stdout vuoto), mai findings:[] nudo. BUILD-only (il contratto
// vive nel blueprint). Gate ASSOLUTO deciso dal checkpoint (ABSOLUTE_GATE_ORACLES).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildModuleGraph } from './module_graph.mjs';
import { loadArchContract } from '../blueprint/arch_contract.mjs';

const __filename = fileURLToPath(import.meta.url);

// glob -> RegExp: supporta ** (qualunque, incl. /) e * (qualunque tranne /).
function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if ('/.+?^${}()|[]\\'.includes(c)) { re += '\\' + c; }
    else re += c;
  }
  return new RegExp(re + '$');
}

// Strato di un modulo: fra i glob che matchano, vince il PIÙ SPECIFICO (prefisso
// letterale più lungo); pari merito -> ordine di dichiarazione. Nessun match -> null.
export function layerOf(modulePath, layers) {
  let best = null, bestLen = -1;
  for (const [name, glob] of Object.entries(layers || {})) {
    if (globToRegExp(String(glob)).test(modulePath)) {
      const litLen = String(glob).split('*')[0].length; // prefisso letterale
      if (litLen > bestLen) { best = name; bestLen = litLen; }
    }
  }
  return best;
}

// Insieme dei moduli (chiavi + valori del grafo) assegnati a ciascuno strato.
function modulesByLayer(graph, layers) {
  const all = new Set(Object.keys(graph));
  for (const deps of Object.values(graph)) for (const d of deps) all.add(d);
  const byLayer = {};
  for (const name of Object.keys(layers)) byLayer[name] = [];
  for (const m of all) { const L = layerOf(m, layers); if (L) byLayer[L].push(m); }
  return byLayer;
}

// Un modulo di layer `to` è raggiungibile da `src`? Traversa TUTTI gli edge (anche
// verso le foglie value-non-key: guard rilassato vs findCycles). Ritorna il path
// minimo verso il bersaglio lessicograficamente minimo, o null.
function reachTo(graph, src, toSet) {
  const prev = new Map([[src, null]]);
  const queue = [src];
  const hits = [];
  while (queue.length) {
    const node = queue.shift();
    for (const dep of (graph[node] || [])) {
      if (prev.has(dep)) continue;
      prev.set(dep, node);
      if (toSet.has(dep)) hits.push(dep);
      queue.push(dep); // rilassato: prosegue anche se dep non è chiave del grafo
    }
  }
  if (!hits.length) return null;
  const target = hits.sort()[0];
  const path = [];
  for (let n = target; n != null; n = prev.get(n)) path.unshift(n);
  return { target, path };
}

// Valuta il contratto sul grafo. Ritorna { degraded, detail, violations }.
export function evaluateContract(graph, contract) {
  const layers = contract.layers || {};
  const rules = contract.forbidden || [];
  if (!graph || Object.keys(graph).length === 0) return { degraded: true, detail: 'grafo vuoto', violations: [] };
  if (rules.length === 0) return { degraded: true, detail: '0 regole forbidden (contratto vacuo)', violations: [] };
  const byLayer = modulesByLayer(graph, layers);
  // Vacuity: ogni regola deve agganciare moduli reali su ENTRAMBI gli strati.
  for (const r of rules) {
    if ((byLayer[r.from] || []).length === 0 || (byLayer[r.to] || []).length === 0) {
      return { degraded: true, detail: `regola ${r.from}->${r.to}: uno strato mappa 0 moduli reali (regola morta)`, violations: [] };
    }
  }
  const allow = contract.allow || [];
  const isAllowed = (from, to, src) => allow.some((a) =>
    a.from === from && a.to === to && (!a.module || a.module === src || globToRegExp(String(a.module)).test(src)));
  const violations = [];
  const seen = new Set();
  for (const r of rules) {
    const toSet = new Set(byLayer[r.to]);
    for (const src of byLayer[r.from].slice().sort()) {
      let hit = null;
      if (r.mode === 'direct') {
        const t = (graph[src] || []).filter((d) => toSet.has(d)).sort()[0];
        if (t) hit = { target: t, path: [src, t] };
      } else {
        hit = reachTo(graph, src, toSet);
      }
      if (!hit) continue;
      const key = `${r.from}|${r.to}|${src}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({
        control_id: 'ARCH001_FORBIDDEN_DEPENDENCY',
        from: r.from, to: r.to, source_module: src, target_module: hit.target, path: hit.path,
        accepted_exception: isAllowed(r.from, r.to, src) || undefined,
      });
    }
  }
  return { degraded: false, detail: `${violations.length} violazioni`, violations };
}

function main() {
  const args = process.argv.slice(2);
  const codeDir = args[0];
  const bpIdx = args.indexOf('--blueprint');
  const blueprintDir = bpIdx >= 0 ? args[bpIdx + 1] : null;
  if (!codeDir || !existsSync(codeDir) || !blueprintDir) {
    process.stderr.write('uso: node arch_check.mjs <codeDir> --blueprint <blueprintDir>\n');
    process.exit(2);
  }
  const contract = loadArchContract(blueprintDir);
  if (!contract) { process.stderr.write('nessun contratto architecture nel blueprint: non applicabile\n'); process.exit(1); }
  const { graph, degraded: gdeg, detail: gdet } = buildModuleGraph(codeDir);
  if (gdeg) { process.stderr.write(`${gdet}: oracolo non eseguito\n`); process.exit(1); } // L-COL-006
  const { degraded, detail, violations } = evaluateContract(graph, contract);
  if (degraded) { process.stderr.write(`vacuity: ${detail}: oracolo non eseguito\n`); process.exit(1); } // L-COL-006
  const report = {
    oracle: 'arch',
    tool_version: 'arch-check@trueline (madge)',
    coverage: 'static-import-graph',
    coverage_note: 'Verifica statica delle regole forbidden fra strati sul grafo import (madge). Non vede dipendenze via reflection/DI dinamica. BUILD-only.',
    scanned_files: Object.keys(graph).sort(),
    parse_warnings: [],
    findings: violations,
  };
  process.stdout.write(JSON.stringify(report));
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === __filename) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test trueline/scripts/oracles/arch_check.test.mjs`
Expected: PASS (6 test).

- [ ] **Step 5: Commit**

```bash
git add trueline/scripts/oracles/arch_check.mjs trueline/scripts/oracles/arch_check.test.mjs
git commit -m "feat(a2b): arch_check oracolo (reachability transitiva/direct, vacuity, allow)"
```

---

### Task 6: checkpoint wiring — attivazione BUILD-only + gate assoluto

**Files:**
- Modify: `trueline/scripts/checkpoint/checkpoint.mjs` (costanti ~58-77; `partitionBlockers` 159-170; `control1Hygiene` 172-229; `runCheckpoint` 749)
- Test: `trueline/scripts/checkpoint/partition_blockers.arch.test.mjs`

**Interfaces:**
- Consumes: `ARCH_CHECK` path, `loadArchContract` (Task 2), `normalize('arch',…)` (Task 4), `arch_check.mjs` (Task 5).
- Produces: `partitionBlockers` con gate ASSOLUTO per `arch` + esclusione `accepted-risk`; `control1Hygiene(referenceApp, {…, mode, blueprintDir})`.

- [ ] **Step 1: Write the failing test** — `trueline/scripts/checkpoint/partition_blockers.arch.test.mjs`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partitionBlockers } from './checkpoint.mjs';

const mk = (oracle, fp, extra = {}) => ({
  fingerprint: fp, category: 'architecture', fix_state: 'detected',
  source_oracle: { oracle, rule_id: 'r' }, ...extra,
});

test('arch: gate ASSOLUTO — un finding pre-esistente BLOCCA comunque', () => {
  const base = new Set(['fp-arch']);
  const out = partitionBlockers([mk('arch', 'fp-arch')], base);
  assert.equal(out.length, 1, 'arch pre-esistente deve restare blocker (assoluto)');
});

test('cycle: delta — un finding pre-esistente NON blocca', () => {
  const out = partitionBlockers([mk('cycle', 'fp-cyc')], new Set(['fp-cyc']));
  assert.equal(out.length, 0);
});

test('arch accepted-risk: riportato ma NON blocca', () => {
  const out = partitionBlockers([mk('arch', 'fp-x', { fix_state: 'accepted-risk' })], new Set());
  assert.equal(out.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test trueline/scripts/checkpoint/partition_blockers.arch.test.mjs`
Expected: FAIL sul caso 1 (oggi arch pre-esistente verrebbe scartato dal delta).

- [ ] **Step 3: Add constants + import** in `checkpoint.mjs`. Dopo la riga 60 (`const TWIN_CHECK = …`):
```js
const ARCH_CHECK = resolve(ORACLES, 'arch_check.mjs');
```
Dopo la riga 68 (`const DETECTION_ONLY_ORACLES = …`):
```js
// Oracoli a GATE ASSOLUTO (A2b): un contratto DICHIARATO dall'utente (arch_check)
// blocca SEMPRE, non solo sul delta — come rls (USING(true) non si grandfather-a).
// I loro finding bypassano il filtro baseline in partitionBlockers.
const ABSOLUTE_GATE_ORACLES = new Set(['arch']);
```
Dopo la riga 47 (`import { assertionTrace } …`):
```js
import { loadArchContract } from '../blueprint/arch_contract.mjs';
```

- [ ] **Step 4: Replace `partitionBlockers`** (righe 159-170) con:
```js
export function partitionBlockers(findings, baseline) {
  const out = [];
  for (const f of findings) {
    const oracle = f.source_oracle && f.source_oracle.oracle;
    const absolute = ABSOLUTE_GATE_ORACLES.has(oracle);
    const isNew = !baseline.has(f.fingerprint);
    f.baseline_status = isNew ? 'new' : 'pre-existing';
    // Eccezione audita (L-COL-028): riportata, MAI un blocker.
    if (f.fix_state === 'accepted-risk') continue;
    // Delta: i pre-esistenti non bloccano — TRANNE gli oracoli a gate ASSOLUTO (arch).
    if (!isNew && !absolute) continue;
    // Detection-only (twin): segnale, mai gate.
    if (DETECTION_ONLY_ORACLES.has(oracle)) continue;
    out.push(f);
  }
  return out;
}
```

- [ ] **Step 5: Add helpers + arch branch + signature** in `control1Hygiene`. Cambia la firma (riga 172):
```js
export function control1Hygiene(referenceApp, { baseline = new Set(), runOpts, manifest = null, mode = 'remediate', blueprintDir = null }) {
```
Subito PRIMA di `export function control1Hygiene` (riga 172) aggiungi i due helper:
```js
// A2b — attivazione di arch_check: BUILD + blueprint con contratto + ecosistema
// graph-capable (JS/TS: il grafo import è un concetto JS/TS). Fuori da queste
// condizioni il ramo NON esiste -> controllo 1 byte-identico (BIT-invarianza).
function graphCapable(manifest) {
  const langs = (manifest && manifest.languages) || [];
  return langs.includes('js') || langs.includes('ts');
}
function archContractPresent(blueprintDir) {
  try { return blueprintDir != null && loadArchContract(blueprintDir) != null; } catch { return false; }
}
```
Dentro `control1Hygiene`, DOPO il blocco twin (dopo la riga 218, `} else sub.push('twin:degr');`) e PRIMA di `const blockers = partitionBlockers(all, baseline);` (riga 220):
```js
  // --- A2b: arch_check — contratto di altitudine (GATE ASSOLUTO, BUILD-only) ---
  // Blueprint-driven (non manifest.oracles): attivo solo in BUILD con un contratto
  // `architecture:` nel blueprint e un ecosistema JS/TS. Vacuity/degradato -> exit 1
  // dell'oracolo -> runOracle ok:false -> 'arch:degr' (declassa il verde, mai un
  // verde silenzioso). In REMEDIATE / senza contratto / non-JS-TS: ramo assente.
  if (mode === 'build' && blueprintDir && graphCapable(manifest) && archContractPresent(blueprintDir)) {
    const r = runOracle(ARCH_CHECK, [referenceApp, '--blueprint', blueprintDir], referenceApp);
    if (r.ok) {
      const n = normFindings('arch', r.json, { ...runOpts, scope: 'working-tree' });
      if (n.ok) { all.push(...n.findings); sub.push(`arch:${n.findings.length}`); }
      else sub.push('arch:degr');
    } else sub.push('arch:degr');
  }
```

- [ ] **Step 6: Thread `mode`+`blueprintDir`** in `runCheckpoint` (riga 749). Sostituisci:
```js
  const c1 = control1Hygiene(referenceApp, { baseline, runOpts, manifest });
```
con:
```js
  const c1 = control1Hygiene(referenceApp, { baseline, runOpts, manifest, mode, blueprintDir });
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `node --test trueline/scripts/checkpoint/partition_blockers.arch.test.mjs`
Expected: PASS (3 test).

- [ ] **Step 8: Verify A2a keystone still green** (BIT-invarianza del controllo 1: i chiamanti legacy passano `mode='remediate'`/`blueprintDir=null` di default → ramo arch assente)

Run: `node eval/harness/a2a_hygiene_check.mjs`
Expected: `RESULT: PASS` (5/5). *(Precondizione fixture A2a; altrimenti exit 2.)*

- [ ] **Step 9: Commit**

```bash
git add trueline/scripts/checkpoint/checkpoint.mjs trueline/scripts/checkpoint/partition_blockers.arch.test.mjs
git commit -m "feat(a2b): checkpoint wiring — arch_check BUILD-only + gate assoluto + allowlist"
```

---

### Task 7: fixture + keystone `a2b_arch_check.mjs`

**Files:**
- Create: `eval/ecosystems/_a2b-fixtures/<scenario>/…` (5 scenari: `direct`, `transitive`, `conformant`, `vacuous-deadrule`, `allowlisted`). Ogni scenario = un progetto JS/TS **knip-clean** con `src/` + `blueprint/00-INDEX.md`.
- Create: `eval/ecosystems/_a2b-fixtures/provision_fixtures.sh` (passo d'orchestratore: inner `.git`, `node_modules/knip` + `node_modules/madge` risolvibili per ogni scenario).
- Create: `eval/harness/a2b_arch_check.mjs` (keystone).

**Interfaces:**
- Consumes: `control1Hygiene` da `checkpoint.mjs` (Task 6). SYNTH manifest `{ languages:['ts'] }` (per `graphCapable`), SENZA `oracles.duplication/architecture` (dup/cycle non girano → l'unico gate possibile è arch/dead-code).

**Fixture layout** (esempio `direct/`): `src/ui/panel.ts` con `import '../data/db';`, `src/data/db.ts`, `src/index.ts` che importa `./ui/panel` (entry, così knip non segnala dead-code), `package.json` (`{"name":"fx","private":true}`), `blueprint/00-INDEX.md` col blocco `architecture:` (ui→data forbidden). `transitive/`: `src/ui/panel.ts`→`src/domain/svc.ts`→`src/data/db.ts` + regola ui→data (default transitive). `conformant/`: dipendenze che NON violano (data non importa ui). `vacuous-deadrule/`: contratto con una regola verso uno strato il cui glob non matcha alcun file. `allowlisted/`: come `direct` + una voce `allow` che copre il modulo sorgente.

> **NOTA knip-clean (L-COL-006):** ogni fixture deve avere ENTRY (`src/index.ts`) che raggiunge tutti i file, così `run_deadcode` (knip, sempre attivo nel controllo 1) NON emette dead-code che sporcherebbe il verdetto. Il gate del keystone è isolato su arch. Verificare con `clean:green` implicito (conformant deve tornare VERDE).

- [ ] **Step 1: Write the keystone (the gate)** — `eval/harness/a2b_arch_check.mjs`

```js
#!/usr/bin/env node
// a2b_arch_check.mjs — keystone A2b. Verità = FATTO d'oracolo (L-COL-002).
// Gate falsificabile di arch_check (contratto di altitudine, BUILD-only, gate
// assoluto). Sub-test ancorati al controllo 1 del checkpoint sui fixture:
//   direct:red         violazione diretta ui->data -> controllo 1 ROSSO (blocker arch).
//   transitive:red     laundering ui->domain->data (mode default) -> ROSSO.
//   direct-mode:green  la STESSA fixture transitive con mode:direct -> VERDE.
//   conformant:green   nessuna violazione -> VERDE (contratto che aggancia moduli reali).
//   vacuity:degr       regola con strato a 0 moduli -> arch:degr -> NON verde.
//   absolute:red       violazione già in baseline -> BLOCCA comunque (gate assoluto).
//   allow:reported     violazione allow-listed -> VERDE ma finding presente (accepted-risk).
//   bit-invariance     senza --blueprint (mode remediate) -> controllo 1 verde/identico.
import { control1Hygiene } from '../../trueline/scripts/checkpoint/checkpoint.mjs';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'ecosystems', '_a2b-fixtures');
const RUN = { runId: 'a2b', createdAt: '1970-01-01T00:00:00.000Z' };
const MANIFEST = { languages: ['ts'] }; // graph-capable; NIENTE oracles.dup/arch (dup/cycle non girano)

let fails = 0;
const check = (name, cond, detail) => {
  if (!cond) { fails++; console.log(`  [FAIL] ${name} — ${detail}`); } else console.log(`  [ok]   ${name}`);
};
const need = (s) => { const d = resolve(FIX, s); if (!existsSync(d)) { console.error(`precondizione: fixture ${d} assente`); process.exit(2); } return d; };
// control1 in BUILD col blueprint del fixture (sottodir blueprint/).
const c1 = (dir, { baseline = new Set(), mode = 'build', bp = true } = {}) =>
  control1Hygiene(dir, { manifest: MANIFEST, runOpts: RUN, baseline, mode, blueprintDir: bp ? join(dir, 'blueprint') : null });
const archBlockers = (h) => h.blockers.filter((b) => b.source_oracle.oracle === 'arch');

const direct = need('direct');
const hDir = c1(direct);
check('direct:red', hDir.green === false && archBlockers(hDir).length >= 1, `atteso ROSSO con blocker arch, visto green=${hDir.green} detail=${hDir.detail}`);

const transitive = need('transitive');
const hTr = c1(transitive);
check('transitive:red', hTr.green === false && archBlockers(hTr).length >= 1, `laundering ui->domain->data deve dare ROSSO, visto green=${hTr.green} detail=${hTr.detail}`);

// direct-mode: la fixture 'transitive-direct' ha la STESSA topologia ma regola mode:direct.
const trDirect = need('transitive-direct');
const hTrD = c1(trDirect);
check('direct-mode:green', hTrD.green === true, `mode:direct NON deve catturare il laundering (VERDE), visto green=${hTrD.green} detail=${hTrD.detail}`);

const conformant = need('conformant');
const hConf = c1(conformant);
check('conformant:green', hConf.green === true, `contratto rispettato -> VERDE, visto green=${hConf.green} detail=${hConf.detail}`);

const vac = need('vacuous-deadrule');
const hVac = c1(vac);
check('vacuity:degr', hVac.green === false && /arch:degr/.test(hVac.detail), `regola morta -> arch:degr (NON verde), visto green=${hVac.green} detail=${hVac.detail}`);

// absolute: la violazione di 'direct' già in baseline deve BLOCCARE comunque.
const dirFps = new Set(archBlockers(hDir).map((b) => b.fingerprint));
const hAbs = dirFps.size > 0 ? c1(direct, { baseline: dirFps }) : null;
check('absolute:red', hAbs && hAbs.green === false && archBlockers(hAbs).length >= 1, `arch pre-esistente deve BLOCCARE (assoluto), visto green=${hAbs && hAbs.green}`);

const allow = need('allowlisted');
const hAllow = c1(allow);
check('allow:reported', hAllow.green === true && hAllow.findings.some((f) => f.source_oracle.oracle === 'arch' && f.fix_state === 'accepted-risk'),
  `violazione allow-listed -> VERDE + finding accepted-risk, visto green=${hAllow.green} detail=${hAllow.detail}`);

// bit-invariance: senza blueprint (mode remediate) il ramo arch è assente.
const hBit = c1(direct, { mode: 'remediate', bp: false });
check('bit-invariance', archBlockers(hBit).length === 0, `senza --blueprint/REMEDIATE nessun arch, visto ${archBlockers(hBit).length}`);

console.log(fails === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 2: Create the fixtures** (6 scenari: `direct`, `transitive`, `transitive-direct`, `conformant`, `vacuous-deadrule`, `allowlisted`). Ogni scenario: `src/index.ts` (entry che importa la catena), i moduli `src/<layer>/*.ts`, `package.json`, `blueprint/00-INDEX.md`. Esempio `direct/`:

`direct/src/index.ts`:
```ts
import './ui/panel';
```
`direct/src/ui/panel.ts`:
```ts
import './../data/db';
export const panel = 1;
```
`direct/src/data/db.ts`:
```ts
export const db = 1;
```
`direct/package.json`:
```json
{ "name": "fx-a2b-direct", "private": true, "version": "0.0.0" }
```
`direct/blueprint/00-INDEX.md`:
````markdown
# INDEX
```yaml
architecture:
  layers:
    ui: "src/ui/**"
    data: "src/data/**"
  forbidden:
    - { from: ui, to: data }
```
- id: T-1
  macrotask: m
  objective: o
  definition_of_done: [d]
  acceptance_criteria:
    - id: AC-1
      given: g
      when: w
      then: t
  target_tests:
    - file: t.test.ts
      covers: [AC-1]
````
(`transitive/` aggiunge `src/domain/svc.ts` fra ui e data; `transitive-direct/` = `transitive/` con `mode: direct` sulla regola; `conformant/` inverte così ui→domain→data e la regola vieta `data`→`ui` (non violata); `vacuous-deadrule/` dichiara uno strato `api: "src/api/**"` con regola `ui→api` ma NESSUN file in `src/api/`; `allowlisted/` = `direct/` + `allow: [{ from: ui, to: data, module: "src/ui/panel.ts" }]`.)

- [ ] **Step 3: Create the provisioning script** — `eval/ecosystems/_a2b-fixtures/provision_fixtures.sh` (passo d'orchestratore, `L-COL-024`): per ogni scenario, inizializza inner `.git` (per il driver di verifica) e rende risolvibili `node_modules/knip` + `node_modules/madge` (symlink/copia dalla cache, come `_a2a-fixtures`). Modella su `eval/ecosystems/_a2a-fixtures/provision_fixtures.sh` (Read prima di scrivere).

- [ ] **Step 4: Provision + run the keystone** (orchestratore)

Run: `bash eval/ecosystems/_a2b-fixtures/provision_fixtures.sh && node eval/harness/a2b_arch_check.mjs`
Expected: `RESULT: PASS` (8 sub-test).

- [ ] **Step 5: Prove falsifiability** (il keystone è un gate reale)

Neutralizza temporaneamente la reachability in `arch_check.mjs` (in `reachTo`, `return null` all'inizio) → esegui il keystone → `transitive:red` diventa FAIL (la fixture transitive torna verde) → `RESULT: FAIL`. Ripristina → `RESULT: PASS`. Documenta l'esito nel commit.

- [ ] **Step 6: Commit**

```bash
git add eval/ecosystems/_a2b-fixtures eval/harness/a2b_arch_check.mjs
git commit -m "test(a2b): fixture + keystone a2b_arch_check (falsificabile, 8 sub-test)"
```

---

### Task 8: docs — template blueprint + note d'ecosistema

**Files:**
- Modify: `trueline/references/blueprint/template/00-INDEX.template.md` (aggiungi il blocco `architecture:` commentato come opzionale).

- [ ] **Step 1:** Aggiungi al template `00-INDEX.template.md` un blocco `architecture:` d'esempio (commentato "opzionale — abilita `arch_check` in BUILD"), coerente con `atomic-task-schema.md`. NON toccare `SKILL.md` (<500 righe, `L-COL-014`/`L-COL-029`).

- [ ] **Step 2: Commit**

```bash
git add trueline/references/blueprint/template/00-INDEX.template.md
git commit -m "docs(a2b): template 00-INDEX con blocco architecture opzionale"
```

---

### Task 9 (T-final): batteria di non-regressione SERIALE (orchestratore)

Passo d'orchestratore (`L-COL-002`, riesecuzione SERIALE; git solo qui). **Non un task di codice** — è il gate di milestone.

- [ ] **Step 1: Keystone A2b** — `node eval/harness/a2b_arch_check.mjs` → PASS (8/8) + falsificabilità provata (Task 7 Step 5).
- [ ] **Step 2: Keystone A2a invariante** — `node eval/harness/a2a_hygiene_check.mjs` → PASS 5/5 (refactor module_graph invariante).
- [ ] **Step 3: Keystone A0** — `node eval/harness/a0_authz_gate_check.mjs` → PASS 16/16 (il controllo 1 multi-oracolo non tocca il 2).
- [ ] **Step 4: m5** — `node eval/harness/m5_gate_check.mjs` → **56/56** (BIT-invarianza: seeded-blueprint senza `architecture:` → ramo arch assente). *Richiede DB-live + semgrep; se l'ambiente non li ha, dichiarare il gap (`L-COL-006`) e rieseguire al gate finale su macchina capace, come da prassi eco-expansion.*
- [ ] **Step 5: anti_tamper 49/49 · build_discipline 21/21** — keystone invariati.
- [ ] **Step 6: ecosystem_conformance** sui pack toccati + `package_skill` lint VERDE (arch_check/module_graph/arch_contract spediti; `SKILL.md` <500).
- [ ] **Step 7: Unit** — `node --test trueline/scripts/oracles/module_graph.test.mjs trueline/scripts/oracles/arch_check.test.mjs trueline/scripts/blueprint/arch_contract.test.mjs trueline/scripts/blueprint/validate_blueprint.arch.test.mjs trueline/scripts/findings/normalize.arch.test.mjs trueline/scripts/checkpoint/partition_blockers.arch.test.mjs` → tutti PASS.
- [ ] **Step 8: 0-contaminazione** — HEAD del repo esterno invariato; interni dei fixture invariati.
- [ ] **Step 9: Ledger** — aggiorna `00-INDEX §4` con **`L-COL-033`** (contratto di altitudine dichiarato = gate assoluto BUILD-only con vacuity guard + allowlist audita; raffina `L-COL-019`) + nota di riconciliazione; aggiorna `SESSION-STATE.md` (§ ultima sessione, §6 carry-over). Commit ledger separato.
- [ ] **Step 10: Merge** `--no-ff` human-gated su `main` (`L-COL-024`) + ri-verde su `main` + install riallineato.

---

## Self-Review (writing-plans)

**1. Spec coverage:** §1 (fondamento gate-abile) → prosa Task/spec; §2 (contratto authoring 00-INDEX) → T2/T3/T7; §3.2 (2 livelli) → T3 (plan-time) + T5 (build-time); §3.3 (module_graph estratto, reachability, leaf-relax) → T1/T5; §3.4 (attivazione BUILD/JS-TS/BIT) → T6; §3.5 (vacuity 3 rami) → T5 (evaluateContract) + T3 (0 regole plan-time); §4 (normalizeArch, A04:2025, CWE-1061, fingerprint direzionale) → T4; §5 (wiring control1) → T6; §6 (assoluto + allow) → T6 (partitionBlockers) + T5 (allow-match); §7 (test) → tutti + T7 keystone; §9 (onestà/coverage_note) → T5 report; §11 (DoD) → T-final. **Nessun gap.**

**2. Placeholder scan:** nessun "TBD/TODO"; ogni step di codice porta codice reale. La provisioning script (T7 Step 3) rimanda a un file esistente da Read+modellare (non un placeholder: è un passo d'orchestratore deliberato, come A2a).

**3. Type consistency:** `buildModuleGraph`→`{graph,modules,degraded,detail}` usato identico in run_cyclecheck (T1) e arch_check (T5). `loadArchContract`→`{layers,forbidden,allow,raw}|null` usato in validate_blueprint (T3), arch_check (T5), checkpoint helper (T6). `evaluateContract`→`{degraded,detail,violations}`; violation `{control_id,from,to,source_module,target_module,path,accepted_exception?}` consumato da `normalizeArch` (T4) con gli stessi nomi-campo. `partitionBlockers` usa `f.fix_state==='accepted-risk'` e `ABSOLUTE_GATE_ORACLES.has('arch')`, coerente con `normalizeArch` (oracle='arch', fix_state override). `graphCapable(manifest.languages)` coerente con `ecosystem.json` (`languages:["js","ts"]`).
