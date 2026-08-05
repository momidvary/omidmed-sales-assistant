begin;

alter table public.content_items
  add column if not exists channel_payload jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
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
    select 1 from pg_constraint
    where conname = 'customers_whatsapp_consent_status_check'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_whatsapp_consent_status_check
      check (whatsapp_consent_status in ('unknown', 'opted_in', 'opted_out'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
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
  content_item_id uuid references public.content_items(id) on delete set null,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_messages_customer_owner_fk
    foreign key (customer_id, owner_id)
    references public.customers (id, owner_id)
    on delete cascade,
  constraint whatsapp_messages_type_check
    check (message_type in ('text', 'image', 'template')),
  constraint whatsapp_messages_status_check
    check (status in (
      'draft', 'pending_confirmation', 'accepted', 'sent',
      'delivered', 'read', 'failed'
    )),
  constraint whatsapp_messages_recipient_check
    check (recipient ~ '^989[0-9]{9}$'),
  constraint whatsapp_messages_template_name_check
    check (
      template_name is null
      or template_name ~ '^[a-z0-9_]{1,512}$'
    ),
  constraint whatsapp_messages_template_variables_check
    check (jsonb_typeof(template_variables) = 'array'),
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
        and template_name is not null)
    ),
  constraint whatsapp_messages_provider_status_check
    check (
      status not in ('accepted', 'sent', 'delivered', 'read')
      or provider_message_id is not null
    ),
  unique (owner_id, client_request_id)
);

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
    select 1 from pg_constraint
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
    on delete cascade
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

drop policy if exists "Users can view own WhatsApp webhook events"
  on public.whatsapp_webhook_events;
create policy "Users can view own WhatsApp webhook events"
  on public.whatsapp_webhook_events
  for select to authenticated
  using (owner_id = (select auth.uid()));

revoke all on table public.whatsapp_messages from anon;
revoke all on table public.whatsapp_webhook_events from anon;
revoke all on table public.whatsapp_messages from authenticated;
revoke insert, update, delete on table public.whatsapp_webhook_events from authenticated;
grant select on table public.whatsapp_messages to authenticated;
grant select on table public.whatsapp_webhook_events to authenticated;

drop trigger if exists whatsapp_messages_touch_updated_at
  on public.whatsapp_messages;
create trigger whatsapp_messages_touch_updated_at
before update on public.whatsapp_messages
for each row execute function public.touch_content_item();

commit;
