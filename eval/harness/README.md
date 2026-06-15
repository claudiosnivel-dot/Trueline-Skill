# Harness di regressione/detection (`eval/harness`)

Questo e lo **scheletro dell'harness** del banco di prova di Trueline
(`10-EVALUATION` §5). E il pezzo che **tutte le milestone successive consumano
come gate dei task** (`DYNAMIC-WORKFLOWS` §6): il "verde" di un task di
implementazione e un **fatto deterministico** prodotto facendo girare questo
harness sulla reference app + sul blueprint seminato, non una frase dell'LLM
(`L-COL-002`).

Runtime: **Node ESM**, **solo moduli built-in** (`fs`, `path`, `child_process`,
`url`). Nessun `npm install`, nessuna dipendenza di rete.

## File

| File | Ruolo |
|---|---|
| `expected/registry.json` | Registro dei difetti attesi `S1..S8`: per ognuno `id`, `category`, `source_oracle`, `owasp`, `expected_fix_state`, `anchor`, `scan_scope`, `notes`. I valori rispecchiano `10` §2 / `04` §3 / `03` §5. |
| `run_eval.mjs` | L'harness vero e proprio. |
| `validate_blueprint.mjs` | Oracolo strutturale del blueprint (`11` §5.1, gate T-1.3). Riusato da `run_eval.mjs`. |

## Cosa fa OGGI (M-1) — auto-gate "present & inspectable"

In M-1 l'harness **non** esegue gli oracoli reali. Fa l'auto-gate del banco:
verifica con controlli **deterministici built-in** che ogni difetto seminato sia
**presente e ispezionabile** (non che sia gia corretto), e che il blueprint
seminato sia strutturalmente valido.

Controlli per difetto (dispatch su `id`/`scan_scope`):

| Difetto | Categoria | Scope | Controllo M-1 |
|---|---|---|---|
| S1 | `secret` | `working-tree` | anchor-grep `SEED:S1` in `src/lib/config.ts` |
| S2 | `secret` | `history` | `git -C reference-app log -p -- src/legacy/credentials.ts`: add-then-remove + working tree pulito |
| S3 | `rls` | `static-ddl` | la migration crea `public.audit_logs` **senza** `ENABLE ROW LEVEL SECURITY` |
| S4 | `rls` | `static-ddl` | la migration contiene una policy con `USING (true)` |
| S5 | `rls` | `dynamic-db` | la policy di `public.invoices` **non** referenzia `auth.uid()` ne `tenant_id` (ispezione statica della DDL in M-1) |
| S6 | `injection` | `working-tree` | anchor-grep `SEED:S6` in `src/db.ts` |
| S7 | `authz` | `working-tree` | anchor-grep `SEED:S7` in `src/routes/bookings.ts` |
| S8 | `dead-code` | `working-tree` | anchor-grep `SEED:S8` in `src/legacy/unused.ts` |

Blueprint: invoca `validate_blueprint.mjs` su `eval/seeded-blueprint` come
processo figlio (riuso della logica T-1.3); l'esito e `exit 0`.

**Nota S1 vs S2.** I due segreti hanno valori **diversi**. S1 vive nel
**working tree** (scope BUILD, `03` §5.2): rimuovere il literal rende la
riesecuzione pulita -> `verified`. S2 vive **solo nella history** (scope
REMEDIATE): la rimozione e una riscrittura distruttiva (gate umano,
`L-COL-024`) -> `mitigated-residual`, **non** `verified` (`04` §5). Il registry
documenta questa distinzione (`expected_fix_state`, `scan_scope`).

Esito: stampa il report `S1..S8` OK/FAIL + blueprint OK/FAIL ed esce con
**codice 0 solo se tutto** e present+inspectable, altrimenti **exit 1**.

### Esecuzione

```sh
node eval/harness/run_eval.mjs
echo EXIT=$?
```

## Cosa FARA (M0+) — gli oracoli reali e i due parity gate

Gli anchor-check di M-1 sono uno **scheletro dichiaratamente parziale**. Gli
hook sono marcati nel sorgente:

- `// TODO M0:` — sostituire ogni anchor-check con l'esecuzione del **vero
  oracolo** (gitleaks per S1/S2, Semgrep per S6/S7, RLS checker per S3-S5, knip
  per S8), normalizzato nel **finding model** (`04`), per asserire la
  **detection** (`10` §3, criterio 1). S5 passa al controllo comportamentale sul
  **DB di test** (`rls-check [DB-test]`), con degradazione dichiarata al checker
  statico se il DB non e disponibile (`06` §6.1).
- `// TODO M3:` — aggiungere le asserzioni del **gate di verifica** (`10` §3,
  criteri 1-4) in REMEDIATE: detection da oracolo; set in scope a
  `verified` e S2 a `mitigated-residual`; detection-only (S6/S7) trovate ma non
  auto-fixate e report mai "sicuro"; budget pinnato `O-COL-006`.
- `// TODO M5:` — aggiungere le asserzioni del **gate di build** (`10` §4,
  criteri 5-7) sul blueprint seminato: `validate_blueprint` + self-check;
  checkpoint a 4 controlli; git a strati / fail-safe deploy-coupling. M5 esegue
  i **due parity gate** completi -> v1 "fatto" (VISION §10).

## Come i workflow lo chiamano come gate dei task

`DYNAMIC-WORKFLOWS` §6: il gate di un task di implementazione **non** e "DB
locale" — e *far girare gli oracoli / `validate_blueprint` / questo harness*
sulla reference app (`10` §5). A seconda del dominio del task:

- task su uno **script-oracolo** -> il gate e l'esito atteso dell'oracolo sui
  difetti seminati `S1..S8` (questo registry);
- task sul **loop** (`05`) -> il gate e che il set in scope raggiunga
  `verified` e il segreto-in-history resti `mitigated-residual`;
- task sul **motore di blueprint** (`11`) -> il gate e `validate_blueprint`
  pulito + self-check sul blueprint seminato.

Cosi i Dynamic Workflows ereditano `L-COL-002` per costruzione: `10` definisce i
gate, il workflow li **consuma**.
