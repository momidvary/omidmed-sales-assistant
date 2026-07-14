-- OmidMed Sales Assistant
-- Management accounting, workshop costs and inflation-aware pricing
-- Version: 006

begin;

-- =========================================================
-- 1) Suppliers and materials
-- =========================================================
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  name text not null,
  contact_name text,
  phone text,
  city text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create unique index if not exists suppliers_owner_name_unique
  on public.suppliers (owner_id, lower(name));

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  name text not null,
  code text,
  category text not null default 'raw_material'
    check (category in ('raw_material', 'packaging', 'service', 'other')),
  unit text not null default 'عدد',
  manual_replacement_unit_cost numeric(18, 4)
    check (manual_replacement_unit_cost is null or manual_replacement_unit_cost >= 0),
  replacement_price_at date,
  minimum_stock numeric(18, 4) not null default 0
    check (minimum_stock >= 0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create unique index if not exists materials_owner_name_unique
  on public.materials (owner_id, lower(name));

create unique index if not exists materials_owner_code_unique
  on public.materials (owner_id, code)
  where code is not null;

-- =========================================================
-- 2) Purchase invoices and items
-- =========================================================
create table if not exists public.purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  supplier_id uuid not null,
  invoice_number text,
  invoice_date date not null,
  subtotal numeric(18, 0) not null default 0 check (subtotal >= 0),
  discount_amount numeric(18, 0) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(18, 0) not null default 0 check (tax_amount >= 0),
  shipping_amount numeric(18, 0) not null default 0 check (shipping_amount >= 0),
  other_costs numeric(18, 0) not null default 0 check (other_costs >= 0),
  total_amount numeric(18, 0) not null default 0 check (total_amount >= 0),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'partial', 'paid')),
  payment_method text not null default 'bank_transfer'
    check (payment_method in ('cash', 'card', 'bank_transfer', 'cheque', 'credit', 'other')),
  due_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  constraint purchase_invoices_supplier_owner_fk
    foreign key (supplier_id, owner_id)
    references public.suppliers (id, owner_id)
    on delete restrict
);

create unique index if not exists purchase_invoices_owner_supplier_number_unique
  on public.purchase_invoices (owner_id, supplier_id, invoice_number)
  where invoice_number is not null;

create index if not exists purchase_invoices_owner_date_idx
  on public.purchase_invoices (owner_id, invoice_date desc);

create table if not exists public.purchase_invoice_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  purchase_invoice_id uuid not null,
  material_id uuid not null,
  description text,
  quantity numeric(18, 4) not null check (quantity > 0),
  unit text not null,
  unit_price numeric(18, 4) not null check (unit_price >= 0),
  discount_amount numeric(18, 0) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(18, 0) not null default 0 check (tax_amount >= 0),
  line_total numeric(18, 0) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  constraint purchase_invoice_items_invoice_owner_fk
    foreign key (purchase_invoice_id, owner_id)
    references public.purchase_invoices (id, owner_id)
    on delete cascade,
  constraint purchase_invoice_items_material_owner_fk
    foreign key (material_id, owner_id)
    references public.materials (id, owner_id)
    on delete restrict
);

create index if not exists purchase_invoice_items_owner_material_idx
  on public.purchase_invoice_items (owner_id, material_id);

-- =========================================================
-- 3) Workshop expenses
-- =========================================================
create table if not exists public.workshop_expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  expense_date date not null,
  category text not null
    check (category in (
      'rent', 'utilities', 'direct_labor', 'indirect_labor', 'sewing', 'printing',
      'packaging', 'shipping', 'maintenance', 'advertising', 'equipment',
      'tax_fee', 'insurance', 'software', 'other'
    )),
  cost_behavior text not null default 'fixed'
    check (cost_behavior in ('fixed', 'variable', 'mixed')),
  amount numeric(18, 0) not null check (amount >= 0),
  payee text,
  payment_method text not null default 'bank_transfer'
    check (payment_method in ('cash', 'card', 'bank_transfer', 'cheque', 'credit', 'other')),
  description text,
  is_recurring boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create index if not exists workshop_expenses_owner_date_idx
  on public.workshop_expenses (owner_id, expense_date desc);

-- =========================================================
-- 4) Employees and payroll
-- =========================================================
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  name text not null,
  role_title text,
  phone text,
  monthly_base_salary numeric(18, 0) not null default 0 check (monthly_base_salary >= 0),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create unique index if not exists employees_owner_name_unique
  on public.employees (owner_id, lower(name));

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  employee_id uuid not null,
  jalali_year integer not null check (jalali_year between 1300 and 1700),
  jalali_month integer not null check (jalali_month between 1 and 12),
  base_salary numeric(18, 0) not null default 0 check (base_salary >= 0),
  overtime_amount numeric(18, 0) not null default 0 check (overtime_amount >= 0),
  bonus_amount numeric(18, 0) not null default 0 check (bonus_amount >= 0),
  allowance_amount numeric(18, 0) not null default 0 check (allowance_amount >= 0),
  employer_costs numeric(18, 0) not null default 0 check (employer_costs >= 0),
  advance_amount numeric(18, 0) not null default 0 check (advance_amount >= 0),
  deductions_amount numeric(18, 0) not null default 0 check (deductions_amount >= 0),
  net_pay numeric(18, 0) not null default 0 check (net_pay >= 0),
  paid_amount numeric(18, 0) not null default 0 check (paid_amount >= 0),
  status text not null default 'unpaid'
    check (status in ('unpaid', 'partial', 'paid')),
  paid_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, employee_id, jalali_year, jalali_month),
  constraint payroll_entries_employee_owner_fk
    foreign key (employee_id, owner_id)
    references public.employees (id, owner_id)
    on delete restrict
);

create index if not exists payroll_entries_owner_period_idx
  on public.payroll_entries (owner_id, jalali_year desc, jalali_month desc);

-- =========================================================
-- 5) Product recipes (BOM) and pricing settings
-- =========================================================
create table if not exists public.costing_settings (
  owner_id uuid primary key default auth.uid()
    references auth.users(id) on delete cascade,
  monthly_fixed_overhead numeric(18, 0) not null default 0 check (monthly_fixed_overhead >= 0),
  overhead_mode text not null default 'actual_current_month'
    check (overhead_mode in ('actual_current_month', 'manual')),
  include_payroll_in_overhead boolean not null default true,
  planned_monthly_output numeric(18, 4) not null default 1 check (planned_monthly_output > 0),
  default_min_margin numeric(7, 3) not null default 10 check (default_min_margin >= 0 and default_min_margin < 95),
  default_cash_margin numeric(7, 3) not null default 30 check (default_cash_margin >= 0 and default_cash_margin < 95),
  default_wholesale_margin numeric(7, 3) not null default 20 check (default_wholesale_margin >= 0 and default_wholesale_margin < 95),
  default_festival_margin numeric(7, 3) not null default 15 check (default_festival_margin >= 0 and default_festival_margin < 95),
  default_credit_monthly_rate numeric(7, 3) not null default 3 check (default_credit_monthly_rate >= 0 and default_credit_monthly_rate <= 100),
  inflation_buffer_percent numeric(7, 3) not null default 10 check (inflation_buffer_percent >= 0 and inflation_buffer_percent <= 300),
  stale_price_days integer not null default 30 check (stale_price_days between 1 and 3650),
  rounding_step numeric(18, 0) not null default 1000 check (rounding_step > 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.costing_products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  name text not null,
  sku text,
  category text not null default 'other'
    check (category in ('pad', 'sheet', 'bag', 'pack', 'strap', 'other')),
  unit text not null default 'عدد',
  direct_labor_per_unit numeric(18, 4) not null default 0 check (direct_labor_per_unit >= 0),
  packaging_per_unit numeric(18, 4) not null default 0 check (packaging_per_unit >= 0),
  other_variable_per_unit numeric(18, 4) not null default 0 check (other_variable_per_unit >= 0),
  overhead_per_unit_override numeric(18, 4)
    check (overhead_per_unit_override is null or overhead_per_unit_override >= 0),
  min_margin numeric(7, 3),
  cash_margin numeric(7, 3),
  wholesale_margin numeric(7, 3),
  festival_margin numeric(7, 3),
  credit_days integer not null default 30 check (credit_days between 0 and 730),
  credit_monthly_rate numeric(7, 3),
  current_cash_price numeric(18, 0) check (current_cash_price is null or current_cash_price >= 0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create unique index if not exists costing_products_owner_name_unique
  on public.costing_products (owner_id, lower(name));

create unique index if not exists costing_products_owner_sku_unique
  on public.costing_products (owner_id, sku)
  where sku is not null;

create table if not exists public.product_materials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  product_id uuid not null,
  material_id uuid not null,
  quantity_per_unit numeric(18, 6) not null check (quantity_per_unit > 0),
  waste_percent numeric(7, 3) not null default 0 check (waste_percent >= 0 and waste_percent <= 500),
  notes text,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, product_id, material_id),
  constraint product_materials_product_owner_fk
    foreign key (product_id, owner_id)
    references public.costing_products (id, owner_id)
    on delete cascade,
  constraint product_materials_material_owner_fk
    foreign key (material_id, owner_id)
    references public.materials (id, owner_id)
    on delete restrict
);

create index if not exists product_materials_owner_product_idx
  on public.product_materials (owner_id, product_id);

create table if not exists public.price_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  product_id uuid not null,
  snapshot_date date not null default current_date,
  historical_cost numeric(18, 0) not null default 0,
  weighted_average_cost numeric(18, 0) not null default 0,
  replacement_cost numeric(18, 0) not null default 0,
  protected_cost numeric(18, 0) not null default 0,
  minimum_safe_price numeric(18, 0) not null default 0,
  cash_price numeric(18, 0) not null default 0,
  wholesale_price numeric(18, 0) not null default 0,
  festival_price numeric(18, 0) not null default 0,
  credit_price numeric(18, 0) not null default 0,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  constraint price_snapshots_product_owner_fk
    foreign key (product_id, owner_id)
    references public.costing_products (id, owner_id)
    on delete cascade
);

create index if not exists price_snapshots_owner_product_date_idx
  on public.price_snapshots (owner_id, product_id, snapshot_date desc, created_at desc);

-- =========================================================
-- 6) Private attachments for purchases and expenses
-- =========================================================
create table if not exists public.accounting_attachments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  entity_type text not null check (entity_type in ('purchase_invoice', 'expense', 'payroll', 'material', 'product')),
  entity_id uuid not null,
  storage_path text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  unique (owner_id, storage_path)
);

create index if not exists accounting_attachments_owner_entity_idx
  on public.accounting_attachments (owner_id, entity_type, entity_id, created_at desc);

-- =========================================================
-- 7) Atomic RPCs for multi-row forms
-- =========================================================
create or replace function public.create_purchase_invoice(
  p_supplier_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_discount_amount numeric,
  p_tax_amount numeric,
  p_shipping_amount numeric,
  p_other_costs numeric,
  p_payment_status text,
  p_payment_method text,
  p_due_date date,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_invoice_id uuid;
  v_subtotal numeric(18,0) := 0;
  v_total numeric(18,0) := 0;
  v_item jsonb;
  v_quantity numeric;
  v_unit_price numeric;
  v_item_discount numeric;
  v_item_tax numeric;
  v_line_total numeric;
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item is required';
  end if;
  if not exists (
    select 1 from public.suppliers s where s.id = p_supplier_id and s.owner_id = v_owner
  ) then raise exception 'Supplier not found'; end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := greatest(0, coalesce((v_item->>'quantity')::numeric, 0));
    v_unit_price := greatest(0, coalesce((v_item->>'unit_price')::numeric, 0));
    v_item_discount := greatest(0, coalesce((v_item->>'discount_amount')::numeric, 0));
    v_item_tax := greatest(0, coalesce((v_item->>'tax_amount')::numeric, 0));
    if v_quantity <= 0 then raise exception 'Invalid quantity'; end if;
    if not exists (
      select 1 from public.materials m
      where m.id = (v_item->>'material_id')::uuid and m.owner_id = v_owner
    ) then raise exception 'Material not found'; end if;
    v_line_total := greatest(0, round(v_quantity * v_unit_price - v_item_discount + v_item_tax));
    v_subtotal := v_subtotal + v_line_total;
  end loop;

  v_total := greatest(
    0,
    v_subtotal
      - greatest(0, coalesce(p_discount_amount, 0))
      + greatest(0, coalesce(p_tax_amount, 0))
      + greatest(0, coalesce(p_shipping_amount, 0))
      + greatest(0, coalesce(p_other_costs, 0))
  );

  insert into public.purchase_invoices (
    owner_id, supplier_id, invoice_number, invoice_date, subtotal,
    discount_amount, tax_amount, shipping_amount, other_costs, total_amount,
    payment_status, payment_method, due_date, notes
  ) values (
    v_owner, p_supplier_id, nullif(trim(p_invoice_number), ''), p_invoice_date, v_subtotal,
    greatest(0, coalesce(p_discount_amount, 0)),
    greatest(0, coalesce(p_tax_amount, 0)),
    greatest(0, coalesce(p_shipping_amount, 0)),
    greatest(0, coalesce(p_other_costs, 0)),
    v_total,
    p_payment_status, p_payment_method, p_due_date, nullif(trim(p_notes), '')
  ) returning id into v_invoice_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_quantity := greatest(0, coalesce((v_item->>'quantity')::numeric, 0));
    v_unit_price := greatest(0, coalesce((v_item->>'unit_price')::numeric, 0));
    v_item_discount := greatest(0, coalesce((v_item->>'discount_amount')::numeric, 0));
    v_item_tax := greatest(0, coalesce((v_item->>'tax_amount')::numeric, 0));
    v_line_total := greatest(0, round(v_quantity * v_unit_price - v_item_discount + v_item_tax));

    insert into public.purchase_invoice_items (
      owner_id, purchase_invoice_id, material_id, description,
      quantity, unit, unit_price, discount_amount, tax_amount, line_total
    ) values (
      v_owner, v_invoice_id, (v_item->>'material_id')::uuid,
      nullif(trim(v_item->>'description'), ''), v_quantity,
      coalesce(nullif(trim(v_item->>'unit'), ''), 'عدد'), v_unit_price,
      v_item_discount, v_item_tax, v_line_total
    );
  end loop;

  return v_invoice_id;
end;
$$;

create or replace function public.create_costing_product(
  p_name text,
  p_sku text,
  p_category text,
  p_unit text,
  p_direct_labor numeric,
  p_packaging numeric,
  p_other_variable numeric,
  p_overhead_override numeric,
  p_min_margin numeric,
  p_cash_margin numeric,
  p_wholesale_margin numeric,
  p_festival_margin numeric,
  p_credit_days integer,
  p_credit_monthly_rate numeric,
  p_current_cash_price numeric,
  p_notes text,
  p_components jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_product_id uuid;
  v_component jsonb;
begin
  if v_owner is null then raise exception 'Not authenticated'; end if;
  if trim(coalesce(p_name, '')) = '' then raise exception 'Product name required'; end if;
  if p_components is null or jsonb_typeof(p_components) <> 'array' or jsonb_array_length(p_components) = 0 then
    raise exception 'At least one component is required';
  end if;

  insert into public.costing_products (
    owner_id, name, sku, category, unit, direct_labor_per_unit,
    packaging_per_unit, other_variable_per_unit, overhead_per_unit_override,
    min_margin, cash_margin, wholesale_margin, festival_margin,
    credit_days, credit_monthly_rate, current_cash_price, notes
  ) values (
    v_owner, trim(p_name), nullif(trim(p_sku), ''), p_category,
    coalesce(nullif(trim(p_unit), ''), 'عدد'),
    greatest(0, coalesce(p_direct_labor, 0)),
    greatest(0, coalesce(p_packaging, 0)),
    greatest(0, coalesce(p_other_variable, 0)),
    case when p_overhead_override is null then null else greatest(0, p_overhead_override) end,
    p_min_margin, p_cash_margin, p_wholesale_margin, p_festival_margin,
    greatest(0, coalesce(p_credit_days, 0)), p_credit_monthly_rate,
    case when p_current_cash_price is null then null else greatest(0, p_current_cash_price) end,
    nullif(trim(p_notes), '')
  ) returning id into v_product_id;

  for v_component in select * from jsonb_array_elements(p_components)
  loop
    if not exists (
      select 1 from public.materials m
      where m.id = (v_component->>'material_id')::uuid and m.owner_id = v_owner
    ) then raise exception 'Material not found'; end if;

    insert into public.product_materials (
      owner_id, product_id, material_id, quantity_per_unit, waste_percent, notes
    ) values (
      v_owner, v_product_id, (v_component->>'material_id')::uuid,
      greatest(0.000001, coalesce((v_component->>'quantity_per_unit')::numeric, 0)),
      greatest(0, coalesce((v_component->>'waste_percent')::numeric, 0)),
      nullif(trim(v_component->>'notes'), '')
    );
  end loop;

  return v_product_id;
end;
$$;

-- =========================================================
-- 8) Material cost summary view
-- =========================================================
create or replace view public.material_cost_summary
with (security_invoker = true)
as
with item_rows as (
  select
    pii.owner_id,
    pii.material_id,
    pii.id as item_id,
    pi.invoice_date,
    pi.created_at,
    pii.quantity,
    pii.line_total,
    pi.discount_amount as invoice_discount,
    pi.tax_amount as invoice_tax,
    pi.shipping_amount,
    pi.other_costs,
    sum(pii.line_total) over (partition by pii.owner_id, pii.purchase_invoice_id) as invoice_items_total
  from public.purchase_invoice_items pii
  join public.purchase_invoices pi
    on pi.id = pii.purchase_invoice_id and pi.owner_id = pii.owner_id
), effective_rows as (
  select
    *,
    greatest(
      0,
      line_total + case
        when invoice_items_total > 0 then
          (line_total / invoice_items_total) *
          (invoice_tax + shipping_amount + other_costs - invoice_discount)
        else 0
      end
    ) as effective_line_cost
  from item_rows
), ranked as (
  select
    *,
    row_number() over (
      partition by owner_id, material_id
      order by invoice_date desc, created_at desc, item_id desc
    ) as rn
  from effective_rows
), aggregated as (
  select
    owner_id,
    material_id,
    round(sum(effective_line_cost) / nullif(sum(quantity), 0), 4) as weighted_avg_unit_cost,
    sum(quantity) as purchased_quantity,
    count(*)::integer as purchase_count,
    max(invoice_date) as latest_purchase_date
  from effective_rows
  group by owner_id, material_id
), latest as (
  select
    owner_id,
    material_id,
    round(effective_line_cost / nullif(quantity, 0), 4) as latest_unit_cost
  from ranked where rn = 1
), previous as (
  select
    owner_id,
    material_id,
    round(effective_line_cost / nullif(quantity, 0), 4) as previous_unit_cost
  from ranked where rn = 2
)
select
  m.id,
  m.owner_id,
  m.name,
  m.code,
  m.category,
  m.unit,
  m.manual_replacement_unit_cost,
  m.replacement_price_at,
  m.minimum_stock,
  m.notes,
  m.is_active,
  m.created_at,
  m.updated_at,
  coalesce(l.latest_unit_cost, 0) as latest_unit_cost,
  coalesce(a.weighted_avg_unit_cost, 0) as weighted_avg_unit_cost,
  coalesce(m.manual_replacement_unit_cost, l.latest_unit_cost, 0) as replacement_unit_cost,
  a.latest_purchase_date,
  coalesce(a.purchased_quantity, 0) as purchased_quantity,
  coalesce(a.purchase_count, 0) as purchase_count,
  p.previous_unit_cost,
  case
    when p.previous_unit_cost is null or p.previous_unit_cost = 0 then null
    else round(((l.latest_unit_cost - p.previous_unit_cost) / p.previous_unit_cost) * 100, 2)
  end as latest_change_percent
from public.materials m
left join aggregated a on a.owner_id = m.owner_id and a.material_id = m.id
left join latest l on l.owner_id = m.owner_id and l.material_id = m.id
left join previous p on p.owner_id = m.owner_id and p.material_id = m.id;

-- =========================================================
-- 9) updated_at triggers
-- =========================================================
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'suppliers', 'materials', 'purchase_invoices', 'workshop_expenses',
    'employees', 'payroll_entries', 'costing_settings', 'costing_products'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_set_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;
end $$;

-- =========================================================
-- 10) RLS and permissions
-- =========================================================
alter table public.suppliers enable row level security;
alter table public.materials enable row level security;
alter table public.purchase_invoices enable row level security;
alter table public.purchase_invoice_items enable row level security;
alter table public.workshop_expenses enable row level security;
alter table public.employees enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.costing_settings enable row level security;
alter table public.costing_products enable row level security;
alter table public.product_materials enable row level security;
alter table public.price_snapshots enable row level security;
alter table public.accounting_attachments enable row level security;

do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'suppliers', 'materials', 'purchase_invoices', 'purchase_invoice_items',
    'workshop_expenses', 'employees', 'payroll_entries', 'costing_settings',
    'costing_products', 'product_materials', 'price_snapshots', 'accounting_attachments'
  ]
  loop
    policy_name := 'Owner manages own ' || table_name;
    execute format('drop policy if exists %I on public.%I', policy_name, table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)',
      policy_name, table_name
    );
    execute format('revoke all on table public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
  end loop;
end $$;

grant select on table public.material_cost_summary to authenticated;
grant execute on function public.create_purchase_invoice(uuid,text,date,numeric,numeric,numeric,numeric,text,text,date,text,jsonb) to authenticated;
grant execute on function public.create_costing_product(text,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,integer,numeric,numeric,text,jsonb) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'accounting-files', 'accounting-files', false, 10485760,
  array['image/png', 'image/jpeg', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Owner reads own accounting files" on storage.objects;
create policy "Owner reads own accounting files"
on storage.objects for select to authenticated
using (
  bucket_id = 'accounting-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Owner uploads own accounting files" on storage.objects;
create policy "Owner uploads own accounting files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'accounting-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Owner updates own accounting files" on storage.objects;
create policy "Owner updates own accounting files"
on storage.objects for update to authenticated
using (
  bucket_id = 'accounting-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'accounting-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Owner deletes own accounting files" on storage.objects;
create policy "Owner deletes own accounting files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'accounting-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'suppliers', 'materials', 'purchase_invoices', 'purchase_invoice_items',
    'workshop_expenses', 'employees', 'payroll_entries', 'costing_settings',
    'costing_products', 'product_materials', 'price_snapshots', 'accounting_attachments'
  )
order by table_name;
