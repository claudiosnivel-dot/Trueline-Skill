# 10-EVALUATION — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) — ex codename *Collaudo* |
| **Versione** | v0.1 (Chat E) |
| **Data** | 14 giugno 2026 |
| **Copre** | **VISION §10** (i due parity gate — cardine); **`O-COL-006`** (taratura numerica del budget); `L-COL-009` (eval di triggering); serve `004`, `006`, `010`, `023` |
| **Dipende da** | `VISION-AND-CONSTRAINTS` §10 (il gate a 7 punti), `01-ARCHITECTURE` v0.1 §4 (checkpoint), `03-ORACLES` v0.2, `04-FINDINGS-MODEL` v0.2 (modello + coverage), `05-VERIFY-FIX-LOOP` v0.1 (loop + budget `O-COL-006`), `06-CHARACTERIZATION-TESTS` v0.1 (baseline + DB di test), `07-CONVENTIONS-THREATMODEL` v0.2, `11-BLUEPRINT-ENGINE` v0.1 (`validate_blueprint` + self-check), `02`/`09` (triggering della `description`) |

---

## 1. Ruolo di questo modulo

È la **definizione eseguibile di "fatto"**. VISION §10 dichiara che il v1 è fatto quando la skill supera **due parity gate** — uno per la **verifica**, uno per il **build**; questo modulo li rende concreti su una **reference app deliberatamente vulnerabile** + un **blueprint seminato**, con asserzioni automatiche. È anche il posto dove si **tara e si pinna il numero** del budget di `O-COL-006`: la policy è chiusa in `05`, ma il valore dipende dalla reference app, che prima non esisteva (§6).

Confine onesto da subito: l'eval prova che i difetti **seminati** sono colti e (dove in scope) corretti-e-verificati; **non** certifica che "l'app è sicura" *(L-COL-006)*. È un banco di prova rappresentativo, non una garanzia assoluta.

## 2. La reference app vulnerabile

Un'app **JS/TS su Supabase** scritta apposta con i pattern di fallimento AI documentati (VISION §2), ciascuno tracciato. Vive in `10-EVALUATION` (fixture del repo).

| # | Difetto seminato | `category` (`04`) | Oracolo atteso (`03`) | OWASP25 (`07` §3.1) | Ancora `07` |
|---|---|---|---|---|---|
| S1 | Chiave hardcoded nel sorgente | `secret` | gitleaks / Semgrep | A07/A02 | §4.1 |
| S2 | **Segreto nella history** git (file attuale pulito) | `secret` | gitleaks (history) | A07 | §4.1, `05` §7 |
| S3 | Tabella `public` senza RLS | `rls` | RLS checker | A01 | §5 R1 |
| S4 | Policy `USING (true)` (isolamento finto) | `rls` | RLS checker | A01 | §5 R3 |
| S5 | Multi-tenant senza `auth.uid()` | `rls` | RLS checker `[DB-test]` | A01 | §5 R4 |
| S6 | SQL concatenato | `injection` | Semgrep | A05 | §4.2 |
| S7 | Route mutante senza authz | `authz` | Semgrep | A01 | §4.3 |
| S8 | Export/funzione morta introdotta | `dead-code` | knip | — | §5.5 |

Il set è deliberatamente **misto**: copre il **verificato-a-zero** (`secret` S1/S2 + `rls` S3–S5 + `dead-code` S8, `L-COL-010`) **e** almeno due categorie **detection-only** (S6 `injection`, S7 `authz`), così da poter asserire la **copertura onesta** (§3, criterio 3).

La reference app include un **DB di test** (Supabase locale, migration applicate) che rende esercitabile RLS a runtime — l'**integration locale**, non il DAST escluso dal v1 (`06` §6.1, `O-COL-007 → v2`). S5 e la verifica comportamentale di S3/S4 passano da lì; senza DB di test, quei controlli **degradano** al checker statico e si **dichiarano** (`06` §6.1).

## 3. Gate di verifica — i 4 criteri (VISION §10, punti 1–4)

In **REMEDIATE** sulla reference app, resi asserzioni:

1. **DETECT.** Ogni difetto seminato compare come finding **da un oracolo** (`03`/`04`), non da ispezione dell'LLM. *Asserzione*: per ogni `fingerprint` atteso (`04` §6) esiste un finding con la `category` e il `source_oracle` previsti dalla tabella §2.
2. **FIX VERIFICATA (set in scope).** Per `secret` (S1) + `rls` (S3–S5) + `dead-code` (S8), il loop (`05`) raggiunge `fix_state: verified` — **oracolo riesieguito pulito E nessun characterization test rotto** (`06`). S2 (segreto in history) raggiunge **`mitigated-residual`**, **non** `verified`, finché la history non è riscritta (`05` §7): *asserzione* che lo stato onesto sia esattamente questo, non gonfiato.
3. **NESSUN FALSO "VIA LIBERA".** Le detection-only (S6 `injection`, S7 `authz`) sono **trovate, spiegate, prioritizzate, ma non auto-fixate** nel set verificato; la **coverage declaration** (`04` §10) elenca ciò che gli oracoli **non** coprono. *Asserzioni*: nessun vero positivo seminato è liquidato come FP o portato a `verified` senza oracolo (lega `08` §5); il report **non** dice mai "sicuro".
4. **BUDGET.** Il run resta entro un tetto di token + tempo di parete. È il punto in cui il numero di `O-COL-006` viene **tarato e pinnato** (§6).

*(In REMEDIATE la skill può portare a `verified` per-finding anche S6/S7 — remediation piena, `L-COL-023` — ma questo non eleva la categoria a "verificata-a-zero" a livello d'app: la coverage resta onesta, `05` §9.)*

## 4. Gate di build — i 3 criteri (VISION §10, punti 5–7)

Su un **piccolo blueprint seminato** (BOOTSTRAP → BUILD):

5. **BLUEPRINT.** BOOTSTRAP genera un blueprint i cui task atomici portano **tutti** DoD + criteri di accettazione + `target_tests` *(L-COL-019)* e che **passa** `validate_blueprint` (strutturale, `11` §5.1) + la checklist di self-check (semantica, `11` §5.2). *Asserzioni*: `validate_blueprint.*` esce pulito; nessun task privo dei tre campi; nessun criterio orfano dai test.
6. **CHECKPOINT.** Costruito il macrotask, supera il **checkpoint a 4 controlli** (`01` §4) prima di committare. *Asserzioni*: controllo 4 verde = i `target_tests` passano (conformità alla specifica); controlli 1–2 verdi = nessun nuovo morto/vuln **delta** (`03` §7–§8); controllo 3 verde = nessuna regressione.
7. **GIT A STRATI.** Rispetta il modello di `01` §5 / `05` §8. *Asserzioni*: su un repo seminato **deploy-coupled**, il merge autonomo su `main` è **sospeso** e torna human-gated — esercita il fail-safe di `L-COL-025` (`05` §8.3); su un repo **non-coupled**, BUILD-verde merge autonomo; un'operazione distruttiva non è **mai** autonoma.

## 5. Suite di regressione

I due gate diventano una **suite ripetibile**, eseguita a ogni modifica della skill (e come **gate dei task** del workflow, vedi `DYNAMIC-WORKFLOWS`).

- **Deterministica.** Stessa reference app + stesso blueprint seminato → stessi esiti attesi. Versioni degli oracoli **pinnate** (`03` §4 / `09` §4) perché i risultati siano riproducibili.
- **È l'harness che i gate del workflow chiamano.** Qui sta l'aggancio con `DYNAMIC-WORKFLOWS`: il gate di un task di implementazione **non** è "DB locale", è *far girare gli oracoli / `validate_blueprint` / questo harness* sulla reference app. `10` definisce i gate; il workflow li consuma.
- **Cosa segnala un rosso.** Un difetto seminato non più colto (regressione di detection), una fix in-scope che non raggiunge `verified`, un falso "via libera" comparso, o lo sforamento del budget pinnato.

## 6. Calibrazione e pinning del budget `O-COL-006`

La **policy** (2 retry per-finding → 3 tentativi; budget globale token/tempo; esaurito → terminale all'umano, mai scarto silenzioso, mai `verified`) è chiusa in `05` §4. Il **numero** si fissa qui perché dipende dalla reference app.

Metodo:

1. Esegui il **gate di verifica** end-to-end sulla reference app, misurando **token** e **tempo di parete** per le fix del set in scope (S1, S3–S5, S8), inclusi i retry quando scattano.
2. Fissa i tetti (per-checkpoint in BUILD, per-sessione in REMEDIATE) con **margine** sopra il consumo misurato — abbastanza da coprire la variabilità, non tanto da non far mai scattare il cap.
3. **Pinna** i valori in `references/oracles/thresholds.md` (sezione *loop-budget*, `05` §4), referenziati da `SESSION-STATE`.
4. **Ri-tara** quando cambia la reference app o le versioni degli oracoli.

Il criterio 4 del gate di verifica (§3) asserisce che il run completi **entro il budget pinnato**.

## 7. Eval di triggering della `description` *(L-COL-009, `02` §3)*

Il `description` del frontmatter è l'**unico gancio di triggering cross-tool**: deve far attivare la skill quando serve, e **non** quando non serve. Una batteria di prompt verifica precisione/recall:

- **Devono triggerare** (per modalità): "imposta un nuovo progetto Supabase con un piano" (BOOTSTRAP), "avanza il prossimo macrotask del blueprint" (BUILD), "fai un audit di sicurezza di questo repo" (REMEDIATE).
- **Non devono triggerare**: task non pertinenti (es. "scrivimi una regex", "spiega un algoritmo"), e progetti **non** JS/TS-su-Supabase fuori scope v1.

*Asserzione*: la `description` raggiunge la soglia di trigger attesa sui positivi senza falsi positivi sui negativi. Guardia contro la **deriva** della `description` a ogni modifica.

## 8. Cosa questo modulo NON copre / confine

- **Non è un benchmark** contro altri strumenti, né una **certificazione** di sicurezza: prova che i difetti seminati sono colti/corretti, non che "l'app è sicura" *(L-COL-006)*.
- La reference app è **rappresentativa, non esaustiva**: ciò che non semina, non testa.
- **Niente DAST/runtime** oltre il DB di test (`06` §6.1, `O-COL-007 → v2`). **Eval per-ecosistema resa parametrica in SP-0** (`O-COL-005` sciolta): `eval/harness/ecosystem_conformance.mjs <id>` legge il manifest e asserisce i criteri di conformità (manifest valido via `validate_ecosystem` + detection-parity del `floor` + verified-parity del `verified_set` + triggering + igiene/0-contaminazione); per `supabase-jsts` la sua istanza è l'attuale `m5_gate_check.mjs` (**56/56**). Ogni stack nuovo (SP-1+) porta la propria fixture + `registry.json`.
- Non fissa policy: **opera** quelle di `03`/`04`/`05`/`06`/`07`/`11` su un banco di prova.

## 9. Eredità / chiusura

- Superare **entrambi** i gate = v1 **"fatto"** (VISION §10): è il senso di questo modulo, e l'evento che sblocca la dichiarazione di completamento.
- **`DYNAMIC-WORKFLOWS`** consuma l'**harness** del §5 come gate dei task di build: il valore "verde" di un task di implementazione è un esito di questo eval, non una frase dell'LLM — dogfooding di `L-COL-002`.
- È l'**ultimo modulo numerato**: con `09` e `10` scritti — e con `DYNAMIC-WORKFLOWS` prodotto e il ledger portato a **v1.0** in `00-INDEX`/`SESSION-STATE` — la suite è **chiusa**. L'implementazione parte da qui.
