-- OmidMed Sales Assistant
-- Initial database schema
-- Version: 001

begin;

-- =========================================================
-- 1) Customers
-- =========================================================
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,

  customer_code text,
  name text not null,
  contact_name text,
  phone text,
  normalized_phone text,
  province text,
  city text,
  address text,

  preferred_products text[] not null default '{}'::text[],
  status text not null default 'active'
    check (status in ('active', 'inactive', 'prospect', 'lost')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'vip')),

  notes text,
  next_followup_at timestamptz,

  -- Values imported from the first Holo analysis file.
  -- Later, real sales rows can replace these aggregates.
  imported_last_purchase_at date,
  imported_purchase_count integer not null default 0
    check (imported_purchase_count >= 0),
  imported_total_sales numeric(18, 0) not null default 0
    check (imported_total_sales >= 0),
  imported_avg_purchase_gap_days numeric(10, 2)
    check (
      imported_avg_purchase_gap_days is null
      or imported_avg_purchase_gap_days >= 0
    ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, owner_id)
);

create unique index if not exists customers_owner_customer_code_unique
  on public.customers (owner_id, customer_code)
  where customer_code is not null;

create index if not exists customers_owner_name_idx
  on public.customers (owner_id, name);

create index if not exists customers_owner_phone_idx
  on public.customers (owner_id, normalized_phone);

create index if not exists customers_owner_next_followup_idx
  on public.customers (owner_id, next_followup_at);


-- =========================================================
-- 2) Sales
-- =========================================================
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,

  customer_id uuid not null,
  invoice_number text,
  document_number text,
  sale_date date not null,
  amount numeric(18, 0) not null
    check (amount >= 0),

  description text,
  source text not null default 'manual'
    check (source in ('manual', 'holo_excel', 'holo_direct')),
  source_row integer,
  external_key text,
  raw_customer_name text,

  created_at timestamptz not null default now(),

  constraint sales_customer_owner_fk
    foreign key (customer_id, owner_id)
    references public.customers (id, owner_id)
    on delete cascade
);

create unique index if not exists sales_owner_source_external_key_unique
  on public.sales (owner_id, source, external_key)
  where external_key is not null;

create index if not exists sales_owner_customer_date_idx
  on public.sales (owner_id, customer_id, sale_date desc);

create index if not exists sales_owner_date_idx
  on public.sales (owner_id, sale_date desc);


-- =========================================================
-- 3) Follow-ups
-- =========================================================
create table if not exists public.followups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,

  customer_id uuid not null,
  followup_at timestamptz not null default now(),

  channel text not null default 'phone'
    check (channel in ('phone', 'sms', 'whatsapp', 'in_person', 'other')),

  outcome text not null
    check (
      outcome in (
        'no_answer',
        'requested_price',
        'no_need',
        'order_placed',
        'follow_up_later',
        'payment_pending',
        'lost',
        'other'
      )
    ),

  notes text,
  next_followup_at timestamptz,
  potential_value numeric(18, 0)
    check (potential_value is null or potential_value >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint followups_customer_owner_fk
    foreign key (customer_id, owner_id)
    references public.customers (id, owner_id)
    on delete cascade
);

create index if not exists followups_owner_customer_date_idx
  on public.followups (owner_id, customer_id, followup_at desc);

create index if not exists followups_owner_next_followup_idx
  on public.followups (owner_id, next_followup_at);


-- =========================================================
-- 4) Daily tasks
-- =========================================================
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,

  customer_id uuid,
  title text not null,
  due_at timestamptz,

  status text not null default 'pending'
    check (status in ('pending', 'done', 'cancelled')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),

  notes text,
  completed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tasks_customer_owner_fk
    foreign key (customer_id, owner_id)
    references public.customers (id, owner_id)
    on delete cascade,

  constraint tasks_completion_check
    check (
      (status = 'done' and completed_at is not null)
      or
      (status <> 'done')
    )
);

create index if not exists tasks_owner_status_due_idx
  on public.tasks (owner_id, status, due_at);


-- =========================================================
-- 5) Automatically update updated_at
-- =========================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

drop trigger if exists followups_set_updated_at on public.followups;
create trigger followups_set_updated_at
before update on public.followups
for each row execute function public.set_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();


-- =========================================================
-- 6) Secure view used by the dashboard
-- =========================================================
create or replace view public.customer_sales_summary
with (security_invoker = true)
as
with distinct_sale_dates as (
  select distinct owner_id, customer_id, sale_date
  from public.sales
),
sale_gaps as (
  select
    owner_id,
    customer_id,
    sale_date,
    sale_date - lag(sale_date) over (
      partition by owner_id, customer_id
      order by sale_date
    ) as gap_days
  from distinct_sale_dates
),
gap_stats as (
  select
    owner_id,
    customer_id,
    round(avg(gap_days)::numeric, 2) as avg_purchase_gap_days
  from sale_gaps
  where gap_days is not null
  group by owner_id, customer_id
),
sale_stats as (
  select
    owner_id,
    customer_id,
    max(sale_date) as last_purchase_at,
    count(*)::integer as purchase_count,
    coalesce(sum(amount), 0)::numeric(18, 0) as total_sales
  from public.sales
  group by owner_id, customer_id
)
select
  c.*,
  coalesce(s.last_purchase_at, c.imported_last_purchase_at)
    as last_purchase_at,
  case
    when s.customer_id is not null then s.purchase_count
    else c.imported_purchase_count
  end as purchase_count,
  case
    when s.customer_id is not null then s.total_sales
    else c.imported_total_sales
  end as total_sales,
  coalesce(g.avg_purchase_gap_days, c.imported_avg_purchase_gap_days)
    as avg_purchase_gap_days,
  case
    when coalesce(s.last_purchase_at, c.imported_last_purchase_at) is null
      then null
    else current_date
      - coalesce(s.last_purchase_at, c.imported_last_purchase_at)
  end as days_since_last_purchase
from public.customers c
left join sale_stats s
  on s.owner_id = c.owner_id
 and s.customer_id = c.id
left join gap_stats g
  on g.owner_id = c.owner_id
 and g.customer_id = c.id;


-- =========================================================
-- 7) Row Level Security
-- Only the signed-in owner can access their own rows.
-- =========================================================
alter table public.customers enable row level security;
alter table public.sales enable row level security;
alter table public.followups enable row level security;
alter table public.tasks enable row level security;

drop policy if exists "Owner manages own customers" on public.customers;
create policy "Owner manages own customers"
on public.customers
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Owner manages own sales" on public.sales;
create policy "Owner manages own sales"
on public.sales
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Owner manages own followups" on public.followups;
create policy "Owner manages own followups"
on public.followups
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Owner manages own tasks" on public.tasks;
create policy "Owner manages own tasks"
on public.tasks
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);


-- =========================================================
-- 8) API permissions
-- =========================================================
revoke all on table public.customers from anon;
revoke all on table public.sales from anon;
revoke all on table public.followups from anon;
revoke all on table public.tasks from anon;
revoke all on table public.customer_sales_summary from anon;

grant select, insert, update, delete
  on table public.customers to authenticated;
grant select, insert, update, delete
  on table public.sales to authenticated;
grant select, insert, update, delete
  on table public.followups to authenticated;
grant select, insert, update, delete
  on table public.tasks to authenticated;
grant select
  on table public.customer_sales_summary to authenticated;

commit;

-- Verification: after a successful run, this returns the four main tables.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('customers', 'sales', 'followups', 'tasks')
order by table_name;
