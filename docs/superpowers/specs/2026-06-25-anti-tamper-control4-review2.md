# Review adversariale #2 (focalizzata) — spec AT-1 RIFONDATO

| | |
|---|---|
| **Data** | 25 giugno 2026 |
| **Oggetto** | `2026-06-25-anti-tamper-control4-design.md` (v2 rifondata) |
| **Metodo** | Dynamic Workflow `at-1-spec-review-2` — 3 critici Opus k=3 sul NUOVO wiring vs codice reale |
| **Esito** | **7 blocking · 12 major · 7 minor.** Direzione **confermata solida** (i blocking/major della review #1 sono **davvero chiusi**); restano gap di **fattibilità/onestà** introdotti dalla rifondazione — tutti design-level, fixati inline. |

## Confermato chiuso dalla review #1 (non ripetuto)
observable-match→advisory ✓ · de-overclaim presenza-non-fedeltà ✓ · opt-in flag esplicito anti auto-detect ✓ · per-AC globale + covers scalar/lista + tag spurio ✓ · prefissi-commento incl. `--` ✓ · fixture nuove + sotto-test su `run_checkpoint` spedito ✓ · decomposizione A/B ✓. Il cambio firma di `runCheckpoint`/`control4` per i chiamanti **REGGE** (additivo, BIT-invariante).

## Blocking/major NUOVI (chiusi nella revisione del design)
1. **Loader non riusabile** — `validate_blueprint` non esporta nulla (script top-level + `process.exit`). Il checker **REPLICA** il loader (come `ac_observability_check`); il refactor in modulo condiviso è follow-up (tocca un oracolo gated). §6 resta onesto.
2. **Manifest non arriva a control4** — `runCheckpoint` lo passa solo a control2. Firma control4 = `{…, blueprintDir, manifest}`; additivo (ignora quando `blueprintDir==null`).
3. **Precedenza control4** — `if(charz)` è il primo ramo (charz auto-rilevata da disco). Fissato l'ordine: `if (mode==='build' && blueprintDir) → AC-acceptance (preempt characterization); else if (charz) → invarianza; else legacy`.
4. **`--blueprint` non cablato** — `run_loop` r.353 e `run_checkpoint` parseArgs NON lo passano/hanno. È **scope da aggiungere** (5 edit enumerati), non "già inoltrato". L'harness driva `run_checkpoint --in-place <copia-fixture> --blueprint`; + sotto-test che `run_loop --blueprint` propaga (altrimenti BUILD-path scollegato = difetto BD-1 eval-only).
5. **Esecuzione NON coglie il vacuo** — `node --test` su file senza test/asserzioni esce 0. "Taggato-ma-vacuo" passa floor **e** esecuzione → verde ingannevole. Onestà: l'esecuzione coglie solo il file **ROTTO** (exit≠0). Floor anti-vacuo deterministico aggiunto: il runner deve riportare **≥1 test eseguito** (dove parseabile); il caso `assert.ok(true)` resta advisory/limite noto in `L-COL-032`/§10.
6. **`run_file` runner-dipendente** — jest tratta `{file}` come regex; vitest/pytest falliscono sul file-vuoto. v1 vincolato a **`node --test {file}`** (zero-install, built-in), spawnSync **array-argv** (no shell), guard esplicito `!run_file → legacy`.
7. **Nessun runner reale nell'eval** — canonica + fixture BD-1 senza `scripts.test`/runner/file-di-test. v1 usa `node --test` su **fixture NUOVE auto-contenute** con `*.test.mjs` reali (nessun npm install); provisioning traccia `tests/`.
8. **Dominio scope×copertura** — AC valutato sse ≥1 file coprente è in-scope; tracciato sse ≥1 file coprente **in-scope** ha il tag; AC con tutti i file copranti mancanti → saltato.
9. **Semantica commento** — regola precisa: una riga il cui primo token non-spazio è `//`/`#`/`--` (o dentro `/* */`) che contiene `covers:<id>`; commento di coda incluso, stringa esclusa. §10 allineato (tag-in-stringa **escluso**, non più "limite noto").
10. **§7 incompleto** — aggiunti sotto-test: covers-scalare, AC-multi-file, tag-spurio, tag-in-stringa, tagged-empty-exits-0 (asserisce il buco onestamente), copertura-mista; sotto-test flag-not-disk **riformulato** sul fixture faithful (con/senza-flag DEVE flippare).

## Minor
rif. `§5.3bis`→`§5.2bis`; run_file error-di-misura vs rosso (riusa `measureAttempts`); golden-assert BIT-invarianza del default; PATH+GO_BIN allo spawn.

**Verdetto:** non c'era un terzo difetto di premessa; tutti i punti sono edit di precisione del design. Applicati inline → spec implementation-ready.
