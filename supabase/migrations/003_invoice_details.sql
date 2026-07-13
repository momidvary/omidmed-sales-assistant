-- OmidMed Sales Assistant
-- Detailed Holo invoices and invoice items imported from QRP reports.
-- Version: 003

begin;

-- The previous sales table only allowed three source values.
-- Add holo_qrp so the missing final invoice can be synchronized safely.
alter table public.sales
  drop constraint if exists sales_source_check;

alter table public.sales
  add constraint sales_source_check
  check (source in ('manual', 'holo_excel', 'holo_direct', 'holo_qrp'));

-- A Holo document number is unique for one owner and lets us update the
-- already-imported sales rows with their real invoice number.
create unique index if not exists sales_owner_document_number_unique
  on public.sales (owner_id, document_number)
  where document_number is not null;

-- =========================================================
-- 1) Invoice headers
-- =========================================================
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  customer_id uuid not null,

  invoice_number text not null,
  document_number text,
  invoice_date date not null,
  due_date date,

  total_quantity numeric(18, 3) not null default 0,
  total_amount numeric(18, 0) not null default 0
    check (total_amount >= 0),
  cash_amount numeric(18, 0) not null default 0
    check (cash_amount >= 0),
  check_amount numeric(18, 0) not null default 0
    check (check_amount >= 0),
  card_amount numeric(18, 0) not null default 0
    check (card_amount >= 0),
  account_balance_amount numeric(18, 0) not null default 0
    check (account_balance_amount >= 0),
  account_balance_status text not null default 'unknown'
    check (account_balance_status in ('debtor', 'creditor', 'zero', 'unknown')),
  discount_amount numeric(18, 0) not null default 0
    check (discount_amount >= 0),
  discount_percent numeric(8, 3) not null default 0,

  transaction_status text,
  raw_customer_name text,
  source text not null default 'holo_qrp'
    check (source in ('holo_qrp', 'manual')),
  source_page integer,
  source_row integer,
  external_key text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, owner_id),

  constraint invoices_customer_owner_fk
    foreign key (customer_id, owner_id)
    references public.customers (id, owner_id)
    on delete cascade
);

create unique index if not exists invoices_owner_source_external_key_unique
  on public.invoices (owner_id, source, external_key);

create unique index if not exists invoices_owner_invoice_number_unique
  on public.invoices (owner_id, invoice_number);

create unique index if not exists invoices_owner_document_number_unique
  on public.invoices (owner_id, document_number)
  where document_number is not null;

create index if not exists invoices_owner_customer_date_idx
  on public.invoices (owner_id, customer_id, invoice_date desc);

create index if not exists invoices_owner_date_idx
  on public.invoices (owner_id, invoice_date desc);

-- =========================================================
-- 2) Invoice line items
-- =========================================================
create table if not exists public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  invoice_id uuid not null,

  row_number integer,
  product_name text not null,
  quantity numeric(18, 3) not null default 0,
  unit_price numeric(18, 3) not null default 0
    check (unit_price >= 0),
  line_total numeric(18, 0) not null default 0
    check (line_total >= 0),
  description text,
  source_page integer,
  external_key text not null,

  created_at timestamptz not null default now(),

  constraint invoice_items_invoice_owner_fk
    foreign key (invoice_id, owner_id)
    references public.invoices (id, owner_id)
    on delete cascade
);

create unique index if not exists invoice_items_owner_external_key_unique
  on public.invoice_items (owner_id, external_key);

create index if not exists invoice_items_owner_invoice_idx
  on public.invoice_items (owner_id, invoice_id, row_number);

create index if not exists invoice_items_owner_product_idx
  on public.invoice_items (owner_id, product_name);

-- =========================================================
-- 3) updated_at trigger
-- =========================================================
drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

-- =========================================================
-- 4) Keep the existing sales table synchronized
-- =========================================================
create or replace function public.sync_invoice_to_sales()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated_rows integer := 0;
begin
  if new.document_number is not null then
    update public.sales
      set customer_id = new.customer_id,
          invoice_number = new.invoice_number,
          sale_date = new.invoice_date,
          amount = new.total_amount,
          raw_customer_name = new.raw_customer_name,
          description = concat('فاکتور ', new.invoice_number, ' - سند ', new.document_number)
      where owner_id = new.owner_id
        and document_number = new.document_number;

    get diagnostics updated_rows = row_count;
  end if;

  if updated_rows = 0 then
    insert into public.sales (
      owner_id,
      customer_id,
      invoice_number,
      document_number,
      sale_date,
      amount,
      description,
      source,
      source_row,
      external_key,
      raw_customer_name
    ) values (
      new.owner_id,
      new.customer_id,
      new.invoice_number,
      new.document_number,
      new.invoice_date,
      new.total_amount,
      concat('فاکتور ', new.invoice_number, ' - سند ', coalesce(new.document_number, '—')),
      'holo_qrp',
      new.source_row,
      concat('holo-qrp-invoice-', new.invoice_number),
      new.raw_customer_name
    )
    on conflict (owner_id, document_number)
      where document_number is not null
    do update set
      customer_id = excluded.customer_id,
      invoice_number = excluded.invoice_number,
      sale_date = excluded.sale_date,
      amount = excluded.amount,
      raw_customer_name = excluded.raw_customer_name,
      description = excluded.description;
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_sync_sales on public.invoices;
create trigger invoices_sync_sales
after insert or update of customer_id, invoice_number, document_number, invoice_date, total_amount
on public.invoices
for each row execute function public.sync_invoice_to_sales();

-- =========================================================
-- 5) Product summary used in each customer profile
-- =========================================================
create or replace view public.customer_product_summary
with (security_invoker = true)
as
select
  i.owner_id,
  i.customer_id,
  ii.product_name,
  count(distinct i.id)::integer as invoice_count,
  coalesce(sum(ii.quantity), 0)::numeric(18, 3) as total_quantity,
  coalesce(sum(ii.line_total), 0)::numeric(18, 0) as total_amount,
  max(i.invoice_date) as last_purchase_at
from public.invoices i
join public.invoice_items ii
  on ii.owner_id = i.owner_id
 and ii.invoice_id = i.id
group by i.owner_id, i.customer_id, ii.product_name;

-- =========================================================
-- 6) Row Level Security
-- =========================================================
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

drop policy if exists "Owner manages own invoices" on public.invoices;
create policy "Owner manages own invoices"
on public.invoices
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Owner manages own invoice items" on public.invoice_items;
create policy "Owner manages own invoice items"
on public.invoice_items
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

-- =========================================================
-- 7) API permissions
-- =========================================================
revoke all on table public.invoices from anon;
revoke all on table public.invoice_items from anon;
revoke all on table public.customer_product_summary from anon;

grant select, insert, update, delete
  on table public.invoices to authenticated;
grant select, insert, update, delete
  on table public.invoice_items to authenticated;
grant select
  on table public.customer_product_summary to authenticated;

commit;

-- Verification
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('invoices', 'invoice_items')
order by table_name;
