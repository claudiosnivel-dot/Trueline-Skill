# Eco-Expansion Fase F1 — Implementation Plan (firebase-py + supabase-storage fold)

> **For agentic workers:** REQUIRED SUB-SKILL: build via **Dynamic Workflow** (`DYNAMIC-WORKFLOWS §5`, mirror SP-8): task DATA in parallelo (Sonnet), edit ENGINE serializzati da UN integrator (Opus), verifica **Opus k=2**. Git **solo** nell'orchestratore (`L-COL-024`). La verità è il **gate SERIALE** dell'orchestratore, mai il green/red sotto concorrenza. Steps con checkbox `- [ ]`.

**Goal:** Aggiungere alla suite Trueline il pack **`firebase-py`** (py × Firebase, tier *verified*) e la **capacità Supabase Storage** (RLS005_PUBLIC_BUCKET) *foldata* in `rls_check` — senza un pack `supabase-storage-*` separato — entrambi gateati e BIT-invarianti rispetto ai 5 pack esistenti e a `m5` 56/56.

**Architecture:** L'engine è già parametrico e manifest-driven (`main()` instrada su `PACK_FIXTURES[id].kind`). (A) `firebase-py` = **incrocio** `supabase-py` (lingua/tie-break) × `firebase-jsts` (backend/authz/fix keyed-by-path) → **pura DATA + 1 riga `PACK_FIXTURES`**, zero codice fix nuovo. (B) Storage = **estensione additiva di `rls_check`** (nuovo ramo keyed su `schema==='storage'`), provata a **livello oracolo + fix-verify** (non un pack: un manifest separato collide su `detect{}` con `supabase-jsts` → `{ambiguous}` perpetuo).

**Tech Stack:** Node ESM (solo built-in), oracoli `firestore_rules_check`/`rls_check`, fix-provider eval-mode deterministico, `validate_ecosystem`, gate `ecosystem_conformance.mjs <id>`. Lingua fixture: Python (vulture dead-code, osv su `requirements.txt`) per firebase-py; SQL migration per storage.

## Global Constraints

- **Determinismo:** niente `Date.now()`/`Math.random()`; prosa **IT**, identificatori **EN**.
- **BIT-INVARIANZA (rischio #1):** ogni edit engine è **ADDITIVO**. Prova obbligatoria: `m5_gate_check` **56/56** + 5 pack esistenti invariati (`supabase-jsts`=56, `supabase-py`/`postgres-py`=40, `postgres-jsts`=36, `firebase-jsts`=34) + `anti_tamper` 49/49 + `build_discipline` 21/21 + `package_skill` lint VERDE. Pulire `eval/.tmp-verify*` prima dei conteggi.
- **Git solo nell'orchestratore** (`L-COL-024`): provisioning inner-`.git` dei fixture + `pip`/vulture disponibili + commit. **Nessun merge su `main`** in questa fase (branch `feat/eco-expansion`, batch human-gate a fine F6).
- **`L-COL-006` (scope onesto):** storage-verified = `rls_check` statico rileva RLS005 e il loop di fix lo azzera; **non** invarianza runtime. firebase-py authz-verified = `firestore_rules_check` statico pulito dopo fix (come firebase-jsts).
- **Validatore cieco al contenuto di `detect{}`:** `validate_ecosystem` controlla solo che `detect` sia un oggetto. La rete di sicurezza della classificazione sono i casi in `resolve.test.mjs` → **obbligatori**.
- **`needsDocker = floor.some(tool==='semgrep')`:** tenere `injection`(semgrep) **fuori dal floor** (bonus) → criterio 2 gira senza docker (come firebase-jsts/supabase-py).

**Riferimento codice verbatim:** `…/scratchpad/f1-verbatim-ref.md` (snippet reali di engine/oracoli/fix da clonare). Analoghi su disco: `eval/ecosystems/firebase-jsts/`, `eval/ecosystems/supabase-py/`, `eval/ecosystems/postgres-jsts/`.

---

# SOTTO-PROGETTO A — pack `firebase-py` (verified)

**Decisione di design (da ratificare a fine F6):** coesiste con `firebase-jsts` via **tie-break lingua** (come supabase-py↔supabase-jsts). `detect.files_any` **identici** a firebase-jsts; `lang_any` = set Python. **Niente** segnale negativo: l'assenza di `package.json` è già catturata da `langHits(firebase-jsts)=0 < langHits(firebase-py)`.

## Task A1 — Manifest `firebase-py` (+ pack spedito)

**Files:**
- Create: `trueline/references/ecosystems/firebase-py/ecosystem.json`
- Create: `trueline/references/ecosystems/firebase-py/guide.md` (prosa IT, mirror `firebase-jsts/guide.md` adattato a Python)
- Create: `trueline/references/ecosystems/firebase-py/ruleset/firebase-py-injection.yml` (clone del ruleset Python di `supabase-py`, semgrep injection — **bonus non-floor**)

**Interfaces — Produces:** un manifest che `loadEcosystems()` auto-scopre; `loadManifest('firebase-py')` lo risolve per la conformance.

- [ ] **Step 1 — Scrivi il manifest** (`ecosystem.json`):

```json
{
  "$comment": "firebase-py — Firebase/Firestore su Python. Incrocio supabase-py (lingua/tie-break) x firebase-jsts (backend/authz Firestore).",
  "id": "firebase-py",
  "version": "1.0.0",
  "languages": ["py"],
  "backend": "firebase",
  "detect": {
    "files_any": ["firebase.json", "firestore.rules"],
    "lang_any": ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py"]
  },
  "triggers": ["firebase", "firestore", "firebase-admin", "python"],
  "oracles": {
    "secret": { "tool": "gitleaks", "shared": true },
    "dependency-vuln": { "tool": "osv", "lockfiles": ["requirements.txt", "poetry.lock", "Pipfile.lock"] },
    "authz": { "tool": "firestore_rules_check", "kind": "firestore-rules", "scan": ["."], "role": "authz-surface" },
    "injection": { "tool": "semgrep", "ruleset": "ruleset/" },
    "dead-code": { "tool": "vulture" }
  },
  "test_runner": { "detect": ["pytest", "unittest"] },
  "floor": ["secret", "dependency-vuln", "authz"],
  "verified_set": ["secret", "dead-code", "authz"],
  "coverage_policy": "declared"
}
```

- [ ] **Step 2 — Micro-gate:** `node trueline/scripts/ecosystem/validate_ecosystem.mjs trueline/references/ecosystems/firebase-py/ecosystem.json` → **exit 0**. (Verifica: esattamente 1 binding `role:'authz-surface'`; ogni `floor` legato a un oracolo; `verified_set ⊆` categorie legate.)

- [ ] **Step 3 — guide.md + ruleset** clonati dagli analoghi (IT prose; il ruleset injection = copia di `supabase-py/ruleset/*-injection.yml`, rinominato). Nessun gate proprio (coperto da A6).

- [ ] **Step 4 — Commit** *(orchestratore)*: `feat(eco-f1): manifest firebase-py (tie-break lingua py, authz firestore riuso)`

## Task A2 — Fixture `firebase-py/reference-app/` + registry

**Files:**
- Create: `eval/ecosystems/firebase-py/reference-app/` (inner `.git` **presente**)
- Create: `eval/ecosystems/firebase-py/registry.json`

**Interfaces — Consumes:** manifest A1. **Produces:** seed per ogni categoria del floor + `verified_set`, con contrasti puliti 0-FP.

Layout (incrocio `supabase-py/reference-app` × `firebase-jsts/reference-app`):

| File | Ruolo | Modello |
|---|---|---|
| `firestore.rules` | **SEED authz FB-S3** (`allow …: if true;`) + regola owner-scoped pulita | `firebase-jsts/reference-app/firestore.rules` |
| `serviceAccount.json` | **SEED secret FB-S1** (`private_key` dummy non-FP) | `firebase-jsts/.../serviceAccount.json` |
| `app/config.py` | **SEED secret** alt (`os.getenv` contrasto) — opzionale | `supabase-py/.../app/config.py` |
| `app/dead.py` | **SEED dead-code** (def top-level morta, vulture) + simbolo usato (contrasto) | `supabase-py/.../app/dead.py` |
| `app/main.py`,`app/routes/…` | corpo app + import firebase-admin | `supabase-py` |
| `requirements.txt` | **lockfile osv** con 1 pin vulnerabile (es. `PyYAML==5.3.1`) → SEED dependency-vuln | `supabase-py/.../requirements.txt` |
| `pyproject.toml` | manifest-lingua (`dependencies = []`; il pin sta in requirements.txt) | `supabase-py/.../pyproject.toml` |
| `.gitignore`,`tests/` | igiene + characterization | `supabase-py` |

- [ ] **Step 1 — Costruisci l'albero** clonando i due template e seminando i marker `SEED:FB-*` ispezionabili. **firebase.json non è obbligatorio** (il `detect` è OR; `firestore.rules` da solo è strong-signal — come la fixture firebase-jsts che non ha firebase.json).
- [ ] **Step 2 — registry.json** (mirror `firebase-jsts/registry.json`): `verified_set:["secret","dead-code","authz"]` (== manifest). Defects:
  - FB-S1 secret → `expected_fix_state:"verified"`, `anchor.file:"serviceAccount.json"`.
  - FB-S3 authz → `source_oracle:"firestore-rules"`, `expected_fix_state:"verified"`, `anchor.match_path:"<rule-path>"` (== `location.symbol` del finding, vedi `pickSeedFinding`).
  - dead-code (py) → `expected_fix_state:"verified"`, `anchor.file:"app/dead.py"`, `anchor.symbol:"<def-morta>"`.
  - dependency-vuln (osv) → **floor, non verified** (`expected_fix_state != "verified"`).
- [ ] **Step 3 — Provisioning inner-`.git`** *(orchestratore)*: `git init` + commit iniziale dentro `reference-app/`, `node_modules`/`__pycache__` gitignorati. Vulture disponibile sul runner.
- [ ] **Step 4 — Commit** *(orchestratore)*: `feat(eco-f1): fixture+registry firebase-py (seed FB-S1/S3 + dead-code py + osv)`

**Gotcha:** `verified_set` registry **==** manifest, o criterio 3 FALLISCE. `requirements.txt` è SIA lang_any (classify) SIA lockfile (osv).

## Task A3 — Registrazione `PACK_FIXTURES` [ENGINE, 1 riga]

**Files:** Modify `eval/harness/ecosystem_conformance.mjs` (oggetto `PACK_FIXTURES`, ~L201, subito dopo la riga `firebase-jsts`).

- [ ] **Step 1 — Aggiungi la riga** (clone esatto della riga firebase-jsts):

```js
  'firebase-py': { kind: 'verified', fixtureApp: resolve(ROOT,'eval','ecosystems','firebase-py','reference-app'), registry: resolve(ROOT,'eval','ecosystems','firebase-py','registry.json') },
```

- [ ] **Step 2 — Micro-gate:** `node -e "import('./eval/harness/ecosystem_conformance.mjs')"` → exit 0 (parse OK). **Nessun altro punto engine** (firestore_rules_check, vulture, osv, gitleaks già dispatchati).
- [ ] **Step 3 — Commit** *(orchestratore)*: `feat(eco-f1): PACK_FIXTURES firebase-py verified [ENGINE 1 riga]`

## Task A4 — `verify_fix_check.mjs` del pack

**Files:** Create `eval/ecosystems/firebase-py/verify_fix_check.mjs` (clone di `firebase-jsts/verify_fix_check.mjs`).

- [ ] **Step 1 — Clona e adatta:** `pickSeed` su ancore Python (FB-S1 serviceAccount.json, FB-S3 firestore.rules, dead-code `app/dead.py`); per il dead-code usare **`run_deadcode --tool=vulture`** (non knip). Replica l'assert `rulesCodeOnly` (la doc-comment cita `allow …: if true;` fra backtick → non deve contare come fix mancato).
- [ ] **Step 2 — Gate locale** *(dopo A2/A3; orchestratore o in-workflow se i tool ci sono):* `node eval/ecosystems/firebase-py/verify_fix_check.mjs` → i seed FB-S1/FB-S3/dead-code risolvono a `fix_state==="verified"`.
- [ ] **Step 3 — Commit** *(orchestratore)*: `test(eco-f1): verify_fix_check firebase-py`

**Gotcha (fix riusati senza nuovo codice):** `selectKnownFix` è keyed-by-(category+path): FB-S1 (`/serviceAccount\.json$/`) e FB-S3 (`/firestore\.rules$/`) **non hanno gate `isPy`** → validi per firebase-py as-is. secret-py (`app/config.py`→`os.getenv`) e dead-code-py (vulture→`removePySymbol`) esistono. **Se** il secret firebase-py non vive in `app/config.py` coi nomi `DATABASE_URL/SUPABASE_SERVICE_ROLE_KEY/API_KEY`, usare **FB-S1 serviceAccount.json come unico secret** (più semplice) — *non* aggiungere gate `isPy` a FB-S1/FB-S3.

## Task A5 — Casi `resolve.test.mjs` (rete di sicurezza classify)

**Files:** Modify `trueline/scripts/ecosystem/resolve.test.mjs` (o sibling test di resolve).

- [ ] **Step 1 — Aggiungi i casi** (gemelli dei casi supabase-py/ambiguous, con `firebase.json` al posto di `supabase/config.toml`):
  - **Fb-Py positivo:** dir con `firebase.json` + `requirements.txt`, **senza** `package.json` → `classify` ritorna `firebase-py`.
  - **Fb-Ambig:** dir con `firebase.json` + `package.json` + `requirements.txt` → `{ambiguous, candidates:[firebase-jsts, firebase-py]}`.
  - **Fb-NoLang:** dir con solo `firebase.json` → `{ambiguous}` (langHits=0 per entrambi).
  - **Anti-regressione Fb-JS:** `firebase.json` + `package.json` (no requirements) → resta **`firebase-jsts`**.
- [ ] **Step 2 — Run:** `node --test trueline/scripts/ecosystem/resolve.test.mjs` → tutti verdi (incl. i preesistenti).
- [ ] **Step 3 — Commit** *(orchestratore)*: `test(eco-f1): resolve casi firebase-py (tie-break lingua + ambiguous + anti-regressione js)`

**Gotcha:** `files_any` di firebase-py **identici** a firebase-jsts (un file extra romperebbe la parità Pass-1 e farebbe vincere il pack col file in più a prescindere dalla lingua). `firebase-jsts` **non** si tocca (`lang_any:['package.json']`).

## Task A6 — GATE milestone firebase-py *(orchestratore, SERIALE)*

- [ ] **Step 1 — Gate del pack:** `node eval/harness/ecosystem_conformance.mjs firebase-py` → **PASS** (~34, tier verified, vset=[secret,dead-code,authz], 3 seed-vset + 2 non-vset).
- [ ] **Step 2 — Falsificabilità:** neutralizza temporaneamente il fix FB-S3 (o il fix dead-code) → criterio 3 **FAIL** → ripristina → PASS. (Prova che il gate misura davvero.)
- [ ] **Step 3 — No-regressione integrale + 0-contaminazione:** vedi gate di fase F1 (sotto). HEAD esterno invariato.

---

# SOTTO-PROGETTO B — Supabase Storage *foldato* in `rls_check` (RLS005_PUBLIC_BUCKET)

**Decisione di design (da ratificare):** **niente pack/manifest nuovo** (collide su `detect{}` con supabase-jsts → `{ambiguous}` su ogni repo Supabase = regressione classify). Capacità **additiva** dentro `rls_check`; prova a livello **oracolo-test + fix-verify**. I 5 pack esistenti non hanno policy `storage.objects` → i nuovi rami sono **NO-OP** per loro (BIT-invarianza).

## Task B1 — Estendi `rls_check.mjs` (rilevazione RLS005) [ENGINE additivo]

**Files:** Modify `trueline/scripts/oracles/rls_check.mjs`.

**Interfaces — Produces:** `RLS005_PUBLIC_BUCKET` (category `rls`, oracle `rls-check`) su policy `storage.objects` prive di token di isolamento.

- [ ] **Step 1 — Token storage** (NUOVA costante accanto a `ISOLATION_TOKENS` L53, **senza mutarla**):

```js
// Marcatori di isolamento per le policy su storage.objects (Supabase Storage).
// owner-scoped: `owner = auth.uid()` oppure `(storage.foldername(name))[1] = auth.uid()::text`.
const STORAGE_ISOLATION_TOKENS = ['owner', 'storage.foldername', 'auth.uid()', 'auth.jwt()', 'current_setting('];
```

- [ ] **Step 2 — Secondo loop additivo** in `analyzeFile`, **dopo** il loop `evaluateTable` (NON modificare il filtro `if (t.schema !== 'public') continue;` L124):

```js
  // Passata storage (additiva): policy su storage.objects (tabella built-in,
  // registrata come ghost-table schema='storage' da handleCreatePolicy).
  for (const t of tables.values()) {
    if (t.schema === 'storage' && t.name === 'objects') evaluateStorageObjects(t, findings);
  }
```

- [ ] **Step 3 — `evaluateStorageObjects`** (clone del pattern RLS003/RLS004, ma keyed sull'assenza di token; `storage.objects` è ghost-table → `columns:[]`, niente euristica multi-tenant):

```js
function evaluateStorageObjects(t, findings) {
  for (const p of t.policies) {
    const exprs = [p.using, p.withCheck].filter(Boolean);
    const exprBlob = exprs.join(' ').toLowerCase();
    const hasIsolation = STORAGE_ISOLATION_TOKENS.some((tok) => exprBlob.includes(tok));
    if (!hasIsolation) {
      findings.push(makeFinding({
        controlId: 'RLS005_PUBLIC_BUCKET',
        severity: 'HIGH',
        table: 'storage.objects',
        policy: p.name,
        file: p.file, startLine: p.startLine, endLine: p.endLine,
        statement: 'CREATE POLICY', snippet: p.snippet,
        message:
          `La policy ${p.name} su storage.objects non vincola l'accesso per ` +
          `owner/auth.uid()/storage.foldername: il bucket e' di fatto pubblico ` +
          `(ogni oggetto leggibile/scrivibile da chiunque superi RLS).`,
        coverage: 'static-ddl',
        heuristic:
          'EURISTICA (static-first): bucket "pubblico" dedotto dall\'assenza, ' +
          'nel predicato della policy su storage.objects, di un token di ' +
          'isolamento (owner, storage.foldername(name), auth.uid(), auth.jwt(), current_setting()).',
      }));
    }
  }
}
```

- [ ] **Step 4 — Oracolo-test** `trueline/scripts/oracles/rls_check.storage.test.mjs` (NUOVO):
  - policy `storage.objects` con `USING (true)` → **1** finding `RLS005_PUBLIC_BUCKET`.
  - policy `storage.objects` con `USING (owner = auth.uid())` → **0** findings.
  - policy `storage.objects` con `USING ((storage.foldername(name))[1] = auth.uid()::text)` → **0** findings.
  - **Anti-regressione:** una migration `public.*` esistente (RLS001/003/004) → conteggi **invariati** (i nuovi rami non toccano schema public).
- [ ] **Step 5 — Run:** `node --test trueline/scripts/oracles/rls_check.storage.test.mjs` → verde.
- [ ] **Step 6 — Commit** *(orchestratore)*: `feat(eco-f1): rls_check RLS005_PUBLIC_BUCKET (storage.objects, additivo BIT-invariante)`

**Gotcha:** `handleCreatePolicy` (L334) registra già `storage.objects` come ghost-table. `isLiteralTrue` (rls, L456) NON serve (il verdetto è l'assenza di token). Il filtro public L124 e `ISOLATION_TOKENS` **non si toccano**.

## Task B2 — `normalize.mjs` CWE map [ENGINE, 1 riga]

**Files:** Modify `trueline/scripts/findings/normalize.mjs` (file **UTF-16**; usare editor che preserva l'encoding) — `RLS_CWE` map (~L255-260, dentro `normalizeRlsCheck`).

- [ ] **Step 1 — Aggiungi 1 voce:**

```js
  RLS005_PUBLIC_BUCKET: 'CWE-285',
```

- [ ] **Step 2 — Verifica:** OWASP `A01:2025` è già applicato a TUTTI gli rls finding (gratis). Nessun nuovo alias (`RLS005` è oracolo `rls-check` esistente). `node --test` su un test di normalize che includa un RLS005 → category `rls`, cwe `CWE-285`, owasp `A01:2025`.
- [ ] **Step 3 — Commit** *(orchestratore)*: `feat(eco-f1): normalize CWE-285 per RLS005 [ENGINE 1 riga]`

## Task B3 — Fix-provider storage (tier verified) [ENGINE/eval]

**Files:** Modify `trueline/scripts/loop/fix_provider.mjs`.

- [ ] **Step 1 — `fixRlsStorageS5(dir, finding)`** accanto agli altri fix RLS (`fixRlsS3/S4`, ~L97-136): localizza la migration via `migrationFileFor(dir)`, sostituisce il predicato permissivo della policy `storage.objects` con owner-scoped (`USING ((storage.foldername(name))[1] = auth.uid()::text)` o `USING (owner = auth.uid())`). **Cattura e ri-emette il terminatore `;` PRIMA del commento di fix** (come SPY-S3/PY-S3, o la migration resta sintatticamente aperta). Signature **distinta**: `` `fix-storage-owner-scope:${finding.policy}` ``.
- [ ] **Step 2 — Registra in `FIX_TABLE`** (~L527-532):

```js
  'RLS005_PUBLIC_BUCKET': { kind: 'rls', apply: fixRlsStorageS5, signature: 'fix-storage-owner-scope-bucket' },
```

  Il branch `if (cat === 'rls' && FIX_TABLE[ruleId])` (~L578) lo seleziona da solo. **Verifica l'ordine dei rami:** il ramo RLS Python per-ecosistema (~L569-576) precede il lookup `FIX_TABLE` → assicurarsi che una fixture storage **JS** non venga dirottata; se necessario, gate per path `storage`/idioma.
- [ ] **Step 3 — Fix-verify test** `trueline/scripts/loop/fix_provider.storage.test.mjs` (NUOVO): data una migration con policy `storage.objects` pubblica → `selectKnownFix` ritorna `fixRlsStorageS5` → applica → **ri-esegui `rls_check`** sulla copia → **0** finding `RLS005` (→ `verified`). **Falsificabilità:** neutralizza `fixRlsStorageS5` (no-op) → il test FALLISCE.
- [ ] **Step 4 — Run:** `node --test trueline/scripts/loop/fix_provider.storage.test.mjs` → verde.
- [ ] **Step 5 — Commit** *(orchestratore)*: `feat(eco-f1): fix_provider RLS005 storage owner-scope + verify (tier verified)`

**Gotcha:** signature **materialmente distinta** (il loop rifiuta ri-sottomissioni byte-identiche). Niente toccare i fix-history (storage non semina history).

## Task B4 — GATE storage *(orchestratore, SERIALE)*

- [ ] **Step 1 — Oracolo + fix-verify:** B1.5 + B3.4 verdi.
- [ ] **Step 2 — BIT-invarianza:** `m5` **56/56**, `supabase-jsts`=56, `supabase-py`/`postgres-py`=40, `postgres-jsts`=36, `firebase-jsts`=34 — **tutti invariati** (lo storage è additivo, nessuna policy storage nei loro fixture).
- [ ] **Step 3 — Falsificabilità:** neutralizza `fixRlsStorageS5` → fix-verify FAIL → ripristina → PASS.

---

# GATE DI FASE F1 *(orchestratore, T-final, SERIALE — la VERITÀ)*

- [ ] **G1 — firebase-py:** `ecosystem_conformance firebase-py` PASS (~34) + falsificabile (A6).
- [ ] **G2 — storage:** oracolo-test + fix-verify + falsificabile (B4).
- [ ] **G3 — No-regressione integrale:** `m5_gate_check` **56/56** · `ecosystem_conformance` 5 pack [supabase-jsts 56 · supabase-py/postgres-py 40 · postgres-jsts 36 · **firebase-jsts 34**] · `anti_tamper_check` 49/49 · `build_discipline_check` 21/21 · `resolve.test` verde · `package_skill` lint VERDE (**6 voci**: i 5 pack + firebase-py 1.0.0 verified; storage **non** è un pack).
- [ ] **G4 — 0-contaminazione:** HEAD esterno invariato per tutta la riesecuzione SERIALE (`assertIsolatedRepo` regge); interni dei fixture invariati (a parte i nuovi).
- [ ] **G5 — Ledger + SESSION-STATE:** firebase-py = `L-COL-030` fase 2 (nessun lock nuovo); RLS005 storage = raffinamento additivo `L-COL-029`. **Decisioni reversibili registrate per ratifica F6:** (a) supabase-storage *foldato* (no pack); (b) firebase-py tie-break lingua. Annotare in `00-INDEX §4` come *proposte/applicate-additive*, non emendamenti silenziosi.
- [ ] **G6 — Commit di fase** *(NO merge):* `feat(eco-f1): fase F1 (firebase-py verified + storage RLS005 foldato) gateata SERIALE` su `feat/eco-expansion`. **`main` intatto.**

---

## Self-Review

**Spec coverage (vs brief §1 template):** T1 manifest ✅(A1) · T2 ruleset ✅(A1 step3, injection bonus) · T3 fixture+registry ✅(A2) · T4 PACK_FIXTURES ✅(A3) · T5 nuovo-oracolo → **N/A firebase-py** (riuso firestore), **storage** = estensione additiva (B1, non i 4 dispatch perché resta category `rls`) · T6 fix-provider+verify ✅(A4 riuso, B3 nuovo) · T7 gate ✅(A6/B4/F1). Casi classify ✅(A5) — non nel template generico ma imposti dalla gotcha "validatore cieco".

**Placeholder scan:** nessun "TBD/TODO". Le clonazioni (fixture/registry/guide/ruleset) puntano a file-modello esatti su disco; il codice net-new (manifest detect{}, RLS005, evaluateStorageObjects, fixRlsStorageS5 contract, normalize line, casi resolve) è inline.

**Type/naming consistency:** `RLS005_PUBLIC_BUCKET` (controlId == registry cwe-key == FIX_TABLE key == normalize CWE-key) coerente B1/B2/B3. `firebase-py` id coerente A1/A2/A3/A4/A5/G. category storage = `rls` (CWE-285), authz firestore = `authz` (CWE-862) — distinte e coerenti. `STORAGE_ISOLATION_TOKENS` ≠ `ISOLATION_TOKENS` (non muta l'esistente).

**Rischi residui (gate li coglie):** (1) ordine rami `selectKnownFix` (B3 step2) — il fix-verify lo prova; (2) secret firebase-py path/nomi (A4 gotcha) — fallback FB-S1; (3) encoding UTF-16 di normalize (B2) — editor encoding-safe.
