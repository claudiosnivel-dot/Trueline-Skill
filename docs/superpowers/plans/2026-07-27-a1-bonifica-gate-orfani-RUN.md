# RUN — A1: bonifica dei gate orfani + regola connection-string + round 2 dell'A/B

> **Cos'è.** Il brief operativo di **questa** sessione (27 luglio 2026), scritto **prima**
> di lanciare il workflow. Sostituisce in parte
> `2026-07-26-a1-ab-round2-BRIEF.md`: il substrato dell'A/B resta quello previsto, ma il
> lavoro sostanziale è **cambiato per misura**, non per opinione.
>
> **Stato di partenza (registrato dall'orchestratore):**
> branch `feat/a1-ownership-guard-ab-round2` da `main` `437c238be71ce12d6195eb6e8d252caf4b1ea8dc`;
> `git status --porcelain` **vuoto**; Docker su; DB di test `trueline-db-test` su (`up.ps1` exit 0);
> immagine `semgrep/semgrep:latest` presente; `node v25.5.0`.

---

## 1. Perché la sessione è cambiata forma — la misura

Il brief del 26 lug prevedeva A/B + A1.1 (assert per-categoria del `verified_set`), su un
difetto che **il brief stesso** classificava «**latente e oggi non raggiungibile**».

Prima di costruire ho eseguito una misura che il brief non prevedeva: **ho fatto girare tutti e
16 i `verify_fix_check` per-pack** su albero pulito. Esito: **4 rossi su 16**.

| Pack | Esito | Classificazione (onesta, `L-COL-006`) |
|---|---|---|
| **phoenix-ex** | 11/12 | **FALSO VERDE D'ORACOLO.** Dopo il fix, `gitleaks` dichiara il working-tree **pulito (0 secret)** mentre `config/config.exs` contiene ancora `url: "postgres://myapp_user:R3al_pw_live_…@db.internal.example.com:5432/myapp_prod"`. Il loop promuove la categoria `secret` a **`verified`** con una password DB hardcoded ancora nel file. Il `registry.json` di EX-S1 **afferma** che la DSN è «rilevabile da `trueline-generic-assigned-secret`»: **è falso** — quella regola pretende un identificatore dal nome sensibile (`key|token|secret|cred|passwd|password`), qui l'identificatore è `url`. |
| **amplify-jsts** | 21/22 | Il gate esige il marker di provenienza `FIX:AM-S3`; il fix-provider **non lo ha mai emesso** (`git log -S "FIX:AM-S3"` → 0 commit). **Rosso dalla nascita** (`4819626`, 27 giu). La metà di merito è verde (`allow: public` rimosso, `appsync_auth_check` ri-eseguito 0 finding). |
| **appwrite-jsts** | 21/22 | Idem `FIX:AW-S3`, **rosso dalla nascita** (`8f0682e`, 27 giu). Qui il marker è **impossibile per costruzione**: il provider riscrive `appwrite.json` con `JSON.stringify` — nessun commento sopravvive. Asserzione **permanentemente rossa**: la classe di difetto della lezione (d) di H-1. |
| **flutter-dart** | 14/17 | `dart` non è più sul PATH (`spawnSync dart ENOENT`; `SESSION-STATE` lo dava presente: **deriva d'ambiente**). Il gate va **ROSSO** invece di uscire **2** onesto → **falso rosso** da tool assente. |

**Causa sistemica (il difetto vero, più grande dei quattro):**
`grep -rn "verify_fix_check"` su tutto il repo → **nessun harness li invoca**
(`ecosystem_conformance` non li tocca; compaiono solo nei plan come passo manuale).
Sono **16 gate orfani**. Un gate che nessuno esegue non è un verde: `L-COL-006` a casa nostra.

**Conseguenza sulla priorità.** Quattro difetti **misurati e vivi** battono un difetto
**latente e non raggiungibile**: A1.1 esce dalla sessione (resta nel backlog), entra A1.0.

---

## 2. Il fix di prodotto — regola connection-string (tocca l'albero SPEDITO)

**Decisione utente:** si chiude il buco nel prodotto, non solo nell'eval. Quindi in questa
sessione `trueline/` **non è bit-invariante** (a differenza di H-1) — la BIT-invarianza
è sostituita da **non-regressione integrale provata**.

**Raggio d'azione MISURATO prima di scrivere la regola** (`grep -rnoE` sulle fixture):

- **5 fixture con credenziali reali hardcoded** (`R3al_pw_live_…`), oggi **non rilevate**:
  `phoenix-ex/config/config.exs` · `postgres-jsts/src/config.ts` · `postgres-py/app/config.py` ·
  `rails-rb/config/initializers/api_keys.rb` · `supabase-py/app/config.py`.
- **3 placeholder che NON devono accendersi** (classe FP): `postgres://user:pass@host/db`
  (`phoenix-ex/config/runtime.exs`, che è il **contrasto pulito** del pack) e
  `postgresql://u:p@db.local:5432/…` nelle suite di caratterizzazione di
  `postgres-jsts`/`postgres-py`/`supabase-py`.
- **La reference-app di `m5` non contiene alcuna connection string** → `m5` **resta
  BIT-invariante**: è il fatto che rende il fix eseguibile oggi.
- Tutti e 5 i pack colpiti hanno **`secret` nel `verified_set`** → non basta *rilevare*: il
  loop deve anche saper **bonificare**, o i loro gate di conformità diventano rossi.

**Discriminante anti-FP (parte del disegno, non un dettaglio):** la password è il
`secretGroup`, con **lunghezza minima 8** ed **entropia ≥ 3.0**. Questo esclude per
costruzione `pass` (4 caratteri), `p` (1) e — caso che conta per gli utenti reali — il
DSN di sviluppo locale `postgres://postgres:postgres@127.0.0.1:54322/postgres`
(entropia di `postgres` ≈ 2.75 < 3.0). Un utente Supabase con lo stack locale **non** deve
ricevere un finding.

---

## 3. Il substrato dell'A/B (invariato) e i LOTTI — registrati PRIMA del lancio

**Task meccanico uniforme:** portare la **guardia di proprietà della radice temp** nei 16
`eval/ecosystems/*/verify_fix_check.mjs`, allineandoli ai 5 harness (`TMP_ROOT_INHERITED`).
Resta **latente e non raggiungibile oggi** — si dichiara così, non lo si racconta come vivo.
Vale come substrato perché è uniforme, meccanico (~3 righe/file), **disgiunto in due lotti** e
gatabile per lotto.

**Lotti bilanciati per righe, a zig-zag sull'ordine decrescente** (non alfabetici):

| Lotto **A** (braccio A) | righe | Lotto **B** (braccio B) | righe |
|---|---|---|---|
| pocketbase-jsts | 429 | amplify-jsts | 424 |
| flutter-dart | 414 | appwrite-jsts | 420 |
| firebase-jsts | 412 | firebase-py | 403 |
| postgres-py | 378 | hasura-jsts | 397 |
| postgres-go | 345 | postgres-jsts | 332 |
| dotnet-cs | 304 | supabase-py | 325 |
| spring-java | 297 | phoenix-ex | 297 |
| rails-rb | 246 | laravel-php | 280 |
| **totale** | **2825** | **totale** | **2878** |

Massa comparabile (scarto 53 righe = 0,9 %). **Bracci:** A = modello di punta a effort `low` ·
B = **Sonnet**. Verifier di entrambi: modello di punta, effort `max`, **BLIND**, **prompt
simmetrico**. Bracci **in sequenza**, `budget.spent()` campionato attorno ai **soli builder**.

---

## 4. Il gate dell'A/B, scritto PRIMA — con una correzione di disegno

`eval/harness/h1_perpid_check.mjs` va esteso con `--packs=<csv>` (default: tutti e 16) e due
sotto-test nuovi.

**(9) `static:pack-ownership-guard`** — per ciascun pack della lista: il file dichiara la
guardia (radice **ereditata** ⇒ il cleanup della **RADICE** è saltato; la rimozione della
**propria copia** resta sempre attiva).

**(10) `runtime:pack-inherited-root-survives`** — prova **eseguita**.

> **CORREZIONE rispetto al brief del 26 lug — il disegno originale era VACUO.**
> Il brief prescriveva di puntare `TRUELINE_TMP_VERIFY_ROOT` a una radice «che contiene già una
> dir *viva* di un finto padre» e asserire che quella dir sopravviva. **Misurato sul codice
> reale:** il cleanup dei pack rade la radice **solo se è vuota**
> (`if (existsSync(root) && readdirSync(root).length === 0) rmSync(root, …)`). Piantare una dir
> viva rende la radice **non vuota** → la rimozione non scatta **mai** → il sotto-test
> passerebbe **con o senza la guardia**: un falso verde per costruzione.
>
> **Disegno corretto:** la radice ereditata è **vuota** (a parte la copia del figlio). Senza
> guardia il figlio rimuove la propria copia, la radice resta vuota e **il figlio rade la
> radice del padre**; con la guardia la radice sopravvive. **Falsificabilità provata
> empiricamente prima di costruire**, sul codice attuale:
>
> ```
> mkdir -p eval/.tmp-h1probe-$$/inherited
> TRUELINE_TMP_VERIFY_ROOT=$PWD/eval/.tmp-h1probe-$$/inherited \
>   node eval/ecosystems/rails-rb/verify_fix_check.mjs   # exit 0
> # → la radice EREDITATA NON esiste più: RASA DAL FIGLIO
> ```

**Floor anti-vacuo del sotto-test (10), obbligatorio.** Il pack scelto deve **dimostrare di
aver raggiunto il cleanup** (evidenza nel suo stdout: copia creata *e* copia rimossa). Se non
lo dimostra — tool assente, crash precoce — il sotto-test **non è verde e non è rosso**:
`precondAbort` → **exit 2 onesto**. Un controllo non eseguito non è un verde (`L-COL-006`).
Il pack usato per la prova runtime si sceglie **dalla lista passata**, in ordine, al primo che
soddisfa il floor (max 3 tentativi); la copertura effettiva va **stampata**.

**Costo misurato** (per non introdurre un gate lento): `rails-rb` 1,35 s · `dotnet-cs` 1,50 s ·
`amplify-jsts` 12,5 s.

**Perché `--packs` è il punto centrale:** consente al gate del lotto A di essere **verde mentre
il lotto B non è ancora stato fatto**. È esattamente ciò che mancava nel round 1, dove il gate
era più largo del task e ha **confondato** la misura (`DYNAMIC-WORKFLOWS` §5.1).

---

## 5. I task e i loro GATE (scritti prima del build)

| id | dominio / file | dipende_da | GATE (asserzione automatica) | builder |
|---|---|---|---|---|
| **T1** | `eval/harness/h1_perpid_check.mjs` | — | i **2 sotto-test nuovi ROSSI** sull'albero attuale (nessun pack ha la guardia) **e** gli **8 pre-esistenti invariati e verdi**; `--packs=<csv>` scopa entrambi i nuovi; senza `--packs` il default resta 16; il floor anti-vacuo di (10) dà **exit 2**, mai un verde, se il pack non raggiunge il cleanup | punta · effort **alto** |
| **T2** | lotto **A** (8 file `verify_fix_check.mjs`) | T1 | `node eval/harness/h1_perpid_check.mjs --packs=<lotto A>` **VERDE** mentre il lotto B è **intatto**; `git diff --name-only` dell'orchestratore = esattamente gli 8 file del lotto A | **punta · effort `low`** (braccio A) |
| **T3** | lotto **B** (8 file `verify_fix_check.mjs`) | T2 | `--packs=<lotto B>` **VERDE**; diff = esattamente gli 8 file del lotto B; poi `h1` **default 10/10** | **Sonnet** (braccio B) |
| **T4** | `eval/harness/pack_verify_battery.mjs` (nuovo) | T3 | esegue **tutti e 16** i gate per-pack in **seriale**, riporta per-pack PASS/FAIL/**SKIP-onesto** (tool assente ⇒ **exit 2**, mai rosso), e **fallisce** se anche un solo pack è FAIL. **Falsificabile:** neutralizzo un pack verde → la batteria lo riporta FAIL → ripristino → torna al conteggio atteso. **Anti-vacuo:** se 0 pack eseguiti → exit 2 | punta · effort **alto** |
| **T5** | `eval/ecosystems/{amplify,appwrite}-jsts/verify_fix_check.mjs` + `eval/harness/fix_provider.eval.mjs` | T3 | **amplify:** il provider emette il marker `# FIX:AM-S3` (GraphQL ammette `#`; il gate già spoglia i commenti prima di cercare `allow: public`) → gate **22/22**. **appwrite:** il marker è impossibile in JSON → l'asserzione va **sostituita con un'equivalente non-vacua sul merito** (permission ristretta a `users` **e** `documentSecurity: true`, entrambe scritte dal provider), **mai** indebolita a `!codeStillPublic` da solo → gate **22/22**. Falsificabile su entrambi: neutralizzo il ramo del provider → ROSSO → ripristino → verde | punta · effort **alto** |
| **T6a** | `trueline/scripts/oracles/gitleaks.toml` (**SPEDITO**) | T3 | regola `trueline-connection-string-credentials`: **accende** sulle **5** fixture con `R3al_pw_live_…`; **NON accende** sui 3 placeholder (`user:pass@`, `u:p@`) **né** su `postgres://postgres:postgres@127.0.0.1:54322/postgres`. Prova **eseguita** con `gitleaks` reale, non per lettura del regex. Falsificabile: alzo la soglia d'entropia → le 5 si spengono | punta · effort **alto** |
| **T6b** | `eval/harness/fix_provider.eval.mjs` + i 5 `registry.json` | T6a | i **5 pack** colpiti restano **verified-verdi**: il loop porta la nuova DSN a `verified` (oracolo ri-eseguito **0 secret** col literal sparito, letto da env con l'idioma della lingua) e i registry **dicono il vero** (la nota falsa di EX-S1 va corretta). Gate: i 5 `verify_fix_check` + `ecosystem_conformance` dei 5 pack | punta · effort **alto** |

**T-final (orchestratore, SERIALE — non delegabile):** `h1` **10/10** + per-lotto ·
**`pack_verify_battery` 16/16** · `m5` **56/56 REALE** (DB-live + docker/semgrep) ·
`a0`/`a2a`/`a2b`/`a2c` · `anti_tamper` 49/49 · `build_discipline` 21/21 ·
`ecosystem_conformance` sui pack toccati · `package_skill` lint VERDE 20 pack ·
**disgiunzione A/B ↔ resto provata col `git diff`** · 0-contaminazione.

---

## 6. Cosa NON fare

- **Git**: nessun agente esegue comandi git (`L-COL-024`). Commit e merge sono
  dell'orchestratore, e il merge è **human-gated**.
- **Nessun pack nuovo, nessuna feature nuova**: la roadmap di ampiezza resta congelata.
- **Nessun retry per inseguire un flake**: l'isolamento è la soluzione, il retry è la pezza.
- **Non indebolire un gate per farlo passare.** Se un'asserzione è sbagliata si **sostituisce
  con una equivalente sul merito** (caso appwrite), documentando il perché; non si cancella.
- **Non allineare le `guide.md`** (scartato dopo misura il 26 lug: 0 stale, 14 «parziali»
  redazionali).
- **A1.1** (assert per-categoria del `verified_set`) **esce** da questa sessione: resta nel
  backlog, con la sua ragione scritta.
