-- OmidMed Sales Assistant
-- 007: Direct import of historical Holo FP3 expenses and partner withdrawals

begin;

create table if not exists public.accounting_import_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source text not null default 'holo_fp3',
  file_name text not null,
  file_checksum text not null,
  row_count integer not null default 0 check (row_count >= 0),
  expense_count integer not null default 0 check (expense_count >= 0),
  partner_withdrawal_count integer not null default 0 check (partner_withdrawal_count >= 0),
  review_count integer not null default 0 check (review_count >= 0),
  ignored_count integer not null default 0 check (ignored_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  status text not null default 'processing' check (status in ('processing','completed','failed')),
  imported_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, file_checksum)
);

alter table public.workshop_expenses
  add column if not exists source text not null default 'manual',
  add column if not exists external_key text,
  add column if not exists source_document_number text,
  add column if not exists raw_description text,
  add column if not exists import_batch_id uuid;

create unique index if not exists workshop_expenses_owner_source_external_unique
  on public.workshop_expenses (owner_id, source, external_key)
  where external_key is not null;

create index if not exists workshop_expenses_owner_import_batch_idx
  on public.workshop_expenses (owner_id, import_batch_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workshop_expenses_import_batch_fk'
  ) then
    alter table public.workshop_expenses
      add constraint workshop_expenses_import_batch_fk
      foreign key (import_batch_id)
      references public.accounting_import_batches (id)
      on delete set null;
  end if;
end $$;

create table if not exists public.partner_withdrawals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  withdrawal_date date not null,
  partner_name text not null,
  amount numeric(18,0) not null check (amount >= 0),
  payment_method text not null default 'cash' check (payment_method in ('cash','card','bank_transfer','cheque','other')),
  document_number text,
  description text,
  source text not null default 'manual',
  external_key text,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  constraint partner_withdrawals_import_batch_fk
    foreign key (import_batch_id)
    references public.accounting_import_batches (id)
    on delete set null
);

create unique index if not exists partner_withdrawals_owner_source_external_unique
  on public.partner_withdrawals (owner_id, source, external_key)
  where external_key is not null;

create index if not exists partner_withdrawals_owner_date_idx
  on public.partner_withdrawals (owner_id, withdrawal_date desc);

create table if not exists public.accounting_review_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null,
  review_kind text not null check (review_kind in ('asset_purchase','installment','ambiguous')),
  amount numeric(18,0) not null check (amount >= 0),
  document_number text,
  source_account text,
  raw_description text not null,
  suggested_category text,
  status text not null default 'pending' check (status in ('pending','resolved','ignored')),
  resolution_notes text,
  source text not null default 'manual',
  external_key text,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  constraint accounting_review_items_import_batch_fk
    foreign key (import_batch_id)
    references public.accounting_import_batches (id)
    on delete set null
);

create unique index if not exists accounting_review_items_owner_source_external_unique
  on public.accounting_review_items (owner_id, source, external_key)
  where external_key is not null;

create index if not exists accounting_review_items_owner_status_date_idx
  on public.accounting_review_items (owner_id, status, entry_date desc);

-- Keep updated_at current on the new tables.
drop trigger if exists accounting_import_batches_set_updated_at on public.accounting_import_batches;
create trigger accounting_import_batches_set_updated_at
before update on public.accounting_import_batches
for each row execute function public.set_updated_at();

drop trigger if exists partner_withdrawals_set_updated_at on public.partner_withdrawals;
create trigger partner_withdrawals_set_updated_at
before update on public.partner_withdrawals
for each row execute function public.set_updated_at();

drop trigger if exists accounting_review_items_set_updated_at on public.accounting_review_items;
create trigger accounting_review_items_set_updated_at
before update on public.accounting_review_items
for each row execute function public.set_updated_at();

alter table public.accounting_import_batches enable row level security;
alter table public.partner_withdrawals enable row level security;
alter table public.accounting_review_items enable row level security;

drop policy if exists "Owner manages own accounting import batches" on public.accounting_import_batches;
create policy "Owner manages own accounting import batches"
on public.accounting_import_batches for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Owner manages own partner withdrawals" on public.partner_withdrawals;
create policy "Owner manages own partner withdrawals"
on public.partner_withdrawals for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Owner manages own accounting review items" on public.accounting_review_items;
create policy "Owner manages own accounting review items"
on public.accounting_review_items for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

revoke all on table public.accounting_import_batches from anon;
revoke all on table public.partner_withdrawals from anon;
revoke all on table public.accounting_review_items from anon;

grant select, insert, update, delete on table public.accounting_import_batches to authenticated;
grant select, insert, update, delete on table public.partner_withdrawals to authenticated;
grant select, insert, update, delete on table public.accounting_review_items to authenticated;

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('accounting_import_batches','partner_withdrawals','accounting_review_items')
order by table_name;
