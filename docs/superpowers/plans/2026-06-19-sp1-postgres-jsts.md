# SP-1 — Primo ecosystem pack nuovo: `postgres-jsts` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (o executing-plans) per implementare task-by-task. Step in checkbox (`- [ ]`).
>
> **Metodo del progetto:** ogni task è **test-first** (il gate scritto PRIMA, `L-COL-019`/`L-COL-027`); il "verde" è un **FATTO** di un comando/oracolo (`L-COL-002`), MAI una frase dell'LLM; **git solo nell'orchestratore** — gli agenti del workflow NON toccano il git ESTERNO (il git INTERNO della fixture sì, è un artefatto isolato), merge su `main` **human-gated** (`L-COL-024`). Branch: `feat/sp1-postgres-jsts` (già creato da `96591cc`).

**Goal:** Consegnare il **primo ecosystem pack nuovo** dopo SP-0 — `postgres-jsts` (JS/TS su **Postgres non-Supabase**: Next.js / Node API, client `pg`/Prisma/Drizzle) — come **prova end-to-end del meccanismo-manifest** di SP-0. Riusa tutti gli oracoli JS/TS (gitleaks, osv, semgrep, knip) ma **stressa il ruolo `authz-surface`**, che passa da *RLS-al-DB* (`rls_check`) a *route-authz nell'app* (semgrep su rotte mutanti senza auth check). Barra-B **fase 1** (`L-COL-030`): `floor=[secret,dependency-vuln,authz]`, `verified_set=[]` (tier **detection**), `coverage_policy: declared`.

**Architecture:** Un nuovo manifest `references/ecosystems/postgres-jsts/ecosystem.json` (validato da `validate_ecosystem`) lega `authz`→semgrep con `role:"authz-surface"` e un **ruleset route-authz dedicato** (`ruleset/`), `secret`→gitleaks, `dependency-vuln`→osv. L'engine acquisisce due capacità nuove e additive: (a) `run_semgrep` accetta un **path di ruleset** dal manifest (default = ruleset v1 condiviso → comportamento v1 invariato); (b) `classify()` risolve per **precedenza file-signal-forte** (un repo Supabase resta `supabase-jsts` anche con `postgres-jsts` caricato; un repo JS/TS senza `supabase/config.toml` → `postgres-jsts`). Una fixture vulnerabile `eval/ecosystems/postgres-jsts/reference-app` (gitignorata, inner-repo) + `registry.json` (tracked) provano la detection. `ecosystem_conformance.mjs` guadagna un **corpo detection-parametrico generico** per i pack nuovi (criteri 1/2/5/6, letti da manifest+registry+fixture); `supabase-jsts` resta sul ramo che delega a `m5` (56/56 invariato).

**Tech Stack:** Node ESM, **solo built-in** per il codice engine/harness (nessun npm install, niente ajv). La fixture è un'app Node/Express + `pg` con `package-lock.json` che pinna una dipendenza vulnerabile reale (`minimist@1.2.0` → osv flagga `GHSA-vh95-rmgr-6w4m`, verificato in preflight). Vocabolario categorie = finding-category di `04`; `authz-surface` è un **ruolo**, non una categoria (nessuna categoria nuova in `04`). Nessun DB live richiesto (postgres-jsts non ha RLS-al-DB).

---

## File Structure

**Nuovi (tracked):**
- `trueline/references/ecosystems/postgres-jsts/ecosystem.json` — manifest del pack.
- `trueline/references/ecosystems/postgres-jsts/guide.md` — prosa per-modalità del pack.
- `trueline/references/ecosystems/postgres-jsts/ruleset/postgres-jsts-authz.yml` — ruleset semgrep route-authz (+ riuso regole generiche secret/injection/crypto se utile).
- `eval/ecosystems/postgres-jsts/registry.json` — registro atteso dei difetti seminati (stesso schema di `eval/harness/expected/registry.json`).
- `trueline/scripts/oracles/run_semgrep.test.mjs` — self-test del parametro ruleset.
- `trueline/scripts/ecosystem/resolve.test.mjs` — ESTESO (casi di precedenza).

**Nuovi (gitignored, on-disk inner repo — `eval/ecosystems/*/reference-app/`):**
- `eval/ecosystems/postgres-jsts/reference-app/` — app vulnerabile Node/Express + `pg` (repo git INTERNO autonomo, mai tracciato dal repo esterno).

**Modificati:**
- `trueline/scripts/oracles/run_semgrep.mjs` — 2° arg posizionale opzionale `[rulesetPath]` (file o dir; default = `trueline-ai-ruleset.yml` condiviso). **Default invariato**.
- `trueline/scripts/ecosystem/resolve.mjs` — `classify()` con precedenza file-signal-forte + gestione ambiguità.
- `eval/harness/ecosystem_conformance.mjs` — corpo detection-parametrico generico per i pack senza gate delegato.
- `trueline/scripts/packaging/package_skill.mjs` — (verifica) il lint valida anche il manifest `postgres-jsts` + ne elenca il tier `detection`.
- `00-INDEX.md` (ledger), `SESSION-STATE.md`, note in `02`/`09`/`10`.

---

## DAG / Ondate / Model policy

```
W1: T1.1 manifest ............. (indip.)            Sonnet / Opus
    T1.2 fixture+registry ..... (indip.)            Opus / Opus
W2: T2.0 run_semgrep ruleset .. dep T1.1            Opus / Opus (k=2)
    T2.1 classify precedenza .. dep T1.1            Opus / Opus (k=2)
    T2.2 ruleset route-authz .. dep T1.2,T2.0       Opus / Opus (k=2)
W3: T3.1 conformance body ..... dep T1.1,T1.2,T2.0,T2.1,T2.2   Opus / Opus (k=2)
W4: T4   collaudo + ledger .... dep T3.1            orchestratore + Sonnet / Opus
```

Verifier **sempre Opus**; **k=2** su T2.0/T2.1/T2.2/T3.1 (oracoli + gate = se sbagliati danno falso verde/rosso). Niente Haiku. Gli agenti **non toccano il git esterno**.

---

## FASE A (W1) — Contratto + fixture del pack

### Task T1.1 — Manifest `postgres-jsts` (+ guide)

**Files:** Create `trueline/references/ecosystems/postgres-jsts/ecosystem.json`, `…/guide.md`, `…/ruleset/.gitkeep` (il ruleset reale arriva in T2.2).

- [ ] **Step 1: scrivi il manifest** (ESATTO):

```json
{
  "id": "postgres-jsts",
  "version": "1.0.0",
  "languages": ["js", "ts"],
  "backend": "postgres",
  "detect": { "lang_any": ["package.json"] },
  "triggers": ["postgres", "pg", "prisma", "drizzle", "next", "nextjs", "express", "node", "secret", "segret", "authz", "authorization", "autorizzazione", "route", "rotta", "endpoint", "blueprint", "audit", "remediat", "bonific", "macrotask", "oracol", "js", "ts", "javascript", "typescript", "sicur", "security"],
  "oracles": {
    "secret":          { "tool": "gitleaks", "shared": true },
    "dependency-vuln": { "tool": "osv", "lockfiles": ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"] },
    "authz":           { "tool": "semgrep", "ruleset": "ruleset/", "role": "authz-surface" },
    "injection":       { "tool": "semgrep", "ruleset": "ruleset/" },
    "crypto":          { "tool": "semgrep", "ruleset": "ruleset/" },
    "dead-code":       { "tool": "knip" }
  },
  "test_runner": { "detect": ["vitest", "jest", "node:test"] },
  "floor":        ["secret", "dependency-vuln", "authz"],
  "verified_set": [],
  "coverage_policy": "declared"
}
```

- [ ] **Step 2: guide.md** — prosa breve: stack (JS/TS + Postgres non-Supabase, `pg`/Prisma/Drizzle/Next.js API), cosa copre il pack (floor in detection: secret/dependency-vuln/route-authz; coverage dichiarata; nessun loop verificato — fase 1), e come `authz-surface` qui = **route-authz** (rotte mutanti senza identity/role check), non RLS-al-DB. Tono e struttura come `../supabase-jsts/guide.md`.

- [ ] **GATE (test-first → verde):**
  - `node trueline/scripts/ecosystem/validate_ecosystem.mjs trueline/references/ecosystems/postgres-jsts/ecosystem.json` → **`RESULT: OK`, exit 0**.
  - `node trueline/scripts/ecosystem/validate_ecosystem.test.mjs` → **`OK — 9/9`** (nessuna regressione del validatore).
  - `node trueline/scripts/ecosystem/resolve.test.mjs` → resta verde (caricamento manifest non rompe `loadEcosystems`).

### Task T1.2 — Fixture vulnerabile + registry

**Files:** Create (gitignored inner-repo) `eval/ecosystems/postgres-jsts/reference-app/**`; Create (tracked) `eval/ecosystems/postgres-jsts/registry.json`.

**App (TypeScript, Node/Express + `pg`):** struttura minima ma realistica:
```
eval/ecosystems/postgres-jsts/reference-app/
  package.json            # deps: express, pg, minimist@1.2.0 (VULN seminata)
  package-lock.json       # pinna minimist 1.2.0 (osv flagga GHSA-vh95-rmgr-6w4m)
  tsconfig.json
  knip.json
  src/index.ts            # monta express + registra le rotte
  src/config.ts           # SEED:PG-S1 — secret hardcoded (connection string con password / token)
  src/db.ts               # pool pg; query helper
  src/routes/bookings.ts  # SEED:PG-S3 (route-authz: POST scrive su DB senza auth check)
                          #              + rotta PULITA di contrasto (POST con auth check → NESSUN finding)
                          # SEED:PG-S4 (injection opzionale: SQL string-concat) [non-floor, bonus]
  src/routes/health.ts    # rotta pulita (GET, nessun sink)
```

**Difetti seminati (i 3 del FLOOR sono obbligatori; il gate li richiede):**

| ID | Categoria | Posizione | Oracolo | scan_scope | expected_fix_state |
|---|---|---|---|---|---|
| **PG-S1** | `secret` | `src/config.ts` — literal ad alta entropia (`SEED:PG-S1`) es. `postgres://app:R3al_pw_live_8f3a9c2b1d4e@…` o token `sk_live_…` | gitleaks (working-tree) | `working-tree` | `detection` |
| **PG-S2** | `dependency-vuln` | `package-lock.json` — `minimist@1.2.0` | osv (lockfile) | `lockfile` | `detection` |
| **PG-S3** | `authz` | `src/routes/bookings.ts` — handler `router.post(...)` che fa `pool.query('INSERT …')`/`db.query` **senza** alcun controllo di identità/ruolo (`SEED:PG-S3`) | semgrep + ruleset del pack | `working-tree` | `detection` |
| *(contrasto)* | — | `src/routes/bookings.ts` — un secondo `router.post(...)` che **prima** verifica l'identità (es. `if (!req.user) return res.status(401)…` poi `pool.query`) | semgrep → **0 finding** (precisione) | — | — |
| PG-S4 *(bonus, non-floor)* | `injection` | `src/db.ts`/route — `pool.query('SELECT … WHERE id = ' + req.params.id)` | semgrep | `working-tree` | `detection` |

> **Auth-check riconosciuti** (per l'esclusione del ruleset, T2.2 — NON Supabase): `req.user`, `req.session?.userId`, `getServerSession(...)` (NextAuth), middleware `requireAuth`/`ensureAuth`, `verifyToken(...)`/`verifyJwt(...)`. La rotta di contrasto usa uno di questi.

- [ ] **Step 1:** scrivi l'app + `package.json` (deps reali, incl. `minimist@1.2.0`) e genera/scrivi a mano un `package-lock.json` valido che pinna `minimist 1.2.0` (campo `packages["node_modules/minimist"].version = "1.2.0"`). `node --check` su ogni `.ts` compilato non serve; basta che i file siano sintatticamente coerenti per gli oracoli statici (gitleaks/semgrep/osv leggono il testo/lockfile, non eseguono).
- [ ] **Step 2:** inizializza il **git INTERNO** della fixture (artefatto isolato, gitignorato dal repo esterno): `git -C <abs path della fixture> init -q && git -C … add -A && git -C … commit -q -m "seed: postgres-jsts vulnerable fixture"`. **Mai** `git` alla root del repo esterno.
- [ ] **Step 3:** scrivi `eval/ecosystems/postgres-jsts/registry.json` — stesso schema di `eval/harness/expected/registry.json`. Ogni voce: `{ id, category, source_oracle, owasp, cwe, expected_fix_state, anchor:{file, marker|table|policy|symbol, lockfile?}, scan_scope, notes }`. Esempio voce PG-S3:
```json
{ "id": "PG-S3", "category": "authz", "source_oracle": "semgrep",
  "owasp": "A01:2025", "cwe": "CWE-862", "expected_fix_state": "detection-only",
  "anchor": { "file": "src/routes/bookings.ts", "marker": "SEED:PG-S3" },
  "scan_scope": "working-tree", "notes": "rotta mutante senza identity/role check (route-authz, authz-surface non-Supabase)" }
```
(PG-S1 → `category:secret, source_oracle:gitleaks, owasp:A07:2025, cwe:CWE-798`; PG-S2 → `category:dependency-vuln, source_oracle:osv, anchor.lockfile:"package-lock.json", anchor.symbol:"minimist@1.2.0"`.)

- [ ] **GATE (test-first → verde):** un piccolo script di self-check della fixture (può vivere come `eval/ecosystems/postgres-jsts/fixture_check.mjs`, tracked) che asserisce **FATTI di oracoli reali**, NON ispezione LLM:
  - `run_gitleaks <fixture> working-tree` → trova ≥1 secret nel file `src/config.ts` (PG-S1).
  - `run_osv <fixture>/package-lock.json` → trova ≥1 vulnerabilità su `minimist` (PG-S2).
  - (authz PG-S3 è gateato da T2.2/T3.1 perché dipende dal ruleset.) Verifica almeno che il marker `SEED:PG-S3` esista e che esista la rotta di contrasto.
  - `git -C <fixture> status --porcelain` vuoto (commit pulito) e l'HEAD del repo ESTERNO invariato.

---

## FASE B (W2) — Engine generalizzato (additivo, default v1 invariato)

### Task T2.0 — `run_semgrep` accetta un ruleset path dal manifest

**Files:** Modify `trueline/scripts/oracles/run_semgrep.mjs`; Test `trueline/scripts/oracles/run_semgrep.test.mjs` (Create).

**Scope:** oggi `RULESET_SRC` è cablato al `trueline-ai-ruleset.yml` condiviso. Aggiungere un **2° arg posizionale opzionale** `rulesetPath` (relativo alla repo root o assoluto; può essere un **file** `.yml` o una **dir** di `.yml`). Se assente → comportamento **identico a oggi** (ruleset condiviso). Se è una dir → copia la dir (o tutti i `.yml`) nella sottocartella effimera `.trueline/semgrep-rules/` e `--config` la dir; se è un file → come oggi ma sul file dato. Mantieni: mount Windows `//c/...`, `MSYS_NO_PATHCONV=1`, cleanup nel `finally`, exit 0/1 validi, JSON nativo su stdout.

- [ ] **Step 1: test (FALLISCE finché il param non è usato):**
  - `run_semgrep.mjs eval/reference-app` (default) → JSON valido E **trova S6/S7** come oggi (regressione: usa il ruleset condiviso). *(Se non puoi dipendere dal DB/docker nel micro-test, asserisci almeno: default → usa `trueline-ai-ruleset.yml`; con un ruleset path inesistente → exit 2 dichiarato; con un ruleset path dato valido → `--config` punta a quel path.)* Preferisci un test che NON sia tautologico: con un ruleset path **vuoto/dummy** i finding su un sorgente noto cambiano rispetto al default.
- [ ] **Step 2: esegui → FAIL.**
- [ ] **Step 3: implementa** il 2° arg (default invariato).
- [ ] **GATE (verde):**
  - `node trueline/scripts/oracles/run_semgrep.test.mjs` → OK.
  - **Regressione:** `node eval/harness/m5_gate_check.mjs` → **56/56** (il path semgrep default è quello del v1). *(richiede DB up + docker)*

### Task T2.1 — `classify()` precedenza file-signal-forte

**Files:** Modify `trueline/scripts/ecosystem/resolve.mjs` (`classify`); Test: ESTENDI `trueline/scripts/ecosystem/resolve.test.mjs`.

**Scope:** oggi `classify` ritorna il **primo** manifest che combacia nell'ordine di `readdirSync`. Con `postgres-jsts` (detect lang-only `package.json`, ordinato PRIMA di `supabase-jsts`) un repo Supabase verrebbe mis-classificato. Fix: **due passate** — prima i manifest con `detect.files_any` non vuoto il cui file esiste (segnale **forte**); tra più match forti, il più **specifico** (più file_any combacianti / o ambiguità → ritorna un esito che il chiamante tratta come "proponi+conferma", coerente con la regola dura `SKILL.md §1`, MAI un verde silenzioso). Poi, **fallback**, i manifest `lang_any`-only. Un repo vuoto → `null`.

- [ ] **Step 1: estendi il test (FALLISCE):**
  - repo con `supabase/config.toml` **e** `package.json` ⇒ `classify === 'supabase-jsts'` **anche con `postgres-jsts` caricato** (l'asserzione chiave anti-regressione).
  - repo con solo `package.json` (no `supabase/config.toml`) ⇒ `classify === 'postgres-jsts'`.
  - repo vuoto ⇒ `classify === null`.
  - i **9/9 casi esistenti** restano verdi.
- [ ] **Step 2: esegui → FAIL.**
- [ ] **Step 3: implementa** la precedenza.
- [ ] **GATE (verde):** `node trueline/scripts/ecosystem/resolve.test.mjs` → OK (tutti, vecchi+nuovi). `node eval/harness/m5_gate_check.mjs` invariato (il v1 non passa per classify in modo che cambi l'esito).

### Task T2.2 — Ruleset semgrep route-authz per `postgres-jsts`

**Files:** Create `trueline/references/ecosystems/postgres-jsts/ruleset/postgres-jsts-authz.yml` (+ eventuali regole generiche riusate).

**Scope:** regola/e Semgrep che colgono il **route-authz** generico per stack pg/Prisma/Drizzle: un handler di rotta **mutante** (`.post/.put/.delete/.patch`) che esegue una **scrittura DB** *senza* un controllo d'identità/ruolo nel corpo. Modella la regola sul principio di `col-authz-mutating-route-no-identity-check` (07 §4) ma con **sink non-Supabase** e **esclusioni-auth non-Supabase**:
- **sink (scrittura DB):** `pool.query('INSERT…'|'UPDATE…'|'DELETE…' …)`, `db.query(...)`, `client.query(...)` con SQL mutante; `prisma.$ELEMENT.create|update|delete|upsert(...)`; Drizzle `db.insert(...)|update(...)|delete(...)`.
- **contesto:** dentro `$ROUTER.post|put|delete|patch($PATH, …, async ($REQ,$RES) => { … })` (Express/Next route handler).
- **esclusione (`pattern-not-inside`):** presenza di un auth check — `req.user`, `req.session`, `getServerSession(...)`, `requireAuth`/`ensureAuth`, `verifyToken(...)`/`verifyJwt(...)`.
- **metadata:** `category: authz`, `cwe: CWE-862`, `owasp: A01:2025` (coerente col registry e con la normalize di `04`).
Precisione: **deve** colpire `SEED:PG-S3` e **NON** la rotta di contrasto (con auth check). Niente FP sulle rotte `GET`/pulite.

- [ ] **Step 1: il gate È il test** (test-first): la regola viene scritta per far passare l'asserzione, eseguita contro la fixture T1.2.
- [ ] **GATE (verde, k=2):**
  - `node trueline/scripts/oracles/run_semgrep.mjs eval/ecosystems/postgres-jsts/reference-app trueline/references/ecosystems/postgres-jsts/ruleset/` (usa T2.0) → normalizzato con `normalize('semgrep', …)`:
    - **trova** un finding `category:authz`, file `src/routes/bookings.ts`, `cwe:CWE-862` (PG-S3);
    - **0 finding** sulla rotta di contrasto (stesso file, handler con auth check) e su `health.ts`.
  - *(richiede docker)*. Builder **Opus** (precisione pattern, lezione M4); verifier **Opus k=2**.

---

## FASE C (W3) — Gate di conformità: corpo detection-parametrico

### Task T3.1 — `ecosystem_conformance.mjs` corpo generico per pack nuovi

**Files:** Modify `eval/harness/ecosystem_conformance.mjs`.

**Scope:** mantieni il ramo `supabase-jsts` (criterio 1 + delega a `m5_gate_check.mjs`). Aggiungi un **corpo detection-parametrico** per i pack con fixture+registry (postgres-jsts). Struttura `PACK_FIXTURES`:
```js
'postgres-jsts': {
  kind: 'detection',
  fixtureApp: resolve(ROOT, 'eval', 'ecosystems', 'postgres-jsts', 'reference-app'),
  registry:   resolve(ROOT, 'eval', 'ecosystems', 'postgres-jsts', 'registry.json'),
}
```
Per `kind:'detection'`, dopo il **criterio 1** (validate_ecosystem) esegui:
- **Criterio 2 — DETECTION parity (floor):** **copia** la fixture in un workspace isolato (`verify_workspace.createVerifyWorkspace`, copia CON `.git`, `assertIsolatedRepo`). Per **ogni categoria in `manifest.floor`**: risolvi l'oracolo legato (`oraclesFor(manifest)[cat].tool`) e lancia il wrapper sul copy:
  - `secret`→`run_gitleaks <copy> working-tree`; `dependency-vuln`→`run_osv <copy>/<lockfile dal binding/registry>`; `authz|injection|crypto`→`run_semgrep <copy> <ruleset risolto dal manifest>`.
  - `normalize(<tool>, native, RUN_OPTS)` (mirror del pattern di `m5_gate_check.mjs` — riusa/replica `fileOf`, `isAuthz`, ecc.).
  - **asserisci** che il difetto seminato del registry per quella categoria sia **presente** nei finding (match per `category` + ancora `file`/`lockfile` + `cwe`/`owasp` dove dati) e **colto dall'oracolo legato** (`source_oracle` combacia). Stampa coverage dichiarata; **mai** "sicuro"/"safe".
- **Criterio 3 — VERIFIED parity:** `verified_set` vuoto → **vacuo PASS**; asserisci che nessun finding sia stato auto-promosso a `verified` (detection-only).
- **Criterio 5 — TRIGGERING (data-driven):** `classify(fixtureApp) === '<id>'` (positivo) e `classify(<dir vuota temp>) !== '<id>'` (negativo); `manifest.triggers` non vuoto.
- **Criterio 6 — IGIENE/0-contaminazione:** dopo le run sul copy, la fixture **originale** è bit-identica (`git -C <fixtureApp> status --porcelain` vuoto **oppure** hash dir invariato), workspace temp ripulito, **HEAD del repo esterno invariato** (`assertIsolatedRepo`).
- **Esito:** exit 0 sse criterio 1 **e** 2 **e** 5 **e** 6 (3 vacuo) PASS. Falsificabile: rompere un seed o azzerare il ruleset → FAIL.

- [ ] **GATE (verde, k=2):**
  - `node eval/harness/ecosystem_conformance.mjs postgres-jsts` → **PASS, exit 0**, con log che mostra il floor colto dall'oracolo legato + coverage dichiarata.
  - **Falsificabilità:** un check (mini-test o passo manuale del verifier) prova che, se si rinomina il marker `SEED:PG-S3` o si svuota il ruleset, il gate **FALLISCE** (non un verde tautologico).
  - `node eval/harness/ecosystem_conformance.mjs supabase-jsts` → **PASS** (ramo m5 invariato).

---

## FASE D (W4) — Collaudo, packaging, ledger (orchestratore)

### Task T4 — Collaudo finale + no-regressione + ledger/stato

- [ ] **Collaudo milestone (FATTO deterministico, eseguito dall'ORCHESTRATORE, L-COL-002):**
  - `ecosystem_conformance.mjs postgres-jsts` → PASS (k=2).
  - **No-regressione:** `ecosystem_conformance.mjs supabase-jsts` → PASS (**m5 56/56**); `m1..m4` + `run_eval` (detection/present) → **EXIT 0** (DB/docker permettendo); `package_skill.mjs --no-archive` → lint **VERDE**, valida anche il manifest `postgres-jsts` e ne elenca il **tier `detection`** (verified_set vuoto).
  - **Igiene:** nessun residuo temp; HEAD esterno invariato; `eval/ecosystems/postgres-jsts/reference-app` NON tracciato (gitignored).
- [ ] **Packaging:** se il lint di `package_skill` non valida/elenca già i pack per-cartella, estendilo (criterio analogo a `--inject-missing-ref`: un manifest rotto → pacchetto **non** emesso). Tier = `verified` se `verified_set≠∅` altrimenti `detection`.
- [ ] **Ledger/stato:** `00-INDEX` — nota SP-1 (primo pack nuovo; `authz-surface` come route-authz; nessun nuovo lock necessario — `L-COL-029/030` già coprono; eventuale nota sulla **regola di precedenza di `classify`**). `SESSION-STATE` — voce SP-1 (pack `postgres-jsts` tier detection, gate verde, no-regressione). Note brevi in `02`/`09`/`10` se opportuno.
- [ ] **Integrazione:** commit per gruppo logico sul branch `feat/sp1-postgres-jsts` (git **solo** orchestratore). **Merge su `main` = human-gated** (`L-COL-024`): si presenta, non si auto-merge.

---

## Definizione di "fatto" (SP-1)

- Manifest `postgres-jsts` valido; `validate_ecosystem`/`resolve` test verdi (resolve esteso, precedenza).
- `run_semgrep` accetta un ruleset path (default v1 invariato); ruleset route-authz coglie PG-S3 **senza FP** sul contrasto.
- Fixture + registry presenti; floor (secret/dependency-vuln/authz) **colto dagli oracoli legati** (fatto deterministico).
- `ecosystem_conformance.mjs postgres-jsts` **PASS** (criteri 1/2/5/6; 3 vacuo); **falsificabile**.
- **No-regressione:** `supabase-jsts` PASS (m5 **56/56**), `m1..m4`+`run_eval` EXIT 0, `package_skill` lint VERDE (+ tier `detection`).
- **0 contaminazione** (assertIsolatedRepo, 7ª prova); fixture gitignorata; merge `main` non eseguito (human-gated).
- Ledger/SESSION-STATE aggiornati. **Nessun nuovo ecosistema oltre postgres-jsts** (SP-2 = Python, fuori scope).
