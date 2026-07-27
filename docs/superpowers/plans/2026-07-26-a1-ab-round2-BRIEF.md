# BRIEF turnkey — A1 + secondo giro dell'A/B (chiusura di `O-COL-012`)

> **Cos'è.** Il brief pronto-all'uso per la **prossima sessione**. Chiude il round 1
> dell'esperimento di `O-COL-012` (misura #1 in `DYNAMIC-WORKFLOWS` §5.1), che lasciò
> **l'Ipotesi B non decidibile** per un difetto di progettazione dell'orchestratore.
>
> **Sorgente delle decisioni:** `PROMPT — Adozione Opus 5` §3/§4/§6/§7 · `L-COL-027`
> emendato (`00-INDEX §4`) · `O-COL-012` aperta · `DYNAMIC-WORKFLOWS` §5.1.
>
> **Data:** 26 luglio 2026 (scritto a chiusura della sessione H-1).

---

## 1. Perché il round 1 non ha chiuso l'Ipotesi B

Non per un problema del modello: per un **errore di progettazione mio**. Il keystone
`h1_perpid_check` copriva i **16 pack**, mentre il mandato del task T3 copriva solo i **5
harness**. Un verificatore ha quindi correttamente segnalato «il keystone non è verde» contro
un task che *non poteva* renderlo verde; il fixer ha eseguito in anticipo il lavoro di W3; e i
due bracci dell'A/B hanno trovato il lavoro sostanziale **già fatto**, riducendosi a 4 righe di
commento per file.

**Regola che ne discende** (già registrata in `DYNAMIC-WORKFLOWS` §5.1): *il gate di un task
non può essere più largo del task.* È `L-COL-019` applicato ai nostri workflow.

---

## 2. Il substrato del secondo giro — misurato, non ipotizzato

**Task:** portare la **guardia di proprietà della radice temp** nei 16
`eval/ecosystems/*/verify_fix_check.mjs`, allineandoli ai 5 harness.

**Misura fatta il 26 lug (comandi riproducibili):**

```
grep -l "INHERITED" eval/harness/*.mjs        → 5/5 harness ce l'hanno
grep -L "INHERITED" eval/ecosystems/*/verify_fix_check.mjs → 16/16 NON ce l'hanno
grep -n "verify_fix_check" eval/harness/ecosystem_conformance.mjs → nessun match
```

**Classificazione ONESTA (`L-COL-006`) — leggere prima di costruire.** Il difetto è
**LATENTE e oggi NON RAGGIUNGIBILE**: nessun harness invoca i `verify_fix_check` come figli,
quindi nessuno di essi eredita oggi una radice altrui. Non è un difetto vivo e **non va
raccontato come tale**. Le due ragioni per cui vale comunque la pena farlo:

1. **Pattern applicato a metà.** H-1 ha dato ai 16 pack la rampa «env se presente, altrimenti
   privata per-pid» *senza* la guardia che impedisce a un figlio di radere la radice del padre
   (i 5 harness ce l'hanno). Chi in futuro cablerà un padre che invoca un pack erediterà una
   trappola silenziosa — la stessa classe di difetto che H-1 ha appena eliminato.
2. **È il substrato ideale per l'A/B**: 16 file, modifica **uniforme e meccanica** (~3 righe
   per file), **due lotti disgiunti**, gate **deterministico e scopabile per lotto**.

La ragione (2) è dichiarata, non nascosta: si sta scegliendo *quale* lavoro utile fare anche in
base al fatto che serve una misura pulita. Ciò che NON è consentito è **inventare** lavoro per
avere una misura.

**Scartato dopo misura (registrato per non rifare l'analisi):** l'allineamento delle
`guide.md` per-pack al tier del manifest. Scansione dei 20 pack: **0 stale, 14 "parziali"**
(intestazione storica «batteria detection» con il corpo già aggiornato), 6 puliti. È
un'incoerenza **redazionale**, non un difetto: sotto §7 del prompt Opus 5 non giustifica un
build.

---

## 3. Il gate, scritto PRIMA (e scopato per lotto — la correzione chiave)

Estendere `eval/harness/h1_perpid_check.mjs` con un sotto-test **parametrico**:

```
node eval/harness/h1_perpid_check.mjs --packs=<csv>
```

- `static:pack-ownership-guard` — per **ciascun pack nella lista passata**: il file dichiara
  la guardia (radice ereditata ⇒ il cleanup della RADICE è saltato; la rimozione della propria
  COPIA resta sempre attiva).
- `runtime:pack-inherited-root-survives` — prova **eseguita**, non statica: si lancia il
  `verify_fix_check` di un pack del lotto con `TRUELINE_TMP_VERIFY_ROOT` puntato a una radice
  che contiene già una dir "viva" di un finto padre, e si asserisce che quella dir **sopravvive**.
  Falsificabile per costruzione: senza la guardia il sotto-test deve fallire.
- Senza `--packs`, il default resta **tutti e 16** (invarianza per il gate integrale).

**Perché `--packs` è il punto centrale:** consente al gate del lotto A di essere verde **mentre
il lotto B non è ancora stato fatto**. È esattamente ciò che mancava nel round 1.

---

## 4. Protocollo dell'A/B — le sei correzioni

1. **Gate per-lotto** (§3): ogni braccio è gatato **solo sui propri 8 file**.
2. **Nessun fixer fra i bracci.** La fase A/B gira **prima** di qualunque altro task che possa
   toccare i file dei pack. Ogni fixer riceve una **lista di file esplicita** e l'orchestratore
   verifica col `git diff` che non l'abbia superata.
3. **Stato di partenza identico e VERIFICATO.** L'orchestratore registra `git rev-parse HEAD` +
   `git status --porcelain` prima della fase; il prompt di ciascun braccio dichiara lo stato
   atteso e impone: *se trovi file già modificati fuori da quelli attesi, FERMATI e riportalo —
   non adattarti*. (Nel round 1 gli agenti si sono adattati, ed è giusto che l'abbiano
   segnalato: ma così la misura è persa.)
4. **Bracci in SEQUENZA**, con `budget.spent()` campionato **attorno ai soli builder** (nel
   round 1 questa parte ha funzionato: è l'unico modo di avere un costo per-braccio pulito).
5. **Verifica simmetrica**: stesso prompt di verifica per i due bracci, stesso effort (`max`),
   BLIND entrambi.
6. **Lotti bilanciati, non alfabetici**: ordina i 16 file per righe e assegna a zig-zag
   (1→A, 2→B, 3→B, 4→A, …) così i due lotti hanno massa comparabile. Registra nel brief di
   run la composizione esatta dei lotti **prima** di lanciare.

**Bracci:** A = modello di punta a effort `low` · B = **Sonnet**. Verifier di entrambi: modello
di punta, effort `max`.

---

## 5. Criteri di chiusura

**Ipotesi B — decidibile con questo giro.** Con lo stesso task, lo stesso gate e lo stesso
metro di giudizio, si confrontano: token di output per braccio, tool call, wall-clock, e
**difetti bloccanti trovati dal verifier BLIND per braccio**. Chiusura:
- se un braccio è **più economico a pari qualità** (0 blocking entrambi, diff minimo entrambi)
  → si ratifica quello per i task meccanici, emendando `L-COL-027`;
- se il braccio più economico ha **più blocking**, vince la qualità: il costo non compra difetti;
- se i due sono indistinguibili → si pinna lo **status quo** (Sonnet) e si chiude `O-COL-012`
  come «nessuna differenza misurabile», che è un risultato, non un fallimento.

**Ipotesi A — attenzione a cosa si può davvero concludere.** Un A/B vero sull'ampiezza d'onda
richiederebbe di rifare **lo stesso** task con onde larghe, ed è confondato dall'apprendimento:
non si farà. Ciò che questo giro fornisce è la **seconda osservazione** della configurazione
nuova (controllo = A2c F1: 12 agenti, canary 4; H-1: onde ≤2, canary 14, 0 infra, 0 falsi rossi).
Criterio pragmatico dichiarato: se anche il round 2 chiude con **0 falsi rossi da concorrenza,
0 interruzioni d'infra e canary ≥ controllo**, si **ratifica la configurazione a onde strette**
come standing config in `L-COL-027`; altrimenti `O-COL-012` resta aperta con la ragione scritta.

---

## 6. L'altro lavoro della sessione (task delicato, DISGIUNTO dai file dell'A/B)

**A1.1 — assert per-categoria del `verified_set` in `ecosystem_conformance`** (difetto 4,
latente, da `A0 §5`/`§10`). Oggi il gate asserisce che il `verified_set` sia **non vuoto**, non
che **ogni categoria dichiarata** sia davvero portata a `verified` dal loop: un `verified_set`
gonfiato passerebbe. Builder: modello di punta, **effort alto** (è logica delicata, non
meccanica). Gate: **falsificabile** — si gonfia il `verified_set` di un pack con una categoria
che il loop non verifica e il gate deve andare **ROSSO**; ripristino → i 20 pack tornano verdi.

**Disgiunzione verificabile:** A1.1 tocca `eval/harness/ecosystem_conformance.mjs`; l'A/B tocca
`eval/ecosystems/*/verify_fix_check.mjs`. Nessuna intersezione — l'orchestratore lo verifica
col `git diff` prima di dichiarare la misura valida.

**Ordine delle onde:** l'A/B **per primo** (correzione 2), poi A1.1.

---

## 7. Cosa NON fare

- Nessun pack nuovo, nessuna feature nuova: la roadmap di ampiezza resta **congelata** (§7 del
  prompt Opus 5).
- Nessun retry per inseguire un flake: l'isolamento è la soluzione, il retry è la pezza (e in
  SP-3 un retry auto-introdotto è già stato revertato).
- Non allineare le `guide.md` (scartato in §2 dopo misura).
- Non toccare l'albero **spedito** `trueline/` se il lavoro è eval-only: la BIT-invarianza
  provata con `git status --porcelain -- trueline/` è parte del gate.
- **Un solo workflow per sessione**, gateato in seriale e mergeato nella stessa sessione (§6).

---

## 8. Regola d'oro, sopra tutto il resto

Il backlog lo detta il **dogfood**, non questo brief (`docs/dogfood/observations.md`, oggi
vuoto). Se prima della prossima sessione emerge dal progetto reale un **falso verde**, un
**falso rosso** o un **bypass**, quello ha la precedenza su A1 e sull'esperimento: si misura
sul progetto reale e si decide, come si è fatto per A2a.
