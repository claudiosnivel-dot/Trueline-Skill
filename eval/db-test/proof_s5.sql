-- =============================================================================
-- eval/db-test/proof_s5.sql -- PROVA EMPIRICA RIPRODUCIBILE del difetto S5
--
-- DIFETTO S5 (seminato in 0001_init.sql): la tabella public.invoices ha RLS
-- abilitato ma la sua UNICA policy SELECT (invoices_visible_when_not_draft)
-- filtra solo per `status <> 'draft'` -- NON referenzia ne auth.uid() ne
-- tenant_id. Risultato: un tenant autenticato vede le righe di QUALSIASI altro
-- tenant (cross-tenant leak), purche lo stato non sia 'draft'.
--
-- CONTRASTO: public.notes e public.profiles hanno policy vincolate per
-- auth.uid(): lo stesso ruolo `authenticated` vede SOLO le proprie righe.
--
-- COME GIRA: come ruolo NON-superuser `authenticated` con RLS APPLICATO,
-- impersonando il tenant A via request.jwt.claims (sub = uuid del tenant A).
--
-- PREREQUISITO (una-tantum, idempotente): RLS viene valutato SOLO DOPO il
-- controllo dei privilegi sulla base-table. Senza GRANT, `authenticated`
-- riceverebbe "permission denied for table ..." prima ancora che la policy
-- venga considerata. Quindi si concede USAGE sullo schema e SELECT/INSERT
-- sulle tabelle coinvolte.
--
-- Eseguibile con:
--   docker exec -i supabase_db_trueline-db-test \
--     psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < proof_s5.sql
-- oppure: .\up.ps1 -Proof
--
-- Idempotente: pulisce le righe di prova (tenant fissi) a inizio e fine.
-- =============================================================================

\set ON_ERROR_STOP on

-- UUID fissi per riproducibilita.
\set tenantA  '11111111-1111-1111-1111-111111111111'
\set tenantB  '22222222-2222-2222-2222-222222222222'

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. PREREQUISITO GRANT (idempotente). RLS si applica DOPO il privilege check.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT ON public.invoices TO authenticated;
GRANT SELECT, INSERT ON public.notes    TO authenticated;
GRANT SELECT, INSERT ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 1. SEED come superuser (postgres bypassa RLS): due tenant, invoices + notes.
--    Pulizia preventiva delle righe di prova per rendere lo script ripetibile.
-- ---------------------------------------------------------------------------
DELETE FROM public.invoices WHERE tenant_id IN (:'tenantA', :'tenantB');
DELETE FROM public.notes    WHERE owner_id  IN (:'tenantA', :'tenantB');

-- Tenant A: una fattura non-draft (visibile dalla policy) + una draft.
INSERT INTO public.invoices (tenant_id, amount_cents, status) VALUES
    (:'tenantA', 1000, 'sent'),
    (:'tenantA',  500, 'draft');

-- Tenant B: una fattura non-draft. NON deve essere visibile al tenant A se
-- l'isolamento per tenant funzionasse -- ma S5 fa si che lo sia.
INSERT INTO public.invoices (tenant_id, amount_cents, status) VALUES
    (:'tenantB', 9999, 'paid');

-- Contrasto: notes con isolamento corretto per owner_id = auth.uid().
INSERT INTO public.notes (owner_id, body) VALUES
    (:'tenantA', 'nota privata del tenant A'),
    (:'tenantB', 'nota privata del tenant B');

-- ---------------------------------------------------------------------------
-- 2. Diventa il ruolo `authenticated` (non-super, non-bypassrls) e impersona
--    il TENANT A impostando request.jwt.claims.sub = uuid del tenant A.
--    SET LOCAL => vale solo dentro questa transazione.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
                  json_build_object('sub', :'tenantA')::text,
                  true);

\echo ''
\echo '================================================================'
\echo ' PROVA S5 -- sono il ruolo authenticated, impersono il TENANT A'
\echo '   auth.uid() corrente:'
SELECT auth.uid() AS current_auth_uid;

-- ---------------------------------------------------------------------------
-- 3. LEAK S5: il tenant A interroga invoices. La policy filtra solo per stato,
--    quindi vede ANCHE la fattura del tenant B (cross-tenant). Atteso: compare
--    sia tenant A (sent) sia tenant B (paid); la draft di A resta nascosta.
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- [LEAK] SELECT * FROM invoices (come tenant A) -------------------'
\echo '    Atteso difettoso: vedo righe di TENANT B oltre alle mie.'
SELECT tenant_id,
       amount_cents,
       status,
       CASE
         WHEN tenant_id = :'tenantA' THEN 'MIA (tenant A)'
         WHEN tenant_id = :'tenantB' THEN '>>> LEAK: tenant B <<<'
         ELSE 'altro'
       END AS provenienza
FROM public.invoices
WHERE tenant_id IN (:'tenantA', :'tenantB')
ORDER BY provenienza, amount_cents;

\echo ''
\echo '--- [LEAK] conteggio righe di ALTRI tenant visibili al tenant A -----'
\echo '    Atteso difettoso: > 0 (deve essere 0 se RLS isolasse i tenant).'
SELECT count(*) AS righe_di_altri_tenant_visibili
FROM public.invoices
WHERE tenant_id <> :'tenantA';

-- ---------------------------------------------------------------------------
-- 4. CONTRASTO: la stessa identita (tenant A) interroga notes. La policy e
--    vincolata per auth.uid(), quindi vede SOLO le proprie righe. Isolamento OK.
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- [CONTRASTO] SELECT * FROM notes (come tenant A) -----------------'
\echo '    Atteso corretto: vedo SOLO la mia nota; nessuna riga del tenant B.'
SELECT owner_id,
       body,
       CASE WHEN owner_id = :'tenantA' THEN 'MIA (tenant A)'
            ELSE '>>> ISOLAMENTO ROTTO <<<' END AS provenienza
FROM public.notes
ORDER BY provenienza;

\echo ''
\echo '--- [CONTRASTO] conteggio note di ALTRI proprietari visibili --------'
\echo '    Atteso corretto: 0 (notes isola per auth.uid()).'
SELECT count(*) AS note_di_altri_visibili
FROM public.notes
WHERE owner_id <> :'tenantA';

\echo ''
\echo '================================================================'
\echo ' ESITO:'
\echo '  - invoices (S5): LEAK confermato -> tenant A vede righe tenant B.'
\echo '  - notes (contrasto): isolamento OK -> tenant A vede solo le sue.'
\echo '================================================================'

-- Torna a postgres e annulla tutto: lo script non lascia residui.
RESET ROLE;
ROLLBACK;
