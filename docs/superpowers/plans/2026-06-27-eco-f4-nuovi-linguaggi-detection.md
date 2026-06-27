# Eco-Expansion Fase F4 — Plan (7 nuovi linguaggi, tier DETECTION)

> Build via Dynamic Workflow (7 data Sonnet ‖ → 1 integrator Opus [7 righe PACK_FIXTURES] → verify k=1). Git/gate = orchestratore. `main` intatto.

**Goal:** 7 ecosystem pack **detection-tier** per nuovi linguaggi/framework — `postgres-go`, `rails-rb`, `laravel-php`, `spring-java`, `dotnet-cs`, `flutter-dart`, `phoenix-ex`. **Pura DATA + 1 riga `PACK_FIXTURES` detection ciascuno** (nessun oracolo/fix nuovo, riuso gitleaks/osv/semgrep).

**Architecture:** modello = `postgres-jsts` (route-authz = authz-surface via **semgrep**; `floor:[secret,dependency-vuln,authz]`, `verified_set:[]`). Hard-gated qui: **classify + secret(gitleaks, language-agnostic) + dependency-vuln(osv, lockfile per-lingua)**. **authz/injection (semgrep) = best-effort** (semgrep assente nel sandbox → degrada onesto, mai falso-verde; come postgres-jsts 36/36 qui). dead-code/route-authz a runtime → **F5/gate F6**.

**Global Constraints:** determinismo; IT prosa/EN id; git solo orchestratore; **BIT-invarianza** (le 7 righe PACK_FIXTURES detection sono additive; nessun edit a oracoli/fix/loop). 10 pack + m5 invariati. Classify: marker di lingua distinti → nessuna collisione.

## Template per-pack (detection)
Per ogni `<id>`:
- **Manifest** `references/ecosystems/<id>/ecosystem.json`: `languages`, `backend`, `detect.lang_any` = il marker di build della lingua (vedi tabella), `oracles`: secret=gitleaks(shared); dependency-vuln=osv(lockfile della lingua); authz=semgrep(ruleset/, role:authz-surface); injection=semgrep(ruleset/); dead-code=tool della lingua (dichiarato, non g-floor). `floor:[secret,dependency-vuln,authz]`; `verified_set:[]`; `coverage_policy:'declared'`. + guide.md (IT) + `ruleset/<id>-authz.yml` (regola semgrep route-authz per quella lingua, best-effort).
- **Fixture** `eval/ecosystems/<id>/reference-app/` (inner .git orchestratore; **niente node_modules**): progetto minimo della lingua con (1) **SEED secret** = una credenziale hardcoded in un file sorgente (gitleaks la coglie, language-agnostic) + contrasto env-read pulito; (2) **SEED dependency-vuln** = un pin REALE vulnerabile nel lockfile della lingua, verificato con `osv-scanner --lockfile <file>`; (3) **SEED route-authz** = una rotta mutante senza auth-guard (semgrep best-effort) + contrasto guarded; (4) test/igiene.
- **Registry** `eval/ecosystems/<id>/registry.json`: `verified_set:[]`; difetti `<ID>-S1` secret→detection-only, `<ID>-S2` dependency-vuln→detection-only, `<ID>-S3` route-authz→detection-only. (Detection ⇒ tutti `expected_fix_state != 'verified'`.)
- **Registrazione** `eval/harness/ecosystem_conformance.mjs` PACK_FIXTURES: `'<id>': { kind:'detection', fixtureApp:…, registry:… }` (1 riga).

## Tabella per-lingua
| id | languages | backend | detect.lang_any | lockfile osv | dead-code (dichiarato) | nota |
|---|---|---|---|---|---|---|
| **postgres-go** | go | postgres | `go.mod` | `go.mod`/`go.sum` | `x/tools/deadcode` (PATH ok) | RLS via `rls_check` riuso possibile (F5); qui detection route-authz |
| **rails-rb** | ruby | rails-app | `Gemfile` | `Gemfile.lock` | debride (unsound→detection-only) | route-authz semgrep GA |
| **laravel-php** | php | laravel-app | `composer.json` | `composer.lock` | Psalm (F5 verified opz.) | semgrep PHP GA |
| **spring-java** | java | spring-app | `pom.xml`/`build.gradle` | `pom.xml`/`gradle` | PMD private (F5 opz.) | (+kotlin opz. futuro) |
| **dotnet-cs** | csharp | aspnet-app | `*.csproj` (verificare match-glob in classify; fallback file concreto) | `packages.lock.json` (abilitarlo) | Roslyn private (F5 opz.) | semgrep C# GA |
| **flutter-dart** | dart | (supabase\|firebase) | `pubspec.yaml` | `pubspec.lock` | `dart analyze`/`dart fix` (F5 verified) | authz = backend reuse (rls/firestore) in F5 |
| **phoenix-ex** | elixir | phoenix-app | `mix.exs` | `mix.lock` | compiler (opz.) | semgrep Elixir experimental → route-authz low-conf/oracolo futuro |

> **⚠ classify dotnet `*.csproj`:** `detect.lang_any` è presence-only su nome-file esatto; un glob `*.csproj` potrebbe non funzionare. Il data agent verifica e, se serve, usa un file concreto (es. `app.csproj`) o aggiunge `global.json`/`Directory.Build.props` come marker. Aggiunge i casi a `resolve.test.mjs` (positivo + negativo) per ogni lingua se la classify non è ovvia.

## GATE F4 (orchestratore SERIALE)
- Per ogni `<id>`: `ecosystem_conformance <id>` PASS (tier detection, ~26; secret+dep-vuln **hard**, authz/injection semgrep **best-effort degradato onesto**) + classify positivo/negativo (criterio 5).
- No-regressione: 10 pack [DB-runtime deferred F6] + m1 21/21 + anti_tamper 49/49 + build_discipline 21/21 + `package_skill` lint VERDE (17 voci) + 0-contaminazione. **engine = solo +7 righe PACK_FIXTURES (additive)**.
- **Gap dichiarato (`L-COL-006`):** route-authz/injection (semgrep) e dead-code per-lingua NON esercitati qui (semgrep + tool assenti) → **best-effort/deferred al gate finale F6** su macchina con semgrep. Ogni dep-vuln pin verificato con osv-scanner reale prima del commit.
- Commit di fase (no merge). Ledger: pack detection = nessun lock (L-COL-029/030 coprono).
