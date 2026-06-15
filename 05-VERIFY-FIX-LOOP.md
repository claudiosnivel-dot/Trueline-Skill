# 05-VERIFY-FIX-LOOP — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) |
| **Versione** | v0.1 (Chat C) |
| **Data** | 13 giugno 2026 |
| **Copre** | `L-COL-003` (cardine), `005`, `006`, `018`, `021`, `024`, `025`; **`O-COL-006` (chiusa qui)** |
| **Dipende da** | `01-ARCHITECTURE` v0.1 (§4.2, §5), `03-ORACLES` v0.2, `04-FINDINGS-MODEL` v0.2 |

---

## 1. Perché questo modulo esiste

La detection la fanno tutti. Il valore di Trueline è il **loop di verifica della fix** *(L-COL-003, tesi VISION §3)*: una correzione non è "fatta" perché l'LLM lo dichiara, ma perché **lo stesso oracolo** che ha trovato il problema, riesieguito dopo la patch, non lo trova più — **e** nessun test si rompe. Questo modulo definisce quella macchina: come si applica una fix, come la si ri-verifica, quando si riprova, quando si scarta, e come tutto questo tocca git.

Il loop è anche la **fase di verifica del checkpoint** *(L-COL-018)*: quando un controllo è rosso, è qui che si entra. E muove il `fix_state` lungo il ciclo di vita di `04` §5 — è **l'unico posto** dove un oracolo promuove un finding a `verified`. L'LLM non lo fa mai *(L-COL-002)*.

Una sola riga regge tutto il resto: **applica → riesegui lo stesso oracolo → riesegui i test → accetta solo se il finding è sparito e nulla si è rotto.**

## 2. Vista d'insieme

```
checkpoint rosso (controllo 1/2/3/4)
        │
        ▼
   per ogni finding fixabile, in ordine di triage (08):
        │
   [PROPONI patch] → [GATE UMANO] → [APPLICA sul branch]
        │                                   │
        │                                   ▼
        │                      [RIESEGUI LO STESSO ORACOLO]
        │                      [RIESEGUI I TEST]
        │                                   │
        │              ┌────────────────────┴───────────────────┐
        │         pulito + verde                        flagga o test rotto
        │              │                                         │
        │              ▼                                         ▼
        │         fix_state: verified                     verification-failed
        │                                                        │
        │                                          retry entro O-COL-006?
        │                                          ┌─────────────┴──────────┐
        │                                       sì (revert + patch nuova)  no (terminale)
        └──────────────────────────────────────────┘                       │
        │                                                                   ▼
        ▼                                                    presenta all'umano
   tutti i finding chiusi → [RI-VALUTA IL CHECKPOINT INTERO]          (accepted-risk /
        │                                                              fix manuale / rinvio)
   verde → [MODELLO GIT: commit + (gate di) merge su main]      MAI scarto silenzioso,
   rosso (una fix ne ha introdotto uno nuovo) → rientra nel loop  MAI verified  (L-COL-006)
```

Due cicli annidati, da non confondere (§6): il loop **per-finding** (riesegue *un* oracolo, porta *quel* finding a `verified`); la **ri-valutazione del checkpoint** (riesegue *tutti e quattro* i controlli, è ciò che apre il cancello del merge).

## 3. La macchina del singolo finding

Precondizione: un finding `triaged` (prioritizzato/spiegato da `08`) in una categoria su cui la skill propone fix — il set verificato-a-zero (`secret` + `rls` + `dead-code`, `L-COL-010`) sempre; le categorie detection-only **solo in REMEDIATE** (remediation piena, `L-COL-023`), con la promessa degradata di §9.

```
detected ─(08)→ triaged
                  │
                  ▼ PROPONI
        fix-proposed ──────────────── GATE UMANO (L-COL-005, L-COL-021)
                  │                        │ no → accepted-risk | rinvio
                  │ sì
                  ▼ APPLICA (commit isolato sul branch — additivo, reversibile, L-COL-024)
        fix-applied
                  │
                  ▼ RIESEGUI lo stesso oracolo (stesso rule_id) + RIESEGUI i test
        ┌─────────┴─────────┐
   pulito & verde      flagga ancora / test rotto
        │                   │
        ▼                   ▼
     verified         verification-failed
   (solo l'oracolo)        │
                           ▼ RETRY? (policy §4)
                  ┌────────┴─────────┐
            residui & budget ok    esauriti
                  │                   │
                  ▼ REVERT la patch   ▼ terminale → umano
                  └→ PROPONI (patch MATERIALMENTE diversa)
```

Vincoli sulla transizione:

- **`verified` lo decide solo l'oracolo.** È una proprietà del re-run, non una frase dell'LLM *(L-COL-002, L-COL-006)*. È l'unico stato comunicabile come "trovato e verificata la correzione di X" (`04` §10).
- **Revert prima di riprovare.** Una patch che fallisce la verifica viene **annullata sul branch** prima del tentativo successivo. Il branch torna allo stato pre-tentativo, così il prossimo re-run è onesto e non si accumula "sporco su sporco" (il difetto #2 di VISION §2). È legittimo perché il lavoro su branch è reversibile *(L-COL-024)*.
- **Patch materialmente diversa.** Il loop passa al tentativo successivo il **motivo** del fallimento (l'oracolo flagga ancora *cosa* / *quale* test si è rotto) come input, e **rifiuta una ri-sottomissione byte-identica** a una patch già fallita: ripeterla fallirebbe identica. Il gate umano resta il filtro sostanziale.

## 4. Policy di retry/scarto — `O-COL-006` chiusa

> **Decisione chiusa (Chat C) — `O-COL-006`.** Cap **per-finding di 2 retry** (3 tentativi totali: proposta iniziale + 2). Ogni retry una patch **materialmente diversa**. **Budget globale** token/tempo per sessione, configurabile in `references/`. Budget esaurito o tentativi esauriti → stato terminale presentato all'umano, **mai** scarto silenzioso, **mai** `verified`. **Nessun nuovo lock**: è meccanismo di `L-COL-003/005/006` (stessa restrizione di Chat B — `validate_blueprint` resta meccanismo di `L-COL-019`).

**Cap per-finding.** 2 retry. Una fix AI che non regge entro 2-3 tentativi di solito richiede una decisione umana; insistere brucia budget e alza l'entropia. Conservativo e a basso costo.

**Budget globale.** Un tetto di **tempo di parete** e di **token** per sessione di verifica (per-checkpoint in BUILD, per-sessione in REMEDIATE). È **configurabile** in `references/oracles/thresholds.md` (sezione loop-budget) e referenziato da `SESSION-STATE`. Vale il primo cap che scatta: per-finding `N` **o** budget globale. Default ragionevoli vivono nel reference; il **numero esatto del parity gate** (VISION §10, punto 4) è **calibrato e pinnato in `10-EVALUATION`** (Chat E), perché dipende dalla reference app che ancora non esiste. La policy — *che esiste un budget e come si fa rispettare* — è chiusa qui; la *taratura numerica* è dell'eval.

**Stato terminale.** A budget/tentativi esauriti il finding resta `verification-failed` **terminale** e viene presentato all'umano con le opzioni di `04` §5: `accepted-risk` (registrato, mai scartato in silenzio), fix manuale fuori dal loop, o rinvio. La skill **non** procede oltre come se fosse risolto e **non** lo conta nel verde.

**"Scarta-e-segnala".** *Scartare* = smettere di tentare l'auto-fix e **riportare**, non cancellare il finding: resta nel report come problema aperto. Coerente con "nessun falso via libera".

## 5. Dove sta il gate umano

Il gate umano è obbligatorio sull'**applicazione di ogni fix** *(L-COL-005, L-COL-021)* — incluso ogni retry. La macchina propone; l'umano approva ciò che tocca il branch.

- **Trasparenza del budget al gate.** Al primo gate di un finding la skill dichiara il budget ("proporrò fino a 3 fix per `F-007`; ognuna richiede il tuo ok"), così l'umano sa quanti round attendersi. Il gate per-tentativo resta.
- **Dead-code mai automatico.** Le rimozioni di codice morto **non** si applicano mai in autonomia *(L-COL-021)*: falsi positivi su import dinamici e magia del framework. La skill propone la rimozione, l'umano approva, e solo allora la patch entra nel loop.
- **Ordine e serializzazione.** I finding si affrontano in ordine di priorità (`08`); le fix che toccano lo **stesso file/regione** si serializzano per evitare conflitti. Per efficienza il gate può essere presentato come **revisione a lotti** di un set prioritizzato; l'applicazione resta una patch alla volta, ciascuna gated.

## 6. Verifica per-finding vs ri-valutazione del checkpoint

Distinzione operativa che tiene insieme il loop e il cancello del merge.

- **Verifica per-finding** — riesegue **lo stesso oracolo** che ha prodotto il finding (stesso `rule_id`) e i test pertinenti. Esito: quel finding → `verified` (o `verification-failed`). È ciò che il §3 descrive.
- **Ri-valutazione del checkpoint** — quando tutti i finding fixabili del round sono chiusi, la skill riesegue **i quattro controlli interi** (`01` §4) con il **baseline-delta** aggiornato (`03` §8, `04` §6). Serve a cogliere il caso in cui una fix **chiude `F-007` ma introduce `F-012` nuovo**: l'oracolo per-finding direbbe "`F-007` sparito", ma il checkpoint resta **rosso** finché `F-012` non è gestito. Solo il checkpoint interamente verde apre il cancello del merge.

Regola dura ereditata da `01` §4.2: **finché il checkpoint non è verde, non si committa al di là del branch e non si tocca `main`.**

I controlli 3 e 4 non producono "finding da correggere" come 1 e 2: un rosso lì è un **test fallito**. Il loop li serve nello stesso spirito — l'"oracolo" è il **test runner** (`03` §2), il "re-run" è rieseguire i test, e la fix è modificare il codice finché i test tornano verdi (in BUILD il test di accettazione che fallisce **è** la specifica da soddisfare, `11` §3).

## 7. Il caso del segreto-in-history

Asimmetria critica già fissata in `03` §5.2 e `04` §5, qui resa procedura del loop.

Un segreto trovato **nella history** git **non** si verifica-a-zero togliendo il valore dal file corrente: resta nel log. La fix corretta è **rotazione della chiave** + (eventuale) **riscrittura di storia**. La riscrittura di storia è **distruttiva** → mai autonoma, sempre gate umano *(L-COL-024)*.

Sequenza nel loop (`04` §5):

```
secret(history) → fix-applied (rotazione chiave) → mitigated-residual
                                                         │
                              [opz. history rewrite — GATE UMANO esplicito, distruttivo]
                                                         │
                              riesegui gitleaks sulla history → pulito → verified
```

Finché la history non è riscritta, lo stato resta **`mitigated-residual`** (rotazione fatta, residuo nei commit), **mai** `verified`. Il report lo mostra per quello che è: una mitigazione, non una verifica *(L-COL-006)*. La rotazione effettiva della chiave è un'azione **fuori dal codice** (console del provider): la skill la **prescrive e ne traccia l'avvenuta dichiarazione**, non la esegue da sé.

## 8. Meccanismo git di applicazione

Operazionalizza il modello a strati di `01` §5 *(L-COL-024, L-COL-025)*.

### 8.1 Branch di lavoro — autonomo

- Convenzione di branch: `trueline/<modalità>/<macrotask-o-lotto>` (es. `trueline/build/prenotazioni`, `trueline/remediate/2026-06-13`). Creazione, stage, commit, push del **branch** sono autonomi: additivo, isolato, reversibile.
- **Commit atomici.** In BUILD, un commit al confine di ogni macrotask verde, messaggio che cita gli ID dei task e l'esito del checkpoint (storia revertabile per task). In REMEDIATE, un commit per fix, che cita il `fingerprint` del finding e lo stato raggiunto (`verified`/`mitigated-residual`).

### 8.2 Merge su `main` — gated dall'oracolo

A pubblicare su `main` è il **verdetto deterministico** del checkpoint verde, mai l'LLM. Asimmetria per modalità *(L-COL-024)*:

- **BUILD** → su checkpoint verde, **merge su `main` autonomo** — salvo il gate di deploy (§8.3).
- **REMEDIATE** → branch autonomo, ma il merge su `main` resta un **"vai" umano**: pubblicare una bonifica la cui correttezza non è ancorata a un intento non è cosa che la skill fa da sé.

### 8.3 Gate di deploy *(L-COL-025)* — meccanismo congelato

> **Decisione congelata (Chat C) — meccanismo di `L-COL-025`: mix fail-safe.** Auto-detect dei segnali → esito registrato in `SESSION-STATE` → confermato **una volta** con l'utente; in caso di ambiguità o mancata conferma si **assume coupled** (merge human-gated). **Nessun nuovo lock**: meccanismo di `L-COL-025`.

Prima di **qualunque** merge autonomo su `main` (quindi rilevante solo per il caso BUILD-verde), `scripts/git/detect_deploy_coupling.*` valuta i segnali di `01` §5.3:

- workflow GitHub Actions che deploya su push a `main`;
- auto-deploy Cloudflare Pages / Workers (integrazione Git / `wrangler`);
- `vercel.json` / `netlify.toml` con deploy automatico;
- hook/branch di deploy Supabase.

**Mix fail-safe**, in concreto:

1. **Auto-detect** scansiona i segnali sopra.
2. L'esito è scritto in `SESSION-STATE` come `main_deploy_coupled: true | false | unknown` e **confermato una volta** con l'utente — in BOOTSTRAP, oppure alla prima volta in cui un merge su `main` sarebbe autonomo. Questo dà all'utente la possibilità di **correggere** il detect (es. "il mio CI è in un repo separato: è coupled").
3. **Fail-safe.** Se l'esito è `unknown`/ambiguo e non confermato, la skill **tratta `main` come coupled** → il merge resta human-gated. L'autonomia non assume **mai** in silenzio "non-coupled".
4. **Sticky e ri-valutabile.** La dichiarazione vive in `SESSION-STATE` (niente ri-prompt a ogni checkpoint), ma il detect può rigirare e segnalare un **delta** se la config cambia (nuovo workflow, nuova integrazione).

L'asimmetria di rischio che giustifica il fail-safe: una coupling **mancata** è catastrofica (merge autonomo su `main` coupled = **deploy autonomo in produzione** — caso concreto: Gestionale Officina su Supabase + Cloudflare, live); una coupling **spuria** è solo un gate umano in più. In dubbio, si gata.

Se `main` è coupled, l'alternativa al gate è **ridirigere l'autonomia su un branch `staging`**, lasciando il salto `staging → main`/prod all'umano.

### 8.4 Operazioni distruttive e preflight push

- **Distruttive mai autonome** *(L-COL-024)*: `push --force`, `reset --hard` su branch pushato, rebase di storia pubblicata, delete branch, history rewrite (§7) → sempre gate umano esplicito.
- **Preflight push** *(O-COL-004, parallelo agli oracoli)*: il push richiede remote + auth già configurati; la skill non li inventa. Remote/auth assenti → **committa in locale** sul branch e lo **dichiara**, senza fallire in silenzio. In BOOTSTRAP chiede l'URL del remote **una volta** e lo registra in `SESSION-STATE`.

## 9. Asimmetria BUILD vs REMEDIATE nel loop

La macchina è identica; cambia ciò che `verified` **accompagna** *(asimmetria onesta, VISION §6)*:

- **BUILD** — il controllo 4 (conformità-logica) usa i **test di accettazione** del task atomico (`11` §3). `verified` viaggia con **conformità alla specifica**: "fa ciò che il task diceva". Promessa forte.
- **REMEDIATE** — manca un intento: il controllo 4 **degrada a invarianza** via characterization test (`06`). `verified` per-finding significa "l'oracolo non flagga più questo finding **e** il comportamento è invariato" — **non** "è corretto rispetto a un intento" (che non è mai stato scritto). La promessa è **invarianza comportamentale**, non correttezza.

In più, in REMEDIATE la skill può portare a `verified` **per-finding** anche categorie detection-only (remediation piena, `L-COL-023`): oracolo riesieguito pulito + test invarianti. Ma questo **non** eleva la categoria a "verificata-a-zero" a livello d'app (`L-COL-010`): la *coverage declaration* (`04` §10) resta onesta e la skill non dichiara mai "X è sicuro" per la categoria.

## 10. Cosa alimenta a valle / parity gate

- Il loop è ciò che il **gate di verifica** (VISION §10, punti 1–4) esercita sulla reference app: ogni problema seminato deve raggiungere `verified` (set in scope) restando entro il budget di `O-COL-006`, e le categorie non coperte restano dichiarate.
- Il loop è anche il motore del **checkpoint rosso** nel **gate di build** (punti 5–7): costruito un macrotask, se un controllo è rosso si entra qui finché il checkpoint non è verde, poi parte il modello git con il gate di deploy.

## 11. Eredità ai moduli a valle

- **`06-CHARACTERIZATION-TESTS`** — fornisce l'oracolo dei controlli 3–4 in REMEDIATE (baseline comportamentale) che questo loop riesegue; definisce come una fix che *cambia di proposito* un comportamento aggiorna le asserzioni impattate senza che il controllo 3 lo legga come regressione.
- **`08-TRIAGE-EXPLANATION`** — prioritizza i finding che entrano nel loop, scrive `notes`/`triaged`, e gestisce i falsi positivi in modo conservativo prima della proposta di fix.
- **`09-PACKAGING-DISTRIBUTION`** — confeziona `scripts/git/detect_deploy_coupling.*` e gli esecutori del loop nel `.skill`; gestisce la presenza degli oracoli che il loop riesegue.
- **`10-EVALUATION`** — **calibra e pinna il budget numerico** di `O-COL-006` per il gate di verifica; asserisce gli stati `verified` / `mitigated-residual` sulla reference app.
