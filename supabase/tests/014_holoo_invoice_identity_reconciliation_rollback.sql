-- Rollback-only regression test for migration 014.
-- Run only against a disposable local/test Supabase database after migrations.

begin;

do $test$
declare
  v_owner_id uuid := gen_random_uuid();
  v_customer_id uuid := gen_random_uuid();
  v_holo_invoice_id uuid := gen_random_uuid();
  v_document_invoice_id uuid := gen_random_uuid();
  v_payload jsonb;
  v_invoice_count integer;
  v_item_count integer;
  v_unique_index_count integer;
begin
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    v_owner_id,
    'authenticated',
    'authenticated',
    'holoo-014-' || v_owner_id::text || '@example.invalid',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    now(),
    now(),
    '',
    '',
    ''
  );

  insert into public.customers (
    id,
    owner_id,
    customer_code,
    name
  )
  values (
    v_customer_id,
    v_owner_id,
    'HOLO-014-CUSTOMER',
    'Synthetic migration 014 customer'
  );

  -- Candidate 1 owns the incoming Holoo and invoice-number identities.
  insert into public.invoices (
    id,
    owner_id,
    customer_id,
    invoice_number,
    document_number,
    invoice_date,
    source,
    external_key,
    holo_fac_code,
    holo_fac_type
  )
  values (
    v_holo_invoice_id,
    v_owner_id,
    v_customer_id,
    'HOLO-014-INVOICE',
    'HOLO-014-OLD-DOCUMENT',
    current_date,
    'holo_agent',
    'holoo:F:HOLO-014-FAC',
    'HOLO-014-FAC',
    'F'
  );

  -- Candidate 2 owns the incoming document number and must remain canonical.
  insert into public.invoices (
    id,
    owner_id,
    customer_id,
    invoice_number,
    document_number,
    invoice_date,
    source,
    external_key
  )
  values (
    v_document_invoice_id,
    v_owner_id,
    v_customer_id,
    'HOLO-014-LEGACY-INVOICE',
    'HOLO-014-DOCUMENT',
    current_date,
    'manual',
    'holoo-014-legacy-document'
  );

  insert into public.invoice_items (
    owner_id,
    invoice_id,
    row_number,
    product_name,
    external_key
  )
  values
    (
      v_owner_id,
      v_holo_invoice_id,
      1,
      'Synthetic old item A',
      'holoo-014-old-item-a'
    ),
    (
      v_owner_id,
      v_document_invoice_id,
      1,
      'Synthetic old item B',
      'holoo-014-old-item-b'
    );

  v_payload := jsonb_build_object(
    'runId', 'holoo-014-rollback-test',
    'mode', 'initial',
    'batchType', 'invoices',
    'sourceServer', 'rollback-test',
    'sourceDatabase', 'rollback-test',
    'final', false,
    'customers', '[]'::jsonb,
    'invoices', jsonb_build_array(
      jsonb_build_object(
        'facCode', 'HOLO-014-FAC',
        'facType', 'F',
        'invoiceNumber', 'HOLO-014-INVOICE',
        'documentNumber', 'HOLO-014-DOCUMENT',
        'customerCode', 'HOLO-014-CUSTOMER',
        'customerName', 'Synthetic migration 014 customer',
        'invoiceDate', current_date::text,
        'totalQuantity', 1,
        'totalAmount', 1000,
        'cashAmount', 1000,
        'checkAmount', 0,
        'cardAmount', 0,
        'creditAmount', 0,
        'discountAmount', 0,
        'isDeleted', false,
        'items', jsonb_build_array(
          jsonb_build_object(
            'rowNumber', 1,
            'productName', 'Synthetic rebuilt item',
            'quantity', 1,
            'unitPrice', 1000,
            'lineTotal', 1000,
            'articleCode', 'HOLO-014-ARTICLE',
            'articleIndex', 1,
            'buyPrice', 500,
            'discountAmount', 0,
            'levyAmount', 0,
            'taxAmount', 0
          )
        )
      )
    )
  );

  perform public.sync_holoo_agent_batch(v_owner_id, v_payload);
  -- Repeat the same pending run/batch to prove data idempotency.
  perform public.sync_holoo_agent_batch(v_owner_id, v_payload);

  select count(*)
  into v_invoice_count
  from public.invoices i
  where i.owner_id = v_owner_id
    and (
      (
        i.holo_fac_type = 'F'
        and i.holo_fac_code = 'HOLO-014-FAC'
      )
      or i.invoice_number = 'HOLO-014-INVOICE'
      or i.document_number = 'HOLO-014-DOCUMENT'
    );

  if v_invoice_count <> 1 then
    raise exception
      'Expected one reconciled invoice, found %',
      v_invoice_count;
  end if;

  if not exists (
    select 1
    from public.invoices i
    where i.id = v_document_invoice_id
      and i.owner_id = v_owner_id
      and i.holo_fac_type = 'F'
      and i.holo_fac_code = 'HOLO-014-FAC'
      and i.invoice_number = 'HOLO-014-INVOICE'
      and i.document_number = 'HOLO-014-DOCUMENT'
      and i.external_key = 'holoo:F:HOLO-014-FAC'
  ) then
    raise exception
      'The document-number candidate was not preserved as canonical';
  end if;

  select count(*)
  into v_item_count
  from public.invoice_items ii
  where ii.owner_id = v_owner_id
    and ii.invoice_id = v_document_invoice_id;

  if v_item_count <> 1 then
    raise exception
      'Expected one rebuilt canonical item, found %',
      v_item_count;
  end if;

  select count(*)
  into v_unique_index_count
  from pg_indexes
  where schemaname = 'public'
    and tablename = 'invoices'
    and indexname = any(array[
      'invoices_owner_source_external_key_unique',
      'invoices_owner_invoice_number_unique',
      'invoices_owner_document_number_unique',
      'invoices_owner_holo_fac_unique'
    ])
    and indexdef ilike 'create unique index%';

  if v_unique_index_count <> 4 then
    raise exception
      'Expected all four invoice unique indexes to remain';
  end if;
end;
$test$;

rollback;
