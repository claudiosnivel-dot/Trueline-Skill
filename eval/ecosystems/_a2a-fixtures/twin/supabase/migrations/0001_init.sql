-- Migrazione pulita (RLS abilitata + policy per-tenant): il "difetto" della fixture
-- e' strutturale (dir parallele commesse/preventivi), NON nella sicurezza DB.
create table public.commesse (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  descrizione text not null
);
alter table public.commesse enable row level security;
create policy commesse_tenant_isolation on public.commesse
  using (tenant_id = auth.uid());
