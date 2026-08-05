begin;

alter table public.content_items
  add column if not exists channel_payload jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'content_items_channel_payload_object_check'
      and conrelid = 'public.content_items'::regclass
  ) then
    alter table public.content_items
      add constraint content_items_channel_payload_object_check
      check (jsonb_typeof(channel_payload) = 'object');
  end if;
end
$$;

alter table public.customers
  add column if not exists whatsapp_consent_status text not null default 'unknown',
  add column if not exists whatsapp_consent_at timestamptz,
  add column if not exists whatsapp_consent_source text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customers_whatsapp_consent_status_check'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_whatsapp_consent_status_check
      check (whatsapp_consent_status in ('unknown', 'opted_in', 'opted_out'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'customers_whatsapp_consent_evidence_check'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_whatsapp_consent_evidence_check
      check (
        whatsapp_consent_status = 'unknown'
        or (
          whatsapp_consent_at is not null
          and length(trim(coalesce(whatsapp_consent_source, ''))) between 1 and 200
        )
      );
  end if;
end
$$;

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null,
  content_item_id uuid,
  client_request_id uuid not null,
  recipient text not null,
  message_type text not null,
  template_name text,
  template_variables jsonb not null default '[]'::jsonb,
  message_text text,
  image_url text,
  conversation_window_confirmed boolean not null default false,
  provider_message_id text,
  status text not null default 'pending_confirmation',
  provider_status text,
  provider_error_code text,
  provider_error_message text,
  accepted_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  provider_result_unknown_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_messages_customer_owner_fk
    foreign key (customer_id, owner_id)
    references public.customers (id, owner_id)
    on delete cascade,
  constraint whatsapp_messages_owner_client_request_unique
    unique (owner_id, client_request_id),
  constraint whatsapp_messages_type_check
    check (message_type in ('text', 'image', 'template')),
  constraint whatsapp_messages_status_check
    check (status in (
      'draft', 'pending_confirmation', 'accepted', 'sent',
      'delivered', 'read', 'failed', 'provider_result_unknown'
    )),
  constraint whatsapp_messages_recipient_check
    check (recipient ~ '^989[0-9]{9}$'),
  constraint whatsapp_messages_template_name_check
    check (template_name is null or template_name ~ '^[a-z0-9_]{1,512}$'),
  constraint whatsapp_messages_template_variables_check
    check (
      jsonb_typeof(template_variables) = 'array'
      and jsonb_array_length(template_variables) <= 20
    ),
  constraint whatsapp_messages_type_payload_check
    check (
      (message_type = 'text'
        and length(trim(coalesce(message_text, ''))) between 1 and 4096
        and conversation_window_confirmed)
      or (message_type = 'image'
        and image_url ~ '^https://'
        and length(trim(coalesce(message_text, ''))) between 0 and 1024
        and conversation_window_confirmed)
      or (message_type = 'template'
        and template_name is not null
        and message_text is null)
    ),
  constraint whatsapp_messages_provider_identity_check
    check (
      status not in ('accepted', 'sent', 'delivered', 'read')
      or length(trim(coalesce(provider_message_id, ''))) between 1 and 512
    ),
  constraint whatsapp_messages_provider_fields_length_check
    check (
      length(coalesce(provider_status, '')) <= 64
      and length(coalesce(provider_error_code, '')) <= 100
      and length(coalesce(provider_error_message, '')) <= 1000
    )
);

-- These ALTER statements make a controlled rerun safe if an earlier local test
-- created the table before this final version of migration 023.
alter table public.whatsapp_messages
  add column if not exists provider_result_unknown_at timestamptz;

create unique index if not exists whatsapp_messages_provider_message_id_unique
  on public.whatsapp_messages (provider_message_id)
  where provider_message_id is not null;

create unique index if not exists whatsapp_messages_id_owner_unique
  on public.whatsapp_messages (id, owner_id);

create unique index if not exists content_items_id_created_by_unique
  on public.content_items (id, created_by);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'whatsapp_messages_content_item_owner_fk'
      and conrelid = 'public.whatsapp_messages'::regclass
  ) then
    alter table public.whatsapp_messages
      add constraint whatsapp_messages_content_item_owner_fk
      foreign key (content_item_id, owner_id)
      references public.content_items (id, created_by)
      on delete no action;
  end if;
end
$$;

create index if not exists whatsapp_messages_owner_created_idx
  on public.whatsapp_messages (owner_id, created_at desc);

create index if not exists whatsapp_messages_customer_created_idx
  on public.whatsapp_messages (owner_id, customer_id, created_at desc);

create index if not exists whatsapp_messages_content_item_idx
  on public.whatsapp_messages (owner_id, content_item_id, created_at desc);

create table if not exists public.whatsapp_webhook_events (
  event_key text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  whatsapp_message_id uuid not null,
  provider_message_id text not null,
  provider_status text not null,
  provider_timestamp timestamptz,
  created_at timestamptz not null default now(),
  constraint whatsapp_webhook_events_message_owner_fk
    foreign key (whatsapp_message_id, owner_id)
    references public.whatsapp_messages (id, owner_id)
    on delete cascade,
  constraint whatsapp_webhook_events_key_check
    check (event_key ~ '^[a-f0-9]{64}$'),
  constraint whatsapp_webhook_events_provider_message_id_check
    check (length(trim(provider_message_id)) between 1 and 512),
  constraint whatsapp_webhook_events_provider_status_check
    check (provider_status in ('sent', 'delivered', 'read', 'failed'))
);

create index if not exists whatsapp_webhook_events_message_idx
  on public.whatsapp_webhook_events (whatsapp_message_id, created_at desc);

alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_webhook_events enable row level security;

drop policy if exists "Users can view own WhatsApp messages"
  on public.whatsapp_messages;
create policy "Users can view own WhatsApp messages"
  on public.whatsapp_messages
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Users can create own WhatsApp messages"
  on public.whatsapp_messages;
drop policy if exists "Users can update own WhatsApp messages"
  on public.whatsapp_messages;
drop policy if exists "Users can delete own WhatsApp messages"
  on public.whatsapp_messages;

drop policy if exists "Users can view own WhatsApp webhook events"
  on public.whatsapp_webhook_events;
create policy "Users can view own WhatsApp webhook events"
  on public.whatsapp_webhook_events
  for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Users can create own WhatsApp webhook events"
  on public.whatsapp_webhook_events;
drop policy if exists "Users can update own WhatsApp webhook events"
  on public.whatsapp_webhook_events;
drop policy if exists "Users can delete own WhatsApp webhook events"
  on public.whatsapp_webhook_events;

revoke all on table public.whatsapp_messages from public, anon, authenticated;
revoke all on table public.whatsapp_webhook_events from public, anon, authenticated;
grant select on table public.whatsapp_messages to authenticated;
grant select on table public.whatsapp_webhook_events to authenticated;
grant select, insert, update, delete on table public.whatsapp_messages to service_role;
grant select, insert, update, delete on table public.whatsapp_webhook_events to service_role;

create or replace function public.touch_whatsapp_message_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_whatsapp_message_updated_at() from public, anon, authenticated;

drop trigger if exists whatsapp_messages_touch_updated_at
  on public.whatsapp_messages;
create trigger whatsapp_messages_touch_updated_at
before update on public.whatsapp_messages
for each row execute function public.touch_whatsapp_message_updated_at();

create or replace function public.process_whatsapp_webhook_status(
  p_event_key text,
  p_provider_message_id text,
  p_status text,
  p_provider_timestamp timestamptz default null,
  p_error_code text default null,
  p_error_message text default null
)
returns table (
  outcome text,
  whatsapp_message_id uuid,
  previous_status text,
  resulting_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.whatsapp_messages%rowtype;
  v_event_inserted boolean := false;
  v_apply boolean := false;
begin
  if p_event_key is null or p_event_key !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid webhook event key';
  end if;
  if length(trim(coalesce(p_provider_message_id, ''))) not between 1 and 512 then
    raise exception using errcode = '22023', message = 'Invalid provider message id';
  end if;
  if p_status not in ('sent', 'delivered', 'read', 'failed') then
    raise exception using errcode = '22023', message = 'Invalid provider status';
  end if;
  if length(coalesce(p_error_code, '')) > 100
     or length(coalesce(p_error_message, '')) > 500 then
    raise exception using errcode = '22023', message = 'Invalid provider error metadata';
  end if;

  select message.*
  into v_message
  from public.whatsapp_messages as message
  where message.provider_message_id = p_provider_message_id
  for update;

  if not found then
    return query select 'untracked'::text, null::uuid, null::text, null::text;
    return;
  end if;

  insert into public.whatsapp_webhook_events (
    event_key,
    owner_id,
    whatsapp_message_id,
    provider_message_id,
    provider_status,
    provider_timestamp
  ) values (
    p_event_key,
    v_message.owner_id,
    v_message.id,
    p_provider_message_id,
    p_status,
    p_provider_timestamp
  )
  on conflict (event_key) do nothing
  returning true into v_event_inserted;

  if not coalesce(v_event_inserted, false) and exists (
    select 1
    from public.whatsapp_webhook_events as existing_event
    where existing_event.event_key = p_event_key
      and (
        existing_event.whatsapp_message_id <> v_message.id
        or existing_event.provider_message_id <> p_provider_message_id
        or existing_event.provider_status <> p_status
      )
  ) then
    raise exception using errcode = '22023', message = 'Webhook event key collision';
  end if;

  -- Explicit transition matrix. Success notifications may skip intermediate
  -- states when Meta delivers them out of order, but terminal states never regress.
  v_apply := case
    when v_message.status = p_status then false
    when p_status = 'failed' then
      v_message.status in (
        'draft', 'pending_confirmation', 'accepted', 'sent',
        'provider_result_unknown'
      )
    when v_message.status in ('failed', 'read') then false
    when v_message.status = 'delivered' then p_status = 'read'
    when v_message.status = 'sent' then p_status in ('delivered', 'read')
    when v_message.status = 'accepted' then p_status in ('sent', 'delivered', 'read')
    when v_message.status in ('draft', 'pending_confirmation', 'provider_result_unknown') then
      p_status in ('sent', 'delivered', 'read')
    else false
  end;

  if v_apply then
    update public.whatsapp_messages
    set
      status = p_status,
      provider_status = p_status,
      provider_error_code = case when p_status = 'failed' then p_error_code else null end,
      provider_error_message = case when p_status = 'failed' then p_error_message else null end,
      sent_at = case
        when p_status = 'sent' then coalesce(sent_at, p_provider_timestamp, now())
        else sent_at
      end,
      delivered_at = case
        when p_status = 'delivered' then coalesce(delivered_at, p_provider_timestamp, now())
        else delivered_at
      end,
      read_at = case
        when p_status = 'read' then coalesce(read_at, p_provider_timestamp, now())
        else read_at
      end,
      failed_at = case
        when p_status = 'failed' then coalesce(failed_at, p_provider_timestamp, now())
        else failed_at
      end
    where id = v_message.id;
  end if;

  return query
  select
    case
      when v_apply and not coalesce(v_event_inserted, false) then 'reconciled'
      when v_apply then 'applied'
      when not coalesce(v_event_inserted, false) then 'duplicate'
      else 'ignored'
    end,
    v_message.id,
    v_message.status,
    case when v_apply then p_status else v_message.status end;
end;
$$;

revoke all on function public.process_whatsapp_webhook_status(
  text, text, text, timestamptz, text, text
) from public, anon, authenticated;
grant execute on function public.process_whatsapp_webhook_status(
  text, text, text, timestamptz, text, text
) to service_role;

commit;
