-- OmidMed Sales Assistant
-- Step 22B: Customer creation, prospects, archive and safe deletion
-- Run once in Supabase SQL Editor.

begin;

alter table public.customers
  add column if not exists lead_stage text,
  add column if not exists lead_source text,
  add column if not exists potential_value numeric(18, 0),
  add column if not exists archived_at timestamptz;

alter table public.customers
  drop constraint if exists customers_lead_stage_check;

alter table public.customers
  add constraint customers_lead_stage_check
  check (
    lead_stage is null
    or lead_stage in (
      'new',
      'contacted',
      'interested',
      'quoted',
      'decision',
      'converted',
      'lost'
    )
  );

alter table public.customers
  drop constraint if exists customers_potential_value_check;

alter table public.customers
  add constraint customers_potential_value_check
  check (potential_value is null or potential_value >= 0);

create index if not exists customers_owner_status_archive_idx
  on public.customers (owner_id, status, archived_at);

create index if not exists customers_owner_lead_stage_idx
  on public.customers (owner_id, lead_stage)
  where lead_stage is not null;

-- Dedicated CRM view. The older customer_sales_summary view remains untouched.
create or replace view public.customer_crm_summary
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
  c.id,
  c.owner_id,
  c.customer_code,
  c.name,
  c.contact_name,
  c.phone,
  c.normalized_phone,
  c.province,
  c.city,
  c.address,
  c.preferred_products,
  c.status,
  c.priority,
  c.notes,
  c.next_followup_at,
  c.imported_last_purchase_at,
  c.imported_purchase_count,
  c.imported_total_sales,
  c.imported_avg_purchase_gap_days,
  c.created_at,
  c.updated_at,
  c.lead_stage,
  c.lead_source,
  c.potential_value,
  c.archived_at,
  coalesce(s.last_purchase_at, c.imported_last_purchase_at) as last_purchase_at,
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
    else current_date - coalesce(s.last_purchase_at, c.imported_last_purchase_at)
  end as days_since_last_purchase
from public.customers c
left join sale_stats s
  on s.owner_id = c.owner_id
 and s.customer_id = c.id
left join gap_stats g
  on g.owner_id = c.owner_id
 and g.customer_id = c.id;

revoke all on table public.customer_crm_summary from anon;
grant select on table public.customer_crm_summary to authenticated;

-- When a sale is attached to an existing prospect, convert it automatically.
create or replace function public.activate_customer_after_sale()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.customers
  set
    status = 'active',
    lead_stage = case
      when status = 'prospect' then 'converted'
      else lead_stage
    end,
    archived_at = null
  where id = new.customer_id
    and owner_id = new.owner_id;

  return new;
end;
$$;

drop trigger if exists sales_activate_customer on public.sales;

create trigger sales_activate_customer
after insert or update of customer_id
on public.sales
for each row
execute function public.activate_customer_after_sale();

commit;

select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'customers'
  and column_name in (
    'lead_stage',
    'lead_source',
    'potential_value',
    'archived_at'
  )
order by column_name;
