# SP-8 — `firebase-jsts` → tier VERIFIED (secret + dead-code + authz Firestore) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: si **costruisce via Dynamic Workflow** (`L-COL-027`, `DYNAMIC-WORKFLOWS.md`) — mappa ondate in **§Esecuzione**. **Git è SOLO dell'orchestratore** (`L-COL-024`): gli agenti scrivono file, **mai** `git`. Lo step "Commit" è dell'orchestratore dopo il verde del gate del task.

**Goal:** Promuovere l'ecosistema `firebase-jsts` da **detection** a **verified** con `verified_set=[secret, dead-code, authz]`, dove il loop di fix porta a `verified` il segreto FB-S1 (`serviceAccount.json`), il dead-code FB-S5 (`unusedHelper`) e — **prima authz dichiarativa verificata** — la regola Firestore FB-S3 (`allow: if true` → owner-scoped), provata dall'oracolo **statico** `firestore_rules_check` ri-eseguito **pulito**.

**Architecture:** La criterion 3 del gate (`ecosystem_conformance.mjs::runVerifiedBody`) è uno **state-machine generico** (itera `verified_set` → loop col fix-provider → asserisce `fix_state == expected`); l'unico ramo categoria-specifico è il rinforzo RLS-runtime, **gated da `vset.includes('rls')`** → firebase (senza `rls`) lo salta, niente Docker/DB. Si aggiungono **4 armi di dispatch additive** (fix-provider authz+secret-fb, loop `rerunOracleFor` authz, gate `collectFindingsForLoop`/`pickSeedFinding` authz) + il dispatch del loop spedito (`run_loop` collect/scope) + i dati (manifest/registry). La prova authz = oracolo **statico** ri-eseguito pulito (emulatore Firestore non fattibile: JDK 8, no firebase-tools — **scoping onesto `L-COL-006`**: controllo statico pulito, NON invarianza runtime).

**Tech Stack:** Node.js ESM, solo built-in (+ moduli `trueline/scripts/*`). Oracoli: `firestore_rules_check.mjs` (built-in custom), gitleaks (go-bin), knip (npm). `node --test` per il GUARD.

## Global Constraints

- **Solo built-in** (+ moduli `trueline/scripts/*` dep-free). Nessun `npm install` di rete nel codice spedito.
- **Determinismo (`L-COL-002`):** nessun `Date.now()`/`Math.random()`; ordine stabile.
- **BIT-invarianza (cardine):** ogni cambio è **additivo**, guardato su `cat==='authz'` o `serviceAccount.json`/`firestore.rules`. I rami secret/rls/dead-code JS/Python **invariati** → `m5` **56/56** + `ecosystem_conformance` {supabase-jsts/py, postgres-jsts/py} + `build_discipline_check` 21/21 + `anti_tamper_check` 49/49 **invariati**.
- **Oracle-as-judge (`L-COL-002`):** `verified` = FATTO dell'oracolo ri-eseguito (gitleaks WT pulito / knip pulito / **firestore_rules_check pulito**), MAI una frase LLM.
- **Niente promozione senza prova (`L-COL-030` fase 2):** ogni categoria del `verified_set` ha la sua prova nel loop.
- **Scoping onesto authz (`L-COL-006`):** authz-verified = **`firestore_rules_check` statico ri-eseguito pulito** (la regola testuale non concede più `if true`), **NON** invarianza d'isolamento a runtime (emulatore non disponibile — gap dichiarato in manifest+ledger, come la modalità *degraded* di `rls_characterize`).
- **Git solo nell'orchestratore (`L-COL-024`):** merge `main` **human-gated**.
- **Lingua:** prosa/commenti in italiano; identificatori/`name`/chiavi-schema in inglese.
- **Branch:** `feat/sp8-firebase-jsts-verified` (già creato da `main` @ `c7c3f68`).

---

## File Structure

| File | Responsabilità | Task |
|---|---|---|
| `trueline/scripts/loop/fix_provider.mjs` | **Modify** — `fixFirestoreRules` (authz) + `fixSecretFbS1` (secret JSON) + 2 rami in `selectKnownFix` + resolver | 1 |
| `trueline/scripts/loop/fix_provider.test.mjs` | **Create** (o estendi) — unit test dei 2 fix nuovi | 1 |
| `trueline/scripts/loop/loop.mjs` | **Modify** — `rerunOracleFor` `case 'authz'` + const `FIRESTORE_RULES_CHECK` | 2 |
| `trueline/scripts/loop/loop.trace.test.mjs` | **Create** — unit test `rerunOracleFor('authz')` | 2 |
| `trueline/scripts/loop/run_loop.mjs` | **Modify** — `collectFindings` (+firestore) + `selectInScope` (+authz gate) | 3 |
| `eval/harness/ecosystem_conformance.mjs` | **Modify** — `PACK_FIXTURES.firebase-jsts.kind`→verified + `collectFindingsForLoop`/`pickSeedFinding` authz | 4 |
| `trueline/references/ecosystems/firebase-jsts/ecosystem.json` | **Modify** — `verified_set` + version 1.1.0 + nota scope statico | 5 |
| `eval/ecosystems/firebase-jsts/registry.json` | **Modify** — `verified_set` + flip FB-S1/S5/S3 → verified | 5 |
| `eval/ecosystems/firebase-jsts/reference-app/tests/characterization.test.mjs` | **Create** — GUARD `node --test` (importa solo `dead.ts`) | 6 |
| `eval/ecosystems/firebase-jsts/verify_fix_check.mjs` | **Create** — gate VERIFY (mirror `postgres-jsts`) | 7 |
| `00-INDEX.md` · `SESSION-STATE.md` | **Modify** — nota SP-8 + scope onesto authz | 8 (orchestratore) |

> **DAG reale:** l'oracolo `firestore_rules_check.mjs` e `normalize.mjs` (ramo `firestore-rules`→`authz`, CWE-862) **esistono già** (SP-5). Le armi di dispatch (T1–T4) e i dati (T5) sono indipendenti per file; il GATE pieno (`ecosystem_conformance firebase-jsts` VERIFIED) li integra ed è il T-final dell'orchestratore.

---

## Task 1: `fix_provider.mjs` — fix authz Firestore + fix secret `serviceAccount.json`

**Files:**
- Modify: `trueline/scripts/loop/fix_provider.mjs` (resolver dopo `resolveTsFileInCopy` r.448; 2 funzioni nuove; 2 rami in `selectKnownFix` r.462–561)
- Test: `trueline/scripts/loop/fix_provider.test.mjs`

**Interfaces:**
- Consumes: `firestore_rules_check.mjs` (oracolo, ri-eseguito dal test per provare pulizia), `run_gitleaks.mjs`.
- Produces: `selectKnownFix(finding)` ritorna, per `cat==='authz'` su `firestore.rules`, `{kind:'authz', apply: fixFirestoreRules, signature}`; per `cat==='secret'` su `serviceAccount.json`, `{kind:'secret', apply: fixSecretFbS1, signature}`. `fixFirestoreRules(dir, finding) -> {ok, detail}`, `fixSecretFbS1(dir, finding) -> {ok, detail}`.

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `trueline/scripts/loop/fix_provider.test.mjs`:
```js
// fix_provider.test.mjs — unit test dei fix NUOVI di SP-8 (authz Firestore + secret JSON).
// Verifica su FATTI (L-COL-002): dopo il fix, l'oracolo LEGATO ri-eseguito e' PULITO.
// Solo built-in; temp pid-named sotto eval/.tmp-sp8-unit-<pid> (gitignorata).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deterministicFixProvider } from './fix_provider.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const FIRESTORE = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'firestore_rules_check.mjs');
const GITLEAKS = resolve(ROOT, 'trueline', 'scripts', 'oracles', 'run_gitleaks.mjs');
const GO_BIN = process.platform === 'win32' ? 'C:/Users/claud/go/bin' : '/c/Users/claud/go/bin';
const TMP = join(ROOT, 'eval', `.tmp-sp8-unit-${process.pid}`);
const env = { ...process.env, PATH: `${process.env.PATH || ''}${delimiter}${GO_BIN}` };

function fresh() { rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true }); }
function runJson(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: TMP, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse((r.stdout || '').trim()); } catch { return null; }
}

const VULN_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /public_notes/{noteId} {
      // SEED:FB-S3
      allow read, write: if true;
    }
  }
}
`;

test('authz: fixFirestoreRules rende firestore_rules_check PULITO (if true -> owner-scoped)', () => {
  fresh();
  writeFileSync(join(TMP, 'firestore.rules'), VULN_RULES);
  const before = runJson(FIRESTORE, [TMP]);
  assert.ok(before && before.findings.length >= 1, 'prima del fix: >=1 finding FIRESTORE001');
  const finding = {
    category: 'authz', fingerprint: 'a'.repeat(64),
    location: { file: 'firestore.rules', symbol: '/databases/{database}/documents/public_notes/{noteId}' },
    source_oracle: { rule_id: 'FIRESTORE001_PUBLIC_ALLOW' },
  };
  const patch = deterministicFixProvider().propose(finding, 1);
  assert.ok(patch && patch.kind === 'authz', 'patch authz proposta');
  const res = patch.apply(TMP);
  assert.equal(res.ok, true, res.detail);
  const after = runJson(FIRESTORE, [TMP]);
  assert.equal(after.findings.length, 0, 'dopo il fix: 0 finding (oracolo pulito)');
});

test('secret: fixSecretFbS1 neutralizza il segreto in serviceAccount.json (gitleaks WT pulito)', () => {
  fresh();
  // service-account con private_key PEM (forma che gitleaks coglie).
  const sa = { type: 'service_account', project_id: 'p',
    private_key_id: 'kid',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBgkq=\n-----END PRIVATE KEY-----\n',
    client_email: 'x@p.iam.gserviceaccount.com' };
  writeFileSync(join(TMP, 'serviceAccount.json'), JSON.stringify(sa, null, 2));
  const finding = {
    category: 'secret', fingerprint: 'b'.repeat(64), _scope: 'working-tree',
    location: { file: 'serviceAccount.json' }, source_oracle: { rule_id: 'private-key' },
  };
  const patch = deterministicFixProvider().propose(finding, 1);
  assert.ok(patch && patch.kind === 'secret', 'patch secret proposta');
  const res = patch.apply(TMP);
  assert.equal(res.ok, true, res.detail);
  const txt = readFileSync(join(TMP, 'serviceAccount.json'), 'utf8');
  assert.doesNotMatch(txt, /BEGIN PRIVATE KEY/, 'il PEM e\' stato neutralizzato');
});

test('BIT-invarianza: un finding rls/secret-config esistente NON e\' deviato dai rami nuovi', () => {
  // cat secret su src/config.ts deve restare sul ramo fixSecretPgS1 (signature nota).
  const finding = { category: 'secret', fingerprint: 'c'.repeat(64), _scope: 'working-tree',
    location: { file: 'src/config.ts' }, source_oracle: { rule_id: 'generic' } };
  const patch = deterministicFixProvider().propose(finding, 1);
  assert.ok(patch && /fix-pg-s1-env-config-ts/.test(patch.signature), 'ramo config.ts invariato');
});

test.after(() => { rmSync(TMP, { recursive: true, force: true }); });
```

- [ ] **Step 2: Esegui — deve FALLIRE**

Run: `node --test trueline/scripts/loop/fix_provider.test.mjs`
Expected: FAIL — `propose` ritorna `null` per `authz` e per `serviceAccount.json` (rami non ancora aggiunti).

- [ ] **Step 3: Implementa i 2 fix + il resolver + i 2 rami**

In `trueline/scripts/loop/fix_provider.mjs`, **dopo** `resolveTsFileInCopy` (r.448) aggiungi:
```js
// Risolve firestore.rules (di solito alla radice della copia) — mai fuori dalla copia.
function resolveFirestoreFileInCopy(dir, rel) {
  const norm = String(rel || 'firestore.rules').replace(/\\/g, '/');
  const m = /(?:^|\/)([^/]*firestore\.rules)$/.exec(norm);
  const cand = resolve(dir, m ? m[1] : 'firestore.rules');
  if (existsSync(cand)) return cand;
  const direct = resolve(dir, norm);
  return existsSync(direct) ? direct : null;
}

// FB-S3 (authz Firestore): riscrive `allow ...: if true;` in regola OWNER-SCOPED.
// firestore_rules_check considera PULITA una condizione non-literal-true che contiene
// un OWNER_COMPARISON_TOKEN ('resource.data' / 'request.auth.uid ==') — analogo
// dichiarativo del transfer RLS (USING(true)->auth.uid()). Tollera `if true` e `if (true)`.
function fixFirestoreRules(dir, finding) {
  const rel = (finding && finding.location && finding.location.file) || 'firestore.rules';
  const p = resolveFirestoreFileInCopy(dir, rel);
  if (!p) return { ok: false, detail: `FB-S3: firestore.rules non risolto (${rel})` };
  const src = readFileSync(p, 'utf8');
  const re = /(allow\s+[\w,\s]+:\s*if\s+)\(?\s*true\s*\)?(\s*;)/;
  if (!re.test(src)) return { ok: false, detail: 'FB-S3: "allow ...: if true;" non trovato' };
  const after = src.replace(re, '$1request.auth != null && request.auth.uid == resource.data.ownerId$2  // FIX:FB-S3');
  if (after === src) return { ok: false, detail: 'FB-S3: nessuna modifica applicata' };
  writeFileSync(p, after, 'utf8');
  return { ok: true, detail: 'FB-S3: allow if true -> owner-scoped (resource.data.ownerId)' };
}

// FB-S1 (secret in serviceAccount.json): NEUTRALIZZA il valore private_key (il segreto
// committato) con un placeholder non-segreto, cosi' gitleaks working-tree e' pulito.
// Mantiene il file (struttura JSON intatta) -> nessun side-effect su knip/altri oracoli.
function fixSecretFbS1(dir, finding) {
  const rel = (finding && finding.location && finding.location.file) || 'serviceAccount.json';
  const norm = String(rel).replace(/\\/g, '/');
  const m = /(?:^|\/)([^/]*serviceAccount\.json)$/.exec(norm);
  const p = (() => {
    const cand = resolve(dir, m ? m[1] : 'serviceAccount.json');
    if (existsSync(cand)) return cand;
    const direct = resolve(dir, norm);
    return existsSync(direct) ? direct : null;
  })();
  if (!p) return { ok: false, detail: `FB-S1: serviceAccount.json non risolto (${rel})` };
  const src = readFileSync(p, 'utf8');
  // Sostituisce il valore di "private_key": "...PEM..." con "" (placeholder; il segreto
  // reale va in FIREBASE_PRIVATE_KEY / secret-manager — il file committato resta template).
  const after = src.replace(/("private_key"\s*:\s*)"(?:[^"\\]|\\.)*"/, '$1""');
  if (after === src) return { ok: false, detail: 'FB-S1: campo private_key non trovato' };
  writeFileSync(p, after, 'utf8');
  return { ok: true, detail: 'FB-S1: private_key neutralizzata (placeholder; leggere da env)' };
}
```

In `selectKnownFix`, **prima** del ramo `if (cat === 'secret' && isPy)` (r.506) — così precede e non interferisce coi rami config.ts — aggiungi il ramo authz e il ramo secret-firebase:
```js
  // --- RAMO AUTHZ FIRESTORE (SP-8, additivo) --------------------------------
  if (cat === 'authz' && /firestore\.rules$/.test(file)) {
    const mp = (finding.location && finding.location.symbol) || '';
    return { kind: 'authz', apply: fixFirestoreRules, signature: `fix-fb-s3-owner-scope:${mp}` };
  }
  // --- RAMO SECRET FIREBASE serviceAccount.json (SP-8, additivo) -------------
  // Precede i rami config.ts: il path serviceAccount.json e' disgiunto -> non interferisce.
  if (cat === 'secret' && /serviceAccount\.json$/.test(file)) {
    return { kind: 'secret', apply: fixSecretFbS1, signature: 'fix-fb-s1-neutralize-service-account' };
  }
```

- [ ] **Step 4: Esegui — deve PASSARE**

Run: `node --test trueline/scripts/loop/fix_provider.test.mjs`
Expected: PASS — 4/4 (authz pulito, secret neutralizzato, BIT-invarianza config.ts).

- [ ] **Step 5: Commit (ORCHESTRATORE)**
```bash
git add trueline/scripts/loop/fix_provider.mjs trueline/scripts/loop/fix_provider.test.mjs
git commit -m "feat(sp8): fix-provider authz Firestore (if true->owner-scoped) + secret serviceAccount.json"
```

---

## Task 2: `loop.mjs` — `rerunOracleFor` `case 'authz'`

**Files:**
- Modify: `trueline/scripts/loop/loop.mjs` (const ~r.43; switch r.69–104)
- Test: `trueline/scripts/loop/loop.trace.test.mjs`

**Interfaces:**
- Consumes: `firestore_rules_check.mjs`, `normalize('firestore-rules', …)`.
- Produces: `rerunOracleFor(finding, dir, runOpts)` per `finding.category==='authz'` ritorna `{ok, findings, scope:'working-tree'}` coi finding firestore normalizzati (category `authz`).

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `trueline/scripts/loop/loop.trace.test.mjs`:
```js
// loop.trace.test.mjs — rerunOracleFor sa rieseguire l'oracolo authz Firestore (SP-8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rerunOracleFor } from './loop.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..');
const TMP = join(ROOT, 'eval', `.tmp-sp8-loop-${process.pid}`);

test('rerunOracleFor(authz) ri-esegue firestore_rules_check e ritorna finding authz', () => {
  rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, 'firestore.rules'),
    "service cloud.firestore { match /databases/{db}/documents { match /n/{id} { allow read: if true; } } }\n");
  const finding = { category: 'authz', location: { file: 'firestore.rules' }, source_oracle: { rule_id: 'FIRESTORE001_PUBLIC_ALLOW' } };
  const r = rerunOracleFor(finding, TMP, {});
  assert.equal(r.ok, true, r.detail);
  assert.ok(r.findings.some((f) => f.category === 'authz'), 'almeno un finding authz');
  rmSync(TMP, { recursive: true, force: true });
});

test('rerunOracleFor(authz) su regola owner-scoped → 0 finding (pulito)', () => {
  rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
  writeFileSync(join(TMP, 'firestore.rules'),
    "service cloud.firestore { match /databases/{db}/documents { match /n/{id} { allow read: if request.auth != null && request.auth.uid == resource.data.ownerId; } } }\n");
  const finding = { category: 'authz', location: { file: 'firestore.rules' }, source_oracle: { rule_id: 'FIRESTORE001_PUBLIC_ALLOW' } };
  const r = rerunOracleFor(finding, TMP, {});
  assert.equal(r.ok, true, r.detail);
  assert.equal(r.findings.length, 0, 'regola owner-scoped → nessun finding');
  rmSync(TMP, { recursive: true, force: true });
});
```
> **Nota:** se `rerunOracleFor` non è esportata, aggiungi `export` alla sua dichiarazione (r.51) — è additivo e non altera il comportamento.

- [ ] **Step 2: Esegui — deve FALLIRE**

Run: `node --test trueline/scripts/loop/loop.trace.test.mjs`
Expected: FAIL — `categoria non rieseguibile: authz` (default del switch) → `r.ok===false`.

- [ ] **Step 3: Implementa il `case 'authz'`**

In `loop.mjs`, dopo `const RUN_DEADCODE = …` (r.43) aggiungi:
```js
const FIRESTORE_RULES_CHECK = resolve(ORACLES, 'firestore_rules_check.mjs');
```
Nel `switch (finding.category)`, **prima** del `default:` (r.102) aggiungi:
```js
    case 'authz':
      // SP-8: authz dichiarativa Firestore. L'oracolo cammina `dir` per firestore.rules
      // ed emette {findings:[...]} (category 'authz'). Prova STATICA (no runtime).
      oracle = 'firestore-rules'; scope = 'working-tree';
      res = run(FIRESTORE_RULES_CHECK, [dir]);
      break;
```
(assicura `export function rerunOracleFor` a r.51 se non già esportata.)

- [ ] **Step 4: Esegui — deve PASSARE**

Run: `node --test trueline/scripts/loop/loop.trace.test.mjs`
Expected: PASS — 2/2.

- [ ] **Step 5: BIT-invarianza (smoke)**

Run: `rm -rf eval/.tmp-* ; node eval/harness/m1_gate_check.mjs`
Expected: exit 0 (il ramo legacy del loop è invariato; `case 'authz'` è additivo). *(Se transitorio rosso ambientale, ripeti in isolamento — verità = riesecuzione seriale.)*

- [ ] **Step 6: Commit (ORCHESTRATORE)**
```bash
git add trueline/scripts/loop/loop.mjs trueline/scripts/loop/loop.trace.test.mjs
git commit -m "feat(sp8): loop rerunOracleFor case authz (ri-esegue firestore_rules_check) — additivo"
```

---

## Task 3: `run_loop.mjs` — `collectFindings` (+firestore) + `selectInScope` (+authz)

**Files:**
- Modify: `trueline/scripts/loop/run_loop.mjs` (`collectFindings` r.91–117; `selectInScope` r.188–220; const oracolo)

**Interfaces:**
- Consumes: `firestore_rules_check.mjs`, `verifiedSetFrom(manifest)` (esistente).
- Produces: `collectFindings(dir)` include i finding authz; `selectInScope(findings, manifest)` ammette `authz` quando è nel `verified_set` del manifest e il file è `firestore.rules`.

- [ ] **Step 1: Test (BIT-invarianza + presenza authz)**

Aggiungi a un test esistente o crea `trueline/scripts/loop/run_loop.scope.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectInScope } from './run_loop.mjs'; // aggiungi `export` a selectInScope se assente

test('selectInScope ammette authz solo se nel verified_set del manifest', () => {
  const fAuthz = { category: 'authz', fingerprint: 'x', location: { file: 'firestore.rules' } };
  const fSecret = { category: 'secret', fingerprint: 'y', _scope: 'working-tree', location: { file: 'config.ts' } };
  const mfNoAuthz = { verified_set: ['secret', 'rls', 'dead-code'] };
  const mfAuthz = { verified_set: ['secret', 'dead-code', 'authz'] };
  assert.equal(selectInScope([fAuthz], mfNoAuthz).length, 0, 'senza authz nel set → escluso (BIT-invariante)');
  assert.equal(selectInScope([fAuthz], mfAuthz).length, 1, 'con authz nel set + firestore.rules → ammesso');
});
```
> Se `selectInScope`/`collectFindings` non sono esportate, aggiungi `export` (additivo). `verifiedSetFrom` è già usata da `selectInScope`; verifica che legga `manifest.verified_set`.

- [ ] **Step 2: Esegui — deve FALLIRE** (`selectInScope` non ammette authz). Run: `node --test trueline/scripts/loop/run_loop.scope.test.mjs`

- [ ] **Step 3: Implementa**

In `collectFindings` (r.91–117), dopo il blocco knip (r.104–105) e **prima** di semgrep (r.107), aggiungi:
```js
  // authz Firestore (SP-8): firestore_rules_check cammina `dir` per firestore.rules.
  const fr = runOracle(FIRESTORE_RULES_CHECK, [dir], dir);
  if (fr.ok && fr.json && Array.isArray(fr.json.findings)) findings.push(...norm('firestore-rules', fr.json, 'working-tree'));
```
Aggiungi la const (vicino agli altri oracoli del file): `const FIRESTORE_RULES_CHECK = resolve(ORACLES, 'firestore_rules_check.mjs');` (riusa la `ORACLES` esistente; se assente, `resolve(__dirname,'..','oracles','firestore_rules_check.mjs')`).

In `selectInScope` (r.199–218), dopo il ramo `dead-code` (r.204–208) e **prima** del ramo `secret`, aggiungi:
```js
    if (f.category === 'authz') {
      // SP-8: la regola Firestore vulnerabile FB-S3 vive in firestore.rules.
      if (baseName(f.location.file) === 'firestore.rules') push(f);
      continue;
    }
```

- [ ] **Step 4: Esegui — deve PASSARE.** Run: `node --test trueline/scripts/loop/run_loop.scope.test.mjs`

- [ ] **Step 5: BIT-invarianza.** Run: `rm -rf eval/.tmp-* ; node eval/harness/m1_gate_check.mjs` → exit 0 (senza manifest, `verifiedSetFrom` ritorna il default v1; `authz` non entra).

- [ ] **Step 6: Commit (ORCHESTRATORE)**
```bash
git add trueline/scripts/loop/run_loop.mjs trueline/scripts/loop/run_loop.scope.test.mjs
git commit -m "feat(sp8): run_loop collectFindings + selectInScope ammettono authz Firestore (manifest-driven)"
```

---

## Task 4: `ecosystem_conformance.mjs` — pack verified + armi authz

**Files:**
- Modify: `eval/harness/ecosystem_conformance.mjs` (`PACK_FIXTURES['firebase-jsts']` r.195; `collectFindingsForLoop` r.813–847; `pickSeedFinding` r.856–880)

**Interfaces:**
- Consumes: `oraclesFor(manifest)` (binding `authz`→`firestore_rules_check`), `normForLoop`, const `FIRESTORE_RULES_CHECK` (già definita in SP-5; verificare — altrimenti aggiungerla).
- Produces: il gate `ecosystem_conformance firebase-jsts` instrada a `runVerifiedBody` e la criterion 3 porta FB-S1/S5/S3 a `verified`.

- [ ] **Step 1: Modifica il routing + le 2 armi**

`PACK_FIXTURES['firebase-jsts']` (r.195): `kind: 'detection'` → `kind: 'verified'`. (`fixtureApp`/`registry` invariati.)

In `collectFindingsForLoop` (r.813–847), dopo il blocco dead-code (r.837–844) e **prima** di `return out;`:
```js
  // authz -> firestore_rules_check (cammina `dir` per firestore.rules). (SP-8)
  if (bindings.authz && bindings.authz.tool === 'firestore_rules_check') {
    const r = nodeRun(FIRESTORE_RULES_CHECK, [dir], dir);
    let j = null; try { j = JSON.parse(r.stdout); } catch { /* */ }
    if (j && Array.isArray(j.findings)) out.push(...normForLoop('firestore-rules', j, 'working-tree'));
  }
```
(Verifica che `const FIRESTORE_RULES_CHECK = resolve(ROOT, 'trueline','scripts','oracles','firestore_rules_check.mjs')` esista già — SP-5; se no, aggiungila vicino agli altri `RUN_*`.)

In `pickSeedFinding` (r.856–880), prima di `return undefined` (r.879):
```js
  if (cat === 'authz') {
    const wantPath = String(anchor.match_path || '');
    return findings.find((f) => f.category === 'authz'
      && (anchorFile ? fileEndsWith(f) : true)
      && (wantPath ? (f.location.symbol === wantPath) : true));
  }
```

- [ ] **Step 2: Verifica strutturale (in-workflow)**

Il gate pieno (`ecosystem_conformance firebase-jsts` VERIFIED) richiede T1–T3+T5+T6 e la toolchain (gitleaks/knip) → è il **T-final dell'orchestratore** (seriale). In-workflow, verifica almeno che il file parsi e che il routing sia corretto:
```bash
node -e "import('./eval/harness/ecosystem_conformance.mjs').catch(e=>{console.error(e);process.exit(1)})" ; echo "PARSE_EXIT=$?"
```
Expected: nessun errore di sintassi (exit 0). *(Il verdetto VERIFIED 0/X→PASS è del T-final.)*

- [ ] **Step 3: Commit (ORCHESTRATORE)**
```bash
git add eval/harness/ecosystem_conformance.mjs
git commit -m "feat(sp8): ecosystem_conformance firebase-jsts -> verified + armi authz (collect/pick)"
```

---

## Task 5: Manifest + registry — `verified_set` + flip fix-states

**Files:**
- Modify: `trueline/references/ecosystems/firebase-jsts/ecosystem.json`
- Modify: `eval/ecosystems/firebase-jsts/registry.json`

- [ ] **Step 1: Manifest**

In `ecosystem.json`: `"version": "1.0.0"` → `"1.1.0"`; `"verified_set": []` → `"verified_set": ["secret", "dead-code", "authz"]`. Aggiungi (o estendi) un campo nota onesto, es. nel commento/descrizione del pack: *"authz verified = firestore_rules_check statico ri-eseguito pulito (regola non-`if true` owner-scoped); NON invarianza runtime (emulatore Firestore non disponibile) — L-COL-006."* (`floor` resta `["secret","dependency-vuln","authz"]`; `oracles.authz.tool` resta `firestore_rules_check`.)

- [ ] **Step 2: Registry**

In `registry.json`: aggiungi top-level `"verified_set": ["secret", "dead-code", "authz"]`; bump `"milestone": "SP-8"`. Flip `expected_fix_state`:
- FB-S1 (secret) `detection-only` → `verified`
- FB-S5 (dead-code) `detection-only` → `verified`
- FB-S3 (authz) `detection-only` → `verified`
- FB-S2 (dependency-vuln), FB-S4 (injection): restano `detection-only`.

- [ ] **Step 3: Verifica**

Run: `node trueline/scripts/ecosystem/validate_ecosystem.mjs trueline/references/ecosystems/firebase-jsts/ecosystem.json ; echo "VE_EXIT=$?"`
Expected: exit 0 (manifest valido col `verified_set` nuovo).

- [ ] **Step 4: Commit (ORCHESTRATORE)**
```bash
git add trueline/references/ecosystems/firebase-jsts/ecosystem.json eval/ecosystems/firebase-jsts/registry.json
git commit -m "feat(sp8): firebase-jsts manifest 1.1.0 verified_set=[secret,dead-code,authz] + registry flip (scope statico authz)"
```

---

## Task 6: Reference-app GUARD test

**Files:**
- Create: `eval/ecosystems/firebase-jsts/reference-app/tests/characterization.test.mjs`

**Interfaces:** Importa SOLO `src/dead.ts`'s `usedHelper` (dependency-free, niente `firebase-admin`, niente segreti) → il GUARD non si auto-flagga e gira con `node --test` senza `node_modules`.

- [ ] **Step 1: Crea il GUARD**
```js
// characterization.test.mjs — GUARD di invarianza (SP-8 verified). Cattura un comportamento
// che SOPRAVVIVE alla remediation: usedHelper() resta definito e corretto dopo i fix
// (secret/dead-code/authz). Dependency-free (importa solo dead.ts) -> nessun node_modules,
// nessun segreto nel file di test. node --test (built-in).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usedHelper } from '../src/dead.ts';

test('usedHelper resta vivo e corretto dopo la remediation', () => {
  assert.equal(typeof usedHelper, 'function');
  assert.equal(usedHelper(3, 4), 7);
});
```
> **Verifica preliminare:** apri `src/dead.ts` e conferma la firma reale di `usedHelper` (Agent: `usedHelper()===7`). Se la firma è `usedHelper()` senza argomenti, adatta l'asserzione a `assert.equal(usedHelper(), 7)`. Importa via estensione `.ts` solo se Node la risolve (Node 25 con `--experimental-strip-types` è default per `.ts`); altrimenti importa `../src/dead.mjs`/`.js` o il punto d'ingresso compilato — **adatta all'estensione reale del file** (il micro-gate lo conferma).

- [ ] **Step 2: Esegui — deve PASSARE**

Run: `node --test eval/ecosystems/firebase-jsts/reference-app/tests/characterization.test.mjs`
Expected: PASS (≥1 test, 0 fail). *(Node 25 strip-types per `.ts`.)*

- [ ] **Step 3: Commit (ORCHESTRATORE)** — *la reference-app è gitignorata; il GUARD è committato nell'inner-`.git` dall'orchestratore in T-final.*
```bash
# (orchestratore) il file vive nella reference-app gitignorata; entra nell'inner .git
# via provisioning/commit del fixture in T-final, non nel repo esterno.
```

---

## Task 7: `verify_fix_check.mjs` per firebase-jsts (gate VERIFY)

**Files:**
- Create: `eval/ecosystems/firebase-jsts/verify_fix_check.mjs` (mirror di `eval/ecosystems/postgres-jsts/verify_fix_check.mjs`)

**Interfaces:**
- Consumes: `deterministicFixProvider`, `runFindingLoop`, `collectFloorFindings` pattern (gitleaks WT+history, knip, **firestore_rules_check**), `normalize`/`validateMany`, layered-git copy/isolation.
- Produces: gate che asserisce FB-S1/FB-S5/FB-S3 → `verified` (fatto degli oracoli ri-eseguiti puliti) + GUARD `node --test` + igiene/0-contaminazione.

- [ ] **Step 1: Crea il gate (mirror postgres-jsts + ramo firestore)**

Copia la struttura a 10 stadi di `eval/ecosystems/postgres-jsts/verify_fix_check.mjs` (snapshot integrità → copia isolata sotto `eval/.tmp-verify-fb/<pid>-<n>` con `.git` → `createWorkBranch` → `collectFloorFindings(dir)` [aggiungi un run `firestore_rules_check` → `normalize('firestore-rules', …, 'working-tree')`] → `pickSeed` per anchor → `runFindingLoop` per ogni seed → **assert fix_state**: FB-S1→`verified`, FB-S5→`verified`, FB-S3→`verified` (con `firestore_rules_check` ri-eseguito 0 finding) → re-run indipendente (gitleaks WT pulito, knip non flagga `unusedHelper`, firestore_rules_check pulito) → GUARD `node --test` exit 0 ≥1 pass → igiene: temp pulito, fixture bit-identica, HEAD esterno invariato). **Precondizione:** se `reference-app/.git` manca → banner + `process.exit(2)` (provisioning = orchestratore). Determinismo + radice temp privata per-pid + cleanup never-throw (lezioni BD-1).

- [ ] **Step 2: Micro-gate in-workflow**

I `.git` del fixture esistono già (SP-5). Se la toolchain è presente nel sandbox, `node eval/ecosystems/firebase-jsts/verify_fix_check.mjs` esce 0; in caso di contesa ambientale, l'esito affidabile è il **T-final seriale**. Verifica almeno il parsing:
```bash
node -e "import('./eval/ecosystems/firebase-jsts/verify_fix_check.mjs').catch(()=>process.exit(0))" 2>&1 | head -2
```
*(Il verdetto pieno è del T-final.)*

- [ ] **Step 3: Commit (ORCHESTRATORE)**
```bash
git add eval/ecosystems/firebase-jsts/verify_fix_check.mjs
git commit -m "test(sp8): verify_fix_check firebase-jsts (FB-S1/S5/S3 -> verified, GUARD, igiene)"
```

---

## Task 8: Integrazione finale (ORCHESTRATORE — SERIALE)

- [ ] **Step 1: Provisiona/aggiorna l'inner-`.git` del fixture firebase** (il GUARD di T6 + eventuali sorgenti nuovi entrano nell'inner repo). Usa il provisioning del pack (o un commit dell'orchestratore nell'inner `.git`, `L-COL-024`).

- [ ] **Step 2: Gate SERIALE (la verità, `L-COL-002`)** — uno alla volta, `rm -rf eval/.tmp-*` tra gli heavy:
```bash
node --test trueline/scripts/loop/fix_provider.test.mjs trueline/scripts/loop/loop.trace.test.mjs trueline/scripts/loop/run_loop.scope.test.mjs   # unit
node eval/ecosystems/firebase-jsts/verify_fix_check.mjs                    # VERIFY (FB-S1/S5/S3 verified)
node eval/harness/ecosystem_conformance.mjs firebase-jsts                  # MILESTONE: detection 26 -> VERIFIED (~40)
node eval/harness/ecosystem_conformance.mjs supabase-jsts                  # = m5 56/56 (invariato)
node eval/harness/ecosystem_conformance.mjs supabase-py                    # 40/40
node eval/harness/ecosystem_conformance.mjs postgres-jsts                  # 36/36
node eval/harness/ecosystem_conformance.mjs postgres-py                    # 40/40
node eval/harness/m5_gate_check.mjs                                        # 56/56 (BIT-invarianza)
node eval/harness/build_discipline_check.mjs                              # 21/21
node eval/harness/anti_tamper_check.mjs                                   # 49/49 (Fase A+B)
node trueline/scripts/packaging/package_skill.mjs --no-archive            # lint VERDE, firebase-jsts 1.1.0 (verified)
```
Expected: tutti verdi/PASS. `firebase-jsts` ora **VERIFIED**; gli altri 4 pack + `m5` **invariati** (BIT-invarianza). **Falsificabilità:** neutralizza il fix authz (rompi `fixFirestoreRules` → criterio 3 FB-S3 ≠ verified → FAIL) → ripristina → PASS.

- [ ] **Step 3: Ledger** — nota di riconciliazione SP-8 in `00-INDEX §4` (NESSUN nuovo lock — è **`L-COL-030` fase 2** applicata; `fixFirestoreRules`/armi authz = raffinamenti additivi di `L-COL-029`). **Dichiara lo scope onesto:** authz-verified = oracolo statico pulito, non runtime (gap dichiarato).

- [ ] **Step 4: SESSION-STATE** — aggiorna header/§6/§3; 5 pack di cui firebase ora verified.

- [ ] **Step 5: Merge human-gated** (`L-COL-024`) — `git checkout main && git merge --no-ff` → ri-verde su `main` (`ecosystem_conformance firebase-jsts` VERIFIED + `m5` 56/56) → push → install riallineato (`firebase-jsts 1.1.0 verified`).

---

## Esecuzione (Dynamic Workflow) — mappa ondate/DAG

| Onda | Task | `dipende_da` | Builder | Verifier (k) |
|---|---|---|---|---|
| **W1** | T1 fix-provider ‖ T2 loop ‖ T3 run_loop ‖ T5 dati ‖ T6 GUARD | — (file disgiunti; oracolo firestore già esiste) | T1/T2/T3 **Opus**, T5/T6 **Sonnet** | Opus **k=2** su T1/T2/T3 |
| **W2** | T4 gate (kind→verified + armi) | T1–T3, T5 | **Opus** | Opus |
| **W3** | T7 verify_fix_check | T1–T6 | **Opus** | Opus **k=2** |
| **(fuori workflow)** | T8 integrazione | tutti | — (orchestratore SERIALE) | — |

- Verifier **sempre Opus**, **niente Haiku**. Builder Opus per engine/gate, Sonnet per dati/GUARD.
- **BIT-invarianza** è il rischio #1: ogni verifier ri-esegue `m1` (e l'orchestratore `m5` 56/56 + 4 pack) per provare che i rami secret/rls/dead-code restano byte-identici.
- Git solo nell'orchestratore (`L-COL-024`); merge `main` human-gated.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-26-sp8-firebase-jsts-verified.md`.** Esecuzione via **Dynamic Workflow** (`L-COL-027`): authoring del workflow di build (W1→W3), poi T8 (integrazione SERIALE) dall'orchestratore. Merge `main` **human-gated**.

---

## Self-Review

**1. Spec coverage** (le 3 mappe degli agenti):
- Fix authz (`if true`→owner-scoped, oracolo pulito) → T1 ✓ · Fix secret `serviceAccount.json` → T1 ✓ · dead-code FB-S5 riusa `fixDeadcodeTsSymbol` (nessuna fix nuova) → coperto da T5 flip + macchina esistente ✓
- `loop.mjs::rerunOracleFor` case authz → T2 ✓ · `run_loop` collect/scope authz (loop reale end-to-end, anti-Potemkin) → T3 ✓
- gate kind→verified + `collectFindingsForLoop`/`pickSeedFinding` authz → T4 ✓ (criterion 3 generica, RLS-runtime saltato da `vset.includes('rls')`=false) ✓
- manifest/registry verified_set + flip → T5 ✓ · GUARD → T6 ✓ · verify_fix_check → T7 ✓
- Proof bar statico (emulatore infeasible) + scope onesto → Global Constraints + T5 manifest + T8 ledger ✓

**2. Placeholder scan:** i punti "verifica firma reale `usedHelper`" / "verifica const `FIRESTORE_RULES_CHECK` esista" / "verifica output JSON dell'oracolo" sono **verifiche TDD esplicite** col micro-gate che le falsifica, non placeholder di logica; il codice load-bearing (fix functions, case authz, armi gate) è completo. ✓

**3. Type consistency:** `fixFirestoreRules(dir, finding)→{ok,detail}` e `fixSecretFbS1(dir, finding)→{ok,detail}` usati identici in T1 (test) e dal `selectKnownFix` patch.apply; `rerunOracleFor(finding,dir,runOpts)→{ok,findings,scope}` coerente col chiamante; `selectInScope(findings, manifest)` e `collectFindings(dir)` firme invariate (solo rami additivi). ✓
