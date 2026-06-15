# eval/ — Banco di Prova M-1

Questa directory contiene il **banco di prova M-1** per la skill TRUELINE.

> **Attenzione**: il contenuto di `eval/` **NON viene spedito** nel pacchetto `.skill` finale.
> Serve esclusivamente per sviluppo, testing e validazione locale della skill.

## Struttura

| Directory | Descrizione |
|---|---|
| `reference-app/` | Applicazione JS/TS+Supabase vulnerabile, usata come target di valutazione. **Repository git indipendente** (ha la sua storia git separata). |
| `seeded-blueprint/` | Blueprint seminato di piccole dimensioni, valido, usato come fixture di test. |
| `harness/` | Runner di valutazione (`run_eval.mjs`) e registro dei risultati attesi (`expected/`). |
| `db-test/` | Configurazione Supabase locale, script di inizializzazione e nota di degradazione. |

## Note importanti

- `eval/reference-app/` è un **repo git indipendente** con la propria storia.
  Il repo esterno (root) lo **gitignora** tramite `.gitignore`, quindi i commit
  della reference app non appaiono nella storia del workspace principale.

- I difetti seminati (S1–S8) sono marcati con commenti `SEED:Sn` nel codice
  della reference app e nello schema del database.

- L'harness (`eval/harness/run_eval.mjs`) è Node ESM puro: usa **solo moduli
  built-in** (`fs`, `path`, `child_process`) e non richiede `npm install`.
