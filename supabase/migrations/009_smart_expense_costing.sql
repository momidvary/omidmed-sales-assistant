-- OmidMed Sales Assistant
-- 009: Smart and simple expense classification for product pricing

begin;

-- Every expense can be classified once and reused in pricing.
alter table public.workshop_expenses
  add column if not exists cost_scope text not null default 'unreviewed',
  add column if not exists manufacturing_share_percent numeric(7,3) not null default 0,
  add column if not exists classification_status text not null default 'pending',
  add column if not exists classification_source text,
  add column if not exists classification_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workshop_expenses_cost_scope_check'
  ) then
    alter table public.workshop_expenses
      add constraint workshop_expenses_cost_scope_check
      check (cost_scope in ('unreviewed','manufacturing','selling','period','asset','ignore'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'workshop_expenses_manufacturing_share_check'
  ) then
    alter table public.workshop_expenses
      add constraint workshop_expenses_manufacturing_share_check
      check (manufacturing_share_percent >= 0 and manufacturing_share_percent <= 100);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'workshop_expenses_classification_status_check'
  ) then
    alter table public.workshop_expenses
      add constraint workshop_expenses_classification_status_check
      check (classification_status in ('pending','suggested','confirmed','auto'));
  end if;
end $$;

create index if not exists workshop_expenses_owner_classification_idx
  on public.workshop_expenses (owner_id, classification_status, expense_date desc);

-- The user's decisions are remembered and applied automatically to future Holo imports.
create table if not exists public.expense_classification_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  match_text text not null,
  match_mode text not null default 'contains'
    check (match_mode in ('exact','contains')),
  category text not null
    check (category in (
      'rent', 'utilities', 'direct_labor', 'indirect_labor', 'sewing', 'printing',
      'packaging', 'shipping', 'maintenance', 'advertising', 'equipment',
      'tax_fee', 'insurance', 'software', 'other'
    )),
  cost_behavior text not null default 'mixed'
    check (cost_behavior in ('fixed','variable','mixed')),
  cost_scope text not null
    check (cost_scope in ('manufacturing','selling','period','asset','partner','ignore')),
  manufacturing_share_percent numeric(7,3) not null default 0
    check (manufacturing_share_percent >= 0 and manufacturing_share_percent <= 100),
  confidence numeric(6,5) not null default 1
    check (confidence >= 0 and confidence <= 1),
  reason text,
  source text not null default 'manual'
    check (source in ('manual','ai','system')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, match_text)
);

create index if not exists expense_classification_rules_owner_active_idx
  on public.expense_classification_rules (owner_id, is_active, match_text);

-- Selling and distribution expenses are shown separately but are still included
-- in the full cost used for sales-price recommendations.
alter table public.costing_settings
  add column if not exists monthly_selling_overhead numeric(18,0) not null default 0,
  add column if not exists planned_monthly_orders integer not null default 1;

alter table public.costing_products
  add column if not exists selling_cost_per_unit_override numeric(18,4);

alter table public.pricing_setup_runs
  add column if not exists selling_payroll_cost numeric(18,0) not null default 0,
  add column if not exists allocated_selling_cost numeric(18,0) not null default 0,
  add column if not exists selling_cost_per_unit numeric(18,4) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'costing_settings_monthly_selling_overhead_check'
  ) then
    alter table public.costing_settings
      add constraint costing_settings_monthly_selling_overhead_check
      check (monthly_selling_overhead >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'costing_settings_planned_monthly_orders_check'
  ) then
    alter table public.costing_settings
      add constraint costing_settings_planned_monthly_orders_check
      check (planned_monthly_orders > 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'costing_products_selling_cost_override_check'
  ) then
    alter table public.costing_products
      add constraint costing_products_selling_cost_override_check
      check (selling_cost_per_unit_override is null or selling_cost_per_unit_override >= 0);
  end if;
end $$;

-- Default classification for already registered manual expenses. Holo rows remain
-- pending until the user confirms the smart review.
update public.workshop_expenses
set
  cost_scope = case
    when category in ('rent','utilities','direct_labor','indirect_labor','sewing','printing','packaging','maintenance','insurance') then 'manufacturing'
    when category in ('shipping','advertising') then 'selling'
    when category = 'equipment' then 'asset'
    else 'period'
  end,
  manufacturing_share_percent = case
    when category in ('rent','utilities','direct_labor','sewing','printing','packaging','maintenance') then 100
    when category in ('indirect_labor','insurance') then 70
    else 0
  end,
  classification_status = case when source = 'manual' then 'auto' else classification_status end,
  classification_source = case when source = 'manual' then 'system' else classification_source end
where classification_status = 'pending' and source = 'manual';

-- updated_at trigger and RLS for rules.
drop trigger if exists expense_classification_rules_set_updated_at on public.expense_classification_rules;
create trigger expense_classification_rules_set_updated_at
before update on public.expense_classification_rules
for each row execute function public.set_updated_at();

alter table public.expense_classification_rules enable row level security;

drop policy if exists "Owner manages own expense classification rules" on public.expense_classification_rules;
create policy "Owner manages own expense classification rules"
on public.expense_classification_rules for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

revoke all on table public.expense_classification_rules from anon;
grant select, insert, update, delete on table public.expense_classification_rules to authenticated;

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'expense_classification_rules';
