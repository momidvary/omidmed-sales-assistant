-- OmidMed Sales Assistant
-- 019: Holoo customer balances are stored in rial while invoice amounts are toman.
--
-- Convert only customer balanceAmount by a factor of 10. Invoice headers, invoice
-- items and sales amounts remain unchanged. Existing customer balances are repaired
-- once, and future Holoo Agent customer batches are normalized before delegation.

begin;

-- This marker makes the one-time repair safe if the SQL is accidentally executed
-- again from the Supabase SQL Editor.
alter table public.customers
  add column if not exists holo_balance_is_toman boolean;

update public.customers
set
  holo_balance_amount = round(coalesce(holo_balance_amount, 0) / 10),
  holo_balance_is_toman = true,
  updated_at = now()
where holo_balance_is_toman is distinct from true;

alter table public.customers
  alter column holo_balance_is_toman set default true;

update public.customers
set holo_balance_is_toman = true
where holo_balance_is_toman is null;

alter table public.customers
  alter column holo_balance_is_toman set not null;

-- Preserve the current receiver chain and add a unit-normalization wrapper.
do $$
begin
  if to_regprocedure('public.sync_holoo_agent_batch_v17(uuid,jsonb)') is null then
    alter function public.sync_holoo_agent_batch(uuid, jsonb)
      rename to sync_holoo_agent_batch_v17;
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
  v_customer jsonb;
  v_customers jsonb := '[]'::jsonb;
  v_balance_text text;
  v_balance numeric;
begin
  if p_owner_id is null then
    raise exception 'Owner id is required';
  end if;

  if jsonb_typeof(p_payload->'customers') = 'array' then
    for v_customer in
      select value
      from jsonb_array_elements(p_payload->'customers')
    loop
      v_balance_text := nullif(btrim(v_customer->>'balanceAmount'), '');

      if v_balance_text is not null then
        begin
          v_balance := v_balance_text::numeric;
          v_customer := jsonb_set(
            v_customer,
            '{balanceAmount}',
            to_jsonb(round(v_balance / 10)),
            true
          );
        exception
          when invalid_text_representation or numeric_value_out_of_range then
            -- Delegate malformed values unchanged so the existing receiver keeps
            -- its established validation behavior.
            null;
        end;
      end if;

      v_customers := v_customers || jsonb_build_array(v_customer);
    end loop;

    v_payload := jsonb_set(v_payload, '{customers}', v_customers, true);
  end if;

  return public.sync_holoo_agent_batch_v17(p_owner_id, v_payload);
end;
$$;

revoke all on function public.sync_holoo_agent_batch_v17(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.sync_holoo_agent_batch(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_holoo_agent_batch(uuid, jsonb)
  to service_role;

commit;
