# SP-3 — Terzo ecosystem pack nuovo: `supabase-py` (Python su **Supabase** con RLS) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development per implementare task-by-task. Step in checkbox (`- [ ]`).
>
> **Metodo del progetto:** ogni task è **test-first** (il gate scritto PRIMA, `L-COL-019`/`L-COL-027`); il "verde" è un **FATTO** di un comando/oracolo (`L-COL-002`), MAI una frase dell'LLM; **git solo nell'orchestratore** — gli agenti del workflow NON toccano il git ESTERNO (il git INTERNO della fixture sì, è un artefatto isolato), merge su `main` **human-gated** (`L-COL-024`). Branch: `feat/sp3-supabase-py`. La verità di un gate è la **riesecuzione SERIALE** dell'orchestratore, non il green/red del workflow (lezione SP-1/SP-2).

**Goal:** Consegnare il **terzo ecosystem pack nuovo** — `supabase-py` (Python su **Supabase**: FastAPI/Flask/Django + `psycopg`/SQLAlchemy, RLS Supabase con `auth.uid()` nelle migration `supabase/migrations/`) — come **prova del quadrante combinato `backend=supabase × lingua=py`**. È l'ultimo angolo non testato del meccanismo-manifest: copre la **classificazione 2-D** (segnale forte di backend `supabase/config.toml` **×** segnale di lingua `lang_any`). Barra-B **fase 1** (`L-COL-030`): `floor=[secret, dependency-vuln, rls]`, `verified_set=[]` (tier **detection**), `coverage_policy: declared`. Il **verified tier** (fase 2: loop verificato su Python+Supabase) è rimandato a un SP-4 dedicato (richiede corpo verified-parity nuovo + fix-provider Python + DB-test runtime + fixture verify-parity; *"niente promozione senza la sua prova"* — design §5.3).

**Architecture:** Un nuovo manifest `references/ecosystems/supabase-py/ecosystem.json` lega `secret`→gitleaks, `dependency-vuln`→osv (lockfile Python), `rls`→**`rls_check`** (`kind:"supabase-rls"`; riuso senza modifiche: `ISOLATION_TOKENS` include già `auth.uid()` **e** `current_setting(`), `injection`→semgrep (ruleset Python del pack, copia del ruleset `postgres-py`), `dead-code`→`vulture`. **`detect` è 2-D**: `files_any:["supabase/config.toml"]` (segnale forte = backend Supabase) **+** `lang_any:["pyproject.toml","requirements.txt","Pipfile","setup.py"]` (segnale = lingua Python). Poiché `supabase-py` **condivide** `files_any:["supabase/config.toml"]` con `supabase-jsts`, su un repo Supabase i due manifest **pareggiano in Passata 1** del `classify()` attuale → oggi darebbe `{ambiguous}` (sbagliato). **Il cuore-engine di SP-3** è raffinare `classify()` con un **tie-break per lingua** (`lang_any`) nella Passata 1: tra i pari-merito a segnale forte vince chi ha più match `lang_any`; pareggio anche di lingua ⇒ `{ambiguous}` onesto (Supabase senza segnale di lingua è genuinamente indecidibile JS↔Py). Il gate `ecosystem_conformance.mjs` guadagna **solo** `PACK_FIXTURES['supabase-py']` (kind:detection): il corpo detection + il ramo `rls`→`rls_check` + `binding.scan` (per `supabase/migrations`) **esistono già** da SP-1/SP-2. Floor docker-free (gitleaks+osv+rls_check; nessun binding del floor è semgrep).

**Tech Stack:** Node ESM, **solo built-in** per engine/harness. La fixture è un'app Python (FastAPI + `psycopg`) con `supabase/config.toml` (segnale forte), `requirements.txt` che pinna `PyYAML==5.3.1` (osv-flaggata, **provata** in SP-2), e `supabase/migrations/0001_init.sql` con RLS Supabase (`auth.uid()`). Vocabolario categorie = finding-category di `04`; `rls` esistente (nessuna categoria nuova). Nessun DB live (`rls_check` è STATICO sulla DDL). `vulture` + ruleset Semgrep Python già installati/presenti (SP-2).

---

## File Structure

**Nuovi (tracked):**
- `trueline/references/ecosystems/supabase-py/ecosystem.json` — manifest del pack (detect 2-D, rls `kind:supabase-rls`).
- `trueline/references/ecosystems/supabase-py/guide.md` — prosa per-modalità (authz = RLS-al-DB Supabase, `auth.uid()`).
- `trueline/references/ecosystems/supabase-py/ruleset/supabase-py-injection.yml` — ruleset semgrep Python injection (copia del `postgres-py`, self-contained per il lint di `package_skill`).
- `eval/ecosystems/supabase-py/registry.json` — registro atteso dei difetti seminati (SPY-S1..S5).
- `eval/ecosystems/supabase-py/fixture_check.mjs` — self-check della fixture (FATTI di oracoli reali).

**Nuovi (gitignored, on-disk inner repo — coperto da `eval/ecosystems/*/reference-app/`):**
- `eval/ecosystems/supabase-py/reference-app/` — app vulnerabile Python+Supabase (FastAPI + `psycopg` + `supabase/`), repo git INTERNO autonomo.

**Modificati:**
- `trueline/scripts/ecosystem/resolve.mjs` — `classify()` Passata 1: **tie-break per `lang_any`** tra pari-merito a segnale forte (additivo; default invariato per i quadranti già coperti). **Sorgente unica.**
- `trueline/scripts/ecosystem/resolve.test.mjs` — ESTESO: nuovi casi supabase×py / supabase×js / supabase×both-ambiguous / supabase-no-lang-ambiguous; i casi esistenti `package.json+config.toml`→`supabase-jsts` e `supabase/`dir→`supabase-jsts` restano verdi (preservati dal tie-break per lingua).
- `eval/harness/ecosystem_conformance.mjs` — `PACK_FIXTURES['supabase-py'] = {kind:'detection', ...}`. **Rami supabase-jsts (delega m5), postgres-jsts, postgres-py INVARIATI.**
- `00-INDEX.md` (ledger), `SESSION-STATE.md`, note in `02`/`09`/`10` se opportuno.

---

## DAG / Ondate / Model policy

```
W0 (orchestratore, pre-workflow): plan doc · branch feat/sp3-supabase-py   (no install nuovi)
W1: T1.1 manifest + guide + ruleset(copia) ... (indip.)        Sonnet / Opus
    T1.2 fixture Py+Supabase + registry + fixture_check (indip.) Opus / Opus
W2: T2.1 classify 2-D (lang tie-break) + resolve.test  dep T1.1  Opus / Opus (k=2)  ← cuore
W3: T3.1 conformance PACK_FIXTURES['supabase-py']  dep T1.1,T1.2,T2.1  Opus / Opus (k=2)
W4 (orchestratore): collaudo SERIALE + bonus + packaging + ledger + merge human-gated
```

Verifier **sempre Opus**; **k=2** su T2.1 (classify, logica delicata) e T3.1 (gate). Niente Haiku. Gli agenti **non toccano il git esterno** (solo file write; il `git init` della fixture è INTERNO/isolato). Le ondate hanno **barriera** (i file di un'ondata sono prerequisiti su disco della successiva).

---

## FASE A (W1) — Contratto + fixture del pack

### Task T1.1 — Manifest `supabase-py` (+ guide + ruleset)

**Files:** Create `trueline/references/ecosystems/supabase-py/{ecosystem.json, guide.md, ruleset/supabase-py-injection.yml}`.

- [ ] **Manifest (ESATTO):**
```json
{
  "id": "supabase-py",
  "version": "1.0.0",
  "languages": ["py"],
  "backend": "supabase-postgres",
  "detect": { "files_any": ["supabase/config.toml"], "lang_any": ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py"] },
  "triggers": ["python", "py", "fastapi", "flask", "django", "supabase", "psycopg", "psycopg2", "sqlalchemy", "alembic", "postgres", "pg", "rls", "row level security", "auth.uid", "secret", "segret", "authz", "autorizzazione", "blueprint", "audit", "remediat", "bonific", "macrotask", "oracol", "sicur", "security"],
  "oracles": {
    "secret":          { "tool": "gitleaks", "shared": true },
    "dependency-vuln": { "tool": "osv", "lockfiles": ["requirements.txt", "poetry.lock", "Pipfile.lock"] },
    "rls":             { "tool": "rls_check", "kind": "supabase-rls", "scan": ["supabase/migrations", "migrations", "db/migrations"], "role": "authz-surface" },
    "injection":       { "tool": "semgrep", "ruleset": "ruleset/" },
    "dead-code":       { "tool": "vulture" }
  },
  "test_runner": { "detect": ["pytest", "unittest"] },
  "floor":        ["secret", "dependency-vuln", "rls"],
  "verified_set": [],
  "coverage_policy": "declared"
}
```
- [ ] **guide.md** — modello `../postgres-py/guide.md`, ma: backend = **Supabase** (`auth.uid()`/`auth.jwt()` per identità dal JWT; migration in `supabase/config.toml` + `supabase/migrations/`), `rls` `kind:"supabase-rls"`; tabella di confronto: `supabase-py` ha segnale detect forte `supabase/config.toml` **+** lingua `py` (≠ `postgres-py` che è solo lang_any). Spiega il tie-break per lingua (Supabase+py→`supabase-py`, Supabase+js→`supabase-jsts`, Supabase+entrambi/nessuna-lingua→ambiguo).
- [ ] **ruleset/supabase-py-injection.yml** — COPIA di `../postgres-py/ruleset/postgres-py-injection.yml` (rinominato `id:` se necessario; stesso pattern psycopg/SQLAlchemy raw; `category:injection`, `cwe:CWE-89`, `owasp:A03:2025`). Self-contained (il lint di `package_skill` esige che il ruleset del binding esista nella cartella del pack).

- [ ] **GATE (test-first → verde):**
  - `node trueline/scripts/ecosystem/validate_ecosystem.mjs trueline/references/ecosystems/supabase-py/ecosystem.json` → **`RESULT: OK`, exit 0**.
  - `node trueline/scripts/ecosystem/validate_ecosystem.test.mjs` → verde (nessuna regressione).
  - `node trueline/scripts/ecosystem/resolve.test.mjs` → **NON deve crashare** in `loadEcosystems` (il manifest è caricabile). *(I casi nuovi di classificazione arrivano in T2.1; qui basta che il load non rompa.)*

### Task T1.2 — Fixture vulnerabile Python+Supabase + registry

**Files:** Create (gitignored inner-repo) `eval/ecosystems/supabase-py/reference-app/**`; Create (tracked) `eval/ecosystems/supabase-py/{registry.json, fixture_check.mjs}`.

**Template:** COPIA/adatta la fixture `eval/ecosystems/postgres-py/reference-app/` (leggibile su disco) e gli artefatti `eval/ecosystems/postgres-py/{registry.json, fixture_check.mjs}`. Differenze chiave Supabase:
- aggiungi `supabase/config.toml` (segnale forte) e sposta le migration in **`supabase/migrations/0001_init.sql`**.
- la RLS usa **`auth.uid()`** (Supabase) invece di `current_setting(...)`: il SEED `SPY-S3` resta **RLS003 `USING (true)`** su `public.invoices`; il **contrasto pulito** `public.notes` usa `USING (tenant_id = auth.uid())` → `rls_check` 0 finding (prova che `auth.uid()` è riconosciuto come isolamento).
- secret `SPY-S1` in `app/config.py` (DSN/clé Supabase ad alta entropia, gitleaks-catchable — mirror del pattern provato in postgres-py).
- dep vuln `SPY-S2`: `PyYAML==5.3.1` in `requirements.txt` (osv-flaggata, **provata** in SP-2).
- bonus `SPY-S4` (injection f-string, `app/routes/bookings.py`) + contrasto `%s`; bonus `SPY-S5` (dead-code `_unused_helper`, `app/dead.py`) + contrasto `used_helper` chiamato in `main.py`.

**registry.json** (mirror dello schema postgres-py). Righe FLOOR obbligatorie:

| ID | Categoria | source_oracle | owasp | cwe | anchor | scan_scope |
|---|---|---|---|---|---|---|
| **SPY-S1** | `secret` | gitleaks | A07:2025 | CWE-798 | `app/config.py` / SEED:SPY-S1 | working-tree |
| **SPY-S2** | `dependency-vuln` | osv | A06:2025 | CWE-20 | `requirements.txt` / symbol `pyyaml@5.3.1` | lockfile |
| **SPY-S3** | `rls` | rls-check | **A01:2025** | **CWE-285** | `supabase/migrations/0001_init.sql` / table `public.invoices` / policy `invoices_select` | working-tree |
| SPY-S4 *(bonus)* | `injection` | semgrep | A03:2025 | CWE-89 | `app/routes/bookings.py` / SEED:SPY-S4 | working-tree |
| SPY-S5 *(bonus)* | `dead-code` | vulture | `-` | — | `app/dead.py` / symbol `_unused_helper` | working-tree |

> **RLS cwe/owasp ENFORZATI** (oracolo autoritativo): per RLS003 `normalize('rls',…)` emette **CWE-285 / A01:2025** (mirror v1 S4 + postgres-py PY-S3). Il registry DEVE combaciare o il conformance criterio 2 fallisce.

- [ ] **git INTERNO** della fixture: `git -C <abs fixture> init -q && add -A && commit -q -m "seed: supabase-py vulnerable fixture"`. **Mai** `git` alla root esterna. (`.gitignore` copre già `eval/ecosystems/*/reference-app/`.)
- [ ] **GATE (test-first → verde):** `eval/ecosystems/supabase-py/fixture_check.mjs` (mirror postgres-py) asserisce FATTI:
  - `run_gitleaks <fixture> working-tree` → ≥1 secret in `app/config.py` (SPY-S1).
  - `run_osv <fixture>/requirements.txt` → ≥1 vuln su `pyyaml` (SPY-S2).
  - `rls_check <fixture>/supabase/migrations` → **ESATTAMENTE 1** finding RLS003 su `public.invoices` (SPY-S3) e **0** su `public.notes` (contrasto `auth.uid()`).
  - marker SEED:SPY-S4 + SEED:SPY-S5 presenti; contrasti (`%s`, `used_helper` in main.py) presenti.
  - git INTERNO pulito + HEAD esterno invariato + fixture gitignorata (`git check-ignore` + `ls-files` vuoto).

---

## FASE B (W2) — Engine: classify 2-D (cuore)

### Task T2.1 — `classify()` tie-break per lingua (Passata 1) + resolve.test

**Files:** Modify `trueline/scripts/ecosystem/resolve.mjs` (`classify`), `trueline/scripts/ecosystem/resolve.test.mjs` (ESTENDI).

**Scope (additivo):** nella Passata 1 (segnale forte `files_any`), quando più manifest pareggiano sul **massimo** numero di hit `files_any`, **rompi il pareggio per `lang_any`**: conta i match `lang_any` (file presente nel repo) di ciascun pari-merito; vince chi ne ha di più; **pareggio anche di lingua ⇒ `{ambiguous}`**. Nessun cambio alla Passata 2. Mantieni `strongSignal` (dir-marker) e la sorgente unica.

**Razionale dei casi (verifica esatta):**
- supabase+js (`package.json`+`config.toml`): sj files=1 lang=1, sp files=1 lang=0 → **supabase-jsts** *(preserva il caso esistente)*.
- supabase+`supabase/`dir+`package.json` (no config.toml): dir-marker → sj=1/lang=1, sp=1/lang=0 → **supabase-jsts** *(preserva Caso 4 / fixture canonico m5)*.
- supabase+py (`requirements.txt`/`pyproject.toml`+`config.toml`): sj files=1 lang=0, sp files=1 lang=1 → **supabase-py** *(nuovo)*.
- supabase+**entrambe** le lingue (`package.json`+`requirements.txt`+`config.toml`): lang pari → **`{ambiguous}`** [supabase-jsts, supabase-py] *(nuovo, onesto)*.
- supabase **senza** lingua (solo `config.toml`/`supabase/`dir): lang pari a 0 → **`{ambiguous}`** *(nuovo, onesto: JS↔Py indecidibile)*.
- py-only (no supabase): Passata 2 → **postgres-py** *(invariato)*; js-only → **postgres-jsts** *(invariato)*.

- [ ] **Step 1 (test-first):** estendi `resolve.test.mjs`:
  - AGGIUNGI: supabase×py→`supabase-py`; supabase×both→`{ambiguous}` con candidates `[supabase-jsts, supabase-py]`; supabase-no-lang→`{ambiguous}`.
  - PRESERVA verdi: i casi esistenti con `package.json` (Caso 1 sbReal, Caso 4 sbDirOnly, Caso C) → restano `supabase-jsts` grazie al tie-break per lingua.
  - **TRASPARENZA:** i 2 casi *sintetici* "solo `config.toml`, nessuna lingua" oggi presenti (riga ~25 "classify(supabase repo)" e Caso C riga ~88) rappresentavano "un repo Supabase": **rendili realistici aggiungendo `package.json`** (un vero progetto JS+Supabase) → restano `supabase-jsts`; e AGGIUNGI il caso esplicito "solo `config.toml`, nessuna lingua → `{ambiguous}`" che asserisce la nuova semantica onesta. Niente assertion indebolita: la fixture diventa realistica + la nuova semantica è asserita a parte.
  - py-only→`postgres-py`, js-only→`postgres-jsts`, vuoto→`null`, e TUTTI i casi SP-1/SP-2 restano verdi.
- [ ] **Step 2: esegui → FAIL** (prima del fix).
- [ ] **Step 3: implementa** il tie-break per lingua.
- [ ] **GATE (verde, k=2):** `node trueline/scripts/ecosystem/resolve.test.mjs` → **OK** (vecchi + nuovi). `node eval/harness/m5_gate_check.mjs` → **56/56** (richiede DB+docker; lo esegue l'orchestratore in W4 se l'agente non ha l'infra — l'agente assicura almeno che `classify(eval/reference-app)` resti `supabase-jsts`, prerequisito di m5).

---

## FASE C (W3) — Gate di conformità

### Task T3.1 — `ecosystem_conformance.mjs` PACK_FIXTURES['supabase-py']

**Files:** Modify `eval/harness/ecosystem_conformance.mjs`.

**Scope:** aggiungi SOLO:
```js
'supabase-py': {
  kind: 'detection',
  fixtureApp: resolve(ROOT, 'eval', 'ecosystems', 'supabase-py', 'reference-app'),
  registry: resolve(ROOT, 'eval', 'ecosystems', 'supabase-py', 'registry.json'),
},
```
Il corpo detection + il ramo `rls`→`rls_check` (con `binding.scan` per `supabase/migrations`) + `needsDocker=false` (floor senza semgrep) **esistono già** (SP-1/SP-2). Rami `supabase-jsts`/`postgres-jsts`/`postgres-py` **INVARIATI**.

- [ ] **GATE (verde, k=2):**
  - `node eval/harness/ecosystem_conformance.mjs supabase-py` → **PASS, exit 0** (criteri 1/2/3/5/6; 3 vacuo; **docker-free**), log: floor (secret/dependency-vuln/rls) colto dall'oracolo legato su **copia isolata**; `classify(fixtureApp)===supabase-py` (criterio 5, prova il tie-break per lingua end-to-end).
  - **Falsificabilità:** rimuovendo/azzerando il SEED RLS (o cambiando `USING(true)`→`auth.uid()`) il criterio 2 **FALLISCE**. Provata dal verifier.
  - `node eval/harness/ecosystem_conformance.mjs postgres-py` → **PASS 26/26** (invariato); `… postgres-jsts` → **PASS 26/26** (invariato).

---

## FASE D (W4) — Collaudo SERIALE, bonus, packaging, ledger (orchestratore)

### Task T4 — Collaudo finale + no-regressione + ledger/stato

- [ ] **Collaudo milestone — riesecuzione SERIALE dall'ORCHESTRATORE (`L-COL-002`, uno alla volta, DB up + PATH go/bin + docker per i bonus):**
  - micro-test pure-node: `validate_ecosystem.test` · `resolve.test` → verdi.
  - `fixture_check.mjs` (supabase-py) → PASS.
  - `ecosystem_conformance.mjs supabase-py` → **PASS** (k=2) + falsificabilità provata.
  - **Bonus (docker/vulture):** `run_semgrep <fixture> supabase-py/ruleset/` coglie SPY-S4 (0 FP sul contrasto `%s`); `run_deadcode --tool=vulture <fixture>` coglie SPY-S5 (0 sul contrasto `used_helper`).
  - **No-regressione:** `ecosystem_conformance.mjs supabase-jsts` → PASS (**m5 56/56**); `… postgres-jsts` 26/26; `… postgres-py` 26/26; `m1..m4` + `run_eval` → EXIT 0; `package_skill.mjs --no-archive` → lint **VERDE**, valida anche `supabase-py` e ne elenca il **tier `detection`**.
  - **Igiene:** nessun residuo `eval/.tmp-verify`; HEAD esterno invariato; `eval/ecosystems/supabase-py/reference-app` NON tracciato.
- [ ] **Packaging:** se il lint di `package_skill` non elenca già i pack per-cartella data-driven, estenderlo (manifest rotto → pacchetto non emesso). Tier = `verified` se `verified_set≠∅` altrimenti `detection`.
- [ ] **Ledger/stato:** `00-INDEX` — nota SP-3 (terzo pack; quadrante supabase×py; classify 2-D; **probabile nessun nuovo lock** — `L-COL-029/030` coprono, il tie-break per lingua è un raffinamento del meccanismo di `L-COL-029`). `SESSION-STATE` — voce SP-3. Note brevi in `02`/`09`/`10` se opportuno.
- [ ] **Integrazione:** commit per gruppo logico sul branch `feat/sp3-supabase-py` (git **solo** orchestratore). **Merge su `main` = human-gated** (`L-COL-024`): si presenta, non si auto-merge.

---

## Definizione di "fatto" (SP-3)

- Manifest `supabase-py` valido (`validate_ecosystem` OK); `resolve.test` verde (classify 2-D: supabase×py→supabase-py, supabase×js→supabase-jsts preservato, ambiguità oneste).
- Fixture + registry presenti; floor (secret/dependency-vuln/**rls**) **colto dagli oracoli legati** (fatto deterministico); `rls_check` riconosce `auth.uid()` (0 finding sul contrasto); bonus SPY-S4/S5 colti da semgrep/vulture (0 FP sui contrasti).
- `ecosystem_conformance.mjs supabase-py` **PASS** (criteri 1/2/3/5/6; 3 vacuo; **docker-free** sul floor); **falsificabile**.
- **No-regressione:** `supabase-jsts` PASS (m5 **56/56**), `postgres-jsts` 26/26, `postgres-py` 26/26, `m1..m4`+`run_eval` EXIT 0, `package_skill` lint VERDE (+ tier `detection`).
- **0 contaminazione** (assertIsolatedRepo, 9ª prova); fixture gitignorata; merge `main` non eseguito (human-gated).
- Ledger/SESSION-STATE aggiornati. **Nessun nuovo ecosistema oltre supabase-py.** Verified tier = SP-4 (separato).
