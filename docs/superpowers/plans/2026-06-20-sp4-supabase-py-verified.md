# Plan — SP-4: tier *verified* per `supabase-py` (Python + Supabase)

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Sub-progetto** | SP-4 — promozione di `supabase-py` da detection a **verified** (fase 2 di `L-COL-030`) |
| **Data** | 20 giugno 2026 |
| **Branch** | `feat/sp4-supabase-py-verified` (da `main` `3fa5617`) |
| **Metodo** | Dynamic Workflows (`L-COL-027`), test-first (`L-COL-019`), git solo nell'orchestratore (`L-COL-024`), oracle-as-judge (`L-COL-002`) |
| **Design di riferimento** | SP-0 §5.3/§5.4 (promozione fase 2) + ledger `00-INDEX` §4 nota SP-3 (acceptance lockata) |
| **Gate di milestone** | `ecosystem_conformance supabase-py` in tier **verified** + no-regressione integrale + falsificabilità |

---

## 1. Obiettivo e delta

`supabase-py` oggi è **detection** (`verified_set: []`). SP-4 lo porta a **verified** con
`verified_set: ["secret","rls","dead-code"]` — **parità** con `supabase-jsts`. È l'ultimo
angolo non testato del meccanismo-manifest: il **loop verificato** su un linguaggio non-JS.

`dependency-vuln` resta **detection-only** (non auto-fixabile in-scope, come in JS).

## 2. Mappa di riusabilità (riesecuzione del codice, 3 agenti)

- **Riusabile as-is:** macchina del loop (`loop.mjs`), architettura fix-provider (`propose→Patch`),
  **fix RLS** S3/S4/S5 (DDL SQL, agnostico), fix **secret-in-history** (→`mitigated-residual`),
  **caratterizzazione RLS a runtime** (`rls_characterize.mjs`: psql + schema effimero per-pid +
  tenancy per-colonna + glob migrazioni parametrico) + degradazione static, checkpoint (dispatch
  oracoli da manifest), `verifiedSet`/`verifiedSetFrom`, oracoli gitleaks/osv/rls_check, wrapper
  `vulture` (già integrato in SP-2).
- **Riusabile con binding:** fix **secret S1** (regex+replace generico; legare path + idiom
  `os.getenv()`), bring-up DB-test (puntare le migrazioni della fixture Python allo stack Supabase),
  `generate.mjs` (parte RLS riusabile; runner pytest già in `detect_runner`).
- **Codice nuovo:** **fix dead-code Python** (`vulture`→rimozione simbolo via AST; il path
  knip→rimozione-file NON transita) · **corpo verified-parity** nel conformance per `supabase-py`
  (oggi `kind:'detection'`; `m5_gate_check.mjs` è interamente JS-cablato → non riusabile as-is) ·
  **fixture verify** + estensione del **fix-provider deterministico** ai seed Python.

## 3. Decisioni di design (fissate qui, non si ridiscutono nel workflow)

1. **Collocazione del fix-provider deterministico Python:** in `trueline/scripts/loop/fix_provider.mjs`,
   **additivo** al dispatch `selectKnownFix` (che già ospita i fix deterministici fixture-keyed JS).
   Si riusa la macchina `Patch`/apply/commit-on-branch. La logica di rimozione simbolo via AST
   (`vulture`→target) vive in un piccolo helper riusabile importato dal fix-provider.
   *Tensione `L-COL-029` (il fix-provider deterministico è scaffolding di eval che però viaggia in
   `scripts/loop/`): pre-esistente al pattern JS, NON si risolve in SP-4 (niente relitigare).*
2. **Corpo verified per `supabase-py`:** un **ramo `kind:'verified'`** in `ecosystem_conformance.mjs`
   (NON un nuovo `m5_*_py` delegato): riusa il corpo detection-parametrico per i criteri 1/2/5/6 e
   aggiunge il criterio 3 **verified-parity** parametrico (loop→`verified` per le categorie del
   `verified_set`, oracolo ri-eseguito pulito + invarianza RLS a runtime). Così il corpo resta
   **parametrico sul manifest** (`L-COL-029`), non una seconda copia JS-cablata.
3. **Secret parity onesta:** la fixture verify aggiunge un seed **secret-in-history** (commit→rimosso
   nel repo INTERNO della fixture) per provare il path `mitigated-residual` — **mai `verified`** finché
   la history non è riscritta (`L-COL-024`, `05` §7). Il secret working-tree (SPY-S1) → `verified`.
4. **`dependency-vuln` resta detection-only:** non entra nel `verified_set` (come JS).
5. **Versioning:** `supabase-py` `1.0.0`→**`1.1.0`** (capability change additiva, SP-0 §5.5); il lint
   di `package_skill` deve elencarlo `(verified)`.

## 4. Task atomici + gate (test-first)

| Task | Dominio (file) | dip. | Output | GATE (asserzione automatica) | Builder · k |
|---|---|---|---|---|---|
| **T1.1** Fixture verify | `eval/ecosystems/supabase-py/{reference-app,registry.json,fixture_check.mjs}` (+ pytest) | — | reference-app *bonificabile*: SPY-S1 secret-WT, **SPY-S6 secret-in-history (nuovo)**, SPY-S3 rls=RLS003 su `invoices` + contrasto `auth.uid()` pulito su `notes`, SPY-S5 dead-code/vulture; registry con `expected_fix_state`: S1/S3/S5→`verified`, S6→`mitigated-residual`, S2→`detection-only`; suite **pytest** per l'invarianza GUARD | `fixture_check` esteso (falsificabile): ogni difetto del floor colto dall'oracolo legato su **copia isolata**; contrasto pulito 0-finding; **secret-in-history visibile a gitleaks history e assente dal working-tree**; inner-repo isolato; HEAD esterno invariato; bit-identico | **Opus** · k=2 |
| **T1.2** DB-test runtime | `eval/db-test/*` (binding migrazioni fixture Python) + `up.ps1`/`up.sh` | T1.1 | bring-up che serve le migrazioni della fixture Python sullo stack Supabase condiviso | `proof` Python: il leak SPY-S3 su `public.invoices` riprodotto a runtime (tenant A vede righe di B) + `public.notes` isolata; **degradazione dichiarata** se psql giù (mai falso-verde) | **Sonnet** · k=1 |
| **T2.1** Fix-provider Python | `trueline/scripts/loop/fix_provider.mjs` (+ helper AST) | T1.1 | `fixDeadcodeSymbol` (vulture→AST), binding secret S1 Python (`os.getenv()`), transfer RLS S3/S4/S5 sulla migrazione Python; dispatch deterministico keyed sui seed `supabase-py` | su copia isolata: dead-code(SPY-S5)→`verified` (vulture ri-gira **pulito**, GUARD invariante, human-gate rispettato `L-COL-021`), secret(SPY-S1)→`verified` (gitleaks WT pulito) + secret-in-history(SPY-S6)→`mitigated-residual` (**mai `verified`**), rls(SPY-S3)→`verified` (rls_check pulito); **path knip/JS-S1 BIT-invarianti** (no regressione m5) | **Opus** · k=2 |
| **T2.2** Manifest-flip + corpo verified-parity *(keystone)* | `trueline/references/ecosystems/supabase-py/ecosystem.json` (`verified_set` + bump 1.1.0) + `eval/harness/ecosystem_conformance.mjs` (`kind:'verified'` + criterio 3) | T1.1·T1.2·T2.1 | gate `ecosystem_conformance supabase-py` in tier verified | il gate PASS **e falsificabile** (rimuovi il fix RLS dal provider → criterio 3 FAIL → ripristino → PASS); criterio 3: ogni categoria di `verified_set` raggiunge `verified` (oracolo pulito + invarianza RLS a runtime), non-`verified_set` mai auto-promosse, coverage dichiarata, budget pinnato | **Opus** · k=2 |
| **T3.1** Integrazione + no-regressione *(orchestratore — git)* | riesecuzione **SERIALE** | T2.1·T2.2 | commit logici + merge human-gated + install riallineato | `supabase-py` PASS (verified) + falsificabilità + `supabase-jsts`=m5 **56/56**, `postgres-jsts`/`postgres-py` 26/26, m1..m4, run_eval, `package_skill` lint VERDE (`supabase-py 1.1.0 (verified)`); **0 contaminazione** (`assertIsolatedRepo`, HEAD esterno invariato) | **Opus** (orchestratore) |

## 5. Ondate (DAG)

- **W1:** T1.1
- **W2:** T1.2 ∥ T2.1 (risorse disgiunte: DB-test vs fix-provider; entrambi gated su T1.1)
- **W3:** T2.2 (keystone, gated su T1.2 + T2.1)
- **W4 (orchestratore, fuori dal workflow):** T3.1 — riesecuzione seriale + git

## 6. Invarianti di build (per ogni task)

- Il "verde" è un **fatto** di oracolo/harness, mai una frase dell'LLM (`L-COL-002`); la **verità**
  del gate è la riesecuzione **seriale** dell'orchestratore, non il green/red del workflow.
- Gli agenti **non toccano il git del repo ESTERNO/canonico** (`assertIsolatedRepo`, `L-COL-024`);
  solo il repo INTERNO della fixture è materiale di build legittimo. git/merge/push = orchestratore.
- `verified` solo dall'oracolo ri-eseguito pulito + test verdi; `mitigated-residual` ≠ `verified`;
  coverage sempre dichiarata; mai "sicuro" (`L-COL-006`).
- Corpo `SKILL.md` invariato (<500 righe, zero logica di ecosistema — `L-COL-014`/`L-COL-029`).
- Verifier sempre Opus; k=2 sui critici (T1.1, T2.1, T2.2); niente Haiku (`L-COL-027`).

## 7. Definizione di "fatto" (acceptance SP-4)

`ecosystem_conformance supabase-py` PASS in tier **verified** (criterio 3 verde + falsificabile) **e**
no-regressione integrale (m5 56/56, postgres-jsts/py 26/26, m1..m4, run_eval, package_skill lint
VERDE con `supabase-py 1.1.0 (verified)`) **e** 0 contaminazione — il tutto da **riesecuzione seriale**
dell'orchestratore, poi merge **human-gated** su `main` (`L-COL-024`).
