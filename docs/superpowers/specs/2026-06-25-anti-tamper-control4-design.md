# Design — Controllo 4 = test d'accettazione dell'AC + anti-tamper della provenienza (AT-1, rifondato)

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Sub-progetto** | **AT-1** — il controllo 4 diventa il vero test-gate dell'AC, con la provenienza dell'oracolo blindata |
| **Tema** | (A) Far sì che il controllo 4 in BUILD **esegua i `target_test` per-AC del task** come oracolo d'accettazione (oggi gira `npm test`/characterization, blueprint-cieco). (B) **Anti-tamper**: ogni `target_test` in scope deve **tracciare** (annotazione tag AC-id) agli `acceptance_criteria` che copre. |
| **Data** | 25 giugno 2026 |
| **Stato** | Design **rifondato** dopo review #1 (k=5: premessa falsa) **e rifinito** dopo review #2 (k=3 sul wiring: report `…-review2.md`). Pronto per review utente → writing-plans. |
| **Risolve** | L'hand-off di BD-1 (§5.2 momento 2 / §7.5) **e** il gap nominale-vs-reale del test-gate: il "controllo 4 = test d'accettazione dell'AC" è prosa di `build.md`/`run_checkpoint.mjs`, non codice. |
| **Dipende da** | `trueline/scripts/checkpoint/checkpoint.mjs` (`control4Conformance` r.423, `runCheckpoint` r.520, `detectTestRunner` r.457, `runTests` r.487, `loadCharacterization`), `trueline/scripts/checkpoint/run_checkpoint.mjs` (`parseArgs` r.81, `runOn` r.258), `trueline/scripts/loop/run_loop.mjs` (r.244, r.353), `trueline/scripts/blueprint/{validate_blueprint,ac_observability_check}.mjs` (loader **non esportato** → replica), `references/ecosystems/<id>/ecosystem.json` (`test_runner`), `11`/`atomic-task-schema.md` (`target_tests[].covers`), `build.md` momento 2 |
| **Contesto** | report di review #1 e #2 (committati); `docs/superpowers/competitive/2026-06-24-*` |

---

## 1. Contesto e obiettivo

**Lo stato reale (verificato).** Il controllo 4 è **blueprint-cieco**: `control4Conformance(referenceApp, { mode, characterization, finding })` (checkpoint.mjs:423) non legge blueprint / `acceptance_criteria` / `target_tests` / `covers`. In BUILD esegue `characterizationInvariance` (se una baseline è auto-rilevata da `loadCharacterization`) **oppure** `detectTestRunner → runTests` = **`npm run test` sull'intera suite** (oppure DEGRADATO). `run_checkpoint.mjs` (entrypoint al confine del macrotask) **non ha flag blueprint**. Quindi "controllo 4 = test d'accettazione del `target_test` dell'AC" (`run_checkpoint.mjs` r.14; `build.md` §3) è **nominale**.

**La scoperta (review #1, k=5).** La v1 di AT-1 voleva blindare la provenienza di un oracolo che il controllo 4 **non esegue**: bolt-on a un link inesistente. Riallineando: il deliverable corretto è **più foundational** — rendere il controllo 4 il vero test-gate dell'AC, poi blindarne la provenienza.

**Obiettivo.** (A) In BUILD, il controllo 4 **esegue i file specifici dei `target_test` per-AC del task** come oracolo d'accettazione. (B) Ogni `target_test` in scope deve **tracciare** (tag AC-id) agli AC che copre, pena controllo 4 RED. Chiude il gap nominale-vs-reale (il moat) + meccanizza l'hand-off di BD-1. L'oracolo resta il giudice (`L-COL-002`).

## 2. Requisiti decisi (brainstorming + 2 review)

- **(A) Esecuzione per-file (fedele).** Il controllo 4 esegue i **file specifici** dei `target_test` in scope, non la suite intera. **Scoping:** in scope = i `target_test` il cui `file` **esiste** su disco sotto `projectDir` (= task costruiti); i file **mancanti** = task **non costruiti** → **saltati, mai RED**. In-scope vuoto → **degradato** (onesto, non verde).
- **Opt-in via FLAG ESPLICITO `--blueprint <dir>`** — mai auto-detect su disco (protegge `m5` 56/56). Senza il flag, byte-identico a oggi.
- **Precedenza esplicita** (chiude review #2): `if (mode==='build' && blueprintDir) → ramo AC-acceptance` (**preempta** la characterization, anche se auto-rilevabile) `else if (charz) → invarianza` `else → legacy`. Così una baseline characterization residua non dirotta il controllo 4 fuori dal ramo AC. La regressione resta al **controllo 3** (characterization, invariato).
- **(B) Trace-check — floor deterministico.** Per ogni AC il cui ≥1 file coprente è **in-scope**: ≥1 di quei file in-scope contiene il tag `covers: AC-id` (**per-AC GLOBALE**). `covers` normalizzato **scalare-o-lista**; tag **ancorato all'id esatto**; tag **spurio** (id non in `covers` di quel file) ignorato. Trace FAIL ⇒ controllo 4 RED **prima** di eseguire.
- **Onestà del verdetto (`L-COL-006`).** **VERDE controllo 4 = (file in scope esiste ∧ taggato ∧ esegue ≥1 test ∧ esce 0).** **NON** garantisce che l'asserzione eserciti l'AC. **Advisory/limiti noti:** un test con asserzione **vacua** (`assert.ok(true)`) passa; l'observable-match (declassato in v1); la fedeltà semantica. Floor anti-vacuo deterministico: il runner deve riportare **≥1 test eseguito** (dove parseabile, es. `node --test`).
- **Footprint:** **nessun** cambio a schema del task / `validate_blueprint`. Il checker **REPLICA** il loader (`validate_blueprint` non esporta nulla; stesso pattern di `ac_observability_check`); il refactor in modulo condiviso è **follow-up non-bloccante**. Estensione additiva: firma di `control4Conformance` (+`blueprintDir`,+`manifest`, default legacy), `run_file` nel manifest, 1 checker sibling nuovo, plumbing `--blueprint` in `run_checkpoint`/`run_loop`. BUILD-only; REMEDIATE invariato.

## 3. Decomposizione

Due pezzi **accoppiati**, possibili **due plan** (deciso al writing-plans): **A** = plumbing `--blueprint` end-to-end + esecuzione per-file (`run_file`) + precedenza control4; **B** = `ac_assertion_trace_check` (replica loader) + convenzione tag + wiring come precondizione. A è prerequisito di B.

## 4. Approccio scelto

Fedele: il controllo 4 esegue i file specifici dei `target_test` come oracolo d'accettazione, col trace-check come precondizione. Scartati: "suite intera" (over-broad), "solo trace-check" (bolt-on a oracolo non eseguito), auto-detect su disco (rompe BIT-invarianza).

## 5. Design

### 5.1 Data-flow `--blueprint` + `manifest` end-to-end (i 5 edit concreti)

Il flag **non esiste** oggi; va cablato (review #2). Edit, tutti additivi:
1. `run_checkpoint.mjs::parseArgs` (r.81): `+ --blueprint <dir>` → `flags.blueprint`.
2. `run_checkpoint.mjs::runOn` (r.258): propaga `blueprintDir` a `runCheckpoint`.
3. `checkpoint.mjs::runCheckpoint` (r.520): destruttura `blueprintDir = null`; lo passa a `control4Conformance` **insieme al `manifest` già risolto** (r.539) → `control4Conformance(app, { mode, characterization, finding, blueprintDir, manifest })`.
4. `checkpoint.mjs::control4Conformance` (r.423): firma `+ blueprintDir=null, manifest=null`; ramo nuovo **solo** se `mode==='build' && blueprintDir` (default → legacy byte-identico).
5. `run_loop.mjs` (r.353): passa `blueprintDir` (già letto in r.244) a `runCheckpoint` sul build-path.

**BIT-invarianza** (review #2 la conferma additiva): senza `--blueprint`, ogni chiamante passa un opts senza la chiave → default `null` → ramo legacy invariato. `m5` 56/56 è invariante **per costruzione** (gira `run_loop --mode=remediate`, non tocca il ramo build); la copertura del build-path vive nelle **fixture nuove** (§7), con un golden-assert che importa `control4Conformance` senza `blueprintDir` e prova output identico al pre-cambio.

### 5.2 Il controllo 4 come oracolo d'accettazione (ramo `mode='build' && blueprintDir`)

```
control4Conformance(app, { mode, characterization, finding, blueprintDir, manifest }):
  if mode==='build' and blueprintDir:                      # PRECEDENZA: preempta characterization
     runFileTpl = manifest?.test_runner?.run_file
     if not runFileTpl:  return legacy(...)                # guard: pack senza run_file -> LEGACY (BIT-inv.)
     tasks   = loadTasksReplica(blueprintDir)              # REPLICA del loader (validate_blueprint non esporta)
     inScope = [ (task,tt) for task in tasks for tt in task.target_tests if exists(app/tt.file) ]
     if inScope == []:  return degraded("nessun target_test materializzato")    # onesto, non verde
     trace = assertionTrace(tasks, app, inScope)           # (B) §5.3
     if not trace.ok:   return RED("target_test non tracciabile all'AC — oracolo non valido")
     for (task,tt) in inScope:
        r = runFile(app, tt.file, runFileTpl)              # §5.2bis
        if r.error:     return ERROR(...)                  # errore-di-MISURA (retry esistente), non RED
        if r.testCount < 1: return RED("target_test non esegue alcun test (vacuo)")   # floor anti-vacuo
        if not r.passed:    return RED("target_test fallisce")
     return GREEN("accettazione AC: N file in scope verdi")
  else if characterization-or-autoload(app):  return characterizationInvariance(...)   # invariato
  else:                                        return legacy detectTestRunner/degraded  # invariato
```
Deterministico: ordine stabile (`sort`) su task/target_test/file; nessun `Date.now`/`Math.random`.

### 5.2bis Esecuzione del file (`test_runner.run_file`, additivo; v1 = `node --test`)

Il manifest `ecosystem.json` (`test_runner`, SP-0) guadagna **`run_file`**: template con `{file}`. **v1 spedisce `run_file: "node --test {file}"`** per `supabase-jsts` (e per i fixture nuovi): è l'**unico runner zero-install** (built-in Node, provvigionabile offline; vitest/jest non sono installati in nessuna app dell'eval). Esecuzione via **`spawnSync` array-argv** (NON `shell:true` come `runTests`; niente quoting/Windows), `cwd=app`, PATH+GO_BIN. Si parsa l'output di `node --test` per `testCount` (TAP `# tests N`) e pass/fail; **`testCount<1` ⇒ RED** (floor anti-vacuo); spawn-error/crash-di-caricamento ⇒ `error` (eleggibile al **retry-di-misura** esistente `measureAttempts`, non RED). **Guard:** un manifest **senza** `run_file` → ramo **legacy** (BIT-invariante). *Nota onesta (review #2): per altri runner `exit 0` su file-vuoto varia (vitest/pytest falliscono, node:test no) → il floor `testCount≥1` rende il gate portabile; jest tratterebbe `{file}` come regex → un futuro template deve usare la forma ancorata (`--runTestsByPath`).*

### 5.3 `ac_assertion_trace_check.mjs` (checker sibling, REPLICA il loader)

`trueline/scripts/blueprint/ac_assertion_trace_check.mjs`, fratello di `validate_blueprint`/`ac_observability_check`. **REPLICA** `extractYamlBlocks`/`parseTasks`/`loadTasks` (verbatim, come `ac_observability_check` — `validate_blueprint` non esporta nulla; §6) ed esporta `assertionTrace(tasks, appDir, inScope)` (importato da `control4Conformance`) + CLI `node ac_assertion_trace_check.mjs <blueprint-dir> <app-dir> [--json]` (exit 0/1).
- **Check `(1) AC_TRACE` (floor, gated):** **dominio** = un AC è valutato sse ≥1 dei suoi file copranti è **in-scope** (esiste); se tutti mancano → **saltato** (non-RED). Un AC valutato è **tracciato** sse ≥1 dei suoi file copranti **in-scope** contiene il tag. `covers` normalizzato (scalar→`[scalar]`). Regex **ancorata all'id esatto**: `covers:\s*` + escape(acId) + `\b`. **Semantica del commento (precisa):** match valido sse, su una riga, il **primo token non-spazio** è un prefisso-commento `//`/`#`/`--` **oppure** la riga è dentro un blocco `/* … */`, e la riga contiene `covers:<id>` dopo il prefisso. → `codice; // covers: AC-1` (commento di coda) **incluso**; `s = "covers: AC-1"` (stringa, la riga inizia con codice) **escluso**. Tag **spurio** (id non in `covers` di quel file) → ignorato (non FAIL). `detail` = elenco `task_id/AC-id` non tracciati, ordinato.
- **`(2) OBSERVABLE_MATCH` (ADVISORY in v1, non gate):** segnale ispezionabile, fuori dal verdetto.
- Determinismo (`L-COL-002`): solo built-in, ordine stabile. Ortogonale a `validate_blueprint` (struttura) e `ac_observability_check` (osservabilità nel blueprint).

### 5.4 La convenzione di annotazione (BD-1 momento 2)

Scrivendo il `target_test` (momento 2 di `build.md`), ogni blocco che esercita un AC porta un tag **`covers: AC-x`** come **commento** (`//`/`#`/`--`/`/* */`, semantica §5.3). Documentato in `build-discipline.md` + `atomic-task-schema.md`. **Nessun cambio allo schema** né a `validate_blueprint`. **Confine onesto:** il floor prova la **presenza** del token entro un commento per ogni AC valutato — **non** l'adiacenza a un'asserzione né la bontà. L'**esecuzione** (A) coglie il file **rotto** (exit≠0) e il file **senza test** (`testCount<1`), **non** un'asserzione **vacua** (`assert.ok(true)` esce 0) → advisory.

### 5.5 Cosa è gated vs advisory (onesto)

| | Meccanismo | Coglie |
|---|---|---|
| **Gated** | il `target_test` in scope **esiste** | "file mai scritto" (degradato/skip; il task non avanza) |
| **Gated** | `(1) AC_TRACE` presenza-tag-in-commento | "AC valutato ma mai nominato in alcun file coprente in-scope" |
| **Gated** | `run_file` `testCount≥1` | file **senza alcun test** (vacuo strutturale) |
| **Gated** | `run_file` esito | target_test **rotto/fallisce** (exit≠0) |
| **Advisory** | `(2) OBSERVABLE_MATCH`; self-check | asserzione **vacua** (`assert.ok(true)`); mismatch letterale; fedeltà semantica |

> **Chiosa di onestà (`L-COL-006`):** VERDE del controllo 4 = (file in scope ∧ taggato ∧ ≥1 test eseguito ∧ esce 0). NON implica che l'asserzione eserciti l'AC.

## 6. Confini (cosa NON fa)

- **Non** cambia lo schema del task; **non** cambia il **comportamento** di `validate_blueprint` (il checker **replica** il loader — nessun import/refactor di `validate_blueprint` in v1); **non** tocca i controlli 1/2/3 né il ramo REMEDIATE/characterization del controllo 4.
- **Non** prova la bontà semantica del test (vacuo = advisory); **non** gata l'observable-match in v1.
- **Non** si auto-attiva dal disco: richiede `--blueprint` esplicito.
- Un ecosistema senza `test_runner.run_file` resta legacy (additività dichiarata).
- **Non** è la tracciabilità bidirezionale piena (rinviata).

## 7. Definizione di "fatto" (acceptance) — harness implementabile

Stile `m5_gate_check`/`ecosystem_conformance`, **lezioni BD-1** (radice temp PRIVATA per-pid `eval/.tmp-at-<pid>`, cleanup never-throw, riesecuzione SERIALE = verità). **Fixture NUOVE auto-contenute** `eval/anti-tamper/<id>/{reference-app, seeded-blueprint}` con file `*.test.mjs` **reali** (`node:test`, `"type":"module"`, **zero npm install**); inner-`.git` + dir `tests/` provisionati dall'orchestratore (`eval/anti-tamper/provision_fixtures.sh`). **L'harness driva il binario SPEDITO `run_checkpoint --in-place <copia-fixture> --blueprint <bp> --mode build`** (non il default-copia-canonico, che rifiuta projectDir custom) e asserisce `controls[3]`. Exit 0/1/**2** (precondizione: `.git`/`run_file` assenti); k=2; 0-contaminazione (HEAD esterno+interni invariati).

**Sotto-test falsificabili (su `run_checkpoint --blueprint` reale, salvo dove detto):**
1. **faithful** — taggato + ≥1 test + passa → `controls[3].green===true`.
2. **tampered-untagged** — covers dichiarato, tag assente → RED (trace); aggiungi tag su copia → verde.
3. **tampered-failing** — taggato ma asserzione che **fallisce** → RED (esecuzione); correggi → verde.
4. **tagged-empty** — taggato ma **zero test** (`testCount<1`) → RED (floor anti-vacuo).
5. **tagged-vacuous** *(documenta il limite, onesto)* — taggato + `test('x',()=>assert.ok(true))` → **green** (asserisce `controls[3].green===true`: il buco semantico è advisory, non nascosto).
6. **not-yet-built** — task il cui file non esiste → **saltato**, non RED.
7. **mixed-coverage** — AC coperto da file-A (esiste) + file-B (manca): A taggato → verde; A non-taggato → RED (lo skip di B non maschera il trace-fail su A).
8. **covers-scalare** — `covers: AC-1` (non-lista), taggato → verde.
9. **AC-multi-file** — covers su A e B (entrambi in scope); tag in A solo → verde (per-AC globale); tolto da entrambi → RED.
10. **tag-spurio** — file con `covers: AC-99` non dichiarato → ignorato (non fa passare AC-99 né altera l'esito).
11. **tag-in-stringa** — `const s="// covers: AC-1"` (riga inizia con codice) → **NON** conta come tag → se è l'unico "tag" di AC-1 → RED (gameabilità chiusa).
12. **ortogonalità** — `validate_blueprint` PASS su tutti i fixture mentre il trace distingue.
13. **flag-not-disk (attivazione)** — sul fixture **faithful**: `run_checkpoint --in-place <copia> --mode build` **senza** `--blueprint` → controllo 4 **legacy** (degradato/legacy-runner) **≠** **con** `--blueprint` → green AC-acceptance; asserire che **DIFFERISCONO** (prova che commuta il flag, non il disco).
14. **run_loop-propagation** — `run_loop --mode=build --blueprint` propaga al checkpoint (controls[3] riflette il ramo AC) — altrimenti il BUILD-path spedito resta scollegato.
15. **default BIT-invariante** — golden-assert: `control4Conformance` senza `blueprintDir` = output identico al pre-cambio.
16. **No-regressione:** `m5` 56/56, `m1..m4`, `ecosystem_conformance` 5 pack, `build_discipline_check`, `run_eval`, `package_skill` lint VERDE.
17. **Coverage onesta:** il report non rivendica "test corretto/forte"; vacuo/observable/semantica dichiarati advisory.

## 8. Posizione nella roadmap

Chiude il gap nominale-vs-reale del test-gate (controllo 4 = AC) + ne blinda la provenienza: **il moat**. Precede la **distribuzione trust-preserving** (BD-1 §8).

## 9. Come si costruisce

**Dynamic Workflows** (`L-COL-027`), **test-first**, **gate = l'harness**, git **solo nell'orchestratore**, merge **human-gated** (`L-COL-024`), radice temp privata per-pid (lezioni BD-1). Plan: probabilmente **A** (plumbing + `run_file` + precedenza) poi **B** (trace-check), due fasi.

## 10. Ledger + rischi / questioni aperte

**Nuovo lock proposto — `L-COL-032`:** *"Controllo 4 = test d'accettazione dell'AC. In BUILD (opt-in flag esplicito `--blueprint`) il controllo 4 **esegue i file dei `target_test` per-AC del task** (scope = file presenti; mancanti = non-costruiti, saltati) come oracolo d'accettazione, e ogni `target_test` in scope deve **tracciare** (tag `covers: <AC-id>` in un commento) agli `acceptance_criteria` che copre, pena controllo 4 RED. **VERDE = (file in scope ∧ taggato ∧ ≥1 test eseguito ∧ esce 0)**; NON garantisce che l'asserzione eserciti l'AC (asserzione vacua, observable-match e fedeltà semantica restano **advisory**, `L-COL-006`). **BIT-invariante** senza `--blueprint` (auto-detect su disco vietato); precedenza esplicita sopra la characterization (che resta al controllo 3). Meccanizza il test-gate=AC (nominale in `build.md`/`run_checkpoint`) e la provenienza dell'oracolo; raffina `L-COL-019`/`L-COL-031`; l'oracolo resta l'unico giudice (`L-COL-002`)."*

**Rischi / questioni aperte:**
- **`run_file` v1 = `node --test`** (zero-install). Altri runner (vitest/jest/pytest) = follow-up con template ancorato; finché un pack non dichiara `run_file`, resta legacy (additività).
- **File-vuoto/vacuo** — `testCount≥1` coglie il file senza test; l'asserzione **vacua** (`assert.ok(true)`) resta advisory/limite noto (sotto-test 5 lo documenta, non lo nasconde).
- **Replica del loader** (3ª copia del parser YAML) — debito accettato (precedente `ac_observability_check`); refactor in `blueprint_loader.mjs` condiviso = follow-up (toccherebbe `validate_blueprint`, oracolo gated).
- **Scope "tutti i materializzati"** — può rieseguire i target_test di task precedenti (acceptance-regression desiderabile; costo). Un futuro `--task/--macrotask` può restringere.
- **Tag-in-stringa multilinea / block-scalar** — la regola "riga-inizia-con-prefisso-commento" riduce ma non elimina ogni stringa raw che inizia con `//`; limite noto, mitigato da advisory + sotto-test 11.
- **Decomposizione A/B** — possibili due plan; deciso al writing-plans.
