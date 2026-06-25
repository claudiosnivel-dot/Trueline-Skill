# Design — Disciplina di costruzione per la modalità BUILD

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Tema** | Disciplina di *costruzione* (writing/reasoning) per BUILD — fusione dell'additivo delle linee guida **Karpathy** + spina di processo stile **superpowers**, subordinata agli oracoli |
| **Data** | 24 giugno 2026 |
| **Stato** | Design rivisto post-review adversariale (1 blocking + 6 major chiusi). In attesa di review utente → writing-plans. |
| **Risolve** | Il *drift verso la sola verifica*: riequilibra la metà **BUILD** di `L-COL-015` (lifecycle, non solo verificatore). |
| **Dipende da** | `01-ARCHITECTURE` (pipeline BUILD, checkpoint), `02-SKILL-ANATOMY` (progressive disclosure, dispatch-table del corpo), `05-VERIFY-FIX-LOOP`, `06-CHARACTERIZATION-TESTS`, `11-BLUEPRINT-ENGINE` (schema del task atomico), `references/modes/build.md`, `references/modes/remediate.md`, `references/blueprint/atomic-task-schema.md`, `trueline/SKILL.md` §2 |
| **Contesto** | `docs/superpowers/competitive/2026-06-24-competitive-intel.md` + `-addendum.md` (analisi competitiva, corroborante non portante) |

---

## 1. Contesto e obiettivo

**La diagnosi (dell'utente, corretta).** L'idea originale di Trueline era *far ragionare l'agente per scrivere codice più pulito*. `L-COL-015` la mette nero su bianco: lifecycle skill, "il valore è il metodo blueprint-first **+** il gate, non la sola verifica". Ma lo *sforzo di implementazione* (M-1…M5, SP-0…SP-7) è andato quasi tutto nella metà **VERIFY**. La prova è verificabile in-repo: in `references/modes/build.md` lo **step 2 ("Costruisce i task atomici")** dice solo *"consuma DoD + acceptance_criteria come specifica"* — nessuna guida sul **come** si scrive (assunzioni, semplicità, ampiezza del diff). La sezione "Disciplina BUILD" dello stesso file elenca solo regole di *gate* (oracle-as-judge, git, deploy-coupling), zero regole di *scrittura*.

**Razionale di priorità — guidato dal claim verificabile.** La giustificazione primaria è il **riequilibrio della metà BUILD di `L-COL-015`** (VISION §1), affermazione tracciabile a `build.md` step 2 e indipendentemente verificabile. L'analisi competitiva del 24 giu (ora in `docs/superpowers/competitive/`) **corrobora** la priorità — colloca la "disciplina di BUILD blueprint-first verificata" come terreno difendibile e nota che il differenziatore *test-gate* è già spedito (control 3 "Regressioni", `build.md`:87) — ma non è il pilastro portante e i suoi claim sui competitor (securecoder/supashield) restano contesto esterno, non fatti di Trueline. *Questo deliverable rende non-sottile la metà di scrittura; non tocca il test-gate, che esiste già.*

**Obiettivo.** Dare a BUILD una **disciplina di costruzione nominata** per lo step di scrittura, assorbendo l'additivo migliore di superpowers e delle linee guida Karpathy, **subordinata all'oracolo** (`L-COL-002` resta intatto). Riequilibra Trueline verso la metà BUILD senza toccare il motore di verifica.

## 2. Requisiti decisi (brainstorming)

- **Tre strati, ognuno nella sua corsia, impilati — non in competizione.**

  | Strato | Fonte | Governa | Giudica? |
  |---|---|---|---|
  | Disciplina di scrittura | **Karpathy** (additivo) | *come* si scrive ogni task (assunzioni esplicite, codice minimo, diff chirurgico) | mai |
  | Spina di processo | **superpowers** (ri-espressa nativa) | *il flusso* (intento→design→piano→test-first→debug) | mai |
  | Il verdetto | **oracoli Trueline** | pulito/sicuro/conforme al confine del macrotask | **solo qui** |

- **Da Karpathy si assorbe SOLO l'additivo** (analisi del repo `multica-ai/andrej-karpathy-skills`, MIT): **Simplicity First** + **Surgical Changes** + il gate-assunzioni **Think Before Coding**. La notazione `Step → verify` è **ri-legata all'oracolo**. Si **scarta** il "loop until verified" LLM-interno e qualunque self-judge come gate. Da superpowers si ri-esprime nativa anche **systematic-debugging** (root-cause-before-patch), per il loop di fix (§5.2bis).
- **Floor deterministico + advisory dichiarato.** Dove un aspetto è oracolabile (osservabilità strutturale di un AC; dead-code nuovo) si fa un **gate falsificabile**; dove non lo è (eleganza, ambiguità semantica profonda) resta **advisory dichiarato**, mai un verdetto. È lo stesso pattern floor+coverage di `L-COL-030`/`L-COL-006`.
- **Self-contained / cross-tool** (`L-COL-009`): nessuna dipendenza da skill esterne installate. Disciplina **encodata nativa**, attribuzione MIT.
- **Advisory, mai gate** (`L-COL-002`, `L-COL-006`): la disciplina *migliora la scrittura*; il verdetto resta dell'oracolo. "Codice pulito/elegante" **non** è oracolabile e **non** si rivendica.

## 3. Decomposizione

Pezzo **autocontenuto** (un reference nuovo + un checker deterministico nuovo `ac_observability_check.mjs` + wiring + un harness d'accettazione falsificabile). **Non** è un programma. Primo deliverable della fase di riequilibrio BUILD. Un solo ciclo spec → plan → implementazione.

## 4. Approccio scelto

**Reference nativo di disciplina, come strato advisory sullo step di costruzione, con un floor deterministico dove l'oracolo può esistere.** L'engine e il checkpoint a 4 controlli non cambiano; cambia *come l'agente scrive* dentro lo step 2 di BUILD, più **un solo** checker deterministico nuovo (osservabilità degli AC).

Scartati: dipendere dalle skill esterne installate (rompe `L-COL-009`); gate LLM sulla qualità (rompe `L-COL-002`); cambiare lo schema del task atomico (blast radius inutile — lo schema ha già `acceptance_criteria`/`target_tests`/`out_of_scope`).

## 5. Design

### 5.1 Il nuovo reference `references/build-discipline.md`

Reference di livello 3, caricato on-demand **solo per la modalità attiva** (`L-COL-014`): in **BUILD** tutti i momenti; in **REMEDIATE** il sottoinsieme che ha senso (§5.2bis). Contiene la disciplina di scrittura (§5.2), la linea oracle-as-judge (§5.3), e le linee guida Karpathy distillate con attribuzione MIT (`forrestchang`/`multica-ai`, fonte: post di Karpathy). Il file è coperto **automaticamente** dal lint di packaging esistente non appena `build.md`/`SKILL.md` §2 lo referenziano (`09` §3 valida esistenza-file-referenziato e riferimenti-orfani): **nessun cambio a `09`**.

### 5.2 I momenti della costruzione (espansione di `build.md` step 2)

Per ogni task atomico, in BUILD:

1. **Gate delle assunzioni — *Think Before Coding*** (Karpathy). Prima di scrivere: enumera le assunzioni, presenta le interpretazioni se più d'una, **fermati** se ambiguo. Riconcilia contro gli `acceptance_criteria`. **Floor deterministico:** quando un AC è strutturalmente non-osservabile (un `then` con token vaghi bannati — "funziona bene"/"robusto"/"sicuro"/"performante" — o senza alcun osservabile), il momento 1 **emette una nota machine-readable** `{task_id, ac_id, reason, action:"return-to-blueprint"}` invece di procedere, e il checker deterministico `ac_observability_check.mjs` (§5.4) la **flagga** → ritorno al blueprint (`11` §5.2). **Advisory oltre il floor:** l'ambiguità semantica più profonda resta colta dal self-check semantico (LLM-guidato, `self-check-checklist.md` §6) — dichiarato advisory, *non* parte del gate (`L-COL-006`). *Puro ragionamento → compatibile con `L-COL-002`.*
2. **Test-first sull'AC — *traduci*, non scrivere il tuo giudice** (superpowers TDD + provenienza). Scrive prima il `target_test` che fallisce, poi il codice. **Regola di provenienza** (chiude l'esposizione control-4): in BUILD le **asserzioni** del test d'accettazione (oracolo del controllo 4) **derivano dagli `acceptance_criteria` (given/when/then) scritti dal blueprint** e devono tracciare ad essi; l'LLM fa *scaffold/wiring* del file, **non inventa** il comportamento asserito. Un `target_test` le cui asserzioni divergono dal suo AC è **esso stesso un difetto-blueprint / violazione d'integrità del controllo 4** (`L-COL-019` tiene il giudice di proprietà del blueprint). *La meccanizzazione piena della tracciabilità AC↔asserzioni è compito del deliverable di anti-tamper (fase moat successiva); qui il momento 2 è ristretto a "tradurre l'AC in forma eseguibile".*
3. **Scrittura minima e chirurgica** (Karpathy *Simplicity First* + *Surgical Changes*). Il diff più piccolo che fa passare il test: niente astrazioni speculative, niente error-handling per scenari impossibili, "se 200 righe potevano essere 50, riscrivi". **Ogni riga cambiata traccia al task**; rispetta lo stile esistente; **non lascia orfani nuovi** (scrivi stretto — *non* generare orfani; **nessuna cancellazione autonoma**: ogni rimozione effettiva resta sul path dead-code human-gated, `L-COL-021`). *Allineato* a `L-COL-021`, non coincidente: `L-COL-021` governa la rimozione human-gated di dead-code *rilevato*; qui si tratta di non *introdurne*. **Passata di tidy advisory** (chiusura del momento): "troppo complicato? ogni riga traccia?" — quando scatta **registra una nota ispezionabile** `{advisory:true, complexity_flag:true}`, **mai** un verdetto, **fuori** dagli input di `run_checkpoint` → provabilmente non può fare da gate (§7).

### 5.2bis Disciplina di costruzione della fix — loop RED & REMEDIATE *(systematic-debugging)*

Il difetto "sporco su sporco" (VISION §2: entropia monotona a ogni iterazione di fix) vive nel **loop di fix a checkpoint-RED** (`build.md` §4 Rosso; `05`; `remediate.md` §5), dove oggi l'unica guida è "patch materialmente diversa". Si aggiunge una disciplina **root-cause-before-patch** (da superpowers/systematic-debugging): prima di ri-editare, modella l'intorno e la causa radice; poi la patch minima. *Puro ragionamento, advisory, mai gate — il re-run dello stesso oracolo emette il verdetto (`L-COL-002`).* **In REMEDIATE** i momenti attivi sono: gate-assunzioni (1), scrittura chirurgica (3), e questa disciplina di fix; il **momento 2 (test-first) è superato** dalla baseline di caratterizzazione (`06`/`remediate.md` §5, partizione guard/impacted) — in REMEDIATE non si scrive un test-che-fallisce-prima per una fix.

### 5.3 Il confine oracle-as-judge (la linea che non si attraversa)

- I momenti **producono** il codice; il **checkpoint a 4 controlli giudica** (`01` §4). La disciplina sta nella corsia permessa all'LLM (ragionare, decomporre, tradurre, scrivere), mai in quella vietata (emettere verdetti).
- Il `verify:` di ogni passo è **un test/oracolo**, mai l'auto-giudizio dell'LLM — e (momento 2) il test è **vincolato all'AC del blueprint**, non scritto liberamente in BUILD.
- L'osservabilità degli AC ha un **floor deterministico** (`ac_observability_check.mjs`); l'ambiguità oltre il floor è **advisory dichiarata**, non gated.
- Il tidy self-check (momento 3) è **advisory con output ispezionabile** ma **fuori dagli input del checkpoint** → non può gating.
- **Asimmetria onesta** (VISION §6, `L-COL-006`): "pulito/elegante" non è oracolabile, quindi non si rivendica come verificato.

### 5.4 Schema invariato; un solo checker nuovo (sibling)

**Nessuna modifica** allo schema del task atomico (`atomic-task-schema.md`) né a `validate_blueprint` — già portano `objective`/`definition_of_done`/`acceptance_criteria`/`target_tests`/`out_of_scope`. Si aggiunge **un solo** artefatto deterministico nuovo: `scripts/blueprint/ac_observability_check.mjs`, **fratello** di `validate_blueprint` (non una sua modifica), che asserisce l'osservabilità strutturale degli `then` degli AC (token vaghi bannati + presenza di un osservabile). È l'unico "engine" toccato, ed è additivo.

### 5.5 Wiring (con onestà sul corpo)

- **`build.md`**: tabella "Reference caricati in BUILD" +`references/build-discipline.md`; step 2 espanso nei momenti §5.2/§5.2bis; sezione "Disciplina BUILD" con i bullet di scrittura accanto a quelli di gate, e la linea "questi guidano la scrittura, l'oracolo resta il giudice".
- **Corpo spedito** — *edit dichiarato*: aggiungere la riga `references/build-discipline.md` alla **dispatch-table di `SKILL.md` §2** (● BUILD; ● REMEDIATE) e in `02-SKILL-ANATOMY` §6. È **una riga di dati nella tabella di caricamento per-modalità, zero logica** — coerente con `L-COL-014`/`L-COL-029` (il corpo resta senza logica di ecosistema/disciplina). Il claim "non si tocca il corpo" va quindi qualificato: si aggiunge *una riga di routing*, non logica.
- **Ancora d'accettazione**: la verifica del caricamento per-modalità è `10` §5 (regression suite) + `09` §9 (spot-check cross-tool); `02` §6 resta la *regola di design*, non il check.

## 6. Confini (cosa NON fa)

- **Non** tocca il checkpoint, gli oracoli, il finding model, la **semantica** del loop di fix (aggiunge solo disciplina di ragionamento al loop RED, §5.2bis).
- **Non** aggiunge gating basato su giudizio LLM (`L-COL-002` invariato); l'unico gate nuovo è **deterministico** (`ac_observability_check`).
- **Non** modifica lo schema del task né `validate_blueprint`; l'unico engine nuovo è il checker sibling (§5.4).
- **Tocca il corpo** solo per **una riga** di dispatch-table (§5.5) — dichiarato, nessuna logica.
- **Non** dipende da skill esterne installate.
- **Non** rivendica "codice pulito/elegante" come oracle-verified (`L-COL-006`).
- **Non** è il deliverable di anti-tamper né di distribuzione (successivi).

## 7. Definizione di "fatto" (acceptance) — harness implementabile

Stesso stile di `m5_gate_check.mjs` / `ecosystem_conformance.mjs`.

- **Harness**: nuovo `eval/harness/build_discipline_check.mjs` (o asserzioni appese a m5).
- **Driver**: `run_loop.mjs --eval --mode=build` (unico driver eval BUILD).
- **Fixture** sotto `eval/build-discipline/`, ciascuna col suo seeded-blueprint: `overcomplicated-correct/`, `orphan-injecting/`, `ambiguous-ac/`.
- **Exit-code**: 0 pass / 1 fail / 2 precondizione mancante (es. test-runner assente). **0-contaminazione** (fixture bit-identica, HEAD esterno invariato, `assertIsolatedRepo`) e **verifica k=2** (`L-COL-002`), come ogni gate.

**Sotto-test falsificabili:**

1. **Reference & routing**: `build-discipline.md` esiste, lint di packaging VERDE, riga presente in `SKILL.md` §2; si carica in BUILD (regression suite `10` §5 / spot-check `09` §9).
2. **(a) advisory-non-gate** *(non "assente")*: fixture `overcomplicated-correct` (target_tests verdi, **zero** dead-code/vuln/regressione nuovi) → il tidy self-check **emette** `{advisory:true, complexity_flag:true}` **E** `run_checkpoint` esce **verde** simultaneamente — si asserisce `advisory_flag===true && cp.green===true`, provando che il flag non è un gate. (Riusa il pattern Criterio-6 di m5.)
3. **(b) dead-code oracolo** *(già meccanizzato)*: fixture `orphan-injecting` (un export inutilizzato nuovo, specchio di `S8`/`unused.ts`) → `control1DeadCode` (baseline-delta in `checkpoint.mjs`, via `run_deadcode`/knip) **FALLISCE**; rimosso l'orfano → verde. Falsificabile.
4. **(c) osservabilità AC deterministica**: fixture `ambiguous-ac` (un `then` con token vago bannato) → `ac_observability_check.mjs` **FLAGGA** (FAIL) mentre il controllo pulito **PASSA**; nessuna assunzione silenziosa codificata (pattern "neutralizza → FAIL").
5. **Provenienza (momento 2)**: si asserisce che la disciplina vincola le asserzioni del target_test all'AC; la *meccanizzazione* piena (lint AC↔asserzioni) è dichiarata come hand-off al deliverable anti-tamper — qui si gate la sola osservabilità (4) + la regola in prosa.
6. **No-regressione**: `m1…m5` + `ecosystem_conformance` (tutti i pack) + `run_eval` verdi; `package_skill` lint VERDE.
7. **Coverage onesta**: il report non rivendica mai "pulito/elegante" come verificato (`L-COL-006`).

## 8. Posizione nella roadmap

Primo deliverable del riequilibrio BUILD (`L-COL-015`), scelto come prioritario sopra l'ampiezza ecosistemi (SP-8). Il *test-gate* è **pre-esistente** (control 3, già spedito) e questo deliverable gli si **affianca**, non lo rafforza. Precede l'anti-tamper dell'autorità (a cui passa la meccanizzazione AC↔asserzioni, §5.2/§7.5) e la distribuzione trust-preserving. Contesto competitivo: `docs/superpowers/competitive/2026-06-24-*`.

## 9. Come si costruisce

**Dynamic Workflows** (`L-COL-027`), **test-first** (l'harness §7 scritto *prima* — `L-COL-019` applicato a noi), **gate = l'harness** (dogfood). Git **solo nell'orchestratore**; merge su `main` **human-gated** (`L-COL-024`); `assertIsolatedRepo` attivo.

## 10. Ledger + rischi / questioni aperte

**Nuovo lock proposto — `L-COL-031`** (prossimo ID libero; ultimo = 030): *"Disciplina di costruzione per BUILD. Lo step di costruzione applica una writing-discipline advisory — gate delle assunzioni (Think Before Coding, con floor deterministico `ac_observability_check`), test-first che **traduce** l'AC del blueprint senza scriverne il giudice (`L-COL-019`), scrittura minima e chirurgica (Simplicity First + Surgical Changes, **allineata** non coincidente a `L-COL-021`: non introdurre orfani, mai cancellare in autonomia), tidy self-check advisory con output ispezionabile fuori dal checkpoint, e disciplina di fix root-cause-before-patch (systematic-debugging) sul loop RED. Assorbe l'additivo di Karpathy (MIT) e la pratica superpowers, ri-espressa nativa e cross-tool. La disciplina guida la scrittura; l'oracolo resta l'unico giudice (`L-COL-002`); 'pulito/elegante' non è oracolabile né rivendicato (`L-COL-006`)."* Raffina `L-COL-015` e `L-COL-019`.

**Rischi / questioni aperte:**
- **Decisione aperta per l'utente — B1 Opzione A vs B.** Adottata **A** (checker deterministico `ac_observability_check`): più-Trueline (gate falsificabile vero) ma aggiunge un piccolo oracolo. L'alternativa B (degradare §7c a pura osservazione advisory, niente checker nuovo) resta valida e più economica. *Da confermare in review.*
- **Falso "advisory" che scivola in gate.** Mitigato dal sotto-test §7.2 (advisory-flag settato **E** verde) e dal tenere il flag fuori dagli input di `run_checkpoint`.
- **Provenienza del test del controllo 4.** Qui chiusa come *regola* + floor d'osservabilità; la *meccanizzazione* (lint AC↔asserzioni) è hand-off esplicito all'anti-tamper, non un buco lasciato aperto in silenzio.
- **`ac_observability_check` è euristico.** Cattura un *sottoinsieme* falsificabile (token vaghi / assenza di osservabile); l'ambiguità profonda resta advisory (LLM). Coerente con floor+coverage (`L-COL-030`/`L-COL-006`). Da non vendere come "rileva ogni AC ambiguo".
- **Campo `assumptions` nello schema?** Fuori (YAGNI): comportamento di costruzione, non artefatto del piano. Il momento 1 emette una nota a runtime, non un campo del blueprint.
