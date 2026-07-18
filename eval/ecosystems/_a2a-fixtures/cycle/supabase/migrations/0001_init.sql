-- Migrazione pulita (RLS abilitata + policy per-tenant): il difetto della fixture
-- vive nel grafo di import (ciclo a<->b), NON nella sicurezza DB.
create table public.preventivi (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  totale numeric not null
);
alter table public.preventivi enable row level security;
create policy preventivi_tenant_isolation on public.preventivi
  using (tenant_id = auth.uid());
