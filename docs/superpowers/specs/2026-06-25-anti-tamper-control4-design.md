# Design — Anti-tamper del controllo 4 (tracciabilità AC↔asserzioni)

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Sub-progetto** | **AT-1** — anti-tamper dell'autorità: provenienza del controllo 4 |
| **Tema** | Blindare l'unico punto in cui il giudice del checkpoint poggia su un artefatto LLM-generato (il `target_test` del controllo 4): le sue **asserzioni devono tracciare** agli `acceptance_criteria` che dichiara di `covers` |
| **Data** | 25 giugno 2026 |
| **Stato** | Design (post-brainstorming). In attesa di review adversariale → review utente → writing-plans. |
| **Risolve** | L'**hand-off esplicito** di BD-1 (spec BD-1 §5.2 momento 2 / §7.5): la *meccanizzazione piena* della tracciabilità AC↔asserzioni, dichiarata come fase moat successiva. |
| **Dipende da** | `01-ARCHITECTURE` §4 (checkpoint a 4 controlli), `05-VERIFY-FIX-LOOP` (loop RED), `11-BLUEPRINT-ENGINE` §3 (schema del task: `acceptance_criteria`/`target_tests[].covers`), `references/blueprint/atomic-task-schema.md`, `references/build-discipline.md` (momento 2, BD-1/`L-COL-031`), `references/modes/build.md` |
| **Contesto** | `docs/superpowers/competitive/2026-06-24-*` (il moat è l'integrità del test-gate, non un 6° stack) |

---

## 1. Contesto e obiettivo

**La diagnosi (ereditata da BD-1).** Il checkpoint a 4 controlli è il giudice deterministico del build (`01` §4, `L-COL-002`). Tre controlli su quattro poggiano su oracoli che l'LLM non scrive (dead-code/knip, security/semgrep, regressioni/baseline). Il **controllo 4** (conformità logica) poggia sul **`target_test`** — l'unico oracolo del checkpoint che l'**LLM scrive** in BUILD. BD-1 ha posto la **regola** (le asserzioni del `target_test` *derivano* dagli `acceptance_criteria` given/when/then; l'LLM fa scaffold/wiring, non inventa il comportamento asserito — `L-COL-019`) e un floor d'osservabilità degli AC (`ac_observability_check`), ma ha **dichiarato esplicitamente** (§5.2 momento 2, §7.5) che la *meccanizzazione piena* del link AC↔asserzioni è il deliverable successivo — non un buco lasciato in silenzio.

**L'esposizione concreta.** Lo schema porta già `target_tests[].covers: [AC-id, …]` e `validate_blueprint` verifica che ogni AC sia coperto da ≥1 file. Ma `covers` è una **dichiarazione del piano**: nessuno verifica che le **asserzioni dentro il file** corrispondano a quegli AC. Un agente che scrive *insieme* codice e test può dichiarare `covers: [AC-002-2]` (il criterio "401, nessuna scrittura") mentre il file asserisce qualcosa di più debole, diverso, o nulla per AC-002-2 → **controllo 4 verde senza** che il confine del macrotask sia rispettato. È il pattern *gamed-green* (visto mordere in M2/M3) portato sul giudice stesso.

**Obiettivo.** Rendere **deterministicamente rilevabile** questa manomissione, **materializzando il link AC↔asserzione nel file di test** (una convenzione di annotazione) e gateandolo. La disciplina di scrittura resta di BD-1; qui si chiude la sola **provenienza/integrità** dell'oracolo del controllo 4. È il deliverable del **moat** (`L-COL-002` portato fin dentro il controllo 4), non un nuovo ecosistema.

## 2. Requisiti decisi (brainstorming)

- **Manomissione primaria (scope):** il difetto unificato *"le asserzioni di un `target_test` non tracciano agli AC che dichiara di `covers`"* — copre sia il "test più debole/divergente" sia la "coverage fantasma". **Always-on**: enforced come **validità del controllo 4**, quindi rivalutato a ogni checkpoint, **incluso il loop di fix** (un test indebolito a metà loop non passa). **Fuori scope** la tracciabilità bidirezionale piena ("ogni osservabile di ogni AC asserito"): forza matching semantico euristico → muddya il floor deterministico, rinviata.
- **Meccanismo del link:** **convenzione di annotazione**. Il `target_test` **tagga l'AC id** sul blocco/caso che lo esercita, come **commento** (`// covers: AC-002-2`, `# covers: AC-002-2`). Il checker è **token-based, LANGUAGE-AGNOSTIC** (no AST, come `firestore_rules_check`/`ac_observability_check`). *(Scartata l'alternativa test-name `it('AC-002-2: …')`: framework-specifica. Scartato l'observable-matching senza convenzione: euristico, per-linguaggio, fragile → false-FAIL su test fedeli.)*
- **Floor deterministico + advisory dichiarato (`L-COL-006`):** il **floor sempre-gated** = *presenza del tag* per ogni AC coperto (cattura la coverage fantasma; robusto, zero false-FAIL). L'**observable-match** è **gated solo sugli AC il cui `then` porta un letterale inequivoco estraibile** (es. `401`, `relrowsecurity = true`) — conservativo; dove il `then` non ha un osservabile estraibile, resta **advisory**. La fedeltà semantica profonda ("il test esercita *bene* l'AC") resta advisory, dichiarata.
- **Footprint minimo (lezione BD-1):** **nessun** cambio allo schema del task né a `validate_blueprint` (`covers` esiste già); l'unico oracolo nuovo è il checker sibling. Il cambio al controllo 4 è **additivo e opt-in sul blueprint** → BIT-invariante per `m1..m5`/`ecosystem_conformance`.
- **BUILD-only:** vive dove esistono gli AC `target_test` (momento 2). In REMEDIATE il test-first è superato dalla baseline di caratterizzazione (`06`/`remediate.md`) → fuori scope.
- **Self-contained / cross-tool** (`L-COL-009`): convenzione e checker nativi, viaggiano nel `.skill`.

## 3. Decomposizione

Pezzo **autocontenuto**: una convenzione (documentata) + un checker deterministico nuovo (`ac_assertion_trace_check.mjs`) + wiring come validità del controllo 4 + un harness d'accettazione falsificabile con fixture. Un solo ciclo spec → plan → implementazione. Secondo deliverable della fase moat (dopo BD-1).

## 4. Approccio scelto

**Materializzare il link nel test (tag AC-id) e gatarne la presenza come precondizione di validità del controllo 4.** L'LLM non può più rivendicare `covers: [AC-x]` senza **scrivere il tag** accanto a un'asserzione; il tag è un **fatto verificabile**, non una frase. Scartati: cambiare lo schema del task (blast radius inutile — `covers` basta); gate semantico LLM sulla "bontà" del test (rompe `L-COL-002`); observable-matching senza convenzione (euristico/fragile).

## 5. Design

### 5.1 La convenzione di annotazione (il contratto del link)

In BUILD, scrivendo il `target_test` (momento 2 di `build.md`), ogni blocco/caso che esercita un AC porta un **tag** dell'AC id come commento, immediatamente sopra o dentro il blocco con l'asserzione:

```ts
// covers: AC-002-2
it("rifiuta la richiesta non autenticata", async () => {
  const res = await call({ auth: null });
  expect(res.status).toBe(401);   // osservabile del `then`: 401
});
```

Il tag è verbatim `covers: <AC-id>` (regex `covers:\s*AC-[\w-]+`), case-insensitive, dentro un commento di linea (`//` o `#`). Più AC per blocco = più tag. La convenzione è documentata in `build-discipline.md` (momento 2) e in `atomic-task-schema.md` (nota: "il file di test tagga gli AC che copre"). **BOOTSTRAP non cambia** (genera il blueprint con `covers`; non scrive i file di test). **Nessun cambio allo schema** del task.

### 5.2 Il checker `ac_assertion_trace_check.mjs` (sibling nuovo)

`trueline/scripts/blueprint/ac_assertion_trace_check.mjs`, **fratello** di `validate_blueprint`/`ac_observability_check` (viaggia nel `.skill`). A differenza di `validate_blueprint` (che gira sul **solo** blueprint), questo richiede **blueprint + i file di test sul disco** → vive al BUILD/checkpoint. CLI `node ac_assertion_trace_check.mjs <blueprint-dir> <app-dir> [--json]`; report `{ tool, blueprint_dir, app_dir, task_count, ok, checks:[{name, ok, detail}] }`; `process.exit(allOk?0:1)`.

Per ogni task, per ogni `target_tests[]` con `file` + `covers`:
- **Check `(1) AC_TRACE` (floor, gated):** il `file` nominato **esiste** sotto `<app-dir>` e contiene **≥1 tag** `covers: AC-id` per **ogni** AC in `covers`. `detail` = elenco `task_id/AC-id @ file` non tracciati. Token-based, language-agnostic.
- **Check `(2) OBSERVABLE_MATCH` (gated solo dove estraibile):** per gli AC il cui `then` contiene un **letterale inequivoco** (numero di status, `relrowsecurity = true`, un identificatore citato), verifica che il letterale compaia nella **finestra del caso taggato** (dal tag alla chiusura del blocco se i delimitatori sono riconoscibili, altrimenti una finestra fissa di default — parametro del checker, es. 12 righe). Estrazione conservativa (whitelist di pattern letterali); AC senza letterale estraibile → **skip (advisory)**, mai FAIL. `detail` distingue *matched* / *advisory-skipped*.
- **Advisory (non gate):** un report `{advisory:true, …}` per la fedeltà semantica profonda (LLM self-check, `self-check-checklist`), **fuori** dal verdetto.

Determinismo (`L-COL-002`): niente `Date.now()`/`Math.random()`; solo built-in. Ortogonale a `validate_blueprint` (struttura) e a `ac_observability_check` (osservabilità dell'AC nel blueprint): qui si verifica il **link blueprint↔file di test**.

### 5.3 Wiring come validità del controllo 4 (additivo, opt-in, BIT-invariante)

Il controllo 4 (conformità) diventa: *"il `target_test` è un oracolo **valido** (le sue asserzioni tracciano agli AC coperti) **e** passa"*. In concreto, sul **build-path** quando è presente un blueprint con `target_tests` (il caso reale di BUILD e i fixture), il checkpoint valuta `ac_assertion_trace_check`; un trace **FAIL** rende il **controllo 4 RED** (`detail`: "target_test non tracciabile all'AC — oracolo non valido"). Poiché il checkpoint si rivaluta a ogni iterazione, è **always-on**, loop di fix incluso.

**Opt-in sul blueprint:** senza un blueprint con AC `target_tests` (reference-app legacy, `m1..m5`, REMEDIATE) il controllo 4 è **byte-identico a oggi** → BIT-invariante. *Punto d'innesto da fissare nel plan dopo aver letto `checkpoint.mjs`: o (a) un ramo additivo in `control4`/`checkpoint.mjs` keyed sulla presenza del blueprint, o (b) un wrapper nel build-path di `run_loop` che marca il controllo 4 RED prima di consultarlo. Vincolo invariante: senza blueprint, zero differenza.*

### 5.4 Schema invariato; un solo checker nuovo

**Nessun cambio** ad `atomic-task-schema`/`validate_blueprint`/schema del task: portano già `acceptance_criteria`/`target_tests[].covers`. L'unico engine nuovo è `ac_assertion_trace_check.mjs` (additivo). L'unico edit "di contratto" è la **convenzione del tag** documentata in `build-discipline.md`/`atomic-task-schema.md` — prosa, non logica nel corpo.

## 6. Confini (cosa NON fa)

- **Non** verifica che il test sia *semanticamente corretto/forte* (solo il **link** è gated; la bontà profonda è advisory, `L-COL-006`).
- **Non** copre la tracciabilità **bidirezionale** piena ("ogni osservabile asserito") — rinviata (euristica).
- **Non** modifica lo schema del task né `validate_blueprint`; **non** ristruttura il checkpoint (aggiunge una validità additiva al controllo 4).
- **Non** si attiva in REMEDIATE (test-first superato dalla baseline di caratterizzazione).
- **Non** rivendica come oracle-verified la "qualità" del test.

## 7. Definizione di "fatto" (acceptance) — harness implementabile

Stile `build_discipline_check.mjs`/`ecosystem_conformance.mjs`, **con le lezioni del keystone BD-1**: **radice temp PRIVATA per-pid** (env `TRUELINE_TMP_VERIFY_ROOT`) + cleanup **never-throw** (ambiente → exit-2 onesto, mai falso exit-1); inner-`.git` dei fixture provisionato dall'orchestratore (`provision_fixtures.sh`); riesecuzione **SERIALE** = verità (`L-COL-002`).

- **Harness:** `eval/harness/anti_tamper_check.mjs`. **Fixture** sotto `eval/anti-tamper/<id>/{reference-app, seeded-blueprint}`.
- **Exit:** 0 pass / 1 fail / **2 precondizione** (file di test/`.git` assenti); k=2; 0-contaminazione (HEAD esterno+interni invariati).

**Sotto-test falsificabili:**
1. **(a) faithful** — ogni AC coperto ha tag (+ osservabile dove estraibile) → `ac_assertion_trace_check` **PASS**; il controllo 4 valido+verde.
2. **(b) tampered-untagged** — `covers:[AC-x]` ma il file **manca** del tag AC-x (coverage fantasma) → trace **FAIL** → controllo 4 RED; **aggiungi il tag su copia → PASS** (falsificabilità del floor).
3. **(c) tampered-observable** — tag presente ma il `then` dice `401` e il file asserisce `200` → `(2) OBSERVABLE_MATCH` **FAIL** (l'AC ha un letterale estraibile); correggi → PASS. *(Per AC senza letterale estraibile il sotto-test è advisory, non gated.)*
4. **(d) ortogonalità** — `validate_blueprint` **PASS** su tutti i fixture (struttura valida) mentre il trace **FAIL** su (b)/(c): i due oracoli sono ortogonali.
5. **No-regressione:** `m5` 56/56, `m1..m4`, `ecosystem_conformance` tutti i pack, `build_discipline_check`, `run_eval`, `package_skill` lint VERDE; **default-path BIT-invariante** (senza blueprint, controllo 4 invariato).
6. **Coverage onesta:** il report non rivendica mai "test corretto/forte" come verificato; gli AC senza osservabile estraibile sono dichiarati advisory.

## 8. Posizione nella roadmap

Secondo deliverable del moat (dopo BD-1, riequilibrio scrittura). Blinda l'integrità dell'autorità (il test-gate, controllo 3+4) — il differenziatore identificato dall'analisi competitiva. Precede la **distribuzione trust-preserving** (conversione cross-tool che preserva l'integrità del gate, BD-1 §8).

## 9. Come si costruisce

**Dynamic Workflows** (`L-COL-027`), **test-first** (l'harness §7 scritto *prima*), **gate = l'harness** (dogfood). Git **solo nell'orchestratore**; merge su `main` **human-gated** (`L-COL-024`); radice temp privata per-pid + `assertIsolatedRepo` attivi (lezioni BD-1).

## 10. Ledger + rischi / questioni aperte

**Nuovo lock proposto — `L-COL-032`:** *"Provenienza del controllo 4 (anti-tamper). Le asserzioni di un `target_test` devono tracciare — per annotazione (tag AC-id language-agnostic, commento `covers: <AC-id>`) — agli `acceptance_criteria` che il file dichiara di `covers`; un AC coperto senza tag tracciabile rende il `target_test` un oracolo NON valido → controllo 4 RED (floor deterministico `ac_assertion_trace_check`; observable-match gated dove un letterale è estraibile; fedeltà semantica advisory, `L-COL-006`). Always-on (validità del controllo 4, rivalutata a ogni checkpoint incl. loop di fix). BUILD-only (in REMEDIATE superato dalla baseline di caratterizzazione). Meccanizza la regola di provenienza di `L-COL-031` momento 2 / `L-COL-019`; l'oracolo resta l'unico giudice (`L-COL-002`)."* Raffina `L-COL-019`/`L-COL-031`.

**Rischi / questioni aperte:**
- **Punto d'innesto del controllo 4** (`checkpoint.mjs` control4 vs. wrapper build-path di `run_loop`) — da fissare nel plan leggendo `checkpoint.mjs`; vincolo: BIT-invarianza senza blueprint (`m5` 56/56 immutato).
- **Observable-match in v1 — manopola.** Adottato: **gated dove un letterale è estraibile** (conservativo), advisory altrove. Alternativa più economica: observable-match **tutto-advisory** in v1 (gate = solo presenza del tag). Da confermare in review.
- **Burden della convenzione.** I `target_test` devono taggare gli AC. È **additivo** al modo in cui BUILD scrive i test (momento 2) e **aiuta la review umana** (si vede quale asserzione rivendica quale criterio). Rischio: tag dimenticato su un test fedele → FAIL "corretto-ma-fastidioso" (il fix è banale: aggiungi il tag). Non un falso verde.
- **`ac_assertion_trace_check` è strutturale, non semantico.** Il floor cattura la coverage fantasma e materializza il link; il "taggato ma indebolito" è colto solo dall'observable-match *dove estraibile*, altrimenti advisory. Da non vendere come "rileva ogni test debole" (`L-COL-006`).
- **Tracciabilità bidirezionale piena** — fuori scope (euristica); eventuale advisory/fast-follow.
