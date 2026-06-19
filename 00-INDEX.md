# 00-INDEX — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) — ex codename *Collaudo*, nome bloccato in `O-COL-001` |
| **One-line** | Lifecycle Agent Skill che incapsula il metodo blueprint-first dell'utente — genera blueprint, costruisce, e verifica oracle-first al confine di ogni macrotask — cross-tool. |
| **Tag decisioni** | `COL` |
| **Versione suite** | **v1.0** — Chat E chiusa (packaging, collaudo, Dynamic Workflows; rename Collaudo→Trueline) |
| **Data** | 14 giugno 2026 |
| **Stato** | **Blueprint chiuso.** Chat A–E complete; `01`–`12` + `DYNAMIC-WORKFLOWS` prodotti. **Implementazione sbloccata**, orchestrata via Dynamic Workflows (`DYNAMIC-WORKFLOWS.md`). |

---

## 1. Come usare questa suite

Stesso metodo degli altri progetti:

- **`SESSION-STATE.md` è l'unica fonte di verità** sullo stato vivo del progetto.
- **Il blueprint è chiuso (v1.0).** Da qui si implementa; le decisioni si modificano solo con un cambio esplicito registrato qui (con nota di emendamento).
- **Decisioni bloccate con ID tipizzati** (`L-COL-NNN`); **decisioni aperte tracciate a parte** (`O-COL-NNN`). Un ID non si riusa; un emendamento si annota, non rinumera.
- **Prosa in italiano, identificatori in inglese** (nomi file, ID, tool, schemi).

## 2. Manifest dei file

| File | Scopo | Stato | Build |
|---|---|---|---|
| `00-INDEX.md` | Questo. Mappa, piano di build, decision ledger. | ✅ v1.0 | — |
| `VISION-AND-CONSTRAINTS.md` | Perché, per chi/per chi no, tre modalità, asimmetria onesta, non-goals, vincoli, parity gate. | ✅ v0.2 | — |
| `SESSION-STATE.md` | Fonte di verità sullo stato vivo. | ✅ v1.0 | Chat A |
| `01-ARCHITECTURE.md` | Pipeline trimodale; risoluzione-intento + dispatch; checkpoint a 4 controlli; modello git a strati; dove sta l'LLM. | ✅ v0.1 | Chat A |
| `02-SKILL-ANATOMY.md` | Struttura SKILL.md trimodale (frontmatter `name: trueline`+`description`, corpo <500 righe); layout `scripts/`·`references/`·`assets/`; progressive disclosure per modalità attiva. | ✅ v0.1 | Chat A |
| `03-ORACLES.md` | Batteria oracoli: security (Semgrep + ruleset AI, gitleaks, osv-scanner, RLS checker) + dead-code; invocazione; **normalizzazione output incl. OWASP→2025 (`L-COL-026`)**; preflight; soglie controllo 2; baseline-delta. | ✅ v0.2 | Chat B (emend. E) |
| `04-FINDINGS-MODEL.md` | Schema del finding: categoria, severità, file, riga, evidenza, fonte-oracolo, stato-fix; **`owasp` canonico-2025 + `owasp_source`**; tassonomia; scala severità; `fix_state`; fingerprint/baseline-delta. | ✅ v0.2 | Chat B (emend. E) |
| `05-VERIFY-FIX-LOOP.md` | applica → riesegui stesso oracolo → riesegui test → accetta/scarta; retry/scarto (`O-COL-006`); gate umano; meccanismo git (gate su main, gate di deploy); segreto-in-history. | ✅ v0.1 | Chat C |
| `06-CHARACTERIZATION-TESTS.md` | Rete di test che cattura il comportamento attuale; **percorso critico del v1** (baseline REMEDIATE); partizione guardia/impattate; confine copertura RLS. | ✅ v0.1 | Chat C |
| `07-CONVENTIONS-THREATMODEL.md` | Standard nominati (**OWASP Top 10:2025 canonico** + normalizzazione, ASVS 5.0.0, CWE), pattern vietati (spec ruleset Semgrep), standard RLS nominato, threat model = enumerazione. | ✅ v0.2 | Chat D |
| `08-TRIAGE-EXPLANATION.md` | Prioritizzazione spietata, traduzione in linguaggio semplice, gestione conservativa dei falsi positivi (ruolo ristretto dell'LLM + allowlist versionata, ora `L-COL-028`). | ✅ v0.1 | Chat D |
| `09-PACKAGING-DISTRIBUTION.md` | Cosa viaggia nel `.skill` vs dipendenza esterna; `package_skill.*` → `.skill`; versioning; conversione cross-tool; install/presenza oracoli; distribuzione GitHub + manuale. | ✅ v0.1 | Chat E |
| `10-EVALUATION.md` | Reference app vulnerabile (`S1–S8`) + blueprint seminato; **due** parity gate (verifica + build); suite di regressione; eval di triggering `description`; **taratura budget `O-COL-006`**. | ✅ v0.1 | Chat E |
| `11-BLUEPRINT-ENGINE.md` | Template blueprint in stile utente + schema del task atomico (`L-COL-019`) + checklist di self-check. | ✅ v0.1 | Chat A |
| `12-LIFECYCLE-PROMPTS.md` | Template dei 3 prompt (`project-start`, `session-start`, `session-end`) e parametrizzazione; fallback portabile, non runtime. | ✅ v0.1 | Chat C |
| `DYNAMIC-WORKFLOWS.md` | **Metodo di build dell'implementazione** via Dynamic Workflows di Opus 4.8 (`L-COL-027`): meccanica, task test-first, model policy, gate = harness di `10`, mappa di milestone. | ✅ v0.1 | Chat E |

> **Prompt di build-time (orchestrazione — non spediti nella skill).** Tre file affiancano la suite per orchestrare *la nostra* implementazione via Dynamic Workflows (`L-COL-027`), da non confondere con i 3 prompt di prodotto che la skill emette in BOOTSTRAP (`12`, → `assets/prompts/`):
> - `PROMPT-PROJECT-START.md` — orientamento una-tantum, alla prima sessione di implementazione (punto d'ingresso).
> - `PROMPT-SESSION-START.md` — apertura di ogni sessione: recupera il contesto da `SESSION-STATE`, ripianifica la milestone corrente in ondate test-first.
> - `PROMPT-SESSION-END.md` — chiusura di ogni sessione: consolida e aggiorna `SESSION-STATE`.

## 3. Piano di build

| Chat | Scope | Output | Stato |
|---|---|---|---|
| **A — Fondamenta, architettura, motore di blueprint** | Riconcilia il delta sessione 2; chiude `O-COL-002/003/004/007/008/009`; pipeline trimodale, anatomia, schema del task; istanzia `SESSION-STATE`. | `01`, `02`, `11`, `SESSION-STATE` | ✅ |
| **B — Oracoli & finding** | Oracoli (security + dead-code); ruleset Semgrep curato; schema dei finding; baseline-delta. | `03`, `04` | ✅ |
| **C — Il loop (cuore)** | Logica di verifica della fix; retry/scarto (`O-COL-006`); characterization; congela gate di deploy; 3 prompt. | `05`, `06`, `12` | ✅ |
| **D — Disciplina & UX dell'agente** | Convenzioni e threat model; triage, spiegazione, falsi positivi; OWASP 2025 canonico (`L-COL-026`). | `07`, `08` | ✅ |
| **E — Packaging, distribuzione, collaudo** | Confezionamento; reference app + blueprint seminato + due parity gate; adozione Dynamic Workflows (`L-COL-027`); nome bloccato (Trueline); emend. `L-COL-026`; promozione policy FP (`L-COL-028`). **Chiusura blueprint.** | `09`, `10`, `DYNAMIC-WORKFLOWS`, emend. `03`/`04`, INDEX/SESSION-STATE v1.0 | ✅ |

**Implementazione: sbloccata.** Orchestrata via Dynamic Workflows secondo la mappa di milestone (`DYNAMIC-WORKFLOWS` §8).

## 4. Decision Ledger — LOCKED

> Nota di riconciliazione (Chat A): i `L-COL-015…023` del delta sessione 2 sono confermati; tre emendano lock di sessione 1 (annotato). I `L-COL-024/025` sono nuovi di Chat A e chiudono `O-COL-008` + la policy deploy.
> Nota di riconciliazione (Chat B): **nessun nuovo lock.** Le specifiche di `03`/`04` ricadono sotto lock esistenti — `validate_blueprint` resta **meccanismo** di `L-COL-019`; baseline-delta e scala a 4 livelli restano **meccanismi** di `L-COL-018`; oracoli (incl. dead-code) sotto `L-COL-008/020`; il set verificato sotto `L-COL-010`.
> Nota di riconciliazione (Chat C): **nessun nuovo lock.** La policy di retry/scarto (`O-COL-006`) resta **meccanismo** di `L-COL-003/005/006`; il gate di deploy (mix fail-safe) resta **meccanismo** di `L-COL-025`.
> Nota di riconciliazione (Chat D): **un solo nuovo lock — `L-COL-026`** (OWASP 2025 canonico + normalizzazione delle fonti esterne). Standard nominati, pattern vietati, standard RLS ed enumerazione restano **meccanismo/contenuto** di `L-COL-012`; la policy FP restava **meccanismo** di `L-COL-002/006/021` (poi promossa in Chat E).
> Nota di riconciliazione (Chat E): **due nuovi lock — `L-COL-027`** (build via Dynamic Workflows) e **`L-COL-028`** (promozione della policy conservativa FP, ex meccanismo di `L-COL-002/006/021`). Sciolte le annotazioni di promozione: `validate_blueprint` **resta meccanismo** di `L-COL-019`. Applicato l'emendamento di `L-COL-026` a `03`/`04`. Chiusa `O-COL-001` (nome = **Trueline**); aperta `O-COL-010` (piano Max).

| ID | Decisione | Razionale | Rif. |
|---|---|---|---|
| **L-COL-001** | Formato di consegna = **Agent Skill** (standard SKILL.md). Non SaaS, non CLI, non MCP server. *(emendato: ora lifecycle, vedi 015)* | Kernel-first; gira nell'ambiente dell'utente; fa evaporare sandbox/privacy/rischio-piattaforma; infra ~nulla. | VISION §1, §12 |
| **L-COL-002** | **Oracle-as-judge, mai LLM-as-judge.** La fonte di verità di ogni claim è un tool deterministico non-LLM. | L'LLM che ha prodotto il bug non può esserne il giudice; gli "auto-verify" LLM-based sono rumorosi. | `03`, `05`, `07`, `08` |
| **L-COL-003** | Il **loop di verifica della fix** è obbligatorio. *(emendato: è la fase di verifica del checkpoint — vedi 015/018)* Fix presentata solo se l'oracolo riesieguito azzera il finding **e** nessun test si rompe. | Chiude i difetti "sporco su sporco" e "plausibile ma sbagliato". | `05` |
| **L-COL-004** | **Test di caratterizzazione** prerequisito di ogni fix su codice non testato; generati *prima* della correzione. *(promosso a percorso critico v1 — vedi 023)* | Non si può dimostrare "non ho rotto nulla" senza rete comportamentale. | `06` |
| **L-COL-005** | **Human-in-the-loop obbligatorio** sulle correzioni; nessuna azione distruttiva senza approvazione. *(esteso al git da 024; rafforzato da 021)* | Sicurezza e fiducia; il gate è il confine di responsabilità. | `05` |
| **L-COL-006** | **Nessun falso "via libera".** Framing sempre "trovato e verificata la correzione di X"; mai "sei sicuro". | L'assenza di finding non è prova di sicurezza. | VISION §7, `05`, `06`, `08` |
| **L-COL-007** | Gli oracoli sono **script allegati eseguiti**; il loro codice resta fuori dal contesto, entra solo l'output. | Determinismo + parsimonia di token. | `02`, `03` |
| **L-COL-008** | **Solo oracoli OSS in v1.** *(esteso da 020 con i dead-code tool)* | Zero costo ricorrente; nessuna dipendenza da scanner a pagamento. | `03` |
| **L-COL-009** | **Cross-tool per costruzione** (standard SKILL.md). Riferimento primario: Claude Code. | Lo stesso artefatto gira su Codex/Cursor/Gemini CLI; massimizza il pubblico. | `09`, `12` |
| **L-COL-010** | **Scope v1**: app JS/TS su Supabase; loop di fix verificata = **segreti + RLS + rimozione dead-code**; detection-only per le altre categorie. *(emendato da 020/023)* | Epicentro documentato; categorie a più alto impatto e più verificabili. | VISION §11 |
| **L-COL-011** | **Modello di finding strutturato** unico; l'LLM ragiona su questo, non sul rumore grezzo né sui propri prior. | Converte pattern-matching in ragionamento vincolato sui fatti. | `04`, `08` |
| **L-COL-012** | **Standard nominati + pattern vietati** in un reference; il threat model è un input che la Skill esegue. | Vincola il prior con standard espliciti invece di aggettivi. | `07` |
| **L-COL-013** | **Privacy per architettura**: gira nell'ambiente dell'utente; il codice non esce. | Postura privacy-first; differenziatore vs scanner cloud. | VISION §7 |
| **L-COL-014** | **Progressive disclosure**: `SKILL.md` snello (<~500 righe) che instrada; ruleset e reference allegati on demand, per modalità attiva. | Anatomia canonica delle Skill; corpo leggibile. | `02` |
| **L-COL-015** | **Lifecycle skill, non solo verificatore.** Governa l'intero ciclo: genera blueprint → costruisce → verifica al confine di ogni macrotask. *(emenda 001/003)* | Il valore è il metodo blueprint-first + il gate, non la sola verifica. | VISION §1 |
| **L-COL-016** | **Tre modalità**: BOOTSTRAP (blueprint + 3 prompt), BUILD (macrotask + checkpoint), REMEDIATE (bonifica di codice esistente). | Copre greenfield e brownfield con lo stesso motore. | `01`, VISION §5 |
| **L-COL-017** | **Dispatch con risoluzione-intento** in testa al corpo `SKILL.md`: blueprint+`SESSION-STATE` → BUILD; repo vuoto/quasi → BOOTSTRAP; codice esistente sostanziale → REMEDIATE; **conferma esplicita nei casi ambigui**. | Una skill, ingressi diversi; sicurezza sui casi ambigui. | `01`, `02` |
| **L-COL-018** | Il **checkpoint** gira al confine di ogni macrotask completato, con 4 controlli: **dead code · sicurezza · regressioni · conformità-logica**. | Il gate di qualità del ciclo di build. | `01`, `05` |
| **L-COL-019** | *(cardine)* Ogni task atomico del blueprint generato **DEVE** portare **definition-of-done + criteri di accettazione + test target**. | Senza, il controllo logico ricade nell'LLM-che-giudica-sé-stesso. Aggancio fra le due metà della skill. | `11`, `01` |
| **L-COL-020** | Batteria oracoli estesa con **dead-code detection** (knip / ts-prune / depcheck) oltre alla security. *(estende 008)* | Tutti OSS, tutti JS/TS; copre il "morto" che si accumula. | `03` |
| **L-COL-021** | Ogni fix passa dal **gate umano**; le cancellazioni di dead-code **non sono mai automatiche**. *(rafforza 005)* | Falsi positivi su import dinamici / magia del framework. | `05`, `08` |
| **L-COL-022** | I 3 prompt (`project-start`, `session-start`, `session-end`) sono **output della BOOTSTRAP mode**, parametrizzati; **NON** fanno parte del runtime della skill. | Fallback portabile tool-agnostico; con la skill la BUILD mode li esegue di fatto. | `12` |
| **L-COL-023** | **Brownfield in v1 = remediation piena**, non solo detection. Conseguenza: i **characterization test (`06`)** finiscono sul percorso critico del v1. *(emenda 010, promuove 004)* | Sono il baseline che rende verificabile un fix su codice senza specifica. | `06`, VISION §6 |
| **L-COL-024** | **Modello git a strati** *(chiude O-COL-008)*. Branch di lavoro: autonomia piena. Merge su `main`: gated dal **checkpoint verde** (autorità = oracolo); BUILD → merge autonomo sul verde, REMEDIATE → "vai" umano. Operazioni distruttive → **mai autonome**. | A pubblicare su `main` è il verdetto deterministico, mai l'LLM-che-dice-fatto. | `05`, `01` |
| **L-COL-025** | **Deploy non supervisionato bloccato.** Prima di qualunque merge autonomo su `main`, la skill **rileva l'accoppiamento a deploy**; se `main` è deploy-coupled, il merge resta **human-gated anche sul verde** (o l'autonomia si ridirige su `staging`). *(meccanismo congelato in Chat C: mix fail-safe — `05` §8.3)* | Merge autonomo su `main` deploy-coupled = deploy autonomo in produzione: raggio troppo ampio. | `01`, `05` |
| **L-COL-026** | **OWASP Top 10:2025 = tassonomia di rischio canonica unica** di Trueline. I codici delle **fonti esterne** (registry Semgrep, OSV) su 2021/CWE sono **normalizzati a 2025 al confine dell'adapter**; il grezzo resta preservato (`owasp_source`). Le regole curate portano già 2025. *(emendamento a `03`/`04` applicato in Chat E)* | Un solo vocabolario di rischio, allineato all'edizione finale (gen 2026). | `07`, `03`, `04`, `08` |
| **L-COL-027** | **Build dell'implementazione orchestrato con i Dynamic Workflows di Opus 4.8** (strumento `Workflow` di Claude Code): fasi plan→distribute→verify→integrate; task atomici **test-first** (gate scritto prima del build = `L-COL-019` applicato a noi); **model policy** verifier-sempre-Opus / orchestratore-Opus / builder Opus|Sonnet / **niente Haiku**; **il gate di un task = l'harness di `10` sulla reference app**, non un DB locale. Metodo di build-time, **non** runtime né BUILD mode della skill. | Throughput + qualità sotto gate deterministico; eredita `L-COL-002` per costruzione. | `DYNAMIC-WORKFLOWS`, `10`, `11` |
| **L-COL-028** | **Policy conservativa sui falsi positivi** (promossa a lock dedicato). L'LLM **(a)** segnala un *sospetto* FP **con evidenza concreta** e ne abbassa la priorità di presentazione, **(b)** propone una voce di allowlist; **mai** sopprime, re-scora, chiude o conta come gestito. Default *nel-dubbio-si-tiene*. I FP **confermati** si codificano nell'**allowlist versionata lato-oracolo** (proposta LLM → approvazione umana → commit). *(ex meccanismo di `L-COL-002/006/021`)* | È la scelta non ovvia che tiene l'LLM utile ma non-giudice sulla gestione dei FP — tensione centrale del progetto; merita un ID stabile. | `08` |
| **L-COL-029** | **Engine guidato dal contratto-ecosistema (manifest-driven).** Un ecosistema è una cartella `references/ecosystems/<id>/` con `ecosystem.json` (contratto validato da `validate_ecosystem`, gemello di `validate_blueprint`) + `guide.md` (+ ruleset). L'engine — checkpoint controllo 2, dead-code, `selectInScope`, test-runner, dispatch di `SKILL.md` — **non cabla** oracoli/categorie: li chiede al manifest risolto (`scripts/ecosystem/resolve.mjs`, sorgente unica). Il **corpo `SKILL.md` resta generico** (<500 righe, zero logica di ecosistema). L'oracolo del modello di autorizzazione-dati è referenziato per **ruolo** (`role: authz-surface`), non per nome → nessuna categoria nuova in `04`. *(SP-0; scioglie `O-COL-005`)* | "Aggiungi un file, non toccare il corpo" diventa un **fatto gate-abile**: aggiungere uno stack = dati + (dove serve) un oracolo. | `02`, `03`, `11`, `DYNAMIC-WORKFLOWS`, spec/plan SP-0 |
| **L-COL-030** | **Barra B — floor in detection + coverage dichiarata; verified come fase 2.** Ogni ecosistema garantisce in **detection** un `floor` minimo (`secret` + `dependency-vuln` + la categoria del ruolo `authz-surface`), con `coverage_policy: declared` (`L-COL-006`). Il `verified_set` (categorie che il loop porta a `verified`) è un **sottoinsieme** delle rilevate e può essere vuoto (detection puro). La promozione di una categoria a **fase 2** richiede la sua prova (fix-provider + fixture *verify*): niente promozione senza prova. *(SP-0; scioglie `O-COL-005`)* | Generalizza l'asimmetria onesta già v1 (injection/authz detection-only) e rende uniforme/gate-abile la barra minima per ogni stack. | `04`, `05`, `06`, `10`, spec SP-0 §5.3 |

> **Nota di riconciliazione (SP-0, 18 giu 2026):** **due nuovi lock** — `L-COL-029` (engine manifest-driven) e `L-COL-030` (barra B). **Chiusa `O-COL-005`** (Trueline multi-ecosistema). SP-0 consegna **contratto + engine generalizzato + gate di conformità** e **retro-descrive `supabase-jsts`** con un manifest che riproduce **56/56** (k=2, gate `ecosystem_conformance.mjs supabase-jsts`); **nessun ecosistema nuovo** (→ SP-1). `validate_blueprint` resta meccanismo di `L-COL-019`; `O-COL-010` (piano Max) confermata operativa (i workflow SP-0 sono girati).
>
> **Nota di riconciliazione (SP-1, 19 giu 2026):** **nessun nuovo lock.** SP-1 consegna il **primo ecosystem pack NUOVO `postgres-jsts`** (JS/TS + Postgres non-Supabase; tier **detection**), prova end-to-end di `L-COL-029`/`L-COL-030` contro il gate di conformità: `ecosystem_conformance.mjs postgres-jsts` **PASS 26/26** + no-regressione integrale (`supabase-jsts`=m5 **56/56**, m1..m4, run_eval, `package_skill` lint VERDE con tier). Il ruolo `authz-surface` è provato come **route-authz** (semgrep su rotte mutanti senza identity check), non RLS. Due capacità additive dell'engine (default v1 invariato): `run_semgrep` accetta un **ruleset path** dal manifest, e `classify()` risolve per **precedenza file-signal-forte** — raffinamento del meccanismo di `L-COL-029` (`resolve.mjs`), che chiude la questione *detect ambiguo* del design §10 (un repo Supabase resta `supabase-jsts` anche con `postgres-jsts` caricato). Branch `feat/sp1-postgres-jsts` (**0 contaminazione, 7ª prova**); **merge su `main` human-gated** (`L-COL-024`). **Prossimo = SP-2** (Python su Postgres). → spec/plan SP-1, `L-COL-029`/`L-COL-030`.
>
> **Nota di riconciliazione (SP-2, 19 giu 2026):** **nessun nuovo lock.** SP-2 consegna il **primo ecosystem pack non-JS/TS `postgres-py`** (Python su Postgres con RLS — FastAPI/Flask/Django + `psycopg`/SQLAlchemy; tier **detection**), prima prova dell'**asse linguaggio** di `L-COL-029`/`L-COL-030`: `ecosystem_conformance.mjs postgres-py` **PASS 26/26** + no-regressione integrale (`supabase-jsts`=m5 **56/56**, `postgres-jsts` 26/26, m1..m4, run_eval, `package_skill` lint VERDE — tier `postgres-py (detection)`). Il ruolo `authz-surface` è provato come **RLS-al-DB riusando `rls_check`** (language-agnostic: l'oracolo statico sulla DDL riconosce `current_setting(...)` per Postgres non-Supabase — 0 finding sul contrasto pulito) — `rls_check` **invariato**. Una sola capacità additiva dell'engine (default v1 invariato): `run_deadcode` impara `--tool=vulture` (dead-code Python). La **classificazione Python è data-driven** sul `lang_any` (nessun cambio a `classify`, solo `resolve.test` esteso 14→20); il gate guadagna il ramo `rls→rls_check` nel corpo detection. Ruleset Semgrep Python (injection, `CWE-89`/`A03:2025`) come extra non-floor. Gate **falsificabile** provato (rimuovere il difetto RLS003 → FAIL). Branch `feat/sp2-postgres-py` (**0 contaminazione, 8ª prova**); **merge su `main` human-gated** (`L-COL-024`). **Prossimo = SP-3** (es. Python+Supabase, o altro stack). → spec/plan SP-2, `L-COL-029`/`L-COL-030`.

## 5. Decision Ledger — OPEN

| ID | Domanda | Stato / Default | Impatto |
|---|---|---|---|
| **O-COL-010** | Piano richiesto per i Dynamic Workflows. | **Aperta.** Girano su Claude Code Max. Default: assunti disponibili per l'implementazione; fallback al loop sequenziale manuale guidato dai 3 prompt (`12`) se non disponibili. | → `DYNAMIC-WORKFLOWS` §9. |

> **Chiuse:**
> - **`O-COL-001`** (nome + brand check) — **Chiusa (Chat E) → Trueline.** Brand check: npm `trueline` libero; handle `github.com/trueline` occupato da account non-dev → repo sotto namespace utente; nessuna collisione di dominio funzionale (a differenza di "trueforge", scartato). Il tag `COL` resta. → `09`.
> - **`O-COL-002`** (canale v1) → **GitHub + install manuale** (Chat A). → `09`.
> - **`O-COL-003`** (licenza) → **MIT in v1** (Chat A).
> - **`O-COL-004`** (presenza oracoli) → **preflight rileva i mancanti e propone l'install** (Chat A). → `03`, `09`.
> - **`O-COL-005`** (2° ecosistema dopo Supabase/JS-TS) → **Chiusa (SP-0, 18 giu 2026)**: Trueline è **multi-ecosistema**; gli ecosistemi sono **pack versionati** governati dal **contratto-manifest** (`ecosystem.json` + `validate_ecosystem`) e dal **gate di conformità** (`ecosystem_conformance.mjs <id>`). SP-0 consegna engine generalizzato + contratto + gate e **retro-descrive `supabase-jsts`** (manifest che riproduce **56/56**, k=2); i nuovi stack (SP-1 = JS/TS+Postgres non-Supabase **costruito**; SP-2 = Python+Postgres con RLS **costruito**; Python+Supabase/Firebase/Next.js… roadmap) sono **roadmap di esecuzione**, non riaperture. → `DYNAMIC-WORKFLOWS`, spec/plan SP-0, `L-COL-029`/`L-COL-030`.
> - **`O-COL-006`** (retry/scarto) → **Chiusa (Chat C)**: 2 retry per-finding, patch materialmente diversa, budget globale; **numero tarato e pinnato in `10` §6**. Meccanismo di `L-COL-003/005/006`. → `05`, `10`.
> - **`O-COL-007`** (DAST) → **v2** (Chat A); v1 source-side. RLS comportamentale via DB di test locale, non DAST (`06` §6.1).
> - **`O-COL-008`** (muta o emette patch) → **chiusa da `L-COL-024`**. → `05`.
> - **`O-COL-009`** (telemetria) → **nessuna** (Chat A).
>
> **Annotazioni di promozione — sciolte (Chat E):** (a) `validate_blueprint.*` **resta meccanismo** di `L-COL-019` (`11` §5.3); (b) policy conservativa FP **promossa** a `L-COL-028` (`08` §5.5).

## 6. Convenzioni

- **ID decisioni**: `L-COL-NNN` (locked), `O-COL-NNN` (open). Numerazione stabile: un ID non si riusa; un emendamento si annota, non rinumera.
- **Nomi file**: prefisso numerico per i moduli di build, MAIUSCOLO per i documenti trasversali (`VISION-AND-CONSTRAINTS`, `SESSION-STATE`, `DYNAMIC-WORKFLOWS`).
- **Lingua**: prosa e commenti in italiano; `name`/`description`/identificatori/schemi/nomi-tool in inglese.

## 7. Glossario minimo

- **Oracolo** — strumento deterministico non-LLM (SAST, scanner segreti, controllo dipendenze, dead-code detection, checker policy) che produce un *fatto* sul codice. È il giudice.
- **Finding** — singolo problema rilevato, normalizzato nello schema di `04`.
- **Modalità** — uno dei tre punti d'ingresso: BOOTSTRAP, BUILD, REMEDIATE (`L-COL-016`).
- **Macrotask** — unità di build al cui confine gira il checkpoint; raggruppa task atomici del blueprint.
- **Task atomico** — più piccola unità del blueprint; porta sempre DoD + criteri di accettazione + test target (`L-COL-019`).
- **Checkpoint** — gate a 4 controlli (dead-code · sicurezza · regressioni · conformità-logica) al confine di un macrotask (`L-COL-018`).
- **Baseline-delta** — confronto dei finding correnti con uno snapshot di riferimento; i controlli 1–2 fanno gate sui finding *nuovi* (`03` §8, `04` §6).
- **`fix_state`** — stato del finding nel ciclo di vita della fix; solo l'oracolo promuove a `verified` (`04` §5, `05` §3).
- **Verifica per-finding vs ri-valutazione del checkpoint** — la prima riesegue *un* oracolo e porta *quel* finding a `verified`; la seconda riesegue i *quattro* controlli e apre il cancello del merge (`05` §6).
- **Test di caratterizzazione** — test che cattura il comportamento *attuale* del codice (`06`). Partizionati in **guardia** (da preservare) e **impattate** (che la fix cambia di proposito).
- **Loop di verifica della fix** — applica → riesegui lo stesso oracolo → riesegui i test → accetta solo se il finding è sparito e nulla si è rotto.
- **Gate umano** — punto obbligatorio in cui una persona approva l'applicazione di una patch (o il merge su `main` quando `main` deploya).
- **Deploy-coupling** — `main` collegato a deploy automatico su push; quando presente, il merge su `main` torna human-gated (`L-COL-025`).
- **`mitigated-residual`** — finding mitigato ma con residuo non azzerabile dall'oracolo senza azione distruttiva (es. segreto in history); **non** è `verified` (`04` §5, `05` §7).
- **Standard nominato** — riferimento esplicito (OWASP Top 10:**2025** canonico, ASVS 5.0.0, CWE, standard RLS nominato) che le spiegazioni citano al posto degli aggettivi; i codici OWASP da fonti esterne sono normalizzati a 2025 (`L-COL-012`, `L-COL-026`).
- **Pattern vietato** — anti-pattern enumerato che diventa una regola del ruleset Semgrep curato (`07` §4).
- **Threat model** — procedura di enumerazione adversariale (input + fiducia + categorie OWASP) che la Skill *esegue* per delimitare lo *scope*; produce scope, non verdetti (`L-COL-012`, `07` §6).
- **Falso positivo (gestione conservativa)** — l'LLM può *segnalarlo con evidenza* e abbassarne la priorità, mai sopprimerlo/re-scorarlo/chiuderlo; il FP confermato si codifica nell'**allowlist versionata** lato-oracolo (`L-COL-028`, `08` §5).
- **Dynamic Workflows** — lo strumento `Workflow` di Claude Code (Opus 4.8) con cui si **implementa** Trueline: plan→distribute→verify→integrate, task test-first, gate = harness di `10` (`L-COL-027`, `DYNAMIC-WORKFLOWS`).
- **Kernel** — il motore di build+verifica incarnato da questa Skill; riusabile dietro un'eventuale SaaS.
