# 00-INDEX — Blueprint Seminato (prenotazioni)

| | |
|---|---|
| **Progetto** | Reference App — modulo *prenotazioni* (fixture eval) |
| **Ecosistema** | JS/TS + Supabase (scope v1) |
| **Ruolo** | Blueprint SEMINATO e VALIDO per il **gate di build** (`10` §4, criterio 5) |
| **Schema task** | `11-BLUEPRINT-ENGINE` §3 (`L-COL-019`) |

---

## 1. Perché questo blueprint esiste

È una **fixture deterministica** del banco di prova M-1: un blueprint piccolo ma
**strutturalmente corretto**, i cui task atomici portano **tutti** i tre campi
obbligatori (`definition_of_done` + `acceptance_criteria` + `target_tests`,
cardine `L-COL-019`). Serve a provare il gate di build: deve passare un futuro
`validate_blueprint` (strutturale, `11` §5.1) e la checklist di self-check
(semantica, `11` §5.2).

Non è il piano di un progetto reale: è il **minimo rappresentativo** che esercita
lo schema, incluse le dipendenze fra task (DAG) e l'aggancio al threat model
(`07`) su almeno un task che tocca RLS/auth.

## 2. Mappa dei moduli

| File | Macrotask | Contenuto |
|---|---|---|
| `01-prenotazioni.md` | `prenotazioni` | 3 task atomici in YAML secondo `11` §3: schema tabella, endpoint di creazione con RLS, lettura isolata per tenant. |

## 3. Grafo delle dipendenze (DAG)

```
T-001  (schema + RLS abilitato)
  └──> T-002  (POST /bookings con check authz + tenant_id)
         └──> T-003  (GET /bookings isolato per tenant)
```

DAG aciclico; nessun `depends_on` verso `id` inesistenti. Tutti i task
appartengono al macrotask `prenotazioni`.

## 4. Aggancio alla sicurezza (`07`)

`T-001` e `T-002` toccano dati/auth e portano `security_notes` pertinenti
(RLS isolation per tenant, nessun segreto nel sorgente, check di identità sulla
route mutante). È la baseline di sicurezza richiesta da `11` §5.2 punto 9 per
l'ecosistema v1 (Supabase).

## 5. Self-check strutturale

La validazione meccanica (campi obbligatori, linkage criteri→test, DAG, ID
unici, appartenenza al macrotask) è eseguita dal gate del task T-1.3. Esito
atteso: tutti i controlli **OK**.
