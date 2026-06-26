# AT-1 Fase B — Trace-check AC↔tag + anti-tamper della provenienza — WRITING-PLANS BRIEF

> **Cos'è questo file.** L'**input turnkey** per il `writing-plans` della **prossima sessione**. NON è il plan: è il brief che distilla la spec di design (`docs/superpowers/specs/2026-06-25-anti-tamper-control4-design.md` §5.3/§5.4/§5.5/§7) **già riconciliata col codice Fase A mergeato su `main` (`e718427`)**, così che la prossima sessione apra direttamente in `superpowers:writing-plans` senza ri-derivare nulla. La Fase A (esecuzione dei `target_test` per-AC) è **COSTRUITA, gateata e mergeata** (lock `L-COL-032`); la Fase B ci sale sopra.

| | |
|---|---|
| **Progetto** | Trueline (`COL`) — sub-progetto **AT-1**, **Fase B** |
| **Stato** | Brief pronto. Prossima sessione: `superpowers:writing-plans` → poi build via Dynamic Workflow (`L-COL-027`). |
| **Design sorgente** | `specs/2026-06-25-anti-tamper-control4-design.md` §5.3 (checker), §5.4 (convenzione tag), §5.5 (gated vs advisory), §7 (sotto-test) |
| **Fonda su (già su `main`)** | `trueline/scripts/blueprint/blueprint_tasks.mjs` (loader **esportato** `loadTasks`), ramo AC-acceptance in `checkpoint.mjs::control4Conformance` (r.440–463), `eval/anti-tamper/*` fixture (con tag `// covers:`), `eval/harness/anti_tamper_check.mjs` (keystone Fase A) |

---

## 1. Obiettivo (cosa aggiunge la Fase B)

**(B) Anti-tamper della provenienza dell'oracolo d'accettazione.** Ogni `target_test` **in scope** deve **tracciare** (annotazione tag `covers: <AC-id>` in un **commento**) agli `acceptance_criteria` che copre. Se un AC valutato non è tracciato da alcun file coprente in-scope → **controllo 4 RED PRIMA di eseguire** (`trace.ok===false`). Chiude il buco di gameabilità: un `target_test` che esce verde ma non dichiara *quale* AC esercita non è un oracolo d'accettazione valido. Completa il moat aperto dalla Fase A: *VERDE controllo 4 = AC nominato + eseguito*, non solo eseguito.

L'oracolo resta il giudice (`L-COL-002`); la presenza-del-tag-in-commento è **floor deterministico**, non prova di bontà semantica (`L-COL-006`).

## 2. Il seam d'integrazione — ESATTO (verificato sul codice `main`)

Nel ramo AC-acceptance di `control4Conformance` (`trueline/scripts/checkpoint/checkpoint.mjs`, r.440–463), la Fase B inserisce la **precondizione di trace** TRA il calcolo di `inScope` e il loop d'esecuzione:

```
  ...
  inScope.sort();                                    // r.448 (Fase A, esistente)
  if (inScope.length === 0) return degraded(...);    // r.449–451 (esistente)

  // <<< INNESTO FASE B — precondizione trace (PRIMA di eseguire) >>>
  const trace = assertionTrace(tasks, referenceApp, inScope);   // §5.3
  if (!trace.ok) return { id:4, name:'conformance', status:'red', green:false,
        detail: `target_test non tracciabile all'AC — oracolo non valido: ${trace.detail}` };

  const fails = [];                                  // r.452 (Fase A, esistente)
  for (const file of inScope) { ... }                // esecuzione INVARIATA
  ...
```

Additivo e BIT-invariante: il ramo è già gated da `mode==='build' && blueprintDir && runFileTpl`; la precondizione trace vive **solo** lì dentro. Il default-path/legacy resta byte-identico (`m5` 56/56 invariato).

## 3. Riuso (NON re-inventare) — migliora la spec §5.3

- **Loader.** `trueline/scripts/blueprint/blueprint_tasks.mjs` **esporta già `loadTasks(dir)`** con `covers` normalizzato scalar→array. La Fase B **importa `loadTasks`** nel checker e in `control4` — **NIENTE 3ª replica del parser YAML** (la spec §5.3 diceva "REPLICA il loader" perché *precedeva* la Fase A; ora il loader esportato esiste → si riusa, riducendo il debito-replica annotato in spec §10 e `L-COL-029`). *(Nota: `nonEmptyStr` resta interno a `blueprint_tasks.mjs`, non esportato; il checker non ne ha bisogno.)*
- **Fixture esistenti.** `eval/anti-tamper/{faithful,failing,empty,partial}` portano **già** il tag `// covers: AC-1` (aggiunto in A7 *apposta per la Fase B*). Servono **fixture NUOVE** solo per gli scenari di trace (vedi §6).
- **Harness.** `eval/harness/anti_tamper_check.mjs` (keystone Fase A, 25/25) si **estende** con i sotto-test di trace, oppure un sibling `anti_tamper_trace_check.mjs` (decisione al writing-plans). Riusa la stessa disciplina: radice temp PRIVATA per-pid `eval/.tmp-at-<pid>`, cleanup never-throw, copia isolata per-fixture, driva il binario **spedito** `run_checkpoint --in-place <copia> --blueprint <bp> --mode build`, asserisce `controls[3]`.

## 4. Deliverable Fase B (bozza — da raffinare in writing-plans)

1. **`trueline/scripts/blueprint/ac_assertion_trace_check.mjs`** (sibling di `validate_blueprint`/`ac_observability_check`). **Importa `loadTasks` da `blueprint_tasks.mjs`** (no replica). Esporta `assertionTrace(tasks, appDir, inScope) -> { ok:boolean, detail:string, untracked:[{task_id, ac_id}] }` (consumato da `control4`) + CLI `node ac_assertion_trace_check.mjs <blueprint-dir> <app-dir> [--json]` (exit 0/1). Solo built-in, deterministico, ordine stabile.
2. **Wiring in `checkpoint.mjs::control4Conformance`** — la precondizione trace di §2 (additivo, BIT-invariante).
3. **Convenzione tag documentata** in `trueline/references/build-discipline.md` + `references/blueprint/atomic-task-schema.md` (§5.4): scrivendo il `target_test` (BD-1 momento 2), ogni blocco che esercita un AC porta `covers: AC-x` come **commento**. **Nessun cambio allo schema del task né a `validate_blueprint`.**
4. **Fixture NUOVE** `eval/anti-tamper/<id>` per gli scenari trace (§6) + provisioning (inner-`.git`, passo orchestratore).
5. **Harness** esteso/sibling con i sotto-test di trace (§7).

## 5. Semantica del check (1) AC_TRACE — floor gated (spec §5.3, verbatim utile)

- **Dominio:** un AC è **valutato** sse ≥1 dei suoi file copranti è **in-scope** (esiste su disco); se tutti i copranti mancano → **saltato** (non-RED, coerente con lo skip della Fase A).
- **Tracciato:** un AC valutato è tracciato sse ≥1 dei suoi file copranti **in-scope** contiene il tag (**per-AC GLOBALE**: basta UN file coprente taggato).
- **`covers`** normalizzato scalar→`[scalar]` (già fatto da `loadTasks`).
- **Regex ancorata all'id esatto:** `covers:\s*` + escape(acId) + `\b` (no match parziale `AC-1` dentro `AC-10`).
- **Semantica del commento (precisa):** match valido sse, su una riga, il **primo token non-spazio** è un prefisso-commento `//`/`#`/`--` **oppure** la riga è dentro un blocco `/* … */`, e la riga contiene `covers:<id>` dopo il prefisso. → `codice; // covers: AC-1` **incluso**; `const s = "covers: AC-1"` (riga inizia con codice) **escluso** (chiude la gameabilità tag-in-stringa).
- **Tag spurio** (id non in `covers` di quel file) → **ignorato** (non FAIL, non fa passare AC inesistenti).
- **Trace FAIL ⇒ controllo 4 RED PRIMA di eseguire.** `detail` = elenco `task_id/AC-id` non tracciati, ordinato.
- **(2) OBSERVABLE_MATCH = ADVISORY in v1** (segnale ispezionabile, fuori dal verdetto).

## 6. Fixture nuove suggerite (scenari di trace)

| Fixture | Scenario | Atteso |
|---|---|---|
| `tampered-untagged` | `covers` dichiarato nel blueprint, tag **assente** nel file in-scope | RED (trace); aggiungi tag → verde |
| `tag-in-stringa` | `const s="// covers: AC-1"` (riga inizia con codice), unico "tag" di AC-1 | RED (non conta come tag) |
| `ac-multi-file` | AC coperto da file-A e file-B (entrambi in scope); tag solo in A | verde (per-AC globale); tolto da entrambi → RED |
| `covers-scalare` | `covers: AC-1` (non-lista), taggato | verde |
| `tag-spurio` | file con `covers: AC-99` non dichiarato | ignorato (non altera l'esito) |
| `mixed-coverage` | AC coperto da A (esiste, taggato) + B (manca) | verde (skip di B non maschera); A non-taggato → RED |
| `ortogonalità` | tutti i fixture | `validate_blueprint` PASS mentre il trace distingue |

(I fixture Fase A `faithful`/`failing`/`empty`/`partial` restano validi e già taggati: la Fase B non li rompe — verificare che restino verdi col trace attivo.)

## 7. Sotto-test falsificabili (dalla spec §7 — il sottoinsieme Fase B)

§7.2 tampered-untagged · §7.7 mixed-coverage · §7.8 covers-scalare · §7.9 AC-multi-file · §7.10 tag-spurio · §7.11 tag-in-stringa · §7.12 ortogonalità + **precondizione trace** (trace FAIL ⇒ controllo 4 RED **prima** dell'esecuzione, provato neutralizzando un tag su una copia → RED → ripristino → PASS).

## 8. Vincoli di build (invarianti, come Fase A)

- Node ESM, **solo built-in** (+ moduli `trueline/scripts/*` dep-free); niente `npm install` di rete.
- **Determinismo (`L-COL-002`):** niente `Date.now()`/`Math.random()`; ordine stabile (`.sort()`).
- **BIT-invarianza:** la precondizione trace vive solo nel ramo `mode==='build' && blueprintDir && runFileTpl`; `m5` 56/56 + `ecosystem_conformance` 5 pack + `build_discipline_check` 21/21 invariati.
- **Oracle-as-judge (`L-COL-002`):** il "verde" è exit/output reale, mai una frase LLM.
- **Git solo nell'orchestratore (`L-COL-024`):** gli agenti del workflow scrivono file, NON toccano git; provisioning `.git` dei fixture + commit + merge = passi d'orchestratore; merge `main` **human-gated**.
- **Lezioni BD-1:** radice temp PRIVATA per-pid, cleanup never-throw, **la verità è la riesecuzione SERIALE** dell'orchestratore (mai il green/red sotto concorrenza del workflow).
- **Lingua:** prosa/commenti in italiano; identificatori/`name`/schemi in inglese.

## 9. Ledger

`L-COL-032` (lockato in Fase A) copre l'**esecuzione**; il suo testo nota la Fase B come "plan successivo, NON ancora locked". La Fase B **completa `L-COL-032`** col braccio trace-check: alla chiusura, **emendare** la riga `L-COL-032` in `00-INDEX §4` (o aggiungere un lock gemello) per includere "ogni `target_test` in scope deve tracciare (tag `covers:` in commento) agli AC che copre, pena controllo 4 RED prima dell'esecuzione". Decisione (emendamento vs lock nuovo) al writing-plans.

## 10. Decisioni aperte per il writing-plans

- **Harness:** estendere `anti_tamper_check.mjs` (un solo keystone, +sotto-test trace) **vs** sibling `anti_tamper_trace_check.mjs` (separazione netta esecuzione/trace). *(Raccomandazione: estendere il keystone — un solo gate Fase A+B, meno duplicazione di provisioning.)*
- **Decomposizione in task atomici TDD** (stile Fase A: loader-riuso → checker → wiring → convenzione doc → fixture → harness) + ondate del DAG.
- **Block-scalar / tag multilinea:** la regola "riga-inizia-con-prefisso-commento" è il floor; il limite (stringa raw che inizia con `//`) resta advisory + sotto-test `tag-in-stringa`. Confermare che basta per v1.
- **Refactor del loader condiviso** (`blueprint_tasks.mjs` già è la sorgente unica per i consumatori nuovi) — la Fase B **non** deve toccare `validate_blueprint`/`ac_observability_check` (oracoli gated); il refactor di QUELLE due copie resta follow-up non-bloccante.

## 11. Kickoff prossima sessione (primo movimento)

1. `PROMPT-SESSION-START` (recupero contesto: SESSION-STATE → milestone = AT-1 Fase B → questo brief + spec §5.3/§5.4/§5.5/§7).
2. Branch di lavoro nuovo `feat/at-1b-trace-check` da `main` (`e718427`).
3. `superpowers:writing-plans` → produci `docs/superpowers/plans/2026-06-2X-at-1b-trace-check.md` (code-complete, task TDD, gate scritto prima — `L-COL-019`/`L-COL-027`), usando questo brief come input.
4. (Opzionale) authoring del workflow di build `docs/superpowers/workflows/…-at-1b-build.js` (mirror di quello Fase A).
5. Build via `Workflow` → poi T3.1 orchestratore (provisioning + keystone + no-regressione SERIALE + lock + merge human-gated).
