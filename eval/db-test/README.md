# eval/db-test — DB di test RLS per il banco di prova M-1

## Scopo

Questa directory contiene la configurazione e gli script per avviare un'istanza
**Supabase locale** usata come DB di test per il banco di prova M-1 di Trueline.

Il DB di test **rende esercitabile RLS a runtime**: le migration della reference
app (`eval/reference-app/supabase/migrations/`) vengono applicate su un'istanza
locale, permettendo di eseguire query reali contro le policy RLS seminate.

---

## Cosa copre a runtime

| Difetto seminato | Verifica runtime abilitata dal DB di test |
|---|---|
| **S5** — `invoices` multi-tenant senza `auth.uid()`/`tenant_id` | Unico difetto RLS rilevabile **solo** a runtime: un checker statico vede la policy ma non puo eseguire la query come tenant A e verificare che veda le righe del tenant B. Questo e il caso canonico che richiede il DB di test. |
| **S3** — `audit_logs` senza RLS abilitato | Verificabile staticamente dall'RLS checker, ma il DB di test consente anche di eseguire una query diretta come utente anonimo e osservare l'accesso non filtrato (verifica comportamentale di contrasto). |
| **S4** — `documents` con `USING (true)` | Verificabile staticamente, ma il DB di test permette di eseguire SELECT come utente A e constatare che le righe di tutti gli altri utenti sono accessibili (isolamento finto verificato empiricamente). |

---

## NOTA DI DEGRADAZIONE DICHIARATA

*Rif. 06-CHARACTERIZATION-TESTS §6.1 — 10-EVALUATION §2*

**Se Docker o supabase-CLI non sono disponibili nell'ambiente di esecuzione,
i controlli RLS che richiedono il DB di test DEGRADANO al checker statico.**

Questo comportamento e deliberato e dichiarato:

- Il checker statico (`03-ORACLES §5.4`) analizza le policy SQL dalla migration
  e rileva S3, S4 senza eseguire query. Quei finding vengono comunque prodotti.
- S5 (verifica multi-tenant) **non puo essere rilevato con piena affidabilita**
  dal solo checker statico, perche richiede di eseguire la query come un tenant
  specifico. In assenza di DB di test, l'RLS checker lo segnala come
  **sospetto** (nessun riferimento a `auth.uid()` o `tenant_id` nella policy)
  ma non puo produrre un finding comportamentale verificato.
- La skill **dichiara esplicitamente** il confine in ogni report prodotto senza
  DB di test: `"comportamento RLS non caratterizzato a runtime; checker statico usato"`.
- **Non viene mai emesso un falso verde.** Se il DB di test non e disponibile,
  il controllo degrada e lo stato e dichiarato — mai assunto sicuro.
  *(L-COL-006: nessun falso "via libera")*

---

## Contenuto della directory

| File | Descrizione |
|---|---|
| `config.toml` | Configurazione Supabase locale minimale. Referenzia le migration in `../reference-app/supabase/migrations`. |
| `up.sh` | Script di avvio per Linux/macOS/WSL. Per uso futuro (M0/M3) — non eseguito in M-1. |
| `up.ps1` | Script di avvio per Windows PowerShell. Per uso futuro (M0/M3) — non eseguito in M-1. |
| `README.md` | Questo file. |

---

## Come avviare il DB di test (uso futuro — M0/M3)

**Prerequisiti:**
- Docker Desktop in esecuzione
- Node.js e npm (per l'installazione di supabase-CLI)

**Linux/macOS/WSL:**
```bash
bash eval/db-test/up.sh
```

**Windows (PowerShell):**
```powershell
.\eval\db-test\up.ps1
```

Gli script installano supabase-CLI se mancante, avviano l'istanza locale e
applicano le migration dalla reference app.

**Per fermare l'istanza:**
```bash
supabase stop --workdir eval/db-test
```

---

## Struttura migration

Le migration si trovano in:
```
eval/reference-app/supabase/migrations/
  0001_init.sql   — schema iniziale con i difetti seminati S3, S4, S5
```

Il file `config.toml` di questa directory referenzia il path relativo
`../reference-app/supabase/migrations` come sorgente delle migration.

---

## Relazione con gli oracoli

Il DB di test e la risorsa che abilita la modalita **introspection** dell'RLS
checker (`03-ORACLES §5.4`): read-only su un'istanza non-prod, locale,
nulla esce dall'ambiente dell'utente (`L-COL-013` — privacy per architettura).

In assenza del DB di test, la batteria di oracoli si riduce al **checker
statico** per i finding RLS, con i limiti dichiarati sopra.
