# Ecosystem Expansion — MEGA Dynamic Workflow — TURNKEY BRIEF (per la prossima sessione)

> **Cos'è questo file.** L'input turnkey per la **prossima sessione**: la lista curata e *tiered* degli stack/ecosistemi da implementare, la **decomposizione in task sub-atomici**, e il **design del mega Dynamic Workflow** (a fasi) che li costruisce. Distilla 3 ricerche fondate sul codice (`classify`/engine-boundary, nuovi linguaggi, backend declarativi). La prossima sessione apre questo brief → `superpowers:writing-plans` per fase → mega-workflow → gate SERIALE + merge human-gated, **una fase alla volta**.
>
> **Stato di partenza:** `main` @ `a39884e` (SP-8 mergeato). 5 pack tutti VERIFIED: `supabase-jsts`, `supabase-py`, `postgres-jsts`, `postgres-py`, `firebase-jsts`. Tutte le invarianti `L-COL-001…032` locked.

---

## 0. Framing onesto (leggere prima di tutto)

- **"Implementarli tutti" è illimitato; il valore no.** L'analisi competitiva (`docs/superpowers/competitive/`) dice che **l'ampiezza non è il fossato** — lo è l'intersezione (blueprint-first + oracolo deterministico + verticale RLS + BUILD-discipline). Quindi questo brief **tiera per valore/sforzo/fattibilità** e raccomanda un ordine; non si costruisce ogni combinazione teorica.
- **La regola d'oro dell'engine (vincolo decisivo, da Agent C):** `classify()` in `resolve.mjs` è **presence-only** (`existsSync`, mai legge i contenuti). Conseguenza: **non puoi avere due pack lang-only nella stessa lingua** — collidono per sempre (`{ambiguous}` in Pass 2). Per separare backend nella stessa lingua serve un **file-marker distintivo** (`files_any`), oppure **content-detection additiva** in `resolve.mjs` (Fase 0). Backend identificati solo da una *dipendenza* (`mysql2`, `mongodb`, `@neondatabase/serverless`) o da una *env string* sono **invisibili** al classifier.
- **DETECTION = quasi gratis; VERIFIED = dove vive il costo.** Detection-tier di un pack = **pura data + 1 riga** `PACK_FIXTURES` (manifest auto-discovered). VERIFIED-tier = **+ fix-provider** (`selectKnownFix` branch in `fix_provider.mjs`, eval-only). **Nuovo oracolo TOOL** = **+ 4 dispatch point** (`detectCategory` + `collectFindingsForLoop` + `canonOracle` in `ecosystem_conformance.mjs`, `normalize.mjs`, `rerunOracleFor` in `loop.mjs`).

---

## 1. Il template di task sub-atomici (per OGNI pack)

Da Agent C — l'insieme minimo di artefatti e l'ordine di dipendenza. **Tutto data-driven tranne dove segnato [ENGINE].**

| # | Task atomico | Output | Gate |
|---|---|---|---|
| T1 | **Manifest** `references/ecosystems/<id>/ecosystem.json` | `id, version, languages[], backend, detect{}, triggers[], oracles{}, floor[], verified_set[], coverage_policy:'declared'`; **esattamente 1** binding `role:'authz-surface'`; ogni `floor` bound; `verified_set ⊆ bound` | `validate_ecosystem.mjs` exit 0 |
| T2 | **Ruleset** `references/ecosystems/<id>/ruleset/<id>-authz.yml` *(solo se authz = semgrep route-authz)* | regole semgrep + `.test.mjs` | smoke su fixture: coglie il SEED, 0 FP sul contrasto |
| T3 | **Fixture** `eval/ecosystems/<id>/reference-app/` (inner-`.git`, `SEED:<id>` markers + contrasti puliti 0-FP, lockfile, manifest-lingua perché `classify` risolva) + `registry.json` | seeds → categorie del `floor` (+ verified_set) | `fixture_check`/manuale |
| T4 | **PACK_FIXTURES** entry in `eval/harness/ecosystem_conformance.mjs` **[ENGINE, 1 riga]** | `'<id>': { kind:'detection'\|'verified', fixtureApp, registry }` | parse OK |
| T5 | *(solo nuovo oracolo)* oracolo + `normalize` branch + dispatch **[ENGINE, 4 punti]** | `scripts/oracles/<x>_check.mjs` + `normalizeX` + alias + `rerunOracleFor` case + `detectCategory`/`collectFindingsForLoop` arm | oracolo-test |
| T6 | *(solo VERIFIED)* fix-provider `selectKnownFix` branch + fix fn **[ENGINE/eval]** + `verify_fix_check.mjs` | `fixX(dir, finding)` keyed su `(category, file-pattern)` + verify gate | oracolo ri-eseguito PULITO → `verified` |
| T7 | **Gate milestone** | — | `node eval/harness/ecosystem_conformance.mjs <id>` PASS (detection: ~26 / verified: ~34-40) + **no-regressione** (`m5` 56/56 + 5 pack invariati) + 0-contaminazione |

**Riusi a costo zero (solo dichiarazione nel manifest):** gitleaks (secret, language-agnostic), osv (dependency-vuln, lockfile-driven — **sempre floor-only**, mai verified), `rls_check` (Postgres RLS, riconosce `auth.uid()` E `current_setting()`), `firestore_rules_check` (declarative), `run_semgrep` wrapper (il pack porta il suo `ruleset/`), `fixRlsPgS3` (RLS-transfer). **`GO_BIN` è già sul PATH** del runner (Go pronto).

---

## 2. Roadmap curata e *tiered* (la lista)

> Legenda valore: 🟢 alto (capacità nuova) · 🟡 medio · 🔴 basso (quasi-duplicato). Effort: S/M/H. Classify: ✅ pulito (marker/lingua) · ⚠️ collisione (serve Fase 0 o propose+confirm).

### Tier 1 — costruire (alto valore, fattibili)

| Pack | Lang × Backend | Tier | Oracolo authz | Nuovo codice | Effort | Valore | Classify |
|---|---|---|---|---|---|---|---|
| **firebase-py** | py × Firebase | verified | `firestore_rules_check` **riuso intero** | solo fixture/registry; fix-provider FB-S1/S3 (keyed-by-path) **già funzionano** per py; secret/dead-code py esistono | **S** | 🟢 | ✅ tie-break lingua (come supabase-py) |
| **supabase-storage-jsts** (+py) | js/py × Supabase Storage | verified | **estendi `rls_check`** (token `owner`/`storage.foldername` + `RLS005_PUBLIC_BUCKET`) | no nuovo file; +CWE map; branch storage in fix RLS | **S** | 🟢 | ✅ (sotto supabase) — valutare se *fold* nei pack supabase invece di pack nuovo |
| **appwrite-jsts** | js × Appwrite | verified | **nuovo** `appwrite_perms_check` (JSON, `JSON.parse`) | oracolo + normalize + fix (`("any")`→`("users")` + `documentSecurity:true`) | **S/M** | 🟢 | ✅ `appwrite.json` |
| **pocketbase-jsts** | js × PocketBase | verified | **nuovo** `pocketbase_rules_check` (JSON) | oracolo (⚠️ **trappola**: `null`=safe, `""`=floor) + normalize + fix | **S/M** | 🟢 | ✅ `pb_schema.json` |
| **postgres-go** | **Go** × Postgres | verified | `rls_check` **riuso** | dead-code Go (`x/tools/deadcode`, già su PATH) wrapper + `go_deadcode_edit.mjs` + `fixSecretGoS1`; **RLS-transfer riusa `fixRlsPgS3`** | **H** (ship floor-only prima) | 🟢🟢 **flagship nuova lingua full-verified** | ✅ `go.mod` |

### Tier 2 — costruire (medio valore / più parsing)

| Pack | Lang × Backend | Tier | Oracolo authz | Nuovo codice | Effort | Classify |
|---|---|---|---|---|---|---|
| **hasura-jsts** | js × Hasura | verified | **nuovo** `hasura_metadata_check` + **YAML reader dep-free** | oracolo + reader + normalize + fix (`filter:{}`→owner, o droppa la perm anon) | **M** | ✅ `metadata/` |
| **amplify-jsts** (Gen1) | js × AppSync/Amplify | verified | **nuovo** `appsync_auth_check` (SDL `@auth`) | oracolo + normalize + fix (`allow:public`→`owner`); **Gen2 = detection-only** | **M** | ✅ `amplify/` |
| **flutter-dart** | **Dart** × (Supabase\|Firebase) | verified | **riuso** `rls_check`/`firestore_rules_check` per backend | dead-code Dart (`dart analyze --format=json`, first-party) + editor/`dart fix` + `fixSecretDartS1` | **M** | ✅ `pubspec.yaml` |
| **laravel-php** | **PHP** × app | detection→verified[secret] | route-authz **semgrep (GA)** + ruleset | ruleset Laravel + `fixSecretPhpS1`; (opz. Psalm dead-code verified) | **M** | ✅ `composer.json` |
| **spring-java** (+kt) | **Java/Kotlin** × app | detection→verified[secret] | route-authz **semgrep (GA / kt beta)** + ruleset | ruleset Spring + `fixSecretJavaS1`; (opz. PMD/detekt private dead-code) | **M** | ✅ `pom.xml`/`build.gradle` |
| **dotnet-cs** | **C#** × app | detection→verified[secret] | route-authz **semgrep (GA)** + ruleset | ruleset ASP.NET + `fixSecretCsS1`; lockfile va abilitato nel fixture (`packages.lock.json`); (opz. Roslyn private dead-code) | **M** | ✅ `*.csproj` |
| **rails-rb** | **Ruby** × app | detection→verified[secret] | route-authz **semgrep (GA)** + ruleset | ruleset Rails + `fixSecretRubyS1`; **dead-code DETECTION-only** (debride unsound) | **M** | ✅ `Gemfile` |
| **phoenix-ex** | **Elixir** × app | detection→verified[secret] | semgrep **experimental** → valutare **nuovo oracolo router/plug** | authz oracle (o ruleset low-conf) + `fixSecretElixirS1`; (opz. compiler dead-code) | **M/H** | ✅ `mix.exs` |

### Tier 3 — NoSQL / route-authz nuovo (richiede risposta al collision in Fase 0)

| Pack | Lang × Backend | Oracolo authz | Nuovo codice | Effort | Valore | Classify |
|---|---|---|---|---|---|---|
| **cloudflare-d1-jsts** | js × Cloudflare D1/Workers | route-authz semgrep | ruleset: `env.DB.prepare(SQL)` sink + **Workers `fetch(req,env)` context** | **M/H** | 🟡🟢 | ✅ `wrangler.toml` (marker reale) |
| **mongodb-jsts/py** | js/py × MongoDB | route-authz semgrep | ruleset: `insertOne/updateOne/deleteOne/findOneAndUpdate` + Mongoose | **M/H** | 🟢 | ⚠️ collisione (no marker) |
| **dynamodb-jsts/py** | js/py × DynamoDB | route-authz semgrep | ruleset: `PutItemCommand/UpdateItemCommand/DeleteItemCommand` (no SQL) | **M/H** | 🟢 | ⚠️ collisione |

### NON costruire come pack (basso valore / rompono `classify`)

- **Neon, CockroachDB, YugabyteDB** — *sono già* `postgres-jsts`/`postgres-py` (collidono in classify). Azione: aggiungerli ai `triggers[]` dei manifest postgres + doc d'equivalenza.
- **MySQL/PlanetScale, SQLite/Turso, MSSQL** — quasi-duplicato route-authz + collisione. Meglio: **pattern-sink aggiuntivi in un ruleset route-authz condiviso**, non pack interi.
- **Convex, Cloudflare-D1-*declarativo*** — authz **imperativa** (funzione/route), nessun floor statico → instradare a semgrep code-level, **niente fix verified**.

---

## 3. Fase 0 — prerequisiti engine (prima dei pack che collidono)

Due abilitazioni additive, da fare **prima** del Tier 3 NoSQL:
1. **Content-detection in `resolve.mjs`** — un nuovo `detect.deps_any` (sniffa `package.json`/`requirements.txt` per nomi-dipendenza) o `detect.content_any`, così MongoDB/DynamoDB/MySQL si distinguono da postgres senza marker. Additivo, default-invariante (i pack esistenti non lo usano). *Alternativa minima:* accettare `{ambiguous}` → la skill fa propose+confirm (già supportato) — **niente engine code**, ma UX peggiore.
2. *(opzionale)* **`detect.files_glob`** se serve il match-glob per `*.csproj` (verificare come `classify` gestisce i glob; C# potrebbe già funzionare via `lang_any` sul nome concreto).

> Le altre fasi (Tier 1/2) **non richiedono Fase 0** (classify pulito via marker o lingua).

---

## 4. Design del MEGA Dynamic Workflow (a FASI)

**Principio (disciplina del progetto):** *una milestone = un workflow + un gate SERIALE + un merge human-gated.* Un mega-workflow monolitico che mergea tutto in un big-bang viola questo. Quindi il "mega workflow" è una **SEQUENZA di workflow per-fase**, ciascuna = un fan-out parallelo di **pipeline per-pack**; l'orchestratore integra+gata+mergia **tra le fasi**.

### Struttura per-pack (pipeline, dentro una fase)
`pipeline(packs, build→verify(k=2)→…)` — ma siccome i pack condividono file engine (`ecosystem_conformance.mjs`, `fix_provider.mjs`, `normalize.mjs`, `loop.mjs`), **gli edit engine vanno serializzati o isolati** (worktree per-agent, `isolation:'worktree'`) per evitare conflitti di scrittura. Raccomandazione: **i task data-puri (manifest/fixture/registry/ruleset) in parallelo**; **gli edit ENGINE (PACK_FIXTURES line, dispatch points, fix-provider) coordinati dall'orchestratore** (o un solo agente "integratore" per fase che applica tutti gli edit engine in sequenza dopo i build data).

### Le fasi (ordine raccomandato)
| Fase | Pack | Perché qui |
|---|---|---|
| **F1** | `firebase-py` + `supabase-storage` | massimo riuso, zero/quasi nuovo oracolo, classify pulito — *prova il template* |
| **F2** | `appwrite-jsts` + `pocketbase-jsts` | oracoli JSON near-clone di firestore (parallelizzabili, oracoli indipendenti) |
| **F3** | `hasura-jsts` + `amplify-jsts` | declarativi con costo di parsing (YAML/SDL) |
| **F4** | nuovi linguaggi **detection-floor** in parallelo: `postgres-go`(floor) · `rails-rb` · `laravel-php` · `spring-java` · `dotnet-cs` · `flutter-dart` · `phoenix-ex` | detection = pura data + ruleset; fan-out ampio, basso rischio |
| **F5** | **promozioni verified** dei linguaggi fattibili: `postgres-go` (dead-code+RLS), `flutter-dart` (dead-code), `laravel-php` (Psalm) + secret-verified per gli altri | dove vive il costo (fix-provider + AST editor) |
| **F0→F6** | **Fase 0** (content-detect) → poi `cloudflare-d1` · `mongodb-*` · `dynamodb-*` | NoSQL/route-authz, dopo il prereq detect |

**Model policy** (`DYNAMIC-WORKFLOWS §5`): verifier **sempre Opus k=2** (BIT-invarianza è il rischio #1 ad ogni edit engine); builder **Opus** per oracoli/fix-provider/dispatch (delicati), **Sonnet** per manifest/fixture/registry/ruleset (data/meccanici). **Niente Haiku.**

**Gate per-pack** (in-workflow runnable dove possibile): `validate_ecosystem` + oracolo-test + `ecosystem_conformance <id>`. **La verità è il gate SERIALE dell'orchestratore** (lezione ricorrente: il green/red sotto concorrenza del workflow non è la verità — vedi T7 di SP-8, falso-rosso da knip-assente).

**Git solo nell'orchestratore** (`L-COL-024`): provisioning inner-`.git` dei fixture (+ `npm install` dei tool dead-code dove serve, es. knip già fatto per firebase; per i nuovi linguaggi: il tool dead-code va installato/disponibile), commit per-pack, merge **human-gated** per-fase.

---

## 5. Avvertenze load-bearing (dai 3 agenti — non perderle)

- **PocketBase:** `null` = stato SICURO (locked), `""` = floor pubblico. Un oracolo che tratta `null` come "missing→public" è **esattamente al contrario**. Test obbligatorio: `null` NON produce finding.
- **firebase-py:** il caso più pulito — i fix-provider FB-S1 (`serviceAccount.json`)/FB-S3 (`firestore.rules`) sono **keyed-by-path, non per lingua** → già pronti per Python; i rami secret(`app/config.py`→`os.getenv`)/dead-code(vulture) Python esistono. Verified ≈ zero nuovo codice fix.
- **dead-code per lingua (fattibilità verified-symbol-removal):** Go **HIGH** (`x/tools/deadcode` ufficiale, su PATH), Dart **HIGH** (`dart analyze` first-party + `dart fix`), PHP **MED** (Psalm); C#/Java/Elixir **private-only MED**; **Ruby LOW → detection-only** (metaprogramming rende ogni detector unsound). I 3 dispatch-point dead-code (`run_deadcode.mjs` `SUPPORTED_TOOLS`, `normalize.mjs` adapter, `rerunOracleFor`) sono hard-coded knip/vulture → ogni nuovo tool li estende.
- **semgrep maturità (governa la qualità route-authz):** GA Go/Ruby/Java/PHP/C#; Kotlin beta; **Dart/Elixir experimental** → per Dart usa il backend-oracle (rls/firestore), per Elixir valuta un **nuovo oracolo router/plug** invece di semgrep.
- **Convex & Cloudflare-D1 declarativo:** nessun floor statico → **niente oracolo declarativo, niente verified**; route-authz/semgrep al più.
- **osv è sempre floor-only** (mai verified — non c'è fix-provider per dependency-vuln).
- **Amplify Gen2 / Spring-Kotlin / DynamoDB:** confidenza più bassa → detection-first, promozione verified solo con prova.

---

## 6. Kickoff prossima sessione (primo movimento)

1. `PROMPT-SESSION-START` (recupero contesto: `SESSION-STATE` → questo brief).
2. **Decidi lo scope della run** con l'utente: tutte le fasi in sequenza, o un sottoinsieme prioritario (raccomandato: **F1→F3** prima — alto valore, basso rischio; poi F4/F5 linguaggi; F0/F6 NoSQL per ultimo).
3. Per la fase scelta: `superpowers:writing-plans` → plan code-complete (task sub-atomici del template §1 per ogni pack della fase) su branch nuovo `feat/eco-<fase>`.
4. Authoring del workflow di fase (mirror di SP-8: build data in parallelo, edit engine coordinati, verifica Opus k=2).
5. `Workflow` → poi T-final orchestratore (provisioning + gate SERIALE per-pack + no-regressione integrale + ledger + merge human-gated).
6. **Ledger:** ogni pack detection = nessun lock (`L-COL-029/030` coprono); ogni promozione verified = `L-COL-030` fase 2 applicata. Nuovi oracoli/fix = raffinamenti additivi di `L-COL-029`. Eventuale **content-detection (Fase 0)** potrebbe meritare una nota di riconciliazione (raffina `L-COL-029` `classify`).

> **Scaffold dello script** (struttura a fasi + pipeline per-pack + template prompt): `docs/superpowers/workflows/2026-06-27-ecosystem-megaworkflow-SCAFFOLD.js` — da raffinare per-fase la prossima sessione (NON eseguire così com'è: è uno scheletro).
