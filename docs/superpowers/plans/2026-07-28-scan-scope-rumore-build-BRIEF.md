# BRIEF turnkey — confine dello SCOPE DI SCANSIONE (rumore da artefatti di build)

> **Cos'è.** Il brief pronto-all'uso per la **prossima sessione**. Nasce da un segnale del
> **progetto reale**, non dalla roadmap: per la regola d'oro (`docs/dogfood/observations.md`)
> ha la precedenza su tutto il resto del backlog.
>
> **Data:** 28 luglio 2026 (scritto a chiusura della sessione A1).
>
> **Obiettivo dell'utente a valle:** aprire **7 nuovi piani blueprint** su `progetto-web-ai`.
> Questo lavoro è la **precondizione**: 28 falsi positivi a ogni checkpoint insegnano a
> ignorare l'output, ed è così che un gate smette di essere un gate.

---

## 1. Il segnale — MISURATO, non ipotizzato

Su `progetto-web-ai` (classificato `supabase-jsts`, tier **verified**), oracolo `gitleaks`
working-tree, sola lettura, 28 lug 2026:

| dove | finding | tracciato da git? |
|---|---|---|
| `.next/` (manifest, chunk, source-map generati) | **28** | **no** (gitignorato) |
| `.env.local` (2× `jwt`) | **2** | **no** (gitignorato) |
| **codice sorgente** (`src/`) | **0** | — |

**30 finding, zero nel codice.** Comando riproducibile:

```
node trueline/scripts/oracles/run_gitleaks.mjs <progetto> working-tree
```

**Due conferme positive nella stessa lettura, da non perdere:** `rls_check` sulle migration
reali → **0 finding**; la regola `trueline-connection-string-credentials` **non si accende**
sulle DSN dello stack Supabase locale (`postgres://postgres:postgres@127.0.0.1:54322`) —
la soglia d'entropia fa il suo mestiere **su un progetto vero**, non solo sulle fixture.

---

## 2. La trappola — la soluzione ovvia è SBAGLIATA

«Escludi ciò che è gitignorato» è **troppo largo**, e la prova è nella misura stessa: i 2
finding `jwt` stanno in `.env.local`, che è **gitignorato**. Un `.env` gitignorato con
credenziali **vere** è esattamente un finding che si vuole vedere — è il caso d'uso
principale di un tool di sicurezza su un progetto in sviluppo.

Il confine da trovare non è *tracciato/non tracciato*: è **artefatto generato** contro
**sorgente d'autore**.

---

## 3. Misurare PRIMA di costruire (come A2a)

Quattro progetti Supabase reali sono già su disco (`C:/Users/claud/Desktop/`):
`progetto-web-ai`, `ASV Officina`, `appuntamentiok`, `reportflippa`.

Per ciascuno, **prima di scrivere codice**, contare i finding per directory di primo livello
e classificarli in tre secchi: **generato** (`.next/`, `dist/`, `build/`, `out/`, `coverage/`,
`.turbo/`, `.svelte-kit/`, `target/`, `__pycache__/`) · **sorgente** · **env/config**.

Domande a cui la misura deve rispondere:
1. l'esclusione dei soli artefatti generati azzera il rumore **senza** perdere un solo
   finding di sorgente o di env?
2. quanti finding restano, e sono gestibili a un checkpoint?
3. esiste un progetto dove un artefatto generato conteneva l'**unica** copia di un segreto
   vero? (se sì, l'esclusione va accompagnata da una nota, non fatta in silenzio)

---

## 4. Disegno — tre opzioni, con una raccomandazione

| | opzione | pro | contro |
|---|---|---|---|
| **(a)** | **scope dichiarato nel manifest del pack** (`oracles.secret.exclude`), come già si fa per `oracles.rls.scan` | precedente esistente (`L-COL-029`, manifest-driven); `.next/` è conoscenza **di ecosistema**, non dell'engine; ogni pack dichiara i propri artefatti | tocca 20 manifest (ma solo quelli che ne hanno bisogno) |
| (b) | lista cablata nel wrapper `run_gitleaks` | una riga | l'engine impara a conoscere Next.js: sbagliata come altitudine, e invisibile a chi legge il pack |
| (c) | `.trueline/scan-exclude` dichiarato dall'utente nel progetto | massima flessibilità | scarica sull'utente una decisione che è nostra; e un'esclusione utente è un bypass in incognito |

**Raccomandata: (a).** Mantiene l'engine generico e rende l'esclusione **leggibile e
versionata** dove vive la conoscenza dell'ecosistema.

---

## 5. Il gate, da scrivere PRIMA (test-first, `L-COL-019`/`L-COL-027`)

Keystone nuovo `eval/harness/scan_scope_check.mjs`, su una fixture che contiene **tutti e
tre** i casi:

1. **`generated:not-scanned`** — un segreto piantato in `dist/` (o `.next/`) **non** produce
   finding.
2. **`source:still-found`** — lo stesso segreto in `src/` **produce** finding (o
   l'esclusione è troppo larga).
3. **`env-gitignored:still-found`** — un `.env` **gitignorato** con credenziali vere
   **produce** finding. *È l'anti-vacuità che impedisce la soluzione sbagliata di §2: senza
   questo sotto-test, «escludi i gitignorati» passerebbe il gate.*
4. **`falsificabile`** — neutralizzando l'esclusione, (1) torna rosso; ripristino → verde.
5. **`coverage:declared`** — ciò che è stato escluso **compare nella coverage declaration**
   del report (`04` §10, `06` §7). **Non scansionare qualcosa non è un verde** (`L-COL-006`):
   dev'essere scritto, non taciuto. *Questo è il sotto-test che rende il lavoro onesto.*

**Non-regressione obbligatoria:** `m5` **56/56 REALE** (la reference app non ha artefatti di
build: l'esclusione dev'essere BIT-invariante lì) + `pack_verify_battery` **16/16** +
`package_skill` lint verde.

**Se l'albero SPEDITO viene toccato** (probabile: manifest e/o wrapper), dichiararlo al gate
con `node eval/harness/h1_perpid_check.mjs --shipped-allow=<path esatti>` e **bumpare
`skill_version`** in `trueline/package.json` + `--record-release`, o `package_skill` rifiuta
di emettere (controllo di release, `L-COL-035` braccio distribuzione).

---

## 6. Cosa NON fare

- **Non escludere per `.gitignore`** (§2: perderesti i finding `.env`, che sono il caso d'oro).
- **Non sopprimere finding in silenzio**: un'esclusione è una **copertura mancante
  dichiarata**, non una pulizia del report (`L-COL-028`: l'LLM non sopprime mai; qui è
  l'oracolo a non guardare, e va detto).
- **Niente pack nuovi, niente feature nuove**: la roadmap di ampiezza resta congelata.
- **Un solo workflow per sessione**, gateato in seriale e mergeato nella stessa sessione.
- Non toccare le due conferme positive di §1: sono la prova che la taratura entropia e
  l'RLS reggono sul reale.

---

## 7. Dopo, e solo dopo: i 7 piani blueprint di `progetto-web-ai`

A rumore chiuso, la metà BUILD è pronta a lavorare sui 7 piani:
**contratto d'architettura** (`arch_check`, gate assoluto sul grafo import reale — è ciò che
impedisce all'altitudine di degradare piano dopo piano), **test d'accettazione per AC** con
trace-check `covers:` (`AT-1` A+B), **igiene a delta** (il progetto ha già
`.trueline/hygiene-baseline.json`: il ratchet è attivo), **disciplina di costruzione**
(`BD-1`, advisory). Il floor del pack è `[secret, dependency-vuln, rls]`; il `verified_set`
è `[secret, rls, dead-code]`.
