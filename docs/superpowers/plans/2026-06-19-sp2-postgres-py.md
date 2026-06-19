# SP-2 — Secondo ecosystem pack nuovo: `postgres-py` (Python su Postgres con RLS) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (o executing-plans) per implementare task-by-task. Step in checkbox (`- [ ]`).
>
> **Metodo del progetto:** ogni task è **test-first** (il gate scritto PRIMA, `L-COL-019`/`L-COL-027`); il "verde" è un **FATTO** di un comando/oracolo (`L-COL-002`), MAI una frase dell'LLM; **git solo nell'orchestratore** — gli agenti del workflow NON toccano il git ESTERNO (il git INTERNO della fixture sì, è un artefatto isolato), merge su `main` **human-gated** (`L-COL-024`). Branch: `feat/sp2-postgres-py`. La verità di un gate è la **riesecuzione SERIALE** dell'orchestratore, non il green/red del workflow (lezione SP-1).

**Goal:** Consegnare il **secondo ecosystem pack nuovo** — `postgres-py` (Python su **Postgres con RLS**: FastAPI/Flask/Django + `psycopg`/SQLAlchemy, migration `.sql` con RLS) — come **prima prova dell'asse LINGUAGGIO** del meccanismo-manifest. **Riusa** l'oracolo DB-layer language-agnostico (`rls_check`) e gli oracoli di testo (`gitleaks`, `osv`), e **introduce il tooling Python**: wrapper `vulture` (dead-code) + ruleset Semgrep Python (injection). Barra-B **fase 1** (`L-COL-030`): `floor=[secret, dependency-vuln, rls]`, `verified_set=[]` (tier **detection**), `coverage_policy: declared`.

**Architecture:** Un nuovo manifest `references/ecosystems/postgres-py/ecosystem.json` (validato da `validate_ecosystem`) lega `secret`→gitleaks, `dependency-vuln`→osv (lockfile Python), `rls`→**`rls_check`** (riuso senza modifiche: `ISOLATION_TOKENS` include già `current_setting(`, meccanismo session-var **non-Supabase**), `injection`→semgrep con ruleset Python del pack, `dead-code`→**`vulture`**. `classify()` è **data-driven** sul `lang_any`: il manifest dichiara `lang_any:[pyproject.toml, requirements.txt, Pipfile, setup.py]` → un repo Python classifica `postgres-py` **senza modifiche al codice di `classify`** (solo il test si estende). L'engine acquisisce **una** capacità nuova additiva: `run_deadcode` impara `--tool=vulture` (default `knip` invariato). Il gate `ecosystem_conformance.mjs` guadagna il **ramo `rls`→`rls_check`** in `detectCategory()` + la voce `PACK_FIXTURES['postgres-py']`. Il conformance floor (`secret`/`dependency-vuln`/`rls`) gira **senza docker** (gitleaks+osv+rls_check sono pure-node/go). `injection` (py-semgrep, docker) e `dead-code` (vulture) sono **extra non-floor**, gated da **micro-test dedicati** così restano provati da un oracolo.

**Tech Stack:** Node ESM, **solo built-in** per il codice engine/harness. La fixture è un'app Python (FastAPI + `psycopg`) con `requirements.txt` che pinna una dipendenza vulnerabile reale (osv-flaggata, da verificare con `run_osv`) e `migrations/0001_init.sql` con RLS DDL. `vulture` installato via preflight (`pip install vulture`, consent-gated `L-COL-005`). Vocabolario categorie = finding-category di `04`; `rls` è la categoria DB-layer già esistente (nessuna categoria nuova in `04`). Nessun DB live richiesto (`rls_check` è **statico** sulla DDL).

---

## File Structure

**Nuovi (tracked):**
- `trueline/references/ecosystems/postgres-py/ecosystem.json` — manifest del pack.
- `trueline/references/ecosystems/postgres-py/guide.md` — prosa per-modalità del pack.
- `trueline/references/ecosystems/postgres-py/ruleset/postgres-py-injection.yml` — ruleset semgrep Python (injection).
- `eval/ecosystems/postgres-py/registry.json` — registro atteso dei difetti seminati.
- `eval/ecosystems/postgres-py/fixture_check.mjs` — self-check della fixture (FATTI di oracoli reali).
- `trueline/scripts/oracles/run_deadcode.test.mjs` — self-test del ramo `--tool=vulture`.

**Nuovi (gitignored, on-disk inner repo — `eval/ecosystems/*/reference-app/`):**
- `eval/ecosystems/postgres-py/reference-app/` — app vulnerabile Python (FastAPI + `psycopg`), repo git INTERNO autonomo.

**Modificati:**
- `trueline/scripts/oracles/run_deadcode.mjs` — aggiunge `vulture` a `SUPPORTED_TOOLS` + ramo che esegue `vulture <dir>` e ne parsa l'output testuale → `{issues:[...]}`. **Default `knip` invariato**.
- `trueline/scripts/ecosystem/resolve.test.mjs` — ESTESO (casi di classificazione Python).
- `eval/harness/ecosystem_conformance.mjs` — `PACK_FIXTURES['postgres-py']` (kind:detection) + ramo `rls`→`rls_check` in `detectCategory()`. **Ramo `supabase-jsts` (delega a m5) e `postgres-jsts` invariati.**
- `trueline/scripts/packaging/package_skill.mjs` — (verifica) il lint valida anche il manifest `postgres-py` + ne elenca il tier `detection`.
- `00-INDEX.md` (ledger), `SESSION-STATE.md`, note in `02`/`09`/`10`.

---

## DAG / Ondate / Model policy

```
W0 (orchestratore, pre-workflow): plan doc · pip install vulture (consent) · branch feat/sp2-postgres-py
W1: T1.1 manifest+guide ......... (indip.)                  Sonnet / Opus
    T1.2 fixture+registry ....... (indip.)                  Opus / Opus
W2: T2.0 run_deadcode vulture ... (indip. da T1)            Opus / Opus (k=2)
    T2.1 classify test py ....... dep T1.1                  Sonnet / Opus
    T2.2 ruleset semgrep py ..... dep T1.2                  Opus / Opus (k=2)
W3: T3.1 conformance rls-branch . dep T1.1,T1.2,T2.0,T2.1,T2.2   Opus / Opus (k=2)
W4 (orchestratore): collaudo SERIALE + packaging + ledger + merge human-gated
```

Verifier **sempre Opus**; **k=2** su T2.0/T2.2/T3.1 (oracoli + gate: se sbagliati danno falso verde/rosso). Niente Haiku. Gli agenti **non toccano il git esterno** (solo file write; il `git init` della fixture è INTERNO/isolato).

---

## FASE A (W1) — Contratto + fixture del pack

### Task T1.1 — Manifest `postgres-py` (+ guide)

**Files:** Create `trueline/references/ecosystems/postgres-py/ecosystem.json`, `…/guide.md`, `…/ruleset/.gitkeep`.

- [ ] **Step 1: scrivi il manifest** (ESATTO):

```json
{
  "id": "postgres-py",
  "version": "1.0.0",
  "languages": ["py"],
  "backend": "postgres",
  "detect": { "lang_any": ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py"] },
  "triggers": ["python", "py", "fastapi", "flask", "django", "psycopg", "psycopg2", "sqlalchemy", "alembic", "postgres", "pg", "rls", "row level security", "secret", "segret", "authz", "autorizzazione", "blueprint", "audit", "remediat", "bonific", "macrotask", "oracol", "sicur", "security"],
  "oracles": {
    "secret":          { "tool": "gitleaks", "shared": true },
    "dependency-vuln": { "tool": "osv", "lockfiles": ["requirements.txt", "poetry.lock", "Pipfile.lock"] },
    "rls":             { "tool": "rls_check", "scan": ["migrations", "db/migrations", "supabase/migrations"] },
    "injection":       { "tool": "semgrep", "ruleset": "ruleset/" },
    "dead-code":       { "tool": "vulture" }
  },
  "test_runner": { "detect": ["pytest", "unittest"] },
  "floor":        ["secret", "dependency-vuln", "rls"],
  "verified_set": [],
  "coverage_policy": "declared"
}
```

> **Nota validità:** `validate_ecosystem` deve accettare questo manifest. Se il validatore rifiuta `languages:["py"]`, il binding `rls`→`rls_check`, il tool `vulture`, o il campo `oracles.rls.scan`, **estendere il validatore test-first** (è una capacità additiva legittima, default invariato), oppure adeguare lo schema `_schema/ecosystem.schema.json`. Verificare i 9 controlli esistenti restino verdi.

- [ ] **Step 2: guide.md** — prosa breve sul modello `../postgres-jsts/guide.md`: stack (Python + Postgres con RLS, FastAPI/Flask/Django + `psycopg`/SQLAlchemy), cosa copre il pack (floor in detection: secret/dependency-vuln/**rls**; coverage dichiarata; nessun loop verificato — fase 1), e come l'authz qui = **RLS-al-DB** (`rls_check` statico sulla DDL, riconosce `current_setting(...)` per il Postgres non-Supabase), con injection (py-semgrep) e dead-code (vulture) come extra.

- [ ] **GATE (test-first → verde):**
  - `node trueline/scripts/ecosystem/validate_ecosystem.mjs trueline/references/ecosystems/postgres-py/ecosystem.json` → **`RESULT: OK`, exit 0**.
  - `node trueline/scripts/ecosystem/validate_ecosystem.test.mjs` → **verde** (nessuna regressione; eventuali nuovi casi additivi inclusi).
  - `node trueline/scripts/ecosystem/resolve.test.mjs` → resta verde (il load del nuovo manifest non rompe `loadEcosystems`).

### Task T1.2 — Fixture vulnerabile + registry

**Files:** Create (gitignored inner-repo) `eval/ecosystems/postgres-py/reference-app/**`; Create (tracked) `eval/ecosystems/postgres-py/registry.json` e `eval/ecosystems/postgres-py/fixture_check.mjs`.

**App (Python, FastAPI + `psycopg`):** struttura minima ma realistica:
```
eval/ecosystems/postgres-py/reference-app/
  requirements.txt        # deps: fastapi, uvicorn, psycopg, + 1 dep VULN seminata (osv-flaggata)
  pyproject.toml          # marker di linguaggio (classify)
  app/__init__.py
  app/main.py             # monta FastAPI + registra le rotte
  app/config.py           # SEED:PY-S1 — secret hardcoded (DSN con password / API key ad alta entropia)
  app/db.py               # connessione psycopg; query helper
  app/routes/bookings.py  # SEED:PY-S4 (injection bonus: cur.execute(f"... {id}")) + rotta PULITA (execute con %s param)
  app/dead.py             # SEED:PY-S5 (dead-code bonus: funzione/variabile non usata) + simbolo usato di contrasto
  migrations/0001_init.sql# SEED:PY-S3 (rls) + tabella PULITA di contrasto con current_setting
```

**Difetti seminati (i 3 del FLOOR sono obbligatori; il gate li richiede):**

| ID | Categoria | Posizione | Oracolo | scan_scope | expected_fix_state |
|---|---|---|---|---|---|
| **PY-S1** | `secret` | `app/config.py` — literal ad alta entropia (`SEED:PY-S1`) es. DSN `postgresql://app:R3al_pw_live_…@host/db` o `API_KEY="sk_live_…"` | gitleaks (working-tree) | `working-tree` | `detection` |
| **PY-S2** | `dependency-vuln` | `requirements.txt` — una dep con versione **realmente vulnerabile** flaggata da osv (es. `PyYAML==5.3.1` / `Jinja2==2.11.2` / `requests==2.19.1` — **verificare con `run_osv`**, scegliere quella che osv flagga davvero) | osv (lockfile) | `lockfile` | `detection` |
| **PY-S3** | `rls` | `migrations/0001_init.sql` — tabella multi-tenant `public.invoices(tenant_id,…)` con RLS abilitato ma policy `USING (true)` (**RLS003**) — o in alternativa tabella in public **senza** RLS (**RLS001**) | `rls_check` (static-ddl) | `working-tree` | `detection` |
| *(contrasto)* | — | `migrations/0001_init.sql` — tabella `public.notes(tenant_id,…)` con RLS + policy `USING (tenant_id = current_setting('app.current_tenant')::uuid)` | `rls_check` → **0 finding** (prova che `current_setting` non-Supabase è riconosciuto come isolamento) | — | — |
| PY-S4 *(bonus, non-floor)* | `injection` | `app/routes/bookings.py` — `cur.execute(f"SELECT … WHERE id = {req_id}")` (+ contrasto parametrizzato `%s`) | semgrep + ruleset Python del pack | `working-tree` | `detection` |
| PY-S5 *(bonus, non-floor)* | `dead-code` | `app/dead.py` — funzione/variabile **non usata** (+ simbolo usato di contrasto) | vulture | `working-tree` | `detection` |

- [ ] **Step 1:** scrivi l'app + `requirements.txt` (deps reali, incl. la dep vulnerabile **verificata via `run_osv`**). I file Python devono essere sintatticamente coerenti per gli oracoli statici (gitleaks/semgrep/osv/vulture leggono il testo, non eseguono; `vulture` parsa l'AST Python → i `.py` devono essere **parsabili**).
- [ ] **Step 2:** inizializza il **git INTERNO** della fixture (artefatto isolato, gitignorato dal repo esterno): `git -C <abs path della fixture> init -q && add -A && commit -q -m "seed: postgres-py vulnerable fixture"`. **Mai** `git` alla root del repo esterno. Aggiungere `eval/ecosystems/postgres-py/reference-app/` a `.gitignore` se il pattern `eval/ecosystems/*/reference-app/` non lo copre già.
- [ ] **Step 3:** scrivi `eval/ecosystems/postgres-py/registry.json` — schema `{ ecosystem, defects:[ { id, category, source_oracle, owasp, cwe, expected_fix_state, anchor:{file, marker|table|policy|symbol, lockfile?}, scan_scope, notes } ] }`. **Per `rls` (oracolo AUTORITATIVO):** `cwe`/`owasp` devono **combaciare** con ciò che `normalize('rls', …)` emette per quel control_id (il conformance li ENFORZA per i nostri oracoli) — mirrorare le voci rls del registry Supabase `eval/harness/expected/registry.json` (S3/S4/S5) per il control_id corrispondente. Per `dependency-vuln` (osv, esterno) il cwe/owasp è confronto **soft** (mappa provvisoria 04): basta `anchor.lockfile` + `anchor.symbol` (es. `PyYAML==5.3.1`).

- [ ] **GATE (test-first → verde):** `eval/ecosystems/postgres-py/fixture_check.mjs` (tracked) asserisce **FATTI di oracoli reali**, NON ispezione LLM:
  - `run_gitleaks <fixture> working-tree` → trova ≥1 secret in `app/config.py` (PY-S1).
  - `run_osv <fixture>/requirements.txt` → trova ≥1 vulnerabilità sulla dep seminata (PY-S2).
  - `rls_check <fixture>/migrations` → **trova** il difetto su `public.invoices` (PY-S3) e **0 finding** su `public.notes` (contrasto `current_setting`).
  - (PY-S4 gated da T2.2; PY-S5 gated da T2.0.) Verifica che i marker `SEED:PY-S4`/`SEED:PY-S5` esistano.
  - `git -C <fixture> status --porcelain` vuoto + HEAD del repo ESTERNO invariato.

---

## FASE B (W2) — Engine: tooling Python (additivo, default v1 invariato)

### Task T2.0 — `run_deadcode` impara `--tool=vulture`

**Files:** Modify `trueline/scripts/oracles/run_deadcode.mjs`; Create `trueline/scripts/oracles/run_deadcode.test.mjs`.

**Scope:** aggiungere `'vulture'` a `SUPPORTED_TOOLS` e un ramo che esegue `vulture <project-dir>` (o `python -m vulture <project-dir>`), ne **parsa l'output testuale** (`path:line: unused function 'x' (NN% confidence)`) → `{ issues: [{ file, line, type, name, confidence }], tool: 'vulture' }` su stdout. Exit 0 se vulture gira (issue trovate = informazione, non errore); 1 se vulture non trovato / dir inesistente. **Default (`knip`, nessun flag) IDENTICO a oggi.** Tool sconosciuto → resta `{issues:[], note}` (mai falso verde).

- [ ] **Step 1: test (FALLISCE finché il ramo non c'è):** `run_deadcode.test.mjs`:
  - default (nessun `--tool`) → invariato (knip path: con un progetto knip noto, o almeno che il dispatch resti `knip`).
  - `--tool=vulture <fixture>` → emette JSON valido con ≥1 issue che combacia con `SEED:PY-S5` (funzione/variabile non usata), e **0** sul simbolo usato di contrasto. *(richiede `vulture` installato.)*
  - `--tool=sconosciuto` → `{issues:[], note}` exit 0 (invariato).
- [ ] **Step 2: esegui → FAIL.**
- [ ] **Step 3: implementa** il ramo vulture (default invariato).
- [ ] **GATE (verde, k=2):**
  - `node trueline/scripts/oracles/run_deadcode.test.mjs` → OK.
  - **Regressione:** `node eval/harness/m5_gate_check.mjs` → **56/56** (il path dead-code default resta knip). *(richiede DB + docker)*

### Task T2.1 — `classify()` riconosce Python (data-driven, solo test)

**Files:** Modify `trueline/scripts/ecosystem/resolve.test.mjs` (ESTENDI). **NON** serve toccare `classify()` (è già data-driven sul `lang_any`).

- [ ] **Step 1: estendi il test (FALLISCE finché il manifest `postgres-py` non è caricabile):**
  - repo con solo `pyproject.toml`/`requirements.txt` (no `package.json`, no `supabase/`) ⇒ `classify === 'postgres-py'`.
  - repo con `supabase/config.toml` ⇒ resta `'supabase-jsts'` (strong-signal); repo con solo `package.json` ⇒ `'postgres-jsts'` (anti-regressione).
  - repo con **sia** `package.json` **sia** `requirements.txt` ⇒ esito `{ambiguous}` (proponi+conferma, mai verde silenzioso).
  - repo vuoto ⇒ `null`. I **casi esistenti** restano verdi.
- [ ] **Step 2: esegui → FAIL** (manifest non ancora presente o test non esteso).
- [ ] **Step 3:** se i test passano col solo manifest T1.1, nessuna modifica a `classify`; se emerge un gap reale nella precedenza, fixare **test-first** e additivo.
- [ ] **GATE (verde):** `node trueline/scripts/ecosystem/resolve.test.mjs` → OK (vecchi + nuovi). `m5_gate_check.mjs` invariato.

### Task T2.2 — Ruleset semgrep Python (injection) per `postgres-py`

**Files:** Create `trueline/references/ecosystems/postgres-py/ruleset/postgres-py-injection.yml`.

**Scope:** regola/e Semgrep `languages: [python]` che colgono **SQL injection** generica per stack `psycopg`/SQLAlchemy raw: una `execute(...)` su cursor/connection il cui argomento è una **stringa costruita dinamicamente** (f-string, `%`-format, `+`-concat, `.format()`) con input di richiesta. Precisione: **deve** colpire `SEED:PY-S4` e **NON** la query parametrizzata di contrasto (`execute("… %s", (x,))`). Niente FP su query statiche.
- **sink:** `$CUR.execute($Q)` / `$CONN.execute($Q)` dove `$Q` = f-string / `% (...)` / `+` / `.format(...)`.
- **esclusione:** secondo arg di parametri (`execute($SQL, $PARAMS)`) con `$SQL` literal → no finding.
- **metadata:** `category: injection`, `cwe: CWE-89`, `owasp: A03:2025` (coerente con registry + normalize 04).

- [ ] **Step 1: il gate È il test** (test-first): la regola si scrive per far passare l'asserzione contro la fixture T1.2.
- [ ] **GATE (verde, k=2):**
  - `node trueline/scripts/oracles/run_semgrep.mjs eval/ecosystems/postgres-py/reference-app trueline/references/ecosystems/postgres-py/ruleset/` → normalizzato con `normalize('semgrep', …)`:
    - **trova** un finding `category:injection`, file `app/routes/bookings.py`, `cwe:CWE-89` (PY-S4);
    - **0 finding** sulla query parametrizzata di contrasto e sulle rotte pulite.
  - *(richiede docker)*. Builder **Opus** (precisione pattern), verifier **Opus k=2**.

---

## FASE C (W3) — Gate di conformità: ramo `rls`→`rls_check`

### Task T3.1 — `ecosystem_conformance.mjs` corpo detection per `postgres-py`

**Files:** Modify `eval/harness/ecosystem_conformance.mjs`.

**Scope:** mantieni i rami `supabase-jsts` (delega a m5) e `postgres-jsts` (detection) INVARIATI. Aggiungi:
1. `PACK_FIXTURES['postgres-py'] = { kind:'detection', fixtureApp: …/postgres-py/reference-app, registry: …/postgres-py/registry.json }`.
2. In `detectCategory()`, il ramo `tool === 'rls_check' || tool === 'rls'`:
   - risolve la lista di dir/migration dal binding (`binding.scan` → es. `['migrations', …]`, la prima che esiste nella copia) o default `migrations`;
   - esegue `rls_check <copy>/<scanDir>` (pure-node + pgsql-ast-parser, **niente docker/DB**);
   - `normalize('rls', native, opts)` → finding `category:'rls'`, `source_oracle.oracle:'rls-check'`.
   - asserisce che il SEED `rls` del registry (PY-S3) sia COLTO (categoria `rls` + ancora `file` (`migrations/0001_init.sql`) + `cwe`/`owasp` ENFORZATI, oracolo autoritativo) e **NON** il contrasto (la copia contiene anche `notes` con `current_setting`: nessun finding su quella tabella).

> **`needsDocker`:** con `floor=[secret, dependency-vuln, rls]` nessun binding del floor è `semgrep` → il preflight docker **non scatta**: il conformance `postgres-py` gira docker-free (gitleaks/osv via go/bin, rls_check pure-node). Mantenere questa proprietà.

- [ ] **GATE (verde, k=2):**
  - `node eval/harness/ecosystem_conformance.mjs postgres-py` → **PASS, exit 0** (criteri 1/2/3/5/6; 3 vacuo), con log che mostra il floor (secret/dependency-vuln/rls) colto dall'oracolo legato su **copia isolata** + coverage dichiarata.
  - **Falsificabilità:** rinominando il marker/seed RLS (o azzerando la tabella seminata) il criterio 2 **FALLISCE** (non verde tautologico). Provato dal verifier.
  - `node eval/harness/ecosystem_conformance.mjs supabase-jsts` → **PASS** (ramo m5 invariato); `… postgres-jsts` → **PASS 26/26** (invariato).

---

## FASE D (W4) — Collaudo SERIALE, packaging, ledger (orchestratore)

### Task T4 — Collaudo finale + no-regressione + ledger/stato

- [ ] **Collaudo milestone — riesecuzione SERIALE dall'ORCHESTRATORE (`L-COL-002`, lezione SP-1: uno alla volta, niente concorrenza, DB up + PATH go/bin):**
  - micro-test pure-node: `validate_ecosystem.test` · `resolve.test` · `run_deadcode.test` → verdi.
  - `ecosystem_conformance.mjs postgres-py` → **PASS** (k=2).
  - **No-regressione:** `ecosystem_conformance.mjs supabase-jsts` → PASS (**m5 56/56**); `ecosystem_conformance.mjs postgres-jsts` → **26/26**; `m1..m4` + `run_eval` (detection/present) → **EXIT 0**; `package_skill.mjs --no-archive` → lint **VERDE**, valida anche il manifest `postgres-py` e ne elenca il **tier `detection`**.
  - **Igiene:** nessun residuo `eval/.tmp-verify`; HEAD esterno invariato; `eval/ecosystems/postgres-py/reference-app` NON tracciato.
- [ ] **Packaging:** se il lint di `package_skill` non valida/elenca già i pack per-cartella in modo data-driven, estenderlo (un manifest rotto → pacchetto **non** emesso). Tier = `verified` se `verified_set≠∅` altrimenti `detection`.
- [ ] **Ledger/stato:** `00-INDEX` — nota SP-2 (primo pack non-JS/TS; `rls_check` provato language-agnostico; `vulture` + py-semgrep introdotti; probabile **nessun nuovo lock** — `L-COL-029/030` coprono). `SESSION-STATE` — voce SP-2. Note brevi in `02`/`09`/`10` se opportuno.
- [ ] **Integrazione:** commit per gruppo logico sul branch `feat/sp2-postgres-py` (git **solo** orchestratore). **Merge su `main` = human-gated** (`L-COL-024`): si presenta, non si auto-merge.

---

## Definizione di "fatto" (SP-2)

- Manifest `postgres-py` valido; `validate_ecosystem`/`resolve` test verdi (resolve esteso, classificazione Python).
- `run_deadcode --tool=vulture` coglie PY-S5 (default `knip` invariato); ruleset semgrep Python coglie PY-S4 **senza FP** sul contrasto parametrizzato.
- Fixture + registry presenti; floor (secret/dependency-vuln/**rls**) **colto dagli oracoli legati** (fatto deterministico); `rls_check` riconosce `current_setting` (0 finding sul contrasto).
- `ecosystem_conformance.mjs postgres-py` **PASS** (criteri 1/2/5/6; 3 vacuo; **docker-free**); **falsificabile**.
- **No-regressione:** `supabase-jsts` PASS (m5 **56/56**), `postgres-jsts` **26/26**, `m1..m4`+`run_eval` EXIT 0, `package_skill` lint VERDE (+ tier `detection`).
- **0 contaminazione** (assertIsolatedRepo, 8ª prova); fixture gitignorata; merge `main` non eseguito (human-gated).
- Ledger/SESSION-STATE aggiornati. **Nessun nuovo ecosistema oltre postgres-py.**
