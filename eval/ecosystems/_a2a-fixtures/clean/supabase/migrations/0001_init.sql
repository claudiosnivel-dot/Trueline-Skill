-- Migrazione pulita (RLS abilitata + policy per-tenant). Fixture di contrasto:
-- nessun difetto d'igiene e nessun difetto di sicurezza -> tutto verde.
create table public.note (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  testo text not null
);
alter table public.note enable row level security;
create policy note_tenant_isolation on public.note
  using (tenant_id = auth.uid());
