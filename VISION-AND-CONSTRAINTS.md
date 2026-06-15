# VISION-AND-CONSTRAINTS — Trueline

| | |
|---|---|
| **Progetto** | Trueline (`COL`) — nome bloccato in `O-COL-001` (ex codename *Collaudo*) |
| **Tag decisioni** | `COL` |
| **Tipo** | Agent Skill (standard SKILL.md) — *non* SaaS, *non* CLI standalone, *non* MCP server |
| **Versione** | v0.2 — reframe lifecycle (Chat A) |
| **Data** | 13 giugno 2026 |
| **Stato** | Suite chiusa (v1.0, Chat E). Nome bloccato: **Trueline**. Rename Collaudo→Trueline applicato a tutta la suite. |

---

## 1. Cos'è

Trueline è una Agent Skill che dà a un qualunque agente di coding (Claude Code come riferimento, ma anche Codex, Cursor, Gemini CLI e altri agenti compatibili con lo standard SKILL.md) la disciplina **blueprint-first di build-e-verifica** su un progetto. La skill non si limita a giudicare il codice: governa il ciclo di vita — **genera il blueprint, costruisce un macrotask alla volta, e verifica al confine di ogni macrotask** con oracoli deterministici prima di proseguire.

Il principio epistemico resta quello di sessione 1: l'agente non giudica la sicurezza o la correttezza col proprio intuito. Lancia oracoli deterministici, ragiona sui fatti che producono, propone correzioni, e applica una correzione **solo dopo averla ri-verificata** con lo stesso oracolo e con una rete di test. La novità di v0.2 è che questa verifica non è più *il prodotto*: è una **fase** — il checkpoint — incastonata in un ciclo di build più ampio. *(L-COL-015)*

Non è un prodotto costruito *attorno* a una disciplina: è quella disciplina — il metodo blueprint-first dell'utente più il gate di verifica oracle-first — resa artefatto riusabile che l'agente carica e segue.

## 2. Il problema

Un LLM è un predittore del token successivo addestrato sulla *mediana* del codice pubblico, e la pulizia e la sicurezza non vivono nella mediana — vivono nella coda della distribuzione. Da qui i tre difetti documentati del codice generato da AI:

- **Buchi di sicurezza banali**: l'esempio comune di una funzione (login, endpoint, query) omette la sicurezza, perché l'esempio comune non parlava di sicurezza. Segreti hardcoded, RLS mancante, SQL concatenato, confronti non timing-safe, authz assente su route mutanti.
- **Sporco su sporco**: chiesta una fix, l'agente fa la modifica locale minima che fa sparire l'errore senza modello dell'intorno, e l'entropia cresce monotòna a ogni iterazione. A questo si aggiunge il **codice morto** che si accumula: funzioni, file ed export che nessuno referenzia più ma che restano a sporcare il repo.
- **Plausibile ma sbagliato**: l'output è lucido — idiomi corretti, buoni nomi — e questa lucidatura supera la correttezza effettiva, abbassando la vigilanza di chi revisiona.

A monte di tutto c'è un problema di metodo: senza un piano esplicito con criteri di "fatto", l'agente costruisce a deriva, e la conformità del risultato all'intento non è verificabile da nessuno se non dall'LLM stesso. A valle c'è il problema degli strumenti di verifica esistenti: quasi tutti usano **l'LLM come giudice** del codice. È lo stesso prior che ha prodotto il bug a doverlo trovare. Per questo sono "rumorosi" e per questo non possono essere la fonte di verità.

## 3. La tesi

Due affermazioni, una per ciascuna metà della skill.

**Sulla verifica.** La fonte di verità per qualunque affermazione di sicurezza o correttezza è un **oracolo deterministico non-LLM** (SAST, scanner di segreti, controllo dipendenze, dead-code detection, checker di policy). Il ruolo dell'LLM è ristretto a tre cose: tradurre i fatti in linguaggio comprensibile, prioritizzarli, e proporre patch. L'LLM **non emette mai un verdetto**. Il passaggio che è il vero valore non è la detection (la fanno tutti) ma il **loop di verifica della fix**: la patch viene applicata, lo *stesso* oracolo che ha trovato il bug viene rieseguito, e la fix conta come "verificata" solo se l'oracolo non trova più il problema **e** nessun test si rompe. L'LLM non dice mai "ho sistemato"; lo dice l'oracolo.

**Sul build.** La conformità del codice all'intento non è oracolabile da uno strumento generico — ma diventa verificabile se l'intento è stato scritto prima, in modo atomico e con criteri di accettazione. Per questo **ogni task atomico del blueprint deve portare definition-of-done, criteri di accettazione e test target** *(L-COL-019)*: è l'aggancio che impedisce al controllo di conformità-logica di ricadere nell'LLM-che-giudica-sé-stesso. La qualità del blueprint, a sua volta, non è oracolabile: si rende affidabile con template e checklist di self-check, non con "vibes".

Posizionamento: Trueline è il **kernel**. Una eventuale SaaS futura sarà *lo stesso kernel* avvolto in un runtime gestito, una UI e il billing, per un pubblico che il kernel non può eseguirlo da sé (vedi §10).

## 4. Per chi è — e per chi non è

**Per chi è**: builder che girano un agente sul *proprio* repo nel *proprio* ambiente — la fascia Claude Code / Cursor / Codex / Gemini CLI. Gente semi-tecnica o tecnica che ha un terminale e un agente, e che vuole sia un metodo di build disciplinato sia una rete di sicurezza che funzioni con logica e non a memoria.

**Per chi NON è (in v1)**: il vibecoder puramente non tecnico che costruisce su Lovable/Bolt e non apre mai un terminale. Una Skill richiede un runtime con un agente: chi non ce l'ha non può installarla. Quella fascia — la più grande e la più disperata — è il bersaglio di un'eventuale SaaS con UI web, non di questa Skill. È un confine deliberato, non una lacuna.

## 5. Le tre modalità

La skill è trimodale; il **motore di verifica è identico** nelle tre, ma cambiano i punti d'ingresso e ciò che la skill costruisce. *(L-COL-016)*

- **BOOTSTRAP** — repo vuoto o quasi. Genera il blueprint (task atomici con DoD + criteri + test), passa la checklist di self-check sul blueprint generato, ed emette i 3 prompt di lifecycle parametrizzati. Output: un piano. Nessun codice.
- **BUILD** — blueprint + `SESSION-STATE` presenti. Costruisce il macrotask corrente, poi esegue il checkpoint al confine; su verde, committa e procede.
- **REMEDIATE** — codice esistente sostanziale senza blueprint (brownfield). Inventaria, costruisce i characterization test come baseline, lancia gli oracoli, propone fix human-gated, e le verifica col loop.

Il dispatch tra modalità avviene con risoluzione-intento in testa al corpo `SKILL.md`, con **conferma esplicita dell'utente nei casi ambigui**. *(L-COL-017)*

## 6. L'asimmetria onesta

Il motore di verifica è identico, ma le **promesse** no — e questo va detto in chiaro all'utente, mai mascherato:

- **Greenfield (BUILD)** → la promessa è **conformità alla specifica**: "fa ciò che il task diceva di fare, niente codice morto, niente vulnerabilità note, niente regressioni". Il controllo di conformità-logica si ancora ai criteri di accettazione del task *(L-COL-019)*.
- **Brownfield (REMEDIATE)** → senza una specifica d'intento, il controllo di conformità-logica **degrada** da "è giusto" a "fa ancora quello che faceva prima". Si verifica solo l'**invarianza del comportamento** via characterization test, non la correttezza rispetto a un intento che non è mai stato scritto.

Questo è il residuo irriducibile lato build, gemello del residuo lato threat model (§7 non-goals): la macchina è ottima a *eseguire* un piano o un threat model espliciti; è inaffidabile a *deciderli*.

## 7. Principi fondamentali

Questi principi sono vincolanti e si traducono nelle locked decision in `00-INDEX`.

- **Oracle-as-judge, mai LLM-as-judge.** Ogni claim traccia a un oracolo deterministico. *(L-COL-002)*
- **Il loop di verifica della fix è obbligatorio.** È la fase di verifica del checkpoint: nessuna fix non verificata viene mai presentata come fatta. *(L-COL-003, L-COL-018)*
- **Ogni task atomico porta DoD + criteri di accettazione + test target.** È l'aggancio fra le due metà della skill. *(L-COL-019)*
- **I test di caratterizzazione sono prerequisito di ogni fix su codice non testato** e stanno sul percorso critico del v1 (REMEDIATE). *(L-COL-004, L-COL-023)*
- **Human-in-the-loop obbligatorio.** La Skill propone, non applica da sola sulle correzioni. Nessuna azione distruttiva o irreversibile senza approvazione esplicita. *(L-COL-005, L-COL-021)*
- **Git a strati, con autorità all'oracolo.** Autonomia piena sul branch di lavoro; il merge su `main` è gated dal checkpoint verde; le operazioni distruttive non sono mai autonome. *(L-COL-024)*
- **Mai pubblicare un deploy non supervisionato.** Se `main` è accoppiato a un deploy automatico, il merge su `main` resta human-gated anche col checkpoint verde. *(L-COL-025)*
- **Nessun "via libera" falso.** Il framing è sempre "trovato e verificata la correzione di X" / "questi controlli sono passati", mai "la tua app è sicura". L'assenza di finding non è prova di sicurezza. *(L-COL-006)*
- **Standard nominati, non aggettivi.** La libreria, l'algoritmo, le regole, i pattern *vietati* sono espliciti in un reference; il threat model è un input che la Skill esegue, non qualcosa che l'LLM inventa a ogni run. *(L-COL-012)*
- **Privacy per architettura.** Gira interamente nell'ambiente dell'utente; il codice non viene mai trasmesso a terzi. *(L-COL-013)*
- **Determinismo e parsimonia di token.** Gli oracoli sono script allegati che girano deterministici e il cui codice resta fuori dal contesto: nel contesto entrano solo i loro output. *(L-COL-007)*

## 8. Non-goals (esclusioni esplicite)

- **Non è un servizio gestito.** Niente dashboard, niente storico dei finding nel tempo, niente monitoraggio o alert continui, niente billing, niente feature di team. (Tutto questo è l'eventuale wrapper SaaS, non il kernel.)
- **Non è per l'utente senza terminale.** Vedi §4.
- **Non sostituisce il giudizio umano** sulle decisioni di design e sul threat model, né sulla *correttezza d'intento* in brownfield (§6). La macchina esegue piani e threat model espliciti; non li decide.
- **Nessuno strumento offensivo o gray-hat.** Solo difesa e correzione.
- **Niente auto-apply delle correzioni.** La Skill non modifica il codice di una fix senza il gate umano; le cancellazioni di dead-code in particolare non sono **mai** automatiche (falsi positivi su import dinamici / magia del framework). *(L-COL-021)*
- **Niente DAST in v1.** La verifica è source-side; il probing runtime su URL live è rinviato a v2. *(O-COL-007 → v2)*
- **Non inventa verdetti.** Se un oracolo non copre una categoria, la Skill lo dichiara come non coperto; non riempie il vuoto con una stima dell'LLM.

## 9. Vincoli

- **Zero/basso costo ricorrente.** Nessuna dipendenza da scanner a pagamento in v1. *(L-COL-008)*
- **Solo oracoli OSS in v1**: Semgrep (+ ruleset curato sui pattern AI), gitleaks, osv-scanner, RLS checker custom, più dead-code detection (knip / ts-prune / depcheck). Tutti OSS, tutti JS/TS. *(L-COL-008, L-COL-020)*
- **Cross-tool per costruzione.** Autorata allo standard SKILL.md così da girare su Claude Code (riferimento), Codex, Cursor, Gemini CLI e altri agenti compatibili. *(L-COL-009)*
- **SKILL.md snello e trimodale.** Corpo sotto le ~500 righe che instrada per modalità; reference e ruleset in file allegati caricati on demand, e solo per la modalità attiva (progressive disclosure). *(L-COL-014)*
- **Presenza degli oracoli via preflight.** Uno script di preflight rileva i tool mancanti e propone l'install (`npm i -g` / `npx`); non li assume presenti né vendorizza binari. *(O-COL-004 → preflight)*
- **Distribuzione controllata.** Repo GitHub + install manuale in v1; nessun marketplace (una skill di security esegue script — l'install controllabile è parte della fiducia). *(O-COL-002 → manuale)*
- **Gate umano sempre presente** nel percorso di applicazione di qualunque patch, e sul merge a `main` quando `main` deploya. *(L-COL-005, L-COL-025)*
- **Nessuna telemetria** in v1, coerente con la postura privacy-first. *(O-COL-009 → nessuna)*

## 10. Definizione di "fatto" per v1 (parity gate)

Sul modello del gate di parità che usiamo per gli altri progetti, v1 è "fatto" quando la skill supera due gate distinti, uno per la verifica e uno per il build.

**Gate di verifica** — su una **reference app deliberatamente vulnerabile** (seminata con i pattern di fallimento AI documentati: chiave esposta, RLS mancante, SQL concatenato, authz assente, più codice morto seminato), in modalità REMEDIATE Trueline:

1. **Rileva** ciascun problema seminato tramite un oracolo (non tramite ispezione dell'LLM).
2. **Produce una fix verificata** per le categorie in scope (segreti + RLS + rimozione dead-code): la fix azzera il finding all'oracolo riesieguito **e** non rompe alcun characterization test.
3. **Non riporta mai un falso "via libera"** sulle categorie non coperte: le dichiara esplicitamente come non verificate.
4. **Resta entro un budget** di token e di tempo definito: la **policy** del budget è chiusa (`O-COL-006`, `05` §4); il **valore numerico** si tara e si pinna sulla reference app in `10` §6.

**Gate di build** — su un piccolo blueprint seminato (BOOTSTRAP → BUILD), Trueline:

5. **Genera un blueprint** i cui task atomici portano tutti DoD + criteri di accettazione + test target, e che supera la checklist di self-check.
6. **Costruisce il macrotask** e supera il checkpoint a 4 controlli (dead-code · sicurezza · regressioni · conformità-logica) prima di committare.
7. **Rispetta il modello git a strati**: autonomia sul branch, gate su `main`, nessuna operazione distruttiva autonoma, deploy non supervisionato bloccato.

La reference app, il blueprint seminato e le due suite vivono in `10-EVALUATION.md`.

## 11. Scope v1

- **Un solo ecosistema**: app JS/TS web su Supabase — l'epicentro documentato, dove la misconfigurazione RLS è il killer numero uno.
- **Tre modalità** complete: BOOTSTRAP, BUILD, REMEDIATE. *(L-COL-016)*
- **Loop di fix verificata** limitato a **segreti + RLS + rimozione dead-code** (le categorie a più alto impatto e più facilmente verificabili in modo deterministico). *(L-COL-010, L-COL-020)*
- **Remediation brownfield piena** in REMEDIATE: la skill propone fix human-gated anche oltre il set verificato-a-zero, con i characterization test a garantire l'invarianza comportamentale. "Remediation piena" ≠ "fix verificata per tutto": vedi l'asimmetria in §6. *(L-COL-023)*
- **Detection-only** (nessun auto-fix) per le altre categorie OWASP non coperte dal loop: vengono trovate, spiegate, prioritizzate, ma non corrette automaticamente.
- Ecosistema #2, DAST e categorie aggiuntive di auto-fix: rinviati a v2 (vedi `O-COL-005`, `O-COL-007`).

## 12. Posizionamento rispetto a un'eventuale SaaS

| | Trueline (Skill / kernel) | Eventuale SaaS (wrapper) |
|---|---|---|
| **Pubblico** | Builder con un agente | Fondatori non tecnici, senza terminale |
| **Esecuzione** | Nell'ambiente dell'utente, sul suo codice | Runtime gestito lato server |
| **Sandbox codice altrui** | Non serve (è il suo codice) | Problema serio (esegue codice di sconosciuti) |
| **Privacy** | Per architettura (il codice non esce) | Requisito di fiducia da gestire |
| **Infrastruttura** | Praticamente nulla (una cartella) | Control plane + runner + billing |
| **Motore** | È il kernel (build + verifica) | È lo *stesso* kernel, avvolto |

Sequenza: si costruisce e si dimostra il kernel come Skill (lo uso io su AppuntamentiChirsan in REMEDIATE e come disciplina di build+gate per Gestionale Officina; lo adottano gli utenti tecnici, cross-tool). La SaaS, semmai, riusa il kernel — non lo riscrive.
