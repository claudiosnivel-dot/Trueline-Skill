# PROMPT-SESSION-END — Trueline (build-time)

> **Cos'è questo file.** Il prompt da incollare **alla chiusura di ogni sessione** di implementazione di Trueline. Consolida ciò che è stato costruito, aggiorna `SESSION-STATE.md` (così la sessione successiva riprende senza perdere contesto), e lascia il repo in uno stato pulito e riprendibile.
>
> **Da non confondere** con il `session-end.md` che la skill *emette* per l'utente (`12-LIFECYCLE-PROMPTS §2.3`). Questo è **nostro**, per le nostre sessioni di build.

---

## ▶ Prompt da incollare

```
Chiudiamo la sessione di implementazione di Trueline. Niente nuovo lavoro: consolida,
registra, lascia tutto riprendibile. Il "fatto" si dichiara per FATTI verificati, mai a
sensazione (L-COL-006).

1) RIEPILOGO DELLA SESSIONE
   • Milestone su cui abbiamo lavorato e suo stato (DYNAMIC-WORKFLOWS §8).
   • Per ogni task/ondata: GATE PASSATO? Il verde è un esito di oracolo/harness
     (validate_blueprint / oracoli su S1–S8 / harness di 10), NON una frase dell'LLM
     (L-COL-002). Elenca: task verdi-e-integrati, task rossi/aperti, e perché.
   • Cosa NON è stato gatato e perché (harness mancante, dipendenza non pronta): dichiaralo,
     non spacciarlo per fatto.

2) AGGIORNA SESSION-STATE.md (è la fonte di verità — l'unico modo di passare contesto)
   • Avanzamento milestone M-1…M5: fatte / in corso / da fare.
   • Task: id, output prodotto, stato del gate, dove vive l'artefatto nell'albero spedito
     (scripts/ · references/ · assets/, vedi 02 §4).
   • Baseline e budget: budget O-COL-006 consumato; se siamo a M5, stato della taratura
     numerica del budget (10 §6) → quando pinnato, va in references/oracles/thresholds.md.
   • Stato git: branch di lavoro, commit (con ID task + esito gate), stato del merge su
     main, e la nota di deploy-coupling se rilevante (05 §8.3).
   • Workflow: se un workflow è rimasto a metà, registra il runId per il resume.
   • Carry-over (§6) e promemoria (§7): aggiorna o aggiungi le note per la prossima
     sessione (prossima milestone, task bloccati, prerequisiti da soddisfare).

3) DECISIONI
   • Il blueprint è chiuso: NON cambiare decisioni in silenzio. Se l'implementazione ha
     rivelato la necessità di un cambio reale, registralo come EMENDAMENTO esplicito nel
     ledger di 00-INDEX (con nota), citando l'ID L-COL/O-COL toccato; altrimenti annota la
     questione come aperta per discussione, senza modificare il design.
   • Se O-COL-010 si è chiarita (Workflow disponibile/non disponibile sul piano),
     registralo.

4) FRAMING ONESTO (L-COL-006)
   • Usa "costruito e verificato X" / "il gate Y è passato"; MAI "Trueline è pronto/sicuro"
     senza l'esito dei due parity gate (VISION §10). v1 è "fatto" solo quando ENTRAMBI i
     parity gate (verifica + build) sono verdi sull'harness di 10.

5) STATO RIPRENDIBILE
   • Commit/branch puliti; niente lavoro a metà non registrato in SESSION-STATE.
   • Conferma che la prossima sessione possa aprirsi con PROMPT-SESSION-START e ripartire
     dalla milestone corrente senza ricostruire contesto a memoria.

Produci: (a) il riepilogo dei punti 1 e 4, e (b) il DIFF preciso che applicherai a
SESSION-STATE.md. Applicalo solo dopo che lo confermo.
```

---

## Note operative (non incollare)

- **Perché chiede conferma sul diff di `SESSION-STATE`:** è l'unica fonte di verità tra sessioni; un aggiornamento sbagliato o ottimistico avvelena la sessione successiva. Meglio rivederlo prima di scrivere.
- **Il "verde" va sempre tracciato all'oracolo:** in `SESSION-STATE` registra *quale* gate ha prodotto il verde (es. "detection S1–S8 ok sull'harness 10 §3", "validate_blueprint pulito su blueprint seminato"), non un generico "task completato".
- **Chiusura del v1:** la dichiarazione di completamento appartiene a M5, quando entrambi i parity gate passano (`10 §9`, `VISION §10`). Fino ad allora ogni "fine sessione" è un checkpoint di avanzamento, non un "fatto".
