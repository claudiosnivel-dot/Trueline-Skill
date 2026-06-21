# Plan — SP-6: tier *verified* per `postgres-py` (Python + Postgres non-Supabase)

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Sub-progetto** | SP-6 — promozione di `postgres-py` da detection a **verified** (fase 2 di `L-COL-030`) + **scioglimento `O-COL-011`** |
| **Data** | 21 giugno 2026 |
| **Branch** | `feat/sp6-postgres-py-verified` (da `main` `c72b969`) |
| **Metodo** | Dynamic Workflows (`L-COL-027`), test-first (`L-COL-019`), git solo nell'orchestratore (`L-COL-024`), oracle-as-judge (`L-COL-002`) |
| **Design di riferimento** | SP-0 §5.2/§5.3/§5.4 (engine manifest-driven + promozione fase 2) + plan SP-4 (template del verified Python) + ledger `00-INDEX` §5 (`O-COL-011`) |
| **Gate di milestone** | `ecosystem_conformance postgres-py` in tier **verified** + no-regressione integrale + falsificabilità |

---

## 1. Obiettivo e delta

`postgres-py` oggi è **detection** (`verified_set: []`). SP-6 lo porta a **verified** con
`verified_set: ["secret","rls","dead-code"]` — parità con `supabase-py` (SP-4) e i pack JS verified.
È la **prima promozione verified di un ecosistema non-Supabase**, quindi è anche il **trigger
nominato nel ledger per sciogliere `O-COL-011`** (dispatch dei fix/loop: manifest-driven vs
keyed-su-path).

`dependency-vuln` e `injection` restano **detection-only** (non auto-fixabili in-scope, come in JS).

## 2. Mappa di riusabilità (riesecuzione del codice, 3 reader paralleli)

**Riusabile as-is (backend-agnostico, confermato):**
- Corpo **verified-parity** parametrico in `ecosystem_conformance.mjs` (`runVerifiedBody`, criterio 3):
  fix-provider per finding, oracolo ri-eseguito pulito su copia isolata, invarianza RLS a runtime,
  `mitigated-residual` mai `verified`, non-`verified_set` mai auto-promosse — **tutto data-driven**
  sul manifest+registry. Il flip è `PACK_FIXTURES[id].kind:'verified'` + `verified_set` nel manifest.
- `py_deadcode_edit.mjs` (`removePySymbol`, AST per-indentazione, nessuna assunzione backend).
- `normalize.mjs` → `normalizeVulture` (fingerprint per-**simbolo**, generico).
- `loop.mjs` rami **secret** (path-pattern `.py`) e **dead-code** (`.py`→vulture) — invariati.
- `rls_check` oracolo: già language/backend-agnostico (`ISOLATION_TOKENS` include `current_setting(`).
- `proof` runtime: `rls_characterize.mjs` schema-agnostico; il container `supabase_db_trueline-db-test`
  è un Postgres puro → riusato dal proof postgres-py (schema effimero per-pid).

**Codice nuovo / cambiato (delta vs SP-4):**
- **Seam RLS scan manifest-driven** (`O-COL-011`): 3 script *spediti* cablano `supabase/migrations`
  (`fix_provider.mjs` L31/L185/L301 · `loop.mjs` L82 · `rls_characterize.mjs` L270/L163), mentre
  postgres-py usa `migrations/`. → helper `resolveRlsScanDir(dir, manifest)` che legge
  `oracles.rls.scan`; default `supabase/migrations` ⇒ **BIT-invariante** per supabase. **(T1.0)**
- **Idioma RLS postgres** nel fix-provider: il transfer RLS deve iniettare una policy basata su
  **`current_setting(...)`** (non `auth.uid()`), per matchare il contrasto pulito del fixture. **(T2.1)**
- **Fixture verify** postgres-py: `verify_fix_check.mjs`, pytest GUARD, PY-S6 secret-in-history,
  registry `expected_fix_state`. **(T1.1)**
- **DB-test proof** postgres-py: `proof_postgres_py.mjs` (riusa `rls_characterize` post-T1.0). **(T1.2)**

## 3. Decisioni di design (fissate qui, non si ridiscutono nel workflow)

1. **`O-COL-011` sciolta verso il dispatch RLS scan manifest-driven (via A).** L'engine non cabla la
   migration-dir: la chiede al manifest risolto (`oracles.rls.scan`, primo dir esistente), default
   `supabase/migrations`. È l'applicazione diretta di `L-COL-029`; SP-6 è il trigger esatto (primo
   verified non-Supabase). Vie respinte: (B) far usare al fixture il layout `supabase/migrations`
   (bugia di fixture — postgres-py è non-Supabase); (C) hardcodare più path (debito, non
   manifest-driven).
2. **Collocazione del fix-provider deterministico:** resta in `trueline/scripts/loop/fix_provider.mjs`
   (additivo al dispatch esistente). La tensione `L-COL-029` (il fix-provider deterministico è
   scaffolding di eval che però viaggia in `scripts/loop/`) **pre-esiste** ed è ortogonale a `O-COL-011`
   (che riguarda la *risoluzione del path RLS*, ora manifest-driven). NON si relitiga qui.
3. **Corpo verified per `postgres-py`:** riuso del ramo `kind:'verified'` parametrico (NON un nuovo
   `m5_*` delegato); il corpo resta parametrico sul manifest (`L-COL-029`).
4. **Secret parity onesta:** la fixture verify aggiunge PY-S6 **secret-in-history** (commit→rimosso nel
   repo INTERNO) per provare il path `mitigated-residual` — **mai `verified`** finché la history non è
   riscritta (`L-COL-024`, `05` §7). Il secret working-tree (PY-S1) → `verified`.
5. **`dependency-vuln`/`injection` restano detection-only:** non entrano nel `verified_set`.
6. **Versioning:** `postgres-py` `1.0.0`→**`1.1.0`** (capability change additiva, SP-0 §5.5); il lint
   di `package_skill` deve elencarlo `(verified)`.

## 4. Task atomici + gate (test-first)

| Task | Dominio (file) | dip. | Output | GATE (asserzione automatica) | Builder · k |
|---|---|---|---|---|---|
| **T1.0** Seam RLS scan manifest-driven *(O-COL-011)* | `scripts/loop/fix_provider.mjs` · `scripts/loop/loop.mjs` · `scripts/characterization/rls_characterize.mjs` (+ helper `resolveRlsScanDir`) | — | i 3 script leggono `oracles.rls.scan`; default `supabase/migrations` | micro-test: risolve `migrations` per postgres-py, `supabase/migrations` per supabase; falsificabile (rompi resolver → supabase RLS verified FAIL). **NB: la no-regressione integrale (supabase-py 40/40, m5 56/56) è T3.1 seriale, non in-workflow.** | **Opus** · k=2 |
| **T1.1** Fixture verify | `eval/ecosystems/postgres-py/{verify_fix_check.mjs(new), fixture_check.mjs(+), registry.json(mod), reference-app/tests/test_characterization.py(new), reference-app/app/legacy_credentials.py(PY-S6)}` | — | reference-app bonificabile; PY-S6 secret-in-history (2 commit nel repo INTERNO); registry `expected_fix_state` S1/S3/S5→`verified`, S2/S4→`detection-only`, S6→`mitigated-residual`; pytest GUARD (valori env non-segreti) | `fixture_check` esteso (~23→~36), falsificabile: floor colto dall'oracolo legato su **copia isolata**; contrasto pulito (`notes`/`current_setting`) **0-finding**; PY-S6 visibile a gitleaks history **e assente dal working-tree**; inner-repo isolato; HEAD esterno invariato; registry coerente | **Opus** · k=2 |
| **T1.2** DB-test runtime Postgres | `eval/db-test/proof_postgres_py.mjs` | T1.0·T1.1 | bring-up che serve `migrations/` della fixture Python sul Postgres condiviso | `proof`: leak PY-S3 su `public.invoices` riprodotto a runtime (tenant A vede righe di B) + `public.notes` isolata; **degradazione dichiarata** se psql giù (mai falso-verde) | **Sonnet** · k=1 |
| **T2.1** Idioma RLS postgres + binding fix-provider | `trueline/scripts/loop/fix_provider.mjs` | T1.0·T1.1 | fix RLS PY-S3 (`current_setting`), bind seed postgres-py; secret/dead-code riusano ramo `.py` | su copia isolata: secret(PY-S1)→`verified` (gitleaks WT pulito), dead-code(PY-S5)→`verified` (vulture pulito, GUARD pytest invariante, human-gate `L-COL-021`), rls(PY-S3)→`verified` (rls_check pulito, policy `current_setting`), PY-S6→`mitigated-residual` (**mai `verified`**); **knip/JS + supabase-py path BIT-invarianti** | **Opus** · k=2 |
| **T2.2** Manifest-flip + verified-parity *(keystone)* | `trueline/references/ecosystems/postgres-py/ecosystem.json` (`verified_set` + bump 1.1.0) + `eval/harness/ecosystem_conformance.mjs` (`PACK_FIXTURES['postgres-py'].kind:'verified'`) | T1.0·T1.1·T1.2·T2.1 | gate `ecosystem_conformance postgres-py` in tier verified | il gate PASS **e falsificabile** (neutralizza il fix RLS → criterio 3 FAIL → ripristino → PASS); criterio 3: ogni categoria di `verified_set`→`verified` (oracolo pulito + invarianza RLS a runtime), non-`verified_set` mai auto-promosse, coverage dichiarata, budget pinnato | **Opus** · k=2 |
| **T3.1** Integrazione + no-regressione *(orchestratore — git)* | riesecuzione **SERIALE** | T2.1·T2.2 | commit logici + merge human-gated + install riallineato + ledger | `postgres-py` PASS (verified) + falsificabilità + `supabase-jsts`=m5 **56/56**, `supabase-py` **40/40**, `postgres-jsts`/`firebase-jsts` 26/26, m1..m4, run_eval, `package_skill` lint VERDE (`postgres-py 1.1.0 (verified)`); **0 contaminazione** (`assertIsolatedRepo`, HEAD esterno invariato); **`O-COL-011` sciolta** nel ledger | **Opus** (orchestratore) |

## 5. Ondate (DAG)

- **W1:** T1.0 ∥ T1.1 (file disgiunti: 3 script engine vs fixture eval)
- **W2:** T1.2 ∥ T2.1 (dopo T1.0 disgiunti: DB-test/proof vs fix-provider)
- **W3:** T2.2 (keystone, gated su tutto)
- **W4 (orchestratore, fuori dal workflow):** T3.1 — riesecuzione seriale + git/merge/push

## 6. Invarianti di build (per ogni task)

- Il "verde" è un **fatto** di oracolo/harness, mai una frase dell'LLM (`L-COL-002`); la **verità**
  del gate è la riesecuzione **seriale** dell'orchestratore, non il green/red del workflow.
- **In-workflow ogni task gira SOLO il proprio micro-gate**; la no-regressione integrale pesante
  (m5 56/56 con DB+semgrep, gli altri pack) è **T3.1 seriale** — evita i falsi-rossi da contesa
  ambientale sui temp (lezione SP-0…SP-5).
- Gli agenti **non toccano il git del repo ESTERNO/canonico** (`assertIsolatedRepo`, `L-COL-024`);
  solo il repo INTERNO della fixture postgres-py è materiale di build legittimo (PY-S6).
  git/merge/push del repo esterno = orchestratore.
- `verified` solo dall'oracolo ri-eseguito pulito + test verdi; `mitigated-residual` ≠ `verified`;
  coverage sempre dichiarata; mai "sicuro" (`L-COL-006`).
- Corpo `SKILL.md` invariato (<500 righe, zero logica di ecosistema — `L-COL-014`/`L-COL-029`).
- Verifier sempre Opus; k=2 sui critici (T1.0, T1.1, T2.1, T2.2); niente Haiku (`L-COL-027`).

## 7. Definizione di "fatto" (acceptance SP-6)

`ecosystem_conformance postgres-py` PASS in tier **verified** (criterio 3 verde + falsificabile) **e**
no-regressione integrale (m5 56/56, supabase-py 40/40, postgres-jsts/firebase-jsts 26/26, m1..m4,
run_eval, package_skill lint VERDE con `postgres-py 1.1.0 (verified)`) **e** 0 contaminazione — il
tutto da **riesecuzione seriale** dell'orchestratore, poi merge **human-gated** su `main`
(`L-COL-024`), e **`O-COL-011` annotata sciolta** nel ledger (`00-INDEX` §5 → chiusa: dispatch RLS
scan manifest-driven).
