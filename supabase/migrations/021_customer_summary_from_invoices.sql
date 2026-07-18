-- OmidMed Sales Assistant
-- 021: Make the canonical invoices table the single source of truth for customer
-- purchase totals, counts, last purchase dates and purchase-cycle statistics.
--
-- The previous CRM summary aggregated public.sales. Holoo invoices also create
-- mirror sales rows, and historic/manual sales rows can therefore make the
-- profile total differ from the sum of the customer's invoices.

begin;

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
      partition by owner_id, customer_id
      order by invoice_date
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
    else current_date - s.last_purchase_at
  end as days_since_last_purchase
from public.customers c
left join invoice_stats s
  on s.owner_id = c.owner_id
 and s.customer_id = c.id
left join gap_stats g
  on g.owner_id = c.owner_id
 and g.customer_id = c.id;

revoke all on table public.customer_crm_summary from anon;
grant select on table public.customer_crm_summary to authenticated;

commit;
