# INDEX
```yaml
architecture:
  layers:
    ui: "src/ui/**"
    data: "src/data/**"
  forbidden:
    - { from: ui, to: data }
```
- id: T-1
  macrotask: m
  objective: o
  definition_of_done: [d]
  acceptance_criteria:
    - id: AC-1
      given: g
      when: w
      then: t
  target_tests:
    - file: t.test.ts
      covers: [AC-1]
