# PROMPT-SESSION-START — Trueline (build-time)

> **Cos'è questo file.** Il prompt da incollare **all'inizio di ogni sessione** di implementazione di Trueline (dopo la prima, che usa `PROMPT-PROJECT-START`). Recupera il contesto da `SESSION-STATE.md`, riallinea l'agente alla milestone corrente, e prepara il workflow.
>
> **Da non confondere** con il `session-start.md` che la skill *emette* per l'utente (`12-LIFECYCLE-PROMPTS §2.2`). Questo è **nostro**, per le nostre sessioni di build via Dynamic Workflows.

---

## ▶ Prompt da incollare

```
Riprendiamo l'implementazione di **Trueline**. Il blueprint è chiuso (v1.0): si costruisce,
non si ridiscute il design. Costruiamo con i Dynamic Workflows (DYNAMIC-WORKFLOWS.md).

usa lo strumento Workflow

RECUPERO CONTESTO — leggi PRIMA di qualunque azione, in quest'ordine:
  1. SESSION-STATE.md  → fonte di verità: milestone corrente, task fatti/in corso,
     baseline, budget consumato, stato git, note di carry-over (§6) e promemoria (§7).
  2. DYNAMIC-WORKFLOWS.md → §8 contenuto + GATE della milestone corrente; §2 meccanica;
     §5 model policy; §6 cos'è il gate; §7 ondate & DAG.
  3. I moduli del blueprint IN SCOPE per la milestone corrente (es. M-1 → 10 §2–§3
     (banco/fixture); M0 → 03 + 04; M1 → 01 §4 + 05; M2 → 11 + 12; M3 → 06;
     M4 → 07 + 08; M5 → 09 + 10).
  4. 00-INDEX §4 (ledger) per le invarianti L-COL pertinenti ai task di oggi.

VERIFICA PRECONDIZIONI:
  • O-COL-010: lo strumento `Workflow` è disponibile (Claude Code Max)? Se no, fallback al
    loop sequenziale guidato dai 3 prompt di 12 — stessa disciplina, niente parallelismo.
  • L'HARNESS DI GATE per questa milestone esiste già? (reference app + S1–S8 + detection
    harness di 10 §2–§3, e/o `validate_blueprint`, secondo il dominio dei task). Se manca,
    il primo lavoro della sessione è costruirlo: senza harness non si può gatare nulla.
  • Preflight oracoli necessari ai gate di oggi presenti/installabili (03 §4).

PIANIFICA LA SESSIONE (una milestone = una sessione-workflow):
  • Scomponi la milestone corrente in TASK ATOMICI INDIPENDENTI; per ciascuno scrivi il
    GATE PRIMA del build (test-first, L-COL-019/027): id, dominio (file/modulo del
    blueprint), dipende_da, output, GATE (asserzione automatica), modello builder.
  • Organizza i task in ONDATE secondo il DAG reale (dipende_da). Gli indipendenti girano
    in parallelo (cap min(16, core−2)). Rispetta le dipendenze del blueprint: 04 prima di
    05, 11 prima del self-check, 03 prima del checkpoint.
  • MODEL POLICY (DYNAMIC-WORKFLOWS §5): builder Opus per la logica delicata (loop di 05,
    rls_check di 03 §5.4, fingerprint/dedup, partizione guardia/impattate di 06 §4,
    validate_blueprint di 11, deploy-coupling, normalize+mappa OWASP, intent-resolution);
    builder Sonnet per i wrapper oracoli, i references/modes, i template di prompt,
    boilerplate, preflight, package_skill. VERIFIER SEMPRE OPUS. NIENTE Haiku.
  • Pipeline per task: build → verify(×k) vs il GATE → fix-loop solo su rosso → integrate
    solo sul verde. k=1 di default; k=2 per artefatti critici (loop di 05, rls_check).

INVARIANTI DI BUILD (SESSION-STATE §5) — tienile in testa per OGNI task:
  • Il "verde" di un task è un FATTO di un oracolo/harness, MAI una frase dell'LLM
    (L-COL-002). Il gate è gli oracoli/validate_blueprint/harness di 10, non un DB locale.
  • Scope v1 fermo (JS/TS + Supabase; set verificato = segreti + RLS + dead-code).
  • Lavora su BRANCH, mai su main; nessuna operazione distruttiva autonoma (L-COL-024).
  • Corpo SKILL.md < ~500 righe; pesi in references/ per modalità (L-COL-014).
  • Nessun falso "via libera"; un controllo non eseguito NON è un verde (L-COL-006).

Dopo aver letto SESSION-STATE e la milestone corrente: dichiara in 5–8 righe lo stato, la
milestone di oggi, se l'harness di gate è pronto, e il PIANO DI ONDATE con i task e i loro
gate. Segnala blocchi/incoerenze. Poi attendi il mio "vai" prima di lanciare il workflow.
```

---

## Note operative (non incollare)

- **`usa lo strumento Workflow` è dentro il prompt di proposito:** è l'opt-in esplicito senza cui l'orchestratore reale non parte (`DYNAMIC-WORKFLOWS §1`). Toglilo solo se sei nel fallback sequenziale (O-COL-010 negativo).
- **L'harness prima dei task:** è il prerequisito di build introdotto in `PROMPT-PROJECT-START`. Se è già stato costruito in una sessione precedente, `SESSION-STATE` deve dirlo — verificalo, non darlo per scontato.
- **Resume di un workflow interrotto:** se la sessione precedente ha lasciato un workflow a metà, recupera il `runId` da `SESSION-STATE` e riprendi con `resumeFromRunId` prima di ripianificare da zero.
