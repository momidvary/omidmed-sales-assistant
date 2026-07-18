-- Reconcile legacy invoice identities before the Holoo batch implementation
-- writes the full invoice and rebuilds its items.
--
-- The public wrapper and the v13 implementation execute in one PostgreSQL
-- transaction. Any failure rolls back candidate locks, item deletion,
-- duplicate deletion, invoice updates, and item reconstruction together.

begin;

alter function public.sync_holoo_agent_batch(uuid, jsonb)
  rename to sync_holoo_agent_batch_v13;

revoke all on function public.sync_holoo_agent_batch_v13(uuid, jsonb)
  from public;
revoke all on function public.sync_holoo_agent_batch_v13(uuid, jsonb)
  from anon;
revoke all on function public.sync_holoo_agent_batch_v13(uuid, jsonb)
  from authenticated;
revoke all on function public.sync_holoo_agent_batch_v13(uuid, jsonb)
  from service_role;

create function public.sync_holoo_agent_batch(
  p_owner_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice jsonb;
  v_fac_code text;
  v_fac_type text;
  v_invoice_number text;
  v_document_number text;
  v_external_key text;

  v_candidate_ids uuid[];
  v_document_candidate_id uuid;
  v_holo_candidate_id uuid;
  v_invoice_number_candidate_id uuid;
  v_canonical_id uuid;
begin
  if p_owner_id is null then
    raise exception 'Owner id is required';
  end if;

  if jsonb_typeof(p_payload->'invoices') = 'array' then
    for v_invoice in
      select value
      from jsonb_array_elements(p_payload->'invoices')
    loop
      v_fac_code :=
        nullif(btrim(v_invoice->>'facCode'), '');

      v_fac_type := coalesce(
        nullif(btrim(v_invoice->>'facType'), ''),
        'F'
      );

      v_invoice_number := coalesce(
        nullif(btrim(v_invoice->>'invoiceNumber'), ''),
        v_fac_code
      );

      v_document_number :=
        nullif(btrim(v_invoice->>'documentNumber'), '');

      if v_fac_code is null or v_fac_type <> 'F' then
        continue;
      end if;

      v_external_key :=
        'holoo:' || v_fac_type || ':' || v_fac_code;

      -- Lock every row identified by any incoming natural key. Ordering the
      -- locks by UUID keeps concurrent batches from taking the same locks in
      -- different orders.
      select coalesce(
        array_agg(locked.id order by locked.id),
        '{}'::uuid[]
      )
      into v_candidate_ids
      from (
        select i.id
        from public.invoices i
        where i.owner_id = p_owner_id
          and (
            (
              i.holo_fac_type = v_fac_type
              and i.holo_fac_code = v_fac_code
            )
            or i.invoice_number = v_invoice_number
            or (
              v_document_number is not null
              and i.document_number = v_document_number
            )
          )
        order by i.id
        for update
      ) as locked;

      if cardinality(v_candidate_ids) <= 1 then
        continue;
      end if;

      v_document_candidate_id := null;
      v_holo_candidate_id := null;
      v_invoice_number_candidate_id := null;

      if v_document_number is not null then
        select i.id
        into v_document_candidate_id
        from public.invoices i
        where i.id = any(v_candidate_ids)
          and i.document_number = v_document_number
        order by i.id
        limit 1;
      end if;

      select i.id
      into v_holo_candidate_id
      from public.invoices i
      where i.id = any(v_candidate_ids)
        and i.holo_fac_type = v_fac_type
        and i.holo_fac_code = v_fac_code
      order by i.id
      limit 1;

      select i.id
      into v_invoice_number_candidate_id
      from public.invoices i
      where i.id = any(v_candidate_ids)
        and i.invoice_number = v_invoice_number
      order by i.id
      limit 1;

      v_canonical_id := coalesce(
        v_document_candidate_id,
        v_holo_candidate_id,
        v_invoice_number_candidate_id
      );

      if v_canonical_id is null then
        raise exception
          'Unable to choose a canonical Holoo invoice candidate';
      end if;

      -- invoice_items is the only FK dependency on invoices. Remove every
      -- candidate's items first; the v13 implementation below rebuilds the
      -- canonical invoice items from this same payload.
      delete from public.invoice_items
      where owner_id = p_owner_id
        and invoice_id = any(v_candidate_ids);

      delete from public.invoices
      where owner_id = p_owner_id
        and id = any(v_candidate_ids)
        and id <> v_canonical_id;

      -- Give the canonical row the Holoo identity before delegating. The
      -- implementation then finds this row by Holoo identity and applies all
      -- incoming header fields, including invoice/document numbers and the
      -- final external key, before rebuilding its items.
      update public.invoices
      set
        source = 'holo_agent',
        external_key = v_external_key,
        holo_fac_code = v_fac_code,
        holo_fac_type = v_fac_type,
        holo_is_deleted = false,
        updated_at = now()
      where owner_id = p_owner_id
        and id = v_canonical_id;
    end loop;
  end if;

  return public.sync_holoo_agent_batch_v13(
    p_owner_id,
    p_payload
  );
end;
$$;

revoke all on function public.sync_holoo_agent_batch(uuid, jsonb)
  from public;
revoke all on function public.sync_holoo_agent_batch(uuid, jsonb)
  from anon;
revoke all on function public.sync_holoo_agent_batch(uuid, jsonb)
  from authenticated;
grant execute on function public.sync_holoo_agent_batch(uuid, jsonb)
  to service_role;

commit;
