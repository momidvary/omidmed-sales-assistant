-- OmidMed Sales Assistant
-- 016: Reconcile every Holoo invoice identity, including source/external_key.
--
-- Migration 014 reconciled Holoo identity, invoice number and document number.
-- A legacy row can also own only the incoming (owner_id, source, external_key)
-- identity. In that case the previous wrapper delegated without adopting that
-- row, and the v13 implementation could raise SQLSTATE 23505 on
-- invoices_owner_source_external_key_unique.

begin;

do $$
begin
  if to_regprocedure('public.sync_holoo_agent_batch_v13(uuid,jsonb)') is null then
    raise exception
      'Required function public.sync_holoo_agent_batch_v13(uuid,jsonb) is missing';
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
  v_external_candidate_id uuid;
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

      -- Lock every row identified by any of the four unique invoice identities.
      -- UUID ordering keeps concurrent batches from taking the same locks in a
      -- different order.
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
            or (
              i.source = 'holo_agent'
              and i.external_key = v_external_key
            )
          )
        order by i.id
        for update
      ) as locked;

      -- With no historic candidate the v13 implementation can insert normally.
      if cardinality(v_candidate_ids) = 0 then
        continue;
      end if;

      v_document_candidate_id := null;
      v_holo_candidate_id := null;
      v_invoice_number_candidate_id := null;
      v_external_candidate_id := null;

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

      select i.id
      into v_external_candidate_id
      from public.invoices i
      where i.id = any(v_candidate_ids)
        and i.source = 'holo_agent'
        and i.external_key = v_external_key
      order by i.id
      limit 1;

      v_canonical_id := coalesce(
        v_document_candidate_id,
        v_holo_candidate_id,
        v_invoice_number_candidate_id,
        v_external_candidate_id
      );

      if v_canonical_id is null then
        raise exception
          'Unable to choose a canonical Holoo invoice candidate';
      end if;

      -- The delegated v13 function rebuilds invoice items from this same payload.
      -- Clearing every candidate first is safe because the wrapper and v13 call
      -- execute in one PostgreSQL transaction and roll back together on failure.
      delete from public.invoice_items
      where owner_id = p_owner_id
        and invoice_id = any(v_candidate_ids);

      delete from public.invoices
      where owner_id = p_owner_id
        and id = any(v_candidate_ids)
        and id <> v_canonical_id;

      -- Adopt even a single external-key-only candidate before delegation so the
      -- v13 implementation updates it instead of attempting a conflicting insert.
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
