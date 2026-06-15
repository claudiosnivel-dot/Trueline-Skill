# 07-CONVENTIONS-THREATMODEL — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Versione** | v0.2 (Chat D — OWASP 2025 canonico) |
| **Data** | 13 giugno 2026 |
| **Copre** | `L-COL-012` (cardine); serve `002`, `008`, `010`, `018` |
| **Dipende da** | `01-ARCHITECTURE` v0.1, `02-SKILL-ANATOMY` v0.1 (§4 `references/conventions/`), `03-ORACLES` v0.2 (§5.1, §5.4, §6 — la mappatura che questo modulo riempie), `04-FINDINGS-MODEL` v0.2 (campi `category`/`owasp`/`owasp_source`/`cwe`) |

---

## 1. Perché questo modulo esiste

`L-COL-012`: **standard nominati + pattern vietati in un reference; il threat model è un input che la Skill esegue.** La ragione è la stessa che regge tutta la skill — sostituire gli **aggettivi** ("sicuro", "robusto", "ben fatto") con **citazioni verificabili**. Quando l'LLM spiega *perché* un finding conta (`08`) o scrive le `security_notes` di un task (`11` §3), deve poter puntare a uno standard nominato e a un pattern enumerato, non al proprio parere.

Questo modulo è anche il punto in cui `03` "scarica" ciò che aveva solo **mappato**: il **contenuto** del ruleset Semgrep curato (`03` §5.1) e lo **standard RLS** contro cui misura il checker (`03` §5.4). Qui quei contenuti vengono **enumerati**.

> **Confine `L-COL-002`, da tenere fermo.** Due dei tre artefatti sono **lato-oracolo**: i *pattern vietati* sono regole che **Semgrep esegue** (deterministiche), lo *standard RLS* è la specifica contro cui gira il **checker** (deterministico). Gli *standard nominati* sono il **vocabolario** che le spiegazioni citano. Il **threat model** è l'unico pezzo dove l'LLM "ragiona" di sicurezza: per questo è definito come **procedura di enumerazione che produce *scope*, non verdetti** (§6). Una superficie è "sicura" se i controlli oracolari passano su di essa — mai perché il threat model lo dichiari.

## 2. I tre artefatti

Vivono in `references/conventions/` (`02` §4) e si caricano **per modalità attiva** (`02` §6: pieni in BUILD e REMEDIATE, parziali in BOOTSTRAP per scrivere le `security_notes`).

| File | Contenuto | Lato |
|---|---|---|
| `named-standards.md` | OWASP Top 10:**2025** (canonico) + mappa di normalizzazione dal 2021/CWE emesso, ASVS 5.0.0, CWE, **standard RLS nominato** (§5) | vocabolario |
| `forbidden-patterns.md` | catalogo dei pattern vietati = **spec del ruleset Semgrep curato** (§4) | oracolo (Semgrep) |
| `threat-model.md` | procedura di enumerazione adversariale: **input + livello di fiducia + categorie OWASP** (§6) | scoping (LLM-assistito, non giudice) |

## 3. Standard nominati *(`references/conventions/named-standards.md`)*

Principio: **niente aggettivi, solo riferimenti.** Ogni finding e ogni spiegazione si àncora a uno di questi.

### 3.1 OWASP Top 10 — tassonomia di rischio

L'edizione **canonica e unica** di Trueline è **OWASP Top 10:2025** (finale da gennaio 2026), che rimpiazza la 2021. Ogni finding e ogni spiegazione si esprime in codici **2025** — non c'è doppia titolazione. Cambi rilevanti per Trueline: **SSRF assorbita in A01 Broken Access Control**, **Injection scesa ad A05**, **Software Supply Chain Failures** (A03) nuova categoria che espande le vecchie "componenti vulnerabili".

Vincolo di realtà: le nostre **regole curate** (`semgrep-ai-ruleset`, §4) le scriviamo noi e portano già metadati **2025**. Ma le fonti **esterne** che non controlliamo — regole del registry Semgrep, advisory OSV — taggano ancora su **2021** o su **CWE** e non passeranno a 2025 a breve. Trueline le **normalizza al confine dell'adapter**: il codice grezzo si traduce in 2025 prima di popolare il campo `owasp` del finding, e l'originale resta preservato per tracciabilità (vedi **`L-COL-026`**; l'emendamento a `03`/`04` — l'adapter normalizza i codici OWASP esterni → 2025, campo `owasp` canonico-2025 + nuovo `owasp_source` — è stato **applicato in Chat E**; `03`/`04` ora a v0.2). La tabella sotto è quindi la **mappa di normalizzazione** (emesso → canonico), non una doppia titolazione:

| `category` Trueline | Emesso da fonti esterne (2021/CWE) | **Canonico 2025** |
|---|---|---|
| `rls` / `authz` | A01:2021 Broken Access Control | **A01:2025** Broken Access Control |
| `injection` | A03:2021 Injection | **A05:2025** Injection |
| `crypto` | A02:2021 Cryptographic Failures | **A04:2025** Cryptographic Failures |
| `secret` | A07:2021 / A02:2021 | **A07:2025** Authentication Failures / **A02:2025** Security Misconfiguration |
| `dependency-vuln` | A06:2021 Vulnerable & Outdated Components | **A03:2025** Software Supply Chain Failures |
| `config` / `misc` | A05:2021 Security Misconfiguration | **A02:2025** Security Misconfiguration |
| sink SSRF (in `injection`/`misc`) | A10:2021 SSRF | **A01:2025** (assorbita) |
| `dead-code` | — (igiene) | — (igiene) |

La mappa copre **solo** le categorie a cui gli oracoli di Trueline arrivano; non riproduce l'intera lista 2025.

### 3.2 OWASP ASVS 5.0.0 — requisiti verificabili

ASVS è lo standard naturale per uno strumento di **verifica**: dà requisiti **testabili**, non aggettivi. Versione corrente **5.0.0** (maggio 2025). Formato di citazione **`v5.0.0-<capitolo>.<sezione>.<requisito>`** (es. `v5.0.0-1.2.5` = prevenzione OS command injection via query parametrizzate). Nota: ASVS 5.0 ha **rimosso le mappe dirette a CWE** dalla lista principale; per la precisione sul "tipo di debolezza" usiamo CWE separatamente (§3.3).

Mappa per **topic** (i numeri di capitolo 5.0 si citano al momento della scrittura della regola, qui si nomina il topic):

| Concern Trueline v1 | Topic ASVS 5.0 |
|---|---|
| `injection` (SQL/command/PostgREST) | Encoding & Sanitization → **Injection Prevention** |
| `authz` / `rls` | **Access Control / Authorization** |
| `crypto` (random, hashing, confronti) | **Cryptography** |
| `secret` (gestione segreti/config) | **Configuration & Secret Management** |
| validazione input lato server | **Validation & Business Logic** |
| autenticazione / token | **Authentication / Self-contained Tokens** |

Uso: una `security_notes` di task (`11`) e una spiegazione di finding (`08`) possono citare il requisito ASVS pertinente come **criterio**, non come opinione.

### 3.3 CWE — tassonomia di debolezza

Il campo `cwe` del finding (`04`) porta l'identificatore preciso della debolezza (es. CWE-89 SQL injection). È ciò che rende un finding **non ambiguo** a chi lo legge e ciò che lega un pattern vietato (§4) alla sua famiglia.

### 3.4 Standard RLS nominato

È **nostro** (specifico Supabase/Postgres), enumerato per intero in **§5**, ancorato alla guida ufficiale Supabase. È lo standard contro cui misura il checker di `03` §5.4.

### 3.5 Come gli standard vengono *usati*

- **Gli oracoli mappano** i loro finding su questi standard: le regole curate (`semgrep-ai-ruleset`) via `metadata.owasp`/`cwe` **già in 2025**; il RLS checker contro lo standard §5; OSV via CVE/GHSA. I codici OWASP **legacy** provenienti da fonti esterne (registry Semgrep, OSV) sono **normalizzati a 2025** (§3.1) prima di popolare il campo `owasp`.
- **L'LLM cita** (non inventa): in `08` per il "perché conta", in `11` per le `security_notes`. Lo standard è il **prior vincolato** che `L-COL-012` impone al posto degli aggettivi.

## 4. Pattern vietati *(`references/conventions/forbidden-patterns.md`)*

Questo è il **contenuto del ruleset Semgrep curato** che `03` §5.1 aveva solo mappato: la **specifica** delle regole (le regole YAML vere si scrivono all'implementazione, dopo Chat E; il blueprint ne fissa il contenuto). Ogni voce: **anti-pattern vietato → controparte sicura (bersaglio della fix) → OWASP 2025 / CWE → severità** (scala `04` §4). Tutto JS/TS + Supabase.

Forma di una regola (sketch unico, poi catalogo in tabella):

```yaml
# references/oracles/semgrep-ai-ruleset/secrets/service-role-clientside.yml
rules:
  - id: col-secret-service-role-clientside
    languages: [typescript, javascript]
    severity: ERROR                      # → CRITICAL (04 §4)
    metadata: { category: secret, owasp: "A07:2025", cwe: "CWE-798" }
    message: >
      service_role key usata fuori da contesto server-side: bypassa RLS,
      espone l'intero DB. Usare la anon key lato client; service_role solo
      server-side con authz applicativa esplicita.
    patterns:
      - pattern-either:
          - pattern: createClient(..., process.env.SUPABASE_SERVICE_ROLE_KEY, ...)
          - pattern: createClient(..., "$SERVICE_ROLE_LITERAL", ...)
      # …vincoli di contesto client-side nella regola reale
```

### 4.1 Segreti inline / chiavi hardcoded — `category: secret`

Rete ridondante a gitleaks (dedup per fingerprint, `03` §6); la regola Semgrep cattura il *pattern d'uso*, non solo l'entropia.

| Vietato | Sicuro (bersaglio) | OWASP25 / CWE | Sev |
|---|---|---|---|
| Chiave/segreto come **string literal** assegnato a `key`/`secret`/`token`/`password`/connection string | da `process.env` / `Deno.env.get`, mai committato | A07 / **CWE-798** | HIGH/CRIT |
| **service_role key** hardcoded o usata lato client | anon key lato client; service_role **solo** server-side | A07·A01 / **CWE-798** | **CRITICAL** |
| Private key / PEM inline | secret store / env; rotazione | A02 / CWE-321 | CRITICAL |

### 4.2 Injection — `category: injection`

| Vietato | Sicuro (bersaglio) | OWASP25 / CWE | Sev |
|---|---|---|---|
| SQL per **concatenazione**/template con input (`pg.query(\`… ${x}\`)`) | query **parametrizzate** (`$1`), tagged template con binding | A05 / **CWE-89** | HIGH |
| `child_process.exec(\`… ${x}\`)` / shell con input | `execFile` con **array di argomenti**, no shell | A05 / **CWE-78** | HIGH |
| **PostgREST filter injection**: input interpolato in `.or("…")`/`.filter("…")` di supabase-js | `.eq()`/`.in()` tipati con valori **validati**; mai interpolare in `.or()` | A05 / **CWE-89** | HIGH |

### 4.3 Authz mancante su route mutanti — `category: authz`

Sottigliezza Supabase: **RLS è ottima difesa, ma la service_role la bypassa** → un handler con service_role **deve** fare authz propria.

| Vietato | Sicuro (bersaglio) | OWASP25 / CWE | Sev |
|---|---|---|---|
| Handler che **scrive** (INSERT/UPDATE/DELETE o mutation) **senza** check identità/ruolo | verifica `auth.getUser()`/JWT prima della mutation | A01 / **CWE-862** | HIGH |
| Mutation con **client service_role** senza authz applicativa | client **user-scoped** (RLS attiva) o authz esplicita | A01 / **CWE-285** | HIGH |
| Edge Function che muta senza validare il JWT del chiamante | valida il token, deriva l'identità, poi muta | A01 / CWE-306 | HIGH |

### 4.4 Crypto debole / confronti non timing-safe — `category: crypto`

| Vietato | Sicuro (bersaglio) | OWASP25 / CWE | Sev |
|---|---|---|---|
| `Math.random()` per token/segreti | `crypto.randomUUID()` / `getRandomValues` / `randomBytes` | A04 / **CWE-338** | HIGH |
| MD5/SHA-1 per password | `bcrypt`/`scrypt`/`argon2` | A04 / **CWE-327** | HIGH |
| `==`/`===` su segreti/HMAC/token | `crypto.timingSafeEqual` | A04 / **CWE-208** | MEDIUM |

### 4.5 Sink pericolosi — `category: injection` / `config`·`misc`

| Vietato | Sicuro (bersaglio) | OWASP25 / CWE | Sev |
|---|---|---|---|
| `eval` / `new Function` / `setTimeout("stringa")` | nessuna esecuzione di stringhe; logica esplicita | A05 / **CWE-95** | HIGH |
| Deserializzazione non sicura di input | parser sicuri, schema validato | A08 / CWE-502 | HIGH |
| `fetch(userUrl)` non validato (**SSRF**) | allowlist di host/schemi; no redirect ciechi | **A01** / **CWE-918** | HIGH |
| Path da input non sanificato (file/storage) | normalizza + confina a base dir | A01 / **CWE-22** | HIGH |
| Merge/assign di oggetti da input (prototype pollution) | `Object.create(null)`, guardie su `__proto__` | A05 / CWE-1321 | MEDIUM |

> **Confine.** I pattern vietati sono il **sottoinsieme staticamente rilevabile**. Ciò che richiede ragionamento (es. "questo endpoint *dovrebbe* essere admin-only?") **non** è una regola Semgrep: emerge dall'**enumerazione** (§6) e diventa una `security_notes` (`11`) o un finding **detection-only**, non un verde automatico.

## 5. Standard RLS nominato *(parte di `named-standards.md`)*

Formalizza la riga di `03` §5.4 nell'intero standard, ancorato alla guida ufficiale Supabase. Ogni provvedimento è etichettato per **come si verifica**: `[statico]` dal RLS checker (`03` §5.4), `[DB-test]` richiede il DB di test di `06` §6.1, `[advisory]` igiene/performance non bloccante.

> **Lo standard.** *Ogni tabella `public`/user-facing ha RLS abilitato e almeno una policy che vincola l'accesso per identità/tenant (`auth.uid()`/`tenant_id`); l'isolamento finto e l'uso client-side della service_role sono vietati.*

| # | Provvedimento | Verifica |
|---|---|---|
| R1 | RLS **abilitato** su ogni tabella `public`/user-facing (senza, è pubblica via Data API/PostgREST) | `[statico]` |
| R2 | RLS abilitato ⇒ **≥1 policy** (niente deny-all silenzioso che "rompe" l'app senza errori) | `[statico]` |
| R3 | **Niente `USING (true)`/`WITH CHECK (true)`** su tabelle user-facing; **niente** `auth.uid() IS NOT NULL` come sola condizione (= tutti gli autenticati) | `[statico]` |
| R4 | Le policy **vincolano per identità/tenant** (`auth.uid() = user_id` / derivazione `tenant_id`) — la correttezza della logica multi-tenant | `[DB-test]` |
| R5 | Clausola **`TO authenticated`** (o ruolo appropriato) specificata, non implicita/pubblica | `[statico]` |
| R6 | Una **UPDATE policy** è accompagnata da una **SELECT policy** (Postgres deve leggere la riga per valutare `USING`) | `[statico]` |
| R7 | **service_role** confinata server-side, con **authz applicativa esplicita** (bypassa RLS) — overlap con §4.3 | `[statico]` + `[DB-test]` |
| R8 | Funzioni **`SECURITY DEFINER`** fanno authz propria (altrimenti chiunque le chiama bypassa RLS) | `[statico]` |
| R9 | Performance: `(select auth.uid())` per cache initPlan; colonne di policy **indicizzate** | `[advisory]` |

**Confine di copertura dichiarato** *(L-COL-006, da `03` §5.4)*: lo static-first **non vede** lo schema modificato solo dal dashboard Supabase e non riversato in migration. Il checker **lo dichiara** ("verificato contro le migration dichiarate; tabelle assenti dalle migration non coperte") — non riempie il vuoto con una stima.

**Trappola del test** *(lega `06` §6.1)*: l'SQL Editor di Supabase gira come superuser e **bypassa RLS** — testare RLS lì dà un falso verde. La verifica comportamentale di R4/R7 va fatta **attraverso il client con auth reale** su un DB di test, non nell'editor.

## 6. Threat model = enumerazione adversariale *(`references/conventions/threat-model.md`)*

`L-COL-012`: *il threat model è un input che la Skill **esegue***. Non è prosa su cui l'LLM medita: è una **procedura** che produce un'enumerazione strutturata e ne ricava **scope**, non verdetti.

### 6.1 La triade — input + livello di fiducia + categorie OWASP

- **Input** — ogni punto in cui un dato **attraversa un confine di fiducia**: body/query/params HTTP, header, token auth, payload di webhook, config da env, upload, **filtri forniti dal client a supabase-js**, argomenti RPC, subscription realtime.
- **Livello di fiducia** — *untrusted* (client/rete/anon), *semi-trusted* (utente autenticato, altro servizio, webhook a firma verificata), *trusted* (config server, migration, contesto service-role). Il livello **fissa l'asticella** di validazione/authz richiesta.
- **Categorie OWASP** — ogni coppia (superficie × fiducia) mappa alle categorie applicabili (§3.1) → che mappano ai **controlli oracolari** (regole §4, RLS checker §5).

### 6.2 La procedura (step che la Skill esegue)

1. **Inventario delle superfici** (strutturale, deterministico dove può): Edge Functions, route/handler API, funzioni RPC, tabelle governate da RLS, confine client supabase-js, storage, realtime, webhook.
2. Per ogni superficie, **identifica gli input e il loro livello di fiducia**.
3. **Mappa** a categorie OWASP e ai **controlli concreti** che le coprono.
4. **Segnala** le superfici dove il controllo applicabile è detection-only o richiede ragionamento → diventano `security_notes` (`11`) / **percorso critico** (`06` §5), non verde automatico.

### 6.3 Catalogo delle superfici (Supabase/JS-TS, v1)

| Superficie | Input tipici | Fiducia default | OWASP25 | Controllo |
|---|---|---|---|---|
| Edge Function / route handler | body, query, header, JWT | untrusted→semi | A01·A05 | Semgrep (§4.2/4.3), authz |
| Tabella RLS-governata | filtri client, scritture | untrusted (via anon) | A01 | RLS checker (§5) |
| Funzione RPC / `SECURITY DEFINER` | argomenti | semi | A01 | RLS §5 (R8), Semgrep |
| Client supabase-js (`.or`/`.filter`) | stringhe di filtro | untrusted | A05 | Semgrep (§4.2) |
| Storage / upload | file, path, content-type | untrusted | A01·A05 | Semgrep (§4.5), policy |
| Realtime subscription | canali, filtri | semi | A01 | RLS §5 |
| Webhook in ingresso | payload, firma | untrusted finché non verificata | A07·A01 | authz, firma |
| Config da env | variabili | trusted (ma `secret` se inline) | A02·A07 | gitleaks, Semgrep §4.1 |

### 6.4 Come l'output è consumato — e il confine `L-COL-002`

- **BOOTSTRAP** usa l'enumerazione per scrivere le `security_notes` dei task (`11` §3): ogni task che tocca dati/auth nomina la considerazione RLS/segreti pertinente.
- **BUILD/REMEDIATE** la usano per **puntare la batteria oracolare alle superfici giuste** e per **delimitare il percorso critico** (`06` §5).
- L'enumerazione è **LLM-assistita** (l'LLM legge la struttura del codice e enumera superfici/input/fiducia), ma **il verdetto su ogni superficie resta dell'oracolo**: il threat model produce **scope**, mai un "via libera". È l'unico punto dove l'LLM ragiona di sicurezza, e proprio per questo il confine è esplicito — *enumera e delimita, non assolve*.

## 7. Rapporto con il checkpoint e consumo

- **Controllo 2 (sicurezza)**: i pattern vietati (§4) sono le regole Semgrep; lo standard RLS (§5) è la spec del checker. Le **soglie** (cosa blocca) vivono in `03` §7 / `thresholds.md`, **non** qui: questo modulo decide *cosa* si controlla e *contro quale standard*, non *quando* blocca.
- `08` cita gli standard nominati nelle spiegazioni; `11` ne trae le `security_notes`; `06` usa l'enumerazione per delimitare il percorso critico (e condivide il confine di copertura RLS di §5).

## 8. Cosa questo modulo NON copre / non è

- **Un solo nuovo lock: `L-COL-026`** (OWASP Top 10:**2025** come tassonomia canonica **unica** + normalizzazione delle fonti esterne al confine dell'adapter). Per il resto, standard nominati, pattern vietati, standard RLS ed enumerazione restano **meccanismo/contenuto di `L-COL-012`** — coerente con la sobrietà di Chat B/C (`validate_blueprint` resta meccanismo di `L-COL-019`, ecc.). `L-COL-026` ha comportato un **piccolo emendamento a `03`/`04`** (l'adapter normalizza; il campo `owasp` diventa canonico-2025 con il codice grezzo preservato in `owasp_source`): **applicato in Chat E**; `03`/`04` ora a **v0.2**.
- **Non giudica** *(L-COL-002)*: il threat model delimita, gli oracoli decidono.
- **Niente DAST/runtime** *(O-COL-007 → v2)*; l'enforcement RLS a runtime passa dal DB di test di `06` §6.1, non da qui.
- **Soglie e override** non sono qui (`03` §7).

## 9. Eredità ai moduli a valle

- **`08-TRIAGE-EXPLANATION`** — le spiegazioni citano gli standard nominati (§3); la gestione dei falsi positivi si appoggia ai pattern/standard per giustificare un sospetto-FP con evidenza.
- **`11-BLUEPRINT-ENGINE`** — le `security_notes` dei task derivano dall'enumerazione (§6); il punto 9 del self-check semantico (`11` §5.2, "baseline di sicurezza") mappa qui.
- **`06-CHARACTERIZATION-TESTS`** — il percorso critico (§5) è delimitato dall'enumerazione; condiviso il confine di copertura RLS.
- **`09-PACKAGING-DISTRIBUTION`** — i tre reference viaggiano nel `.skill`; il ruleset Semgrep vendorizzato (`references/oracles/semgrep-ai-ruleset/`) si costruisce da §4.
- **`10-EVALUATION`** — ogni vulnerabilità seminata nella reference app deve mappare a un pattern vietato (§4) / provvedimento RLS (§5) / superficie enumerata (§6); l'eval verifica che il ruleset le colga.
