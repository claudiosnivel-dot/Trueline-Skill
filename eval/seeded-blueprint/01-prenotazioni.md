# 01-prenotazioni — Macrotask `prenotazioni`

Task atomici secondo lo schema di `11-BLUEPRINT-ENGINE` §3 (`L-COL-019`).
Identificatori in inglese, prosa in italiano (convenzione `00-INDEX`).

```yaml
- id: T-001
  title: "Schema table bookings con RLS abilitato"
  macrotask: "prenotazioni"
  depends_on: []

  objective: >
    Creare la table `bookings` multi-tenant con una migration che abilita
    Row Level Security e definisce una policy che isola le righe per tenant
    dell'utente autenticato.

  definition_of_done:
    - "Migration che crea la table bookings con colonne id, tenant_id, user_id, slot, created_at"
    - "ENABLE ROW LEVEL SECURITY applicato sulla table bookings"
    - "Policy di SELECT/INSERT che vincola tenant_id all'utente autenticato (auth.uid())"

  acceptance_criteria:
    - id: AC-001-1
      given: "la migration è applicata sul DB di test"
      when: "si interroga il catalogo pg per la table bookings"
      then: "row level security risulta abilitata (relrowsecurity = true)"
    - id: AC-001-2
      given: "esiste almeno una policy sulla table bookings"
      when: "si ispeziona la definizione della policy"
      then: "la clausola USING fa riferimento ad auth.uid()/tenant_id, non a true"

  target_tests:
    - file: "tests/bookings.schema.test.ts"
      covers: [AC-001-1, AC-001-2]

  security_notes:
    - "RLS isolation per tenant — categoria killer Supabase (07 §5)"
    - "Nessuna policy USING (true): isolamento reale, non finto"

  out_of_scope:
    - "Indici di performance sulla table bookings"

- id: T-002
  title: "Endpoint POST /bookings con authz e tenant_id server-side"
  macrotask: "prenotazioni"
  depends_on: [T-001]

  objective: >
    Esporre un endpoint che crea una prenotazione per l'utente autenticato,
    impostando tenant_id lato server e rifiutando le richieste non autenticate
    o con payload invalido.

  definition_of_done:
    - "Endpoint POST /bookings implementato"
    - "Check di identità/ruolo eseguito prima di ogni scrittura (no route mutante anonima)"
    - "tenant_id derivato dalla sessione server, mai dal client"
    - "Input validato lato server (no fiducia nel client)"

  acceptance_criteria:
    - id: AC-002-1
      given: "utente autenticato del tenant A"
      when: "crea una prenotazione valida"
      then: "la riga è scritta con tenant_id = A derivato dalla sessione"
    - id: AC-002-2
      given: "richiesta senza sessione/identità valida"
      when: "chiama POST /bookings"
      then: "riceve 401, nessuna scrittura"
    - id: AC-002-3
      given: "payload privo del campo slot obbligatorio"
      when: "chiama POST /bookings"
      then: "riceve 400, nessuna scrittura"

  target_tests:
    - file: "tests/bookings.create.test.ts"
      covers: [AC-002-1, AC-002-2]
    - file: "tests/bookings.validation.test.ts"
      covers: [AC-002-3]

  security_notes:
    - "Route mutante con check di identità obbligatorio (07 §4.3, A01)"
    - "tenant_id server-side: il client non sceglie il proprio tenant"
    - "Nessun segreto hardcoded nel codice dell'endpoint (07 §4.1)"

  out_of_scope:
    - "Modifica prenotazione (futuro task PUT)"

- id: T-003
  title: "Endpoint GET /bookings isolato per tenant"
  macrotask: "prenotazioni"
  depends_on: [T-002]

  objective: >
    Esporre la lettura delle prenotazioni dell'utente autenticato, garantendo
    che la RLS impedisca di vedere prenotazioni di altri tenant.

  definition_of_done:
    - "Endpoint GET /bookings implementato"
    - "La query si appoggia alla RLS della table bookings per l'isolamento"

  acceptance_criteria:
    - id: AC-003-1
      given: "utente autenticato del tenant A con prenotazioni proprie"
      when: "chiama GET /bookings"
      then: "riceve solo le prenotazioni del tenant A"
    - id: AC-003-2
      given: "utente del tenant A"
      when: "tenta di leggere prenotazioni del tenant B"
      then: "riceve insieme vuoto (RLS blocca)"

  target_tests:
    - file: "tests/bookings.read.test.ts"
      covers: [AC-003-1, AC-003-2]

  out_of_scope:
    - "Paginazione e filtri avanzati"
```
