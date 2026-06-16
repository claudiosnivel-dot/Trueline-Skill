# eval/db-test — DB di test RLS (Supabase locale)

Istanza **Supabase locale** che rende esercitabile RLS **a runtime**: le
migration della reference app (`eval/reference-app/supabase/migrations/`)
girano su un Postgres locale, permettendo query reali contro le policy RLS
seminate (proof S5, verifica di contrasto S3/S4).

`project_id = "trueline-db-test"` -> i container si chiamano
`supabase_*_trueline-db-test`.

---

## Stato bring-up (verificato)

- Stack **UP** e healthy (container `supabase_db_trueline-db-test`, DB su
  host port **54422**), avviato con la CLI Supabase **2.106.0**.
- `supabase status --workdir eval/db-test` risolve lo stack in esecuzione
  (API 54421, DB 54422, Studio 54423, Inbucket/Mailpit 54424, Analytics 54427).
- Schema applicato: 5/5 tabelle (`profiles`, `notes`, `audit_logs`,
  `documents`, `invoices`) con le policy seminate.
- Proof S5 riprodotto (`up.ps1 -Proof` / `up.sh --proof`): **leak confermato**
  (tenant A vede una riga del tenant B) + **contrasto OK** (notes isola).

### Avvio / stop / proof

| Azione | Windows (PowerShell) | Linux/macOS/WSL |
|---|---|---|
| Bring-up idempotente | `.\eval\db-test\up.ps1` | `bash eval/db-test/up.sh` |
| Stop | `.\eval\db-test\up.ps1 -Down` | `bash eval/db-test/up.sh --down` |
| Reset pulito | `.\eval\db-test\up.ps1 -Reset` | `bash eval/db-test/up.sh --reset` |
| Proof S5 | `.\eval\db-test\up.ps1 -Proof` | `bash eval/db-test/up.sh --proof` |

Gli script sono **idempotenti**: verificano Docker + CLI, ricreano la junction/
symlink delle migration, assicurano il config, avviano lo stack **solo se e giu**
e applicano la migration solo se le tabelle mancano. Se lo stack e gia su, non lo
toccano.

---

## Ricetta di connessione (M3)

**DB URL (psql / driver):**
```
postgresql://postgres:postgres@127.0.0.1:54422/postgres
```

**Query come superuser (bypassa RLS — solo per seeding/ispezione):**
```bash
docker exec -i supabase_db_trueline-db-test \
  psql -U postgres -d postgres -c "SELECT * FROM public.invoices;"
```

**Query COME tenant (RLS applicato) — il pattern usato dal proof:** impersonare
un tenant significa diventare il ruolo non-superuser `authenticated` e impostare
`request.jwt.claims.sub` con l'uuid del tenant, dentro una transazione:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text,
  true);
-- ora auth.uid() = '1111...'; le policy RLS vengono applicate
SELECT * FROM public.invoices;   -- mostra il leak S5
ROLLBACK;
```

**Prerequisito una-tantum (GRANT):** RLS viene valutato **solo dopo** il
controllo dei privilegi sulla base-table. Senza GRANT, `authenticated` riceve
`permission denied` prima ancora che la policy entri in gioco. Concedere:

```sql
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON public.invoices TO authenticated;
GRANT SELECT, INSERT ON public.notes    TO authenticated;
GRANT SELECT, INSERT ON public.profiles TO authenticated;
```

(`proof_s5.sql` esegue questi GRANT da solo, in transazione.)

---

## Difetti RLS esercitabili a runtime

| Difetto seminato | Cosa abilita il DB di test |
|---|---|
| **S5** -- `invoices` multi-tenant: RLS attivo ma policy `USING (status <> 'draft')`, nessun riferimento a `auth.uid()`/`tenant_id`. | Leak cross-tenant **verificabile solo a runtime**: come tenant A leggi le righe non-draft del tenant B. E il caso canonico che richiede il DB di test (un checker statico vede la policy ma non puo eseguire la query come un tenant). |
| **S3** -- `audit_logs` SENZA `ENABLE ROW LEVEL SECURITY` (`relrowsecurity = false`). | Verificabile staticamente; il DB di test consente anche la query diretta di contrasto (accesso non filtrato). |
| **S4** -- `documents` con policy `USING (true)`. | Isolamento solo apparente: come utente A vedi le righe di tutti. Verifica empirica di contrasto. |

Contrasto corretto: `profiles` e `notes` hanno policy `auth.uid()` e isolano
davvero (il proof lo dimostra: 0 righe di altri proprietari).

---

## Perche le porte sono spostate di +100

Le porte standard Supabase `543xx` erano gia occupate da uno stack non correlato
(**ASV_Officina**). Per far coesistere i due stack senza collisioni, tutte le
porte pubblicate di questo progetto sono spostate di **+100**:

| Servizio | Default | Qui (+100) |
|---|---|---|
| api / kong | 54321 | **54421** |
| db (Postgres) | 54322 | **54422** |
| db.shadow (`db diff`) | 54320 | **54420** |
| studio | 54323 | **54423** |
| inbucket / mailpit | 54324 | **54424** |
| analytics (logflare) | 54327 | **54427** |

Lo shift e codificato in `supabase/config.toml`; `supabase status` e gli script
usano queste porte.

---

## Immagine Postgres fissata

Lo stack gira sull'immagine fissata
```
public.ecr.aws/supabase/postgres:17.6.1.134
```
(`major_version = 17` in `supabase/config.toml`, coerente con l'immagine).

---

## Nota: companion supabase-go

La CLI 2.106 in questo ambiente e uno **shim** (`supabase.exe`) che delega al
companion **`supabase-go.exe`**, entrambi v2.106.0 in `C:\Users\<utente>\go\bin`.
Devono stare nella **stessa directory**: alcune sottoazioni della CLI invocano
direttamente `supabase-go`. `up.ps1`/`up.sh` verificano la presenza del companion
e avvisano se manca. Non reinstallare la CLI se gia presente.

---

## Struttura della directory

| File | Descrizione |
|---|---|
| `supabase/config.toml` | **Config attivo** (schema CLI 2.106), `project_id="trueline-db-test"`, porte +100. |
| `supabase/migrations` | **Junction (Windows) / symlink (POSIX)** -> `../../reference-app/supabase/migrations`. Unica source-of-truth (`0001_init.sql`). Ricreata in modo idempotente da up.ps1/up.sh. |
| `config.toml` (root db-test) | **Stub deprecato**: lo schema vecchio pre-2.x e invalido; punta a `supabase/config.toml`. Non eliminare. |
| `up.ps1` | Bring-up Windows idempotente. Flag `-Down` / `-Reset` / `-Proof`. |
| `up.sh` | Mirror Linux/macOS/WSL. Flag `--down` / `--reset` / `--proof`. |
| `proof_s5.sql` | Prova empirica S5 riproducibile (leak invoices + contrasto notes), in transazione con ROLLBACK (nessun residuo). |
| `README.md` | Questo file. |

> La junction/symlink puo non sopravvivere a un checkout git pulito: e atteso.
> `up.ps1`/`up.sh` la ricreano in modo idempotente al prossimo avvio.

---

## Degradazione dichiarata

*Rif. 06-CHARACTERIZATION-TESTS §6.1 / 10-EVALUATION §2*

Se Docker o la CLI supabase non sono disponibili, i controlli RLS che richiedono
il DB di test **degradano al checker statico**: S3/S4 restano rilevabili
staticamente; S5 viene segnalato come **sospetto** ma non come finding
comportamentale verificato. La skill **dichiara sempre** il confine
(`"comportamento RLS non caratterizzato a runtime; checker statico usato"`) e
**non emette mai un falso verde** (L-COL-006).
