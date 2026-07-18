# A2a — Oracoli di igiene strutturale (duplicazione, cicli, twinning)

> **Design doc.** Milestone **A2a** (oracoli di qualità del codice, primo taglio). Risponde
> alla domanda originale dell'utente ("Trueline non verifica il riuso/la duplicazione del
> codice") con tre oracoli di **igiene strutturale**, tarati su una **misura reale** del
> repo dell'utente (ASV Officina). L'altitudine-come-contratto-del-blueprint resta **A2b**
> (fuori scope, §10).

Data: 2026-07-18 · Stato: **proposto**, in attesa di revisione umana · Lock candidati: nessuno (raffinamenti additivi di `L-COL-029`; detection-only ⇒ nessuna promozione `L-COL-030`).

---

## 1. Cosa dice la misura (il fondamento del design)

Misurato su `ASV Officina/src` (166 file `.ts/.tsx`, ~32k righe, prodotto da agenti), in sola
lettura.

**Duplicazione verbatim (`jscpd`):**

| `--min-tokens` | cloni | righe duplicate | cloni ≥15 righe |
|---|---|---|---|
| 30 | 484 | 13.6% | 78 |
| **50** | **263** | **8.8%** | **62** |
| 70 | 155 | 6.7% | 56 |

I cloni **grossi** sono stabili tra 50 e 70 token (62→56) mentre quelli corti crollano
(263→155): il rumore sta nei blocchi corti, il segnale nei blocchi lunghi.

**Duplicazione rinominata (ispezione del codice, campione ~15% dei file):** il pattern-firma
del repo è il **twinning per-entità** — `commesse/` ↔ `preventivi/` sono lo stesso codice con
un sostantivo scambiato (`fn_commessa_saldo`/`c_id` → `fn_preventivo_saldo`/`p_id`); 9 famiglie
di clone su 11 sono **rinominate**, non verbatim. Il verbatim reale è per lo più **plumbing
neutra al dominio** (formatter, loader pdfmake, cast `rpc` ridondato in 18 file).

**Conseguenza di design (onestà, `L-COL-006`):** un gate solo-lessicale (`jscpd`) cattura
**circa metà** delle righe duplicate (i run verbatim lunghi) e **manca il pattern dominante**
(clona-e-rinomina). Il rilevatore Type-2 rename-aware **non è disponibile** come tool
deterministico su Windows/npm (`similarity-ts` senza binario; `PMD --ignore-identifiers` NO-OP
su TS — verificato nella diagnosi). Quindi A2a **non risolve** il twinning: lo **rende
visibile** (`twin_check`) e impedisce di **peggiorare** il verbatim (`dup_check` su delta).
Questo confine va **dichiarato**, non nascosto.

## 2. Scope A2a

Tre oracoli nuovi, tutti nel **controllo 1** del checkpoint (igiene, LOW, **delta-gated**,
fuori dal controllo 2 di sicurezza — lo stesso posto e template del `dead-code`):

1. **`dup_check`** — duplicazione verbatim, **GATE** su delta (via `jscpd`).
2. **`cycle_check`** — cicli di import, **GATE** su delta (via `dependency-cruiser`).
3. **`twin_check`** — twinning per-entità, **DETECTION-ONLY** (oracolo custom, nessun tool
   esterno; mai gate).

**Tutti detection-only nel senso di `L-COL-030`**: nessun fix-provider deterministico spedito.
Estrarre/deduplicare è invasivo (una riscrittura, non una rimozione) → niente promozione a
`verified` in v1; il fix resta all'LLM human-gated. `dup_check`/`cycle_check` sono comunque
**gate deterministici** sul delta (bloccano il peggioramento), coerenti con `dead-code`.

**Fuori scope** (→ §10): l'altitudine L2 come **contratto dichiarato del blueprint**
(`arch_check` ~ `rls_check`, emenda `atomic-task-schema` + `validate_blueprint`) = **A2b**;
la promozione a `verified` (richiederebbe fix-provider + fixture verify); un rilevatore Type-2
rename-aware (nessun tool deterministico disponibile).

## 3. Design dei componenti

### 3.1 `dup_check` — duplicazione verbatim (GATE delta)

- **Tool:** `jscpd` (binario/pacchetto esterno via **preflight project-local**, come
  gitleaks/osv/semgrep/knip; `03 §4`). Verificato 4.2.5 su Node 25.
- **Wrapper:** `trueline/scripts/oracles/run_dupcheck.mjs` — esegue `jscpd <dir>
  --reporters json --mode strict --min-tokens <N> --ignore <test/d.ts> --output <tmp>`, legge
  `<tmp>/jscpd-report.json`, emette JSON nativo `{ oracle:'jscpd', duplicates:[...] }` su
  stdout. **Exit code del tool ignorato** (verdetto dal payload, `03 §3`); distingue *pulito*
  da *non-eseguito* (report assente + tool assente → exit onesto, mai `{duplicates:[]}` nudo).
- **Normalize:** `normalizeJscpd` in `normalize.mjs` → `category:'duplication'`, `severity:LOW`,
  `owasp:'—'`, un finding per coppia-clone con `location.file` = la seconda istanza (quella che
  il delta può introdurre). **Fingerprint ancorato al CONTENUTO:** `sha256(oracle | 'dup' |
  fragment-normalizzato | secondFile-path).slice(0,32)` — mai le righe (spostare codice non
  deve far sembrare "nuovo" un clone esistente; è il cardine del delta, come per gli altri
  oracoli).
- **Soglia:** `--min-tokens 50`, presa **dai dati** (§1: cattura i 62 blocchi grossi, scarta il
  rumore corto). **FILTRA quali fatti riportare, non SE sono fatti** (ogni clone riportato è
  byte-verificabile). Dichiarata nel **manifest versionato** (`oracles.duplication.min_tokens`),
  cambiabile solo con approvazione umana → commit (come l'allowlist FP, `L-COL-028`).
- **Gate:** controllo 1, delta (solo cloni NUOVI vs baseline bloccano), LOW. **Fuori dal
  controllo 2.**
- **Coverage declaration (obbligatoria):** *"verificato contro copia-incolla letterale ≥50
  token; cloni con identificatori rinominati (clona-e-rinomina per-entità) NON coperti →
  `twin_check`"*.

### 3.2 `cycle_check` — cicli di import (GATE delta)

- **Tool:** `dependency-cruiser` (preflight project-local). Verificato 16.10.4 su Node 25
  (engine warning non bloccante; JSON valido con `modules` + `summary.violations`).
- **Wrapper:** `trueline/scripts/oracles/run_cyclecheck.mjs` — esegue `depcruise <dir>
  --output-type json` con una **config vendorizzata** che attiva la sola regola `no-circular`
  (`trueline/references/oracles/depcruise-config/no-circular.cjs`, version-pinned come il
  ruleset Semgrep). Legge `summary.violations` filtrando `rule.name==='no-circular'`.
- **Normalize:** `normalizeDepcruise` → `category:'architecture'`, `severity:LOW`. Un finding
  per ciclo; **fingerprint** = `sha256(oracle | 'cycle' | set-di-moduli-canonicalizzato)` — il
  ciclo A→B→A ha lo stesso fingerprint indipendentemente dal modulo di partenza.
- **Gate:** controllo 1, delta (solo cicli NUOVI), LOW. Un ciclo è **convenzione-difetto**,
  mai gate assoluto → **solo delta**; su brownfield usare la baseline per il debito.
- **Testimone:** il path del ciclo emesso da dependency-cruiser (l'umano lo segue import per
  import).

### 3.3 `twin_check` — twinning per-entità (DETECTION-ONLY, mai gate)

- **Oracolo custom**, nessun tool esterno: `trueline/scripts/oracles/twin_check.mjs`.
- **Fatto asserito (strutturale, ispezionabile):** *"esistono le directory sorelle A e B con
  ≥K file i cui basename sono paralleli modulo un token-entità"*. Es.
  `commesse/useAccontoCommessa.ts` ↔ `preventivi/useAccontoPreventivo.ts`. **NON** asserisce
  "è duplicazione da astrarre" (giudizio) — solo il fatto strutturale, col testimone (le due
  directory + la lista dei file paralleli).
- **Meccanica (deterministica):** per ogni coppia di directory-sorelle (stesso parent),
  normalizza i basename rimuovendo il token-entità derivato dal nome-directory (e i suoi
  case-variant), confronta gli insiemi; se l'overlap ≥ K file → un finding
  `category:'architecture'`, `severity:LOW`, con la lista dei file paralleli. Soglia K
  dichiarata nel manifest (filtra, non costituisce — è comunque detection-only).
- **Detection-only, MAI gate:** prova una **correlazione strutturale**, non duplicazione —
  entità legittimamente parallele (come `commessa`/`preventivo`, che *sono* domini diversi)
  danno falsi positivi. Non blocca il checkpoint; appare solo nel report.
- **Categoria condivisa, gating per-oracolo:** `twin_check` emette `category:'architecture'`
  come `cycle_check`, ma i due hanno gating **opposto**. La distinzione è per-**oracolo**
  (`source_oracle.oracle`), non per-categoria: il controllo 1 tiene una lista
  `DETECTION_ONLY_ORACLES = { 'twin' }` (analogo delle `gateCategories` del controllo 2) e
  **esclude dai blockers** i finding prodotti da un oracolo detection-only. Così cicli
  (gate) e twinning (segnale) coesistono sotto `architecture` senza una categoria artificiale.
  `twin_check` è **ecosystem-agnostic** (analizza la struttura delle directory, non dipende
  dallo stack) → invocato dal controllo 1 su ogni progetto JS/TS, senza binding per-ecosistema.
- **Coverage declaration:** *"segnala directory strutturalmente parallele come sospetto
  clone-and-rename; NON prova duplicazione (entità legittime → FP); detection-only, advisory —
  il fix (astrarre generico-sull-entità) è una decisione architetturale umana (→ A2b)"*.

## 4. Finding model

Aggiungere all'enum **chiuso** di `trueline/scripts/findings/finding.schema.json` due
categorie: **`duplication`** e **`architecture`**. Il **guard vocabolario costruito in A0**
(`validate_ecosystem`) le validerà automaticamente; senza questa aggiunta un binding
`duplication`/`architecture` verrebbe **respinto** (prova che il guard A0 funziona). Contratto
del finding (`04`) invariato: `severity`, `category`, `owasp` (`—` per l'igiene, come
dead-code), `cwe` (opzionale; duplicazione ≈ manutenibilità, non una CWE di sicurezza),
`fingerprint`, `location`, `baseline_status`.

## 5. Aggancio al checkpoint — il controllo 1 diventa multi-oracolo

Oggi il **controllo 1** (`control1DeadCode`, `checkpoint.mjs:120-137`) è **mono-oracolo**
(cablato su `RUN_DEADCODE`/knip). A2a lo generalizza a **controllo 1 = igiene multi-oracolo**,
lo stesso pattern che A0 ha reso vivo nel controllo 2:

- Legge dal **manifest** i binding delle categorie di igiene (`dead-code`, `duplication`,
  `architecture`), esegue ciascun oracolo, unisce i finding, **delta-gate** (`deadcode:true`
  → gate per delta indipendente dalla severità, esteso alle nuove categorie di igiene).
- **`twin_check` NON entra nel gate**: i suoi finding (`category:'architecture'`,
  `source_oracle.oracle='twin'`) sono raccolti nel report ma **non** bloccano il verde. Il
  controllo 1 li esclude dai blockers via `DETECTION_ONLY_ORACLES = { 'twin' }` — l'esclusione
  è per-**oracolo**, non per-categoria (i finding `architecture` da `cycle_check` gatano; quelli
  da `twin` no). `twin_check` è invocato direttamente dal controllo 1 (ecosystem-agnostic),
  non via binding manifest per-ecosistema.
- **Riuso del guard di A0:** un oracolo di igiene dichiarato ma **non eseguito** non è un
  verde — stesso principio floor-declass. (Per il controllo 1 la categoria dead-code è già
  delta-gated; le nuove seguono la stessa regola.)
- **BIT-invarianza:** un pack che **non** dichiara `duplication`/`architecture`/`twin` ha il
  controllo 1 **byte-identico** a oggi (solo dead-code). Verificato dal gate: `m5` 56/56.

## 6. BUILD vs REMEDIATE

- **BUILD:** `dup_check`/`cycle_check` **gatano il delta** — il macrotask non deve introdurre
  nuovo verbatim ≥50 token né nuovi cicli. `twin_check` segnala.
- **REMEDIATE:** girano **full-repo** come **report non bloccante**. I 263 cloni esistenti e i
  cicli/twin del debito **si dichiarano, non bloccano** (baseline-delta: sono `pre-existing`).
  Coerente con "il delta è la domanda rispondibile"; il debito assoluto non brucia il gate.

## 7. Testing

Test-first (`L-COL-019`/`L-COL-027`); il "verde" è un fatto d'oracolo (`L-COL-002`).

- **AC-1 (`dup_check`, falsificabile):** fixture con un blocco `≥50 token` copiato in 2 file →
  `dup_check` emette il finding; su delta (baseline vuota) il controllo 1 è **RED**. Gemello:
  rimuovi la seconda copia → verde. Contrasto anti-vacuo: due funzioni **diverse** della
  stessa lunghezza → **nessun** finding.
- **AC-2 (`cycle_check`, falsificabile):** fixture con `a.ts`→`b.ts`→`a.ts` → RED; rompi il
  ciclo → verde. Un DAG pulito → nessun finding.
- **AC-3 (`twin_check`, detection-only):** fixture con `x/fooX.ts`+`y/fooY.ts` paralleli →
  `twin_check` **segnala** ma il checkpoint **resta verde** (prova che è detection-only, non
  gate — analogo al sotto-test `advisory≠gate` di BD-1). Directory non parallele → nessun
  segnale.
- **AC-4 (delta):** un clone/ciclo **pre-esistente** (in baseline) → **non** blocca; solo il
  **nuovo** blocca.
- **AC-5 (vocabolario A0):** `validate_ecosystem` accetta i binding `duplication`/`architecture`
  dopo l'aggiunta all'enum; li **rifiutava** prima (prova che l'enum è la fonte).
- **Non-regressione integrale (SERIALE):** `m5` **56/56** (controllo 1 BIT-invariante sui pack
  senza i nuovi oracoli), `ecosystem_conformance` sui pack toccati, `anti_tamper` 49/49,
  `build_discipline` 21/21, keystone A0 `a0_authz_gate_check` **16/16** (il controllo 1
  multi-oracolo non deve rompere il controllo 2), `package_skill` lint VERDE. **0 contaminazione.**
- **Preflight:** `jscpd`/`dependency-cruiser` installabili project-local; assenti → oracolo
  **degrada dichiarato** (`L-COL-006`), mai falso verde.

## 8. Error handling & invarianti

- **Solo DELTA-gate, mai assoluto** (i 263 cloni esistenti lo dimostrano: un gate assoluto
  brucerebbe). Baseline = la dichiarazione.
- **Soglia filtra, non costituisce il verdetto** (`--min-tokens`/K nel manifest versionato,
  approvazione umana → commit).
- **Detection-only in v1** (`L-COL-030`): nessun fix-provider deterministico spedito; il fix è
  LLM human-gated. `twin_check` mai gate.
- **Coverage declaration sempre presente e specifica sul RECALL** (`L-COL-006`): "verbatim ≥50
  token; rinominati non coperti".
- **Oracolo non eseguito ≠ verde**; timeout = terzo stato (unknown), mai pass.
- **BIT-invarianza** dei pack che non dichiarano i nuovi oracoli; ramo legacy del controllo 1
  invariato.
- **Git solo nell'orchestratore** (`L-COL-024`); branch dedicato, `main` intatto fino al merge
  human-gated. Provisioning `.git`/`node_modules` dei fixture = passo d'orchestratore.
- **Packaging:** i wrapper `run_dupcheck`/`run_cyclecheck`/`twin_check` + la config depcruise
  vendorizzata viaggiano nel `.skill`; `jscpd`/`dependency-cruiser` restano **esterni** via
  preflight (come semgrep/gitleaks/osv/knip). `SKILL.md` < 500 righe (dispatch minimale +
  reference on-demand).

## 9. Onestà — cosa A2a NON fa

- Non risolve il twinning del tuo repo (lo rende visibile via `twin_check`).
- Non cattura i cloni rinominati come gate (nessun tool deterministico disponibile).
- Non promuove nulla a `verified` (detection-only).
- Non misura efficienza/complessità (indecidibile — Rice; le metriche di complessità sono
  falsi verdi dimostrati; fuori portata per costruzione).

Vendere A2a come "Trueline ora verifica il riuso" sarebbe un falso comfort. A2a è **igiene di
base (verbatim/cicli su delta) + visibilità (twinning)**, dichiarata come tale.

## 10. Fuori scope (milestone successive)

- **A2b — altitudine come contratto del blueprint:** il blueprint dichiara gli strati/confini,
  `validate_blueprint` li valida, Trueline genera il `.dependency-cruiser.js` e `arch_check`
  verifica le regole `forbidden` con **vacuity guard** obbligatorio (≥1 regola, ogni regola
  matcha ≥1 modulo reale — l'analogo di `RLS005`/`USING(true)`). BUILD-only (in REMEDIATE non
  c'è blueprint → non applicabile). È il differenziatore vero, ed è lavoro: emenda lo schema.
- **A1 — hardening/igiene** (indipendente): assert per-categoria del `verified_set` in
  `ecosystem_conformance`; prosa `remediate.md`/inventario `SKILL.md` per-ecosistema; emitter
  deterministico della nota tidy sul percorso reale.
- **Promozione verified di `duplication`** se emergesse un fix-provider sicuro (estrazione
  ancorata a un intento) + fixture verify.

## 11. Definizione di "fatto" per A2a

Tutti gli AC verdi in riesecuzione seriale, con AC-1/AC-2 falsificabili e AC-3 che prova
`twin_check` detection-only; `m5` 56/56 e keystone A0 16/16 invariati; 0 contaminazione; branch
mergeato `--no-ff` human-gated; install riallineato. Su un progetto reale (ASV Officina in
REMEDIATE) i tre oracoli **girano e producono un report** senza bloccare sul debito esistente.
