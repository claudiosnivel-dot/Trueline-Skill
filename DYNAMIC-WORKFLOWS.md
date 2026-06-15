# DYNAMIC-WORKFLOWS — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) — ex codename *Collaudo* |
| **Versione** | v0.1 (Chat E) |
| **Data** | 14 giugno 2026 |
| **Copre** | `L-COL-027` (cardine); `O-COL-010` (piano richiesto) |
| **Dipende da** | `00-INDEX` v1.0 (manifest + ledger), `10-EVALUATION` v0.1 (l'harness che fa da gate), `11-BLUEPRINT-ENGINE` v0.1 (schema del task, `L-COL-019`), tutti i moduli per la mappa di milestone (§8) |

---

## 1. Cos'è — e cosa NON è

Questo file descrive **come costruiamo Trueline** una volta chiuso il blueprint: l'implementazione è orchestrata con i **Dynamic Workflows di Opus 4.8**, cioè lo **strumento `Workflow` di Claude Code** (orchestrazione deterministica in JavaScript), non con la validazione sequenziale a una-cosa-alla-volta. *(L-COL-027)*

Tre confini da tenere fermi — è un metodo di **build-time**, non un pezzo del prodotto:

- **Non è il runtime di Trueline.** Trueline è una Agent Skill; i Dynamic Workflows sono lo strumento con cui *noi* implementiamo quella skill.
- **Non è la BUILD mode di Trueline** (`01` §3.2, VISION §5). Quella è un comportamento della skill consegnata; questo è il nostro processo di sviluppo. Stesso vocabolario ("build", "macrotask", "checkpoint"), piani diversi — la stessa disciplina con cui teniamo distinte le **due `SESSION-STATE`** (`11` §4).
- **Non è il `session-start.md` che la skill emette** (`12`). Quel prompt è un artefatto di output di BOOTSTRAP per l'utente; il prompt "usa lo strumento Workflow" è **nostro**, per le nostre sessioni di implementazione.

**Come si avvia.** Lo strumento `Workflow` parte **solo con opt-in esplicito**: nel prompt di inizio sessione si dice letteralmente *"usa lo strumento Workflow"*, così l'orchestratore reale viene invocato e non simulato con subagent singoli.

## 2. Meccanica

Quattro fasi: **plan → distribute → verify → integrate**. L'orchestratore — la **sessione Claude Code su Opus 4.8** che lancia lo strumento — scompone il milestone in **task atomici indipendenti**, ne lancia uno per subagent in **ondate concorrenti**, fa verificare ogni output contro il suo **gate**, e **integra solo se il gate è verde**.

- Il piano del workflow vive in **variabili JS fuori dal context** dell'orchestratore (è come funziona lo script dello strumento `Workflow`).
- Primitivi reali: un'**ondata di task indipendenti** = `parallel([...])` (barriera, attende tutti) **oppure** `pipeline(items, build, verify, …)` quando build→verify→fix scorrono per-item senza barriera (default consigliato). Un `agent()` per task; `phase()` raggruppa i task nella vista di avanzamento.
- **Cap reali dello strumento**: concorrenza = **`min(16, core_CPU − 2)` per workflow** (16 è il tetto, non una garanzia) · **1.000 agent totali per run**. Gli agenti consumano molto più usage di una sessione normale → **partire scoped, monitorare l'usage**.
- **Una milestone = una sessione-workflow** (§8).

## 3. Unità di lavoro: il task atomico (test-first)

Ogni task nasce **con il suo gate scritto prima del build**. Qui c'è il **dogfooding**: è esattamente `L-COL-019` (ogni unità porta definition-of-done + criteri + test) applicato al *nostro* lavoro — costruiamo Trueline con la regola che Trueline impone.

```
TASK
  id            : Tn.m
  dominio       : a quale file/modulo del blueprint appartiene (es. 05 §3, 03 §5.4)
  dipende_da    : [id, …]            ← definisce l'ondata
  output        : artefatto prodotto (script, reference, componente, fixture)
  GATE          : asserzione automatica di accettazione (IL test) — vedi §6
  modello       : Opus | Sonnet   (builder; il verifier è SEMPRE Opus — §5)
  done          : il gate passa + integrato
```

## 4. Pipeline per task

```
        ┌─────────┐     ┌──────────────┐     ┌──────────────┐     ┌───────────┐
  spec→ │  BUILD  │ ──▶ │ VERIFY (×k)  │ ─✗─▶│  FIX-LOOP    │ ──▶ │ INTEGRATE │
        │ subagent│     │ vs il GATE   │     │ build+test   │     │  (merge)  │
        └─────────┘     └──────┬───────┘     │ fino a verde │     └───────────┘
                               └──✓──────────────────────────────────▲
```

- **k verifier** per task (default 1; 2 per artefatti critici — es. la macchina del loop di `05`, il RLS checker di `03` §5.4).
- **fix-loop** invocato **solo su fallimento**; itera build→test finché il gate è verde.
- Un'ondata si chiude solo quando **tutti** i suoi task sono verdi.

## 5. Model policy *(L-COL-027 — contenuto)*

| Ruolo / tipo di task | Modello |
|---|---|
| **Verifier** (ogni task) | **Opus 4.8** — sempre |
| **Orchestratore** | **Opus 4.8** (la sessione Claude Code che lancia lo strumento) |
| **Builder — logica delicata di Trueline** | **Opus 4.8** |
| **Builder — task meccanici** | **Sonnet** |

**Builder-Opus (logica delicata di Trueline):** la macchina del verify-fix loop (`05` §3) e la sequenza segreto-in-history (`05` §7); l'**RLS checker** col parser DDL (`03` §5.4); fingerprint/baseline-delta e dedup (`04` §6, `03` §6); la **partizione guardia/impattate** dei characterization test (`06` §4); `validate_blueprint` + checklist semantica (`11` §5); il detector di deploy-coupling (`01` §5.3); la normalizzazione → finding model, inclusa la mappa OWASP `L-COL-026` (`03` §6); la risoluzione-intento/dispatch (`01` §2, `02` §5).

**Builder-Sonnet (meccanico):** gli **wrapper** degli oracoli a flag fissi (`run_semgrep`/`gitleaks`/`osv`/`deadcode`); i `references/modes/*`; i 3 template di prompt (`12`); frontmatter e boilerplate; la tabella di preflight (`03` §4); l'assemblaggio di `package_skill` (`09` §3).

> **Niente Haiku.** Per codice che deve passare un gate, **Sonnet è il pavimento**: sotto-dimensionare sposta il costo nel fix-loop. La colonna `modello` del task indica il **builder**; il **verifier è sempre Opus**.

## 6. Il gate NON è "DB locale" — sono gli oracoli di Trueline

L'adattamento centrale rispetto al metodo generico. Il **gate** di un task di implementazione non è una query su un DB locale: è **far girare gli oracoli / `validate_blueprint` / l'harness di `10-EVALUATION` sulla reference app** (`10` §5). In concreto, a seconda del dominio del task:

- task su uno **script-oracolo** (es. `rls_check.*`, `run_semgrep.*`) → il gate è l'esito atteso dell'oracolo sui difetti seminati `S1–S8` (`10` §2);
- task sul **loop** (`05`) → il gate è che il set in scope raggiunga `verified` e il segreto-in-history resti `mitigated-residual` (`10` §3, criteri 2);
- task sul **motore di blueprint** (`11`) → il gate è `validate_blueprint` pulito + self-check sul blueprint seminato (`10` §4, criterio 5);
- task sul **packaging** (`09`) → il gate è "assembla un `.skill` che passa il lint strutturale" (`09` §3).

Così il "verde" di un task è un **fatto deterministico** prodotto da un oracolo, non una frase dell'LLM: i Dynamic Workflows ereditano `L-COL-002` per costruzione. È `10` a definire i gate; il workflow li **consuma**.

## 7. Ondate & DAG

I task si organizzano in un **grafo di dipendenze** (`dipende_da`); gli indipendenti girano in parallelo (≤ cap §2). Il **fan-out = numero di task realmente indipendenti** in quell'ondata, non un numero forzato. Le dipendenze reali del blueprint vincolano l'ordine (es. il **finding model `04` precede** il loop `05`; lo **schema del task `11` precede** il self-check; gli **oracoli `03` precedono** il checkpoint).

## 8. Scomposizione in milestone del build di Trueline

Una milestone = una sessione-workflow. Prima passata (rivedibile), ordinata per dipendenze:

| Milestone | Contenuto | Output principali | Gate (harness `10`) |
|---|---|---|---|
| **M-1 — Banco di prova** *(prerequisito)* | le **fixture di gate** di `10` (§2–§3): reference app vulnerabile con difetti seminati `S1–S8`, DB di test per RLS a runtime, blueprint seminato, scheletro dell'harness di regressione | reference app + `S1–S8`, DB di test, blueprint seminato, harness di detection/regressione | auto-gate del banco: l'harness gira e gli `S1–S8` sono presenti e ispezionabili |
| **M0 — Oracoli & finding** | `03` + `04`: wrapper oracoli, `rls_check`, `normalize`, schema del finding | `scripts/oracles/*`, `findings/normalize.*`, `finding-model.md` | detection di `S1–S8` (`10` §3, criterio 1) |
| **M1 — Checkpoint & loop** | `01` §4 + `05`: `run_checkpoint`, macchina del loop, retry `O-COL-006`, git + deploy-coupling | `checkpoint/*`, esecutori del loop, `git/detect_deploy_coupling.*` | fix `verified` set in scope; `mitigated-residual` (`10` §3, criterio 2); git a strati (`10` §4, criterio 7) |
| **M2 — Motore di blueprint** | `11` + `12`: `validate_blueprint`, template, 3 prompt | `blueprint/*`, `assets/prompts/*` | `validate_blueprint` pulito + self-check (`10` §4, criterio 5) |
| **M3 — Characterization & REMEDIATE** | `06`: baseline, partizione guardia/impattate (il DB di test RLS è fornito dal banco M-1) | generatori di characterization | invarianza su reference app (`10` §3, criteri 2–3) |
| **M4 — Convenzioni, threat model, triage** | `07` + `08`: ruleset Semgrep curato, standard RLS, enumerazione, prioritizzazione/FP | `conventions/*`, ruleset vendorizzato | mapping seminati→pattern/RLS/superficie; policy FP (`10` §3, criterio 3) |
| **M5 — Packaging & collaudo finale** | `09` + esecuzione di `10`: `package_skill`, run dei **due parity gate** sul banco M-1, eval di triggering | `package_skill.*`, esiti dei due parity gate, suite di regressione consolidata | entrambi i parity gate verdi = v1 "fatto" (VISION §10) |

`SESSION-STATE` traccia l'avanzamento vivo di queste milestone una volta partita l'implementazione; questo file resta la fonte del **metodo** e della **mappa**.

## 9. Piano richiesto — `O-COL-010`

I Dynamic Workflows (strumento `Workflow`, concorrenza, 1.000 agent/run) girano sui piani che li includono — **Claude Code Max**. *(Aperta `O-COL-010`.)* Default operativo: assunti disponibili per l'implementazione. Se non disponibili/abilitati sul piano, il **fallback** è il loop sequenziale manuale guidato dai 3 prompt di lifecycle (`12`) — disciplina identica, senza parallelizzazione: il metodo regge, cambia solo il throughput.

## 10. Cosa questo file NON copre

- **Non è runtime né BUILD mode** di Trueline (§1); non modifica nessuna decisione di prodotto.
- **Non rimpiazza** `10`: i gate **sono** l'harness di `10`; qui se ne descrive solo il consumo come gate dei task.
- La mappa di milestone (§8) è una **prima passata** di pianificazione, non un lock: si raffina all'avvio dell'implementazione, **ordinata per dipendenze reali**. Due conseguenze concrete: (a) le **fixture di gating di `10`** (reference app con `S1–S8`, DB di test RLS, blueprint seminato, harness di regressione) sono il **prerequisito** del gate di M0–M4 e si costruiscono **prima di M0** (milestone **M-1**), pur essendo *specificate* in `10`; (b) la detection via **Semgrep** di `S6`/`S7` si completa quando il **ruleset curato** di M4 (`07` §4) è pronto, quindi il gate di detection di M0 copre dapprima gli oracoli già completi (gitleaks `S1`/`S2`, RLS checker `S3–S5`, knip `S8`) e si estende a `S6`/`S7` con M4.

## 11. Eredità

- **`10-EVALUATION`** — fornisce l'harness che fa da gate ai task (§6) e i criteri "fatto" delle milestone (§8).
- **`SESSION-STATE`** — traccia l'avanzamento delle milestone in implementazione; referenzia questo file per il metodo.
