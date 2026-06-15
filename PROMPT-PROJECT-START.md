# PROMPT-PROJECT-START — Trueline (build-time)

> **Cos'è questo file.** Il prompt da incollare **una volta**, all'avvio dell'implementazione di Trueline, in una sessione Claude Code su **Opus 4.8**. Orienta l'agente al blueprint chiuso, al metodo dei Dynamic Workflows e alle invarianti che reggono *la nostra costruzione*.
>
> **Da non confondere** con i 3 prompt che la skill *emette* in BOOTSTRAP per l'utente finale (`12-LIFECYCLE-PROMPTS.md`, → `assets/prompts/`). Quelli sono un **output del prodotto**; questi tre (`PROMPT-PROJECT-START` · `PROMPT-SESSION-START` · `PROMPT-SESSION-END`) sono **nostri**, per le sessioni con cui *costruiamo* Trueline. Stesso vocabolario ("build", "macrotask", "checkpoint"), piani diversi — la stessa distinzione con cui il blueprint tiene separate le due `SESSION-STATE` (`DYNAMIC-WORKFLOWS §1`, `11 §4`).

---

## ▶ Prompt da incollare

```
Stai per implementare **Trueline**: una Agent Skill (standard SKILL.md) che dà a un
agente di coding la disciplina blueprint-first di build-e-verifica oracle-first. Il
BLUEPRINT È CHIUSO a v1.0: da qui si scrive codice, non si ridiscute il design.

PRIMA DI TUTTO — leggi, in quest'ordine:
  1. SESSION-STATE.md  → è l'UNICA fonte di verità sullo stato vivo. In implementazione
     traccia anche l'avanzamento delle milestone (vedi §7 "Avvio implementazione").
  2. 00-INDEX.md       → manifest dei file, piano di build, e il DECISION LEDGER
     (L-COL-001…028 locked, O-COL-005/010 open). Le decisioni si modificano SOLO con un
     emendamento esplicito registrato nel ledger, mai in silenzio.
  3. DYNAMIC-WORKFLOWS.md → il METODO con cui costruiamo: §2 meccanica (plan→distribute→
     verify→integrate), §5 model policy, §6 definizione di gate, §8 mappa di milestone
     M-1…M5, §9 prerequisito di piano (O-COL-010).
  4. VISION-AND-CONSTRAINTS.md §6, §7, §10 → asimmetria onesta, principi, definizione di
     "fatto" (i due parity gate).

COME COSTRUIAMO — Dynamic Workflows (L-COL-027):
  • L'orchestratore è QUESTA sessione su Opus 4.8. Lo strumento `Workflow` parte SOLO con
    opt-in esplicito: ogni sessione di build si apre dicendo letteralmente "usa lo
    strumento Workflow". Senza opt-in, NON simulare l'orchestratore con subagent singoli.
  • Una milestone = una sessione-workflow (DYNAMIC-WORKFLOWS §8). Si parte da M0.
  • DOGFOODING (L-COL-019 applicato a noi): ogni task atomico nasce con il SUO GATE
    SCRITTO PRIMA del build (test-first). "done" = il gate passa + integrato.
  • IL GATE NON È "DB locale": è far girare gli oracoli / `validate_blueprint` / l'harness
    di 10-EVALUATION sulla reference app (DYNAMIC-WORKFLOWS §6, 10 §5). Il "verde" di un
    task è un FATTO di un oracolo, mai una frase dell'LLM → i workflow ereditano L-COL-002.
  • MODEL POLICY (DYNAMIC-WORKFLOWS §5): verifier SEMPRE Opus; orchestratore Opus; builder
    Opus per la logica delicata di Trueline / Sonnet per i task meccanici; NIENTE Haiku.
  • Concorrenza min(16, core−2)/workflow, 1.000 agent/run: partire scoped, monitorare
    l'usage.

PREREQUISITO DI BUILD (milestone M-1) — l'harness di gate deve esistere prima di poter
  gatare i task. Il primo lavoro è il BANCO DI PROVA M-1 (DYNAMIC-WORKFLOWS §8): reference
  app con i difetti seminati S1–S8, DB di test RLS, blueprint seminato, harness di
  detection/regressione (10 §2–§3). È il gate di TUTTE le milestone successive: senza, M0
  non ha contro cosa verificarsi. Nota: la detection via Semgrep di S6/S7 si completa con
  il ruleset di M4 (DYNAMIC-WORKFLOWS §10). Conferma l'ordine M-1 → M0 → … → M5 prima di
  lanciare il primo workflow.

DA CONFERMARE PRIMA DEL PRIMO WORKFLOW:
  • O-COL-010 — i Dynamic Workflows girano su Claude Code Max. Se lo strumento `Workflow`
    NON è disponibile/abilitato, il fallback è il loop sequenziale manuale guidato dai 3
    prompt di lifecycle (12): stessa disciplina, niente parallelizzazione.
  • Preflight oracoli: semgrep, gitleaks, osv-scanner, knip (+ ts-prune/depcheck fallback)
    presenti o installabili (03 §4). `rls_check` lo costruiamo noi.

INVARIANTI NON NEGOZIABILI (valgono anche per il nostro build — SESSION-STATE §5):
  • Oracle-as-judge, mai LLM-as-judge (L-COL-002): solo l'oracolo/harness porta un task a
    "verde". Vale anche per i gate dei workflow.
  • Scope v1 FERMO: JS/TS su Supabase; set verificato-a-zero = segreti + RLS + rimozione
    dead-code; detection-only per il resto; REMEDIATE = remediation piena ma non
    "verificata-a-zero". Non allargare lo scope in implementazione.
  • Corpo SKILL.md < ~500 righe; pesi in references/ per modalità attiva (L-COL-014).
    name: trueline, dir radice trueline/. Tag decisioni: COL.
  • Git a strati: branch autonomo, merge su main gated dal verde, distruttive mai
    autonome, deploy non supervisionato bloccato (L-COL-024/025).
  • Nessun falso "via libera"; coverage declaration sempre presente (L-COL-006).
  • Rispetta il DAG del blueprint: finding model (04) prima del loop (05); schema del task
    (11) prima del self-check; oracoli (03) prima del checkpoint.

CONTESTO TRA SESSIONI:
  • A fine sessione AGGIORNA SESSION-STATE.md (milestone, task fatti/in corso, baseline,
    budget consumato, stato git, carry-over) usando PROMPT-SESSION-END.
  • A inizio di ogni sessione successiva, apri con PROMPT-SESSION-START (che rilegge
    SESSION-STATE e riprende dalla milestone corrente).

Conferma di aver letto i quattro file sopra, riepiloga in 5 righe stato + prossima
milestone + prerequisito harness, segnala qualunque incoerenza residua, e ATTENDI il mio
"vai" prima di scrivere codice o lanciare il primo workflow.
```

---

## Note operative (non incollare)

- **Quando usarlo:** una sola volta, alla prima sessione di implementazione. Le sessioni successive usano `PROMPT-SESSION-START`.
- **Perché chiede di attendere "vai":** l'avvio di un workflow consuma usage in modo significativo (`DYNAMIC-WORKFLOWS §2`) e dipende da O-COL-010 — meglio confermare stato e prerequisiti prima.
- **Se O-COL-010 è negativo:** non lanciare `Workflow`; segui il loop sequenziale dei 3 prompt di `12`, costruendo un task atomico alla volta con il suo gate scritto prima.
