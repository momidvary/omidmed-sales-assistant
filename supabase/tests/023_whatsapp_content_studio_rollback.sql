-- Rollback-only regression test for migration 023.
-- Run only against a disposable local/test Supabase database after migrations.

begin;

do $test$
declare
  v_owner_id uuid := '23000000-0000-4000-8000-000000000001';
  v_other_id uuid := '23000000-0000-4000-8000-000000000002';
  v_customer_id uuid := '23000000-0000-4000-8000-000000000003';
  v_other_customer_id uuid := '23000000-0000-4000-8000-000000000004';
  v_content_id uuid := '23000000-0000-4000-8000-000000000005';
  v_other_content_id uuid := '23000000-0000-4000-8000-000000000006';
  v_message_id uuid := '23000000-0000-4000-8000-000000000007';
  v_other_message_id uuid := '23000000-0000-4000-8000-000000000008';
  v_outcome text;
  v_delivered_at timestamptz;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change
  ) values
    (
      '00000000-0000-0000-0000-000000000000', v_owner_id,
      'authenticated', 'authenticated', 'whatsapp-023-owner@example.invalid', '',
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', ''
    ),
    (
      '00000000-0000-0000-0000-000000000000', v_other_id,
      'authenticated', 'authenticated', 'whatsapp-023-other@example.invalid', '',
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '', ''
    );

  insert into public.customers (id, owner_id, customer_code, name)
  values
    (v_customer_id, v_owner_id, 'WA-023-OWNER', 'Synthetic owner'),
    (v_other_customer_id, v_other_id, 'WA-023-OTHER', 'Synthetic other owner');

  insert into public.content_items (
    id, created_by, title, topic, objective, audience, channel, format, caption
  ) values
    (v_content_id, v_owner_id, 'Synthetic WhatsApp content', 'Test', 'test',
      'test', 'whatsapp', 'post', 'Synthetic content'),
    (v_other_content_id, v_other_id, 'Other WhatsApp content', 'Test', 'test',
      'test', 'whatsapp', 'post', 'Synthetic content');

  insert into public.whatsapp_messages (
    id, owner_id, customer_id, content_item_id, client_request_id,
    recipient, message_type, message_text, conversation_window_confirmed,
    provider_message_id, status, accepted_at
  ) values
    (
      v_message_id, v_owner_id, v_customer_id, v_content_id,
      '23000000-0000-4000-8000-000000000009', '989111111111',
      'text', 'Synthetic message', true, 'wamid.test-023-owner', 'accepted', now()
    ),
    (
      v_other_message_id, v_other_id, v_other_customer_id, v_other_content_id,
      '23000000-0000-4000-8000-000000000010', '989222222222',
      'text', 'Synthetic message', true, 'wamid.test-023-other', 'accepted', now()
    );

  -- Simulate the old bug: the event exists but the message update never happened.
  insert into public.whatsapp_webhook_events (
    event_key, owner_id, whatsapp_message_id, provider_message_id,
    provider_status, provider_timestamp
  ) values (
    repeat('a', 64), v_owner_id, v_message_id, 'wamid.test-023-owner',
    'delivered', '2026-01-01T00:00:00Z'
  );

  select result.outcome
  into v_outcome
  from public.process_whatsapp_webhook_status(
    repeat('a', 64), 'wamid.test-023-owner', 'delivered',
    '2026-01-01T00:00:00Z', null, null
  ) as result;
  if v_outcome <> 'reconciled' then
    raise exception 'Expected duplicate event reconciliation, got %', v_outcome;
  end if;

  select delivered_at into v_delivered_at
  from public.whatsapp_messages where id = v_message_id;
  if v_delivered_at <> '2026-01-01T00:00:00Z'::timestamptz then
    raise exception 'Delivered timestamp was not persisted';
  end if;

  select result.outcome
  into v_outcome
  from public.process_whatsapp_webhook_status(
    repeat('a', 64), 'wamid.test-023-owner', 'delivered',
    '2026-01-01T00:00:00Z', null, null
  ) as result;
  if v_outcome <> 'duplicate' then
    raise exception 'Expected idempotent duplicate result, got %', v_outcome;
  end if;

  perform public.process_whatsapp_webhook_status(
    repeat('b', 64), 'wamid.test-023-owner', 'failed',
    '2026-01-01T00:00:01Z', 'test', 'Synthetic error'
  );
  if (select status from public.whatsapp_messages where id = v_message_id) <> 'delivered' then
    raise exception 'Delivered status regressed to failed';
  end if;

  perform public.process_whatsapp_webhook_status(
    repeat('c', 64), 'wamid.test-023-owner', 'read',
    '2026-01-01T00:00:02Z', null, null
  );
  perform public.process_whatsapp_webhook_status(
    repeat('d', 64), 'wamid.test-023-owner', 'sent',
    '2026-01-01T00:00:03Z', null, null
  );
  if (select status from public.whatsapp_messages where id = v_message_id) <> 'read' then
    raise exception 'Read status regressed after a late sent event';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.process_whatsapp_webhook_status(text,text,text,timestamptz,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated role must not execute the webhook RPC';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.process_whatsapp_webhook_status(text,text,text,timestamptz,text,text)',
    'EXECUTE'
  ) then
    raise exception 'Service role must execute the webhook RPC';
  end if;
  if has_table_privilege('authenticated', 'public.whatsapp_messages', 'INSERT') then
    raise exception 'Authenticated role must not insert WhatsApp messages';
  end if;
end
$test$;

-- Prove owner isolation with the same claims shape used by Supabase Auth.
set local role authenticated;
set local "request.jwt.claim.sub" = '23000000-0000-4000-8000-000000000001';

do $rls$
begin
  if (select count(*) from public.whatsapp_messages) <> 1 then
    raise exception 'RLS exposed another owner message';
  end if;
  if (select count(*) from public.whatsapp_webhook_events) <> 4 then
    raise exception 'RLS exposed another owner webhook event';
  end if;
end
$rls$;

reset role;

-- Any failure after event insertion must roll the event back. The temporary
-- trigger deliberately fails the message update inside the RPC transaction.
create function pg_temp.reject_whatsapp_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Synthetic update failure';
end;
$$;

create trigger whatsapp_023_reject_update
before update on public.whatsapp_messages
for each row execute function pg_temp.reject_whatsapp_update();

do $atomicity$
begin
  begin
    perform public.process_whatsapp_webhook_status(
      repeat('e', 64), 'wamid.test-023-other', 'sent',
      '2026-01-01T00:00:04Z', null, null
    );
    raise exception 'Expected synthetic update failure';
  exception
    when others then
      if sqlerrm = 'Expected synthetic update failure' then
        raise;
      end if;
  end;

  if exists (
    select 1 from public.whatsapp_webhook_events where event_key = repeat('e', 64)
  ) then
    raise exception 'Webhook event survived a failed message update';
  end if;
  if (
    select status from public.whatsapp_messages
    where provider_message_id = 'wamid.test-023-other'
  ) <> 'accepted' then
    raise exception 'Message changed despite transaction failure';
  end if;
end
$atomicity$;

drop trigger whatsapp_023_reject_update on public.whatsapp_messages;

rollback;
