-- OmidMed Sales Assistant
-- 020: Holoo persists invoice monetary values in rial even when its UI is used in toman.
--
-- Migration 019 normalizes customer balances. This migration normalizes every
-- monetary value belonging to Holoo invoices and their items, repairs the
-- corresponding sales rows, and normalizes future Agent invoice payloads.
-- Manual invoices and manual sales are not changed.

begin;

alter table public.invoices
  add column if not exists holo_amount_is_toman boolean;

alter table public.invoice_items
  add column if not exists holo_amount_is_toman boolean;

-- Repair existing Holoo invoice headers exactly once. Dynamic column discovery
-- keeps this migration compatible with installations that do not have every
-- optional payment column.
do $$
declare
  v_set_clause text;
begin
  select string_agg(
    format(
      '%1$I = case when %1$I is null then null else round(%1$I / 10) end',
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
      || ', holo_amount_is_toman = true, updated_at = now() '
      || 'where (source in (''holo_agent'', ''holo_qrp'') '
      || 'or external_key like ''holoo:%'') '
      || 'and holo_amount_is_toman is distinct from true';
  end if;
end
$$;

-- Repair existing Holoo invoice items exactly once. The source alias is used on
-- the right-hand side because invoice_items and invoices share column names
-- such as discount_amount in the UPDATE ... FROM statement.
do $$
declare
  v_set_clause text;
begin
  select string_agg(
    format(
      '%1$I = case when ii.%1$I is null then null else round(ii.%1$I / 10) end',
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
      || ', holo_amount_is_toman = true '
      || 'from public.invoices i '
      || 'where i.id = ii.invoice_id '
      || 'and i.owner_id = ii.owner_id '
      || 'and (i.source in (''holo_agent'', ''holo_qrp'') '
      || 'or i.external_key like ''holoo:%'') '
      || 'and ii.holo_amount_is_toman is distinct from true';
  end if;
end
$$;

-- The invoice trigger normally updates sales automatically. This explicit pass
-- guarantees that every existing Holo sales row equals the converted invoice
-- total, without touching manually entered sales.
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

alter table public.invoices
  alter column holo_amount_is_toman set default true;

update public.invoices
set holo_amount_is_toman = true
where holo_amount_is_toman is null;

alter table public.invoices
  alter column holo_amount_is_toman set not null;

alter table public.invoice_items
  alter column holo_amount_is_toman set default true;

update public.invoice_items
set holo_amount_is_toman = true
where holo_amount_is_toman is null;

alter table public.invoice_items
  alter column holo_amount_is_toman set not null;

-- Preserve the current receiver chain (including migration 019 when installed)
-- and add invoice-only rial-to-toman normalization at the outermost boundary.
do $$
begin
  if to_regprocedure('public.sync_holoo_agent_batch_v19(uuid,jsonb)') is null then
    alter function public.sync_holoo_agent_batch(uuid, jsonb)
      rename to sync_holoo_agent_batch_v19;
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
declare
  v_payload jsonb := p_payload;
  v_invoice jsonb;
  v_item jsonb;
  v_invoices jsonb := '[]'::jsonb;
  v_items jsonb;
  v_key text;
  v_value_text text;
  v_value numeric;
begin
  if p_owner_id is null then
    raise exception 'Owner id is required';
  end if;

  if jsonb_typeof(p_payload->'invoices') = 'array' then
    for v_invoice in
      select value
      from jsonb_array_elements(p_payload->'invoices')
    loop
      foreach v_key in array array[
        'totalAmount',
        'cashAmount',
        'checkAmount',
        'cardAmount',
        'creditAmount',
        'accountBalanceAmount',
        'discountAmount'
      ]
      loop
        v_value_text := nullif(btrim(v_invoice->>v_key), '');

        if v_value_text is not null then
          begin
            v_value := v_value_text::numeric;
            v_invoice := jsonb_set(
              v_invoice,
              array[v_key],
              to_jsonb(round(v_value / 10)),
              true
            );
          exception
            when invalid_text_representation or numeric_value_out_of_range then
              null;
          end;
        end if;
      end loop;

      if jsonb_typeof(v_invoice->'items') = 'array' then
        v_items := '[]'::jsonb;

        for v_item in
          select value
          from jsonb_array_elements(v_invoice->'items')
        loop
          foreach v_key in array array[
            'unitPrice',
            'lineTotal',
            'buyPrice',
            'discountAmount',
            'levyAmount',
            'taxAmount'
          ]
          loop
            v_value_text := nullif(btrim(v_item->>v_key), '');

            if v_value_text is not null then
              begin
                v_value := v_value_text::numeric;
                v_item := jsonb_set(
                  v_item,
                  array[v_key],
                  to_jsonb(round(v_value / 10)),
                  true
                );
              exception
                when invalid_text_representation or numeric_value_out_of_range then
                  null;
              end;
            end if;
          end loop;

          v_items := v_items || jsonb_build_array(v_item);
        end loop;

        v_invoice := jsonb_set(v_invoice, '{items}', v_items, true);
      end if;

      v_invoices := v_invoices || jsonb_build_array(v_invoice);
    end loop;

    v_payload := jsonb_set(v_payload, '{invoices}', v_invoices, true);
  end if;

  return public.sync_holoo_agent_batch_v19(p_owner_id, v_payload);
end;
$$;

revoke all on function public.sync_holoo_agent_batch_v19(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.sync_holoo_agent_batch(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_holoo_agent_batch(uuid, jsonb)
  to service_role;

commit;
