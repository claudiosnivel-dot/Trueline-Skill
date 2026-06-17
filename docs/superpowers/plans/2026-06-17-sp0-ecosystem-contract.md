# SP-0 — Contratto-ecosistema + engine generalizzato — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Metodo del progetto:** ogni task è test-first (il gate scritto PRIMA, `L-COL-019`/`L-COL-027`); il "verde" è un FATTO di un comando (`L-COL-002`); **git solo nell'orchestratore**, merge su `main` human-gated (`L-COL-024`). Branch: `design/ecosystem-extension` (o un `feat/sp0-ecosystem-contract` dedicato).

**Goal:** Rendere l'engine di Trueline guidato da un **manifest di ecosistema** dichiarativo, così che aggiungere uno stack sia "scrivere dati + (dove serve) un oracolo", senza toccare il corpo né la logica — preservando al 100% il comportamento v1 (gate M5 56/56 invariato).

**Architecture:** Un `ecosystem.json` per ecosistema (validato da `validate_ecosystem.mjs`, controlli manuali built-in come `validate_blueprint`) dichiara lingua/backend/`detect`/`triggers`, lega *categoria→oracolo*, nomina dead-code tool e test-runner, marca con `role:"authz-surface"` l'oracolo del modello-autorizzazione-dati, e dichiara `floor`/`verified_set`/`coverage_policy`. Un risolutore (`scripts/ecosystem/resolve.mjs`) classifica il repo→manifest attivo ed espone i binding. Checkpoint, loop, dead-code, test-runner e `SKILL.md` smettono di cablare oracoli/categorie e li chiedono al manifest. Un gate di conformità parametrico (`ecosystem_conformance.mjs <id>`) valida un "ecosystem pack"; `supabase-jsts`, retro-descritto da un manifest, ci passa riproducendo 56/56.

**Tech Stack:** Node ESM, **solo built-in** (nessun npm install, nessuna rete; il dep `pgsql-ast-parser` resta solo dentro `rls_check`). Niente ajv: la validazione è manuale e deterministica (come `validate_blueprint.mjs`). Vocabolario delle categorie = le finding-category di `04` (`secret`,`rls`,`authz`,`injection`,`crypto`,`dependency-vuln`,`dead-code`,…); `authz-surface` è un **ruolo**, non una categoria.

---

## File Structure

**Nuovi:**
- `trueline/references/ecosystems/_schema/ecosystem.schema.json` — il contratto documentato (JSON Schema, riferimento; la validazione eseguibile è in `validate_ecosystem.mjs`).
- `trueline/references/ecosystems/supabase-jsts/ecosystem.json` — manifest retro-descritto del v1 (sposta sotto cartella; `guide.md` = l'attuale `supabase-jsts.md`).
- `trueline/scripts/ecosystem/validate_ecosystem.mjs` — oracolo strutturale del manifest (gemello di `validate_blueprint.mjs`).
- `trueline/scripts/ecosystem/validate_ecosystem.test.mjs` — self-test.
- `trueline/scripts/ecosystem/resolve.mjs` — classificazione repo→manifest attivo + accessor dei binding (sorgente unica).
- `trueline/scripts/ecosystem/resolve.test.mjs` — self-test.
- `eval/harness/ecosystem_conformance.mjs` — gate di conformità parametrico `<id>`.

**Modificati:**
- `trueline/scripts/checkpoint/checkpoint.mjs` — `control2Security` itera i binding del manifest; `detectTestRunner` legge `test_runner.detect`.
- `trueline/scripts/oracles/run_deadcode.mjs` — dispatch al dead-code tool nominato dal manifest (default `knip`).
- `trueline/scripts/loop/run_loop.mjs` — `selectInScope` legge `verified_set` dal manifest.
- `trueline/scripts/characterization/detect_runner.mjs` — runner dal manifest.
- `trueline/scripts/checkpoint/thresholds.mjs` — accessor `verifiedSetFrom(manifest)` / `control2CategoriesFrom(manifest)`; le costanti restano DEFAULT del manifest v1.
- `trueline/SKILL.md` §1–§2 — testo dispatch reso parametrico sull'ecosistema attivo (carica `ecosystems/<attivo>/guide.md`); **resta < 500 righe, zero logica di ecosistema**.
- `trueline/scripts/packaging/package_skill.mjs` — il lint valida ogni manifest e lista ecosistemi/versioni/tier nel manifest del `.skill`.
- `SESSION-STATE.md` + `00-INDEX.md` (ledger) — `L-COL-029`/`L-COL-030`, `O-COL-005` sciolta; note in `02`/`09`/`10`.

**Spostamento (Fase A):** `references/ecosystems/supabase-jsts.md` → `references/ecosystems/supabase-jsts/guide.md`; ogni riferimento nel corpo/altri file aggiornato di conseguenza (il lint di `package_skill` lo verifica).

---

## FASE A — Contratto + validatore + manifest v1

### Task A1: Schema documentato dell'ecosistema

**Files:**
- Create: `trueline/references/ecosystems/_schema/ecosystem.schema.json`

- [ ] **Step 1: Scrivi lo schema** (riferimento/documentazione del contratto; la validazione eseguibile è in A3)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://trueline.dev/schemas/ecosystem.schema.json",
  "title": "Trueline Ecosystem Manifest",
  "description": "Contratto fra l'engine generico e un ecosistema (SP-0). Vocabolario categorie = finding.schema.json. 'authz-surface' e un RUOLO su un binding, non una categoria.",
  "type": "object",
  "additionalProperties": false,
  "required": ["id","version","languages","backend","detect","triggers","oracles","floor","verified_set","coverage_policy"],
  "properties": {
    "id": { "type": "string", "minLength": 1 },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+" },
    "languages": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "backend": { "type": "string", "minLength": 1 },
    "detect": {
      "type": "object", "additionalProperties": false,
      "properties": {
        "files_any": { "type": "array", "items": { "type": "string" } },
        "lang_any": { "type": "array", "items": { "type": "string" } }
      }
    },
    "triggers": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "oracles": {
      "type": "object",
      "description": "Chiave = finding-category (o gruppo 'a|b|c'). Valore = binding.",
      "additionalProperties": {
        "type": "object", "additionalProperties": true,
        "required": ["tool"],
        "properties": {
          "tool": { "type": "string", "minLength": 1 },
          "shared": { "type": "boolean" },
          "role": { "type": "string", "enum": ["authz-surface"] },
          "ruleset": { "type": "string" },
          "lockfiles": { "type": "array", "items": { "type": "string" } },
          "kind": { "type": "string" }
        }
      }
    },
    "test_runner": {
      "type": "object", "additionalProperties": false,
      "properties": { "detect": { "type": "array", "items": { "type": "string" } } }
    },
    "floor": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "verified_set": { "type": "array", "items": { "type": "string" } },
    "coverage_policy": { "type": "string", "enum": ["declared"] }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add trueline/references/ecosystems/_schema/ecosystem.schema.json
git commit -m "feat(sp0): schema documentato del manifest ecosistema"
```

### Task A2: Manifest retro-descritto di `supabase-jsts`

**Files:**
- Create: `trueline/references/ecosystems/supabase-jsts/ecosystem.json`
- Move: `trueline/references/ecosystems/supabase-jsts.md` → `trueline/references/ecosystems/supabase-jsts/guide.md`

- [ ] **Step 1: Sposta la guida** (preserva la prosa esistente)

```bash
git mv trueline/references/ecosystems/supabase-jsts.md trueline/references/ecosystems/supabase-jsts/guide.md
```

- [ ] **Step 2: Scrivi il manifest** (riproduce ESATTAMENTE i binding di oggi)

```json
{
  "id": "supabase-jsts",
  "version": "1.0.0",
  "languages": ["js", "ts"],
  "backend": "supabase-postgres",
  "detect": { "files_any": ["supabase/config.toml"], "lang_any": ["package.json"] },
  "triggers": ["supabase", "rls", "secret", "segret", "blueprint", "audit", "remediat", "bonific", "macrotask", "oracol", "js", "ts", "javascript", "typescript", "sicur", "security"],
  "oracles": {
    "secret":          { "tool": "gitleaks", "shared": true },
    "dependency-vuln": { "tool": "osv", "lockfiles": ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"] },
    "injection":       { "tool": "semgrep", "ruleset": "../oracles/semgrep-ai-ruleset/" },
    "authz":           { "tool": "semgrep", "ruleset": "../oracles/semgrep-ai-ruleset/" },
    "crypto":          { "tool": "semgrep", "ruleset": "../oracles/semgrep-ai-ruleset/" },
    "dead-code":       { "tool": "knip" },
    "rls":             { "tool": "rls_check", "kind": "postgres-rls", "role": "authz-surface" }
  },
  "test_runner": { "detect": ["vitest", "jest", "node:test"] },
  "floor":        ["secret", "dependency-vuln", "rls"],
  "verified_set": ["secret", "rls", "dead-code"],
  "coverage_policy": "declared"
}
```

- [ ] **Step 3: Commit**

```bash
git add trueline/references/ecosystems/supabase-jsts/
git commit -m "feat(sp0): manifest retro-descritto supabase-jsts + sposta guide.md"
```

### Task A3: `validate_ecosystem.mjs` (test-first)

**Files:**
- Create: `trueline/scripts/ecosystem/validate_ecosystem.mjs`
- Test: `trueline/scripts/ecosystem/validate_ecosystem.test.mjs`

- [ ] **Step 1: Scrivi il test (FALLISCE: il modulo non esiste)**

```js
#!/usr/bin/env node
// validate_ecosystem.test.mjs — i 6 controlli del manifest (SP-0).
import { validateEcosystem } from './validate_ecosystem.mjs';

const results = [];
const check = (n, ok, d) => { results.push({ n, ok: Boolean(ok), d }); console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ` — ${d}` : ''}`); };

// manifest valido (mirror di supabase-jsts, ridotto)
const VALID = {
  id: 'x', version: '1.0.0', languages: ['ts'], backend: 'postgres',
  detect: { files_any: ['a'] }, triggers: ['t1', 't2'],
  oracles: {
    secret: { tool: 'gitleaks', shared: true },
    'dependency-vuln': { tool: 'osv' },
    rls: { tool: 'rls_check', role: 'authz-surface' },
    'dead-code': { tool: 'knip' },
  },
  floor: ['secret', 'dependency-vuln', 'rls'],
  verified_set: ['secret', 'rls', 'dead-code'],
  coverage_policy: 'declared',
};
const clone = (o) => JSON.parse(JSON.stringify(o));

check('A valido -> ok', validateEcosystem(VALID).ok);

// (1) campi obbligatori mancanti -> reject
{ const m = clone(VALID); delete m.floor; check('manca floor -> reject', validateEcosystem(m).ok === false); }
// (2) floor non legato a un oracolo -> reject
{ const m = clone(VALID); m.floor = ['secret', 'nonlegata']; check('floor non legato -> reject', validateEcosystem(m).ok === false); }
// (3) nessun role authz-surface -> reject
{ const m = clone(VALID); delete m.oracles.rls.role; check('niente authz-surface -> reject', validateEcosystem(m).ok === false); }
// (3b) due role authz-surface -> reject
{ const m = clone(VALID); m.oracles.secret.role = 'authz-surface'; check('due authz-surface -> reject', validateEcosystem(m).ok === false); }
// (4) verified_set non sottoinsieme dei binding -> reject
{ const m = clone(VALID); m.verified_set = ['secret', 'fantasma']; check('verified_set non-subset -> reject', validateEcosystem(m).ok === false); }
// (5) binding senza tool -> reject
{ const m = clone(VALID); m.oracles.secret = { shared: true }; check('binding senza tool -> reject', validateEcosystem(m).ok === false); }
// (6) coverage_policy fuori dal set chiuso -> reject
{ const m = clone(VALID); m.coverage_policy = 'magic'; check('coverage_policy ignota -> reject', validateEcosystem(m).ok === false); }

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'OK' : 'FAIL'} — ${results.length - failed.length}/${results.length}`);
process.exit(failed.length === 0 ? 0 : 1);
```

- [ ] **Step 2: Esegui per vederlo fallire**

Run: `node trueline/scripts/ecosystem/validate_ecosystem.test.mjs`
Expected: errore di import (modulo inesistente) / FAIL.

- [ ] **Step 3: Implementa `validate_ecosystem.mjs`**

```js
#!/usr/bin/env node
// validate_ecosystem.mjs — oracolo STRUTTURALE del manifest ecosistema (SP-0).
// Gemello di validate_blueprint: controlli manuali built-in, esito binario,
// niente ajv/dipendenze. Il "verde" e un FATTO di comando (L-COL-002).
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED = ['id','version','languages','backend','detect','triggers','oracles','floor','verified_set','coverage_policy'];
const COVERAGE_POLICIES = new Set(['declared']);

const nonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0;
const nonEmptyArr = (v) => Array.isArray(v) && v.length > 0;

export function validateEcosystem(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return { ok: false, errors: ['manifest non è un oggetto'] };

  // (0) campi obbligatori presenti
  for (const k of REQUIRED) {
    const v = m[k];
    const present = (k === 'oracles' || k === 'detect') ? (v && typeof v === 'object')
      : (k === 'languages' || k === 'triggers' || k === 'floor') ? nonEmptyArr(v)
      : (k === 'verified_set') ? Array.isArray(v)
      : nonEmptyStr(v);
    if (!present) errors.push(`campo obbligatorio mancante/vuoto: ${k}`);
  }
  if (errors.length) return { ok: false, errors };

  const oracleKeys = new Set();
  for (const key of Object.keys(m.oracles)) for (const cat of key.split('|')) oracleKeys.add(cat.trim());

  // (5) ogni binding ha un tool non vuoto
  for (const [key, b] of Object.entries(m.oracles)) {
    if (!b || !nonEmptyStr(b.tool)) errors.push(`binding "${key}" senza tool`);
  }
  // (3) esattamente un binding con role: authz-surface
  const roles = Object.values(m.oracles).filter((b) => b && b.role === 'authz-surface');
  if (roles.length !== 1) errors.push(`atteso esattamente 1 binding role:authz-surface, trovati ${roles.length}`);
  // (2) ogni categoria del floor è legata a un oracolo
  for (const c of m.floor) if (!oracleKeys.has(c)) errors.push(`floor: categoria "${c}" non legata a un oracolo`);
  // (4) verified_set ⊆ categorie legate
  for (const c of m.verified_set) if (!oracleKeys.has(c)) errors.push(`verified_set: categoria "${c}" non legata a un oracolo`);
  // (6) coverage_policy nel set chiuso
  if (!COVERAGE_POLICIES.has(m.coverage_policy)) errors.push(`coverage_policy ignota: ${m.coverage_policy}`);

  return { ok: errors.length === 0, errors };
}

// CLI: node validate_ecosystem.mjs <path-a-ecosystem.json> [--json]
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('validate_ecosystem.mjs')) {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const p = args.find((a) => !a.startsWith('--'));
  if (!p || !existsSync(resolve(p))) { console.error('uso: validate_ecosystem.mjs <ecosystem.json>'); process.exit(2); }
  let m = null; try { m = JSON.parse(readFileSync(resolve(p), 'utf8')); } catch (e) { console.error(`JSON invalido: ${e.message}`); process.exit(1); }
  const r = validateEcosystem(m);
  if (jsonMode) console.log(JSON.stringify({ tool: 'validate_ecosystem', path: p, ...r }, null, 2));
  else { console.log(`validate_ecosystem — ${p}`); r.errors.forEach((e) => console.log(`  [FAIL] ${e}`)); console.log(r.ok ? 'RESULT: OK' : 'RESULT: FAIL'); }
  process.exit(r.ok ? 0 : 1);
}
```

- [ ] **Step 4: Esegui il test + valida il manifest reale**

Run: `node trueline/scripts/ecosystem/validate_ecosystem.test.mjs`
Expected: `OK — 9/9`.
Run: `node trueline/scripts/ecosystem/validate_ecosystem.mjs trueline/references/ecosystems/supabase-jsts/ecosystem.json`
Expected: `RESULT: OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add trueline/scripts/ecosystem/validate_ecosystem.mjs trueline/scripts/ecosystem/validate_ecosystem.test.mjs
git commit -m "feat(sp0): validate_ecosystem (6 controlli, test-first) — verde sul manifest supabase-jsts"
```

---

## FASE B — Risolutore (`resolve.mjs`)

### Task B1: classificazione + accessor dei binding (test-first)

**Files:**
- Create: `trueline/scripts/ecosystem/resolve.mjs`
- Test: `trueline/scripts/ecosystem/resolve.test.mjs`

- [ ] **Step 1: Scrivi il test (FALLISCE)**

```js
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
```

- [ ] **Step 2: Esegui per vederlo fallire**

Run: `node trueline/scripts/ecosystem/resolve.test.mjs` → FAIL (modulo inesistente).

- [ ] **Step 3: Implementa `resolve.mjs`**

```js
#!/usr/bin/env node
// resolve.mjs — sorgente unica della risoluzione dell'ecosistema attivo (SP-0).
// Classifica il repo -> manifest attivo (via detect), espone i binding. Nessun
// manifest combacia -> null (la skill dichiara "non supportato", non inventa).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEcosystem } from './validate_ecosystem.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ECO_DIR = resolve(__dirname, '..', '..', 'references', 'ecosystems');

export function loadEcosystems(dir = ECO_DIR) {
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const mf = join(dir, e, 'ecosystem.json');
    if (!existsSync(mf)) continue;
    let m = null;
    try { m = JSON.parse(readFileSync(mf, 'utf8')); } catch { continue; }
    if (validateEcosystem(m).ok) out.push(m);
  }
  return out;
}

export function classify(projectDir, ecosystems = loadEcosystems()) {
  for (const m of ecosystems) {
    const d = m.detect || {};
    const filesOk = (d.files_any || []).some((f) => existsSync(join(projectDir, f)));
    const langOk = (d.lang_any || []).some((f) => existsSync(join(projectDir, f)));
    // detect: combacia se uno dei segnali "files_any" è presente (segnale forte),
    // oppure se NON ci sono files_any ma un lang_any combacia. (Precedenza/ambiguità
    // multi-match: regola dura SKILL.md §1 — proponi+conferma; qui ritorna il primo.)
    if ((d.files_any && d.files_any.length ? filesOk : langOk)) return m.id;
  }
  return null;
}

const keysToCategories = (oracles) => {
  const out = {};
  for (const [key, b] of Object.entries(oracles)) for (const cat of key.split('|')) out[cat.trim()] = b;
  return out;
};
export const oraclesFor = (m) => keysToCategories(m.oracles);
export const deadCodeTool = (m) => (m.oracles['dead-code'] && m.oracles['dead-code'].tool) || null;
export const testRunnerDetect = (m) => (m.test_runner && m.test_runner.detect) || [];
export const verifiedSet = (m) => m.verified_set || [];
export const floorOf = (m) => m.floor || [];
export function authzSurfaceCategory(m) {
  for (const [key, b] of Object.entries(m.oracles)) if (b && b.role === 'authz-surface') return key.split('|')[0].trim();
  return null;
}
export function loadManifest(id) { return loadEcosystems().find((m) => m.id === id) || null; }
```

- [ ] **Step 4: Esegui il test**

Run: `node trueline/scripts/ecosystem/resolve.test.mjs`
Expected: `OK — 9/9`.

- [ ] **Step 5: Commit**

```bash
git add trueline/scripts/ecosystem/resolve.mjs trueline/scripts/ecosystem/resolve.test.mjs
git commit -m "feat(sp0): resolve (classify repo->manifest + accessor binding), test-first"
```

---

## FASE C — Engine generalizzato (ogni task: test-first + retro-compat)

> **Invariante trasversale di fase:** dopo OGNI task, ri-eseguire `m1..m4` + `run_eval` (detection/present) — devono restare **EXIT 0** (DB/docker permettendo). Il comportamento v1 non cambia perché il manifest `supabase-jsts` riproduce i binding cablati.

### Task C1: `thresholds.mjs` — accessor derivati dal manifest

**Files:**
- Modify: `trueline/scripts/checkpoint/thresholds.mjs` (aggiunta, non rimozione)
- Test: `trueline/scripts/checkpoint/thresholds.test.mjs` (Create)

Le costanti `VERIFIED_ZERO_CATEGORIES` / `CONTROL2_GATE_CATEGORIES` restano (sono i DEFAULT del manifest v1). Si aggiungono due funzioni pure che derivano gli stessi insiemi DA un manifest.

- [ ] **Step 1: Scrivi il test (FALLISCE)**

```js
import { verifiedSetFrom, control2CategoriesFrom, VERIFIED_ZERO_CATEGORIES } from './thresholds.mjs';
const m = { verified_set: ['secret','rls','dead-code'], oracles: { secret:{tool:'gitleaks'}, rls:{tool:'rls_check',role:'authz-surface'}, injection:{tool:'semgrep'}, authz:{tool:'semgrep'}, 'dead-code':{tool:'knip'} } };
const eq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
let ok = true;
// verifiedSetFrom riproduce il default v1
ok = eq(verifiedSetFrom(m), VERIFIED_ZERO_CATEGORIES) && ok;
// control2CategoriesFrom = verified_set "gate-abili" + injection/authz legati
ok = control2CategoriesFrom(m).has('injection') && control2CategoriesFrom(m).has('rls') && ok;
console.log(ok ? 'OK' : 'FAIL'); process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Esegui → FAIL** (`node trueline/scripts/checkpoint/thresholds.test.mjs`).

- [ ] **Step 3: Implementa** — aggiungi a `thresholds.mjs`:

```js
// Deriva da un manifest (SP-0): le categorie che il loop può portare a verified.
export function verifiedSetFrom(manifest) {
  return new Set((manifest && manifest.verified_set) || [...VERIFIED_ZERO_CATEGORIES]);
}
// Categorie che bloccano il controllo 2: verified_set "di sicurezza" (secret/rls)
// + le detection-blocking injection/authz SE legate nel manifest. Default = costante.
export function control2CategoriesFrom(manifest) {
  if (!manifest || !manifest.oracles) return new Set(CONTROL2_GATE_CATEGORIES);
  const cats = new Set();
  for (const key of Object.keys(manifest.oracles)) for (const c of key.split('|')) cats.add(c.trim());
  // mantieni solo le categorie "di sicurezza" gate-abili (no dead-code/dependency-vuln-here)
  return new Set([...cats].filter((c) => CONTROL2_GATE_CATEGORIES.has(c)));
}
```

- [ ] **Step 4: Esegui test + `node trueline/scripts/checkpoint/thresholds.mjs` (resta valido)** → OK.
- [ ] **Step 5: Commit** `feat(sp0): thresholds — accessor verifiedSetFrom/control2CategoriesFrom (default = v1)`.

### Task C2: `control2Security` itera i binding del manifest

**Files:**
- Modify: `trueline/scripts/checkpoint/checkpoint.mjs:138-219` (`control2Security`)
- Test: estendere `eval/harness/m1_gate_check.mjs` non serve — il gate di conformità (Fase D) è la rete. Aggiungere un micro-test mirato `trueline/scripts/checkpoint/control2.test.mjs`.

**Scope del cambiamento:** oggi `control2Security` cabla gitleaks+rls_check+osv+semgrep e usa `CONTROL2_GATE_CATEGORIES`. Renderlo guidato da un `manifest` opzionale: per ogni binding in `manifest.oracles`, esegui l'oracolo *nominato* (mappa tool→wrapper: `gitleaks→run_gitleaks`, `rls_check→rls_check`, `osv→run_osv`, `semgrep→run_semgrep`), normalizza, e usa `control2CategoriesFrom(manifest)`. **Senza `manifest` (chiamata legacy) il comportamento è IDENTICO a oggi** (default = supabase-jsts cablato).

- [ ] **Step 1: Scrivi il test mirato (FALLISCE finché control2 non accetta `manifest`)**

```js
import { control2Security } from './checkpoint.mjs';
import { loadManifest } from '../ecosystem/resolve.mjs';
import { resolve, dirname } from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..','..','..');
const REF = resolve(ROOT, 'eval', 'reference-app');
const m = loadManifest('supabase-jsts');
const withM = control2Security(REF, { runOpts: { runId: 't', createdAt: '1970-01-01T00:00:00.000Z' }, manifest: m, withOsv: false });
const without = control2Security(REF, { runOpts: { runId: 't', createdAt: '1970-01-01T00:00:00.000Z' }, withOsv: false });
// stesso numero di finding di sicurezza (manifest riproduce il cablato)
const ok = withM.findings.length === without.findings.length;
console.log(ok ? 'OK' : `FAIL ${withM.findings.length} vs ${without.findings.length}`); process.exit(ok ? 0 : 1);
```

- [ ] **Step 2: Esegui → FAIL** (l'opzione `manifest` non è ancora usata; può passare per caso → in tal caso forza un assert sul fatto che con `manifest` di test ridotto i finding cambino). Verifica che senza modifica il test non sia tautologico.

- [ ] **Step 3: Implementa** — in `control2Security(referenceApp, { baseline, runOpts, withOsv, manifest = null })`:
  - se `manifest`: costruisci la lista oracoli da `manifest.oracles` (dedup per tool), mappando tool→wrapper noto; salta i tool sconosciuti **dichiarando** (mai falso verde); usa `gateCategories = control2CategoriesFrom(manifest)` in `deltaBlockers`.
  - se `manifest` nullo: ramo attuale invariato (gitleaks+rls+osv+semgrep, `CONTROL2_GATE_CATEGORIES`).
  - `runCheckpoint(...)` passa `manifest` (default: `resolve.classify` sul referenceApp, fallback null) a `control2Security`.

- [ ] **Step 4: Esegui** il micro-test + `m1_gate_check.mjs` + `m3_gate_check.mjs` (DB up) → tutti EXIT 0 / OK.
- [ ] **Step 5: Commit** `feat(sp0): control2Security guidato dai binding del manifest (default invariato)`.

### Task C3: `run_deadcode.mjs` — dispatch al tool del manifest

**Files:**
- Modify: `trueline/scripts/oracles/run_deadcode.mjs`
- Test: `trueline/scripts/oracles/run_deadcode.test.mjs` (Create)

**Scope:** oggi invoca `knip`. Aggiungere un dispatch: accetta un secondo arg/flag `--tool=<nome>` (default `knip`); per `knip` il comportamento è invariato; per un tool sconosciuto, esce con un finding-set vuoto + nota "tool non supportato" (mai falso verde; il gate di conformità lo coglie). I tool concreti aggiuntivi (es. `vulture`) sono SP-2, NON qui.

- [ ] **Step 1: Test (FALLISCE)** — invoca `run_deadcode.mjs <reference-app>` e asserisce che con default knip i finding includano `unused.ts` (come oggi); con `--tool=__nope__` l'output sia JSON valido con 0 risultati + nota.
- [ ] **Step 2: Esegui → FAIL.**
- [ ] **Step 3: Implementa** il dispatch `--tool=` (knip invariato; ignoto→vuoto+nota dichiarata).
- [ ] **Step 4: Esegui test + `m1_gate_check.mjs`** → OK.
- [ ] **Step 5: Commit** `feat(sp0): run_deadcode dispatch per tool (default knip invariato)`.

### Task C4: `run_loop.selectInScope` legge `verified_set`

**Files:**
- Modify: `trueline/scripts/loop/run_loop.mjs` (`selectInScope`, ~177-201)
- Test: `trueline/scripts/loop/selectinscope.test.mjs` (Create)

**Scope:** oggi `selectInScope` ammette le categorie cablate `{rls, dead-code, secret}`. Renderlo: `const inScope = verifiedSetFrom(manifest)` (default = stessa costante). `run_loop` risolve il manifest attivo (`classify(referenceApp)` → `loadManifest`) e lo passa.

- [ ] **Step 1: Test (FALLISCE)** — `selectInScope(findings, manifest)` con `verified_set:['secret']` ammette solo secret; senza manifest ammette `{secret,rls,dead-code}` (default).
- [ ] **Step 2: Esegui → FAIL.**
- [ ] **Step 3: Implementa** — `selectInScope(findings, manifest = null)` usa `verifiedSetFrom(manifest)`.
- [ ] **Step 4: Esegui test + `m1`/`m3` gate** → OK (verified_set v1 invariato → stesso comportamento).
- [ ] **Step 5: Commit** `feat(sp0): selectInScope da verified_set del manifest (default invariato)`.

### Task C5: test-runner dal manifest

**Files:**
- Modify: `trueline/scripts/characterization/detect_runner.mjs` e `trueline/scripts/checkpoint/checkpoint.mjs:411-420` (`detectTestRunner`)
- Test: `trueline/scripts/characterization/detect_runner.test.mjs` (Create)

**Scope:** la rilevazione del runner accetta `manifest.test_runner.detect` come lista di candidati; default = comportamento attuale (script `test` nel package.json). Niente regressione: con `supabase-jsts` la detection resta quella di oggi.

- [ ] **Step 1–5:** test-first (un repo con `package.json` scripts.test → present; lista candidati dal manifest usata per arricchire), implementa, esegui `m1`/`m3`, commit `feat(sp0): test-runner detect dal manifest (default invariato)`.

### Task C6: `SKILL.md` §1–§2 — dispatch parametrico (corpo generico)

**Files:**
- Modify: `trueline/SKILL.md` §1 (risoluzione-intento) e §2 (tabella dispatch)

**Scope:** sostituire i riferimenti cablati "`supabase-jsts.md`" con "l'ecosistema attivo": §2 carica `references/ecosystems/<attivo>/guide.md` (risolto da `scripts/ecosystem/resolve.mjs`); §1 dice che la classificazione dell'ecosistema usa i `detect`/`triggers` dei manifest. **Vincoli:** < 500 righe; nessun nome di ecosistema concreto nel corpo se non come esempio; ogni riferimento risolve (lo prova il lint di `package_skill`, Fase E).

- [ ] **Step 1:** aggiorna §2 riga `references/ecosystems/supabase-jsts.md` → `references/ecosystems/<attivo>/guide.md` + nota "risolto da scripts/ecosystem/resolve.mjs".
- [ ] **Step 2:** aggiorna §1 (classificazione ecosistema via manifest `detect`/`triggers`).
- [ ] **Step 3:** `node trueline/scripts/packaging/package_skill.mjs --no-archive` → lint VERDE, SKILL.md < 500 righe, 0 orfani.
- [ ] **Step 4: Commit** `feat(sp0): SKILL.md dispatch parametrico sull'ecosistema attivo (corpo generico)`.

---

## FASE D — Gate di conformità

### Task D1: `ecosystem_conformance.mjs <id>` parametrico

**Files:**
- Create: `eval/harness/ecosystem_conformance.mjs`

**Scope:** harness che, dato un `<id>`, risolve il manifest, individua la fixture del pack (`eval/ecosystems/<id>/` per i pack nuovi; per `supabase-jsts` la fixture è l'attuale `eval/reference-app` + `eval/seeded-blueprint`), ed esegue i criteri della §5.4 dello spec:
1. **Manifest valido** (`validate_ecosystem`).
2. **DETECTION parity**: ogni difetto seminato del `floor` colto dall'oracolo legato.
3. **VERIFIED parity** (solo `verified_set`): raggiungono `verified`; non-`verified_set` mai auto-promosse.
4. **BUILD parity** (se l'ecosistema supporta BOOTSTRAP/BUILD): `validate_blueprint` + checkpoint + git-a-strati (logica esistente).
5. **TRIGGERING**: `triggers`/`detect` del manifest scattano sui positivi, non sui negativi.
6. **Igiene/no-regressione** (fixture bit-identica, no residuo temp, 0 contaminazione).

- [ ] **Step 1:** Scrivi l'harness con la struttura sopra; per `supabase-jsts` **delega** al gate esistente `m5_gate_check.mjs` (che già implementa A/B/C/D/E) — `ecosystem_conformance.mjs supabase-jsts` lancia `m5_gate_check.mjs` e propaga l'exit code, AGGIUNGENDO la verifica `validate_ecosystem` sul manifest. (Per i pack nuovi, SP-1 fornirà il corpo detection-parametrico; SP-0 si ferma a `supabase-jsts`.)
- [ ] **Step 2:** Run `node eval/harness/ecosystem_conformance.mjs supabase-jsts` (DB up + semgrep) → **PASS, exit 0**, e nel log compare il check `manifest valido (validate_ecosystem)`.
- [ ] **Step 3: Commit** `feat(sp0): ecosystem_conformance.mjs <id> (supabase-jsts delega a m5 + valida il manifest)`.

### Task D2: prova di retro-compatibilità 56/56

**Files:** nessuno (verifica)

- [ ] **Step 1:** Run `node eval/harness/m5_gate_check.mjs` → **56/56, exit 0** (invariato dopo Fase C).
- [ ] **Step 2:** Run `node eval/harness/ecosystem_conformance.mjs supabase-jsts` → PASS (56/56 + manifest valido).
- [ ] **Step 3:** Run k=2 (due esecuzioni) per stabilità; nessun residuo temp; fixture bit-identica.

---

## FASE E — Packaging + ledger + stato

### Task E1: `package_skill` valida i manifest + manifest del `.skill`

**Files:**
- Modify: `trueline/scripts/packaging/package_skill.mjs`

**Scope:** il lint strutturale (i) valida ogni `references/ecosystems/<id>/ecosystem.json` con `validateEcosystem` (rosso → pacchetto non emesso); (ii) il blocco `ecosystems` del manifest elenca per ogni id `{version, tier}` dove `tier = "verified" se verified_set≠∅ altrimenti "detection"`.

- [ ] **Step 1: Test** — un manifest deliberatamente rotto (es. `floor` non legato) fa **fallire** il lint (falsificabilità, come `--inject-missing-ref`). Aggiungi al gate M5 sezione C un check analogo, oppure un mini-test `package_ecosystem.test.mjs`.
- [ ] **Step 2: Esegui → FAIL.** **Step 3: Implementa.** **Step 4:** `package_skill.mjs --no-archive` → lint VERDE, manifest elenca `supabase-jsts v1.0.0 (verified)`. **Step 5: Commit** `feat(sp0): package_skill valida i manifest + tier nel manifest del .skill`.

### Task E2: ledger + SESSION-STATE + note di modulo

**Files:**
- Modify: `00-INDEX.md` (ledger §4–§5), `SESSION-STATE.md`, note in `02`/`09`/`10`.

- [ ] **Step 1:** Ledger: chiudi `O-COL-005` (Trueline multi-ecosistema); aggiungi `L-COL-029` (engine manifest-driven, corpo senza logica di ecosistema) e `L-COL-030` (barra B: floor detection + coverage dichiarata + verified come fase 2).
- [ ] **Step 2:** `SESSION-STATE`: nuova voce SP-0 (engine generalizzato, `supabase-jsts` 56/56 via gate generalizzato, validate_ecosystem/resolve/conformance verdi).
- [ ] **Step 3:** Note brevi in `02` §4 (l'ecosistema è una cartella con manifest), `09` §4 (tier nel manifest), `10` (gate parametrico per ecosistema).
- [ ] **Step 4: Commit** `docs(sp0): ledger (O-COL-005 sciolta, L-COL-029/030) + SESSION-STATE + note 02/09/10`.

---

## Definizione di "fatto" (SP-0)

- `validate_ecosystem` + `resolve` + i loro test verdi; manifest `supabase-jsts` valido.
- Engine guidato dal manifest in tutti i punti (checkpoint c2, dead-code, selectInScope, test-runner, SKILL.md dispatch).
- `ecosystem_conformance.mjs supabase-jsts` PASS; `m5_gate_check.mjs` **56/56 invariato**; `m1..m4` + `run_eval` EXIT 0.
- `package_skill` valida i manifest (lint falsificabile) ed espone i tier.
- Ledger aggiornato (`O-COL-005` sciolta, `L-COL-029/030`).
- **Niente ecosistema nuovo** (quello è SP-1).

## Self-review del piano

- **Copertura spec:** §5.1 contratto→A1/A2; §5.2 engine→C1–C6+B1; §5.3 floor/coverage→A3(validatore)+C1/C4; §5.4 gate→D1/D2; §5.5 versioning/packaging/ledger→E1/E2; §6 confini→"niente ecosistema nuovo"; §7 acceptance→"Definizione di fatto"; §8 SP-1/2 fuori scope (corretto). ✔
- **Placeholder:** i task C3/C5 usano riassunti di step (1–5) ma con scope+gate concreti; il codice completo dei moduli nuovi (A1/A3/B1) e i test sono inline. I task di MODIFICA danno il test (gate) + lo scope esatto + le righe del file; l'esecutore (subagent) legge il file e implementa per far passare il test — coerente col metodo del progetto (builder legge ed esegue contro il gate).
- **Coerenza dei tipi:** `validateEcosystem(m)→{ok,errors}` usato in resolve/package; `verifiedSetFrom(m)→Set`, `control2CategoriesFrom(m)→Set`; `authzSurfaceCategory(m)→string`; `classify(dir)→id|null`. Nomi coerenti fra i task. ✔
