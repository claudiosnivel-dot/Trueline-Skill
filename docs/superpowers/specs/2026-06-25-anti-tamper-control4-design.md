# Design — Controllo 4 = test d'accettazione dell'AC + anti-tamper della provenienza (AT-1, rifondato)

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Sub-progetto** | **AT-1** — il controllo 4 diventa il vero test-gate dell'AC, con la provenienza dell'oracolo blindata |
| **Tema** | (A) Far sì che il controllo 4 in BUILD **esegua i `target_test` per-AC del task** come oracolo d'accettazione (oggi gira `npm test`/characterization, blueprint-cieco). (B) **Anti-tamper**: ogni `target_test` in scope deve **tracciare** (annotazione tag AC-id) agli `acceptance_criteria` che copre. |
| **Data** | 25 giugno 2026 |
| **Stato** | Design **rifondato** dopo review adversariale k=5 (report `2026-06-25-anti-tamper-control4-review.md`: 11 blocking/17 major — la v1 poggiava sulla premessa falsa "il controllo 4 poggia già sul target_test"). In attesa di 2ª review focalizzata → review utente → writing-plans. |
| **Risolve** | L'hand-off di BD-1 (§5.2 momento 2 / §7.5: meccanizzazione AC↔asserzioni) **e** il gap nominale-vs-reale del test-gate scoperto in review: il "test-gate = test d'accettazione dell'AC" è prosa di `build.md`, non codice. |
| **Dipende da** | `trueline/scripts/checkpoint/checkpoint.mjs` (`control4Conformance` r.423, `runCheckpoint` r.520, `detectTestRunner` r.457, `runTests` r.487), `trueline/scripts/checkpoint/run_checkpoint.mjs` (entrypoint), `references/ecosystems/<id>/ecosystem.json` (`test_runner`, SP-0), `11-BLUEPRINT-ENGINE` §3 + `atomic-task-schema.md` (`target_tests[].covers`), `build.md` momento 2 (BD-1) |
| **Contesto** | `docs/superpowers/competitive/2026-06-24-*` (il moat è l'integrità del test-gate); report di review (sopra) |

---

## 1. Contesto e obiettivo

**Lo stato reale (verificato leggendo il codice).** Il controllo 4 è **blueprint-cieco**: `control4Conformance(referenceApp, { mode, characterization, finding })` (checkpoint.mjs:423) non riceve né legge blueprint / `acceptance_criteria` / `target_tests` / `covers`. In BUILD esegue `characterizationInvariance` **oppure** `detectTestRunner → runTests` = **`npm run test` sull'intera suite** (oppure DEGRADATO se non c'è uno `scripts.test`). `run_checkpoint.mjs` (l'entrypoint del controllo al confine del macrotask) **non ha alcun flag blueprint**. L'unico consumatore di `covers` è `validate_blueprint` a **plan-time**. Quindi "il controllo 4 = il test d'accettazione del `target_test` dell'AC" (header di `run_checkpoint.mjs` r.14; `build.md` §3) è **nominale, non implementato**.

**La scoperta (review adversariale k=5).** La v1 di AT-1 voleva *blindare la provenienza* di un oracolo che il controllo 4 **non esegue**: bolt-on a un link inesistente. La review (5/5 critici, citazioni di codice, report committato) ha falsificato la premessa. Riallineando: il deliverable corretto è **più foundational** — rendere il controllo 4 il vero test-gate dell'AC, poi blindarne la provenienza.

**Obiettivo.** (A) In BUILD, il controllo 4 **esegue i `target_test` per-AC del task** come oracolo d'accettazione (i file specifici, non l'intera suite, non la characterization). (B) Ogni `target_test` in scope deve **tracciare** (tag AC-id) agli AC che copre, pena controllo 4 RED. Chiude il gap nominale-vs-reale del test-gate (il moat) + meccanizza l'hand-off di BD-1. L'oracolo resta il giudice (`L-COL-002`).

## 2. Requisiti decisi (brainstorming + review)

- **(A) Esecuzione per-file (fedele).** Il controllo 4 esegue i **file specifici** dei `target_test` in scope, non la suite intera (`L-COL-002`: il verde prova esattamente l'accettazione dell'AC del task). **Scoping:** in scope = i `target_test` il cui `file` **esiste** su disco sotto `projectDir` (= task costruiti); i file **mancanti** = task **non ancora costruiti** → **saltati, mai RED** (incrementale, build.md §1). In-scope vuoto → **degradato** (onesto, non verde).
- **Opt-in via FLAG ESPLICITO `--blueprint <dir>`** — mai auto-detect dalla presenza di file su disco (a differenza di characterization): protegge la BIT-invarianza `m5` 56/56. Senza il flag, il controllo 4 è **byte-identico a oggi**.
- **Split dei controlli chiarito:** controllo 3 = **regressioni** (invarianza characterization, invariato); controllo 4 = **accettazione AC** (target_test per-AC). In BUILD+blueprint il controllo 4 è AC-acceptance; la characterization resta al controllo 3.
- **(B) Trace-check — floor deterministico.** Per ogni AC `coperto`, **≥1 tag** `covers: AC-id` in **≥1** dei file che lo coprono (**semantica per-AC GLOBALE**, combacia con `validate_blueprint` AC_COVERAGE). `covers` normalizzato **scalare-o-lista**. Tag = **token** entro prefissi-commento riconosciuti **`//` `#` `--` `/* */`** (RLS/pgTAP usa `--`). Trace FAIL ⇒ controllo 4 RED **prima** di eseguire.
- **Gated vs advisory (onesto, `L-COL-006`):** **gated** = (i) il `target_test` dell'AC **esiste**, (ii) **traccia** (tag), (iii) **gira e passa**. **Advisory (fuori dal gate):** la fedeltà semantica (un test *taggato ma vacuo* `expect(true).toBe(true)` passa); l'**observable-match declassato a TUTTO-ADVISORY in v1** (era euristica con falso-RED su costanti `Status.Unauthorized` vs `401` e falso-PASS su `true`/`200`); il floor prova **presenza-del-token + esecuzione**, non adiacenza-a-un'asserzione né bontà.
- **Footprint:** **nessun** cambio a schema del task / `validate_blueprint`. Estensione **additiva** del manifest (`test_runner.run_file`) + del controllo 4 (ramo opt-in) + 1 nuovo checker sibling. BUILD-only; REMEDIATE invariato.

## 3. Decomposizione

Due pezzi **accoppiati**: **A** (plumbing `--blueprint` end-to-end + esecuzione per-file dei target_test + `test_runner.run_file`) e **B** (`ac_assertion_trace_check` + convenzione tag + wiring come precondizione del controllo 4). Il plan potrà **decomporli in due fasi/plan** (A è il prerequisito di B). Un solo design.

## 4. Approccio scelto

**Fedele:** il controllo 4 esegue i file specifici dei `target_test` come oracolo d'accettazione, con il trace-check come precondizione di validità. Scartati: (i) "suite intera + esige presenza/trace" (over-broad: un fallimento non correlato arrossa il controllo; non prova che il singolo target_test giri); (ii) "solo trace-check, esecuzione invariata" (il bolt-on già scartato: gata un link a un oracolo che il controllo 4 non esegue); (iii) auto-detect del blueprint su disco (rompe la BIT-invarianza).

## 5. Design

### 5.1 Data-flow `--blueprint` end-to-end (il punto che la review esigeva esplicito)

`run_checkpoint.mjs` guadagna `--blueprint <dir>` (default assente). Plumbing **additivo**: `runCheckpoint(referenceApp, { …, blueprintDir })` (checkpoint.mjs:520) passa `blueprintDir` a `control4Conformance(referenceApp, { …, blueprintDir })` (r.423). **Solo** `control4Conformance` cambia firma (parametro opzionale, default `null` → ramo legacy invariato); gli altri 3 controlli e i chiamanti che non passano `blueprintDir` sono byte-identici. `run_loop.mjs` ha già `--blueprint` (oggi solo nel report): lo **inoltra** a `runCheckpoint` sul build-path. **Nessun auto-detect:** il ramo nuovo è preso **solo** se `blueprintDir` è passato esplicitamente.

### 5.2 Il controllo 4 come oracolo d'accettazione dell'AC (ramo `mode='build' && blueprintDir`)

```
control4Conformance(app, { mode:'build', blueprintDir }):
  tasks      = loadAllTasks(blueprintDir)              # riusa il loader di validate_blueprint
  inScope    = [ tt  for task in tasks for tt in task.target_tests  if exists(app/tt.file) ]
  if inScope == []:  return degraded("nessun target_test materializzato")   # onesto, non verde
  trace      = ac_assertion_trace_check(blueprintDir, app, scope=inScope)    # (B), §5.3
  if not trace.ok:   return RED("target_test non tracciabile all'AC — oracolo non valido")
  for tt in inScope: run_file(app, tt.file, manifest.test_runner)            # §5.3bis, esige verde
  return green/red su (tutti i file in scope verdi)
  # mode!='build' o blueprintDir assente -> ramo LEGACY invariato (characterization / npm test)
```

Idempotente/deterministico: ordine stabile (`sort`) su task/target_test/file; nessun `Date.now`/`Math.random`. I `target_test` mancanti sono **saltati** (non RED): "file assente in BUILD incrementale = task non ancora costruito ≠ tamper".

### 5.2bis Esecuzione del file specifico (`test_runner.run_file`, additivo al manifest)

Il manifest `ecosystem.json` (`test_runner`, SP-0) guadagna un campo **`run_file`**: un template di comando con placeholder `{file}` (es. `"node --test {file}"`, `"npx vitest run {file}"`, `"python -m pytest {file}"`). `control4Conformance` sostituisce il path del `target_test` ed esegue (`spawnSync`, cwd=`app`), esige exit 0. AT-1 spedisce `run_file` per gli ecosistemi **in scope** (almeno `supabase-jsts` + i fixture nuovi); un ecosistema **senza** `run_file` **non** entra nel ramo AC-acceptance → controllo 4 **legacy invariato** (additività `L-COL-029`, BIT-invariante).

### 5.3 `ac_assertion_trace_check.mjs` (checker sibling nuovo, gira nel `.skill`)

`trueline/scripts/blueprint/ac_assertion_trace_check.mjs`, fratello di `validate_blueprint`/`ac_observability_check`. Input = `<blueprint-dir> <app-dir> [--scope file,…] [--json]`. Riusa `loadAllTasks`/`extractYamlBlocks`. Report `{tool, blueprint_dir, app_dir, task_count, ok, checks:[{name,ok,detail}]}`; `exit 0/1`.
- **Check `(1) AC_TRACE` (floor, gated):** per OGNI AC del task il cui `file` (in scope) esiste, l'AC è **tracciato** se **≥1** dei file che lo dichiarano in `covers` contiene il token `covers: <AC-id>` in un commento riconosciuto. `covers` normalizzato (scalar→`[scalar]`). Regex ancorata all'**id esatto** (`covers:\s*` + escape(acId) + `\b`). Tag **spurio** (id non dichiarato in quel file) → **ignorato** (non FAIL). `detail` = elenco `task_id/AC-id` non tracciati, ordinato.
- **`(2) OBSERVABLE_MATCH` (ADVISORY in v1, non gate):** segnale ispezionabile dove il `then` ha un letterale ad alta cardinalità — **fuori** dal verdetto. Promozione a gated = fast-follow con prova anti-falso-RED.
- Determinismo (`L-COL-002`): solo built-in, ordine stabile. Ortogonale a `validate_blueprint` (struttura) e `ac_observability_check` (osservabilità dell'AC nel blueprint).

### 5.4 La convenzione di annotazione (contratto del link, BD-1 momento 2)

Scrivendo il `target_test` (momento 2 di `build.md`), ogni blocco che esercita un AC porta un tag **`covers: AC-x`** come commento (`//`/`#`/`--`/`/* */`). Documentato in `build-discipline.md` (momento 2) e `atomic-task-schema.md` (nota). **Nessun cambio allo schema** né a `validate_blueprint`. Confine onesto (§6): il floor prova la **presenza del token** per ogni AC coperto, **non** che il tag sia accanto a un'asserzione (un tag in testa al file + zero asserzioni passa il floor — ma il file viene comunque **eseguito** (A), quindi un test vuoto/rotto è colto dall'esecuzione, non dal floor).

### 5.5 Cosa è gated vs advisory (onesto)

| | Meccanismo | Coglie |
|---|---|---|
| **Gated** | il `target_test` in scope **esiste** | coverage fantasma "file mai scritto" (degradato/skip + il task non avanza) |
| **Gated** | `(1) AC_TRACE` presenza-tag | "covers dichiarato ma AC mai nominato in alcun file coprente" |
| **Gated** | esecuzione del file (`run_file`) | target_test **rotto/fallisce** |
| **Advisory** | `(2) OBSERVABLE_MATCH` | mismatch letterale del `then` (euristico) |
| **Advisory** | self-check semantico | test **taggato ma vacuo/debole** |

## 6. Confini (cosa NON fa)

- **Non** cambia lo schema del task né `validate_blueprint`; **non** tocca i controlli 1/2/3 né il ramo REMEDIATE/characterization del controllo 4.
- **Non** prova la **bontà semantica** del test (taggato-ma-vacuo è advisory); **non** gata l'observable-match in v1.
- **Non** si auto-attiva dal disco: richiede il flag `--blueprint` esplicito.
- Un ecosistema senza `test_runner.run_file` resta sul controllo 4 legacy (additività dichiarata).
- **Non** è la tracciabilità bidirezionale piena (rinviata).

## 7. Definizione di "fatto" (acceptance) — harness implementabile

Stile `m5_gate_check`/`ecosystem_conformance`, **con le lezioni BD-1** (radice temp PRIVATA per-pid `eval/.tmp-at-<pid>`, cleanup never-throw → ambiente=exit-2 onesto mai falso exit-1; inner-`.git` dei fixture provisionato dall'orchestratore via `eval/anti-tamper/provision_fixtures.sh`; riesecuzione **SERIALE** = verità). **L'harness driva il binario SPEDITO `run_checkpoint --blueprint`** e asserisce `controls[3]` — non solo il checker standalone (così prova la catena reale, chiudendo l'esposizione "verde che non prova nulla" della review).

- **Harness** `eval/harness/anti_tamper_check.mjs`. **Fixture NUOVE** `eval/anti-tamper/<id>/{reference-app, seeded-blueprint}` **con file di test reali** (i fixture BD-1 non ne hanno → non riusabili). Exit 0/1/**2** (precondizione: `.git`/`run_file` assenti). k=2; 0-contaminazione.

**Sotto-test falsificabili (su `run_checkpoint --blueprint` reale):**
1. **faithful** — target_test taggato + passa → `controls[3].green===true`.
2. **tampered-untagged** — covers dichiarato ma tag assente → `controls[3].green===false` (trace); aggiungi il tag su copia → verde (falsificabilità del floor).
3. **tampered-failing** — target_test taggato ma con asserzione che **fallisce** → `controls[3].green===false` (esecuzione); correggi → verde.
4. **not-yet-built** — un task il cui `file` **non esiste** → **saltato**, non RED (incrementale).
5. **ortogonalità** — `validate_blueprint` **PASS** su tutti (struttura valida) mentre il trace distingue.
6. **flag-not-disk (BIT-invarianza)** — `run_checkpoint` sulla reference-app canonica **con** una dir blueprint accanto ma **senza** `--blueprint` → controllo 4 invariato (attivazione solo dal flag).
7. **No-regressione:** `m5` 56/56, `m1..m4`, `ecosystem_conformance` 5 pack, `build_discipline_check`, `run_eval`, `package_skill` lint VERDE — **default-path BIT-invariante** (senza `--blueprint`).
8. **Coverage onesta:** il report non rivendica "test corretto/forte"; observable/semantica dichiarati advisory.

## 8. Posizione nella roadmap

Chiude il gap nominale-vs-reale del test-gate (controllo 4 = AC) + ne blinda la provenienza: è **il moat**, non un 6° stack. Precede la **distribuzione trust-preserving** (BD-1 §8).

## 9. Come si costruisce

**Dynamic Workflows** (`L-COL-027`), **test-first** (l'harness §7 prima), **gate = l'harness** (dogfood), git **solo nell'orchestratore**, merge su `main` **human-gated** (`L-COL-024`), radice temp privata per-pid + `assertIsolatedRepo` (lezioni BD-1). Il plan probabilmente decompone **A** (plumbing + esecuzione per-file) e **B** (trace-check) in due fasi.

## 10. Ledger + rischi / questioni aperte

**Nuovo lock proposto — `L-COL-032`:** *"Controllo 4 = test d'accettazione dell'AC. In BUILD (opt-in flag esplicito `--blueprint`) il controllo 4 **esegue i `target_test` per-AC del task** (i file dichiarati; scope = file presenti sul disco; i mancanti = non-costruiti, saltati) come oracolo d'accettazione, e ogni `target_test` in scope deve **tracciare** (tag AC-id, `covers: <AC-id>` in un commento) agli `acceptance_criteria` che copre, pena controllo 4 RED ('oracolo non valido'). **Floor deterministico** = presenza-del-tag (per-AC globale) **+** esecuzione-del-file; observable-match e fedeltà semantica restano **advisory** (`L-COL-006`). **BIT-invariante** senza `--blueprint` (auto-detect su disco vietato). Meccanizza il test-gate=AC (nominale in `build.md`/`run_checkpoint`) e la provenienza dell'oracolo del controllo 4; raffina `L-COL-019`/`L-COL-031`; l'oracolo resta l'unico giudice (`L-COL-002`)."*

**Rischi / questioni aperte:**
- **`test_runner.run_file` per-ecosistema** — l'invocazione single-file varia per runner; v1 spedisce il template per `supabase-jsts` + i fixture; gli altri pack restano legacy finché non lo dichiarano (additività dichiarata, non buco).
- **Scoping "tutti i target_test materializzati"** — al confine di un macrotask può rieseguire i target_test di task precedenti (acceptance-regression: desiderabile, ma costo). Se troppo, un futuro `--task/--macrotask` può restringere; v1 = tutti i materializzati (stateless).
- **Tag-in-stringa / test vacuo** — limiti noti del floor (token-presence, non adiacenza-asserzione); mitigati dall'esecuzione del file (rotto→RED) e dall'advisory; dichiarati onestamente, non gated.
- **Decomposizione A/B** — possibili due plan; deciso al writing-plans.
- **`control4Conformance` cambia firma** (param opt `blueprintDir`) — additivo, default legacy; va provata la BIT-invarianza di tutti i chiamanti (sotto-test §7.6/§7.7).
