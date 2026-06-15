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
| `run_eval.mjs` | L'harness vero e proprio. Due modalita: `--mode=present` (M-1) e `--mode=detection` (M0). |
| `validate_blueprint.mjs` | Oracolo strutturale del blueprint (`11` §5.1, gate T-1.3). Riusato da `run_eval.mjs`. |

## Modalita

| Modalita | Flag | Cosa asserisce | Oracoli |
|---|---|---|---|
| **present** (default) | `--mode=present` o nessun flag | ogni difetto `S1..S8` e **presente & ispezionabile** + blueprint valido (M-1) | nessuno (controlli built-in) |
| **detection** | `--mode=detection` | ogni difetto in **scope-M0** (`S1,S2,S3,S4,S5,S8`) e **DETECTED** come finding dall'oracolo atteso (`10` §3, criterio 1) | gitleaks, rls_check, knip (NIENTE docker) |

## Modalita present (M-1) — auto-gate "present & inspectable"

In `--mode=present` (default) l'harness **non** esegue gli oracoli reali. Fa
l'auto-gate del banco: verifica con controlli **deterministici built-in** che
ogni difetto seminato sia **presente e ispezionabile** (non che sia gia
corretto), e che il blueprint seminato sia strutturalmente valido. E' la
modalita storica M-1: resta verde e invariata.

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

## Modalita detection (M0) — il difetto e finding DA ORACOLO

In `--mode=detection` l'harness **esegue gli oracoli reali** e per ogni difetto
in **scope-M0** normalizza l'output nativo nel **finding model** (`04`,
`trueline/scripts/findings/normalize.mjs`) e **asserisce** che esista un finding
con la `category` e il `source_oracle` attesi dal registry (`10` §3, criterio 1,
parziale per §10b). E' il "verde" come **fatto deterministico** (`L-COL-002`): il
difetto non e validato da ispezione LLM, ma dall'oracolo che lo emette. Ogni
finding e inoltre validato contro lo schema (`validate_finding.mjs`): un finding
malformato a monte e un FAIL, mai un falso via libera.

| Difetto | Oracolo (reale) | scope | Match atteso |
|---|---|---|---|
| S1 | `run_gitleaks.mjs eval/reference-app working-tree` | working-tree | `category=secret`, `source_oracle.oracle=gitleaks`, file `src/lib/config.ts` |
| S2 | `run_gitleaks.mjs eval/reference-app history` | history (commit `386f02b`) | `category=secret`, `gitleaks`, file `src/legacy/credentials.ts` |
| S3 | `rls_check.mjs .../migrations` | static-ddl | `category=rls`, `rls-check`, `RLS001_MISSING_RLS` su `public.audit_logs` |
| S4 | `rls_check.mjs` (stessa run) | static-ddl | `category=rls`, `rls-check`, `RLS003_PERMISSIVE_TRUE` su `documents_read_all` |
| S5 | `rls_check.mjs` (stessa run) | static-ddl (euristica) | `category=rls`, `rls-check`, `RLS004_MISSING_TENANT_PREDICATE` su `invoices_visible_when_not_draft` |
| S8 | `run_deadcode.mjs eval/reference-app` | working-tree | `category=dead-code`, `knip`, file `src/legacy/unused.ts` |
| S6, S7 | — | — | **DEFERRED M4** (Semgrep, ruleset curato `07` §4; NIENTE docker nel gate) |

I segreti restano **redatti** in tutto il percorso (gitleaks `--redact` + evidence
costruita dall'adapter): il valore non esce mai. La run di `rls_check` e
**condivisa** fra S3/S4/S5 (un'unica esecuzione, cache). `run_id`/`created_at`
sono **fissi** (riproducibilita del gate).

Esito: `exit 0` **solo se** ogni difetto in scope-M0 e DETECTED dall'oracolo
atteso; altrimenti `exit 1`.

### Esecuzione (detection)

```sh
export PATH="$PATH:/c/Users/claud/go/bin"   # gitleaks/osv non sono sul PATH
node eval/harness/run_eval.mjs --mode=detection
echo EXIT=$?
```

**Nota S1 vs S2.** I due segreti hanno valori **diversi**. S1 vive nel
**working tree** (scope BUILD, `03` §5.2): rimuovere il literal rende la
riesecuzione pulita -> `verified`. S2 vive **solo nella history** (scope
REMEDIATE): la rimozione e una riscrittura distruttiva (gate umano,
`L-COL-024`) -> `mitigated-residual`, **non** `verified` (`04` §5). Il registry
documenta questa distinzione (`expected_fix_state`, `scan_scope`).

Esito: stampa il report `S1..S8` OK/FAIL + blueprint OK/FAIL ed esce con
**codice 0 solo se tutto** e present+inspectable, altrimenti **exit 1**.

### Esecuzione (present)

```sh
node eval/harness/run_eval.mjs --mode=present   # o senza flag (default)
echo EXIT=$?
```

## Stato e cosa resta

- **Fatto (M-1):** modalita `present` — `S1..S8` present+inspectable + blueprint.
- **Fatto (M0):** modalita `detection` — detection PARZIALE da oracolo reale per
  lo **scope-M0** (`S1,S2,S3,S4,S5,S8`), normalizzata nel finding model (`04`) e
  asserita contro il registry (`10` §3, criterio 1). NIENTE docker nel gate.
- **Resta (M4):** **detection di S6/S7** via **Semgrep** (ruleset AI curato,
  `07` §4): oggi stampati come `DEFERRED M4`. Il wrapper `run_semgrep.mjs` esiste
  ed e smoke-testato (gira ed emette JSON valido) ma non e gate-ato in M0; S5
  passa al controllo comportamentale sul **DB di test** (`rls-check [DB-test]`),
  con degradazione dichiarata al checker statico se il DB non c'e (`06` §6.1).
- **Resta (M3):** **parity gate di verifica** (`10` §3, criteri 1-4) in
  REMEDIATE: set in scope a `verified` e S2 a `mitigated-residual`; detection-only
  (S6/S7) trovate ma non auto-fixate e report mai "sicuro"; budget `O-COL-006`.
- **Resta (M5):** **parity gate di build** (`10` §4, criteri 5-7) sul blueprint
  seminato: `validate_blueprint` + self-check; checkpoint a 4 controlli; git a
  strati / fail-safe deploy-coupling. M5 esegue i **due parity gate** completi ->
  v1 "fatto" (VISION §10).

Gli hook corrispondenti sono marcati nel sorgente (`// TODO M3:`, `// TODO M4:`,
`// TODO M5:`).

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
