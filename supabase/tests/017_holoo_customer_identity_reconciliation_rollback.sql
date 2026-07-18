-- Rollback-only regression test for migration 017.
-- Run only against a disposable local/test Supabase database after migrations.

begin;

do $test$
declare
  v_owner_id uuid := gen_random_uuid();
  v_manual_id uuid := gen_random_uuid();
  v_holoo_id uuid := gen_random_uuid();
  v_payload jsonb;
  v_customer_count integer;
  v_canonical_id uuid;
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
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_owner_id,
    'authenticated',
    'authenticated',
    'holoo-017-' || v_owner_id::text || '@example.invalid',
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
    id, owner_id, customer_code, name, phone, normalized_phone,
    status, priority, notes, created_at
  ) values
  (
    v_manual_id,
    v_owner_id,
    null,
    'کلینیک فیزیوتراپی آزمون',
    '09123456789',
    '09123456789',
    'prospect',
    'high',
    'manual note',
    now() - interval '2 days'
  ),
  (
    v_holoo_id,
    v_owner_id,
    'HOLO-017-A',
    'کلینیک فیزیوتراپی آزمون',
    '09123456789',
    '09123456789',
    'active',
    'normal',
    'Holoo note',
    now() - interval '1 day'
  );

  insert into public.followups (
    owner_id, customer_id, channel, outcome, notes
  ) values (
    v_owner_id, v_manual_id, 'phone', 'follow_up_later', 'keep me'
  );

  insert into public.tasks (
    owner_id, customer_id, title, status, priority
  ) values (
    v_owner_id, v_manual_id, 'customer task', 'pending', 'normal'
  );

  insert into public.sales (
    owner_id, customer_id, invoice_number, document_number,
    sale_date, amount, source, external_key
  ) values (
    v_owner_id, v_holoo_id, 'HOLO-017-I1', 'HOLO-017-D1',
    current_date, 1000, 'manual', 'holoo-017-sale'
  );

  insert into public.customer_holoo_codes (
    owner_id, customer_id, customer_code
  ) values (
    v_owner_id, v_holoo_id, 'HOLO-017-A'
  );

  perform public.merge_customer_duplicate(
    v_owner_id,
    v_holoo_id,
    v_manual_id
  );

  select count(*), min(id)
  into v_customer_count, v_canonical_id
  from public.customers
  where owner_id = v_owner_id
    and normalized_phone = '09123456789';

  if v_customer_count <> 1 or v_canonical_id <> v_holoo_id then
    raise exception 'Expected one canonical Holoo customer after merge';
  end if;

  if not exists (
    select 1 from public.followups
    where owner_id = v_owner_id and customer_id = v_holoo_id
  ) then
    raise exception 'Follow-up was not moved to the canonical customer';
  end if;

  if not exists (
    select 1 from public.tasks
    where owner_id = v_owner_id and customer_id = v_holoo_id
  ) then
    raise exception 'Task was not moved to the canonical customer';
  end if;

  if not exists (
    select 1 from public.sales
    where owner_id = v_owner_id and customer_id = v_holoo_id
  ) then
    raise exception 'Sale was not preserved on the canonical customer';
  end if;

  v_payload := jsonb_build_object(
    'runId', 'holoo-017-alias-test',
    'mode', 'initial',
    'batchType', 'customers',
    'sourceServer', 'rollback-test',
    'sourceDatabase', 'rollback-test',
    'final', false,
    'customers', jsonb_build_array(
      jsonb_build_object(
        'code', 'HOLO-017-ALTERNATE',
        'name', 'کلینیک فیزیوتراپی آزمون',
        'mobile', '09123456789',
        'balanceAmount', 0,
        'balanceStatus', 'zero'
      )
    ),
    'invoices', '[]'::jsonb
  );

  perform public.sync_holoo_agent_batch(v_owner_id, v_payload);

  select count(*)
  into v_customer_count
  from public.customers
  where owner_id = v_owner_id
    and normalized_phone = '09123456789';

  if v_customer_count <> 1 then
    raise exception 'Alternate Holoo code created a duplicate customer';
  end if;

  if not exists (
    select 1
    from public.customer_holoo_codes h
    where h.owner_id = v_owner_id
      and h.customer_id = v_holoo_id
      and h.customer_code = 'HOLO-017-ALTERNATE'
  ) then
    raise exception 'Alternate Holoo code was not saved as an alias';
  end if;
end;
$test$;

rollback;
