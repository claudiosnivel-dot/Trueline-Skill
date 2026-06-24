# 01-validate — Macrotask `validation`

Task atomici secondo lo schema di `11-BLUEPRINT-ENGINE` §3 (`L-COL-019`).
Identificatori in inglese, prosa in italiano (convenzione `00-INDEX`).

Fixture BD-1 `ambiguous-ac`: il blueprint è STRUTTURALMENTE VALIDO — ogni AC
porta id+given+when+then ed è coperto da un target_test, quindi passa
`validate_blueprint` (exit 0). MA il `then` di AC-001-2 contiene un token
VIETATO verbatim ("funziona bene") della lista §6 di self-check-checklist:
non è osservabile, quindi `ac_observability_check` lo FLAGGA (exit 1). I due
oracoli sono ortogonali: struttura valida, osservabilità no.

```yaml
- id: T-001
  title: "Validazione del formato di una email"
  macrotask: "validation"
  depends_on: []

  objective: >
    Esporre dall'entry una funzione che stabilisce se una stringa ha la forma
    minima di un indirizzo email.

  definition_of_done:
    - "Funzione isValidEmail(value) implementata ed esportata dall'entry"
    - "Restituisce un booleano"

  acceptance_criteria:
    - id: AC-001-1
      given: "la stringa 'a@b.co'"
      when: "si chiama isValidEmail('a@b.co')"
      then: "il valore restituito è esattamente true"
    - id: AC-001-2
      given: "una stringa qualunque in input"
      when: "si chiama isValidEmail con quella stringa"
      then: "la validazione funziona bene per ogni input plausibile"

  target_tests:
    - file: "tests/email.test.ts"
      covers: [AC-001-1, AC-001-2]

  out_of_scope:
    - "Conformità completa a RFC 5322"
```
