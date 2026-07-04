# modes/remediate.md — Trueline · modalità REMEDIATE

> Caricato **solo** quando il dispatch risolve a REMEDIATE (`02` §6). Bonifica
> del brownfield: remediation piena, non solo detection (`01` §3.3, `L-COL-023`).

---

## Quando

Codice sorgente sostanziale **senza** blueprint né `SESSION-STATE`. Nei casi
ambigui il corpo **chiede conferma** prima di modificare codice (`01` §2,
`L-COL-005`).

**Promessa REMEDIATE** (asimmetria onesta, VISION §6): il controllo di
conformità-logica **degrada** a *invarianza comportamentale* — "fa ancora ciò
che faceva", non "è giusto". Non esiste un blueprint contro cui misurare la
correttezza. Detto in chiaro all'utente; niente falso "via libera" (`L-COL-006`).

---

## Reference e script caricati in REMEDIATE (`02` §6)

**Reference (livello 3, on demand):**

| File | Perché |
|---|---|
| `references/build-discipline.md` | disciplina di *costruzione* — in REMEDIATE attivi i momenti **1+3** + la disciplina di fix; il momento 2 test-first è superato dalla baseline di caratterizzazione (`L-COL-031`) |
| `references/oracles/thresholds.md` | soglie di severità per il checkpoint e budget del loop |
| `references/oracles/semgrep-ai-ruleset/` | ruleset Semgrep curato (vendorizzato, offline) |
| `references/conventions/named-standards.md` | vocabolario OWASP 2025 / ASVS / CWE + standard RLS |
| `references/conventions/forbidden-patterns.md` | catalogo dei pattern vietati (spec del ruleset) |
| `references/conventions/threat-model.md` | enumerazione adversariale per delimitare il percorso critico dei characterization test |
| `references/finding-model.md` | schema dei finding: contratto tra oracoli, loop e triage (`04`) |
| `references/ecosystems/supabase-jsts/guide.md` | specifiche dell'ecosistema attivo (risolto da `scripts/ecosystem/resolve.mjs`; esempio v1: supabase-jsts) |

Non si caricano in REMEDIATE: `references/blueprint/` (non c'è un blueprint),
`references/blueprint/template/` (non si genera un piano), `references/blueprint/self-check-checklist.md`.

**Script usati:**

| Script | Funzione |
|---|---|
| `scripts/oracles/run_semgrep.mjs` | Semgrep + ruleset curato |
| `scripts/oracles/run_gitleaks.mjs` | segreti in working tree **e nella history** |
| `scripts/oracles/run_osv.mjs` | CVE nelle dipendenze (lockfile) |
| `scripts/oracles/rls_check.mjs` | RLS checker custom su migration DDL |
| `scripts/oracles/run_deadcode.mjs` | knip (primario) / ts-prune / depcheck |
| `scripts/findings/normalize.mjs` | output nativo → finding model |
| `scripts/findings/baseline.mjs` | snapshot dei finding per il delta di sessione |
| `scripts/findings/prioritize.mjs` | ordina i finding (triage) |
| `scripts/findings/explain.mjs` | spiegazione in linguaggio semplice |
| `scripts/findings/fp_policy.mjs` | policy conservativa falsi positivi (`L-COL-028`) |
| `scripts/triage/triage.mjs` | orchestra prioritizzazione + spiegazione |
| `scripts/characterization/detect_runner.mjs` | rileva il test runner del progetto |
| `scripts/characterization/generate.mjs` | genera characterization test sul percorso critico |
| `scripts/characterization/partition.mjs` | partiziona le asserzioni in guardia vs impattate |
| `scripts/characterization/stabilize.mjs` | stabilizza output non-deterministici |
| `scripts/characterization/rls_characterize.mjs` | caratterizzazione comportamento RLS (richiede DB di test) |
| `scripts/characterization/coverage.mjs` | emette la dichiarazione di copertura della baseline |
| `scripts/loop/run_loop.mjs` | loop di verifica della fix (per finding rossi) |
| `scripts/loop/loop.mjs` | macchina a stati del loop per-finding |
| `scripts/loop/verify_workspace.mjs` | verifica che il workspace sia pulito prima del loop |
| `scripts/git/layered_git.mjs` | modello git a strati |

---

## Pipeline (`01` §3.3)

### 0. Preflight delle dipendenze (prima di tutto, `01` §4)

**Primissima azione, prima di qualunque oracolo.** `scripts/preflight.mjs`
**controlla** le dipendenze (`gitleaks`/`osv-scanner`/`semgrep`/`knip`; `rls_check`
è built-in), **le installa project-local** — `--install --target=project`,
consent-gated → `<progetto>/.trueline/bin/` (gitignorato) — e **ti comunica i
non-installabili** con i passi/comandi manuali (il controllo dipendente degrada a
*not-run*, mai un verde finto, `L-COL-006`). Nessun oracolo dei passi 3–5 parte
prima che lo stato delle dipendenze sia chiaro.

### 1. Inventario

Struttura del codebase, ecosistema, superfici (edge function, route, tabelle
RLS-governate, storage, webhook, confine client supabase-js). Alimenta i passi
successivi e il perimetro del percorso critico.

### 2. Baseline di caratterizzazione (percorso critico)

Genera i characterization test con `scripts/characterization/generate.mjs`
(`06-CHARACTERIZATION-TESTS`). Sul **percorso critico del v1** (JS/TS + Supabase):

1. Raggio d'azione delle fix in scope: regioni di codice adiacenti ai finding del
   set verificato-a-zero (`secret`, `rls`, `dead-code`).
2. Auth e isolamento per tenant: comportamento governato da RLS, la categoria
   killer di Supabase.
3. Superficie API pubblica / endpoint che mutano dati: `request → response`
   (forma, status) sui percorsi user-facing principali.

**Tipo di caratterizzazione per tipo di codice:**

| Tipo | Tecnica |
|---|---|
| Funzioni ~pure | golden-master / snapshot `input → output` |
| Endpoint / handler | `richiesta → risposta` (corpo, status, header rilevanti) |
| Comportamento RLS | pattern di accesso attuale (chi legge/scrive cosa) — richiede DB di test; senza DB degrada a checker statico + `scripts/characterization/rls_characterize.mjs` |
| Codice con effetti collaterali | effetti osservabili via test double, o dichiarato fuori copertura |

La baseline deve essere **verde sul codice corrente** per costruzione. Un
characterization test rosso subito è mal scritto: si corregge.

**Stabilizzazione** (`scripts/characterization/stabilize.mjs`): output
non-deterministici (clock, RNG, rete) vengono stabilizzati dove possibile;
quelli non stabilizzabili sono dichiarati fuori copertura.

**Dichiarazione di copertura** (`scripts/characterization/coverage.mjs`): la
baseline accompagna sempre una dichiarazione di cosa è caratterizzato e cosa no.
L'assenza di un characterization test non significa "sicuro da cambiare": significa
che quel comportamento non è sotto rete.

La skill **propone** il perimetro da caratterizzare → **gate umano** (`L-COL-005`)
prima di procedere.

### 3. Lancia gli oracoli

Gira la batteria completa:

- `scripts/oracles/run_semgrep.mjs` — injection, authz mancante, crypto debole, sink pericolosi, segreti inline.
- `scripts/oracles/run_gitleaks.mjs` — segreti in working tree **e nella history** git (in REMEDIATE la history è in scope, `03` §5.2).
- `scripts/oracles/run_osv.mjs` — CVE nelle dipendenze dichiarate nel lockfile.
- `scripts/oracles/rls_check.mjs` — tabelle senza RLS, policy mancanti, isolamento finto.
- `scripts/oracles/run_deadcode.mjs` — file, export, dipendenze non referenziati.

`scripts/findings/normalize.mjs` converte ogni output nativo nel finding model
(`references/finding-model.md`), normalizzando OWASP a 2025 (`L-COL-026`).
`scripts/findings/baseline.mjs` calcola il delta rispetto all'inventario iniziale.

**Segreto nella history:** se gitleaks lo trova, il finding va a
`mitigated-residual` dopo la rotazione della chiave — mai `verified` senza
riscrittura della history (che è distruttiva → gate umano, `L-COL-024`).
Vedi `05-VERIFY-FIX-LOOP` §7.

### 4. Triage e spiegazione

`scripts/triage/triage.mjs` (che chiama `prioritize.mjs` + `explain.mjs` +
`fp_policy.mjs`) — il ruolo dell'LLM è ristretto:

**Può:**
- prioritizzare i finding secondo la funzione d'ordine documentata (`08` §3):
  `blocca-sempre (secret) ▸ nuovo & sopra-soglia ▸ in-scope ▸ severità ▸ categoria-killer (rls/authz) ▸ pre-existing in coda`
- tradurre in linguaggio semplice citando standard nominati (non aggettivi):
  "cos'è / perché conta / dove / direzione della fix".
- segnalare un sospetto falso positivo con evidenza concreta e abbassarne la priorità.

**Non può:**
- cambiare `severity` o `category`, marcare `verified`, sopprimere finding,
  liquidare un FP senza evidenza controllabile (`L-COL-028`).

FP confermato dall'umano → si codifica nell'allowlist che l'oracolo legge, non
nel contesto dell'LLM (la soppressione è dell'oracolo, `L-COL-002`).

### 5. Propone fix human-gated + loop di verifica

`scripts/loop/run_loop.mjs` applica il loop di `05-VERIFY-FIX-LOOP`:

```
per ogni finding fixabile (in ordine di triage):
  proponi patch → gate umano (L-COL-005) → applica sul branch
  → identifica asserzioni impattate vs guardia (scripts/characterization/partition.mjs)
  → gate umano: approva fix + conferma comportamento post-fix atteso per le impattate
  → applica → aggiorna asserzioni impattate al comportamento atteso
  → riesegui lo stesso oracolo + riesegui i characterization test
    (guardia: devono restare verdi; impattate: verdi sul nuovo atteso)
  → finding → verified (solo se oracolo pulito + guardia verde + impattate verdi)
  → se ancora rosso: retry ≤ 2 (O-COL-006) con patch materialmente diversa + revert
  → budget esaurito → terminale → umano (accepted-risk / fix manuale)
quando tutti i finding fixabili sono chiusi:
  ri-valuta il checkpoint intero
  verde → commit per-fix (cita fingerprint + stato raggiunto) → aggiorna SESSION-STATE
  rosso (una fix ne ha introdotto uno nuovo) → rientra nel loop
```

**Disciplina di fix — root-cause-before-patch** (`build-discipline.md` §3,
`L-COL-031`): prima di ri-editare nel loop RED, modella l'intorno e la **causa
radice** del finding, poi applica la **patch minima** che la attacca — evita il
difetto "sporco su sporco". Advisory, mai gate: il re-run dello **stesso** oracolo
emette il verdetto (`L-COL-002`).

**Invariante chiave (06-CHARACTERIZATION-TESTS §4):** un'asserzione-guardia rotta
dopo la fix = regressione → `verification-failed`. Un'asserzione-impattata deve
aggiornare il comportamento atteso (gate umano) — non va letta come regressione,
perché la fix *intende* cambiare quel comportamento.

**Budget:** `MAX_RETRIES_PER_FINDING = 2` + `GLOBAL_WALL_CLOCK_MS` come da
`references/oracles/thresholds.md` §5.

**Set verificato-a-zero** (`L-COL-010`): `secret`, `rls`, `dead-code`. Per le
categorie detection-only (`injection`, `authz`, `crypto`, `dependency-vuln`) la
skill in REMEDIATE può comunque proporre fix (remediation piena, `L-COL-023`),
ma il finding porta `verified` **per-finding**, non eleva la categoria a
"verificata-a-zero" a livello d'app. La coverage declaration lo dichiara.

### 6. Git a strati

Lavora su branch (`trueline/remediate/<data>`). Commit per-fix (cita
`fingerprint` + `fix_state`). Il merge su `main` resta un **"vai" umano**
(`L-COL-024`): pubblicare una bonifica la cui correttezza non è ancorata a un
intento è qualcosa che la skill non fa da sé.

---

## Disciplina REMEDIATE

- **Disciplina di costruzione** (`references/build-discipline.md`, `L-COL-031`): in
  REMEDIATE sono attivi i momenti **1 (gate delle assunzioni)** e **3 (scrittura
  minima e chirurgica)** + la **disciplina di fix root-cause-before-patch** sul
  loop RED (§5). Il **momento 2 (test-first che traduce l'AC) è superato** dalla
  baseline di caratterizzazione (§2, `06`): non c'è un blueprint con
  `acceptance_criteria` da tradurre, e non si scrive un test-che-fallisce-prima per
  una fix — la rete è la caratterizzazione del comportamento corrente
  (partizione guardia/impattate). Guida la scrittura, non giudica (`L-COL-002`).
- **Oracle-as-judge** (`L-COL-002`): nessun finding è "risolto" perché l'LLM lo
  dichiara; solo l'oracolo riesieguito pulito + test verdi portano a `verified`.
- **Characterization come prerequisito** (`L-COL-004`): nessuna fix su codice
  non testato senza prima la baseline; la copertura dichiarata è parte del risultato.
- **Triage/FP conservativo** (`L-COL-028`): nel dubbio si tiene il finding;
  un FP liquidato per errore è un falso via libera.
- **Promessa degradata dichiarata** (`L-COL-006`): "oracolo pulito + tutto il
  resto invariato", mai "l'app è sicura".
- **Merge human-gated** (`L-COL-024`): il raggio di incertezza di una bonifica
  brownfield non giustifica il merge autonomo.
- **Preflight project-local** (`L-COL-005`): prima di scaricare i binary-release
  degli oracoli (gitleaks/osv-scanner project-local in `<project>/.trueline/bin/`)
  la skill assicura che `.trueline/` sia nel `.gitignore` del progetto, così i
  binari scaricati non finiscono nel versionato.
- **Degradazione semgrep dichiarata** (`L-COL-006`): se semgrep non è disponibile
  (né docker né python/pip/pipx) i controlli `injection`/`authz` **degradano** a
  *not-run*, dichiarato all'utente — mai un verde finto.

---

## Uscita

Finding chiusi (per categoria e budget) + coverage declaration emessa.
`SESSION-STATE` aggiornata con il lotto di remediation e l'esito per finding.
