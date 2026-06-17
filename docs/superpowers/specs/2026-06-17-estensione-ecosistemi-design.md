# Design — Estensione di Trueline a nuovi linguaggi/ecosistemi

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Tema** | Estensione multi-ecosistema (oltre il v1 = JS/TS su Supabase) |
| **Data** | 17 giugno 2026 |
| **Stato** | Design approvato (brainstorming). Prossimo passo: writing-plans su **SP-0**. |
| **Risolve** | `O-COL-005` (2° ecosistema → v2) |
| **Dipende da** | `02-SKILL-ANATOMY` (corpo + progressive disclosure), `03-ORACLES`, `04-FINDINGS-MODEL`, `05-VERIFY-FIX-LOOP`, `09-PACKAGING`, `10-EVALUATION` (parity gate), `11-BLUEPRINT-ENGINE` |

---

## 1. Contesto e obiettivo

Il v1 di Trueline supporta **un solo ecosistema**: JavaScript/TypeScript su Supabase (`references/ecosystems/supabase-jsts.md`). Il corpo `SKILL.md` *promette* un punto di estensione ("aggiungi un file in `references/ecosystems/` + il suo ruleset, senza toccare il corpo" — `02` §4 / `09` §4), ma l'engine ha assunzioni JS/TS-Supabase **cablate**: `knip` (dead-code) è JS/TS, il ruleset Semgrep è JS/TS, `detect_runner` conosce solo runner JS, l'RLS checker presume Postgres, il checkpoint controllo 2 cabla la lista degli oracoli.

**Obiettivo:** rendere quel punto di estensione un **fatto**, non uno slogan — così che "supportare un nuovo stack" sia *scrivere dati + (dove serve) un oracolo nuovo*, mai modificare il corpo o la logica dell'engine.

## 2. Requisiti decisi (brainstorming)

- **Driver = roadmap di prodotto.** Nessun target obbligato adesso; si ottimizza valore/effort.
- **Direzione = entrambe.** Sia nuovi *backend* (stesso JS/TS: Firebase, Next.js API, Cloudflare D1…) sia nuovi *linguaggi* (backend Postgres: Python, Go, Ruby…).
- **Barra di supporto = B + pavimento minimo.** Fase 1: ogni ecosistema porta **detection** con una barra minima garantita (`secret` + `dependency-vuln` + `authz-surface`), coverage **sempre dichiarata** (`L-COL-006`). Fase 2: il **loop verificato** si promuove per ecosistema dove l'uso lo giustifica. È la generalizzazione dell'asimmetria già onesta del v1 (injection/authz sono già detection-only con coverage dichiarata).

## 3. Decomposizione del programma

È un **programma**, non una singola feature. Si spezza in:

- **SP-0 — Contratto-ecosistema + engine generalizzato + gate di conformità** *(abilitatore, va per primo)*. Oggetto di questo spec.
- **SP-1 — Primo ecosystem pack (proof)**: lo stack detection più economico-ad-alto-valore, end-to-end, per provare SP-0 contro il gate di conformità.
- **SP-2…N — pack successivi** in ordine roadmap; **fase 2** (loop verificato) promossa dove serve.

Ogni sub-progetto ha il proprio ciclo spec → plan → implementazione. **Questo spec copre SP-0.**

## 4. Approccio scelto

**Ecosystem-as-data (manifest dichiarativo).** L'engine è un interprete generico; un ecosistema è un file di dati che lega *categoria → oracolo* e dichiara lingua/backend/runner/floor/coverage. Codice nuovo **solo** dove un oracolo nuovo è inevitabile (un manifest che lo *lega*). È l'unico approccio che mantiene "aggiungi un file, non toccare il corpo" come fatto e rende la barra-B gate-abile in modo uniforme. (Scartati: adapter-di-codice — più superficie/divergenza; incrementale-minimo — accumula debito e patchwork.)

## 5. Design di SP-0

### 5.1 Il contratto-ecosistema (manifest)

Albero per ecosistema:

```
references/ecosystems/<id>/
  ecosystem.json     ← manifest (macchina): l'engine lo legge
  guide.md           ← prosa per modalità (l'attuale <nome>.md)
  ruleset/           ← regole Semgrep curate per questo ecosistema
```

Bozza dei campi di `ecosystem.json`:

```jsonc
{
  "id": "supabase-jsts",
  "version": "1.0.0",
  "languages": ["js", "ts"],
  "backend": "supabase-postgres",
  "detect": { "files_any": ["supabase/config.toml"], "lang_any": ["package.json"] },
  "triggers": ["supabase", "rls", "secret", "blueprint", "..."],
  "oracles": {
    "secret":          { "tool": "gitleaks", "shared": true },
    "dependency-vuln": { "tool": "osv", "lockfiles": ["package-lock.json", "pnpm-lock.yaml"] },
    "injection|authz|crypto": { "tool": "semgrep", "ruleset": "ruleset/" },
    "dead-code":       { "tool": "knip" },
    "authz-surface":   { "tool": "rls_check", "kind": "postgres-rls", "finding_category": "rls" }
  },
  "test_runner": { "detect": ["vitest", "jest", "node:test"] },
  // floor/verified_set referenziano le CATEGORIE-CONTRATTO (le chiavi di "oracles").
  // Il binding mappa la categoria-contratto alla finding-category concreta
  // (es. authz-surface -> "rls" per postgres) — vedi §10.
  "floor":        ["secret", "dependency-vuln", "authz-surface"],
  "verified_set": ["secret", "authz-surface", "dead-code"],
  "coverage_policy": "declared"
}
```

Il manifest è il **contratto** fra l'engine generico e l'ecosistema. "Supportare uno stack" = scrivere un manifest valido + i suoi oracoli specifici.

### 5.2 Engine generalizzato

Principio: **il codice dell'engine smette di nominare oracoli/tool/categorie; li chiede al manifest risolto.**

- **Nuovo `scripts/ecosystem/resolve.mjs`** (sorgente unica): classifica l'ecosistema attivo provando il `detect` di ogni manifest, carica `ecosystem.json`, espone i binding. Nessun manifest combacia → "ecosistema non supportato", e la skill **non inventa** un audit (`L-COL-006`).
- **`checkpoint.mjs` controllo 2**: itera `manifest.oracles` invece di cablare la lista.
- **Controllo 1 (dead-code)**: `run_deadcode.mjs` diventa dispatcher al tool nominato (`knip`/`vulture`/…).
- **`detect_runner.mjs`**: legge `test_runner.detect` dal manifest.
- **`thresholds.mjs`**: `VERIFIED_ZERO_CATEGORIES` / `CONTROL2_GATE_CATEGORIES` derivano dal manifest attivo (`verified_set` / `floor`), non costanti globali.
- **`SKILL.md` §1–§2**: classificazione e caricamento per-modalità diventano parametrici sull'ecosistema attivo (carica `ecosystems/<attivo>/guide.md`); `detect`/`triggers` vivono nei manifest. **Il corpo resta generico** (< 500 righe, nessuna logica di ecosistema).
- **`normalize.mjs`**: resta generico; namespacing del `rule_id` per ecosistema.

**Astrazione chiave — `authz-surface` (l'"RLS-equivalente").** Categoria che rappresenta *il modello di autorizzazione-dati del backend*: Postgres→RLS (`rls_check`), Firebase→security rules (nuovo `firestore_rules_check`), REST generico→authz-di-rotta (semgrep). Il manifest **lega** quale oracolo la copre: è ciò che fa generalizzare "RLS" senza cablarlo.

### 5.3 Barra B + coverage (tre tier dichiarati e gate-enforced)

- **`floor`**: categorie che ogni ecosistema **deve** almeno *rilevare*. Il gate di conformità rifiuta un pack se una categoria del floor non è legata a un oracolo **e** colta sulla fixture.
- **`verified_set`**: categorie che il loop può portare a `verified` (fase 2). `selectInScope` lo legge dal manifest. Un ecosistema può partire con `verified_set: []` (detection puro) purché il floor sia coperto e la coverage lo dichiari.
- **`coverage_policy: declared`**: il report, per **ogni** categoria, dice `verified` | `detection-only` | `not-covered`. Mai "sicuro".

Relazione: `floor` e `verified_set` sono entrambi sottoinsiemi delle categorie *rilevate*; `floor` = minimo garantito in detection, `verified_set` = sottoinsieme auto-fixabile. Una categoria può stare nel `floor` ma **non** nel `verified_set` (rilevata, mai auto-verificata) — esattamente il trattamento v1 di injection/authz.

**Promozione a fase 2** (categoria detection-only → verified per un ecosistema): aggiungere la categoria a `verified_set` + un fix-provider per quella coppia categoria/ecosistema + la fixture del *verify* parity gate. Niente promozione senza la sua prova.

### 5.4 Gate di conformità (eval parametrizzato per ecosistema)

- **Fixture per ecosistema**: ogni pack porta la sua reference app vulnerabile (nel suo linguaggio/backend) con difetti seminati mappati alle categorie del manifest; minimo di fase 1 = il `floor`. `registry.json` atteso per-ecosistema.
- **Nuovo `eval/harness/ecosystem_conformance.mjs <id>`** che, leggendo il manifest, asserisce:
  1. **Manifest valido** (nuovo `validate_ecosystem.mjs`, gemello di `validate_blueprint`): schema ok; ogni categoria del `floor` legata a un oracolo; `verified_set ⊆ rilevate`; `coverage_policy` presente.
  2. **DETECTION parity** *(sempre)*: ogni difetto seminato è colto **dall'oracolo legato** (non da ispezione LLM); il `floor` è tra questi; coverage dichiarata; mai "sicuro".
  3. **VERIFIED parity** *(solo categorie in `verified_set`)*: raggiungono `verified` (oracolo ri-eseguito pulito + test verdi); le non-`verified_set` mai auto-promosse. `verified_set: []` → soddisfatto a vuoto.
  4. **BUILD parity** *(dove l'ecosistema supporta BOOTSTRAP/BUILD)*: `validate_blueprint` + checkpoint + git-a-strati — agnostici, riusano la logica esistente.
  5. **Triggering**: `triggers`/`detect` del manifest fanno scattare la `description` per questo ecosistema e non fuori scope (generalizza il criterio D, ora data-driven).
  6. **Igiene/no-regressione**: fixture bit-identica, nessun residuo temp, 0 contaminazione (riusa `verify_workspace` + `assertIsolatedRepo`).
- **Definizione di "ecosystem pack conforme"**: manifest valido + detection parity (floor colto) + triggering + coverage dichiarata + (se `verified_set` ≠ ∅) verified parity per quelle categorie + no-regressione su tutti gli altri ecosistemi.
- **Costo (lega alla barra B):** un pack di fase 1 richiede solo manifest + binding + piccola fixture col floor + registry. Niente fix-provider, niente DB-test-verified. La fase 2 aggiunge fixture *verify* + fix-provider (+ DB-test se comportamentale).

### 5.5 Versioning, packaging, ledger

- **Versioning**: ogni ecosistema è un pack versionato (`ecosystem.json.version` + versione ruleset). Il manifest del `.skill` (`09` §4) elenca per-ecosistema id/versione/tier. Aggiungere un pack = minor bump (corpo invariato); SP-0 è additivo (v1 preservato) → minor.
- **Packaging (`09`)**: `package_skill.mjs` impacchetta ogni `ecosystems/<id>/`; il lint strutturale si estende (ogni manifest schema-valido via `validate_ecosystem`; ogni oracolo nominato risolve a wrapper spedito o tool esterno dichiarato; nessun orfano). Oracoli nuovi (vulture, firestore-rules) viaggiano in `scripts/oracles/`; i binari esterni li gestisce il preflight (minimi guidati dal manifest). Conversione cross-tool invariata (il manifest è dati).
- **Ledger (`O-COL-005`)**: SP-0 + i primi pack **sciolgono** `O-COL-005`. Decisione: *"Trueline è multi-ecosistema; gli ecosistemi sono pack versionati governati dal contratto-manifest + gate di conformità."* Due nuovi lock proposti:
  - **`L-COL-029`** — contratto-ecosistema / engine manifest-driven (il corpo non contiene logica di ecosistema).
  - **`L-COL-030`** — barra B: floor in detection + coverage dichiarata + verified come fase 2.

## 6. Confini di SP-0 (cosa NON fa)

- **Non** aggiunge alcun ecosistema concreto nuovo: consegna engine-generalizzato + contratto + gate di conformità + il manifest **retro-descritto** `supabase-jsts` (prova di completezza del contratto). Il primo ecosistema nuovo è SP-1.
- **Non** costruisce oracoli nuovi (vulture, firestore-rules): arrivano con l'ecosistema che li richiede.
- **Non** tocca il comportamento v1; **non** introduce loop verificati per stack nuovi.

## 7. Definizione di "fatto" per SP-0 (acceptance)

- L'engine legge i manifest e dispatcha gli oracoli per binding (nessuna lista cablata).
- Il manifest `supabase-jsts` riproduce il comportamento v1 **identico**: il gate generalizzato `ecosystem_conformance.mjs supabase-jsts` esce **56/56** (l'attuale `m5_gate_check.mjs` ne diventa l'istanza, o ne è avvolto).
- `validate_ecosystem.mjs` + `ecosystem_conformance.mjs` esistono, test-first, e sono verdi.
- Nessuna regressione sui gate `m1…m4` + run_eval; `package_skill` lint VERDE con l'albero `ecosystems/<id>/`.

## 8. Ordine verso SP-1

SP-1 = primo pack detection più economico-ad-alto-valore. Candidati da valutare nel piano di SP-1:
- **Next.js API / REST generico su Postgres**: riusa **tutti** gli oracoli JS/TS; `authz-surface` = authz-di-rotta via semgrep; ~zero oracoli nuovi → il più economico.
- **Python su Postgres**: riusa `rls_check` + gitleaks + osv; serve un wrapper `vulture` (dead-code) + regole Semgrep Python.

La scelta del primo stack si fissa nel piano di SP-1.

## 9. Come si costruisce SP-0

Col metodo del progetto: **milestone via Dynamic Workflows**, **test-first** (ogni task col suo gate scritto prima — `L-COL-019`/`L-COL-027`), **gate = il conformance harness** (dogfooding `L-COL-002`, come M-1…M5). Git solo nell'orchestratore; merge su `main` human-gated (`L-COL-024`).

## 10. Rischi / questioni aperte

- **Forma del manifest** (JSON vs YAML vs modulo JS dati): bozza in JSON; da confermare in fase di piano (coerenza con `validate_blueprint`/finding schema).
- **Due vocabolari di categorie** (da finalizzare nel piano): il manifest usa **categorie-contratto** come chiavi (`secret`, `dependency-vuln`, `authz-surface`, `dead-code`, …); il loop e il finding model (`04`) usano **finding-category** concrete (`secret`, `rls`, `authz`, `dead-code`, …). Il ponte è il campo `finding_category` del binding (es. `authz-surface → rls` per postgres). `floor`/`verified_set` referenziano le categorie-contratto; `selectInScope` le risolve in finding-category via i binding. Da verificare che `authz-surface` come categoria-contratto non confligga coi nomi esistenti in `04`.
- **Fixture multi-linguaggio**: ogni pack porta una piccola reference app nel suo linguaggio → costo di manutenzione delle fixture (mitigato dalla barra B: fixture minime in fase 1).
- **`detect` ambiguo** quando un repo combacia più ecosistemi → regola di precedenza/`chiedi conferma` (coerente con la regola dura di `SKILL.md` §1).
