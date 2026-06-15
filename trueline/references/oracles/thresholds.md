# thresholds.md — soglie del checkpoint e budget del loop (Trueline)

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Milestone** | M1 (checkpoint + verify-fix loop) — **default PROVVISORI** |
| **Copre** | soglie di severita del controllo 2 (03 §8), baseline-delta (04 §6), loop-budget (`O-COL-006`, 05 §4) |
| **Pin numerico** | il valore empirico definitivo si rifinisce al **parity gate (M5, 10-EVALUATION)** |

---

## 1. Perche questo file esiste

Il checkpoint (`01` §4) e il loop (`05`) **non** decidono da soli quanto e "troppo":
leggono le soglie da qui. Tenere i numeri in un reference versionato fa due cose:
le rende ispezionabili/diff-abili (un cambio di policy e un diff, non codice
nascosto) e disaccoppia la *policy* (esiste un budget, esiste una soglia) dal
*pin numerico* (il valore esatto), che dipende dalla reference app e si calibra
al parity gate di M5.

**In M1 i numeri qui sotto sono DEFAULT PROVVISORI ragionevoli.** La macchina e
completa e li rispetta; il pin empirico arriva con M5.

---

## 2. Soglie di gating per categoria (03 §7)

Ogni categoria ha una regola di gating propria. La regola e **autorita dell'oracolo**:
l'LLM non decide l'esito (L-COL-002). Verde = nessun finding NUOVO che supera la
soglia della categoria (baseline-delta, §4).

### 2.1 `secret` — segreti in chiaro

| Chiave | Valore | Regola |
|---|---|---|
| `SECRET_GATE` | `always-block` | **Blocca sempre**, indipendentemente dalla severita. Qualsiasi secret NUOVO in working-tree blocca il checkpoint (BUILD e REMEDIATE). Oracolo: gitleaks working-tree. |

Motivazione: un segreto esposto non ha una "severita accettabile"; la severita
OWASP e inapplicabile (`04` §4). La regola e chiusa: zero tolleranza.

### 2.2 `rls` — Row-Level Security mancante o permissiva

| Chiave | Valore | Regola |
|---|---|---|
| `RLS_GATE_BUILD` | `block-if-touched` | In BUILD blocca se la tabella carente di RLS e **toccata dalla migration in esame** (gate per triage). Oracolo: rls_check su DDL. |
| `RLS_GATE_REMEDIATE` | `always-block` | In REMEDIATE blocca sempre se presente. La fase di fix non puo' lasciare RLS mancante. |
| `RLS_SEVERITY_FLOOR` | `HIGH` | Un finding rls con severity < HIGH (es. `MEDIUM`) **non** blocca il gate; e' segnalato nel report. In M1 rls_check emette solo `CRITICAL`/`HIGH`. |

Motivazione: RLS mancante su una tabella toccata e un rischio critico di data-leak
(S3/S4/S5 del set verificato-a-zero, L-COL-010). Il triage per tabella toccata
evita falsi positivi su tabelle di sistema gia' note.

### 2.3 `injection` / `authz` / `crypto` — categorie di iniezione e autenticazione

| Chiave | Valore | Regola |
|---|---|---|
| `INJECT_AUTHZ_CRYPTO_GATE` | `block-if-new-and-high` | Blocca se finding NUOVO **e** `severity >= HIGH`. Finding MEDIUM/LOW non bloccano (segnalati). |
| `INJECT_AUTHZ_CRYPTO_SEVERITY_FLOOR` | `HIGH` | Coincide con `GATE_SEVERITY` globale. |

Oracolo: semgrep (ruleset AI curato) — **DIFFERITO a M4** (07 §4). In M1 queste
categorie sono **detection-only**: trovate e spiegate, non gate-ate nel checkpoint.
La regola di gating qui documentata entra in vigore quando il corrispondente
oracolo e integrato (M4).

### 2.4 `dependency-vuln` — vulnerabilita nelle dipendenze

| Chiave | Valore | Regola |
|---|---|---|
| `DEPVULN_GATE` | `block-if-new-and-high` | Blocca se finding NUOVO **e** `severity >= HIGH` (CRITICAL o HIGH). |
| `DEPVULN_SEVERITY_FLOOR` | `HIGH` | MEDIUM/LOW segnalati, non bloccanti. |

Oracolo: osv-scanner su lockfile. Best-effort: se l'oracolo non e raggiungibile
(offline / lockfile assente) il controllo 2 si dichiara **degradato per osv**,
non falsamente verde.

### 2.5 `dead-code` — codice morto

Il dead-code **non** ha severita OWASP (`04` §4): il gate e per DELTA, non per severita.

| Chiave | Valore | Regola |
|---|---|---|
| `DEADCODE_GATE_ON` | `delta-only` | Blocca solo sui finding `baseline_status = new`. Il morto pre-esistente e **segnalato, non cancellato in autonomia** (`L-COL-021`). |

Oracolo: knip (via run_deadcode). Dead-code nuovo introdotto da un fix = gate rosso.
Il loop propone la rimozione; l'applicazione e sempre human-gated (`L-COL-021`).

---

## 3. Soglia globale del controllo 2 (sicurezza) — `GATE_SEVERITY`

Il controllo 2 e **verde quando nessun finding NUOVO** nelle categorie in scope ha
`severity >= GATE_SEVERITY`.

| Chiave | Default provvisorio | Note |
|---|---|---|
| `GATE_SEVERITY` | `HIGH` | Blocca su `CRITICAL` e `HIGH`. `MEDIUM`/`LOW` sono segnalati ma non bloccano il gate (restano nel report). |

Ordine di severita (decrescente): `CRITICAL > HIGH > MEDIUM > LOW`.

Le categorie del **set verificato-a-zero** (`L-COL-010`): `secret`, `rls`, `dead-code`.
Le categorie detection-only (`injection`, `authz`, `crypto`, `dependency-vuln` offline)
**non** bloccano il gate di sicurezza in BUILD prima dell'integrazione degli oracoli
corrispondenti; in REMEDIATE possono entrare nel loop ma non elevano la coverage.

---

## 4. Baseline-delta (03 §8, 04 §6)

Il gate guarda i **finding nuovi sopra soglia**, non l'assoluto. Chiave del
delta = `fingerprint` (stabile-per-riga, ancora di contenuto, mai il numero di
riga, `04` §6).

- `baseline_status = pre-existing` → gia presente nella baseline → **non** blocca
  (a meno che la modalita REMEDIATE lo prenda esplicitamente in carico).
- `baseline_status = new` → introdotto da questo macrotask/fix → **blocca** se
  `severity >= GATE_SEVERITY` (controllo 2) o se categoria `dead-code` (controllo 1).

In M1 il checkpoint accetta una baseline esplicita (insieme di fingerprint gia
noti). Baseline vuota ⇒ ogni finding e `new` (comportamento di `normalize` a
baseline vuota, `04`).

---

## 5. loop-budget — `O-COL-006` (policy chiusa in 05 §4)

> La **policy** e chiusa (05 §4): esiste un cap per-finding e un budget globale,
> e come si fanno rispettare. Qui vivono i **default provvisori**; il pin
> numerico empirico e di M5 (parity gate).

// PIN EMPIRICO: rifinire al parity gate M5

| Chiave | Default provvisorio | Significato |
|---|---|---|
| `MAX_RETRIES_PER_FINDING` | `2` | Cap per-finding: 2 retry = **3 tentativi totali** (proposta iniziale + 2). Deciso in 05 §4 (chiuso). |
| `GLOBAL_WALL_CLOCK_MS` | `600000` (10 min) | Tetto di tempo di parete per **sessione** di verifica. Provvisorio. |
| `GLOBAL_TOKEN_BUDGET` | `null` (non applicato in eval) | Tetto di token per sessione. Nella skill reale lo applica il runtime LLM; in eval (fix provider deterministico, nessun token) **non si applica**. |

Vale il **primo cap che scatta**: per-finding `MAX_RETRIES_PER_FINDING`
**oppure** budget globale (`GLOBAL_WALL_CLOCK_MS` / `GLOBAL_TOKEN_BUDGET`).
Esaurito un cap → stato **terminale** presentato all'umano (`accepted-risk` /
fix manuale / rinvio), **mai** scarto silenzioso, **mai** `verified` (05 §4).

### 5.1 Procedura di taratura e pinning (verso M5)

Il pin numerico definitivo si ottiene con la seguente procedura empirica al
parity gate (M5, 10-EVALUATION):

1. Eseguire il loop su tutta la reference app (gate di verifica, 10 §3) con i
   finding del set in-scope (L-COL-010).
2. Misurare, per ogni finding, **quanti retry** servono per raggiungere `verified`
   e **quanto tempo di parete / quanti token** consuma la sessione complessiva.
3. Calcolare p95 osservato su un campione rappresentativo (almeno 10 esecuzioni
   su reference app pulita con difetti ri-seminati).
4. Pinnare `GLOBAL_WALL_CLOCK_MS` = p95_ms × 1.25 (margine), `GLOBAL_TOKEN_BUDGET`
   = p95_tokens × 1.25. Lasciare `MAX_RETRIES_PER_FINDING = 2` (chiuso in 05 §4).
5. Registrare i valori pinnati in `10-EVALUATION` (Chat E) e aggiornare la tabella
   in §5 sopra sostituendo i default provvisori.

// PIN EMPIRICO: rifinire al parity gate M5

---

## 6. Come leggere queste soglie da codice

Il loader unico e `trueline/scripts/checkpoint/thresholds.mjs`, che espone i
default qui sopra come oggetto JS (le tabelle di questo file ne sono la fonte di
verita leggibile). Modificare i numeri **qui** e nel loader insieme: il
disallineamento e un bug, non una feature.

Categorie rilevanti esportate dal loader:

- `GATE_SEVERITY` → soglia globale sicurezza (§3)
- `DEADCODE_GATE_ON` → policy dead-code (§2.5)
- `VERIFIED_ZERO_CATEGORIES` → set in-scope L-COL-010
- `LOOP_BUDGET.MAX_RETRIES_PER_FINDING` → cap retry per finding (§5)
- `LOOP_BUDGET.GLOBAL_WALL_CLOCK_MS` → tetto tempo di parete (§5)
- `LOOP_BUDGET.GLOBAL_TOKEN_BUDGET` → tetto token sessione (§5)

Le regole per categoria (§2) sono policy documentate, non ancora tutte codificate
come costanti separate nel loader (l'aggiunta avviene man mano che gli oracoli
corrispondenti vengono integrati: rls in M1, semgrep/injection in M4, etc.).
