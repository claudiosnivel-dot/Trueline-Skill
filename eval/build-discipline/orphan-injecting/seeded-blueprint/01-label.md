# 01-label — Macrotask `formatting`

Task atomici secondo lo schema di `11-BLUEPRINT-ENGINE` §3 (`L-COL-019`).
Identificatori in inglese, prosa in italiano (convenzione `00-INDEX`).

Fixture BD-1 `orphan-injecting`: il blueprint è STRUTTURALMENTE VALIDO (passa
`validate_blueprint`) con `then` OSSERVABILI (passa `ac_observability_check`).
Il difetto vive nel sorgente: un export NUOVO inutilizzato, irraggiungibile
dall'entry knip (specchio di `src/legacy/unused.ts` / S8).

```yaml
- id: T-001
  title: "Formattazione dell'etichetta di una prenotazione"
  macrotask: "formatting"
  depends_on: []

  objective: >
    Esporre dall'entry una funzione che compone l'etichetta leggibile di una
    prenotazione a partire da id e nome cliente.

  definition_of_done:
    - "Funzione formatBookingLabel(id, customer) implementata ed esportata dall'entry"
    - "L'etichetta include sia l'id sia il nome del cliente"

  acceptance_criteria:
    - id: AC-001-1
      given: "un id pari a '42' e un cliente 'Rossi'"
      when: "si chiama formatBookingLabel('42', 'Rossi')"
      then: "la stringa restituita è esattamente '#42 — Rossi'"
    - id: AC-001-2
      given: "un cliente con nome vuoto"
      when: "si chiama formatBookingLabel('7', '')"
      then: "la stringa restituita contiene il prefisso '#7'"

  target_tests:
    - file: "tests/label.test.ts"
      covers: [AC-001-1, AC-001-2]

  out_of_scope:
    - "Localizzazione del separatore per lingua"
```
