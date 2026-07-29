# Fixture del keystone `scan_scope_check`

Materiale di gate di `eval/harness/scan_scope_check.mjs` (PLAN
`docs/superpowers/plans/2026-07-28-scan-scope-tre-leve.md` §4).

## `seed/` e' tracciato, `project/` e' derivato

Questa fixture ha bisogno, **come materiale di gate**, esattamente dei path che ogni repo
mette nel proprio `.gitignore`: `.env`, `.next/`, `.trueline/`, piu' un `.gitignore`
annidato. Se stessero sul disco col loro nome vero:

- `.trueline/` e' gia' ignorato dal `.gitignore` di questo repo;
- un `.gitignore` **annidato** vale anche per il repo esterno, e renderebbe non
  tracciabile il materiale di gate della fixture stessa.

In entrambi i casi la fixture sparirebbe in silenzio al primo clone, e una fixture persa
e' un gate vacuo che nessuno vede spegnersi (`L-COL-006`). Quindi:

| | cosa | dove |
|---|---|---|
| **tracciato** | `<fixture>/seed/`, con i dot-file scritti `dot.<nome>` | nel repo |
| **derivato** | `<fixture>/project/`, materializzato + inner-`.git` | gitignorato (`eval/scan-scope/*/project/`) |

Materializzazione: ogni segmento di path che comincia per `dot.` perde il prefisso e
guadagna il punto (`dot.trueline/scan-scope.json` -> `.trueline/scan-scope.json`).

## Provisioning (passo d'ORCHESTRATORE)

Gli agenti non toccano git (`L-COL-024`):

```
bash eval/scan-scope/provision_fixtures.sh          # idempotente
bash eval/scan-scope/provision_fixtures.sh --force  # rifa' project/ da zero
```

L'inner-`.git` **non serve a gitleaks** (lo scope `working-tree` legge i file su disco):
serve a **provare** che la fixture e' quello che dichiara di essere. Senza quelle prove i
sotto-test (2) e (4) sarebbero vacui, e il keystone esce **2** (ambiente) invece di
mentire:

- `src/lib/database.types.ts` **TRACCIATO** -> (2) non e' "un file ignorato che sparisce";
- `.env` e `backups/` **GITIGNORATI** -> (4) e (7) sono davvero il caso difficile.

## Le due fixture

### `declared/` — progetto **con** dichiarazioni

| file | classe (PLAN §1) | serve a |
|---|---|---|
| `src/app.ts` | sorgente d'autore | (3) `source:still-found` |
| `build/bundle.js` | A — artefatto di build | (1), (10), (12) |
| `.next/static/chunks/app-1a2b3c.js` | A | (1), (12) |
| `src/lib/database.types.ts` | B — codegen **tracciato** dentro `src/` | (2) |
| `backups/remote_data_2026_07_20.sql` | C — dump di dati, gitignorato | (7), (8) |
| `src/lib/supabase-demo-client.ts` | D — chiave demo (`iss=supabase-demo`) + riga di **controllo** | (5) |
| `src/lib/supabase-cloud-client.ts` | chiave di un progetto cloud reale (`iss=supabase`) | (6) |
| `.env` | segreto **VERO**, gitignorato | (4) — load-bearing |
| `.trueline/scan-scope.json` | leva 3, con `reason` | (7), (9) |
| `variants/scan-scope.noreason.json` | la stessa esclusione **senza** `reason` | (8) |

`src/app.ts`, `build/bundle.js` e `.next/.../app-1a2b3c.js` portano **lo stesso identico
literal**: fra (1) e (3) l'unica variabile e' il **path**. E' cio' che rende (3) una prova
che l'esclusione non e' troppo larga, invece di un secondo modo di dire la stessa cosa.

### `undeclared/` — progetto **senza** dichiarazioni

Stessa forma, nessun `.trueline/scan-scope.json`. Contiene di proposito un `build/` e un
`database.types.ts` — cioe' proprio i path che il manifest escluderebbe — perche' la
BIT-invarianza di (11) sia **non vacua**: se un'esclusione di default si intrufolasse nel
modulo, il finding sparirebbe qui, subito, invece che in tre progetti utente.

## Sui valori

Tutti i segreti sono **sintetici**, inventati per la fixture. I due JWT sono costruiti a
mano (header/payload/firma in base64url, firma = blob inventato): nessuna chiave e' stata
copiata da un progetto sul disco. Vale la pena leggere la nota su (5) nell'intestazione di
`eval/harness/scan_scope_check.mjs`: misurato per differenza, un JWT con
`iss=supabase-demo` produce un finding `jwt` con il `gitleaks.toml` di `HEAD` e **non** lo
produce con quello attuale — la leva 2 e' **causalmente necessaria** e (5) e' un rosso che
diventa verde (con floor sulla riga di controllo). Una versione precedente di questa nota
sosteneva l'opposto: era una misura sbagliata, corretta il 2026-07-29.
