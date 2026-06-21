# Plan — SP-7: tier *verified* per `postgres-jsts` (JS/TS + Postgres non-Supabase)

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Sub-progetto** | SP-7 — promozione di `postgres-jsts` da detection a **verified** (fase 2 di `L-COL-030`) |
| **Data** | 21 giugno 2026 |
| **Branch** | `feat/sp7-postgres-jsts-verified` (da `main` `2a252b0`) |
| **Metodo** | Dynamic Workflows (`L-COL-027`), test-first (`L-COL-019`), git solo nell'orchestratore (`L-COL-024`), oracle-as-judge (`L-COL-002`) |
| **Design di riferimento** | plan SP-4 (template verified Python) + plan SP-6 (verified non-Supabase + `O-COL-011`) + `00-INDEX` §4 (`L-COL-029/030`) |
| **Gate di milestone** | `ecosystem_conformance postgres-jsts` in tier **verified** + no-regressione integrale + falsificabilità |

---

## 1. Obiettivo e delta

`postgres-jsts` oggi è **detection** (`verified_set: []`, tier detection, SP-1). SP-7 lo porta a
**verified** con `verified_set: ["secret","dead-code"]`. È la promozione verified **più snella** dei sei
SP perché:

- la **macchina di fix JS** (knip dead-code, secret→`process.env`, secret-in-history→`mitigated-residual`)
  **esiste già** (m5/`supabase-jsts` verified + dispatch keyed-su-estensione di SP-4) → **nessun nuovo
  algoritmo di fix-provider**;
- `postgres-jsts` **non ha RLS-al-DB** (la sua `authz-surface` è **route-authz** via semgrep) → `rls`
  **non** entra nel `verified_set` → **nessun DB-test runtime**, nessuna `migrations/`, nessuna invarianza
  RLS a runtime. Cade l'intero T1.2 di SP-4/SP-6.

`authz` (route-authz/semgrep), `dependency-vuln`, `injection`, `crypto` restano **detection-only** (non
auto-fixabili in-scope, come injection/authz S6/S7 in v1).

## 2. Mappa di riusabilità (confermata — riesecuzione del codice)

**Riusabile as-is (nessun cambio):**
- **Corpo verified-parity** parametrico in `ecosystem_conformance.mjs` (`runVerifiedBody`, L559–785,
  criterio 3): itera **solo** su `verified_set` (L663); le categorie fuori dal set sono asserite
  **detection-only** (L752–758, `expected_fix_state ≠ verified`). Il blocco **RLS-runtime è gated** su
  `rlsRuntimeInVset = vset.includes('rls')` (L644) → con `verified_set:[secret,dead-code]` è **saltato
  per intero**. **Zero ritocco engine.**
- **Fix-provider JS** (`fix_provider.mjs:365–446`) e **loop** (`loop.mjs:64–100`): dispatch `.ts/.js` per
  secret→`process.env`, dead-code→knip (rimozione simbolo), secret-in-history→`mitigated-residual` — già
  implementato (m5/SP-4), i rami JS e Python coesistono senza interferenza.
- Oracoli `gitleaks`/`knip` (binding del manifest), `prioritize`/`fp_policy`/`explain`, `verifiedSet`.

**Codice nuovo / cambiato (delta vs detection):**
- **Fixture verify** `postgres-jsts` (T1.1): `verify_fix_check.mjs` (new), **GUARD suite JS**
  (jest/vitest/node:test — dal `test_runner` del manifest, **non** Python), **PG-S5 dead-code (knip)** e
  **PG-S6 secret-in-history** (commit→rimosso nel repo INTERNO), `registry.json` con `expected_fix_state`.
- **Binding seed-path** `postgres-jsts` nel dispatch JS del fix-provider (T2.1, additivo — i fix
  deterministici fixture-keyed riconoscono i path/simboli dei seed del pack).
- **Manifest flip** (T2.2): `verified_set` + bump `1.0.0→1.1.0` + `PACK_FIXTURES['postgres-jsts']`
  `kind:'detection'→'verified'` (**un solo campo**).

## 3. Decisioni di design (fissate qui, non si ridiscutono nel workflow)

1. **`verified_set: ["secret","dead-code"]`.** `route-authz`(semgrep)/`dependency-vuln`/`injection`/
   `crypto` restano **detection-only**. `rls` **assente** (postgres-jsts non ha RLS-al-DB).
2. **Niente RLS-runtime / DB-test / `migrations/`.** Il criterio 3 salta il blocco RLS quando
   `rls∉verified_set` (`ecosystem_conformance.mjs:644`); non si aggiunge alcun `proof_postgres_jsts.mjs`.
3. **GUARD suite = JS** (jest/vitest/node:test), non Python — è un pack JS/TS.
4. **Fix-provider deterministico:** riuso del dispatch JS di m5/SP-4; T2.1 aggiunge **solo** il binding
   dei seed `postgres-jsts` (additivo). La collocazione in `scripts/loop/fix_provider.mjs` è una
   **tensione `L-COL-029` pre-esistente** (scaffolding di eval che viaggia in `scripts/loop/`) — **NON
   si rilitiga in SP-7**.
5. **Corpo verified parametrico** (ramo `kind:'verified'`), **non** un nuovo `m5_*` delegato; resta
   data-driven sul manifest (`L-COL-029`).
6. **Secret parity onesta:** PG-S6 secret-in-history → **`mitigated-residual`** (mai `verified` finché la
   history non è riscritta, `L-COL-024`, `05` §7); PG-S1 secret working-tree → `verified`.
7. **Versioning:** `postgres-jsts` `1.0.0`→**`1.1.0`** (capability change additiva, SP-0 §5.5); il lint
   di `package_skill` deve elencarlo `(verified)`.

## 4. Task atomici + gate (test-first)

| Task | Dominio (file) | dip. | Output | GATE (asserzione automatica) | Builder · k |
|---|---|---|---|---|---|
| **T1.1** Fixture verify | `eval/ecosystems/postgres-jsts/{reference-app(bonificabile), registry.json(mod), fixture_check.mjs(+), verify_fix_check.mjs(new), reference-app/<GUARD JS test>(new), reference-app/<dead-code symbol PG-S5>(new), reference-app/<secret PG-S6 commit→rimosso INNER>}` | — | reference-app *bonificabile*: PG-S1 secret-WT, **PG-S5 dead-code/knip (new)**, **PG-S6 secret-in-history (new)**; registry `expected_fix_state`: S1/S5→`verified`, S6→`mitigated-residual`, S2/S3/S4→`detection-only`; **GUARD suite JS** per l'invarianza | `fixture_check` esteso + **falsificabile**: ogni difetto del floor colto dall'oracolo legato su **copia isolata**; contrasto pulito **0-finding**; **PG-S6 visibile a gitleaks history e assente dal working-tree**; inner-repo isolato; HEAD esterno invariato; registry coerente; bit-identico | **Opus** · k=2 |
| **T2.1** Binding seed-path → dispatch JS | `trueline/scripts/loop/fix_provider.mjs` (additivo) | T1.1 | binding deterministico dei seed `postgres-jsts` ai rami JS esistenti (secret `.ts/.js`→`process.env`, dead-code→knip, secret-in-history→`mitigated-residual`) | su **copia isolata**: PG-S1 secret→`verified` (gitleaks WT pulito), PG-S5 dead-code→`verified` (knip ri-gira **pulito**, **GUARD JS invariante**, human-gate rispettato `L-COL-021`), PG-S6→`mitigated-residual` (**mai `verified`**); **path knip/JS di m5 + `supabase-jsts` BIT-invarianti**; rami Python (`supabase-py`/`postgres-py`) intatti | **Opus** · k=2 |
| **T2.2** Manifest-flip + verified-parity *(keystone)* | `trueline/references/ecosystems/postgres-jsts/ecosystem.json` (`verified_set:[secret,dead-code]` + bump 1.1.0) + `eval/harness/ecosystem_conformance.mjs` (`PACK_FIXTURES['postgres-jsts'].kind:'verified'`) | T1.1·T2.1 | gate `ecosystem_conformance postgres-jsts` in tier verified | il gate **PASS in tier VERIFIED** (criterio 3 verde; conteggio = fatto emesso dall'harness, non pre-dichiarato) **e falsificabile** (neutralizza un fix → criterio 3 FAIL → ripristino → PASS); criterio 3: `secret`/`dead-code`→`verified` (oracolo ri-eseguito pulito), non-`verified_set` mai auto-promosse, **RLS-runtime saltato** (`rls∉vset`), coverage dichiarata, budget pinnato | **Opus** · k=2 |
| **T3.1** Integrazione + no-regressione *(orchestratore — git, SERIALE, fuori-workflow)* | riesecuzione **SERIALE** | T2.1·T2.2 | commit logici + merge human-gated + install riallineato + ledger | `postgres-jsts` PASS (verified) + falsificabilità + `supabase-jsts`=m5 **56/56**, `supabase-py` **40/40**, `postgres-py` **40/40**, `firebase-jsts` 26/26, m1..m4, run_eval, `package_skill` lint VERDE (`postgres-jsts 1.1.0 (verified)`); **0 contaminazione** (`assertIsolatedRepo`, HEAD esterno invariato); ledger annotato (**nessun nuovo lock**) | **Opus** (orchestratore) |

## 5. Ondate (DAG)

- **W1:** T1.1 (fixture verify)
- **W2:** T2.1 (binding seed → dispatch JS; gated su T1.1)
- **W3:** T2.2 (keystone, gated su T1.1 + T2.1)
- **W4 (orchestratore, fuori dal workflow):** T3.1 — riesecuzione seriale + git/merge/push

## 6. Invarianti di build (per ogni task)

- Il "verde" è un **fatto** di oracolo/harness, mai una frase dell'LLM (`L-COL-002`); la **verità** del
  gate è la riesecuzione **SERIALE** dell'orchestratore, non il green/red del workflow.
- **In-workflow ogni task gira SOLO il proprio micro-gate**; la no-regressione integrale pesante (m5
  56/56, gli altri pack) è **T3.1 seriale** — evita i falsi-rossi da contesa ambientale sui temp
  (lezione SP-0…SP-6).
- Gli agenti **non toccano il git del repo ESTERNO/canonico** (`assertIsolatedRepo`, `L-COL-024`); solo
  il **repo INTERNO** della fixture postgres-jsts è materiale di build legittimo (PG-S6). git/merge/push
  del repo esterno = orchestratore.
- `verified` solo dall'oracolo ri-eseguito pulito + test verdi; `mitigated-residual` ≠ `verified`;
  coverage sempre dichiarata; mai "sicuro" (`L-COL-006`).
- Corpo `SKILL.md` invariato (<500 righe, zero logica di ecosistema — `L-COL-014`/`L-COL-029`).
- Verifier **sempre Opus**; **k=2** sui critici (T1.1, T2.1, T2.2); **niente Haiku** (`L-COL-027`).

## 7. Definizione di "fatto" (acceptance SP-7)

`ecosystem_conformance postgres-jsts` PASS in tier **verified** (criterio 3 verde + falsificabile) **e**
no-regressione integrale (m5 56/56, supabase-py 40/40, postgres-py 40/40, firebase-jsts 26/26, m1..m4,
run_eval, package_skill lint VERDE con `postgres-jsts 1.1.0 (verified)`) **e** 0 contaminazione — il tutto
da **riesecuzione seriale** dell'orchestratore, poi merge **human-gated** su `main` (`L-COL-024`), e nota
di riconciliazione SP-7 nel ledger (`00-INDEX` §4 — **nessun nuovo lock**, fase 2 di `L-COL-030` +
raffinamento additivo di `L-COL-029`).
