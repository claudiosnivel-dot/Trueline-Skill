# A2b — Altitudine come contratto del blueprint (`arch_check`)

> **Design doc.** Milestone **A2b**. Introduce `arch_check`: un oracolo **dichiarativo**
> (famiglia `rls_check`/`firestore_rules_check`) per cui il **blueprint dichiara gli strati**
> dell'architettura e le regole `forbidden` fra strati, e Trueline le **verifica contro il
> grafo import reale** (madge). È il seguito naturale di A2a (§10 di A2a): dove dup/cycle sono
> **igiene delta-gated**, l'altitudine è un **contratto dichiarato dall'utente** — quindi
> **gate assoluto**, non solo delta. **BUILD-only** (in REMEDIATE non c'è blueprint). Emenda
> `atomic-task-schema` + `validate_blueprint`.

Data: 2026-07-22 · Stato: **proposto**, in attesa di revisione umana · Lock candidato: **`L-COL-033`** (contratto di altitudine dichiarato = gate assoluto BUILD-only con vacuity guard + allowlist audita; raffina `L-COL-019`).

---

## 1. Il fondamento: perché l'altitudine È gate-abile (dove l'efficienza non lo è)

A0 (§10) e A2a (§9) hanno tracciato la linea: **proprietà semantica/comportamentale
indecidibile → advisory**; **contratto sintattico dichiarato dall'utente → gate-abile**.
L'efficienza/complessità non è gate-abile (Rice; le metriche sono falsi verdi dimostrati). Il
**twinning** non è gate-abile (correlazione strutturale FP-prone: `commessa`/`preventivo` sono
domini diversi legittimamente paralleli → `twin_check` è detection-only). Il **riuso** non è
gate-abile (giudizio "avrebbe dovuto riusare X").

L'**altitudine** è diversa in natura: non è un'inferenza né un giudizio, è la **verifica di una
regola che l'utente ha dichiarato**. "Lo strato `ui` non deve dipendere dallo strato `data`" è
un fatto binario sul grafo import — esattamente come "questa policy RLS non deve essere
`USING (true)`". Trueline non *scopre* l'architettura giusta (indecidibile): **esegue il
contratto che l'utente ha scritto**. È il differenziatore vero della metà BUILD di
`L-COL-015` (l'agente costruisce contro un'architettura dichiarata, e il gate la fa rispettare)
e non esisteva prima in nessuno dei concorrenti mappati (`docs/superpowers/competitive/`).

**Analogo esatto:** `rls_check` (l'utente/lo standard dichiara l'isolamento RLS; l'oracolo
statico verifica che non sia bypassato) e `firestore_rules_check` (l'utente dichiara le regole
`.rules`; l'oracolo verifica che non ci sia `allow: if true`). `arch_check` è il terzo della
famiglia: **l'utente dichiara gli strati; l'oracolo verifica che le regole `forbidden` non
siano violate**, con lo stesso **vacuity guard** che impedisce il contratto vacuo (l'analogo di
`RLS005`/`USING(true)`: una regola che non vincola nulla è un falso-sicuro, non un verde).

## 2. Scope A2b

**Un** oracolo nuovo, `arch_check`, nel **controllo 1** del checkpoint (dove già vivono
dead-code/dup/cycle/twin), ma con tre proprietà che lo distinguono dagli altri del controllo 1:

1. **Blueprint-driven, non manifest-driven.** dup/cycle sono attivati dal
   `manifest.oracles.duplication/architecture` (binding per-ecosistema, tool project-agnostico).
   Gli strati sono **project-specific** → dichiarati nel **blueprint** e letti via `blueprintDir`.
   Precedente strutturale esatto: il ramo AC-acceptance del controllo 4
   (`control4Conformance`, `checkpoint.mjs`, `if (mode==='build' && blueprintDir && …)`).
2. **BUILD-only.** In REMEDIATE non c'è blueprint → nessun contratto → `arch_check`
   **non applicabile** (skip dichiarato in coverage, mai verde — `L-COL-006`). Contrasto con
   dup/cycle/twin che in REMEDIATE girano full-repo come report non bloccante.
3. **Gate ASSOLUTO, non delta.** Una violazione del contratto dichiarato blocca **sempre**
   (non solo il delta del macrotask). Divergenza deliberata dalla disciplina delta di A2a,
   giustificata dalla natura "contratto dichiarato" (§6).

**Detection-only nel senso di `L-COL-030`:** nessun fix-provider deterministico spedito — il
fix di una violazione di altitudine è una **decisione architetturale umana** (spostare il
codice, invertire la dipendenza, introdurre un'astrazione). `arch_check` **gata** ma non
auto-corregge; non entra nel `verified_set`; il loop non lo raccoglie in `selectInScope`.

**Fuori scope** (→ §10): promozione a `verified` (richiederebbe un fix-provider architetturale,
che è per costruzione un giudizio umano); l'altitudine in REMEDIATE (nessun contratto
dichiarato); metriche di coesione/accoppiamento (indecidibili, advisory); ecosistemi
senza grafo import (non-JS/TS — v1 è JS/TS-only, §3.4).

## 3. Design dei componenti

### 3.1 Il contratto — dichiarazione nel blueprint (`00-INDEX.md`)

Gli strati sono una proprietà **globale del progetto**, non del singolo task → si dichiarano in
un blocco ` ```yaml ` **top-level** in testa a `00-INDEX.md` (l'indice del blueprint,
co-locato con la mappa dei moduli e il DAG). Forma:

```yaml
architecture:
  layers:                         # nome-strato → selettore glob (path repo-relative POSIX)
    ui:     "src/components/**"
    domain: "src/domain/**"
    data:   "src/data/**"
  forbidden:                      # regole direzionali fra strati
    - { from: ui,     to: data }               # transitiva (default): ui non raggiunge data
    - { from: domain, to: ui, mode: direct }   # opt-out: solo edge diretti domain→ui
  allow:                          # eccezioni ACCETTATE (audite, mai silenziose) — opzionale
    - { from: ui, to: data, module: "src/components/LegacyGrid.tsx", note: "temp, TICKET-123" }
```

- `layers`: mapping `nome → glob`. Un modulo che matcha **più** strati si risolve per
  **glob più specifico** (prefisso letterale più lungo); pareggio → ordine di dichiarazione.
  Un modulo che non matcha alcuno strato è **non-assegnato** (nodo intermedio possibile nei
  path transitivi, ma né sorgente né bersaglio di una regola).
- `forbidden`: lista di regole `{from, to, mode?}`. `mode` ∈ `{transitive, direct}`, default
  **`transitive`**. `from`/`to` **devono** essere strati dichiarati.
- `allow`: lista opzionale di eccezioni `{from, to, module, note}` — vedi §6.

### 3.2 Validazione a due livelli (dichiarazione vs codice)

Il contratto è verificato in **due punti distinti**, coerente con "il blueprint dichiara,
Trueline verifica":

**(a) Plan-time — `validate_blueprint` (strutturale, CONDIZIONALE).** Un **6° controllo**
`ARCH_CONTRACT_WELL_FORMED`, eseguito **solo se** il blocco `architecture:` è presente (assente
→ **skip**, non fail: la fixture `eval/seeded-blueprint` che non dichiara strati resta verde).
Verifica *forma*, non codice: ≥1 strato con selettore non vuoto; ≥1 regola `forbidden`; ogni
`from`/`to` referenzia uno strato dichiarato; `mode`, se presente, ∈ `{direct,transitive}`;
ogni voce `allow` referenzia strati dichiarati. Esito binario `check()/allOk/exit` (stile dei 5
controlli esistenti).
- **Loader nuovo, non intrusivo:** `parseTasks` di `validate_blueprint` legge **solo** blocchi
  `- id:` (un blocco `architecture:` top-level non verrebbe mai raccolto). Si aggiunge un
  **loader sibling** `loadArchContract(dir)` che riusa il mini-parser YAML dep-free — **senza
  toccare** i 3 loader copiati-verbatim (`validate_blueprint`, `ac_observability_check`,
  `blueprint_tasks`), rispettando la convenzione "i loader non si toccano" (`L-COL-029`).

**(b) Build-time — `arch_check` (semantica, vs il grafo reale).** L'oracolo carica il contratto
via `loadArchContract(blueprintDir)`, costruisce il grafo import del codice, mappa i moduli agli
strati, applica le regole `forbidden` e emette i finding di violazione. Qui vive il **vacuity
guard** (§3.5): ogni regola deve **agganciarsi a moduli reali**.

### 3.3 `arch_check` — l'oracolo

- **Collocazione:** `trueline/scripts/oracles/arch_check.mjs`. Contratto CLI della famiglia
  dichiarativa: `node arch_check.mjs <codeDir> --blueprint <blueprintDir>`; exit **2** senza
  argomenti; il **parser non fa mai throw** (errori → `parse_warnings`); report **JSON nativo**
  su stdout: `{ oracle:'arch', tool_version, coverage, coverage_note, scanned_files,
  parse_warnings, findings, degraded?, degraded_reason? }`.
- **Due input:** il **codice** (`<codeDir>`, per il grafo) e il **contratto** (dal blueprint).
  Divergenza necessaria dai gemelli `rls_check`/`firestore_rules_check`, che scansionano un
  artefatto *dentro* il codice; qui il contratto vive nel blueprint, il codice altrove.
- **Motore del grafo — `module_graph.mjs` condiviso.** `run_cyclecheck.mjs` è oggi uno **script
  CLI monolitico** (niente export, `main()` chiamato incondizionatamente). Si **estrae** un
  modulo puro `trueline/scripts/oracles/module_graph.mjs` con due funzioni esportate:
  `buildModuleGraph(dir) → { graph, modules, degraded, detail }` (incapsula risoluzione
  madge/npx + gestione Windows CVE-2024-27980 + `spawnSync --json` + `JSON.parse` + guard
  grafo-vuoto) e `findCycles(graph)`. `run_cyclecheck.mjs` **importa** il modulo (il suo `main`
  protetto da `if (import.meta.url === …)`); `arch_check.mjs` importa lo stesso. **Refactor a
  comportamento invariato** (estrazione pura, nessun cambio di logica) — il testimone di
  invarianza è il keystone A2a `a2a_hygiene_check` + `normalize.a2a.test` che restano verdi.
  Motivazione: madge risolve i `.ts` (dependency-cruiser è **cieco** ai `.ts`, provato in A2a);
  il motore `forbidden` nativo di dependency-cruiser **non è quindi disponibile** → il matcher
  è custom sopra il grafo madge, come già il DFS dei cicli.
- **Mappatura modulo→strato:** glob sui path **repo-relative POSIX** (`normalizePath`),
  allineando lo spazio-path del grafo madge (relativo a `src`/`.`) a quello dei selettori del
  contratto e dei finding.
- **Applicazione delle regole (`forbidden`):**
  - `mode: transitive` (default): per ogni modulo `m ∈ layer(from)`, ricerca di
    **raggiungibilità** (BFS/DFS sugli edge del grafo, **attraverso qualunque nodo intermedio**,
    inclusi strati terzi — cattura il *laundering* `X→M→Y`); se un qualunque `t ∈ layer(to)` è
    raggiungibile → violazione. **Trappola di riuso risolta:** `findCycles` ricorre solo se
    `graph[dep] !== undefined` (salta i moduli-foglia che sono *valore* ma non *chiave*); per la
    raggiungibilità questo **si rilassa**, altrimenti si perdono i bersagli-foglia (un modulo di
    `data` importato-ma-che-non-importa).
  - `mode: direct`: solo gli edge diretti `m→n` con `layer(m)=from`, `layer(n)=to`.
- **Testimone del finding:** un **path** dal modulo sorgente al bersaglio (per il caso diretto,
  l'edge singolo). L'umano segue il path import per import per individuare il punto in cui
  invertire/spezzare la dipendenza.

### 3.4 Attivazione (BUILD-only, JS/TS-only, BIT-invariante)

`arch_check` gira **solo quando** valgono tutte: `mode === 'build'` **e** `blueprintDir`
presente (flag esplicito `--blueprint`, mai auto-detect — `L-COL-032`) **e** il blueprint
dichiara un blocco `architecture:` **e** l'ecosistema attivo è **graph-capable (JS/TS)** (il
grafo import è un concetto JS/TS; un ecosistema non-JS/TS che dichiarasse strati → **skip
dichiarato non-applicabile**, mai un falso-degradato). Se una qualunque condizione manca → il
ramo **non esiste** → controllo 1 **byte-identico** a oggi (m5 56/56 salvo). `arch_check` **non
è** manifest-driven → nessun binding in `ecosystem.json`, nessuna modifica a `CONTROL1_TOOLS`
(il controllo 2 non lo incontra iterando `manifest.oracles`).

### 3.5 Vacuity guard (obbligatorio — il cardine)

Modellato su `run_cyclecheck` (grafo 0 moduli → exit 1 dichiarato, mai `{cycles:[]}` nudo) e su
`RLS005`/`USING(true)` (una regola che non restringe è un difetto, non un verde). Una qualunque
delle condizioni → **NON-verde dichiarato**: l'oracolo esce con **exit non-zero** (la stessa
convenzione di `run_cyclecheck`, che `runOracle` traduce in `ok:false` → `control1Hygiene`
marca `arch:degr`, il quale — a differenza di `twin` — **declassa** il verde); il
`degraded_reason` viaggia nel payload per il report. Le condizioni:

1. **Grafo vuoto** (madge 0 moduli): oracolo non eseguito, non "pulito".
2. **0 regole `forbidden`**: il contratto non vincola nulla (già respinto plan-time da
   `validate_blueprint` se il blocco è presente; guard ridondante in `arch_check` come difesa in
   profondità).
3. **Regola morta** — una regola il cui `from` **o** `to` mappa a **0 moduli reali** del grafo:
   la regola non può mai scattare (glob sbagliato / strato inesistente sul codice) → falso-sicuro,
   l'analogo esatto di `RLS005`.

Distinzione critica (dal guard di A0): **"0 violazioni con regole che agganciano moduli reali"
= VERDE legittimo**; **"0 violazioni perché nessuna regola aggancia il codice" = vacuo → RED**.
Il verde richiede che il contratto **tocchi** il codice, non solo che il codice non lo violi.

## 4. Finding model

Nessuna modifica allo schema: `category: 'architecture'` è **già** nell'enum di
`finding.schema.json` (A2a) e in `CATEGORY_ENUM` di `validate_ecosystem`. `arch_check` è il
**terzo** oracolo `architecture` (dopo `cycle` gate-delta e `twin` detection-only), distinto per
`source_oracle.oracle = 'arch'`.

- **`normalizeArch`** in `normalize.mjs` (gemello di `normalizeCycle`), + alias in
  `ORACLE_ALIASES` (`'arch'/'arch-check'/'arch_check' → 'arch'`), + `case` nello switch, +
  `ctx.toolVersions.arch` (versione madge).
- **Severità: `MEDIUM`.** Sopra l'igiene `LOW` di cycle/twin: è una breccia di **contratto
  dichiarato**, non un difetto incidentale. (La severità è presentazionale: il gate del
  controllo 1 decide dai blockers, non dalla severità — §6.)
- **OWASP/CWE:** `owasp: 'A04:2025'` (**Insecure Design**; già nella mappa
  `OWASP_2021_TO_2025`) + `cwe: 'CWE-1061'` (Insufficient Encapsulation). Divergenza deliberata
  da cycle/twin (taxonomy-free): una violazione di altitudine dichiarata **è** un difetto di
  design-integrity, non solo igiene. Entrambi rispettano i pattern dello schema
  (`^A[0-9]{2}:2025$`, `^CWE-[0-9]+$`).
- **Fingerprint direzionale (NON rotazione-invariante).** A differenza di `cycle` (set di
  moduli ordinato) e `twin` (coppia-dir ordinata), l'edge `forbidden` è **orientato**
  (`X→Y` vietato ≠ `Y→X`): `matchSignature = [ruleId, fromLayer, toLayer, sourceModule,
  reachedTarget].join('|')`, `normalizedPath = sourceModule`, `start/end_line = 0`. Il bersaglio
  raggiunto per il fingerprint è scelto **deterministicamente** (il modulo di `layer(to)`
  raggiungibile lessicograficamente minimo) così da avere **un finding per (regola, modulo
  sorgente)** — niente esplosione se un sorgente raggiunge più bersagli; il path-testimone
  completo resta nell'evidence. Stabile per riga (spostare codice non cambia il fingerprint).
- **Evidence:** il path-testimone (lista di moduli) — informazione **sicura**, mai un segreto.

## 5. Aggancio al checkpoint

Oggi `control1Hygiene(referenceApp, { baseline, runOpts, manifest })` **non riceve** né `mode`
né `blueprintDir` (li riceve solo `control4Conformance`). L'**unica** modifica strutturale al
wiring: `runCheckpoint` **thread-a** `mode` + `blueprintDir` anche in `control1Hygiene`
(parametri opzionali, default che preservano il ramo legacy). Dentro `control1Hygiene`, **dopo**
il blocco `twin` e **prima** di `partitionBlockers`, un ramo guardato:

```
if (mode === 'build' && blueprintDir && archContractPresent(blueprintDir) && graphCapable(manifest)) {
  const out = runOracle(ARCH_CHECK, referenceApp, ['--blueprint', blueprintDir]);
  // vacuity/degradato → sub.push('arch:degr') (declassa il verde, come 'cycle:degr');
  // findings → normFindings(out) → all.push(...)  (gating in partitionBlockers, §6)
}
```

Il flag `--blueprint` è **già** cablato end-to-end (`run_checkpoint` parseArgs → `runCheckpoint`
→ oggi solo `control4Conformance`; `run_loop` idem): serve solo inoltrarlo a `control1Hygiene`,
nessun nuovo plumbing CLI.

## 6. Gating — assoluto, con allowlist audita

**Assoluto.** I finding `arch` **bypassano** il filtro delta/baseline. Si aggiunge
`ABSOLUTE_GATE_ORACLES = new Set(['arch'])` in `partitionBlockers`: un finding il cui
`source_oracle.oracle ∈ ABSOLUTE_GATE_ORACLES` è **sempre** un blocker (non filtrato da
`baseline.has(fingerprint)`), a meno che non sia in allowlist. Divergenza esplicita da
`cycle`/`dup` (delta): un contratto **dichiarato** non si grandfather-a — come `USING(true)`
non si grandfather-a. In BUILD, dove l'architettura è dichiarata a monte e il codice si
costruisce conforme, **non c'è debito legacy** da assorbire → l'assoluto è la semantica naturale.

**Allowlist audita (`allow:`).** Escape-hatch per l'eccezione **consapevole e accettata**, sul
modello della FP-allowlist `L-COL-028` (proposta LLM/umano → approvazione umana → commit). Una
violazione che matcha una voce `allow` (per `from`/`to`/`module`) è **esclusa dai blockers** ma
**comunque emessa** nel report con `fix_state: 'accepted-exception'` + la `note` — **mai
soppressa silenziosamente** (`L-COL-006`). Una voce `allow` che non matcha alcuna violazione
corrente (stale) → `parse_warning` dichiarato, non un errore silenzioso. Il **vacuity guard
resta sulle regole** (una regola coperta interamente da eccezioni è comunque una regola
dichiarata e non-vacua).

## 7. Testing

Test-first (`L-COL-019`/`L-COL-027`); il "verde" è un fatto d'oracolo (`L-COL-002`). Keystone
`eval/harness/a2b_arch_check.mjs`; fixture sotto `eval/a2b-arch/` (inner-`.git`/`node_modules`
provisionati **dall'orchestratore**, `L-COL-024`).

- **AC-1 (violazione diretta, falsificabile):** blueprint dichiara `ui→data` vietato; il codice
  ha `ui` che importa direttamente `data` → controllo 1 **RED**. Gemello: rimuovi l'import →
  **verde**.
- **AC-2 (laundering transitivo):** `ui→data` (transitive), codice `ui→domain→data` (nessun
  edge diretto) → **RED** (il transitivo lo cattura). Sulla **stessa** fixture, la regola con
  `mode: direct` → **verde** (il diretto NON cattura il laundering). Prova sia il transitivo di
  default sia l'opt-out per-regola.
- **AC-3 (conforme):** codice che rispetta il contratto → **verde** (con regole che agganciano
  moduli reali — verde legittimo, non vacuo).
- **AC-4 (vacuity guard, 3 rami):** (a) blocco `architecture` con strati ma **0 regole** →
  `validate_blueprint` **RED** plan-time; (b) regola il cui strato mappa **0 file** →
  `arch_check` **degradato** (mai verde); (c) grafo vuoto → **degradato**. Ognuno dichiarato.
- **AC-5 (gate assoluto):** una violazione **pre-esistente** (presente in baseline) → **blocca
  comunque** (prova che `arch` bypassa il delta — contrasto diretto con `cycle`, che sulla
  stessa baseline **non** bloccherebbe).
- **AC-6 (allowlist audita ≠ soppressione):** la stessa violazione di AC-1 con una voce `allow`
  che la copre → il checkpoint è **verde** MA il finding **appare** nel report come
  `accepted-exception` con la nota (analogo del sotto-test `advisory≠gate` di BD-1). Voce
  `allow` stale → `parse_warning`.
- **AC-7 (BIT-invarianza):** senza `--blueprint` (o in REMEDIATE, o senza blocco `architecture`,
  o su ecosistema non-JS/TS) → controllo 1 **byte-identico**; `m5` **56/56**.
- **Falsificabilità del keystone:** neutralizza la reachability in `arch_check` → AC-2
  transitivo diventa **verde** (dovrebbe essere RED) → keystone **FAIL** → ripristina → **PASS**.
- **Non-regressione integrale (SERIALE):** `m5` **56/56** (controllo 1 BIT-invariante),
  `ecosystem_conformance` sui 5+ pack, `anti_tamper` **49/49**, `build_discipline` **21/21**,
  keystone A0 `a0_authz_gate_check` **16/16**, keystone A2a `a2a_hygiene_check` (invarianza del
  refactor `module_graph`), `package_skill` lint VERDE. **0 contaminazione.**

## 8. Error handling & invarianti

- **Gate assoluto per `arch`** (unico del controllo 1 a bypassare il delta); il resto del
  controllo 1 resta delta-gated. `ABSOLUTE_GATE_ORACLES` esplicito e testato.
- **Vacuity guard obbligatorio a due livelli** (plan-time forma + build-time aggancio-al-codice);
  "0 violazioni" è verde **solo** se le regole toccano moduli reali.
- **BUILD-only + JS/TS-only + `--blueprint` esplicito** (mai auto-detect, `L-COL-032`); REMEDIATE
  / non-JS/TS / no-contratto → **skip dichiarato non-applicabile**, mai verde né falso-degradato.
- **Detection-only in v1** (`L-COL-030`): nessun fix-provider spedito; `arch` non entra nel
  `verified_set`; `selectInScope` del loop non lo raccoglie.
- **Allowlist mai soppressione** (`L-COL-028`/`L-COL-006`): eccezione emessa + auditata, mai
  silenziosa; stale → warning.
- **Refactor `module_graph` a comportamento invariato**: keystone A2a + `normalize.a2a.test` sono
  i testimoni; `run_cyclecheck` resta funzionalmente byte-equivalente.
- **BIT-invarianza** dei pack/progetti senza contratto d'altitudine (ramo legacy del controllo 1
  invariato).
- **Git solo nell'orchestratore** (`L-COL-024`); branch dedicato `feat/a2b-arch-contract`,
  `main` intatto fino al merge human-gated. Provisioning `.git`/`node_modules` dei fixture =
  passo d'orchestratore.
- **Packaging:** `arch_check.mjs` + `module_graph.mjs` + `loadArchContract` viaggiano nel
  `.skill`; madge resta **esterno** via preflight (come A2a). `SKILL.md` **intatto** (<500
  righe, il dettaglio del contratto vive nei reference/blueprint, non nel corpo — `L-COL-014`/
  `L-COL-029`).

## 9. Onestà — cosa A2b NON fa

- **Non scopre** l'architettura giusta (indecidibile): esegue il contratto che l'utente ha
  dichiarato. Un blueprint che dichiara strati sbagliati produce un gate sbagliato — la
  responsabilità della dichiarazione è umana.
- **Non verifica a runtime** l'isolamento fra strati: è **statico** sul grafo import (l'analogo
  del confine "statico, non runtime" già dichiarato per `firestore_rules_check` in SP-8). Un
  accoppiamento via reflection/DI dinamica che madge non vede **non è coperto** — dichiarato in
  coverage.
- **Non auto-corregge** (detection-only): il fix è una decisione architetturale umana.
- **Non gira in REMEDIATE** (nessun contratto dichiarato) né su non-JS/TS (nessun grafo import).
- **Non misura** coesione/accoppiamento/efficienza (indecidibili, advisory/non-coperti).

Vendere A2b come "Trueline valida l'architettura" senza il "…che **tu** hai dichiarato, con
copertura statica sul grafo import JS/TS" sarebbe un falso comfort. A2b è **l'esecuzione
deterministica di un contratto di altitudine dichiarato**, con vacuity guard che ne impedisce la
vacuità — dichiarata come tale.

## 10. Fuori scope (milestone successive)

- **Attivazione per-pack di dup/cycle con baseline che assorbe il debito** (il passo dopo A2a/A2b
  verso l'uso reale su repo con debito).
- **A1 — hardening/igiene** (indipendente): assert per-categoria del `verified_set` in
  `ecosystem_conformance`; prosa `remediate.md`/inventario per-ecosistema; emitter deterministico
  della nota tidy.
- **Promozione a `verified`** dell'altitudine: richiederebbe un fix-provider architetturale, che
  è per costruzione un giudizio umano → **non** promuovibile (resta detection-only-ma-gate).
- **Altitudine in REMEDIATE:** richiederebbe di *inferire* gli strati dal codice (indecidibile)
  o di far dichiarare all'utente un contratto a posteriori — possibile estensione futura, fuori
  dal v1 BUILD-first.
- **`mode: transitive` con reporting del path minimo** ottimizzato / metriche di distanza fra
  strati — advisory, non gate.

## 11. Definizione di "fatto" per A2b

Tutti gli AC verdi in riesecuzione **seriale**, con AC-1/AC-2 falsificabili (incl. la neutralizzazione
della reachability) e AC-5 che prova il gate **assoluto** (bypass del delta) e AC-6 che prova
l'allowlist **audita ≠ soppressione**; `m5` **56/56** + keystone A0 **16/16** + keystone A2a
invariati (refactor `module_graph` a comportamento invariato); `validate_blueprint` estende i
suoi controlli senza rompere la fixture seeded (blocco `architecture` **condizionale**); 0
contaminazione; `package_skill` lint VERDE con `SKILL.md` <500 righe; branch mergeato `--no-ff`
human-gated; install riallineato. Ledger `00-INDEX §4` aggiornato con **`L-COL-033`** (o nota di
raffinamento di `L-COL-019`, da decidere in fase di ledger).
