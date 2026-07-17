# A0 — Il controllo di sicurezza dà verde su un oracolo authz non eseguito

> **Design doc.** Milestone **A0** (sicurezza, scorporata). Chiude un falso verde del
> controllo 2 del checkpoint riprodotto su codice già su `main`. Nasce da una domanda
> dell'utente sugli oracoli di *qualità* del codice; l'indagine ha trovato prima un buco
> di *sicurezza*, che va fixato per primo. Le milestone su qualità (duplicazione/cicli su
> delta, altitudine come contratto del blueprint) e sull'hardening dell'harness sono
> **fuori scope** qui e tracciate in §10.

Data: 2026-07-17 · Stato: **proposto**, in attesa di revisione umana · Lock candidati: nessun lock nuovo (fix di un'invariante esistente, `L-COL-006`).

---

## 1. Il problema, in una frase

Su un progetto Firebase/Appwrite/PocketBase/Hasura/Amplify, il **controllo 2 (sicurezza)**
del checkpoint ritorna `green: true` mentre una regola di autorizzazione spalancata
(`allow read, write: if true`, OWASP A01:2025 / CWE-862) è ancora presente, perché
l'oracolo authz dichiarativo dell'ecosistema **non viene eseguito** e il ramo "tool
sconosciuto" preserva il verde invece di declassare.

È la classe di fallimento peggiore per questo prodotto: il valore intero di Trueline è il
gate di sicurezza (`L-COL-002`), e questo è un falso verde **dentro** il gate di sicurezza.

## 2. La prova (riprodotta due volte, indipendentemente)

Fixture: `eval/ecosystems/firebase-jsts/reference-app`, copiato in scratchpad. Neutralizzati
il secret (`serviceAccount.json` rimosso) e l'injection (`src/routes/search.ts`: `exec` con
shell → `execFile` con argv array). **Lasciata** la regola `FB-S3` in `firestore.rules`:
`allow read, write: if true`.

```
$ node trueline/scripts/checkpoint/run_checkpoint.mjs <copia> --in-place --no-osv --mode build
  controllo id:2 → { status:'green', green:true,
    detail:'nessun finding di sicurezza NUOVO >= HIGH [gitleaks:0 semgrep:0]
            (firestore_rules_check: tool sconosciuto, saltato — DICHIARATO, mai falso verde)',
    blockers:[], findings_total:0 }
```

La contraddizione è testuale: `green:true` mentre lo stesso `detail` ammette che l'oracolo
authz è stato *saltato* e afferma *"mai falso verde"*. L'oracolo, eseguito stand-alone,
**trova** il difetto:

```
$ node trueline/scripts/oracles/firestore_rules_check.mjs <copia>
  findings:[{ control_id:FIRESTORE001_PUBLIC_ALLOW, severity:HIGH, category:authz,
    match_path:/databases/{database}/documents/public_notes/{noteId},
    statement:'allow read, write: if true;' }]
```

Il bug è **puramente di cablaggio**: l'oracolo esiste e funziona, ma non è collegato al
gate batch.

## 3. Causa radice (codice reale)

Tre fatti nel codice compongono il falso verde.

1. **`checkpoint.mjs:229` — `toWrapper`** mappa solo `{gitleaks, rls_check, osv, semgrep}`.
   I 5 oracoli authz dichiarativi non ci sono. `checkpoint.mjs:236` fa
   `wrapper = toWrapper[t] || t`, quindi un tool ignoto passa col proprio nome.

2. **`checkpoint.mjs:210-214` — ramo `default` di `runTool`**: per un tool non mappato
   ritorna solo `{ note }` (una stringa), **senza** `{ fatal }` e **senza** declassare lo
   stato.

3. **`checkpoint.mjs:256-260` — composizione del verdetto**: `green = blockers.length === 0`;
   le `notes` finiscono **solo** in `detail`. Un oracolo saltato non produce finding →
   `blockers = []` → `green: true`. La nota è cosmetica.

Il manifest **viene** risolto (`runCheckpoint` → `resolveManifest` → `classify` →
`loadManifest`, `checkpoint.mjs:553-593`): il ramo manifest-driven è quindi vivo su ogni
percorso reale (BUILD, REMEDIATE via `run_loop`, CLI). Non è un percorso morto.

**Asimmetria già corretta altrove.** I controlli 3 e 4, quando non possono girare, emettono
`status:'degraded', green:false`, e `runCheckpoint` documenta (`checkpoint.mjs:566-573`) che
un controllo degradato impedisce il verde d'insieme (opzione `gateOnDegraded`, default on).
**Il meccanismo giusto esiste già**; il controllo 2 semplicemente non lo usa: è sempre
`green`/`red`, mai `degraded`.

## 4. Raggio, verificato

Esattamente **6 pack** — gli unici il cui oracolo authz non è `semgrep` (che è mappato):

| Pack | Oracolo authz | authz ∈ floor | authz ∈ verified_set |
|---|---|---|---|
| `firebase-jsts` | `firestore_rules_check` | sì | sì |
| `firebase-py` | `firestore_rules_check` | sì | sì |
| `appwrite-jsts` | `appwrite_perms_check` | sì | sì |
| `pocketbase-jsts` | `pocketbase_rules_check` | sì | sì |
| `hasura-jsts` | `hasura_metadata_check` | sì | sì |
| `amplify-jsts` | `appsync_auth_check` | sì | sì |

Due strati:

- **BUILD**: il checkpoint è l'unico gate → tutti e 6 hanno il falso verde.
- **REMEDIATE**: `run_loop.mjs::collectFindings` (`:154`) semina l'oracolo iniziale **solo
  per firestore**. I due pack Firebase sono quindi compensati (il verify-fix loop ri-cattura
  l'authz col giusto oracolo via `loop.mjs::rerunOracleFor`); ma **appwrite, pocketbase,
  hasura, amplify non eseguono il loro oracolo authz da nessuna parte** sul percorso reale —
  authz mancata end-to-end. Questo è il pezzo-sicurezza ereditato dal "difetto 2" della
  verifica adversariale, e rientra in A0.

Nota di onestà (`L-COL-006`): la riproduzione ha isolato il verde del **solo controllo 2**
(nel fixture nudo il controllo 1/knip andava in errore, rendendo il checkpoint complessivo
non-verde). Il falso verde "ship-it" — intero checkpoint verde col buco authz — e i 4
backend non-Firebase su config spalancate **non sono ancora stati eseguiti**: sono il
**primo test-first del build** (§8, AC-0), non un'assunzione.

## 5. Cosa NON è (per non gonfiare lo scope)

La verifica adversariale ha ridimensionato tre affermazioni iniziali; restano fuori da A0:

- **Gli oracoli authz NON sono "orfani".** Sono dispatchati da `loop.mjs::rerunOracleFor`
  (produzione) e documentati nei `guide.md` per-ecosistema (percorso utente). Il residuo
  reale è solo: (a) il checkpoint batch non li esegue (= questo difetto), (b) `collectFindings`
  semina solo firestore (= §4, in A0), (c) prosa `remediate.md` supabase-centrica (**igiene,
  milestone successiva**).
- **`tidyAdvisory` eval-only è by-design.** `build_discipline.mjs` è uno strumento di eval
  dichiarato; la disciplina di scrittura reale è consegnata come **prosa** nei mode-doc.
  Nessun bug di correttezza. (Residuo debole: sul percorso reale la nota tidy non ha un
  emettitore deterministico — **milestone successiva, priorità minima**.)
- **`ecosystem_conformance:801` (verified_set gonfiato) è latente e non-sicurezza.** Tocca
  l'infra di eval, oggi non innescato. **Milestone successiva (hardening).**

## 6. Design del fix

Due interventi nel checkpoint (uno primario, uno strutturale) + un ride-along nel loop + un
guard di validazione. Il principio unificante è **`L-COL-006`: un oracolo che non gira NON è
verde** — applicato dove oggi è violato.

### 6.1 Primario — cablare i 5 oracoli authz nel controllo 2

In `control2Security` (`checkpoint.mjs`), aggiungere a `runTool` un ramo per ciascuno dei 5
oracoli authz dichiarativi, che:

- invoca lo script oracolo già esistente (`trueline/scripts/oracles/{firestore_rules,appwrite_perms,pocketbase_rules,hasura_metadata,appsync_auth}_check.mjs`),
- normalizza l'output col normalizer già esistente (`safeNormalize('firestore-rules'|'appwrite-perms'|'pocketbase-rules'|'hasura-metadata'|'appsync-auth', …)` → `normalize{FirestoreRules,AppwritePerms,PocketbaseRules,HasuraMetadata,AppsyncAuth}`, categoria `authz`),
- spinge i finding in `all` con path/fingerprint coerenti col baseline-delta.

**Niente codice nuovo di oracolo o di normalize**: entrambi esistono e sono già usati
dall'harness `eval/harness/ecosystem_conformance.mjs:114-138` (mapping bespoke tool→script).
A0 riproduce quel wiring nel gate **runtime**. Il dispatch va tenuto a **sorgente unica** con
`loop.mjs::rerunOracleFor` e con la mappa dell'harness, per non avere tre tabelle divergenti
(rischio di falso verde da dispatch disallineato — vedi `L-COL-029`, debito 3ª-copia).

Una volta cablato, l'oracolo gira, trova `FIRESTORE001_PUBLIC_ALLOW/HIGH`, e
`deltaBlockers` lo blocca perché `authz ∈ gateCategories` (`control2CategoriesFrom` la
include già — oggi è inerte solo perché nessun finding viene mai prodotto). I 6 pack sono
tappati.

### 6.2 Strutturale — un oracolo di floor non eseguito declassa il controllo 2

Il primario tappa i 5 nomi di oggi. Lo strutturale rende la **classe** impossibile, così il
6° oracolo che aggiungeremo non ricade nella trappola.

Regola: in `control2Security`, **nel ramo manifest-driven**, se un oracolo la cui categoria è
nel **floor del manifest** **non viene eseguito** — sia perché il wrapper manca (ramo
`default`), sia perché degrada per ambiente — il controllo 2 emette `status:'degraded',
green:false`, non `green` con nota. Il ramo legacy senza manifest (`checkpoint.mjs:242-244`)
**non è toccato** (non ha un floor esplicito; resta la sequenza cablata v1).

**Confine da preservare (best-effort onesto).** Oggi `osv` e `semgrep` degradano di
proposito con una nota che **lascia il verde** (osv richiede rete; semgrep gira via docker,
spesso assente): è una scelta dichiarata per non rendere rosso ogni checkpoint senza
infrastruttura. La regola sopra **non** la rompe: un oracolo best-effort la cui categoria è
**fuori dal floor** (detection-only) continua a degradare con nota, verde preservato. Cambia
solo il caso in cui la categoria **è di floor** — lì "degrada onesto" deve significare quel
che significa nei controlli 3/4: `green:false`.

Conseguenza corretta e voluta: un pack in cui `authz`/`injection` è di floor e gira via
`semgrep`, quando docker è assente, **non è più verde** — diventa degradato. È esattamente
`L-COL-006`. (Verificare in build l'impatto sui pack F4/route-authz — §8, AC-4.)

**Meccanica.** Il ramo `default`/best-effort di `runTool` oggi riceve solo il nome del tool,
non la categoria. Serve portare l'informazione "questa categoria è di floor" fino alla
decisione di declass: o passando la categoria a `runTool`, o marcando la nota con un flag
`floorMiss` che la composizione del verdetto (`:256-260`) traduce in `degraded`. Scelta
implementativa demandata al plan; vincolo: **nessun doppio conteggio** e **shape del report
invariante** sui percorsi che oggi sono verdi legittimamente.

### 6.3 Ride-along — `collectFindings` semina tutti e 5 gli oracoli authz

In `run_loop.mjs::collectFindings` (`:140-168`), la detection iniziale esegue
incondizionatamente solo `firestore_rules_check` (`:154`). Estendere alla dispatch
per-ecosistema (stessa tabella di §6.1), così che in REMEDIATE gli oracoli di appwrite,
pocketbase, hasura, amplify vengano **seminati** e il verify-fix loop possa girare su di
essi. Chiude il buco end-to-end dei 4 pack non-Firebase.

### 6.4 Guard — `validate_ecosystem` valida il vocabolario delle categorie

In `validate_ecosystem.mjs`, dopo la costruzione di `oracleKeys` (`:29-30`), aggiungere:
ogni chiave-categoria di `oracles` (e quindi di `floor`/`verified_set`) deve appartenere
all'**enum chiuso** di `finding.schema.json` (`secret, rls, dead-code, injection, authz,
crypto, dependency-vuln, config, misc`). Oggi assente: un refuso come `injecton` passa il
validatore (`RESULT: OK`, exit 0) e fa **cadere silenziosamente** `injection` da
`control2CategoriesFrom` → un finding injection nuovo non blocca più. Stessa classe di
buco-gate silenzioso del difetto primario, costo minimo, entra in A0 perché il worst-case è
sicurezza.

## 7. Architettura & flusso dati

```
runCheckpoint(dir)
  └─ resolveManifest(dir)  [classify → loadManifest]        (invariato)
  └─ control2Security(dir, { manifest })
        ├─ costruisci lista tool da manifest.oracles         (§6.1: +5 wrapper authz)
        ├─ per ogni tool: runTool(tool)
        │     ├─ wrapper noto → esegui oracolo + normalize → all[]
        │     ├─ authz dichiarativo → esegui script + safeNormalize('…-rules'|…) → all[]   ◄ §6.1
        │     └─ non eseguito (ignoto | best-effort down):
        │            categoria ∈ floor  → degraded (green:false)                          ◄ §6.2
        │            categoria ∉ floor  → nota, verde preservato                          (invariato)
        ├─ blockers = deltaBlockers(all, baseline, { gateCategories })   (authz già in gateCategories)
        └─ verdetto: green | red | degraded
```

Contratto del finding (`04`) invariato: gli oracoli authz già emettono `category:'authz'`,
`owasp:A01:2025`, `cwe:862`. Fingerprint ancorato a contenuto/`match_path` (non alla riga),
come per gli altri oracoli.

## 8. Testing — gate falsificabile e non-regressione

Test-first (`L-COL-019`/`L-COL-027`). Il "verde" è un fatto d'oracolo, mai una frase (`L-COL-002`).

- **AC-0 (chiude i blind spot §4, PRIMA di scrivere il fix).** (a) Su una fixture Firebase
  **con test verdi**, con solo la regola `if true` come difetto, dimostrare che oggi l'**intero
  checkpoint** è verde (il falso verde "ship-it"). (b) Per ciascuno dei 4 backend non-Firebase,
  dimostrare che l'oracolo authz flagga una config spalancata stand-alone e che il checkpoint
  oggi lo salta.
- **AC-1 (primario).** Dopo il fix, sulla stessa fixture il controllo 2 è **rosso** con il
  finding `authz` nei `blockers`. Gemello falsificabile: neutralizza il cablaggio di
  `firestore_rules_check` → il controllo 2 torna verde-bugiardo → ripristina → rosso.
- **AC-2 (i 6 pack).** Un fixture spalancato per ciascuno dei 6 pack → controllo 2 rosso
  (authz). Con la config owner-scoped → verde legittimo.
- **AC-3 (strutturale).** Un manifest sintetico con un oracolo di floor **senza wrapper** e
  senza finding → controllo 2 **degraded** (green:false), non green. Con la categoria fuori
  dal floor → nota, verde (best-effort preservato).
- **AC-4 (best-effort non regredito).** Su un pack dove `injection`/`authz` è **detection-only**
  (fuori floor) e semgrep è assente → controllo 2 resta verde con nota (invariato). Su un pack
  dove è **di floor** e semgrep è assente → degraded. Documentare quali pack cambiano.
- **AC-5 (ride-along).** Un run REMEDIATE su fixture vulnerabile appwrite/pocketbase/hasura/
  amplify semina l'oracolo authz e il loop lo può chiudere (o lo dichiara `mitigated-residual`
  onestamente).
- **AC-6 (vocabolario).** `validate_ecosystem` su un manifest con categoria-refuso
  (`injecton`, `duplicaton`) → **FAIL** (exit 1). Sui 20 manifest reali → OK.
- **Non-regressione integrale (SERIALE, `L-COL-002`).** `m5` **56/56** (BIT-invarianza sul
  percorso canonico supabase-jsts, che passa dal ramo manifest-driven), `ecosystem_conformance`
  sui pack toccati, `anti_tamper_check` 49/49, `build_discipline_check` 21/21, `package_skill`
  lint VERDE. **0 contaminazione** (guardrail `assertIsolatedRepo`).

I gate RLS-runtime e i pack che richiedono docker/tool assenti si eseguono su macchina
capace; il gap d'ambiente va **dichiarato**, non trattato come verde (`L-COL-006`).

## 9. Error handling & invarianti

- Un oracolo che **crasha** (non "trova zero") è un errore, non un verde: gli oracoli HARD
  (gitleaks/rls) già fanno `secErr`; i 5 authz vanno trattati come HARD **quando la loro
  categoria è di floor** (declass o fatal), best-effort solo se detection-only.
- **Invarianza sul percorso canonico (`m5`/supabase-jsts).** `supabase-jsts` è
  classificabile e passa dal ramo **manifest-driven** (non dall'`else`), quindi l'invarianza
  non deriva dall'else. Deriva da: la regola floor-declass cambia il comportamento **solo**
  quando un oracolo di floor non gira; nell'ambiente in cui i gate sono validati (semgrep via
  docker presente, wrapper presenti) **nessun oracolo di floor di supabase-jsts viene
  saltato** → nessun cambio di comportamento → `m5` 56/56 invariato. Il ramo legacy `else`
  (`checkpoint.mjs:242-244`) resta comunque identico byte-per-byte.
- **Git solo nell'orchestratore**; agenti del workflow non toccano git (`L-COL-024`). Branch
  dedicato `feat/a0-checkpoint-authz-false-green`, `main` intatto fino al merge human-gated.
- Nessun lock nuovo: A0 ripara un'invariante esistente. Se durante il build emerge che la
  regola floor-declass merita di essere codificata come principio, si valuterà un emendamento
  a `L-COL-006`/`L-COL-018` in fase di ledger, non prima.

## 10. Fuori scope (milestone successive)

- **A1 — hardening harness/igiene**: `ecosystem_conformance` assert per-categoria del
  verified_set (difetto 4, latente); generalizzare la prosa di `remediate.md` per-ecosistema
  + inventario dei 5 oracoli in `SKILL.md`; documentare che la nota tidy sul percorso reale è
  solo-prosa (difetto 3).
- **A2 — oracoli di qualità (la domanda originale dell'utente)**: duplicazione letterale
  (`jscpd`) e cicli di import (`dependency-cruiser`) come controllo 1, LOW, **delta-gated**,
  detection-only; coverage declaration del riuso **topologico** già spedito (knip); l'altitudine
  come **contratto dichiarato del blueprint** (`arch_check` ~ `rls_check`, con vacuity guard).
  Precondizione decisa con l'utente: **misurare** sul suo repo reale quanti cloni sono verbatim
  vs rinominati, per fissare il threat model del gate duplicazione (jscpd non vede i cloni
  Type-2 con identificatori rinominati; l'avversario è un LLM che rinomina bene).
- **Mai gate**: efficienza (indecidibile, Rice; le metriche di complessità sono falsi verdi
  dimostrati), N+1 statico (proprietà del testo, non del costo), "avrebbe dovuto riusare X"
  (giudizio). Restano advisory o dichiarati non-coperti.

## 11. Definizione di "fatto" per A0

Tutti gli AC verdi in riesecuzione seriale, con AC-1 falsificabile provato, `m5` 56/56
invariato, 0 contaminazione; branch mergeato `--no-ff` su `main` human-gated e pushato;
install globale riallineato. Il falso verde di sicurezza non è più riproducibile su nessuno
dei 6 pack, in BUILD e in REMEDIATE.
