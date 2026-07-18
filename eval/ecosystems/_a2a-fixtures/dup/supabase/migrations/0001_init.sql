-- Migrazione pulita (RLS abilitata + policy per-tenant): il difetto della fixture
-- vive nel codice TS (duplicazione), NON nella sicurezza DB. Serve solo a rendere
-- il fixture realistico; il keystone A2a legge il controllo 1, non il 2.
create table public.commesse (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  descrizione text not null
);
alter table public.commesse enable row level security;
create policy commesse_tenant_isolation on public.commesse
  using (tenant_id = auth.uid());
