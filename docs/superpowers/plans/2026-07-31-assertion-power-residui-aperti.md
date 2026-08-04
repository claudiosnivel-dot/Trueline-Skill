# Residui aperti — oracolo del potere dell'asserzione (`L-COL-037`)

> **Cos'è questo file.** I rilievi parcheggiati durante la sessione 30–31 lug 2026, **triati e
> verificati contro il codice** il 31 lug, dopo il merge di `89233fc`. Sostituisce il ledger
> di sessione (`.superpowers/sdd/…/progress.md`, git-ignored e cancellato): quello ne elencava
> **38**, ma **13 erano già stati chiusi** dai task successivi e mai depennati.
>
> **Perché esiste.** Una lista di 38 aperti che in realtà ne ha 25 è essa stessa una
> dichiarazione che non corrisponde ai fatti — la classe di difetto che `L-COL-037` registra,
> nel documento che la registra. Ogni riga qui sotto porta **come è stata verificata**.
>
> **Nessuno di questi blocca il merge**: la review d'insieme li ha triati come Minor, e il gate
> seriale è verde integrale (`assertion_power_check` 20/20, `m5` 56/56 REALE).

---

## A · Sicurezza dei dati dell'utente — il gruppo che vale per primo

L'oracolo **scrive nel sorgente** della dir che il checkpoint riceve: un workspace nel loop, ma
l'albero **vero** dell'utente con `run_checkpoint --in-place`, che è il percorso principale della
metà BUILD (`references/modes/build.md`). Le reti sono tre — `finally`, guardia sha256, rete su
`exit`/segnali + flag `TREE_DIRTY` — e questi sono i loro buchi noti.

| # | Rilievo | Dove | Verificato |
|---|---|---|---|
| A1 | **Finestra mid-write.** Il `catch` del write di **mutazione** dichiara «l'albero NON è stato toccato» e fa `PENDING.delete`. Vero se il guasto è all'**open** (EPERM, antivirus, sola lettura); **falso se è a metà scrittura** (ENOSPC, EIO, disco di rete): il file resta **troncato a zero byte** e la rete che l'avrebbe rimesso viene dimenticata. Esito `degraded`, mai `green` — quindi Minor — ma è l'**ottavo esemplare** della classe, nato dentro il fix finale. Correzione simmetrica al ramo di ripristino: verificare `sha(readFileSync(path)) === h0` prima di dimenticare, e `markTreeDirty` altrimenti (2 righe). | `ac_assertion_power_check.mjs:499-511` | `grep`: il ramo esiste e non ha guardia sha |
| A2 | **`spawnSync` senza `timeout`.** Fra la mutazione e il `finally` un target_test che si appende blocca senza limite; un `kill -9`, un `taskkill /F` o un crash dell'host in quella finestra non fanno girare **alcun handler**, e il file resta mutato senza marcatore. **Dichiarato** nella prosa spedita, non chiuso: metterlo tocca anche il run normale del controllo 4 e la bit-invarianza, quindi va meditato. | `trueline/scripts/checkpoint/run_file.mjs:53` | `grep timeout` → zero occorrenze |
| A3 | **`insideDir` senza `realpathSync`.** Il contenimento in `appDir` confronta path risolti ma non canonicalizzati: un **symlink dentro `appDir` che punta fuori** supera la guardia e viene riscritto. Rischio basso (i bare specifier sono esclusi, quindi `node_modules` non si raggiunge); il caso plausibile è un monorepo pnpm. | `ac_assertion_power_check.mjs:295-298` | `grep realpathSync` → assente |
| A4 | **`TREE_DIRTY` è di processo.** In `run_loop`, che chiama `runCheckpoint` in ciclo nello stesso processo, un EBUSY transitorio alla prima iterazione rende `error` il controllo 4 di **tutte** le successive, anche su app diverse. Direzione conservativa (non produce mai un verde) e **deliberato**, ma da sapere prima del primo loop lungo. | `ac_assertion_power_check.mjs:339-341` | dichiarato nel commento del codice |

---

## B · Copertura — invarianti senza testimone rosso

| # | Rilievo | Ruling |
|---|---|---|
| B1 | **`PENDING.delete` dopo la guardia sha** e **`rememberOriginal` che non sovrascrive**: i mutanti sopravvivono. | **Parcheggiati con motivazione, non trascurati.** La re-review ha **enumerato tutte le uscite** e stabilito che il testimone **non esiste per costruzione**: ogni percorso o cancella la voce o esce dalla funzione, quindi `PENDING` è provatamente vuoto all'inizio di ogni candidato. Sono **guardie contro una riorganizzazione futura**, e il commento nel codice lo dice senza gonfiarlo. Un testimone richiederebbe un seam d'iniezione nel prodotto: costo maggiore del rischio. |
| B2 | **La guardia backtick di `maskComments` è cancellabile a suite verde** (17ª mutazione, misurata). Il danno è reale — senza l'eccezione, un `//` dentro un template literal multi-riga viene sbiancato, cioè codice vivo cancellato — ma **nessuna fixture usa template literal multi-riga**. | Aperto. Una fixture da tre righe lo chiude. |
| B3 | **`bit-invariance:legacy` asserisce meno del suo nome**: guarda `status` + `green`, non il `detail`, e `degraded` è raggiungibile da **due** rami di `control4Conformance`. Se un lavoro futuro allargasse la guardia del ramo AC, resterebbe **verde con la bit-invarianza violata**. | Aperto. Asserire anche sul `detail` lo chiude. |
| B4 | **Delle quattro cause `structural` il keystone ne esercita end-to-end una sola** (`= make()`). Manca la fixture di **`import * as ns`**, che è **il caso che ha motivato l'intera decisione dell'utente** sui due `kind`. Non è un buco di verdetto (le quattro condividono il ramo di classificazione), ma la fixture che racconta la storia non c'è. | Aperto. |

---

## C · Artefatti che affermano più di quanto valgano

La classe che `L-COL-037` registra, nei residui che la registrano.

| # | Rilievo | Dove | Verificato |
|---|---|---|---|
| C1 | **`:302-303` resta incondizionale** dove l'intestazione a `:15-19` è condizionale: «lo stadio 2 scrive nell'albero VERO dell'utente … non una copia» non ammette il ramo loop, dove la dir *è* un workspace. Sbaglia in direzione **allarmista**, quindi innocuo — ma è il file che chiude su due formule diverse. | `ac_assertion_power_check.mjs:302-303` | `grep 'non una copia'` → presente |
| C2 | **La prosa degli AC delle fixture descrive un'altra fixture**, ed è **PEGGIORATA**: era 4 su 5, oggi **6 su 9** dicono `given: la config del builder` mentre coprono limiti, addizioni, mirror e registry. Le fixture aggiunte dopo hanno copiato il blocco. Nessun oracolo legge la prosa (la trace è sul tag `covers:`), quindi non spedisce nulla di sbagliato — ma è dentro il set di fixture di un oracolo sulle asserzioni che non valgono ciò che dicono. | `eval/assertion-power/*/blueprint/01.md` | ispezione dei 9 `given:` |
| C3 | **Riferimenti di riga stantii**: i commenti citano `checkpoint.mjs:928` e `:936`, che dopo le modifiche sono `:941` e `:949`. | `eval/harness/assertion_power_check.mjs` | `grep` → presenti |
| C4 | **Il commento nomina un solo dei due anelli portanti**: dice che la clausola 2 regge «solo grazie alla risalita», ma il mutante prova che **anche il riporto negli emettitori** è portante. Chi rimuovesse il riporto conservando la risalita leggerebbe un commento che lo rassicura a torto. | `checkpoint.mjs:785-789` | rilevato in re-review |
| C5 | **Refuso `JOSN` per `JSON`** in un commento. | `eval/harness/assertion_power_check.mjs:449` | `grep` → presente |

---

## D · Distribuzione

| # | Rilievo | Verificato |
|---|---|---|
| D1 | **`dist/trueline-plugin/` è a `0.1.0`** (payload di inizio luglio, privo dell'oracolo). Non tracciata, fuori dal canale documentato di `09 §82` — ma chi vi avesse puntato un marketplace locale riceve contenuto di un mese fa. | `plugin.json` letto: `0.1.0` |
| D2 | **`dist/packages/…` è a `0.1.0`** (payload 2026-07-04). Altra area di staging, con `.git` annidato e `build.sh` proprio: **non è il canale documentato** e va rigenerata da chi la possiede, o cancellata. | `plugin.json` letto: `0.1.0` |
| D3 | **`--record-release` non rigenera il marketplace locale** (serve `--plugin <dir>`). Il 31 lug questo ha lasciato `dist/trueline-marketplace` a `plugin.json 0.4.0` mentre `skill_version` era `0.4.1`: **un update lanciato lì avrebbe installato la versione precedente riportando successo** — il difetto del 28 lug spostato di un anello. Colto prima di installare, ma il meccanismo resta. | riprodotto in sessione |

---

## E · Precisione e costo — chiudibili quando si passa di lì

| # | Rilievo | Dove |
|---|---|---|
| E1 | Un'**asserzione dentro una stringa** resta visibile ad `ASSERT_RE` (i letterali non sono mascherati, per scelta: `obj['k']` deve restare leggibile). È **l'unico percorso di falso positivo noto**: serve che entrambe le radici siano binding importati veri — congiunzione stretta, mai osservata, e **dichiarata** sia nello spedito sia nel ledger. | `ac_assertion_power_check.mjs:139-173` |
| E2 | **Uno spawn per candidato**, non per file: N asserzioni nello stesso file contro lo stesso binding = N riesecuzioni. Dedup per `(rel, bindingModule, bindingName)` è comportamento-preservante. **Ogni candidato riesegue i test dell'utente** — su Supabase possono toccare un DB vero. | `ac_assertion_power_check.mjs:388-451` |
| E3 | **`acsOf` con chiave non normalizzata**: un blueprint con separatori `\` manca la mappa e il messaggio degrada a `[AC ignoto]`, che è la perdita che il parametro `tasks` esiste per evitare. Verdetti non toccati. | `:372-374` vs `:386` |
| E4 | **`existsSync(base)` è vero anche per una directory**: una cartella chiamata `foo.ts` verrebbe restituita come modulo. Il test d'estensione lo restringe. | `resolveSpec:191` |
| E5 | **Costo del keystone**: il sotto-test (16) esegue un checkpoint completo a 4 controlli, fino a 6 volte nel caso peggiore col retry. Prezzo dichiarato e accettato, ma il gate non è più trascurabile. | `eval/harness/assertion_power_check.mjs` |
| E6 | **`TOTAL_SUBTESTS` è invariante sul conteggio, non sui nomi**: sostituire un sotto-test con un altro lascia il floor soddisfatto. Fallisce in direzione sicura. | `:175`, `:184` |
| E7 | `stage()` non pulisce la destinazione; stringhe di dettaglio con `JSON.stringify` valutate eagerly; duplicazione verbatim fra due unit test; path della temp fixture ricostruito a mano nel `finally`; il blocco Task 6 del runbook sostituisce una lista hardcoded con un'altra (mitigato dal «Misura, non copiare» adiacente). | vari, harness |

---

## Già chiusi — non riaprirli

Verificati contro il codice il 31 lug 2026, dopo `89233fc`:

`restore:bit-exact` con la guardia `x.r &&` · import `writeFileSync`/`createHash` (li usa il Task 3) ·
`matchBalanced` che gira sul sorgente mascherato · `reason` distinto per le tre cause del `null` ·
normalizzazione dei separatori **prima** del join · `PENDING.delete` **dopo** la guardia sha ·
ramo no-op coperto dalla fixture `noop-neutral` · ripristino provato **attraverso** `control4Conformance` ·
`coverage.declared` che raggiunge l'output emesso · `dist/trueline-marketplace` rigenerato a `0.4.1` ·
la frase falsa «sulla copia di lavoro» nel piano · l'intestazione del keystone e `TOTAL_SUBTESTS` ·
la cardinalità di `unresolved:declared`.

**Nota di metodo, che vale il file.** Nel triage due voci risultavano APERTE e non lo erano: il mio
controllo su `PENDING.delete` confrontava la **prima** occorrenza invece di quella giusta, e quello
sulla normalizzazione aveva un pattern rotto dall'escaping. È la quarta volta nella sessione che
**lo strumento di misura era rotto e l'oracolo aveva ragione** — dopo un `| tail -5` che ha buttato
via i rossi, un gate letto sotto contesa (`m5` 55/56, la firma storica di SP-4) e una precedenza di
shell che ha prodotto un falso «ASSENTE». Un gate cieco e uno strumento sordo producono lo stesso
risultato: una conclusione sbagliata che sembra misurata.
