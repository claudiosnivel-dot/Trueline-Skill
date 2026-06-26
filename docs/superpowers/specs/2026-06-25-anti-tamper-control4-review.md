# Review adversariale — spec AT-1 (anti-tamper del controllo 4)

| | |
|---|---|
| **Data** | 25 giugno 2026 |
| **Oggetto** | `docs/superpowers/specs/2026-06-25-anti-tamper-control4-design.md` |
| **Metodo** | Dynamic Workflow `at-1-spec-review` — 5 critici Opus k=5, lenti distinte |
| **Esito** | **11 blocking · 17 major · 11 minor.** Il design NON regge come scritto: 1 root-cause bloccante (5/5 critici, con citazioni di codice) + cluster di major. |

## Root-cause bloccante (5/5 critici, verificato dall'orchestratore)

**Il controllo 4 è BLUEPRINT-CIECO.** `trueline/scripts/checkpoint/checkpoint.mjs::control4Conformance(referenceApp, { mode, characterization, finding })` (riga 423) **non riceve né legge** blueprint / `acceptance_criteria` / `target_tests` / `covers`. In BUILD esegue `characterizationInvariance` **oppure** `detectTestRunner → npm test` (intera suite). `run_checkpoint.mjs` non ha argomento blueprint; `run_loop` chiama `runCheckpoint(dir, {mode, baseline})` senza blueprint. **`grep` su `scripts/checkpoint` per blueprint/target_tests/covers/acceptance_criteria = ZERO match** (verificato). L'unico consumatore di `covers` è `validate_blueprint` a **plan-time**. I `target_tests[].file` non esistono nemmeno su disco nei fixture (il controllo 4 va verde via `--characterize`).

**Conseguenza:** la premessa portante dello spec (§1/§5.3 — "il controllo 4 poggia sul target_test, anti-tamper ne gata la provenienza") descrive un flusso che il codice **non ha**. Il "test-gate = test d'accettazione dell'AC" è **nominale** (`build.md` §3 prosa), non implementato. AT-1 come scoped è un bolt-on a un oracolo che **non esegue** l'artefatto che vuole proteggere.

## Major (consenso, indipendenti dalla direzione)

- **Observable-match → ADVISORY in v1** (4 critici): euristica fragile — false-FAIL su test fedeli con costanti (`Status.Unauthorized` vs `401`), false-PASS su letterali generici (`true`/`200`/cross-match nella finestra); reintroduce il semantic-match che §2 esclude. v1 gate = **sola presenza del tag**.
- **De-overclaim §1/§4/`L-COL-032`** (3 critici): il floor gata la **PRESENZA del tag** (coverage-fantasma PURA), **non** la fedeltà dell'asserzione. `// covers: AC-x` sopra `expect(true).toBe(true)` **passa** il floor. Riformulare onestamente (`L-COL-006`); non usare "tracciare" come se fosse gated end-to-end.
- **Token-based vs "dentro un commento"** (2 critici): distinguere commento da stringa richiede lexing → o "token ovunque nel file" (onesto, più debole) o whitelist di prefissi-commento **incl. `--` (SQL/pgTAP)** per la killer-category RLS. Aggiungere sotto-test di gameabilità (tag-in-stringa).
- **Floor non richiede adiacenza a un'asserzione** (2 critici): tag in testa al file senza `expect` passa. O whitelist di marcatori d'asserzione vicini, o dichiararlo limite noto advisory.
- **Semantica `covers` per-AC GLOBALE** (3 critici): AC tracciato se taggato in **≥1** dei file che lo coprono (combacia con `validate_blueprint` AC_COVERAGE); gestire `covers` scalare-o-lista; tag spurio/orfano → ignorato al floor.
- **Opt-in = FLAG ESPLICITO, mai auto-detect su disco** (1 critico): protegge la BIT-invarianza `m5` 56/56.
- **Fixture NUOVE `eval/anti-tamper/*` con file di test reali** (3 critici): i fixture BD-1 non hanno file di test → non riusabili; provisioning inner-`.git` d'orchestratore.
- **Sotto-test di INTEGRAZIONE** (3 critici): provare che il controllo 4 **SPEDITO** va RED (`run_checkpoint --blueprint` su fixture tampered → `controls[3].green===false`), non solo il checker standalone (altrimenti è eval-only disconnesso, come BD-1).
- **Decomposizione** (2 critici): se serve prima cablare control-4↔target_test, sono **due** deliverable.

## Minor
Path errato (`scripts/loop/checkpoint.mjs` → `scripts/checkpoint/checkpoint.mjs`, funzione `control4Conformance`); finestra observable a 12 righe arbitraria (cross-match); regex tag da ancorare all'id esatto; ordine di scansione stabile (sort, k=2); commenti `/* */` oltre `//`/`#`.

## Risoluzione (fork portato all'utente)

Il nucleo (materializzare il link AC→location come tag verificabile, floor deterministico, coglie la coverage-fantasma pura) è **solido e onesto** se de-overclaimato. Ma la premessa va riallineata al codice reale. Tre direzioni:
1. **Rifondare** — il deliverable diventa "far sì che il controllo 4 valuti davvero i target_test per-AC del task contro gli AC" (chiude il gap nominale-vs-reale del test-gate = il vero moat), col trace-check dentro. Più grande.
2. **Pre-requisito prima** — "control-4-esegue-i-target_test" come deliverable a sé, poi anti-tamper come follow-up.
3. **Bolt-on indipendente onesto** — trace-gate separato (flag esplicito, fixture nuove, niente claim "validità del controllo 4", observable advisory). Più piccolo, ma gata un link a un oracolo che il controllo 4 non esegue → valore reale limitato finché non si fa #1/#2.
