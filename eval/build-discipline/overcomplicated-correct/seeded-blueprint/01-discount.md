# 01-discount — Macrotask `pricing`

Task atomici secondo lo schema di `11-BLUEPRINT-ENGINE` §3 (`L-COL-019`).
Identificatori in inglese, prosa in italiano (convenzione `00-INDEX`).

Fixture BD-1 `overcomplicated-correct`: il blueprint è STRUTTURALMENTE VALIDO
(passa `validate_blueprint`) e i suoi `then` sono OSSERVABILI (passa
`ac_observability_check`, nessun token vietato). La sovra-astrazione vive nel
sorgente della reference-app, non nel blueprint.

```yaml
- id: T-001
  title: "Calcolo dello sconto percentuale su un totale"
  macrotask: "pricing"
  depends_on: []

  objective: >
    Esporre una funzione che, dato un totale e una percentuale di sconto,
    restituisce il totale scontato, validando gli intervalli di input.

  definition_of_done:
    - "Funzione applyDiscount(total, percent) implementata ed esportata dall'entry"
    - "Percentuale fuori dall'intervallo 0..100 rifiutata con errore"
    - "Totale negativo rifiutato con errore"

  acceptance_criteria:
    - id: AC-001-1
      given: "un totale di 200 e uno sconto del 10 percento"
      when: "si chiama applyDiscount(200, 10)"
      then: "il valore restituito è esattamente 180"
    - id: AC-001-2
      given: "una percentuale di sconto pari a 150"
      when: "si chiama applyDiscount(200, 150)"
      then: "viene sollevato un Error con messaggio che contiene 'percent'"
    - id: AC-001-3
      given: "un totale negativo pari a -5"
      when: "si chiama applyDiscount(-5, 10)"
      then: "viene sollevato un Error con messaggio che contiene 'total'"

  target_tests:
    - file: "tests/discount.test.ts"
      covers: [AC-001-1, AC-001-2, AC-001-3]

  out_of_scope:
    - "Sconti a scaglioni o cumulativi"
```
