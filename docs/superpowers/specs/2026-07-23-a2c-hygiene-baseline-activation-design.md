# A2c — Attivazione per-pack di dup/cycle con baseline che assorbe il debito

> **Cos'è questo file.** Il design (spec) della milestone che **attiva** i due oracoli-gate d'igiene di A2a — `dup_check` (duplicazione verbatim, jscpd) e `cycle_check` (cicli di import, madge) — sui pack **reali**, alimentando il gate delta con un **baseline dichiarato che assorbe il debito pre-esistente**. Sale sopra A2a (che ha *costruito* i tre oracoli ma li ha lasciati inerti sui pack reali) e A2b (`arch_check`, il gate assoluto BUILD-only). Codename milestone: **A2c**. `twin_check` resta detection-only (non è in scope come gate: Rice / nessun tool deterministico).

> **Fonte di verità del codice.** Le citazioni `file:riga` sono al 2026-07-23 sul tree sorgente (`trueline/`, `eval/`; ignorare `dist/` = build output). Dove una riga è indicativa, il plan la riancorerà con `grep`.

---

## 1. Il problema (perché l'attivazione è stata rimandata)

A2a ha spedito `dup_check`/`cycle_check`/`twin_check`, li ha cablati in un controllo 1 **multi-oracolo, delta-gated** (`control1Hygiene`, `checkpoint.mjs:195-273`), con fingerprint ancorati al contenuto e invarianti all'ordine. Ma **nessun pack reale li dichiara** (verificato con grep su tutti e 20 i manifest): le uniche dichiarazioni vivono in un `SYNTH_MANIFEST` dentro il keystone (`eval/harness/a2a_hygiene_check.mjs:44`).

La ragione è documentata (keystone `:38-43`, `SESSION-STATE.md:9`): legare i due oracoli a un pack di produzione li fa girare sul suo **reference-app**, che porta **debito strutturale pre-esistente** (cloni, cicli). Poiché il gate m5 esegue il checkpoint sul reference-app con un baseline **vuoto** per il fixture (`run_loop.mjs:389`, `fixtureApp ? new Set() : …`), quel debito è emerso come **finding NUOVI** → **m5 51/56**. Piuttosto che spedire un gate che scatta sul debito legacy, A2a ha spedito gli oracoli ma li ha attivati solo nel manifest sintetico.

**A2c inverte quella decisione in sicurezza:** attiva dup/cycle sui pack reali *con un baseline che assorbe il debito di partenza*, così il gate scatta **solo sul debito nuovo**.

### 1.1 Il vincolo decisivo — il fixture m5

Il gate m5 gira sul reference-app come `fixtureApp`, dove il baseline in-memoria è forzato **vuoto**. Un ricalcolo in-memoria del baseline **non basta** per il caso fixture. Per rendere m5 verde con dup/cycle attivi serve un baseline **committato/dichiarato** che assorba il debito. Questo, unito all'assioma di A2a *"la baseline è la dichiarazione"*, fissa il modello: **baseline committato, ricalcolo-al-refresh**.

---

## 2. Scope A2c

**In scope:**
1. **Cattura del baseline per dup/cycle** — estendere il path di `capture` perché esegua jscpd/madge (oggi conosce solo gitleaks/rls/knip/osv).
2. **Attivazione per-pack** — dichiarare `oracles.duplication`/`oracles.architecture` nei manifest reali: `dup` su tutti i pack JS/TS (ed estendibile ad altre lingue: jscpd è multi-linguaggio), `cycle` sui soli pack JS/TS (madge è JS/TS-only).
3. **Gate BUILD** — dup/cycle bloccano sul **delta** vs baseline committato (logica già pronta in `control1Hygiene`).
4. **Report REMEDIATE** — estendere `collectFindings` perché esegua dup/cycle/twin → riportati **non-bloccanti**, con baseline-delta, **mai auto-fixati** (`L-COL-030`).
5. **Refresh dichiarato** — un comando CLI per (ri)generare e committare il baseline; ratchet verso il basso (il ricalcolo scarta il debito risolto).
6. **Vacuity guard** — oracolo attivo ma baseline assente → degradato/rosso, mai verde silenzioso.
7. **Keystone falsificabile + non-regressione** — m5 torna 56/56; test che nuovo debito → rosso e che il baseline è load-bearing.

**Fuori scope:** vedi §12. In sintesi: fix-provider deterministico per dup/cycle; promozione di `twin` a gate; allowlist `accepted-risk` per dup/cycle (rimandata — §3); cicli per lingue non-JS.

---

## 3. Decisioni di design (dal brainstorming)

| # | Decisione | Scelta | Razionale |
|---|---|---|---|
| D1 | Ciclo di vita del baseline | **Committato, ricalcolo-al-refresh** | Deterministico per il fixture m5; dichiarato/ispezionabile (`L-COL-028`); il ricalcolo scarta il debito risolto (ratchet) senza mutazione git nel gate (`L-COL-024`). |
| D2 | Ambito pack | **Tutti i pack JS/TS** (dup estendibile ad altre lingue); `cycle` solo JS/TS | `madge` è JS/TS-only; `jscpd` multi-linguaggio. Coverage declaration dove i cicli non sono coperti. |
| D3 | Modalità | **Sia BUILD (gate) sia REMEDIATE (report)** | Il gate protegge la costruzione; il report fa emergere il debito nell'audit reale. |
| D4 | Allowlist `accepted-risk` per dup/cycle | **RIMANDATA** | Il baseline+refresh **è** già il meccanismo d'accettazione; un `accepted-risk` per-finding sarebbe ridondante. Il seam (`partitionBlockers:173`) resta disponibile. |
| D5 | Meccanismo del baseline | **Unificato** (riuso `baseline.mjs`: `capture`/`delta`/snapshot) | Il concetto è identico (insieme di fingerprint); zero reinvenzione. |
| D6 | Persistenza del baseline d'igiene | **Path git-TRACCIATO, distinto dall'artefatto effimero di sicurezza** | Vincolo emerso: `.trueline/baseline.json` è **gitignorato** (dir artefatti/binari preflight) → non può essere la dichiarazione committata. Vedi §4.2. |

> **Nota su D5/D6.** "Unificato" è al livello del **meccanismo** (stesso codice `baseline.mjs`, stessa forma di snapshot `{version, fingerprints[], findings{}}`, stesso `delta`), **non** necessariamente lo stesso *file*. Il baseline di sicurezza è un artefatto **effimero** (REMEDIATE lo ricalcola in-run a `run_loop.mjs:389`, mai committato → gitignorato è corretto); il baseline d'igiene è una **dichiarazione committata** e deve stare su un path tracciato. Il codice è condiviso; la posizione no.

---

## 4. Meccanismo del baseline (il cuore)

### 4.1 Cattura estesa
`baseline.mjs::capture(projectDir, oracles, opts)` (`:178`) oggi dispaccia solo `gitleaks, rls-check, knip, osv` (`DEFAULT_ORACLES :79`, `oracleInvocation :122-142`). **Nuovo:** aggiungere le voci di invocazione per gli oracoli d'igiene **dichiarati dal manifest** — `jscpd` (`run_dupcheck.mjs`), `madge`/`cycle` (`run_cyclecheck.mjs`), e `twin` (`twin_check.mjs`, per il report) — normalizzando via i `normalize*` già esistenti (`normalizeJscpd :833`, `normalizeCycle :875`, `normalizeTwin :909`). Lo snapshot risultante contiene i fingerprint di sicurezza **e** d'igiene; gli insiemi sono **disgiunti** per `oracle|ruleId` nel fingerprint (`fingerprintOf :156-160`), quindi aggiungere fp d'igiene **non** grandfather-a alcun finding di sicurezza.

### 4.2 Persistenza — path tracciato
- **Baseline d'igiene committato:** path **git-tracciato**. Proposta default: **`.trueline/hygiene-baseline.json`** con negazione esplicita in `.gitignore` (`!.trueline/hygiene-baseline.json`) — co-locato con gli altri artefatti Trueline ma **tracciato**. (Alternativa considerata: file a livello radice `trueline-hygiene-baseline.json`; scartata per non inquinare la radice del progetto utente. Il plan sceglie definitivamente il path e la meccanica di `.gitignore`.)
- **Snapshot d'igiene "puro":** contiene **solo** i fp d'igiene (dup/cycle; e twin per il report). Per il fixture m5 questo è ciò che si committa → carica → il debito d'igiene è grandfathered mentre la sicurezza resta vuota (S1–S8 ancora "new").

### 4.3 Caricamento nel checkpoint
Il checkpoint deve **caricare il baseline d'igiene committato** quando presente (via `loadBaseline`, `run_checkpoint.mjs:109-115`) e **unirlo** al baseline di sicurezza in-run, prima di passarlo a `control1Hygiene`/`control2Security`. Poiché i fp sono disgiunti per oracolo, l'unione è sicura:
```
baselineIgiene = existsSync(hygieneBaselineFile) ? loadBaseline(hygieneBaselineFile) : new Set()
baseline = union(baselineSicurezzaInRun, baselineIgiene)
```
- **BUILD (m5/fixture):** `baselineSicurezzaInRun` vuoto (fixtureApp) + `baselineIgiene` committato → S1–S8 rilevati, debito dup/cycle grandfathered.
- **BUILD (reale):** identico; il baseline d'igiene committato del progetto assorbe il suo debito.
- **BIT-invarianza:** finché un pack non dichiara le chiavi **e** non esiste il file d'igiene committato, il baseline d'igiene è vuoto e il controllo 1 è byte-identico al comportamento pre-A2c.

### 4.4 Refresh (ricalcolo-al-refresh, ratchet)
Un comando CLI — **proposta: `node trueline/scripts/findings/baseline.mjs --refresh --hygiene <dir>`** (o un `capture_baseline.mjs` dedicato se `baseline.mjs` non ha un `main` CLI; da verificare nel plan) — esegue `capture` sugli oracoli d'igiene dichiarati e **riscrive** `hygiene-baseline.json`. Poiché ricalcola da zero:
- **assorbe** il debito appena accettato (un clone intenzionale nuovo),
- **scarta** il debito risolto (ratchet verso il basso: un clone cancellato esce dal baseline → reintrodurlo torna a bloccare).

Il **commit** del file è un atto umano/orchestratore (`L-COL-024`): il gate **non** muta git. Il checkpoint **segnala** le voci di baseline stale (fingerprint nel baseline ma non più presenti nel repo) come suggerimento di refresh, senza agire.

### 4.5 Vacuity guard (`L-COL-006`, sul modello di `arch_check`)
- Oracolo **dichiarato-attivo** ma tool assente (jscpd/madge non installabili) → `dup:degr`/`cycle:degr` (già così in `control1Hygiene`): dichiarato, **non** verde.
- Oracolo **dichiarato-attivo** ma **baseline d'igiene assente** su un progetto reale → **degradato/rosso** con messaggio esplicito (`"igiene attiva ma baseline mancante: esegui il refresh del baseline"`), **mai** verde silenzioso e **mai** blocco-cieco su tutto il debito. Questo è il guard nuovo (analogo del `degraded` di `arch_check.mjs:90-129`).

---

## 5. Attivazione per-pack (manifest)

I manifest `ecosystem.json` dichiarano gli oracoli nella mappa `oracles`. Attivazione = due chiavi additive, già consumate da `control1Hygiene` (`:220-236`) e già accettate dal guard vocabolario A0 (`duplication`/`architecture` sono nell'enum `category`):
```json
"duplication":  { "tool": "jscpd", "min_tokens": 50 },
"architecture": { "tool": "madge" }
```
- **`duplication`** → tutti i pack JS/TS (pilota `supabase-jsts` per primo, portatore del keystone m5). Estendibile ad altre lingue in una milestone successiva (jscpd le supporta; fuori scope qui).
- **`architecture` (cicli)** → **solo** pack JS/TS. Per i pack non-JS: **nessuna chiave** + coverage declaration `"cicli non coperti per <lingua> (madge JS/TS-only)"`.
- **`min_tokens`** vive nel manifest versionato (`checkpoint.mjs:221`, default 50): soglia che **filtra**, non costituisce il verdetto; cambiabile solo con approvazione umana → commit (`L-COL-028`).

---

## 6. Gate BUILD

Nessuna logica di gate nuova: `control1Hygiene` (`:195-273`) è già multi-oracolo, delta-gated. `partitionBlockers(all, baseline)` (`:166-182`):
- fp **assente** dal baseline → **NUOVO** → blocca (dup/cycle);
- fp **presente** → pre-esistente → riportato, non blocca;
- `fix_state:'accepted-risk'` → saltato (seam allowlist, non popolato da A2c);
- `twin` (`DETECTION_ONLY_ORACLES :70`) → mai blocca;
- `arch` (`ABSOLUTE_GATE_ORACLES :75`) → bypassa il delta (invariato, è A2b).

`cycle` **non** è in nessuno dei due set override → blocca **sul delta**, che ora funziona perché il baseline lo alimenta (§4).

---

## 7. Report REMEDIATE

`collectFindings` (il path REMEDIATE, `run_loop.mjs:136-179`) oggi esegue gitleaks/rls/knip/authz/semgrep — **non** dup/cycle/twin. **Nuovo:** eseguirli quando il manifest li dichiara, normalizzarli, e includerli tra i finding dell'audit:
- **non-bloccanti** in REMEDIATE (l'audit riporta il debito strutturale, non gata la remediation);
- **baseline-delta**: i cloni/cicli pre-esistenti sono `pre-existing` (grandfathered contro il baseline in-run di `run_loop.mjs:389`, che ora includerà i fp d'igiene);
- **mai auto-fixati** (`L-COL-030`, detection-only in v1): nessun fix-provider deterministico spedito per dup/cycle;
- **coverage declaration** sempre presente (`"duplicazione ≥50 token verbatim; rinominati non coperti → twin segnala; cicli solo JS/TS; efficienza non gate-abile"`).

---

## 8. Finding model & fingerprint (nessun cambio di schema)

Tutto già esistente in `finding.schema.json` e `normalize.mjs`:
- Categorie `duplication`/`architecture` già nell'enum; `baseline_status` (`:144-151`) e `fingerprint` (`:20-24`) già `required`; `fix_state:'accepted-risk'` già presente (`:141`).
- Fingerprint content-anchored e order-invariant: `normalizeJscpd` (frammento normalizzato + coppia di file ordinata, `:862`), `normalizeCycle` (moduli ordinati → invariante alla rotazione, `:895`), `normalizeTwin` (coppia di dir ordinata, `:909`). Stabili tra run (`fingerprintOf` usa `matchSignature` normalizzato, mai la riga).

**A2c non tocca `finding.schema.json` né `normalize.mjs`** (se non, eventualmente, `title`/coverage cosmetici). È lavoro di **cablaggio**, non di modello.

---

## 9. Testing — keystone & non-regressione

### 9.1 Keystone A2c (`eval/harness/a2c_hygiene_activation_check.mjs`, nuovo)
Falsificabile a due livelli (`L-COL-002`, verità = fatto d'oracolo):
1. **`newdebt:red`** — su una copia della reference app con il baseline committato, **iniettare** un clone/ciclo **nuovo** (oltre il baseline) → controllo 1 **ROSSO** con un blocker `duplication`/`architecture`.
2. **`baseline-loadbearing`** — **svuotare** il baseline committato → *tutto* il debito dup/cycle pre-esistente torna `new` → controllo 1 **ROSSO** → ripristinare → **VERDE**. Prova che il baseline è load-bearing (non un no-op).
3. **`preexisting:green`** — con baseline intatto e nessun debito nuovo → controllo 1 **VERDE** (debito pre-esistente grandfathered).
4. **`twin:signal-not-gate`** — twin riportato ma non blocca (invariante A2a).
5. **`vacuity:degr`** — attivo + baseline assente → degradato/rosso, non verde.

### 9.2 m5 torna 56/56
Committare per il reference-app di `supabase-jsts` il baseline d'igiene che assorbe il suo debito dup/cycle. `m5_gate_check.mjs` → **56/56**: il verdetto di sicurezza è invariante (fp disgiunti), il debito d'igiene è grandfathered. **Nota d'implementazione (per il plan):** il fixture-baseline dev'essere git-tracciato (negazione `.gitignore` o path esplicito passato al harness m5); risolvere il conflitto col gitignore di `.trueline/` (§4.2).

### 9.3 Non-regressione integrale (SERIALE, `L-COL-002`)
`a2a_hygiene_check` invariato (SYNTH_MANIFEST) · `a2b_arch_check` 8/8 · `a0_authz_gate_check` 16/16 · `anti_tamper_check` 49/49 · `build_discipline_check` 21/21 · unit A2a/A0 · `package_skill` lint VERDE (20 pack) · **BIT-invarianza** provata (pack senza chiavi + nessun baseline d'igiene → controllo 1 byte-identico) · 0-contaminazione (HEAD esterno + interni dei fixture invariati).

---

## 10. Error handling & invarianti

- **`L-COL-002`** — il verdetto è un fatto d'oracolo/harness, mai una frase dell'LLM.
- **`L-COL-006`** — oracolo non eseguito / baseline assente ≠ verde; coverage declaration sempre presente.
- **`L-COL-024/025`** — git solo nell'orchestratore; branch `feat/a2c-hygiene-activation`; `main` intatto fino al merge human-gated; il gate non muta git (refresh = atto umano). Provisioning `.git`/`node_modules` dei fixture = passo d'orchestratore.
- **`L-COL-028`** — soglie (`min_tokens`, K twin) e baseline versionati; cambiano solo con commit umano.
- **`L-COL-029`** — raffinamenti additivi; nessun lock nuovo previsto (l'attivazione è cablaggio; se serve un lock per "baseline d'igiene dichiarato come contratto delta", valutarlo nel plan/ledger).
- **`L-COL-030`** — detection-only in v1: nessun fix-provider dup/cycle spedito.
- **BIT-invarianza** — pack senza chiavi + nessun baseline d'igiene → controllo 1 e verdetto byte-identici (m5/A2a/A0 invarianti).
- **Windows** — path assoluti/quotati; `NUL` rompe `git add -A` → rimuoverlo.

---

## 11. Onestà — cosa A2c NON fa (`L-COL-006`)

- **Non gata i rinominati.** Il clone-and-rename per-entità (il pattern-firma reale, es. `commessa`↔`preventivo`) sfugge a jscpd (lessicale): `twin` lo **segnala**, non lo gata. La coverage declaration lo dice.
- **Non verifica-a-zero il debito d'igiene.** dup/cycle restano detection-only per il *fix*: A2c gata il **nuovo** debito, non "rimedia in modo verificato" il vecchio.
- **Non copre i cicli non-JS.** madge è JS/TS-only; per le altre lingue i cicli sono dichiarati non-coperti.
- **Non giudica l'efficienza/l'altitudine.** Non gate-abile (Rice); resta il dominio di `arch_check` (contratto dichiarato, A2b) per l'altitudine, non di A2c.

---

## 12. Fuori scope (milestone successive)

- Fix-provider deterministico per dup/cycle (promozione a "verified"): oggi `L-COL-030` detection-only.
- Promozione di `twin` a gate (serve un tool deterministico per i rinominati).
- Allowlist `accepted-risk` per dup/cycle (D4: il baseline+refresh copre l'accettazione).
- `duplication` per lingue non-JS (jscpd le supporta; attivazione separata).
- Cicli per lingue non-JS (serve un analizzatore di grafo per-lingua).
- Assert per-categoria del `verified_set` per l'igiene (era già annotato come lavoro A1).

---

## 13. Definizione di "fatto" per A2c

1. `supabase-jsts` (e gli altri pack JS/TS) dichiarano `duplication`/`architecture`; `dup` esteso ai pack multi-lingua dove deciso.
2. `capture` esteso cattura dup/cycle/twin; il baseline d'igiene è committato su path tracciato; il checkpoint lo carica e lo unisce.
3. Comando di refresh (ricalcolo, ratchet) funzionante; vacuity guard attivo.
4. REMEDIATE riporta dup/cycle/twin non-bloccanti con baseline-delta + coverage declaration.
5. **Keystone `a2c_hygiene_activation_check` PASS** (falsificabile a due livelli) + **m5 56/56** + non-regressione integrale SERIALE + BIT-invarianza + 0-contaminazione.
6. Ledger (`00-INDEX §4`) + `SESSION-STATE` + dispatch `SKILL.md`/`references/modes/*` aggiornati; merge `--no-ff` human-gated su `main` + push + install (plugin) riallineato.

---

## 14. Fasatura del build (il plan la dettaglia)

Lo spec copre tutto l'ambito; il plan lo costruisce a ondate, con il keystone deterministico per primo:

- **F1 — Meccanismo + pilota + gate m5 falsificabile.** `capture` esteso, persistenza tracciata + caricamento/unione nel checkpoint, refresh, vacuity guard, attivazione `supabase-jsts`, baseline-fixture committato, keystone `a2c_hygiene_activation_check`, m5 56/56. **È la fase che porta il gate falsificabile.**
- **F2 — Roll-out pack JS/TS.** Attivare `duplication`+`architecture` sugli altri pack JS/TS (e `duplication` sui pack multi-lingua se deciso), un pack alla volta con baseline che assorbe il rispettivo debito; conformance per-pack invariante.
- **F3 — Report REMEDIATE.** `collectFindings` esteso a dup/cycle/twin non-bloccanti + coverage declaration; test del path REMEDIATE.

Ogni fase: gate SERIALE + no-regressione; merge unico human-gated a fine milestone (cadenza `L-COL-024` come ratificata nella eco-expansion).
