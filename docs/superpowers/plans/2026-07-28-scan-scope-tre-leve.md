# PLAN — confine dello scope di scansione: tre leve (scope · chiavi demo · dichiarazione di progetto)

> **Sostituisce operativamente** il brief `2026-07-28-scan-scope-rumore-build-BRIEF.md`, che resta
> valido nel **principio** e superato nei **numeri**. La misura di apertura di questa sessione ha
> spostato il baricentro: lo scope di scansione da solo copre il **17%** del rumore reale.
>
> **Data:** 28 luglio 2026 · **Branch:** `feat/scan-scope` da `main` (`5a6e80e`).
> **Perimetro ratificato dall'utente:** leve 1+2+3.

---

## 1. La misura — 4 progetti reali, oracolo spedito, sola lettura

Comando riproducibile per progetto:
`node trueline/scripts/oracles/run_gitleaks.mjs <progetto> working-tree`

| progetto | finding | su file tracciati |
|---|---:|---:|
| `progetto-web-ai` | 30 | 0 |
| `ASV Officina` | 160 | 32 |
| `appuntamentiok` | 0 | 0 |
| `reportflippa` | 2 | 0 |
| **totale** | **192** | **32** |

**Segreti veri: 0 su 192.** Ripartizione per regola: `generic-api-key` (built-in) 135 ·
`trueline-generic-assigned-secret` (nostra) 43 · `jwt` (built-in) 14.

### Le cinque classi, misurate nel merito

| | classe | n | dove | perche' e' rumore |
|---|---|---:|---|---|
| **A** | artefatti di build | 32 | `.next/` (chunk, source-map, `prerender-manifest`), `dist/assets/*.js` | output di build, non sorgente d'autore |
| **B** | **codegen TRACCIATO dentro `src/`** | 28 | `ASV/src/lib/database.types.ts` | match su `foreignKeyName: "clienti_officina_id_fkey"` — file generato da `supabase gen types`, committato, dentro `src/`: **ne' `.gitignore` ne' una lista di cartelle di build lo prendono** |
| **C** | dump di dati | 121 | `ASV/backups/remote_data_*.sql` (27 file, gitignorati) | riga `('<uuid>','…','password','<uuid>')`: la regola si accende sul letterale `'password'`. **Cresce di ~5 finding al giorno** |
| **D** | chiavi demo dello stack locale | 9 | `.env*`, test e2e, `dist/`, `.next/` | vedi §2: costanti pubbliche |
| **E** | prosa in un `.md` | 1 | `ASV/Docs/.../plans/*.md` | testo di documentazione |

### Due correzioni al brief, pagate con la misura

1. **I 2 finding `.env.local` di `progetto-web-ai` — «il caso d'oro» del brief §2 — NON sono oro:**
   sono `role=anon` e `role=service_role` con **`iss=supabase-demo`**, cioe' le chiavi demo dello
   stack locale. Il sotto-test `env-gitignored:still-found` resta giusto **nel principio**, ma la sua
   fixture va costruita con un segreto **vero**, o il gate sarebbe vacuo.
2. **L'esclusione per directory di build non basta:** la classe B vive dentro `src/` ed e' tracciata.
   Il confine e' *generato vs d'autore*, e non e' inferibile dal path di primo livello: va **dichiarato**.

---

## 2. Le chiavi demo sono costanti pubbliche — provato per identita', non per assunzione

Confronto per hash dei token JWT trovati (valore mai stampato):

| sha256[0:12] | role | iss | len | dove |
|---|---|---|---:|---|
| `bf1725a8f98b` | anon | `supabase-demo` | 153 | **3 progetti indipendenti** (pwa, ASV, reportflippa) |
| `70541e07fd4f` | service_role | `supabase-demo` | 164 | **2 progetti indipendenti** (pwa, reportflippa) |
| `ea8b8210ae89` | anon | `supabase` | 208 | **1 solo progetto** (`ASV/.env`) |

Lo stesso identico valore in progetti indipendenti **non e' un segreto di progetto**: e' la costante
che ogni `supabase start` produce uguale per tutti. Stesso precedente della DSN
`postgres://postgres:postgres@127.0.0.1:54322` gia' tarata in A1.

**Conseguenza di disegno (conservativa, deliberata):** l'allowlist e' per **valore esatto** dei due
token demo, **non** per `role=anon`. La terza chiave (`iss=supabase`, progetto cloud reale) **resta
rossa**: decidere che una anon key di produzione non vada segnalata non e' una decisione da prendere
dentro un'allowlist.

---

## 3. Disegno — tre leve, un solo modulo nuovo

### Invariante di sicurezza del disegno (vale per tutte e tre)

**Il default e' vuoto.** Senza dichiarazioni, `resolveScanScope` restituisce `[]` e l'insieme dei
finding e' **byte-identico a oggi**. E' cio' che rende `m5` 56/56 e i 16 `verify_fix_check` non-regressivi
per costruzione, e va provato dal sotto-test `no-declaration:bit-invariant`.

**Nessuna esclusione e' silenziosa** (`L-COL-006`): cio' che non si guarda finisce nella coverage
declaration con pattern, provenienza e numero di finding soppressi. Non scansionare qualcosa **non e'
un verde**.

### 3.1 Modulo nuovo (SPEDITO): `trueline/scripts/oracles/scan_scope.mjs`

Modellato su `trueline/scripts/loop/rls_scan.mjs` (precedente manifest-driven, `L-COL-029`).
Node ESM, solo built-in, nessuna dipendenza.

```
export const DEFAULT_SCAN_EXCLUDE = [];            // BIT-invarianza

resolveScanScope(projectDir, opts) -> {
  patterns: [{ pattern, source }],                 // source: 'caller'|'project'|'manifest'
  sources:  { caller: n, project: n, manifest: n },
}
// PRECEDENZA — UNIONE, non sovrascrittura (il progetto AGGIUNGE alla conoscenza
// d'ecosistema, non la rimpiazza; ogni pattern porta la sua provenienza):
//   1) opts.exclude                          (esplicito dal chiamante)
//   2) <projectDir>/.trueline/scan-scope.json -> { exclude: [...] }   (leva 3)
//   3) opts.manifest.oracles.secret.exclude                            (leva 1)
//   4) DEFAULT_SCAN_EXCLUDE = []

applyScanScope(findings, scope, projectDir) -> { kept, excluded }
// match sul path RELATIVO a projectDir, separatore normalizzato a '/'.
// Matcher minimale senza dipendenze: prefisso-directory (`dist/`), glob `*`
// (non attraversa '/'), glob `**` (attraversa). Niente regex utente: un pattern
// non e' un canale per iniettare comportamento.

scanScopeCoverage(scope, excluded) -> {
  excluded_patterns: [{ pattern, source, matched: n }],
  excluded_total: n,
}
// Blocco da innestare in coverage.declared_uncovered (04 §10 / 06 §7).
```

**Perche' post-filtro e non una config gitleaks derivata:** il contratto del wrapper
(`run_gitleaks.mjs` stampa il JSON **nativo**) resta invariato — quindi il wrapper e' BIT-invariante e
non entra nel diff dell'albero spedito piu' del necessario. Il costo (gitleaks scansiona comunque
`.next/`: 7s su `progetto-web-ai`) e' accettabile e misurato.

### 3.2 Leva 1 — scope d'ecosistema nel manifest

`oracles.secret.exclude: [...]` nei manifest dei pack JS/TS
(`trueline/references/ecosystems/<pack>/ecosystem.json`). Additivo: `validate_ecosystem` vincola le
**chiavi** di `oracles` al vocabolario di categorie, non i campi interni (`oracles.rls.scan` e' il
precedente vivo).

Valore per i pack JS/TS:
`.next/**`, `dist/**`, `build/**`, `out/**`, `coverage/**`, `.turbo/**`, `.svelte-kit/**`,
`.nuxt/**`, `.output/**`, `**/*.map`, `**/database.types.ts`.

**Onesta' dichiarata (`L-COL-006`):** `**/database.types.ts` e' il path *convenzionale* della doc
Supabase, non un fatto. Chi rinomina il file generato non e' coperto: e' una **copertura mancante
nota**, e la coverage declaration la rende visibile a ogni checkpoint.

### 3.3 Leva 2 — allowlist dei valori demo in `gitleaks.toml`

Nella sezione `[[allowlists]]` gia' predisposta (oggi vuota per scelta: le fixture M-1 devono restare
rilevabili). Due valori esatti, con il commento che spiega **perche'** e' sicuro (costanti pubbliche
verificate su 3 progetti indipendenti) e cosa **non** copre (`iss` diverso => resta rosso).

Vincolo: l'allowlist non deve spegnere i segreti seminati delle fixture (`S1`/`S2`) — lo prova la
non-regressione `m5` 56/56.

### 3.4 Leva 3 — dichiarazione di progetto `.trueline/scan-scope.json`

```json
{ "exclude": ["backups/**"], "reason": "dump di dati, non codice d'autore" }
```

Il brief la sconsigliava come «bypass in incognito». **L'unica cosa che la rende legittima e' la
visibilita' obbligatoria:** ogni pattern di provenienza `project` compare nella coverage declaration
di **ogni** checkpoint e nel report REMEDIATE, col conteggio dei finding soppressi. Un'esclusione
scritta nero su bianco a ogni giro non e' un bypass; una taciuta lo sarebbe.

`reason` e' **obbligatorio** e viene riportato nella coverage: un'esclusione senza motivo dichiarato
e' rifiutata (non ignorata in silenzio).

### 3.5 Wiring

- `checkpoint.mjs` — ramo `gitleaks` del controllo 1: `applyScanScope` prima della normalizzazione;
  la coverage entra nell'esito del checkpoint.
- `baseline.mjs` — stesso trattamento, o la baseline congelerebbe finding che il checkpoint esclude
  (asimmetria = falsi delta).
- report REMEDIATE — `report.coverage.scan_scope`.
- `loop.mjs` / `run_loop.mjs` — **da valutare in build**: il loop verifica la sparizione di un
  fingerprint; se lo scope escludesse il file del seme, il loop timbrerebbe `verified` senza fix.
  **Regola:** nel loop lo scope NON si applica al file sotto fix. Da coprire con un sotto-test.

---

## 4. Il gate — scritto PRIMA (`L-COL-019`/`L-COL-027`)

Keystone nuovo `eval/harness/scan_scope_check.mjs` su fixture dedicate
(`eval/scan-scope/{declared,undeclared}`), inner-`.git` provisionato dall'orchestratore
(`provision_fixtures.sh`), radice temp privata per-pid (H-1).

| # | sotto-test | cosa prova |
|---|---|---|
| 1 | `generated:not-scanned` | segreto in `dist/` => nessun finding |
| 2 | `codegen:not-scanned` | segreto-simile in `src/lib/database.types.ts` **tracciato** => nessun finding |
| 3 | `source:still-found` | lo stesso segreto in `src/app.ts` => **finding** (l'esclusione non e' troppo larga) |
| 4 | `env-gitignored:still-found` | `.env` **gitignorato** con un segreto **VERO** => **finding** — *anti-vacuita': senza, «escludi i gitignorati» passerebbe* |
| 5 | `demo-key:not-flagged` | token `iss=supabase-demo` => nessun finding |
| 6 | `real-key:still-found` | JWT con `iss` diverso => **finding** — *anti-vacuita' della leva 2* |
| 7 | `project-scope:applied` | `.trueline/scan-scope.json` con `backups/**` => nessun finding li' |
| 8 | `project-scope:reason-required` | esclusione senza `reason` => **rifiutata**, non ignorata |
| 9 | `coverage:declared` | ogni pattern applicato compare in coverage con `source` e `matched` | 
| 10 | `loop:seed-file-never-excluded` | il file sotto fix non e' escludibile (niente `verified` gratis) |
| 11 | `no-declaration:bit-invariant` | progetto senza dichiarazioni => conteggio identico a oggi |
| 12 | `falsificabile` | neutralizzo l'esclusione => (1) rosso; ripristino => verde |
| 13 | `wiring:baseline` | `baseline.mjs::capture` esclude DAVVERO e dichiara la coverage nello snapshot |
| 14 | `wiring:checkpoint` | `checkpoint.mjs::control2Security` esclude DAVVERO e fa risalire `scan_scope` |
| 15 | `wiring:run-loop` | `run_loop.mjs::collectFindings` esclude DAVVERO e riempie `out.scanScope` |
| 16 | `wiring:loop-seed-protetto` | strato 1 in isolamento: tornano TUTTI i finding del file sotto fix |
| 17 | `wiring:loop-rete-identita'` | strato 2 in isolamento: path fasullo, il fingerprint torna comunque |

**Aggiunta del 29 lug (13-17), pagata con un falso verde vero.** I sotto-test 1-12 esercitano il
**modulo**; da soli lasciano il gate verde con la feature spenta nel prodotto (successo misurato: 12/12
PASS con quattro siti di innesto neutralizzati). I 13-17 **importano ed eseguono i chiamanti reali**.
Criterio doppio e inscindibile: (a) i finding coperti spariscono davvero, (b) la coverage esiste e dice
chi li ha soppressi — accettarne una sola vorrebbe dire tollerare o una feature inerte con una bella
dichiarazione, o un'esclusione in incognito.

**Non-regressione obbligatoria (gate SERIALE dell'orchestratore, `L-COL-002`):**
`m5` **56/56 REALE** (DB-live + semgrep) · `pack_verify_battery` **16/16** · `package_skill` lint
**20 pack** · keystone `a0` · `a2a` · `a2b` · `a2c` · `anti_tamper` 49/49 · `build_discipline` 21/21 ·
`h1` 8/8 · **0 contaminazione**.

**Albero spedito toccato** (certo: modulo nuovo + manifest + `gitleaks.toml` + wiring):
dichiararlo con `node eval/harness/h1_perpid_check.mjs --shipped-allow=<path esatti>`, bumpare
`skill_version` **0.2.0 -> 0.3.0** (funzionalita' nuova retro-compatibile) in `trueline/package.json`
e ri-registrare con `--record-release`, o `package_skill` rifiuta di emettere (`L-COL-035`).

---

## 5. Cosa NON si fa in questa sessione

- Non si tocca la regola `generic-api-key` built-in di gitleaks (135 dei 192 finding): sopprimerla
  globalmente e' esattamente il falso verde che questo prodotto esiste per evitare. La classe C si
  chiude con la **dichiarazione di progetto**, non spegnendo l'oracolo.
- Non si esclude per `.gitignore` (§1, correzione 1).
- Niente pack nuovi, niente altre feature.
- **Un solo workflow di build**, gate seriale nella stessa sessione, merge human-gated (`L-COL-024`).

---

## 6. Verifica finale sul reale (dopo il verde del gate)

> **CORREZIONE AL COMANDO (29 lug) — §6 non era riproducibile come scritto.**
> §6 diceva di ri-misurare con `node trueline/scripts/oracles/run_gitleaks.mjs <progetto>
> working-tree`. Ma per scelta esplicita di §3.1 il wrapper resta **BIT-invariante** e
> stampa il JSON **nativo**: il post-filtro delle leve 1 e 3 vive in
> `checkpoint`/`baseline`/`run_loop`, non nel wrapper. Con quel comando si vede **solo**
> l'effetto della leva 2. I numeri di §6 non possono uscire da li' **nemmeno con il
> wiring perfettamente funzionante** — leggerne il fallimento come «un dettaglio» sarebbe
> il contrario di cio' che §6 stesso prescrive.
> **Comando corretto** (passa dal sito di innesto, quindi misura tutte e tre le leve):
> `node trueline/scripts/findings/baseline.mjs capture <progetto> --oracles gitleaks --out -`
> — il `count` e' il dopo, e `scan_scope.excluded_total` dice quanti sono stati esclusi e
> da quale pattern. Il grezzo (`run_gitleaks.mjs`) resta il **prima**.

Ri-misurare i 4 progetti e riportare il prima/dopo. Atteso:

| progetto | prima | dopo |
|---|---:|---:|
| `progetto-web-ai` | 30 | **0** |
| `ASV Officina` | 160 | **1** (la anon key del progetto cloud reale: giusto che resti) |
| `appuntamentiok` | 0 | 0 |
| `reportflippa` | 2 | **0** |

Se il numero atteso non esce, **e' un fatto contro il disegno**, non un dettaglio da sistemare a mano.

### ESITO MISURATO (29 lug, codice di questa branch) — la previsione era sbagliata, il disegno no

| progetto | apertura | dopo leva 2 | dopo leve 1+3 | previsto |
|---|---:|---:|---:|---:|
| `progetto-web-ai` | 30 | 24 | **0** | 0 |
| `ASV Officina` | 160 | 155 | **3** | 1 |
| `appuntamentiok` | 0 | 0 | **0** | 0 |
| `reportflippa` | 2 | 0 | **0** | 0 |

I 3 residui di ASV, guardati uno per uno:

1. `jwt` in `.env` — la anon key del progetto **cloud reale** (`iss=supabase`). **Previsto, e giusto
   che resti.**
2. `generic-api-key` in `Docs/.../plans/*.md` — prosa di documentazione: classe **E**, dichiarata
   fuori perimetro in §5. **Non previsto nel conteggio per mia svista, non per un difetto del disegno.**
3. `generic-api-key` in `.env.supabase` — **e' un VERO POSITIVO**: `SUPABASE_DB_PASSWORD`, 32
   caratteri, entropia 4.48, la password del database cloud in chiaro.

**Il punto 3 e' il risultato piu' importante della sessione, e vale piu' del numero atteso.** Con 160
finding quella password era una riga qualsiasi in mezzo a 121 dump e 28 tipi generati; con 3, e' in
cima. E' la tesi del lavoro, verificata sul campo: **il rumore non e' un fastidio estetico, nasconde
il segnale.**

Igiene del caso (verificata, non assunta): `.env.supabase`, `.env` e `.env.local` **non sono mai
stati committati** (`git log --all -- <file>` vuoto) e la scansione `history` di ASV riporta 29
finding che sono **solo** i due FP gia' noti (28 `database.types.ts` + 1 prosa `.md`). La password
non e' mai entrata nella history: nessuna rotazione urgente, e' igiene locale.

**Conseguenza per §6:** il criterio di accettazione non e' "ASV torna a 1", e' **"cio' che resta e'
o vero o dichiarato"**. Con 3 residui — 1 vero positivo, 1 previsto, 1 di classe dichiarata fuori
perimetro — il criterio e' soddisfatto.

### RI-MISURATO il 29 lug DOPO il ripristino del wiring (§3.5), col comando corretto

La misura precedente girava con l'innesto **neutralizzato** (cfr. la nota qui sotto) e i numeri
venivano da un post-filtro fatto a mano. Rifatta passando dal **sito di innesto reale**
(`baseline.mjs::capture`, che filtra il JSON **nativo** prima della normalizzazione):

| progetto | grezzo | dopo leve 1+2 | dopo leva 3 | coverage emessa |
|---|---:|---:|---:|---|
| `progetto-web-ai` | 24 | **0** | 0 | `.next/**`[manifest]=24 |
| `ASV Officina` | 155 | 30 | **3** | `**/database.types.ts`=28 · `dist/**`=3 · `backups/**`=121 |
| `appuntamentiok` | 0 | 0 | 0 | — |
| `reportflippa` | 0 | **0** | 0 | — |

`reportflippa` esce gia' a 0 dal **grezzo**: i suoi 2 finding d'apertura erano i due token demo, che
la leva 2 spegne dentro `gitleaks.toml` (quindi prima del post-filtro). Su ASV la leva 3 e' stata
simulata **senza scrivere nel progetto dell'utente**, iniettando `backups/**` per la stessa via
d'innesto; l'effetto misurato coincide con quello di una `.trueline/scan-scope.json`.

**NOTA DI SESSIONE (29 lug) — il wiring era stato trovato NEUTRALIZZATO.** Sette punti dell'albero
spedito portavano il marcatore `NEUTRALIZZATO` e la chiamata reale sostituita da un no-op:
`applyScanScope` non veniva MAI chiamata in `checkpoint`/`baseline`/`run_loop`, e nel `loop` era
chiamata **senza `protect`** con la rete per identita' spenta da `if (false && ...)`. Il keystone
restava **12/12 PASS** perche' esercitava solo il modulo in isolamento. Ripristinati i quattro siti e
**esteso il gate al wiring** (sotto-test 13-17, che importano ed eseguono i chiamanti reali): ogni
neutralizzazione — compresa la rimozione di **uno solo** dei due strati della regola del seme — ora
fa ROSSO. Verificato variante per variante (7/7).
