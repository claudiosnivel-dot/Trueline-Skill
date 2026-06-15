# 03-ORACLES — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Versione** | v0.2 (Chat B; emendata in Chat E — `L-COL-026`) |
| **Data** | 13 giugno 2026 (emend. 14 giugno 2026) |
| **Copre** | `L-COL-002`, `007`, `008`, `010`, `018` (controlli 1–2), `020`, `021`, `026` (normalizzazione OWASP nell'adapter); `O-COL-004` (preflight) |
| **Dipende da** | `01-ARCHITECTURE` v0.1, `02-SKILL-ANATOMY` v0.1 · **co-prodotto con** `04-FINDINGS-MODEL` (è il consumatore del suo schema) |

---

## 1. Ruolo di questo modulo

Gli oracoli sono **i giudici** della skill *(L-COL-002)*: ogni affermazione su sicurezza, segreti, RLS o codice morto traccia all'output di uno strumento deterministico non-LLM, mai a una frase del modello. Questo modulo definisce **quali** oracoli, **come** si invocano, **come** si normalizza il loro output nel finding model (`04`), e **quali soglie** governano il verde/rosso del checkpoint (`01` §4).

Tre vincoli ereditati che attraversano tutto il modulo:

- **Output-only nel contesto** *(L-COL-007)*. Gli oracoli sono script in `scripts/oracles/`: il loro codice **non** entra mai nel contesto dell'LLM, entra solo il loro output normalizzato. Determinismo + parsimonia di token.
- **Solo OSS** *(L-COL-008, L-COL-020)*. Nessuna dipendenza da scanner a pagamento, nessuna telemetria *(O-COL-009)*.
- **Source-side in v1.** Niente DAST: il probing runtime su URL live è rinviato a v2 *(O-COL-007 → v2)*. Tutti gli oracoli leggono sorgenti, manifest e schema dichiarato — non un'app in esecuzione.

## 2. La batteria

| Oracolo | Controllo checkpoint | Cosa trova | Tool (OSS) |
|---|---|---|---|
| **Semgrep** (+ ruleset AI curato) | 2 — sicurezza | injection, authz mancante su route mutanti, crypto debole / non timing-safe, sink pericolosi, segreti inline | `semgrep` |
| **gitleaks** | 2 — sicurezza (segreti) | segreti nel working tree e **nella history** git | `gitleaks` |
| **osv-scanner** | 2 — sicurezza (dipendenze) | CVE note nelle dipendenze dichiarate nel lockfile | `osv-scanner` |
| **RLS checker** (custom) | 2 — sicurezza (RLS) | tabelle Supabase senza RLS, RLS senza policy, policy `USING (true)` | nostro (`rls_check.*`) |
| **knip** *(primario)* | 1 — dead code | file, export, dipendenze e tipi non referenziati | `knip` |
| ts-prune / depcheck *(fallback)* | 1 — dead code | export inutilizzati / dipendenze inutilizzate-mancanti | `ts-prune`, `depcheck` |

**Cosa NON è in questa tabella.** I controlli **3 (regressioni)** e **4 (conformità-logica)** non usano uno scanner: il loro oracolo è il **test runner** del progetto — la suite esistente / i `target_tests` dei task atomici (`11`) in BUILD, i characterization test (`06`) in REMEDIATE. Sono comunque oracoli nel senso di `L-COL-002` (l'esito è una proprietà del run di test, non una frase dell'LLM), ma vivono nei moduli `11`/`06`, non qui. Questo modulo copre **controlli 1 e 2**.

## 3. Modello di esecuzione

```
run_checkpoint.*  ──▶  invoca gli oracoli in scope per la modalità/controllo
                        │  (ognuno è uno script in scripts/oracles/)
                        ▼
                  output NATIVO (JSON) di ogni tool   ← resta fuori dal contesto
                        │
                  normalize.*  ──▶  FINDING MODEL (04)  ← questo entra nel contesto
                        │
                  baseline-delta + soglie  ──▶  verde / rosso per controllo
```

Regole di esecuzione:

- **Si parsa il report JSON, non l'exit code.** Gli exit code dei tool sono grossolani (0/1/2) e ambigui; ogni wrapper invoca il tool nella sua modalità JSON e passa l'output a `normalize.*`. L'exit code si usa solo per distinguere *errore di esecuzione* (tool crashato / config invalida) da *run completato con findings*.
- **Flag pinnati e riproducibili.** Ogni wrapper fissa i flag (incluso `--metrics=off` dove esiste) così che due run sullo stesso albero diano lo stesso output. Niente interattività, niente prompt.
- **Un solo formato in uscita.** Qualunque oracolo, il `normalize.*` corrispondente emette il **finding model** di `04`. È l'unico contratto che i moduli a valle vedono (`05`, `08`).
- **Errore ≠ assenza di finding.** Se un oracolo non gira (mancante, config rotta), il checkpoint **non** lo interpreta come "verde": lo segnala come *controllo non eseguito* e si ferma al gate umano. Coerente con `L-COL-006` (nessun falso via libera).

## 4. Preflight: presenza degli oracoli *(O-COL-004)*

`scripts/preflight.*` gira **prima** di qualunque operazione che richieda gli oracoli (o il push). Non assume i tool presenti, non vendorizza binari: **rileva e propone l'install**.

Per ciascun tool: verifica la presenza (`command -v` / `npx --no-install`), confronta la versione contro un minimo pinnato, e se manca **propone** il comando di install — non lo esegue da sé senza consenso (human-in-the-loop, `L-COL-005`).

| Tool | Rilevazione | Install proposto |
|---|---|---|
| semgrep | `semgrep --version` | `pipx install semgrep` *(o `npm i -g`/binario per OS)* |
| gitleaks | `gitleaks version` | binario rilasciato / `brew` / `go install` |
| osv-scanner | `osv-scanner --version` | binario rilasciato / `go install` |
| knip | `npx knip --version` | `npm i -D knip` *(per-progetto)* |
| ts-prune / depcheck | `npx ts-prune` / `npx depcheck` | `npm i -D` *(solo se serve il fallback)* |
| RLS checker | è nostro, viaggia con la skill | nessuno (dipende solo dal runtime JS/TS) |

Note cross-OS: il preflight propone il canale più adatto al sistema rilevato; se un tool ha solo un install method non disponibile (es. niente `go`), lo **dichiara non installabile** e degrada il controllo a *non eseguito* anziché fingere un verde. La presenza degli oracoli è anche oggetto di `09-PACKAGING-DISTRIBUTION` (cosa viaggia nel `.skill`, cosa è dipendenza esterna).

## 5. Specifica per oracolo

### 5.1 Semgrep + ruleset AI curato

**Invocazione base.** `semgrep scan --config <ruleset-vendorizzato> --json --metrics=off`.

**Il ruleset.** Il core è un **pacchetto curato nostro**, autorato a mano sui pattern di fallimento AI documentati, **vendorizzato e version-pinned** in `references/oracles/semgrep-ai-ruleset/`. Storia di licenza pulita (MIT nostro, coerente con `O-COL-003`), gira **offline**, e ha basso rumore perché ogni regola è scelta — non è un pacchetto generico. Le **categorie** coperte (il dettaglio dei pattern e dei pattern *vietati* vive in `07-CONVENTIONS-THREATMODEL`, qui se ne fissa solo la mappatura):

- segreti inline / chiavi hardcoded (rete ridondante a gitleaks, vedi §6 dedup);
- SQL/command injection (concatenazione invece di query parametrizzate);
- authz assente su route mutanti (handler che scrivono senza check di identità/ruolo);
- crypto debole e confronti non timing-safe;
- sink pericolosi (`eval`, deserializzazione non sicura, `child_process` con input non sanificato).

**Pack del registry: opt-in a runtime.** Per chi vuole più copertura, la skill accetta `--config p/owasp-top-ten` / `p/secrets` ecc. come **scelta esplicita dell'utente**, non come default. Motivo: i pack del registry sono ampi e rumorosi (contro il posizionamento "non rumoroso"), il fetch richiede rete, e la loro licenza non è uniformemente MIT — quindi non li vendorizziamo. Il default resta il pacchetto nostro, offline.

**Severità nativa.** Semgrep emette `ERROR` / `WARNING` / `INFO`; la mappatura alla scala a 4 livelli è in `04` §4. I metadati di regola (`metadata.category`, `cwe`, `owasp`) alimentano i campi corrispondenti del finding.

### 5.2 gitleaks

**Invocazione.** `gitleaks detect --report-format json --redact --no-banner`.

- `--redact` è **obbligatorio**: il valore del segreto non deve mai entrare nel contesto (privacy, `L-COL-013`; e il finding model porta solo evidenza redatta, `04` §7).
- **Scope per modalità.** BUILD/checkpoint → working tree + diff del macrotask corrente. REMEDIATE → **history completa** del repo: un segreto committato in passato è un leak anche se il file attuale è pulito.
- **Allowlist.** Fixture di test e secret finti noti vanno in allowlist (`.gitleaks.toml`) per non gonfiare i falsi positivi; l'allowlist è esplicita e versionata.

**Sottigliezza critica — segreto nella history.** Un segreto trovato *nella history* **non** si "verifica-a-zero" rieseguendo l'oracolo dopo aver tolto il valore dal file corrente: resta nel log git. La fix corretta è **rotazione della chiave** + (eventuale) riscrittura di storia. La riscrittura di storia è un'operazione **distruttiva** → mai autonoma, sempre gate umano *(L-COL-024)*. Di conseguenza il finding va marcato **`mitigated-residual`** (rotazione fatta, residuo in history), **non** `verified` — è un caso esplicito di "niente falso via libera" *(L-COL-006)*. Vedi `04` §5 (stati) e `05-VERIFY-FIX-LOOP`.

### 5.3 osv-scanner

**Invocazione.** `osv-scanner --format json --lockfile <lockfile>`. Supporta `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`.

- **Online di default, offline disponibile.** Di default interroga l'API OSV.dev inviando **solo nome+versione dei pacchetti**, mai il codice — compatibile con la postura privacy. Per chi vuole zero rete è documentato `--offline` con DB locale scaricato in anticipo.
- **Severità.** Da CVSS dell'avviso OSV, a bande, mappate sulla scala a 4 livelli (`04` §4).
- **Path di fix.** Bump di versione. È tecnicamente **ri-verificabile** (riesegui osv → finding sparito), ma un bump può rompere comportamento: per questo, anche quando proposto, passa dal checkpoint completo (controlli 3 e 4 devono restare verdi). In v1 la categoria `dependency-vuln` resta **detection-only** rispetto al *set verificato-a-zero* (`L-COL-010`: il set è segreti + RLS + dead-code); il bump verificato può entrare nel set in v2.

### 5.4 RLS checker (custom) — l'unico oracolo che costruiamo

È la difesa sul "killer numero uno" di Supabase. **Static-first**, coerente col confine source-side del v1.

**Cosa fa.** Parsa lo schema dichiarato — `supabase/migrations/**/*.sql` e altri file DDL dichiarativi — e applica controlli deterministici. Per robustezza usa un **parser DDL Postgres reale** (es. `pgsql-ast-parser`/`libpg_query`) anziché regex fragili sul testo. Controlli minimi:

| Controllo | Condizione di finding | Severità tipica |
|---|---|---|
| RLS assente | tabella in `public` (user-facing) senza `ENABLE ROW LEVEL SECURITY` | HIGH |
| Policy assente | RLS abilitato ma nessuna `CREATE POLICY` per la tabella (deny-all silenzioso, spesso non intenzionale) | MEDIUM |
| Isolamento finto | policy con `USING (true)` / `WITH CHECK (true)` (nessuna isolazione effettiva) | HIGH |
| `auth.uid()` mancante | policy che non vincola per identità/tenant dove la tabella è multi-tenant | HIGH *(euristico, vedi sotto)* |

Lo **standard nominato** contro cui misura ("ogni tabella `public` ha RLS abilitato e almeno una policy che vincola per `auth.uid()`/tenant") vive in `07-CONVENTIONS-THREATMODEL`; qui se ne fissa la meccanica.

**Confine di copertura dichiarato.** Lo static-first **non vede** lo schema modificato solo dal dashboard Supabase e non riversato in migration. Il checker **lo dichiara** ("verificato contro le migration dichiarate; tabelle non presenti nelle migration non sono coperte") — non riempie il vuoto con una stima dell'LLM *(L-COL-006)*.

**Modalità introspection — opt-in, rinviata.** Se l'utente fornisce una connessione **read-only a un DB non-prod** (es. `DATABASE_URL` di staging), una variante può interrogare `pg_policies` / `pg_class.relrowsecurity` per la verità a runtime. È **opt-in**, locale, non trasmette nulla oltre il DB dell'utente, e resta fuori dallo scope del parity gate v1 (che gira su una reference app con migration seminate).

### 5.5 Dead code — knip primario *(L-COL-020)*

**Invocazione.** `knip --reporter json`. knip è il superset (file + export + dipendenze + tipi non usati in un solo run), quindi è **l'oracolo primario** del controllo 1; ts-prune (export) e depcheck (dipendenze) restano **fallback documentati** per progetti dove la config di knip è scomoda, con la stessa normalizzazione in uscita.

- **Config.** knip richiede `knip.json`. La skill può **proporre** una config di default ragionevole per JS/TS+Supabase (entry points, ignore di pattern noti), confermata dall'utente.
- **Falsi positivi del framework.** Import dinamici e "magia" del framework producono falsi positivi: per questo le **cancellazioni di dead-code non sono MAI automatiche** *(L-COL-021)* — la skill propone, l'umano approva.
- **Gating per delta, non per severità.** Il controllo 1 va rosso quando il macrotask **introduce nuovo** codice morto (delta vs baseline, §8); il morto pre-esistente è *segnalato*, non blocca e non si cancella in autonomia *(L-COL-021)*.

## 6. Normalizzazione → finding model

`scripts/findings/normalize.*` mappa l'output nativo di ogni oracolo nello schema di `04`. La tabella di mappatura (estratto; lo schema completo è in `04`):

| Oracolo | → `category` | → `severity` | → `location` | → `evidence` | → `source_oracle` |
|---|---|---|---|---|---|
| Semgrep | da `metadata.category` | da `ERROR/WARNING/INFO` | `path`+`start/end.line` | `extra.lines` (redatto se segreto) | `semgrep` + `check_id` + versione |
| gitleaks | `secret` | CRITICAL/HIGH | `File`+`StartLine` | match **redatto** | `gitleaks` + `RuleID` |
| osv-scanner | `dependency-vuln` | da CVSS | lockfile + pacchetto | id avviso + versioni | `osv-scanner` + CVE/GHSA |
| RLS checker | `rls` | da tabella controlli §5.4 | file migration + statement | snippet DDL | `rls-check` + id controllo |
| knip / fallback | `dead-code` | LOW/advisory | file/export | simbolo o path | `knip`/`ts-prune`/`depcheck` |

Due responsabilità in più del normalizer:

- **Fingerprint.** Calcola l'identità stabile-per-riga del finding (definita in `04` §6) per il baseline-delta.
- **Dedup.** Lo stesso segreto trovato da gitleaks **e** da una regola Semgrep inline produce **un** finding (dedup per fingerprint+categoria), con gitleaks come fonte autoritativa sui segreti.
- **Normalizzazione OWASP** *(L-COL-026)*. I codici OWASP delle **fonti esterne** (regole del registry Semgrep, advisory OSV) emessi su **2021** o come **CWE** sono tradotti in **canonico 2025** prima di popolare il campo `owasp` del finding, secondo la mappa di `07` §3.1; il codice **grezzo** come emesso resta preservato in `owasp_source` (`04` §2) per tracciabilità. Le **regole curate** nostre (`semgrep-ai-ruleset`, §5.1) portano già metadati 2025 e **bypassano** la traduzione. La normalizzazione vive **qui, nell'adapter** — un solo vocabolario di rischio entra nel contesto e nei report.

Stato iniziale di ogni finding normalizzato: `detected` (`04` §5).

## 7. Soglie e gating del controllo 2 *(L-COL-018)*

La scala è a 4 livelli (`04` §4). Il controllo 2 (sicurezza) è verde quando **non ci sono finding nuovi sopra soglia** nelle categorie in scope. Politica per categoria:

| Categoria | Soglia di blocco | Note |
|---|---|---|
| `secret` | **sempre blocca** (qualunque severità, qualunque conteggio) | un segreto è un segreto |
| `rls` | blocca se su tabella **toccata dal macrotask** corrente (BUILD); altrimenti triage | usa `scope_relevance` (`04`) |
| `injection` / `authz` / `crypto` | blocca se ≥ **HIGH** **e** nuovo (delta) | MEDIUM/LOW = advisory |
| `dependency-vuln` | blocca se ≥ **HIGH** **e** nuovo (delta) | detection-only nel set verificato |
| `dead-code` (controllo 1) | blocca se **nuovo** (delta), a prescindere dalla severità | mai cancellato in autonomia |

Le soglie esatte e gli override per progetto vivono in `references/oracles/thresholds.md`.

**Asimmetria BUILD vs REMEDIATE.**
- **BUILD** — il gate è sui finding **introdotti** dal macrotask (delta vs baseline). Il pre-esistente non inchioda all'infinito un build nuovo.
- **REMEDIATE** — non c'è un build da bloccare: gli oracoli alimentano triage (`08`) e il loop di fix. Un finding è "verificato" **per-finding** quando il suo oracolo, riesieguito dopo la fix, torna pulito **e** nessun characterization test si rompe (`05`). È la stessa macchina, promessa diversa (asimmetria onesta, VISION §6).

## 8. Baseline & delta

Rendere applicabile "nessun morto/vuln **nuovo**" (controlli 1–2) richiede un confronto con uno stato di riferimento.

- **Baseline** = snapshot dei finding normalizzati (per `fingerprint`) catturato all'inizio del macrotask (BUILD) o all'inventario (REMEDIATE).
- **Delta** = finding correnti − baseline. Il gating dei controlli 1–2 agisce sui finding **delta-introdotti** sopra soglia; il pre-esistente è marcato `pre-existing` e non blocca (ma è visibile a triage).
- **Dove vive.** Un artefatto locale (es. `.trueline/baseline.json`), referenziato da `SESSION-STATE`. È **meccanismo** di `L-COL-018`, non una policy nuova: nessun nuovo `L-COL` (stessa logica con cui `validate_blueprint` resta meccanismo di `L-COL-019`).

Il fingerprint dev'essere **stabile per riga** (un riformat non deve far risorgere un finding): la definizione è in `04` §6.

## 9. Cosa questo modulo NON copre

- **Controlli 3 e 4** (regressioni, conformità-logica): oracolo = test runner, in `11` (acceptance) e `06` (characterization), non qui.
- **DAST / runtime**: rinviato a v2 *(O-COL-007)*. Tutto è source-side.
- **L'LLM non è mai un oracolo** *(L-COL-002)*. Orchestra l'invocazione, normalizza, prioritizza (`08`), propone patch (`05`); non emette verdetti.

## 10. Eredità ai moduli a valle

- **`04-FINDINGS-MODEL`** — definisce lo schema che `normalize.*` produce e che tutti consumano; co-prodotto con questo modulo.
- **`05-VERIFY-FIX-LOOP`** — riesegue **lo stesso** oracolo dopo la fix; consuma `fix_state`; ospita la policy di retry/scarto *(O-COL-006, Chat C)* e il meccanismo del segreto-in-history.
- **`06-CHARACTERIZATION-TESTS`** — fornisce l'oracolo dei controlli 3–4 in REMEDIATE (baseline comportamentale).
- **`07-CONVENTIONS-THREATMODEL`** — contenuto del ruleset Semgrep curato, pattern vietati, standard RLS nominato.
- **`08-TRIAGE-EXPLANATION`** — prioritizza e spiega i finding (ruolo ristretto dell'LLM).
- **`09-PACKAGING-DISTRIBUTION`** — cosa viaggia nel `.skill` vs dipendenza esterna; preflight; conversione cross-tool.
