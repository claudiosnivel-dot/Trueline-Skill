# 04-FINDINGS-MODEL — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Versione** | v0.2 (Chat B; emendata in Chat E — `L-COL-026`) |
| **Copre** | `L-COL-011` (cardine del modulo); serve `002`, `003`, `006`, `018`, `021`, `026` |
| **Dipende da** | `01-ARCHITECTURE` v0.1 §6 (il finding model è "il contratto") · **co-prodotto con** `03-ORACLES` (che lo produce) |

---

## 1. Perché esiste un solo schema

Il finding model è **l'unico contratto** fra le tre componenti che toccano un problema rilevato: gli oracoli che lo trovano (`03`), il loop che lo corregge (`05`), il triage che lo prioritizza e lo spiega (`08`) — come fissato in `01` §6. La ragione è `L-COL-011`: l'LLM **ragiona su questo oggetto strutturato**, non sul rumore grezzo dei tool né sui propri prior. Convertire il pattern-matching in ragionamento vincolato sui fatti è esattamente ciò che impedisce all'LLM di ricadere nel ruolo di giudice *(L-COL-002)*.

Conseguenza pratica: qualunque oracolo aggiungeremo (anche in v2) normalizza **dentro** questo schema. Nel contesto dell'LLM entra il finding model, mai il dump nativo del tool (parsimonia di token, `L-COL-007`).

## 2. Lo schema

Campi del finding (i sette nominati in `L-COL-011` — categoria, severità, file, riga, evidenza, fonte-oracolo, stato-fix — più i campi che li rendono operabili):

| Campo | Tipo | Significato |
|---|---|---|
| `fingerprint` | string | Identità **stabile-per-riga** del finding; chiave del baseline-delta (§6). |
| `id` | string | Handle leggibile locale al run (es. `F-014`); non è l'identità persistente. |
| `category` | enum | Categoria chiusa (§3). |
| `severity` | enum | `CRITICAL` / `HIGH` / `MEDIUM` / `LOW` (§4). |
| `location` | object | `{ file, start_line, end_line, symbol? }`. La riga è **display**; l'identità è il fingerprint. |
| `evidence` | string | Snippet/messaggio **redatto** (mai il valore di un segreto, §7). |
| `source_oracle` | object | `{ oracle, tool_version, rule_id }` — chi l'ha prodotto. |
| `owasp` | string? | Codice OWASP **canonico 2025** *(L-COL-026)* quando l'oracolo o l'adapter lo forniscono; le fonti esterne 2021/CWE sono normalizzate (`03` §6, mappa in `07` §3.1). |
| `owasp_source` | string? | Codice OWASP/CWE **grezzo** come emesso dalla fonte (es. `A01:2021`, `CWE-89`), preservato per tracciabilità. **Display/audit**, non usato per il gating. |
| `cwe` | string? | Identificatore CWE preciso della debolezza, quando l'oracolo lo fornisce (Semgrep metadata, CVE OSV). |
| `fix_state` | enum | Stato nel ciclo di vita della fix (§5). |
| `baseline_status` | enum | `new` / `pre-existing` rispetto alla baseline (calcolato al checkpoint, §6). |
| `scope_relevance` | enum | `in-scope` / `out-of-scope` rispetto al codice toccato dal macrotask corrente (BUILD). |
| `remediation_hint` | string? | Suggerimento da oracolo o da convenzione (`07`); **non** è un verdetto dell'LLM. |
| `run_id` / `created_at` | string | Tracciamento del run che l'ha prodotto. |
| `notes` | string? | Metadati di triage (`08`) — rationale di priorità; **mai** un "via libera". |

Forma canonica (JSON):

```json
{
  "fingerprint": "rls:no-rls:supabase/migrations/0003_bookings.sql:public.bookings",
  "id": "F-007",
  "category": "rls",
  "severity": "HIGH",
  "location": { "file": "supabase/migrations/0003_bookings.sql", "start_line": 12, "end_line": 12, "symbol": "public.bookings" },
  "evidence": "CREATE TABLE public.bookings (...);  -- nessun ENABLE ROW LEVEL SECURITY",
  "source_oracle": { "oracle": "rls-check", "tool_version": "0.1.0", "rule_id": "rls-missing" },
  "owasp": "A01:2025",
  "owasp_source": "A01:2021",
  "cwe": "CWE-285",
  "fix_state": "detected",
  "baseline_status": "new",
  "scope_relevance": "in-scope",
  "remediation_hint": "ENABLE ROW LEVEL SECURITY + policy che vincola per auth.uid()/tenant",
  "run_id": "2026-06-13T10:04:00Z#cp-prenotazioni",
  "notes": null
}
```

> **Nota OWASP canonico** *(L-COL-026)*. Il campo `owasp` è **sempre** in codici **2025**; il codice come emesso dalla fonte (2021/CWE) resta in `owasp_source`. La traduzione avviene **nell'adapter** (`03` §6), sulla mappa di `07` §3.1; le regole curate emettono già 2025. Spiegazioni (`08`) e report (§10) citano **solo** il 2025 — niente doppia titolazione.

## 3. Tassonomia delle categorie

Set **chiuso**. Ogni categoria mappa all'oracolo che la produce, a OWASP/CWE dove sensato, e dichiara se è nel **set verificato-a-zero** del v1 *(L-COL-010)* o **detection-only**.

| `category` | Oracolo | OWASP 2025 | Set v1 |
|---|---|---|---|
| `secret` | gitleaks (+ Semgrep) | A07 / A02 | **verificato** *(con il caveat history, §5)* |
| `rls` | RLS checker | A01 | **verificato** |
| `dead-code` | knip (+ fallback) | — (igiene) | **verificato** (rimozione, gate umano) |
| `injection` | Semgrep | A05 | detection-only |
| `authz` | Semgrep | A01 | detection-only |
| `crypto` | Semgrep | A04 | detection-only |
| `dependency-vuln` | osv-scanner | A03 | detection-only *(bump ri-verificabile → candidato v2)* |
| `config` / `misc` | Semgrep | varie | detection-only |

"Verificato-a-zero" significa: la skill, per quella categoria, esegue il loop di fix verificata (`05`) e presenta la correzione solo quando l'oracolo riesieguito azzera il finding **e** nessun test si rompe. "Detection-only" significa: trovato, spiegato, prioritizzato, **non** corretto automaticamente — coerente con `L-COL-010`. In REMEDIATE la skill può comunque **proporre** fix anche per le categorie detection-only (remediation piena, `L-COL-023`), ma queste non sono "verificate-a-zero": vale l'invarianza comportamentale, non la garanzia sulla categoria.

## 4. Scala di severità e mapping nativo

Quattro livelli, normalizzati dall'output nativo di ogni oracolo:

| Livello | Significato | Effetto di default sul gate (controllo 2) |
|---|---|---|
| `CRITICAL` | sfruttabile, alto impatto, basso sforzo | blocca (se nuovo / categoria sempre-blocca) |
| `HIGH` | sfruttabile o grave isolamento mancante | blocca (se nuovo) |
| `MEDIUM` | rischio reale ma condizionato | advisory |
| `LOW` | igiene / basso impatto | advisory |

Mapping dalla severità nativa:

| Oracolo | Nativo → livello |
|---|---|
| Semgrep | `ERROR`→HIGH *(CRITICAL se la regola è marcata tale nei metadata)* · `WARNING`→MEDIUM · `INFO`→LOW |
| gitleaks | sempre `secret`: CRITICAL (chiavi cloud/DB) o HIGH (token generici) — **comunque sempre-blocca** |
| osv-scanner | CVSS ≥9 → CRITICAL · 7.0–8.9 → HIGH · 4.0–6.9 → MEDIUM · <4 → LOW |
| RLS checker | RLS assente / `USING (true)` / `auth.uid()` mancante → HIGH · policy assente (deny-all) → MEDIUM |
| knip / fallback | dead-code → LOW/advisory **per severità**; ma il **controllo 1 blocca per *delta*** (nuovo morto), non per severità (§6, e `03` §7) |

Distinzione da tenere ferma: il **controllo 2** (sicurezza) gate per **severità ≥ soglia + nuovo**; il **controllo 1** (dead-code) gate per **delta** (nuovo morto introdotto), indipendente dalla severità.

## 5. Stato della fix (`fix_state`)

Ciclo di vita chiuso. **Solo l'oracolo** può portare un finding a `verified`; l'LLM non lo fa mai *(L-COL-002, L-COL-003, L-COL-006)*.

| Stato | Significato |
|---|---|
| `detected` | trovato dall'oracolo, intatto. |
| `triaged` | prioritizzato/spiegato dall'LLM (`08`), ancora non corretto. |
| `fix-proposed` | patch proposta, in attesa del gate umano *(L-COL-005, L-COL-021)*. |
| `fix-applied` | patch applicata sul branch (dopo il gate umano). |
| `verified` | oracolo riesieguito **pulito** **e** nessun test rotto. **L'unico stato comunicabile come "trovato e verificata la correzione".** |
| `verification-failed` | il re-run flagga ancora, o un test si è rotto → torna a `fix-proposed`/retry, o scarto (retry policy `O-COL-006`, Chat C). |
| `mitigated-residual` | mitigazione fatta ma residuo non azzerabile dall'oracolo senza azione distruttiva — es. **segreto ruotato, residuo in git history** (la riscrittura di storia è distruttiva → gate umano, `L-COL-024`). **Non** è `verified`: framing onesto, niente falso via libera *(L-COL-006)*. |
| `accepted-risk` | l'umano decide di accettare il finding; registrato, **mai** scartato in silenzio. |

Transizioni ammesse (testo):

```
detected → triaged → fix-proposed → fix-applied → {verified | verification-failed}
verification-failed → fix-proposed   (entro la retry policy)  | → accepted-risk
secret (history) → fix-applied(rotazione) → mitigated-residual → [opz. history rewrite, gate umano] → verified
qualsiasi → accepted-risk            (decisione umana esplicita)
```

> La **copertura** è un'affermazione diversa dallo stato di un finding. Le categorie che nessun oracolo copre **non** sono finding in stato qualunque: sono dichiarate nella *coverage declaration* del report (§10). Non si riempie il vuoto con una stima dell'LLM *(L-COL-006)*.

## 6. Identità e baseline-delta (`fingerprint`)

Il fingerprint è l'identità persistente del finding fra run, e deve essere **stabile alla deriva delle righe**: spostare codice o riformattare un file non deve far "risorgere" un finding come nuovo.

Composizione: `hash(oracle, rule_id, normalized_path, match_signature)` — dove `match_signature` è un'**ancora di contenuto** (es. il simbolo/identificatore coinvolto, o un hash dello snippet normalizzato), **non** il numero di riga assoluto. La riga vive solo in `location` come informazione di display.

Baseline-delta (meccanismo di `L-COL-018`, vedi `03` §8):

- `baseline_status = new` se il fingerprint **non** è nello snapshot di baseline; `pre-existing` se c'è.
- I controlli 1–2 fanno gate sui finding `new` sopra soglia; i `pre-existing` sono visibili a triage ma non bloccano (in BUILD), per non inchiodare un build nuovo sul debito pregresso.

## 7. Redazione e privacy

- **Segreti mai in chiaro.** `evidence` per un `secret` è redatta a monte (gitleaks `--redact`, `03` §5.2); il valore non entra nel finding e quindi non entra nel contesto.
- **Snippet minimi.** L'evidenza è la porzione necessaria a capire e localizzare, non interi file.
- **Nulla esce dall'ambiente** *(L-COL-013)*. Il finding model è un artefatto locale; ciò che entra nel contesto dell'LLM è l'oggetto strutturato, non il rumore grezzo *(L-COL-007, L-COL-011)*.

## 8. Esempi

**Segreto in history → `mitigated-residual`:**

```json
{
  "fingerprint": "secret:aws-access-key:src/lib/storage.ts:AKIA****REDACTED",
  "id": "F-002", "category": "secret", "severity": "CRITICAL",
  "location": { "file": "src/lib/storage.ts", "start_line": 4, "end_line": 4 },
  "evidence": "const KEY = \"AKIA****REDACTED\"",
  "source_oracle": { "oracle": "gitleaks", "tool_version": "8.x", "rule_id": "aws-access-token" },
  "owasp": "A07:2025", "owasp_source": "A07:2021", "fix_state": "mitigated-residual",
  "baseline_status": "pre-existing", "scope_relevance": "out-of-scope",
  "remediation_hint": "ruota la chiave; rimozione dalla history richiede rewrite (distruttivo, gate umano)",
  "notes": "ruotata il 13/06; residuo nei commit < HEAD~40"
}
```

**Dead code introdotto dal macrotask (`new` → blocca controllo 1):**

```json
{
  "fingerprint": "dead-code:unused-export:src/api/bookings.ts:legacyValidate",
  "id": "F-011", "category": "dead-code", "severity": "LOW",
  "location": { "file": "src/api/bookings.ts", "start_line": 88, "end_line": 96, "symbol": "legacyValidate" },
  "evidence": "export function legacyValidate(...) { ... }  // 0 referenze",
  "source_oracle": { "oracle": "knip", "tool_version": "5.x", "rule_id": "unused-export" },
  "fix_state": "fix-proposed", "baseline_status": "new", "scope_relevance": "in-scope",
  "remediation_hint": "rimuovi l'export (gate umano; verifica import dinamici)",
  "notes": "blocca il controllo 1 perché nuovo, non per severità"
}
```

## 9. Come i moduli lo consumano

- **`03-ORACLES`** lo **produce** (via `normalize.*`), calcola `fingerprint` e setta `fix_state: detected`.
- **`05-VERIFY-FIX-LOOP`** muove `fix_state` lungo il ciclo §5; è l'unico posto dove l'**oracolo** promuove a `verified`.
- **`08-TRIAGE-EXPLANATION`** legge il modello, prioritizza, scrive `notes`/`triaged`; non altera mai `severity` né emette verdetti.
- **Il checkpoint** (`01` §4) legge `severity` + `baseline_status` + `scope_relevance` per calcolare verde/rosso dei controlli 1–2.
- **`10-EVALUATION`** asserisce, sulla reference app: ogni problema seminato compare come finding **da oracolo**; il set verificato raggiunge `verified`; le categorie non coperte sono **dichiarate**.

## 10. Report e framing *(L-COL-006)*

Il finding model alimenta un report che parla sempre per fatti verificati:

- **Stati comunicabili come positivi**: solo `verified` ("trovato e verificata la correzione di X") e "questi controlli sono passati" (checkpoint verde). Mai "la tua app è sicura", mai "sei a posto".
- **Coverage declaration** sempre presente: elenca le categorie **non coperte** dagli oracoli in scope, così l'assenza di finding **non** viene letta come prova di sicurezza. È il gemello, lato report, dell'asimmetria onesta della VISION §6.
- `mitigated-residual` e `accepted-risk` sono mostrati per quello che sono — mitigazioni e rischi accettati, non verifiche.

## 11. Eredità ai moduli a valle

- **`05`** — macchina a stati del loop, retry/scarto (`O-COL-006`), gestione del segreto-in-history.
- **`08`** — triage, spiegazione in linguaggio semplice, gestione conservativa dei falsi positivi.
- **`10`** — il modello è ciò che i due parity gate ispezionano per dichiarare il v1 "fatto" (VISION §10).
