# Plan — BD-1: Disciplina di costruzione per la modalità BUILD

> **Per gli esecutori:** questo piano si esegue col metodo del progetto — **Dynamic Workflows** (`L-COL-027`), un task atomico per builder, **test-first** (il GATE scritto prima del build, `L-COL-019`), **git solo nell'orchestratore** (`L-COL-024`), **oracle-as-judge** (`L-COL-002`). NON è il formato a micro-step di superpowers: ogni task porta il **proprio gate falsificabile** che l'harness/oracolo emette come fatto.

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Sub-progetto** | **BD-1** — disciplina di costruzione per BUILD (riequilibrio metà BUILD di `L-COL-015`) |
| **Data** | 24 giugno 2026 |
| **Branch** | `feat/build-discipline-spec` (già creato, spec committata `e7afcdd`) → estendere qui |
| **Spec di riferimento** | `docs/superpowers/specs/2026-06-24-build-discipline-design.md` (rivista post-review, 1 blocking + 6 major chiusi) |
| **Gate di milestone** | nuovo `eval/harness/build_discipline_check.mjs` PASS (3 sotto-test falsificabili) + no-regressione integrale + 0-contaminazione |
| **Nuovo lock** | `L-COL-031` (disciplina di costruzione BUILD) |

---

## Global Constraints (valgono per OGNI task)

- **Oracle-as-judge** (`L-COL-002`): ogni "verde" è un fatto di comando/harness (exit/output), **mai** una frase dell'LLM. L'unico gate *nuovo* è **deterministico** (`ac_observability_check`).
- **Determinismo** (`L-COL-002`): **niente `Date.now()`/`Math.random()`** nel codice gate-eseguito; id temp = `pid`+contatore monotono; `RUN_OPTS.createdAt = '1970-01-01T00:00:00.000Z'`. La riproducibilità k=2 ne dipende.
- **Node ESM, solo built-in** (+ moduli `trueline/scripts/*` dep-free). Nessun `npm install`, nessuna dipendenza di rete.
- **0-contaminazione** (`L-COL-024`): build su **copia isolata** (`copyPackFixture`/`createVerifyWorkspace` → `eval/.tmp-verify/`); `git status --porcelain` vuoto + HEAD interno ed **esterno invariati** dopo; `assertIsolatedRepo` inline (toplevel copia ≠ ROOT e ≠ fixture originale).
- **Corpo `SKILL.md` < ~500 righe, zero logica** (`L-COL-014`/`L-COL-029`): l'unico edit al corpo è **una riga** nella dispatch-table §2.
- **Advisory mai gate** (`L-COL-006`): il self-check di scrittura non entra **mai** negli input di `runCheckpoint`.
- **Lingua**: prosa/commenti in italiano; identificatori/`name`/schemi in inglese.
- **Verifier sempre Opus, k=2 sui critici; niente Haiku** (`L-COL-027`). Git/merge/push = orchestratore (fuori dal workflow).

---

## Decisioni di design (FISSATE qui — non si ridiscutono nel workflow)

1. **`ac_observability_check.mjs` = sibling di `validate_blueprint`**, NON una sua modifica. Stesso scheletro (loader `loadAllTasks`, `extractYamlBlocks`, predicati `nonEmptyStr`; report `{tool, blueprint_dir, task_count, ok, checks:[{name,ok,detail}]}`; `process.exit(allOk?0:1)`). **Floor deterministico**: per ogni `task.acceptance_criteria[].then`, FLAG se contiene (case-insensitive substring) un token vietato della lista verbatim di `self-check-checklist.md` §6 — **"funziona bene", "robusto", "sicuro", "performante", "user-friendly"**. Check name: `(1) AC_OBSERVABILITY`. Lo schema del task e `validate_blueprint` **NON cambiano**. Default dir = `eval/seeded-blueprint` → **DEVE restare verde** (il blueprint canonico non ha token vietati).
2. **`run_loop --mode=build` esteso in modo ADDITIVO** (la scoperta: oggi non consuma blueprint/fixture, ed è hardcoded sulla canonica via `createVerifyWorkspace`). Si aggiungono **due flag eval-only**: `--fixture-app=<dir>` (override della reference-app per la copia) e `--blueprint=<dir>` (dir del seeded-blueprint del fixture). **Meccanismo dell'override**: `verify_workspace.createVerifyWorkspace` guadagna un parametro **additivo** `sourceApp` (default `CANONICAL_REFERENCE_APP`); `run_loop --fixture-app` lo passa; il default resta la canonica (BIT-invariante). I guardrail di `destroyVerifyWorkspace` (rifiuta di toccare la canonica e i path fuori da `TMP_VERIFY_ROOT`) restano. Nel path build con questi flag, run_loop calcola il **tidy advisory** (decisione 3) e lo attacca a `report.build_discipline`. **Senza i flag, comportamento IDENTICO a oggi** → BIT-invariante per m1…m5/ecosystem_conformance/run_eval. È il driver-faithful alla spec §7.
3. **Tidy advisory = modulo deterministico** `trueline/scripts/loop/build_discipline.mjs`, export `tidyAdvisory(referenceApp, { runOpts })` → `{ advisory:true, complexity_flag:boolean, notes:[...] }`. Segnale deterministico di complessità: conta i marcatori di sovra-astrazione nei sorgenti del fixture (es. `class `/`abstract `/`interface ` declarations per file > soglia, su una funzione single-use). **MAI passato a `runCheckpoint`** → provabilmente non-gate (gate §7.2a). `notes`/conteggi deterministici, niente Date.now/Math.random.
4. **Harness `build_discipline_check.mjs` parametrico sui 3 fixture** (mirror di `ecosystem_conformance.mjs`): per fixture `copyPackFixture` → drive via `run_loop --eval --mode=build --fixture-app=<copia> --blueprint=<copia/seeded-blueprint>` → ispeziona `report`. Exit **0/1/2** (2 = precondizione, es. test-runner assente — `process.exit(2)` con banner, mai falso verde). `cleanupAllVerifyWorkspaces()` in testa. No-regressione integrale = **T3.1 seriale** (orchestratore), non in-workflow (lezione SP-0…SP-7: evita falsi-rossi da contesa sui temp).
5. **`build-discipline.md`** è un reference di livello 3, caricato in **BUILD** (tutti i momenti) e **REMEDIATE** (momenti 1+3 + disciplina di fix; il momento 2 test-first è superato dalla baseline di caratterizzazione). Una **riga** in `SKILL.md` §2 (● BUILD ● REMEDIATE) + in `02-SKILL-ANATOMY` §6. Il lint di packaging lo copre **automaticamente** (file referenziato esiste) → **nessun edit a `09`**.
6. **Niente cambi** a `checkpoint.mjs`/`run_checkpoint.mjs`/`validate_blueprint.mjs`/schema del task. Il dead-code nuovo è già colto da `control1DeadCode` (baseline-delta via fingerprint, `deltaBlockers(..., {deadcode:true})`).

---

## File structure (chi crea/tocca cosa)

**Creati:**
- `trueline/scripts/blueprint/ac_observability_check.mjs` — oracolo sibling (osservabilità AC).
- `trueline/scripts/loop/build_discipline.mjs` — `tidyAdvisory()` (advisory deterministico, non-gate).
- `trueline/references/build-discipline.md` — il reference della disciplina (spec §5.1–5.3).
- `eval/build-discipline/overcomplicated-correct/{reference-app/, seeded-blueprint/}`
- `eval/build-discipline/orphan-injecting/{reference-app/, seeded-blueprint/}`
- `eval/build-discipline/ambiguous-ac/{reference-app/, seeded-blueprint/}`
- `eval/harness/build_discipline_check.mjs` — harness d'accettazione (keystone).

**Modificati (additivi):**
- `trueline/scripts/loop/run_loop.mjs` — flag eval-only `--fixture-app`/`--blueprint` + `report.build_discipline` (default BIT-invariante).
- `trueline/scripts/loop/verify_workspace.mjs` — param additivo `sourceApp` su `createVerifyWorkspace` (default `CANONICAL_REFERENCE_APP`; guardrail invariati).
- `trueline/references/modes/build.md` — tabella reference (riga `build-discipline.md`) + step 2 (i 3 momenti) + sezione "Disciplina BUILD" (bullet di scrittura).
- `trueline/references/modes/remediate.md` — nota: momenti attivi 1+3 + disciplina di fix (§5 del file).
- `trueline/SKILL.md` — §2 dispatch-table: **una riga** `references/build-discipline.md` (● BUILD ● REMEDIATE).
- `02-SKILL-ANATOMY.md` — §6 lista di caricamento per-modalità.
- `.gitignore` — `+ eval/build-discipline/*/reference-app/` (le reference-app sono inner-repo con node_modules; i `seeded-blueprint/` restano **tracked**).
- `00-INDEX.md` §4 — lock `L-COL-031` + nota di riconciliazione (orchestratore, T3.1).

---

## Task atomici + GATE (test-first)

| Task | Dominio (file) | dip. | Output | GATE (asserzione automatica, falsificabile) | Builder·k |
|---|---|---|---|---|---|
| **T1.1** Oracolo `ac_observability_check` | `trueline/scripts/blueprint/ac_observability_check.mjs` (new) | — | sibling di `validate_blueprint`: FLAG su `ac.then` con token vietato; report JSON `{tool:'ac_observability_check',ok,checks:[{name:'(1) AC_OBSERVABILITY',...}]}`, exit 0/1 | su `eval/seeded-blueprint` → **exit 0** (canonico pulito); su un blueprint con `then:'…funziona bene'` → **exit 1** (`AC_OBSERVABILITY` FAIL); **falsificabile** (rimuovi il token → exit 0); reti: struttura valida a `validate_blueprint` ma flaggata qui (i due oracoli sono ortogonali) | **Opus** · k=2 |
| **T1.2** Reference + wiring corpo | `trueline/references/build-discipline.md` (new) + `build.md` (mod) + `SKILL.md` §2 (mod, 1 riga) + `02-SKILL-ANATOMY.md` §6 (mod) + `remediate.md` (mod) | — | reference della disciplina; step 2 di build.md coi 3 momenti + bullet "scrittura vs gate"; riga dispatch in §2 | `package_skill` lint **VERDE** (file referenziato esiste, 0 orfani); `SKILL.md` resta **< 500 righe** (conteggio); la riga `build-discipline.md` è in §2 e in build.md; build.md step 2 nomina i 3 momenti; no-regressione triggering (`run_eval`) | **Opus** · k=2 |
| **T1.3** I 3 fixture (reference-app + seeded-blueprint) | `eval/build-discipline/{overcomplicated-correct,orphan-injecting,ambiguous-ac}/{reference-app,seeded-blueprint}/` (new) + `.gitignore` (mod) | T1.1 | 3 fixture nel formato canonico (package.json type:module, tsconfig, knip.json entry src/index.ts; seeded-blueprint = dir *.md con ```yaml) | ogni `reference-app` **builda/typecheck**; ogni `seeded-blueprint` passa **`validate_blueprint` exit 0** (strutturalmente valido); **ambiguous-ac** → `validate_blueprint` 0 **MA** `ac_observability_check` **exit 1**; **orphan-injecting** ha un export inutilizzato nuovo (specchio `S8/unused.ts`); **overcomplicated-correct** è corretto (target_tests verdi) + sovra-astratto (≥soglia classi); `.gitignore` copre le reference-app; `seeded-blueprint/` tracked | **Opus** · k=2 |
| **T2.1** Path build-discipline in `run_loop` + `tidyAdvisory` | `trueline/scripts/loop/build_discipline.mjs` (new) + `trueline/scripts/loop/run_loop.mjs` (mod) + `trueline/scripts/loop/verify_workspace.mjs` (mod, `sourceApp` additivo) | T1.3 | flag eval-only `--fixture-app`/`--blueprint`; `report.build_discipline = tidyAdvisory(...)`; default invariato | **default (no flag) BIT-invariante**: `run_loop --eval --mode=remediate` → JSON shape identico, **m1 verde**; con `--fixture-app=<overcomplicated-correct copy>` → `report.build_discipline.advisory===true && report.build_discipline.complexity_flag===true` **E** `report.checkpoint.green===true` **simultaneamente** (l'advisory NON è negli input di `runCheckpoint`); con `--fixture-app=<orphan-injecting>` → `report.checkpoint.controls[0].green===false` (control1 dead-code) | **Opus** · k=2 |
| **T2.2** Harness `build_discipline_check` *(keystone)* | `eval/harness/build_discipline_check.mjs` (new) | T1.1·T1.2·T1.3·T2.1 | gate parametrico sui 3 fixture, mirror `ecosystem_conformance` | gate **PASS (N/N)** e **falsificabile**, asserendo: **(a)** overcomplicated-correct → `advisory_flag===true && cp.green===true`; **(b)** orphan-injecting → control1 **FAIL**, rimosso l'orfano → verde; **(c)** ambiguous-ac → `ac_observability_check` **FAIL** mentre `validate_blueprint` **PASS**; **0-contaminazione** (fixture bit-identica, HEAD esterno invariato); **exit 0/1/2** (2 se test-runner assente); conteggio = fatto emesso dall'harness | **Opus** · k=2 |
| **T3.1** Integrazione + no-regressione + ledger *(orchestratore — git, SERIALE, fuori-workflow)* | riesecuzione **SERIALE** + `00-INDEX.md` §4 (`L-COL-031`) + `SESSION-STATE.md` | T2.1·T2.2 | commit logici + merge human-gated + install riallineato + ledger | `build_discipline_check` PASS + falsificabile **e** no-regressione integrale: `m5`=**56/56**, `m1..m4`, `ecosystem_conformance` **tutti i pack** (supabase-jsts/py 56/40, postgres-jsts/py 36/40, firebase-jsts 26), `run_eval`, `package_skill` lint VERDE; **0 contaminazione** (`assertIsolatedRepo`, HEAD esterno invariato); ledger: **`L-COL-031`** annotato (raffina `L-COL-015`/`L-COL-019`) | **Opus** (orchestratore) |

---

## Ondate (DAG)

- **W1:** T1.1 (oracolo AC) ‖ T1.2 (reference + wiring) — indipendenti.
- **W2:** T1.3 (3 fixture; gated su T1.1 per il gate ambiguous-ac).
- **W3:** T2.1 (path run_loop + tidyAdvisory; gated su T1.3).
- **W4:** T2.2 (keystone; gated su T1.1·T1.2·T1.3·T2.1).
- **W5 (orchestratore, fuori dal workflow):** T3.1 — riesecuzione seriale + git/merge/push + ledger.

---

## Invarianti di build (per ogni task)

- Il "verde" è un **fatto** di oracolo/harness, mai una frase dell'LLM (`L-COL-002`); la **verità** del gate è la riesecuzione **SERIALE** dell'orchestratore (T3.1), non il green/red in-workflow.
- **In-workflow ogni task gira SOLO il proprio micro-gate**; la no-regressione integrale pesante è T3.1 seriale.
- Gli agenti **non toccano il git del repo ESTERNO** (`assertIsolatedRepo`, `L-COL-024`); solo le copie in `eval/.tmp-verify/` e gli inner-repo dei fixture sono materiale di build legittimo.
- **Advisory mai gate**: `build_discipline.tidyAdvisory` non entra in `runCheckpoint`; il sotto-test §7.2a lo **prova** (flag settato **E** verde).
- **Default-path invariante**: ogni cambio a `run_loop` è eval-only e additivo; senza i flag nuovi, output bit-identico (m1…m5 invariati).
- Corpo `SKILL.md` invariato salvo **una riga** §2 (`L-COL-014`/`L-COL-029`).
- `verified`/coverage: nessuna rivendicazione di "pulito/elegante"; mai "sicuro" (`L-COL-006`).

---

## Definizione di "fatto" (acceptance BD-1)

`build_discipline_check` **PASS** (3 sotto-test (a)/(b)/(c) verdi + falsificabili) **e** no-regressione integrale (m5 56/56, m1..m4, ecosystem_conformance tutti i pack, run_eval, package_skill lint VERDE, `run_loop` default BIT-invariante) **e** 0 contaminazione — il tutto da **riesecuzione seriale** dell'orchestratore, poi merge **human-gated** su `main` (`L-COL-024`), e nota di riconciliazione BD-1 nel ledger (`00-INDEX` §4) con il **nuovo lock `L-COL-031`** (raffina `L-COL-015`/`L-COL-019`; assorbe l'additivo Karpathy MIT + pratica superpowers, ri-espressa nativa cross-tool).

---

## Self-review (writing-plans) — copertura della spec

- spec §5.1 reference → **T1.2**; §5.2 momenti 1–3 (build.md) → **T1.2** (prosa) + **T2.1** (advisory eseguibile) + **T1.1** (floor osservabilità); §5.2bis fix-discipline → **T1.2** (remediate.md) ; §5.3 confine → invarianti + **T2.1** (advisory fuori da checkpoint); §5.4 sibling checker → **T1.1**; §5.5 wiring (corpo + ancora) → **T1.2**; §6 confini → invarianti; §7 harness (driver+fixture+exit+0-contam+k2) → **T1.3**+**T2.1**+**T2.2**; §10 lock `L-COL-031` → **T3.1**. **Nessun requisito della spec resta senza task.**
- Placeholder scan: nessun "TBD"; ogni task ha file esatti + GATE falsificabile.
- Type consistency: `report.build_discipline.{advisory,complexity_flag}` (T2.1) ↔ asserito identico in T2.2; `ac_observability_check` report `{tool,ok,checks}` (T1.1) ↔ consumato in T1.3/T2.2; `report.checkpoint.green`/`controls[0].green` (grounding checkpoint) ↔ T2.1/T2.2.
