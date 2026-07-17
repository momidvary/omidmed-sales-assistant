-- OmidMed Sales Assistant
-- Pricing readiness wizard and production-cost allocation
-- Version: 008

begin;

create table if not exists public.pricing_setup_profiles (
  owner_id uuid primary key default auth.uid()
    references auth.users(id) on delete cascade,
  jalali_year integer not null check (jalali_year between 1300 and 1700),
  jalali_month integer not null check (jalali_month between 1 and 12),
  working_days integer not null default 26 check (working_days between 1 and 31),
  daily_work_hours numeric(7, 2) not null default 7
    check (daily_work_hours > 0 and daily_work_hours <= 24),
  allocation_method text not null default 'standard_minutes'
    check (allocation_method in ('standard_minutes', 'units', 'manual')),
  monthly_sales_target numeric(18, 0) not null default 0
    check (monthly_sales_target >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_costing_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  employee_id uuid not null,
  department text not null default 'production'
    check (department in ('production', 'printing', 'packing', 'sales', 'admin', 'other')),
  production_share_percent numeric(7, 3) not null default 100
    check (production_share_percent >= 0 and production_share_percent <= 100),
  productive_hours_per_month numeric(10, 2)
    check (productive_hours_per_month is null or productive_hours_per_month >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, employee_id),
  constraint employee_costing_profiles_employee_owner_fk
    foreign key (employee_id, owner_id)
    references public.employees (id, owner_id)
    on delete cascade
);

create table if not exists public.product_costing_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  product_id uuid not null,
  planned_monthly_output numeric(18, 4) not null default 0
    check (planned_monthly_output >= 0),
  standard_minutes_per_unit numeric(12, 4) not null default 0
    check (standard_minutes_per_unit >= 0),
  actual_scrap_percent numeric(7, 3) not null default 0
    check (actual_scrap_percent >= 0 and actual_scrap_percent <= 500),
  manual_overhead_per_unit numeric(18, 4)
    check (manual_overhead_per_unit is null or manual_overhead_per_unit >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, product_id),
  constraint product_costing_profiles_product_owner_fk
    foreign key (product_id, owner_id)
    references public.costing_products (id, owner_id)
    on delete cascade
);

create table if not exists public.expense_costing_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  category text not null,
  include_in_product_cost boolean not null default true,
  manufacturing_share_percent numeric(7, 3) not null default 100
    check (manufacturing_share_percent >= 0 and manufacturing_share_percent <= 100),
  allocation_basis text not null default 'standard_minutes'
    check (allocation_basis in ('standard_minutes', 'units', 'manual')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, category)
);

create table if not exists public.pricing_setup_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  jalali_year integer not null,
  jalali_month integer not null,
  production_payroll_cost numeric(18, 0) not null default 0,
  allocated_expense_cost numeric(18, 0) not null default 0,
  total_productive_minutes numeric(18, 4) not null default 0,
  overhead_cost_per_minute numeric(18, 4) not null default 0,
  product_count integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

-- updated_at triggers
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pricing_setup_profiles',
    'employee_costing_profiles',
    'product_costing_profiles',
    'expense_costing_rules'
  ] LOOP
    EXECUTE format('drop trigger if exists %I on public.%I', table_name || '_set_updated_at', table_name);
    EXECUTE format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  END LOOP;
END $$;

-- RLS and API permissions
ALTER TABLE public.pricing_setup_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_costing_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_costing_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_costing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_setup_runs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
DECLARE policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'pricing_setup_profiles',
    'employee_costing_profiles',
    'product_costing_profiles',
    'expense_costing_rules',
    'pricing_setup_runs'
  ] LOOP
    policy_name := 'Owner manages own ' || table_name;
    EXECUTE format('drop policy if exists %I on public.%I', policy_name, table_name);
    EXECUTE format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)',
      policy_name, table_name
    );
    EXECUTE format('revoke all on table public.%I from anon', table_name);
    EXECUTE format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
  END LOOP;
END $$;

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'pricing_setup_profiles',
    'employee_costing_profiles',
    'product_costing_profiles',
    'expense_costing_rules',
    'pricing_setup_runs'
  )
order by table_name;
