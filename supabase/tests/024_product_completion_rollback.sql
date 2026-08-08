-- Rollback-only regression test for migration 024.
-- Run only against a disposable local/test Supabase database after migrations.

begin;

create extension if not exists pgtap;
select plan(1);

do $fixtures$
declare
  v_owner uuid := '24000000-0000-4000-8000-000000000001';
  v_other uuid := '24000000-0000-4000-8000-000000000002';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change
  ) values
    (
      '00000000-0000-0000-0000-000000000000', v_owner,
      'authenticated', 'authenticated', 'product-024-owner@example.invalid', '',
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', ''
    ),
    (
      '00000000-0000-0000-0000-000000000000', v_other,
      'authenticated', 'authenticated', 'product-024-other@example.invalid', '',
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', ''
    );

  insert into public.suppliers (id, owner_id, name) values
    ('24000000-0000-4000-8000-000000000010', v_owner, 'Synthetic supplier');
  insert into public.purchase_invoices (
    id, owner_id, supplier_id, invoice_number, invoice_date,
    subtotal, total_amount, payment_status, payment_method, opening_paid_amount
  ) values (
    '24000000-0000-4000-8000-000000000011', v_owner,
    '24000000-0000-4000-8000-000000000010', 'SYN-024', current_date,
    1000, 1000, 'partial', 'bank_transfer', 250
  );
  insert into public.purchase_invoices (
    id, owner_id, supplier_id, invoice_number, invoice_date,
    subtotal, total_amount, payment_status, payment_method
  ) values (
    '24000000-0000-4000-8000-000000000013', v_owner,
    '24000000-0000-4000-8000-000000000010', 'SYN-024-REVIEW', current_date,
    1000, 1000, 'partial', 'bank_transfer'
  );

  insert into public.employees (
    id, owner_id, name, monthly_base_salary
  ) values (
    '24000000-0000-4000-8000-000000000020', v_owner, 'Synthetic employee', 1000
  );
  insert into public.payroll_entries (
    id, owner_id, employee_id, jalali_year, jalali_month, base_salary,
    overtime_amount, deductions_amount, advance_amount, net_pay
  ) values (
    '24000000-0000-4000-8000-000000000021', v_owner,
    '24000000-0000-4000-8000-000000000020', 1405, 1, 1000,
    200, 50, 300, 1150
  );

  insert into public.customers (
    id, owner_id, customer_code, name, phone, city, status
  ) values
    (
      '24000000-0000-4000-8000-000000000030', v_owner,
      'SYN-024-OWNER', 'Synthetic owner customer', '09120000000', 'Tehran', 'prospect'
    ),
    (
      '24000000-0000-4000-8000-000000000031', v_other,
      'SYN-024-OTHER', 'Synthetic other customer', '09120000001', 'Shiraz', 'prospect'
    );

  insert into public.costing_products (id, owner_id, name, category) values
    (
      '24000000-0000-4000-8000-000000000032', v_owner,
      'Synthetic owner product', 'other'
    ),
    (
      '24000000-0000-4000-8000-000000000033', v_other,
      'Synthetic other product', 'other'
    );

  insert into public.campaigns (
    id, owner_id, name, target_product
  ) values (
    '24000000-0000-4000-8000-000000000040', v_owner,
    'Synthetic campaign', 'Synthetic product'
  );
  insert into public.campaign_members (
    id, owner_id, campaign_id, customer_id
  ) values (
    '24000000-0000-4000-8000-000000000041', v_owner,
    '24000000-0000-4000-8000-000000000040',
    '24000000-0000-4000-8000-000000000030'
  );

  insert into public.sms_messages (
    id, owner_id, customer_id, source, mode, sender, recipient,
    message_text, request_success, delivery_status, client_request_id
  ) values (
    '24000000-0000-4000-8000-000000000060', v_owner,
    '24000000-0000-4000-8000-000000000030', 'customer', 'multiple',
    '50000000000000', '09120000000', 'Synthetic accepted SMS', true,
    'accepted', '24000000-0000-4000-8000-000000000061'
  );

  insert into public.content_items (
    id, created_by, title, topic, objective, audience, channel, format,
    caption, content_type, goal, draft_text, final_text
  ) values
    (
      '24000000-0000-4000-8000-000000000050', v_owner,
      'Synthetic owner content', 'Synthetic', 'test', 'test', 'whatsapp', 'post',
      'Initial owner caption', 'whatsapp_sales', 'lead_generation',
      'Initial owner caption', 'Initial owner caption'
    ),
    (
      '24000000-0000-4000-8000-000000000051', v_other,
      'Synthetic other content', 'Synthetic', 'test', 'test', 'whatsapp', 'post',
      'Initial other caption', 'whatsapp_sales', 'lead_generation',
      'Initial other caption', 'Initial other caption'
    );

  insert into public.whatsapp_templates (
    owner_id, business_account_id, meta_template_id, name,
    language, category, status
  ) values
    (v_owner, 'synthetic-waba', 'synthetic-meta-owner', 'synthetic_owner', 'fa', 'MARKETING', 'APPROVED'),
    (v_other, 'synthetic-waba', 'synthetic-meta-other', 'synthetic_other', 'fa', 'MARKETING', 'APPROVED');
end
$fixtures$;

set local role authenticated;
set local "request.jwt.claim.sub" = '24000000-0000-4000-8000-000000000001';

do $checks$
declare
  v_payment_id uuid;
  v_duplicate_payment_id uuid;
  v_asset_id uuid;
  v_campaign_id uuid;
  v_duplicate_campaign_id uuid;
  v_version integer;
  v_result jsonb;
begin
  if not exists (
    select 1 from public.purchase_invoice_balances
    where id = '24000000-0000-4000-8000-000000000013'
      and paid_amount is null and outstanding_amount is null
      and derived_payment_status = 'needs_review'
  ) then
    raise exception 'Unknown legacy partial payment was presented as debt';
  end if;
  perform public.set_purchase_opening_paid_amount(
    '24000000-0000-4000-8000-000000000013', 300
  );
  if not exists (
    select 1 from public.purchase_invoice_balances
    where id = '24000000-0000-4000-8000-000000000013'
      and paid_amount = 300 and outstanding_amount = 700
      and derived_payment_status = 'partial'
  ) then
    raise exception 'Reviewed opening purchase payment is incorrect';
  end if;

  v_campaign_id := public.create_campaign_with_members(
    '24000000-0000-4000-8000-000000000070',
    '{"name":"Atomic synthetic campaign","campaign_type":"custom","channel":"phone","priority_filter":"all"}'::jsonb,
    array['24000000-0000-4000-8000-000000000030'::uuid]
  );
  v_duplicate_campaign_id := public.create_campaign_with_members(
    '24000000-0000-4000-8000-000000000070',
    '{"name":"Atomic synthetic campaign","campaign_type":"custom","channel":"phone","priority_filter":"all"}'::jsonb,
    array['24000000-0000-4000-8000-000000000030'::uuid]
  );
  if v_campaign_id <> v_duplicate_campaign_id
     or (select count(*) from public.campaigns where name = 'Atomic synthetic campaign') <> 1
     or (select count(*) from public.campaign_members where campaign_id = v_campaign_id) <> 1 then
    raise exception 'Campaign creation was not atomic and idempotent';
  end if;

  v_asset_id := public.set_product_primary_asset(
    '24000000-0000-4000-8000-000000000032',
    '24000000-0000-4000-8000-000000000001/products/24000000-0000-4000-8000-000000000032/synthetic.png',
    'synthetic.png', 'image/png', 128
  );
  if v_asset_id is null or not exists (
    select 1 from public.costing_products
    where id = '24000000-0000-4000-8000-000000000032'
      and primary_image_path like '%/synthetic.png'
  ) then
    raise exception 'Primary product asset was not set atomically';
  end if;
  begin
    perform public.set_product_primary_asset(
      '24000000-0000-4000-8000-000000000033',
      '24000000-0000-4000-8000-000000000001/products/24000000-0000-4000-8000-000000000033/foreign.png',
      'foreign.png', 'image/png', 128
    );
    raise exception 'Foreign product asset update unexpectedly succeeded';
  exception when sqlstate 'P0002' then
    null;
  end;

  v_payment_id := public.record_purchase_payment(
    '24000000-0000-4000-8000-000000000011',
    '24000000-0000-4000-8000-000000000012',
    150, current_date, 'bank_transfer', 'SYNTHETIC', 'Synthetic test payment'
  );
  v_duplicate_payment_id := public.record_purchase_payment(
    '24000000-0000-4000-8000-000000000011',
    '24000000-0000-4000-8000-000000000012',
    150, current_date, 'bank_transfer', 'SYNTHETIC', 'Synthetic test payment'
  );
  if v_payment_id <> v_duplicate_payment_id then
    raise exception 'Purchase payment retry was not idempotent';
  end if;
  if (select count(*) from public.purchase_payments) <> 1 then
    raise exception 'Purchase payment retry created a duplicate';
  end if;
  if not exists (
    select 1 from public.purchase_invoice_balances
    where id = '24000000-0000-4000-8000-000000000011'
      and paid_amount = 400 and outstanding_amount = 600
      and derived_payment_status = 'partial'
  ) then
    raise exception 'Partial purchase balance is incorrect';
  end if;

  if not exists (
    select 1 from public.payroll_entry_totals
    where id = '24000000-0000-4000-8000-000000000021'
      and calculated_net_pay = 1150
      and total_paid_amount = 300
      and remaining_amount = 850
      and labor_cost = 1200
  ) then
    raise exception 'Payroll advance changed labor cost or net pay';
  end if;

  if not public.record_sms_crm_outcome(
    '24000000-0000-4000-8000-000000000060', now() + interval '3 days'
  ) then
    raise exception 'First SMS CRM bookkeeping did not run';
  end if;
  if public.record_sms_crm_outcome(
    '24000000-0000-4000-8000-000000000060', now() + interval '3 days'
  ) then
    raise exception 'SMS CRM bookkeeping retry was not idempotent';
  end if;
  if (
    select count(*) from public.followups
    where customer_id = '24000000-0000-4000-8000-000000000030'
      and notes = 'SMS accepted by provider'
  ) <> 1 then
    raise exception 'SMS CRM bookkeeping created duplicate follow-ups';
  end if;

  v_result := public.record_campaign_member_result(
    '24000000-0000-4000-8000-000000000042',
    '24000000-0000-4000-8000-000000000040',
    '24000000-0000-4000-8000-000000000041',
    'requested_price', 5000, null, 'Synthetic campaign result'
  );
  perform public.record_campaign_member_result(
    '24000000-0000-4000-8000-000000000042',
    '24000000-0000-4000-8000-000000000040',
    '24000000-0000-4000-8000-000000000041',
    'requested_price', 5000, null, 'Synthetic campaign result'
  );
  if (v_result ->> 'opportunity_id') is null then
    raise exception 'Campaign result did not create an opportunity';
  end if;
  if (
    select count(*) from public.followups
    where campaign_member_id = '24000000-0000-4000-8000-000000000041'
  ) <> 1 then
    raise exception 'Campaign retry created a duplicate follow-up';
  end if;
  if (
    select count(*) from public.sales_opportunities
    where campaign_member_id = '24000000-0000-4000-8000-000000000041'
  ) <> 1 then
    raise exception 'Campaign retry created a duplicate opportunity';
  end if;

  v_version := public.save_content_revision(
    '24000000-0000-4000-8000-000000000050',
    'Persisted edited caption', 'Persisted edited caption',
    '{"whatsapp_short_text":"Persisted edited caption"}'::jsonb,
    'edit'
  );
  if v_version <> 2 or not exists (
    select 1 from public.content_item_versions
    where content_item_id = '24000000-0000-4000-8000-000000000050'
      and version_number = 2 and caption = 'Persisted edited caption'
  ) then
    raise exception 'Content revision was not persisted';
  end if;

  if (select count(*) from public.content_items) <> 1 then
    raise exception 'Content item RLS exposed another owner';
  end if;
  if (select count(*) from public.whatsapp_templates) <> 1 then
    raise exception 'WhatsApp template RLS exposed another owner';
  end if;
  if exists (
    select 1 from public.customer_crm_summary
    where id = '24000000-0000-4000-8000-000000000031'
  ) then
    raise exception 'Customer summary exposed another owner';
  end if;
  if not exists (
    select 1 from public.customer_crm_summary
    where id = '24000000-0000-4000-8000-000000000030'
      and search_document like '%syn-024-owner%'
  ) then
    raise exception 'Customer search document was not generated';
  end if;

  if has_function_privilege(
    'anon',
    'public.record_campaign_member_result(uuid,uuid,uuid,text,numeric,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Anonymous role must not execute CRM mutations';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.sync_whatsapp_templates(uuid,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated role must not execute Meta template sync';
  end if;
  if has_function_privilege(
    'anon',
    'public.set_product_primary_asset(uuid,text,text,text,bigint)',
    'EXECUTE'
  ) then
    raise exception 'Anonymous role must not set product assets';
  end if;
  if has_function_privilege(
    'anon',
    'public.create_campaign_with_members(uuid,jsonb,uuid[])',
    'EXECUTE'
  ) then
    raise exception 'Anonymous role must not create campaigns';
  end if;
end
$checks$;

reset role;

set local role service_role;

do $template_sync$
declare
  v_result jsonb;
begin
  v_result := public.sync_whatsapp_templates(
    '24000000-0000-4000-8000-000000000001',
    'synthetic-waba',
    '[{"id":"meta-fresh","name":"synthetic_fresh","status":"APPROVED","language":"fa","category":"MARKETING","components":[],"variableCount":0}]'::jsonb
  );
  if (v_result ->> 'approved')::integer <> 1 then
    raise exception 'Template sync did not report approved templates';
  end if;
  if (select status from public.whatsapp_templates where name = 'synthetic_owner') <> 'NOT_SYNCED' then
    raise exception 'Template missing from Meta remained approved';
  end if;
  if (select status from public.whatsapp_templates where name = 'synthetic_other') <> 'APPROVED' then
    raise exception 'Template sync changed another owner';
  end if;
end
$template_sync$;

reset role;

do $metadata$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'content_items_owner_history_idx'
  ) then
    raise exception 'Content history index is missing';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'content_items'
      and policyname = 'Users can view own content'
  ) then
    raise exception 'Owner-only content policy is missing';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'sms_batches_owner_client_request_unique'
  ) then
    raise exception 'Campaign SMS request idempotency index is missing';
  end if;
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'sms_send_batches'
      and c.conname = 'sms_send_batches_status_check'
      and pg_get_constraintdef(c.oid) like '%unknown%'
  ) then
    raise exception 'Campaign SMS unknown state is not allowed';
  end if;
end
$metadata$;

select pass('Migration 024 finance, CRM idempotency, persistence and owner isolation');
select * from finish();

rollback;
