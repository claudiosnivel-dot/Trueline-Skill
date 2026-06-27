# Eco-Expansion Fase F5a — Plan (secret-verified per i 7 linguaggi)

> Build via Dynamic Workflow (1 integrator fix_provider Opus [7 fix secret, seriale] ‖ 7 data Sonnet [manifest/registry/verify bump] → verify k=1). Git/gate = orchestratore. `main` intatto.

**Goal:** Promuovere i 7 pack detection F4 a tier **verified** sulla categoria **secret** — primo loop di fix verificato su Go/Ruby/PHP/Java/C#/Dart/Elixir. `verified_set:[secret]`. **Zero oracolo/engine nuovo** (gitleaks è language-agnostic): solo 7 fix-provider additivi + bump manifest/registry/verify. (F5b separato: dead-code-verified postgres-go [Go deadcode] + flutter-dart [dart] — tool ora disponibili.)

**Architecture:** il fix secret è il pattern m5/SP-4 generalizzato: l'oracolo `gitleaks` coglie il secret hardcoded; il fix-provider lo **neutralizza** (sostituisce il letterale con una lettura da env, idioma della lingua); l'oracolo ri-eseguito **0 leak** → `verified`. Keyed via category=`secret` + path/lingua del file del seed.

**Global Constraints:** determinismo; IT prosa/EN id; git solo orchestratore; **BIT-invarianza** (7 rami fix additivi in `fix_provider.mjs`; nessun ramo esistente toccato; 10 verified + m5 invariati). I 7 fix sono **eval-mode deterministici** (zero LLM). Signature distinta per ramo. gitleaks disponibile.

## Fix-provider per-lingua (in `fix_provider.mjs`, additivi)
Ogni `fixSecret<Lang>S1(dir, finding)` sostituisce l'assegnazione hardcoded del seed con una lettura da env (idioma), preservando la sintassi del file; signature `fix-secret-<lang>-s1:<file>`:

| pack | file seed | idioma hardcoded → env |
|---|---|---|
| postgres-go | `main.go` | `const apiKey = "sk_live_…"` → `var apiKey = os.Getenv("API_KEY")` (import os già presente) |
| rails-rb | `config/initializers/api_keys.rb` | `API_KEY = "sk_live_…"` → `API_KEY = ENV.fetch("API_KEY")` |
| laravel-php | `config/services.php` | `'key' => 'sk_live_…'` → `'key' => env('API_KEY')` |
| spring-java | `src/main/resources/application.properties` | `api.key=sk_live_…` → `api.key=${API_KEY}` (placeholder env) |
| dotnet-cs | `Controllers/ItemsController.cs` o `appsettings.json` | `"sk_live_…"` → `Environment.GetEnvironmentVariable("API_KEY")` (cs) / `""` placeholder (json) |
| flutter-dart | `lib/config.dart` | `const apiKey = "sk_live_…"` → `final apiKey = Platform.environment['API_KEY'] ?? ''` (import dart:io) |
| phoenix-ex | `config/config.exs` | `api_key: "sk_live_…"` → `api_key: System.get_env("API_KEY")` |

**Prova del fix (criterio 3):** dopo il fix, `run_gitleaks` ri-eseguito sul working-tree → **0 finding** sul file (il letterale non c'è più). Il contrasto env-read già pulito resta pulito. → `secret = verified`.

## Data per-pack (bump a verified, additivo)
Per ogni `<id>`:
- **Manifest**: `verified_set: ["secret"]` (era `[]`); `version: 1.0.0 → 1.1.0`. Floor invariato. (phoenix-ex floor resta `[secret,dependency-vuln]`.)
- **Registry**: `verified_set:["secret"]`; il difetto `<id>-S1` (secret) → `expected_fix_state: "verified"` (era detection-only); S2 (dep-vuln) e S3 (route-authz) restano detection-only.
- **verify_fix_check.mjs** del pack: clone di un analogo verified (es. `postgres-jsts/verify_fix_check.mjs` che verifica secret via gitleaks); `pickSeed` su S1, assert fix_state=verified.
- **PACK_FIXTURES**: `kind:'detection' → 'verified'` (1 parola per pack in `ecosystem_conformance.mjs`).

## GATE F5a (orchestratore SERIALE)
- Per ogni `<id>`: `ecosystem_conformance <id>` PASS (tier verified, secret→verified via gitleaks; dep-vuln/route-authz restano detection) + **falsificabile** (neutralizzo `fixSecret<Lang>S1` → criterio 3 FAIL → restore).
- No-regressione: 10 verified [DB-runtime deferred F6] + i 7 ora-verified + m1 21/21 + anti_tamper 49/49 + build_discipline 21/21 + `package_skill` lint VERDE (17 pack, i 7 ora `(verified)`) + 0-contaminazione. **engine = solo +7 fix additivi + 7 flip kind (additivo/parola)**.
- Commit di fase (no merge). Ledger: `L-COL-030` fase 2 (promozione verified, nessun lock nuovo); fix per-lingua = raffinamento additivo `L-COL-029`.
