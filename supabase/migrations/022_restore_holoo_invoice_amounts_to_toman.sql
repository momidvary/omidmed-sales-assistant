-- OmidMed Sales Assistant
-- 022: Restore Holoo invoice amounts that migration 020 divided by 10.
--
-- The connected Holoo database already returns invoice monetary values in toman.
-- Migration 020 incorrectly treated them as rial. This migration reverses that
-- conversion exactly once for Holoo invoices/items, repairs mirrored sales rows,
-- and restores future Agent invoice payloads to pass-through behavior.
-- Customer balance normalization from migration 019 is intentionally untouched.

begin;

alter table public.invoices
  add column if not exists holo_toman_restore_v22_applied boolean;

alter table public.invoice_items
  add column if not exists holo_toman_restore_v22_applied boolean;

-- Restore existing Holoo invoice header amounts exactly once.
do $$
declare
  v_set_clause text;
begin
  select string_agg(
    format(
      '%1$I = case when %1$I is null then null else round(%1$I * 10) end',
      c.column_name
    ),
    ', '
    order by c.ordinal_position
  )
  into v_set_clause
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'invoices'
    and c.column_name = any(array[
      'total_amount',
      'cash_amount',
      'check_amount',
      'card_amount',
      'credit_amount',
      'account_balance_amount',
      'discount_amount'
    ]);

  if v_set_clause is not null then
    execute
      'update public.invoices set '
      || v_set_clause
      || ', holo_toman_restore_v22_applied = true, updated_at = now() '
      || 'where (source in (''holo_agent'', ''holo_qrp'') '
      || 'or external_key like ''holoo:%'') '
      || 'and holo_amount_is_toman = true '
      || 'and holo_toman_restore_v22_applied is distinct from true';
  end if;
end
$$;

-- Restore existing Holoo invoice item amounts exactly once.
do $$
declare
  v_set_clause text;
begin
  select string_agg(
    format(
      '%1$I = case when ii.%1$I is null then null else round(ii.%1$I * 10) end',
      c.column_name
    ),
    ', '
    order by c.ordinal_position
  )
  into v_set_clause
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'invoice_items'
    and c.column_name = any(array[
      'unit_price',
      'line_total',
      'buy_price',
      'discount_amount',
      'levy_amount',
      'tax_amount'
    ]);

  if v_set_clause is not null then
    execute
      'update public.invoice_items ii set '
      || v_set_clause
      || ', holo_toman_restore_v22_applied = true '
      || 'from public.invoices i '
      || 'where i.id = ii.invoice_id '
      || 'and i.owner_id = ii.owner_id '
      || 'and (i.source in (''holo_agent'', ''holo_qrp'') '
      || 'or i.external_key like ''holoo:%'') '
      || 'and ii.holo_amount_is_toman = true '
      || 'and ii.holo_toman_restore_v22_applied is distinct from true';
  end if;
end
$$;

-- Keep every mirrored Holoo sale equal to its canonical invoice total.
update public.sales s
set amount = i.total_amount
from public.invoices i
where s.owner_id = i.owner_id
  and s.source = 'holo_qrp'
  and (i.source in ('holo_agent', 'holo_qrp') or i.external_key like 'holoo:%')
  and (
    s.external_key = concat('holo-qrp-invoice-', i.invoice_number)
    or (
      i.document_number is not null
      and s.document_number = i.document_number
    )
    or s.invoice_number = i.invoice_number
  )
  and s.amount is distinct from i.total_amount;

-- Existing rows have now been repaired; future rows must never be multiplied by
-- this migration if it is replayed in another environment.
update public.invoices
set holo_toman_restore_v22_applied = true
where holo_toman_restore_v22_applied is null;

alter table public.invoices
  alter column holo_toman_restore_v22_applied set default true;

alter table public.invoices
  alter column holo_toman_restore_v22_applied set not null;

update public.invoice_items
set holo_toman_restore_v22_applied = true
where holo_toman_restore_v22_applied is null;

alter table public.invoice_items
  alter column holo_toman_restore_v22_applied set default true;

alter table public.invoice_items
  alter column holo_toman_restore_v22_applied set not null;

-- Migration 020 preserved the receiver chain as sync_holoo_agent_batch_v19 and
-- wrapped it with an incorrect divide-by-10 transformation. Replace only the
-- outer wrapper with a pass-through function. Fail closed if the preserved
-- receiver is unexpectedly missing.
do $$
begin
  if to_regprocedure('public.sync_holoo_agent_batch_v19(uuid,jsonb)') is null then
    raise exception 'Required receiver public.sync_holoo_agent_batch_v19(uuid,jsonb) is missing';
  end if;
end
$$;

create or replace function public.sync_holoo_agent_batch(
  p_owner_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_owner_id is null then
    raise exception 'Owner id is required';
  end if;

  return public.sync_holoo_agent_batch_v19(p_owner_id, p_payload);
end;
$$;

revoke all on function public.sync_holoo_agent_batch_v19(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.sync_holoo_agent_batch(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_holoo_agent_batch(uuid, jsonb)
  to service_role;

commit;
