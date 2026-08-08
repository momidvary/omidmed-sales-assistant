-- Product completion: reliable finance, atomic CRM and owner-isolated content studio.
-- This migration is additive. It never replays the historical currency migrations.

begin;

-- ---------------------------------------------------------------------------
-- Search and canonical customer financial context
-- ---------------------------------------------------------------------------

create or replace function public.normalize_search_text(input_text text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(
    translate(
      replace(replace(trim(input_text), 'ي', 'ی'), 'ك', 'ک'),
      '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩',
      '01234567890123456789'
    )
  );
$$;

alter table public.customers
  add column if not exists search_document text generated always as (
    public.normalize_search_text(
      coalesce(name, '') || ' ' ||
      coalesce(contact_name, '') || ' ' ||
      coalesce(phone, '') || ' ' ||
      coalesce(normalized_phone, '') || ' ' ||
      coalesce(province, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(customer_code, '')
    )
  ) stored;

create index if not exists customers_owner_search_document_idx
  on public.customers (owner_id, search_document text_pattern_ops);

create or replace view public.customer_crm_summary
with (security_invoker = true)
as
with valid_invoices as (
  select
    i.owner_id,
    i.customer_id,
    i.invoice_date,
    i.total_amount
  from public.invoices i
  where coalesce(i.holo_is_deleted, false) = false
),
distinct_invoice_dates as (
  select distinct owner_id, customer_id, invoice_date
  from valid_invoices
),
invoice_gaps as (
  select
    owner_id,
    customer_id,
    invoice_date,
    invoice_date - lag(invoice_date) over (
      partition by owner_id, customer_id order by invoice_date
    ) as gap_days
  from distinct_invoice_dates
),
gap_stats as (
  select
    owner_id,
    customer_id,
    round(avg(gap_days)::numeric, 2) as avg_purchase_gap_days
  from invoice_gaps
  where gap_days is not null
  group by owner_id, customer_id
),
invoice_stats as (
  select
    owner_id,
    customer_id,
    max(invoice_date) as last_purchase_at,
    count(*)::integer as purchase_count,
    coalesce(sum(total_amount), 0)::numeric(18, 0) as total_sales
  from valid_invoices
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
  s.last_purchase_at,
  coalesce(s.purchase_count, 0)::integer as purchase_count,
  coalesce(s.total_sales, 0)::numeric(18, 0) as total_sales,
  g.avg_purchase_gap_days,
  case
    when s.last_purchase_at is null then null
    else (now() at time zone 'Asia/Tehran')::date - s.last_purchase_at
  end as days_since_last_purchase,
  c.holo_balance_amount,
  c.holo_balance_status,
  c.holo_balance_is_toman,
  c.holo_last_synced_at,
  c.search_document
from public.customers c
left join invoice_stats s
  on s.owner_id = c.owner_id and s.customer_id = c.id
left join gap_stats g
  on g.owner_id = c.owner_id and g.customer_id = c.id;

revoke all on table public.customer_crm_summary from anon;
grant select on table public.customer_crm_summary to authenticated;

create or replace view public.owner_sales_daily
with (security_invoker = true)
as
select
  owner_id,
  invoice_date,
  count(*)::bigint as invoice_count,
  coalesce(sum(total_amount), 0)::numeric(18, 0) as invoiced_sales_amount
from public.invoices
where coalesce(holo_is_deleted, false) = false
group by owner_id, invoice_date;

revoke all on table public.owner_sales_daily from public, anon;
grant select on table public.owner_sales_daily to authenticated;

-- ---------------------------------------------------------------------------
-- Purchase payments and derived outstanding balance
-- ---------------------------------------------------------------------------

alter table public.purchase_invoices
  add column if not exists opening_paid_amount numeric(18, 0);

alter table public.purchase_invoices
  alter column opening_paid_amount drop not null,
  alter column opening_paid_amount drop default;

update public.purchase_invoices
set opening_paid_amount = total_amount
where payment_status = 'paid'
  and opening_paid_amount is distinct from total_amount;

update public.purchase_invoices
set opening_paid_amount = 0
where payment_status = 'unpaid'
  and opening_paid_amount is null;

update public.purchase_invoices
set opening_paid_amount = null
where payment_status = 'partial'
  and opening_paid_amount = 0;

alter table public.purchase_invoices
  drop constraint if exists purchase_invoices_opening_paid_amount_check;
alter table public.purchase_invoices
  add constraint purchase_invoices_opening_paid_amount_check
  check (opening_paid_amount >= 0 and opening_paid_amount <= total_amount);

create table if not exists public.purchase_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  purchase_invoice_id uuid not null,
  request_id uuid not null,
  payment_date date not null default ((now() at time zone 'Asia/Tehran')::date),
  amount numeric(18, 0) not null check (amount > 0),
  payment_method text not null default 'bank_transfer'
    check (payment_method in ('cash', 'card', 'bank_transfer', 'cheque', 'credit', 'other')),
  reference text check (reference is null or length(reference) <= 200),
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, request_id),
  constraint purchase_payments_invoice_owner_fk
    foreign key (purchase_invoice_id, owner_id)
    references public.purchase_invoices (id, owner_id)
    on delete cascade
);

create index if not exists purchase_payments_owner_invoice_date_idx
  on public.purchase_payments (owner_id, purchase_invoice_id, payment_date desc);

alter table public.purchase_payments enable row level security;

drop policy if exists "Users can view own purchase payments" on public.purchase_payments;
create policy "Users can view own purchase payments"
  on public.purchase_payments for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Users can create own purchase payments" on public.purchase_payments;
create policy "Users can create own purchase payments"
  on public.purchase_payments for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "Users can update own purchase payments" on public.purchase_payments;
drop policy if exists "Users can delete own purchase payments" on public.purchase_payments;

revoke all on table public.purchase_payments from public, anon;
grant select, insert on table public.purchase_payments to authenticated;

create or replace view public.purchase_invoice_balances
with (security_invoker = true)
as
select
  i.*,
  s.name as supplier_name,
  case when i.opening_paid_amount is null then null else
    (i.opening_paid_amount + coalesce(sum(p.amount), 0))::numeric(18, 0)
  end as paid_amount,
  case when i.opening_paid_amount is null then null else
    greatest(
      i.total_amount - i.opening_paid_amount - coalesce(sum(p.amount), 0),
      0
    )::numeric(18, 0)
  end as outstanding_amount,
  case
    when i.opening_paid_amount is null then 'needs_review'
    when i.opening_paid_amount + coalesce(sum(p.amount), 0) >= i.total_amount then 'paid'
    when i.opening_paid_amount + coalesce(sum(p.amount), 0) > 0 then 'partial'
    else 'unpaid'
  end as derived_payment_status
from public.purchase_invoices i
join public.suppliers s
  on s.id = i.supplier_id and s.owner_id = i.owner_id
left join public.purchase_payments p
  on p.owner_id = i.owner_id and p.purchase_invoice_id = i.id
group by i.id, s.name;

revoke all on table public.purchase_invoice_balances from public, anon;
grant select on table public.purchase_invoice_balances to authenticated;

create or replace function public.record_purchase_payment(
  p_purchase_invoice_id uuid,
  p_request_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_payment_method text,
  p_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_invoice public.purchase_invoices%rowtype;
  v_payment_id uuid;
  v_paid numeric;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_request_id is null or p_amount is null or p_amount <= 0 then
    raise exception using errcode = '22023', message = 'Invalid payment';
  end if;

  select * into v_invoice
  from public.purchase_invoices
  where id = p_purchase_invoice_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Purchase invoice not found';
  end if;
  if v_invoice.opening_paid_amount is null then
    raise exception using errcode = '22023', message = 'Opening payment requires review';
  end if;

  select id into v_payment_id
  from public.purchase_payments
  where owner_id = v_owner_id and request_id = p_request_id;
  if found then
    return v_payment_id;
  end if;

  select v_invoice.opening_paid_amount + coalesce(sum(amount), 0)
  into v_paid
  from public.purchase_payments
  where owner_id = v_owner_id and purchase_invoice_id = p_purchase_invoice_id;

  if v_paid + p_amount > v_invoice.total_amount then
    raise exception using errcode = '23514', message = 'Payment exceeds outstanding balance';
  end if;

  insert into public.purchase_payments (
    owner_id, purchase_invoice_id, request_id, payment_date,
    amount, payment_method, reference, notes
  ) values (
    v_owner_id, p_purchase_invoice_id, p_request_id,
    coalesce(p_payment_date, (now() at time zone 'Asia/Tehran')::date),
    p_amount, p_payment_method, nullif(trim(p_reference), ''), nullif(trim(p_notes), '')
  ) returning id into v_payment_id;

  update public.purchase_invoices
  set payment_status = case
    when v_paid + p_amount >= total_amount then 'paid'
    else 'partial'
  end
  where id = p_purchase_invoice_id and owner_id = v_owner_id;

  return v_payment_id;
end;
$$;

revoke all on function public.record_purchase_payment(uuid,uuid,numeric,date,text,text,text)
  from public, anon;
grant execute on function public.record_purchase_payment(uuid,uuid,numeric,date,text,text,text)
  to authenticated;

create or replace function public.set_purchase_opening_paid_amount(
  p_purchase_invoice_id uuid,
  p_opening_paid_amount numeric
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_total numeric;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select total_amount into v_total
  from public.purchase_invoices
  where id = p_purchase_invoice_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Purchase invoice not found';
  end if;
  if p_opening_paid_amount is null
     or p_opening_paid_amount <= 0
     or p_opening_paid_amount > v_total then
    raise exception using errcode = '23514', message = 'Invalid opening payment';
  end if;
  update public.purchase_invoices
  set opening_paid_amount = p_opening_paid_amount,
      payment_status = case
        when p_opening_paid_amount >= total_amount then 'paid'
        else 'partial'
      end
  where id = p_purchase_invoice_id and owner_id = v_owner_id;
  return true;
end;
$$;

revoke all on function public.set_purchase_opening_paid_amount(uuid,numeric)
  from public, anon;
grant execute on function public.set_purchase_opening_paid_amount(uuid,numeric)
  to authenticated;

create or replace function public.create_purchase_invoice_v2(
  p_supplier_id uuid,
  p_invoice_number text,
  p_invoice_date date,
  p_discount_amount numeric,
  p_tax_amount numeric,
  p_shipping_amount numeric,
  p_other_costs numeric,
  p_payment_method text,
  p_due_date date,
  p_notes text,
  p_items jsonb,
  p_opening_paid_amount numeric default 0
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invoice_id uuid;
  v_total numeric;
begin
  v_invoice_id := public.create_purchase_invoice(
    p_supplier_id,
    p_invoice_number,
    p_invoice_date,
    p_discount_amount,
    p_tax_amount,
    p_shipping_amount,
    p_other_costs,
    case when coalesce(p_opening_paid_amount, 0) > 0 then 'partial' else 'unpaid' end,
    p_payment_method,
    p_due_date,
    p_notes,
    p_items
  );

  select total_amount into v_total
  from public.purchase_invoices
  where id = v_invoice_id and owner_id = auth.uid()
  for update;

  if coalesce(p_opening_paid_amount, 0) < 0
     or coalesce(p_opening_paid_amount, 0) > v_total then
    raise exception using errcode = '23514', message = 'Invalid opening payment';
  end if;

  update public.purchase_invoices
  set
    opening_paid_amount = coalesce(p_opening_paid_amount, 0),
    payment_status = case
      when coalesce(p_opening_paid_amount, 0) >= total_amount then 'paid'
      when coalesce(p_opening_paid_amount, 0) > 0 then 'partial'
      else 'unpaid'
    end
  where id = v_invoice_id and owner_id = auth.uid();

  return v_invoice_id;
end;
$$;

revoke all on function public.create_purchase_invoice_v2(uuid,text,date,numeric,numeric,numeric,numeric,text,date,text,jsonb,numeric)
  from public, anon;
grant execute on function public.create_purchase_invoice_v2(uuid,text,date,numeric,numeric,numeric,numeric,text,date,text,jsonb,numeric)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Payroll totals: advance is a payment, not a reduction of labor cost.
-- ---------------------------------------------------------------------------

-- `net_pay` is repaired only where the stored value is recognisably machine
-- generated: either the untouched 0 default, or exactly what the previous
-- advance-deducting formula produced. A figure the user entered by hand (a
-- negotiated settlement, for example) is never overwritten, because this
-- migration cannot tell a stale value from a deliberate one.
update public.payroll_entries
set net_pay = greatest(
      base_salary + overtime_amount + bonus_amount + allowance_amount - deductions_amount,
      0
    )
where net_pay is distinct from greatest(
        base_salary + overtime_amount + bonus_amount + allowance_amount - deductions_amount,
        0
      )
  and (
    net_pay = 0
    or net_pay = greatest(
         greatest(
           base_salary + overtime_amount + bonus_amount + allowance_amount - deductions_amount,
           0
         ) - advance_amount,
         0
       )
  );

-- `status` carries no manual meaning: it is a pure function of net_pay,
-- paid_amount and advance_amount, so it is recomputed wherever it disagrees.
update public.payroll_entries
set status = case
    when paid_amount + advance_amount >= net_pay then 'paid'
    when paid_amount + advance_amount > 0 then 'partial'
    else 'unpaid'
  end
where status is distinct from case
    when paid_amount + advance_amount >= net_pay then 'paid'
    when paid_amount + advance_amount > 0 then 'partial'
    else 'unpaid'
  end;

create or replace view public.payroll_entry_totals
with (security_invoker = true)
as
select
  p.*,
  (p.base_salary + p.overtime_amount + p.bonus_amount + p.allowance_amount)::numeric(18, 0)
    as gross_pay,
  greatest(
    p.base_salary + p.overtime_amount + p.bonus_amount + p.allowance_amount - p.deductions_amount,
    0
  )::numeric(18, 0) as calculated_net_pay,
  least(
    p.paid_amount + p.advance_amount,
    greatest(
      p.base_salary + p.overtime_amount + p.bonus_amount + p.allowance_amount - p.deductions_amount,
      0
    )
  )::numeric(18, 0) as total_paid_amount,
  greatest(
    p.base_salary + p.overtime_amount + p.bonus_amount + p.allowance_amount
      - p.deductions_amount - p.paid_amount - p.advance_amount,
    0
  )::numeric(18, 0) as remaining_amount,
  (p.base_salary + p.overtime_amount + p.bonus_amount + p.allowance_amount + p.employer_costs)::numeric(18, 0)
    as labor_cost
from public.payroll_entries p;

revoke all on table public.payroll_entry_totals from public, anon;
grant select on table public.payroll_entry_totals to authenticated;

-- ---------------------------------------------------------------------------
-- SMS idempotency and transactional CRM bookkeeping
-- ---------------------------------------------------------------------------

alter table public.sms_send_batches
  add column if not exists client_request_id uuid,
  add column if not exists provider_result_unknown_at timestamptz,
  add column if not exists unknown_count integer not null default 0 check (unknown_count >= 0),
  add column if not exists unattempted_count integer not null default 0 check (unattempted_count >= 0);

alter table public.sms_send_batches
  drop constraint if exists sms_send_batches_status_check;
alter table public.sms_send_batches
  add constraint sms_send_batches_status_check
  check (status in ('processing', 'completed', 'partial', 'failed', 'unknown'));

create unique index if not exists sms_batches_owner_client_request_unique
  on public.sms_send_batches (owner_id, client_request_id)
  where client_request_id is not null;

alter table public.sms_messages
  add column if not exists client_request_id uuid,
  add column if not exists provider_result_unknown_at timestamptz,
  add column if not exists crm_recorded_at timestamptz;

create unique index if not exists sms_messages_owner_client_request_unique
  on public.sms_messages (owner_id, client_request_id)
  where client_request_id is not null;

create or replace function public.record_sms_crm_outcome(
  p_sms_message_id uuid,
  p_next_followup_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_message public.sms_messages%rowtype;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select * into v_message
  from public.sms_messages
  where id = p_sms_message_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SMS message not found';
  end if;
  if not v_message.request_success then
    raise exception using errcode = '22023', message = 'SMS was not accepted';
  end if;
  if v_message.crm_recorded_at is not null then
    return false;
  end if;

  if v_message.customer_id is not null then
    insert into public.followups (
      owner_id, customer_id, channel, outcome, notes, next_followup_at,
      campaign_id, campaign_member_id, opportunity_id
    ) values (
      v_owner_id, v_message.customer_id, 'sms', 'follow_up_later',
      'SMS accepted by provider', p_next_followup_at,
      v_message.campaign_id, v_message.campaign_member_id, v_message.opportunity_id
    );
    update public.customers
    set next_followup_at = p_next_followup_at
    where id = v_message.customer_id and owner_id = v_owner_id;
  end if;
  if v_message.campaign_member_id is not null then
    update public.campaign_members
    set status = 'contacted', contacted_at = now(), next_followup_at = p_next_followup_at
    where id = v_message.campaign_member_id and owner_id = v_owner_id;
  end if;
  if v_message.opportunity_id is not null then
    update public.sales_opportunities
    set last_contact_at = now(), next_followup_at = p_next_followup_at
    where id = v_message.opportunity_id and owner_id = v_owner_id;
  end if;
  update public.sms_messages set crm_recorded_at = now()
  where id = v_message.id and owner_id = v_owner_id;
  return true;
end;
$$;

revoke all on function public.record_sms_crm_outcome(uuid,timestamptz)
  from public, anon;
grant execute on function public.record_sms_crm_outcome(uuid,timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Idempotent, transaction-safe CRM mutations
-- ---------------------------------------------------------------------------

create table if not exists public.crm_mutation_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  request_id uuid not null,
  mutation_type text not null,
  entity_id uuid not null,
  result jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, request_id)
);

alter table public.crm_mutation_requests enable row level security;
revoke all on table public.crm_mutation_requests from public, anon, authenticated;

create or replace function public.record_customer_followup(
  p_request_id uuid,
  p_customer_id uuid,
  p_channel text,
  p_outcome text,
  p_notes text default null,
  p_next_followup_at timestamptz default null,
  p_potential_value numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_followup_id uuid;
  v_result jsonb;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Request id required';
  end if;

  insert into public.crm_mutation_requests (owner_id, request_id, mutation_type, entity_id)
  values (v_owner_id, p_request_id, 'customer_followup', p_customer_id)
  on conflict (owner_id, request_id) do nothing;

  if not found then
    select result into v_result
    from public.crm_mutation_requests
    where owner_id = v_owner_id and request_id = p_request_id
    for update;
    return v_result;
  end if;

  perform 1
  from public.customers
  where id = p_customer_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Customer not found';
  end if;

  insert into public.followups (
    owner_id, customer_id, channel, outcome, notes,
    next_followup_at, potential_value
  ) values (
    v_owner_id, p_customer_id, p_channel, p_outcome,
    nullif(trim(p_notes), ''), p_next_followup_at, p_potential_value
  ) returning id into v_followup_id;

  update public.customers
  set
    next_followup_at = p_next_followup_at,
    status = case
      when p_outcome = 'order_placed' then 'active'
      when p_outcome = 'lost' then 'lost'
      else status
    end,
    lead_stage = case
      when p_outcome = 'order_placed' then 'converted'
      when p_outcome = 'lost' then 'lost'
      when p_outcome = 'requested_price' then 'quoted'
      when p_channel = 'phone' and status = 'prospect' then 'contacted'
      else lead_stage
    end
  where id = p_customer_id and owner_id = v_owner_id;

  v_result := jsonb_build_object(
    'followup_id', v_followup_id,
    'customer_id', p_customer_id,
    'outcome', p_outcome
  );
  update public.crm_mutation_requests
  set result = v_result, completed_at = now()
  where owner_id = v_owner_id and request_id = p_request_id;
  return v_result;
exception when others then
  raise;
end;
$$;

revoke all on function public.record_customer_followup(uuid,uuid,text,text,text,timestamptz,numeric)
  from public, anon;
grant execute on function public.record_customer_followup(uuid,uuid,text,text,text,timestamptz,numeric)
  to authenticated;

create or replace function public.transition_crm_prospect(
  p_request_id uuid,
  p_customer_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_customer public.customers%rowtype;
  v_stage text;
  v_status text;
  v_outcome text;
  v_next timestamptz;
  v_result jsonb;
  v_followup_id uuid;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_request_id is null or p_action not in ('next', 'lost') then
    raise exception using errcode = '22023', message = 'Invalid prospect transition';
  end if;
  insert into public.crm_mutation_requests (owner_id, request_id, mutation_type, entity_id)
  values (v_owner_id, p_request_id, 'prospect_transition', p_customer_id)
  on conflict (owner_id, request_id) do nothing;
  if not found then
    select result into v_result from public.crm_mutation_requests
    where owner_id = v_owner_id and request_id = p_request_id
    for update;
    return v_result;
  end if;

  select * into v_customer from public.customers
  where id = p_customer_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Customer not found';
  end if;

  if p_action = 'lost' then
    v_stage := 'lost';
    v_status := 'lost';
    v_outcome := 'lost';
    v_next := null;
  else
    v_stage := case coalesce(v_customer.lead_stage, 'new')
      when 'new' then 'contacted'
      when 'contacted' then 'interested'
      when 'interested' then 'quoted'
      when 'quoted' then 'decision'
      else 'converted'
    end;
    v_status := case when v_stage = 'converted' then 'active' else 'prospect' end;
    v_outcome := case
      when v_stage = 'quoted' then 'requested_price'
      when v_stage = 'converted' then 'order_placed'
      else 'follow_up_later'
    end;
    v_next := case when v_stage = 'converted' then null else (
      ((now() at time zone 'Asia/Tehran')::date +
        case when v_stage in ('quoted', 'decision') then 1 else 3 end) + time '10:00'
    ) at time zone 'Asia/Tehran' end;
  end if;

  insert into public.followups (
    owner_id, customer_id, channel, outcome, notes, next_followup_at, potential_value
  ) values (
    v_owner_id, p_customer_id, 'phone', v_outcome,
    'CRM prospect stage transition', v_next, v_customer.potential_value
  ) returning id into v_followup_id;

  update public.customers set status = v_status, lead_stage = v_stage, next_followup_at = v_next
  where id = p_customer_id and owner_id = v_owner_id;

  v_result := jsonb_build_object(
    'customer_id', p_customer_id,
    'followup_id', v_followup_id,
    'stage', v_stage,
    'accounting_invoice_created', false
  );
  update public.crm_mutation_requests set result = v_result, completed_at = now()
  where owner_id = v_owner_id and request_id = p_request_id;
  return v_result;
end;
$$;

revoke all on function public.transition_crm_prospect(uuid,uuid,text) from public, anon;
grant execute on function public.transition_crm_prospect(uuid,uuid,text) to authenticated;

create or replace function public.transition_sales_opportunity(
  p_request_id uuid,
  p_opportunity_id uuid,
  p_action text,
  p_value numeric default null,
  p_lost_reason text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_opportunity public.sales_opportunities%rowtype;
  v_status text;
  v_stage text;
  v_outcome text;
  v_member_status text;
  v_next timestamptz;
  v_value numeric;
  v_followup_id uuid;
  v_result jsonb;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_request_id is null or p_action not in ('contacted', 'no_answer', 'next', 'won', 'lost', 'hold') then
    raise exception using errcode = '22023', message = 'Invalid opportunity transition';
  end if;

  insert into public.crm_mutation_requests (owner_id, request_id, mutation_type, entity_id)
  values (v_owner_id, p_request_id, 'opportunity_transition', p_opportunity_id)
  on conflict (owner_id, request_id) do nothing;
  if not found then
    select result into v_result from public.crm_mutation_requests
    where owner_id = v_owner_id and request_id = p_request_id
    for update;
    return v_result;
  end if;

  select * into v_opportunity
  from public.sales_opportunities
  where id = p_opportunity_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Opportunity not found';
  end if;

  v_value := coalesce(nullif(p_value, 0), v_opportunity.estimated_value);
  v_status := v_opportunity.status;
  v_stage := v_opportunity.stage;
  v_outcome := 'follow_up_later';
  v_member_status := 'follow_up';
  v_next := null;

  if p_action in ('contacted', 'no_answer', 'next') then
    v_status := 'open';
    v_stage := case v_opportunity.stage
      when 'quote_sent' then 'followup_1'
      when 'followup_1' then 'followup_2'
      else 'final_followup'
    end;
    v_next := (
      ((now() at time zone 'Asia/Tehran')::date +
        case when p_action = 'no_answer' then 1 else 3 end) + time '10:00'
    ) at time zone 'Asia/Tehran';
    if p_action = 'no_answer' then
      v_outcome := 'no_answer';
      v_member_status := 'no_answer';
    end if;
  elsif p_action = 'won' then
    v_status := 'won';
    v_outcome := 'order_placed';
    v_member_status := 'ordered';
  elsif p_action = 'lost' then
    v_status := 'lost';
    v_outcome := 'lost';
    v_member_status := 'lost';
  else
    v_status := 'on_hold';
    v_outcome := 'no_need';
    v_member_status := 'no_need';
    v_next := (
      ((now() at time zone 'Asia/Tehran')::date + 30) + time '10:00'
    ) at time zone 'Asia/Tehran';
  end if;

  update public.sales_opportunities
  set
    status = v_status,
    stage = v_stage,
    last_contact_at = now(),
    next_followup_at = v_next,
    estimated_value = v_value,
    final_value = case when p_action = 'won' then v_value else null end,
    lost_reason = case when p_action = 'lost' then coalesce(nullif(p_lost_reason, ''), 'other') else null end,
    notes = coalesce(nullif(trim(p_notes), ''), notes)
  where id = p_opportunity_id and owner_id = v_owner_id;

  insert into public.followups (
    owner_id, customer_id, channel, outcome, notes, next_followup_at,
    potential_value, campaign_id, campaign_member_id, opportunity_id
  ) values (
    v_owner_id, v_opportunity.customer_id, 'phone', v_outcome,
    coalesce(nullif(trim(p_notes), ''), 'CRM opportunity transition'),
    v_next, v_value, v_opportunity.campaign_id,
    v_opportunity.campaign_member_id, v_opportunity.id
  ) returning id into v_followup_id;

  if v_opportunity.campaign_member_id is not null then
    update public.campaign_members
    set
      status = v_member_status,
      contacted_at = now(),
      responded_at = case when p_action = 'no_answer' then null else now() end,
      ordered_at = case when p_action = 'won' then now() else null end,
      next_followup_at = v_next,
      order_value = case when p_action = 'won' then v_value else null end,
      lost_reason = case when p_action = 'lost' then coalesce(nullif(p_lost_reason, ''), 'other') else null end,
      notes = coalesce(nullif(trim(p_notes), ''), notes)
    where id = v_opportunity.campaign_member_id and owner_id = v_owner_id;
  end if;

  update public.customers
  set
    next_followup_at = v_next,
    status = case
      when p_action = 'won' then 'active'
      when p_action = 'lost' then 'lost'
      else status
    end,
    lead_stage = case
      when p_action = 'won' then 'converted'
      when p_action = 'lost' then 'lost'
      when p_action in ('contacted', 'next') then 'decision'
      else lead_stage
    end
  where id = v_opportunity.customer_id and owner_id = v_owner_id;

  v_result := jsonb_build_object(
    'opportunity_id', v_opportunity.id,
    'customer_id', v_opportunity.customer_id,
    'followup_id', v_followup_id,
    'status', v_status,
    'accounting_invoice_created', false
  );
  update public.crm_mutation_requests
  set result = v_result, completed_at = now()
  where owner_id = v_owner_id and request_id = p_request_id;
  return v_result;
end;
$$;

revoke all on function public.transition_sales_opportunity(uuid,uuid,text,numeric,text,text)
  from public, anon;
grant execute on function public.transition_sales_opportunity(uuid,uuid,text,numeric,text,text)
  to authenticated;

create or replace function public.record_campaign_member_result(
  p_request_id uuid,
  p_campaign_id uuid,
  p_member_id uuid,
  p_outcome text,
  p_order_value numeric default null,
  p_lost_reason text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_member public.campaign_members%rowtype;
  v_opportunity public.sales_opportunities%rowtype;
  v_opportunity_id uuid;
  v_followup_id uuid;
  v_target_product text;
  v_now timestamptz := now();
  v_next timestamptz;
  v_followup_outcome text;
  v_value numeric := greatest(coalesce(p_order_value, 0), 0);
  v_result jsonb;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_request_id is null or p_outcome not in (
    'contacted', 'requested_price', 'ordered', 'no_answer',
    'no_need', 'follow_up', 'lost'
  ) then
    raise exception using errcode = '22023', message = 'Invalid campaign result';
  end if;

  insert into public.crm_mutation_requests (
    owner_id, request_id, mutation_type, entity_id
  ) values (
    v_owner_id, p_request_id, 'campaign_member_result', p_member_id
  ) on conflict (owner_id, request_id) do nothing;
  if not found then
    select result into v_result
    from public.crm_mutation_requests
    where owner_id = v_owner_id and request_id = p_request_id
    for update;
    return v_result;
  end if;

  select cm.*
    into v_member
  from public.campaign_members cm
  join public.campaigns c
    on c.id = cm.campaign_id and c.owner_id = cm.owner_id
  where cm.id = p_member_id
    and cm.campaign_id = p_campaign_id
    and cm.owner_id = v_owner_id
  for update of cm;
  if not found then
    raise exception using errcode = 'P0002', message = 'Campaign member not found';
  end if;

  select target_product into v_target_product
  from public.campaigns
  where id = p_campaign_id and owner_id = v_owner_id;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner_id::text || ':' || v_member.customer_id::text, 0)
  );

  v_next := case
    when p_outcome in ('no_answer', 'requested_price') then
      (((v_now at time zone 'Asia/Tehran')::date + 1) + time '10:00') at time zone 'Asia/Tehran'
    when p_outcome in ('contacted', 'follow_up') then
      (((v_now at time zone 'Asia/Tehran')::date + 3) + time '10:00') at time zone 'Asia/Tehran'
    when p_outcome = 'no_need' then
      (((v_now at time zone 'Asia/Tehran')::date + 30) + time '10:00') at time zone 'Asia/Tehran'
    else null
  end;
  v_followup_outcome := case p_outcome
    when 'requested_price' then 'requested_price'
    when 'ordered' then 'order_placed'
    when 'no_answer' then 'no_answer'
    when 'no_need' then 'no_need'
    when 'lost' then 'lost'
    else 'follow_up_later'
  end;

  select * into v_opportunity
  from public.sales_opportunities
  where owner_id = v_owner_id
    and customer_id = v_member.customer_id
    and status in ('open', 'on_hold')
  order by updated_at desc
  limit 1
  for update;

  if p_outcome = 'requested_price' then
    if v_opportunity.id is null then
      insert into public.sales_opportunities (
        owner_id, customer_id, campaign_id, campaign_member_id,
        status, stage, source, product_interest, quoted_at,
        last_contact_at, next_followup_at, estimated_value, notes
      ) values (
        v_owner_id, v_member.customer_id, p_campaign_id, p_member_id,
        'open', 'quote_sent', 'campaign', v_target_product, v_now,
        v_now, v_next, nullif(v_value, 0), nullif(trim(p_notes), '')
      ) returning id into v_opportunity_id;
    else
      v_opportunity_id := v_opportunity.id;
      update public.sales_opportunities
      set campaign_id = p_campaign_id,
          campaign_member_id = p_member_id,
          status = 'open',
          stage = 'quote_sent',
          product_interest = coalesce(v_target_product, product_interest),
          quoted_at = v_now,
          last_contact_at = v_now,
          next_followup_at = v_next,
          estimated_value = coalesce(nullif(v_value, 0), estimated_value),
          lost_reason = null,
          notes = coalesce(nullif(trim(p_notes), ''), notes)
      where id = v_opportunity.id and owner_id = v_owner_id;
    end if;
  elsif p_outcome = 'ordered' then
    if v_opportunity.id is null then
      insert into public.sales_opportunities (
        owner_id, customer_id, campaign_id, campaign_member_id,
        status, stage, source, product_interest, quoted_at,
        last_contact_at, final_value, notes
      ) values (
        v_owner_id, v_member.customer_id, p_campaign_id, p_member_id,
        'won', 'final_followup', 'campaign', v_target_product, v_now,
        v_now, nullif(v_value, 0), nullif(trim(p_notes), '')
      ) returning id into v_opportunity_id;
    else
      v_opportunity_id := v_opportunity.id;
      update public.sales_opportunities
      set status = 'won', last_contact_at = v_now, next_followup_at = null,
          final_value = coalesce(nullif(v_value, 0), estimated_value),
          lost_reason = null,
          notes = coalesce(nullif(trim(p_notes), ''), notes)
      where id = v_opportunity.id and owner_id = v_owner_id;
    end if;
  elsif v_opportunity.id is not null then
    v_opportunity_id := v_opportunity.id;
    update public.sales_opportunities
    set status = case
          when p_outcome = 'lost' then 'lost'
          when p_outcome = 'no_need' then 'on_hold'
          else 'open'
        end,
        last_contact_at = v_now,
        next_followup_at = v_next,
        lost_reason = case when p_outcome = 'lost'
          then coalesce(nullif(p_lost_reason, ''), 'other') else null end,
        notes = coalesce(nullif(trim(p_notes), ''), notes)
    where id = v_opportunity.id and owner_id = v_owner_id;
  end if;

  insert into public.followups (
    owner_id, customer_id, channel, outcome, notes, next_followup_at,
    potential_value, campaign_id, campaign_member_id, opportunity_id
  ) values (
    v_owner_id, v_member.customer_id, 'phone', v_followup_outcome,
    coalesce(nullif(trim(p_notes), ''), 'Campaign result recorded'),
    v_next, nullif(v_value, 0), p_campaign_id, p_member_id, v_opportunity_id
  ) returning id into v_followup_id;

  update public.campaign_members
  set status = p_outcome,
      contacted_at = v_now,
      responded_at = case when p_outcome in (
        'requested_price', 'ordered', 'no_need', 'follow_up', 'lost'
      ) then v_now else null end,
      ordered_at = case when p_outcome = 'ordered' then v_now else null end,
      next_followup_at = v_next,
      order_value = case when p_outcome = 'ordered' then nullif(v_value, 0) else null end,
      lost_reason = case when p_outcome = 'lost'
        then coalesce(nullif(p_lost_reason, ''), 'other') else null end,
      notes = coalesce(nullif(trim(p_notes), ''), notes)
  where id = p_member_id and owner_id = v_owner_id;

  update public.customers
  set next_followup_at = v_next,
      status = case
        when p_outcome = 'ordered' then 'active'
        when p_outcome = 'lost' then 'lost'
        else status
      end,
      lead_stage = case
        when p_outcome = 'ordered' then 'converted'
        when p_outcome = 'lost' then 'lost'
        when p_outcome = 'requested_price' then 'quoted'
        else lead_stage
      end
  where id = v_member.customer_id and owner_id = v_owner_id;

  v_result := jsonb_build_object(
    'campaign_member_id', p_member_id,
    'customer_id', v_member.customer_id,
    'opportunity_id', v_opportunity_id,
    'followup_id', v_followup_id,
    'outcome', p_outcome,
    'accounting_invoice_created', false
  );
  update public.crm_mutation_requests
  set result = v_result, completed_at = now()
  where owner_id = v_owner_id and request_id = p_request_id;
  return v_result;
end;
$$;

revoke all on function public.record_campaign_member_result(uuid,uuid,uuid,text,numeric,text,text)
  from public, anon;
grant execute on function public.record_campaign_member_result(uuid,uuid,uuid,text,numeric,text,text)
  to authenticated;

create or replace function public.create_campaign_with_members(
  p_request_id uuid,
  p_campaign jsonb,
  p_customer_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_campaign_id uuid;
  v_customer_ids uuid[];
  v_name text := trim(coalesce(p_campaign ->> 'name', ''));
  v_campaign_type text := coalesce(p_campaign ->> 'campaign_type', 'reactivation');
  v_channel text := coalesce(p_campaign ->> 'channel', 'phone');
  v_priority text := coalesce(p_campaign ->> 'priority_filter', 'all');
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select (result ->> 'campaign_id')::uuid into v_campaign_id
  from public.crm_mutation_requests
  where owner_id = v_owner_id and request_id = p_request_id
    and mutation_type = 'create_campaign';
  if v_campaign_id is not null then return v_campaign_id; end if;

  select coalesce(array_agg(distinct customer_id), '{}'::uuid[])
  into v_customer_ids
  from unnest(coalesce(p_customer_ids, '{}'::uuid[])) as customer_id;
  if length(v_name) not between 1 and 140
     or v_campaign_type not in ('reactivation', 'product', 'price_followup', 'seasonal', 'custom')
     or v_channel not in ('phone', 'sms', 'whatsapp', 'mixed')
     or v_priority not in ('all', 'urgent', 'vip', 'high', 'normal', 'low')
     or cardinality(v_customer_ids) = 0
     or exists (
       select 1 from unnest(v_customer_ids) as requested(customer_id)
       where not exists (
         select 1 from public.customers c
         where c.id = requested.customer_id and c.owner_id = v_owner_id
       )
     ) then
    raise exception using errcode = '22023', message = 'Invalid campaign request';
  end if;

  insert into public.campaigns (
    owner_id, name, campaign_type, channel, status, target_product,
    target_city, min_days_inactive, priority_filter, message_template,
    notes, filters, started_at
  ) values (
    v_owner_id, v_name, v_campaign_type, v_channel, 'active',
    nullif(trim(p_campaign ->> 'target_product'), ''),
    nullif(trim(p_campaign ->> 'target_city'), ''),
    greatest(0, least(3650, coalesce((p_campaign ->> 'min_days_inactive')::integer, 0))),
    v_priority,
    nullif(left(p_campaign ->> 'message_template', 3000), ''),
    nullif(left(p_campaign ->> 'notes', 1500), ''),
    coalesce(p_campaign -> 'filters', '{}'::jsonb), now()
  ) returning id into v_campaign_id;

  insert into public.campaign_members (owner_id, campaign_id, customer_id, status)
  select v_owner_id, v_campaign_id, customer_id, 'pending'
  from unnest(v_customer_ids) as customer_id;

  insert into public.crm_mutation_requests (
    owner_id, request_id, mutation_type, entity_id, result, completed_at
  ) values (
    v_owner_id, p_request_id, 'create_campaign', v_campaign_id,
    jsonb_build_object('campaign_id', v_campaign_id), now()
  );
  return v_campaign_id;
exception
  when unique_violation then
    select (result ->> 'campaign_id')::uuid into v_campaign_id
    from public.crm_mutation_requests
    where owner_id = v_owner_id and request_id = p_request_id
      and mutation_type = 'create_campaign';
    if v_campaign_id is not null then return v_campaign_id; end if;
    raise;
end;
$$;

revoke all on function public.create_campaign_with_members(uuid,jsonb,uuid[])
  from public, anon;
grant execute on function public.create_campaign_with_members(uuid,jsonb,uuid[])
  to authenticated;

-- ---------------------------------------------------------------------------
-- Product-grounded, persistent content studio
-- ---------------------------------------------------------------------------

alter table public.costing_products
  add column if not exists brand text,
  add column if not exists model text,
  add column if not exists technical_specifications jsonb not null default '{}'::jsonb,
  add column if not exists applications text[] not null default '{}',
  add column if not exists target_specialties text[] not null default '{}',
  add column if not exists advantages text[] not null default '{}',
  add column if not exists differentiators text[] not null default '{}',
  add column if not exists inventory_status text not null default 'unknown',
  add column if not exists warranty text,
  add column if not exists after_sales_service text,
  add column if not exists training text,
  add column if not exists approved_marketing_claims text[] not null default '{}',
  add column if not exists brochure_url text,
  add column if not exists primary_image_path text;

alter table public.costing_products
  drop constraint if exists costing_products_technical_specifications_check;
alter table public.costing_products
  add constraint costing_products_technical_specifications_check
  check (jsonb_typeof(technical_specifications) = 'object');

alter table public.costing_products
  drop constraint if exists costing_products_inventory_status_check;
alter table public.costing_products
  add constraint costing_products_inventory_status_check
  check (inventory_status in ('unknown', 'in_stock', 'low_stock', 'out_of_stock', 'made_to_order'));

create table if not exists public.brand_profiles (
  owner_id uuid primary key default auth.uid()
    references auth.users(id) on delete cascade,
  company_name text not null default 'امیدمِد',
  logo_path text,
  tone text not null default 'professional',
  colors text[] not null default array['#172554', '#0f766e'],
  persian_style text,
  phone text,
  website text,
  instagram text,
  cta_style text,
  forbidden_phrases text[] not null default '{}',
  disclaimers text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.product_content_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  product_id uuid not null,
  storage_path text not null,
  asset_type text not null check (asset_type in ('product_image', 'brochure', 'manual')),
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 15728640),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, storage_path),
  constraint product_content_assets_product_owner_fk
    foreign key (product_id, owner_id)
    references public.costing_products (id, owner_id)
    on delete cascade
);

create unique index if not exists product_content_assets_one_primary_idx
  on public.product_content_assets (owner_id, product_id)
  where is_primary;

create or replace function public.set_product_primary_asset(
  p_product_id uuid,
  p_storage_path text,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_asset_id uuid;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_mime_type not in ('image/png', 'image/jpeg')
     or p_size_bytes not between 1 and 15728640
     or length(coalesce(p_original_name, '')) not between 1 and 180
     or length(coalesce(p_storage_path, '')) not between 1 and 500
     or p_storage_path not like
       v_owner_id::text || '/products/' || p_product_id::text || '/%' then
    raise exception using errcode = '22023', message = 'Invalid product asset';
  end if;

  perform 1
  from public.costing_products
  where id = p_product_id and owner_id = v_owner_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Product not found';
  end if;

  update public.product_content_assets
  set is_primary = false
  where owner_id = v_owner_id and product_id = p_product_id and is_primary;

  insert into public.product_content_assets (
    owner_id, product_id, storage_path, asset_type, original_name,
    mime_type, size_bytes, is_primary
  ) values (
    v_owner_id, p_product_id, p_storage_path, 'product_image',
    p_original_name, p_mime_type, p_size_bytes, true
  )
  returning id into v_asset_id;

  update public.costing_products
  set primary_image_path = p_storage_path
  where id = p_product_id and owner_id = v_owner_id;

  return v_asset_id;
end;
$$;

revoke all on function public.set_product_primary_asset(uuid,text,text,text,bigint)
  from public, anon;
grant execute on function public.set_product_primary_asset(uuid,text,text,text,bigint)
  to authenticated;

alter table public.content_items
  add column if not exists customer_id uuid,
  add column if not exists product_id uuid,
  add column if not exists campaign_id uuid,
  add column if not exists content_type text not null default 'product_introduction',
  add column if not exists goal text not null default 'product_introduction',
  add column if not exists tone text not null default 'professional',
  add column if not exists draft_text text,
  add column if not exists final_text text,
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists image_metadata jsonb not null default '{}'::jsonb,
  add column if not exists sent_at timestamptz,
  add column if not exists whatsapp_status text;

alter table public.content_items
  drop constraint if exists content_items_customer_owner_fk;
alter table public.content_items
  add constraint content_items_customer_owner_fk
  foreign key (customer_id, created_by)
  references public.customers (id, owner_id)
  on delete set null (customer_id);

alter table public.content_items
  drop constraint if exists content_items_product_owner_fk;
alter table public.content_items
  add constraint content_items_product_owner_fk
  foreign key (product_id, created_by)
  references public.costing_products (id, owner_id)
  on delete set null (product_id);

alter table public.content_items
  drop constraint if exists content_items_campaign_owner_fk;
alter table public.content_items
  add constraint content_items_campaign_owner_fk
  foreign key (campaign_id, created_by)
  references public.campaigns (id, owner_id)
  on delete set null (campaign_id);

alter table public.content_items
  drop constraint if exists content_items_goal_check;
alter table public.content_items
  add constraint content_items_goal_check check (goal in (
    'product_introduction', 'lead_generation', 'call_request', 'order',
    'quote_follow_up', 'customer_reactivation', 'educational', 'trust_building',
    'cross_sell', 'upsell', 'campaign'
  ));

alter table public.content_items
  drop constraint if exists content_items_image_metadata_check;
alter table public.content_items
  add constraint content_items_image_metadata_check
  check (jsonb_typeof(image_metadata) = 'object');

create index if not exists content_items_owner_history_idx
  on public.content_items (created_by, channel, created_at desc);
create index if not exists content_items_owner_customer_idx
  on public.content_items (created_by, customer_id, created_at desc);
create index if not exists content_items_owner_product_idx
  on public.content_items (created_by, product_id, created_at desc);

create table if not exists public.content_item_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  content_item_id uuid not null,
  version_number integer not null check (version_number > 0),
  caption text not null,
  final_text text,
  channel_payload jsonb not null default '{}'::jsonb,
  change_kind text not null default 'edit'
    check (change_kind in ('generated', 'edit', 'shorten', 'expand', 'cta', 'professional', 'friendly', 'hook')),
  created_at timestamptz not null default now(),
  unique (owner_id, content_item_id, version_number),
  constraint content_item_versions_item_owner_fk
    foreign key (content_item_id, owner_id)
    references public.content_items (id, created_by)
    on delete cascade,
  constraint content_item_versions_payload_check
    check (jsonb_typeof(channel_payload) = 'object')
);

alter table public.content_item_versions
  drop constraint if exists content_item_versions_change_kind_check;
alter table public.content_item_versions
  add constraint content_item_versions_change_kind_check
  check (change_kind in (
    'generated', 'edit', 'shorten', 'expand', 'cta',
    'professional', 'educational', 'friendly', 'hook'
  ));

create table if not exists public.content_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  content_item_id uuid not null,
  event_type text not null check (event_type in (
    'generated', 'edited', 'copied', 'sent', 'accepted', 'delivered',
    'read', 'failed', 'reply'
  )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint content_events_item_owner_fk
    foreign key (content_item_id, owner_id)
    references public.content_items (id, created_by)
    on delete cascade,
  constraint content_events_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists content_item_versions_owner_item_idx
  on public.content_item_versions (owner_id, content_item_id, version_number desc);
create index if not exists content_events_owner_item_idx
  on public.content_events (owner_id, content_item_id, created_at desc);

insert into public.content_item_versions (
  owner_id, content_item_id, version_number, caption, final_text,
  channel_payload, change_kind, created_at
)
select
  ci.created_by, ci.id, 1, ci.caption,
  coalesce(ci.final_text, ci.caption),
  coalesce(ci.channel_payload, '{}'::jsonb),
  'generated', ci.created_at
from public.content_items ci
where not exists (
  select 1 from public.content_item_versions version
  where version.owner_id = ci.created_by
    and version.content_item_id = ci.id
);

insert into public.content_events (
  owner_id, content_item_id, event_type, metadata, created_at
)
select ci.created_by, ci.id, 'generated', '{}'::jsonb, ci.created_at
from public.content_items ci
where not exists (
  select 1 from public.content_events event
  where event.owner_id = ci.created_by
    and event.content_item_id = ci.id
    and event.event_type = 'generated'
);

create or replace function public.initialize_content_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.content_item_versions (
    owner_id, content_item_id, version_number, caption, final_text,
    channel_payload, change_kind, created_at
  ) values (
    new.created_by, new.id, 1, new.caption,
    coalesce(new.final_text, new.caption),
    coalesce(new.channel_payload, '{}'::jsonb),
    'generated', new.created_at
  );
  insert into public.content_events (
    owner_id, content_item_id, event_type, created_at
  ) values (new.created_by, new.id, 'generated', new.created_at);
  return new;
end;
$$;

revoke all on function public.initialize_content_history() from public, anon, authenticated;
drop trigger if exists content_items_initialize_history on public.content_items;
create trigger content_items_initialize_history
after insert on public.content_items
for each row execute function public.initialize_content_history();

create table if not exists public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  business_account_id text not null,
  meta_template_id text not null,
  name text not null,
  language text not null,
  category text not null,
  status text not null,
  components jsonb not null default '[]'::jsonb,
  variable_count integer not null default 0 check (variable_count between 0 and 20),
  last_synced_at timestamptz not null default now(),
  unique (owner_id, business_account_id, name, language),
  constraint whatsapp_templates_components_check
    check (jsonb_typeof(components) = 'array')
);

create index if not exists whatsapp_templates_owner_status_idx
  on public.whatsapp_templates (owner_id, status, name);

alter table public.whatsapp_messages
  add column if not exists template_language text;

alter table public.brand_profiles enable row level security;
alter table public.product_content_assets enable row level security;
alter table public.content_item_versions enable row level security;
alter table public.content_events enable row level security;
alter table public.whatsapp_templates enable row level security;

drop policy if exists "Authenticated team can read content" on public.content_items;
drop policy if exists "Authenticated team can create content" on public.content_items;
drop policy if exists "Authenticated team can update content" on public.content_items;
drop policy if exists "Authenticated team can delete drafts" on public.content_items;
drop policy if exists "Users can view own content" on public.content_items;
drop policy if exists "Users can create own content" on public.content_items;
drop policy if exists "Users can update own content" on public.content_items;
drop policy if exists "Users can delete own draft content" on public.content_items;
create policy "Users can view own content"
  on public.content_items for select to authenticated
  using (created_by = (select auth.uid()));
create policy "Users can create own content"
  on public.content_items for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "Users can update own content"
  on public.content_items for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));
create policy "Users can delete own draft content"
  on public.content_items for delete to authenticated
  using (created_by = (select auth.uid()) and status in ('draft', 'rejected'));

drop policy if exists "Users manage own brand profile" on public.brand_profiles;
create policy "Users manage own brand profile"
  on public.brand_profiles for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
drop policy if exists "Users manage own product content assets" on public.product_content_assets;
create policy "Users manage own product content assets"
  on public.product_content_assets for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
drop policy if exists "Users view own content versions" on public.content_item_versions;
create policy "Users view own content versions"
  on public.content_item_versions for select to authenticated
  using (owner_id = (select auth.uid()));
drop policy if exists "Users view own content events" on public.content_events;
create policy "Users view own content events"
  on public.content_events for select to authenticated
  using (owner_id = (select auth.uid()));
drop policy if exists "Users create own content events" on public.content_events;
create policy "Users create own content events"
  on public.content_events for insert to authenticated
  with check (owner_id = (select auth.uid()));
drop policy if exists "Users view own approved WhatsApp templates" on public.whatsapp_templates;
create policy "Users view own approved WhatsApp templates"
  on public.whatsapp_templates for select to authenticated
  using (owner_id = (select auth.uid()));

revoke all on table public.brand_profiles from public, anon;
revoke all on table public.product_content_assets from public, anon;
revoke all on table public.content_item_versions from public, anon;
revoke all on table public.content_events from public, anon;
revoke all on table public.whatsapp_templates from public, anon, authenticated;
grant select, insert, update, delete on table public.brand_profiles to authenticated;
grant select, insert, update, delete on table public.product_content_assets to authenticated;
grant select on table public.content_item_versions to authenticated;
grant select, insert on table public.content_events to authenticated;
grant select on table public.whatsapp_templates to authenticated;
grant select, insert, update, delete on table public.whatsapp_templates to service_role;

create or replace function public.sync_whatsapp_templates(
  p_owner_id uuid,
  p_business_account_id text,
  p_templates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template jsonb;
  v_count integer := 0;
  v_approved integer := 0;
begin
  if p_owner_id is null
     or length(trim(coalesce(p_business_account_id, ''))) not between 1 and 512
     or jsonb_typeof(p_templates) <> 'array'
     or jsonb_array_length(p_templates) > 5000 then
    raise exception using errcode = '22023', message = 'Invalid template sync payload';
  end if;
  if not exists (select 1 from auth.users where id = p_owner_id) then
    raise exception using errcode = 'P0002', message = 'Owner not found';
  end if;

  update public.whatsapp_templates
  set status = 'NOT_SYNCED', last_synced_at = now()
  where owner_id = p_owner_id
    and business_account_id = p_business_account_id;

  for v_template in select value from jsonb_array_elements(p_templates)
  loop
    if jsonb_typeof(v_template) <> 'object'
       or length(trim(coalesce(v_template ->> 'id', ''))) not between 1 and 512
       or length(trim(coalesce(v_template ->> 'name', ''))) not between 1 and 512
       or (v_template ->> 'name') !~ '^[a-z0-9_]+$'
       or length(trim(coalesce(v_template ->> 'language', ''))) not between 2 and 32
       or length(trim(coalesce(v_template ->> 'category', ''))) not between 1 and 64
       or length(trim(coalesce(v_template ->> 'status', ''))) not between 1 and 64
       or jsonb_typeof(coalesce(v_template -> 'components', '[]'::jsonb)) <> 'array'
       or coalesce((v_template ->> 'variableCount')::integer, 0) not between 0 and 20 then
      raise exception using errcode = '22023', message = 'Invalid Meta template';
    end if;

    insert into public.whatsapp_templates (
      owner_id, business_account_id, meta_template_id, name, language,
      category, status, components, variable_count, last_synced_at
    ) values (
      p_owner_id,
      p_business_account_id,
      v_template ->> 'id',
      v_template ->> 'name',
      v_template ->> 'language',
      upper(v_template ->> 'category'),
      upper(v_template ->> 'status'),
      coalesce(v_template -> 'components', '[]'::jsonb),
      coalesce((v_template ->> 'variableCount')::integer, 0),
      now()
    ) on conflict (owner_id, business_account_id, name, language)
    do update set
      meta_template_id = excluded.meta_template_id,
      category = excluded.category,
      status = excluded.status,
      components = excluded.components,
      variable_count = excluded.variable_count,
      last_synced_at = excluded.last_synced_at;
    v_count := v_count + 1;
    if upper(v_template ->> 'status') = 'APPROVED' then
      v_approved := v_approved + 1;
    end if;
  end loop;

  return jsonb_build_object('synced', v_count, 'approved', v_approved);
end;
$$;

revoke all on function public.sync_whatsapp_templates(uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_whatsapp_templates(uuid,text,jsonb)
  to service_role;

create or replace function public.save_content_revision(
  p_content_item_id uuid,
  p_caption text,
  p_final_text text,
  p_channel_payload jsonb,
  p_change_kind text default 'edit'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_version integer;
begin
  if v_owner_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if length(trim(coalesce(p_caption, ''))) not between 1 and 8000
     or jsonb_typeof(coalesce(p_channel_payload, '{}'::jsonb)) <> 'object'
     or p_change_kind not in ('generated', 'edit', 'shorten', 'expand', 'cta', 'professional', 'educational', 'friendly', 'hook') then
    raise exception using errcode = '22023', message = 'Invalid content revision';
  end if;

  perform 1
  from public.content_items
  where id = p_content_item_id and created_by = v_owner_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Content item not found';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_version
  from public.content_item_versions
  where owner_id = v_owner_id and content_item_id = p_content_item_id;

  insert into public.content_item_versions (
    owner_id, content_item_id, version_number, caption,
    final_text, channel_payload, change_kind
  ) values (
    v_owner_id, p_content_item_id, v_version, p_caption,
    nullif(trim(p_final_text), ''), coalesce(p_channel_payload, '{}'::jsonb), p_change_kind
  );

  update public.content_items
  set
    caption = p_caption,
    final_text = nullif(trim(p_final_text), ''),
    channel_payload = coalesce(p_channel_payload, '{}'::jsonb)
  where id = p_content_item_id and created_by = v_owner_id;

  insert into public.content_events (owner_id, content_item_id, event_type)
  values (v_owner_id, p_content_item_id, 'edited');

  return v_version;
end;
$$;

revoke all on function public.save_content_revision(uuid,text,text,jsonb,text)
  from public, anon;
grant execute on function public.save_content_revision(uuid,text,text,jsonb,text)
  to authenticated;

create or replace function public.track_whatsapp_content_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
begin
  if new.content_item_id is null or new.status is not distinct from old.status then
    return new;
  end if;
  v_event_type := case new.status
    when 'accepted' then 'accepted'
    when 'sent' then 'sent'
    when 'delivered' then 'delivered'
    when 'read' then 'read'
    when 'failed' then 'failed'
    else null
  end;

  update public.content_items
  set
    whatsapp_status = new.status,
    sent_at = case
      when new.status in ('accepted', 'sent', 'delivered', 'read')
        then coalesce(sent_at, new.accepted_at, new.sent_at, now())
      else sent_at
    end
  where id = new.content_item_id and created_by = new.owner_id;

  if v_event_type is not null then
    insert into public.content_events (
      owner_id, content_item_id, event_type, metadata
    ) values (
      new.owner_id,
      new.content_item_id,
      v_event_type,
      jsonb_build_object('whatsapp_message_id', new.id)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.track_whatsapp_content_status() from public, anon, authenticated;
drop trigger if exists whatsapp_messages_track_content_status on public.whatsapp_messages;
create trigger whatsapp_messages_track_content_status
after update of status on public.whatsapp_messages
for each row execute function public.track_whatsapp_content_status();

-- Make content-studio objects private and isolate every object by the first
-- path segment (the authenticated owner's UUID).
update storage.buckets set public = false where id = 'content-studio';
drop policy if exists "Public can view content studio images" on storage.objects;
drop policy if exists "Authenticated team can upload content studio images" on storage.objects;
drop policy if exists "Authenticated team can update content studio images" on storage.objects;
drop policy if exists "Authenticated team can delete content studio images" on storage.objects;
drop policy if exists "Users can view own content studio files" on storage.objects;
drop policy if exists "Users can upload own content studio files" on storage.objects;
drop policy if exists "Users can update own content studio files" on storage.objects;
drop policy if exists "Users can delete own content studio files" on storage.objects;
create policy "Users can view own content studio files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'content-studio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users can upload own content studio files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'content-studio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users can update own content studio files"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'content-studio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'content-studio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users can delete own content studio files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'content-studio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

commit;
