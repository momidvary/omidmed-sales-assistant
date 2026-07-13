-- OmidMed Sales Assistant
-- Audit history for direct QRP synchronization from Holo.
-- Version: 004

begin;

create table if not exists public.holo_import_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,

  header_file_name text,
  items_file_name text,
  invoice_count integer not null default 0 check (invoice_count >= 0),
  item_count integer not null default 0 check (item_count >= 0),
  new_customer_count integer not null default 0 check (new_customer_count >= 0),
  new_invoice_count integer not null default 0 check (new_invoice_count >= 0),
  changed_invoice_count integer not null default 0 check (changed_invoice_count >= 0),
  unchanged_invoice_count integer not null default 0 check (unchanged_invoice_count >= 0),
  changed_item_invoice_count integer not null default 0
    check (changed_item_invoice_count >= 0),
  status text not null default 'completed'
    check (status in ('completed', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists holo_import_runs_owner_created_idx
  on public.holo_import_runs (owner_id, created_at desc);

alter table public.holo_import_runs enable row level security;

drop policy if exists "Owner manages own Holo import history"
  on public.holo_import_runs;
create policy "Owner manages own Holo import history"
on public.holo_import_runs
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

revoke all on table public.holo_import_runs from anon;
grant select, insert, update, delete
  on table public.holo_import_runs to authenticated;

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'holo_import_runs';
