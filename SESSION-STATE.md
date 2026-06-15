# SESSION-STATE — Trueline

> **Cosa traccia questo file.** È la fonte di verità sullo stato vivo del **blueprint di Trueline** (la progettazione della skill). Da non confondere con la `SESSION-STATE` che la skill *genera* per il progetto di un utente in BUILD mode: stesso pattern, istanza diversa (`11` §4). In implementazione traccia anche l'avanzamento delle milestone di `DYNAMIC-WORKFLOWS` §8.

| | |
|---|---|
| **Progetto** | Trueline (`COL`) — ex codename *Collaudo*, nome bloccato in `O-COL-001` |
| **Versione suite** | **v1.0** |
| **Ultima sessione** | Impl. — **M-1 + M0** completati (gate verdi, verificati indipendentemente). |
| **Data** | 15 giugno 2026 |
| **Fase** | **Implementazione in corso** via Dynamic Workflows. **M-1 ✅ · M0 ✅** → prossima: **M1 — Checkpoint & loop**. |

---

## 1. Dove siamo

**Chat A–D: complete.** Reframe lifecycle nel ledger; pipeline trimodale, anatomia, motore di blueprint (A); batteria oracoli + finding + baseline-delta (B); loop di verifica della fix, characterization, 3 prompt, gate di deploy congelato (C); convenzioni/threat model, triage, policy FP, OWASP 2025 canonico `L-COL-026` (D).

**Chat E: completa. Suite chiusa a v1.0.**
- Scritti **`09-PACKAGING-DISTRIBUTION`** (cosa viaggia nel `.skill` vs dipendenza esterna; `package_skill.*`; versioning; conversione cross-tool con degradazione dichiarata; install/presenza oracoli; GitHub + install manuale) e **`10-EVALUATION`** (reference app vulnerabile con difetti seminati `S1–S8`; **due** parity gate — verifica e build; suite di regressione; eval di triggering della `description`; **taratura e pinning del budget `O-COL-006`** in §6).
- Scritto **`DYNAMIC-WORKFLOWS`** — metodo di build dell'implementazione via Dynamic Workflows di Opus 4.8 (`L-COL-027`): meccanica plan→distribute→verify→integrate, task test-first, model policy (verifier sempre Opus, niente Haiku), **gate = harness di `10`** (non DB locale), mappa di milestone M-1…M5 (banco di prova M-1 prerequisito + M0–M5).
- **Applicato l'emendamento `L-COL-026`** a `03` (l'adapter normalizza i codici OWASP esterni → 2025) e `04` (campo `owasp` canonico-2025 + nuovo `owasp_source`) → entrambi a v0.2.
- **Chiusa `O-COL-001`**: nome = **Trueline** (brand check fatto; "trueforge" scartato per collisione con un'umbrella dev esistente). **Rename Collaudo→Trueline** applicato a tutta la suite.
- **Due nuovi lock**: `L-COL-027` (Dynamic Workflows) e `L-COL-028` (policy conservativa FP promossa). `validate_blueprint` **resta meccanismo** di `L-COL-019`. **Aperta `O-COL-010`** (piano Max).

Prossimo: **M1 — Checkpoint & loop** (`01` §4 + `05`): `run_checkpoint`, macchina del verify-fix loop, retry `O-COL-006`, git a strati + detector di deploy-coupling. Gate: il set in scope raggiunge `fix_state: verified`, `S2` resta `mitigated-residual`, git a strati esercitato (`10` §3-§4). **Qui si tara e si pinna il budget `O-COL-006`** sulla reference app (`10` §6 → `references/oracles/thresholds.md`). M-1 e M0 sono **completati e verificati** (vedi §1bis).

> **Sweep di coerenza (post-chiusura).** Applicata una passata di coerenza sulla suite — riallineamento di note stale al ledger v1.0: `L-COL-028` in `08`, `validate_blueprint`-resta-meccanismo in `11`, emendamento `L-COL-026` applicato in `07`, deploy-coupling congelato in `01`, pin di dipendenza `03`/`04`→v0.2 (in `05`/`07`/`08`) e `00-INDEX`→v1.0 (in `01`), tassonomia OWASP-2025 in `04` §3, prerequisito **banco di prova M-1** in `DYNAMIC-WORKFLOWS` §8 e qui. Aggiunti i 3 prompt di build-time (`PROMPT-PROJECT-START`/`-SESSION-START`/`-SESSION-END`). **Nessuna decisione cambiata**: solo riallineamento editoriale a v1.0.

## 1bis. Avanzamento implementazione (milestone)

| Milestone | Stato | Note |
|---|---|---|
| **M-1 — Banco di prova** | ✅ **verde** (15 giu 2026) | auto-gate present+inspectable superato; verificato indipendentemente dall'orchestratore. |
| **M0 — Oracoli & finding** | ✅ **verde** (15 giu 2026) | detection `S1/S2/S3/S4/S5/S8` via oracoli reali (EXIT=0, verificato indip.); `S6/S7` differiti a M4. 12 finding validano `finding.schema.json`. Branch `m0/oracoli-finding` (`f45a26d`). |
| **M1 — Checkpoint & loop** | ⏭️ prossima | `run_checkpoint` (4 controlli), macchina verify-fix loop, retry `O-COL-006`, deploy-coupling. **Tara/pinna il budget `O-COL-006`** (`10` §6). |

**Toolchain installata (preflight 15 giu, human-gated):** gitleaks + osv-scanner 1.9.2 (`C:\Users\claud\go\bin`); knip 6.16.1 + `pgsql-ast-parser` 12.0.2 (npm); **semgrep 1.165.0 via Docker** (`semgrep/semgrep:latest`, mount Windows verificato).

**Artefatti M0** (branch `m0/oracoli-finding`, `f45a26d`; stack: `f45a26d`←`d3d7116`←`5a84bb6`, `main` intatto):
- `trueline/scripts/oracles/` — `run_gitleaks.mjs` (working-tree + history, redatto), `rls_check.mjs` (custom, pgsql-ast-parser, controlli RLS001/003/004…), `run_deadcode.mjs` (knip), `run_osv.mjs`, `run_semgrep.mjs` (Docker, ruleset **placeholder** + `// TODO M4`), `gitleaks.toml`.
- `trueline/scripts/findings/` — `finding.schema.json`, `normalize.mjs` (native→finding, fingerprint, dedup, OWASP→2025 con `// TODO M4` per la mappa autoritativa `07` §3.1), `validate_finding.mjs`.
- `trueline/references/finding-model.md` · `trueline/references/oracles/semgrep-ai-ruleset/placeholder.yml`.
- `eval/harness/run_eval.mjs` — modalità `--mode=detection` (oracoli reali, criterio 1) oltre a `--mode=present`.

**Artefatti M-1** — branch `m-1/banco-di-prova` (commit `d3d7116`); `main` intatto a `5a84bb6` (merge human-gated, `L-COL-024`):
- `eval/reference-app/` — **repo git indipendente** (gitignorato dal repo esterno): `S1,S6,S7,S8` nel working tree; `S2` add-then-remove in history (`386f02b`→`990fe79`); `supabase/migrations/0001_init.sql` con `S3` (`public.audit_logs`, no RLS), `S4` (`documents_read_all`, `USING (true)`), `S5` (`invoices`, policy senza `auth.uid()`) + tabelle pulite di contrasto.
- `eval/seeded-blueprint/` — blueprint valido (3 task `T-001…003`, 7 acceptance_criteria tutti coperti, DAG aciclico).
- `eval/harness/` — `run_eval.mjs` (exit 0), `validate_blueprint.mjs`, `expected/registry.json` (S1–S8: `category`/`source_oracle`/OWASP-2025/`scan_scope`). Hook `// TODO M0` segnano dove M0 innesta gli oracoli reali.
- `eval/db-test/` — `config.toml` + `up.sh`/`up.ps1` + **nota di degradazione dichiarata**; live `supabase start` differito a M0/M3.

**Toolchain (preflight 15 giu):** presenti node 25.5 · npm 11.8 · git 2.52 · docker 29.5 · go 1.26 · python 3.14. Mancanti (→ M0): supabase-CLI · semgrep · gitleaks · osv-scanner.

## 2. File prodotti / stato

| File | Stato | Versione |
|---|---|---|
| `00-INDEX.md` | ✅ | v1.0 |
| `VISION-AND-CONSTRAINTS.md` | ✅ | v0.2 |
| `01-ARCHITECTURE.md` | ✅ | v0.1 |
| `02-SKILL-ANATOMY.md` | ✅ | v0.1 (`name: trueline`) |
| `03-ORACLES.md` | ✅ | v0.2 (emend. `L-COL-026`) |
| `04-FINDINGS-MODEL.md` | ✅ | v0.2 (emend. `L-COL-026`) |
| `05-VERIFY-FIX-LOOP.md` | ✅ | v0.1 |
| `06-CHARACTERIZATION-TESTS.md` | ✅ | v0.1 |
| `07-CONVENTIONS-THREATMODEL.md` | ✅ | v0.2 |
| `08-TRIAGE-EXPLANATION.md` | ✅ | v0.1 (policy FP ora `L-COL-028`) |
| `09-PACKAGING-DISTRIBUTION.md` | ✅ | v0.1 |
| `10-EVALUATION.md` | ✅ | v0.1 |
| `11-BLUEPRINT-ENGINE.md` | ✅ | v0.1 |
| `12-LIFECYCLE-PROMPTS.md` | ✅ | v0.1 |
| `DYNAMIC-WORKFLOWS.md` | ✅ | v0.1 |
| `SESSION-STATE.md` | ✅ (questo) | v1.0 |

> **Prompt di build-time (orchestrazione — non spediti).** Affiancano la suite per orchestrare l'implementazione via Dynamic Workflows (`L-COL-027`), distinti dai 3 prompt di prodotto di `12` (`assets/prompts/`): `PROMPT-PROJECT-START.md` (ingresso una-tantum), `PROMPT-SESSION-START.md` (apertura sessione), `PROMPT-SESSION-END.md` (chiusura sessione). Non viaggiano nel `.skill`.

> **Nota rename.** Il rename Collaudo→Trueline è cosmetico (codename → nome bloccato) e non altera la sostanza dei moduli: le versioni dei file restano quelle d'origine, tranne dove c'era un cambio reale (`03`/`04` a v0.2 per `L-COL-026`). `09`/`10`/`DYNAMIC-WORKFLOWS` nascono già su Trueline e conservano la nota storica "ex codename Collaudo".

## 3. Stato delle decisioni

Ledger completo in `00-INDEX` §4–§5. Sintesi:

- **Locked**: `L-COL-001 … 028`. Chat E ha coniato **`L-COL-027`** (build via Dynamic Workflows) e **`L-COL-028`** (policy conservativa FP, ex meccanismo di `L-COL-002/006/021`). `validate_blueprint` resta **meccanismo** di `L-COL-019`. `L-COL-026` (OWASP 2025) emendato in `03`/`04`.
- **Aperte**: `O-COL-005` (2° ecosistema → v2); `O-COL-010` (piano Max per i Dynamic Workflows; default assunti disponibili, fallback loop sequenziale `12`).
- **Chiuse**: `O-COL-001` (nome = **Trueline**); `O-COL-002` (GitHub + manuale); `O-COL-003` (MIT); `O-COL-004` (preflight); `O-COL-006` (retry/scarto; numero tarato in `10` §6); `O-COL-007` (DAST → v2); `O-COL-008` (chiusa da `L-COL-024`); `O-COL-009` (nessuna telemetria).

## 4. Da congelare

- ✅ Nulla di **bloccante** in sospeso: il blueprint è chiuso. L'emendamento `L-COL-026` è applicato; le annotazioni di promozione sono sciolte; il nome è bloccato.
- **In implementazione**: il numero del budget `O-COL-006` è da **tarare sulla reference app reale** (`10` §6). La reference app è una fixture del **banco di prova M-1** (prerequisito, prima di M0), quindi esiste fin da subito; la **misura** del budget avviene quando il loop di fix in-scope è pronto (**M1**), eseguendo il gate di verifica end-to-end, e il valore si **pinna** in `references/oracles/thresholds.md`. Confermare la disponibilità del piano Max (`O-COL-010`) prima di lanciare il primo workflow.

## 5. Invarianti da non perdere di vista (per ogni sessione futura)

- Oracle-as-judge, mai LLM-as-judge *(L-COL-002)*. **Solo l'oracolo** porta un finding a `verified` (`04` §5, `05` §3). Vale anche per i gate dei Dynamic Workflows (`DYNAMIC-WORKFLOWS` §6).
- Loop di verifica della fix obbligatorio *(L-COL-003, 018)*. Revert prima di ogni retry; patch materialmente diversa (`05` §3–§4).
- **Verifica per-finding** vs **ri-valutazione del checkpoint** (`05` §6).
- Il **finding model** (`04`) è l'unico contratto fra oracoli (`03`), loop (`05`), triage (`08`) *(L-COL-011)*.
- Ogni task atomico = DoD + criteri + test *(L-COL-019, cardine)* — vale anche per i nostri task di implementazione *(L-COL-027, dogfooding)*.
- Characterization sul percorso critico del v1 *(L-COL-004, 023)*; partizione guardia/impattate (`06` §4); copertura RLS condizionata al DB di test e dichiarata (`06` §6.1).
- Git: branch autonomo, merge su `main` gated dal verde, distruttive mai autonome, deploy non supervisionato bloccato *(L-COL-024, 025)*. Segreto-in-history → `mitigated-residual`, mai `verified` finché la history non è riscritta (`05` §7).
- Nessun falso "via libera" *(L-COL-006)*: coverage declaration sempre presente (`04` §10, `06` §7); `mitigated-residual` ≠ `verified`. Asimmetria onesta BUILD vs REMEDIATE detta in chiaro (VISION §6, `05` §9).
- Standard nominati come vocabolario *(L-COL-012, L-COL-026)*: OWASP **2025** canonico unico (fonti esterne normalizzate all'adapter, `03` §6) / ASVS 5.0.0 / standard RLS nominato; il threat model **delimita lo scope, non assolve** (`07` §6).
- **Falsi positivi — ruolo ristretto dell'LLM** *(ora `L-COL-028`)*: flag-con-evidenza + abbassa priorità; mai sopprime/re-scora/chiude; default *nel-dubbio-si-tiene*; FP confermati nell'**allowlist versionata lato-oracolo** (`08` §5).
- Corpo `SKILL.md` < ~500 righe; pesi in `references/` per modalità attiva *(L-COL-014)*. `name: trueline`, dir radice `trueline/` (`02`, `09`).

## 6. Note di carry-over

- Scope v1 fermo: **JS/TS su Supabase**; loop verificato = **segreti + RLS + rimozione dead-code**; detection-only per il resto; REMEDIATE = remediation piena ma non "verificata-a-zero".
- **Packaging (Chat E)**: viaggiano nel `.skill` il nostro codice (scripts, incl. `rls_check`), i `references/` distillati (ruleset Semgrep curato vendorizzato + version-pinned), i 3 prompt in `assets/prompts/`; **restano esterni** i binari di terzi (semgrep/gitleaks/osv/knip) via preflight (`O-COL-004`). Repo sotto namespace utente (handle `trueline` occupato), npm `trueline` libero, MIT, nessuna telemetria.
- **Eval (Chat E)**: reference app con `S1–S8` (mix verificato-a-zero + detection-only + segreto-in-history); DB di test per RLS a runtime (integration locale, non DAST); due parity gate = definizione di "fatto" (VISION §10); suite di regressione = l'harness che i gate dei Dynamic Workflows chiamano.
- **Dynamic Workflows (Chat E)**: opt-in esplicito ("usa lo strumento Workflow"); concorrenza `min(16, core−2)`/workflow, 1.000 agent/run; verifier sempre Opus, builder Opus per la logica delicata / Sonnet per il meccanico; gate = oracoli/`validate_blueprint`/harness di `10`; mappa M-1…M5.
- **Uso reale previsto**: AppuntamentiChirsan in REMEDIATE; Gestionale Officina come disciplina build+gate (caso concreto di `main` deploy-coupled, Supabase+Cloudflare live → `L-COL-025`).

## 7. Avvio implementazione (promemoria)

Il blueprint è chiuso: da qui si scrive codice, orchestrando con i Dynamic Workflows.

- **Prima sessione = banco di prova M-1** (`DYNAMIC-WORKFLOWS` §8): costruire le fixture di gate di `10` (reference app + `S1–S8`, DB di test RLS, blueprint seminato, harness), perché sono il prerequisito di gate di tutte le milestone. Poi **M0 — Oracoli & finding**: wrapper oracoli + `rls_check` + `normalize` + schema del finding, con gate = detection di `S1–S8` sull'harness di `10` §3.
- Aprire la sessione con l'**opt-in esplicito** *"usa lo strumento Workflow"* (altrimenti l'orchestratore non parte).
- Rispettare le dipendenze del DAG: finding model (`04`) prima del loop (`05`); schema del task (`11`) prima del self-check; oracoli (`03`) prima del checkpoint.
- **Tarare il budget `O-COL-006`** sulla reference app (fixture del banco **M-1**, prerequisito): la **misura** scatta quando il loop di fix in-scope esiste (**M1**), eseguendo il gate di verifica end-to-end (`10` §6); poi **pinnarlo** in `references/oracles/thresholds.md`.
- Confermare `O-COL-010` (piano Max) prima del primo workflow; in mancanza, fallback al loop sequenziale guidato dai 3 prompt (`12`).
- Ogni nostro task porta il suo gate **scritto prima** (`L-COL-019`/`L-COL-027`): test-first anche su noi stessi.
