-- OmidMed Sales Assistant
-- 011: MeliPayamak SMS sending, batches and logs

begin;

create table if not exists public.sms_send_batches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  campaign_id uuid,
  mode text not null default 'multiple' check (mode in ('simple', 'multiple', 'pattern')),
  sender text not null,
  total_count integer not null default 0 check (total_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  status text not null default 'processing' check (status in ('processing', 'completed', 'partial', 'failed')),
  provider_status text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  constraint sms_batches_campaign_owner_fk
    foreign key (campaign_id, owner_id)
    references public.campaigns (id, owner_id)
    on delete set null (campaign_id)
);

create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  batch_id uuid,
  customer_id uuid,
  campaign_id uuid,
  campaign_member_id uuid,
  opportunity_id uuid,
  source text not null default 'manual' check (source in ('manual', 'customer', 'quote', 'campaign', 'accounting')),
  mode text not null default 'simple' check (mode in ('simple', 'multiple', 'pattern')),
  sender text not null,
  recipient text not null,
  message_text text not null,
  provider_rec_id text,
  request_success boolean not null default false,
  provider_status text,
  delivery_status text not null default 'unknown' check (delivery_status in ('unknown', 'accepted', 'rejected', 'delivered', 'undelivered', 'failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  constraint sms_messages_batch_owner_fk
    foreign key (batch_id, owner_id)
    references public.sms_send_batches (id, owner_id)
    on delete set null (batch_id),
  constraint sms_messages_customer_owner_fk
    foreign key (customer_id, owner_id)
    references public.customers (id, owner_id)
    on delete set null (customer_id),
  constraint sms_messages_campaign_owner_fk
    foreign key (campaign_id, owner_id)
    references public.campaigns (id, owner_id)
    on delete set null (campaign_id),
  constraint sms_messages_member_owner_fk
    foreign key (campaign_member_id, owner_id)
    references public.campaign_members (id, owner_id)
    on delete set null (campaign_member_id),
  constraint sms_messages_opportunity_owner_fk
    foreign key (opportunity_id, owner_id)
    references public.sales_opportunities (id, owner_id)
    on delete set null (opportunity_id)
);

create index if not exists sms_messages_owner_created_idx on public.sms_messages (owner_id, created_at desc);
create index if not exists sms_messages_owner_customer_idx on public.sms_messages (owner_id, customer_id, created_at desc);
create index if not exists sms_messages_owner_campaign_idx on public.sms_messages (owner_id, campaign_id, created_at desc);
create index if not exists sms_messages_owner_rec_id_idx on public.sms_messages (owner_id, provider_rec_id) where provider_rec_id is not null;
create index if not exists sms_batches_owner_created_idx on public.sms_send_batches (owner_id, created_at desc);

alter table public.sms_send_batches enable row level security;
alter table public.sms_messages enable row level security;

drop policy if exists "Owner manages own sms batches" on public.sms_send_batches;
create policy "Owner manages own sms batches"
on public.sms_send_batches for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Owner manages own sms messages" on public.sms_messages;
create policy "Owner manages own sms messages"
on public.sms_messages for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

revoke all on table public.sms_send_batches from anon;
revoke all on table public.sms_messages from anon;
grant select, insert, update, delete on table public.sms_send_batches to authenticated;
grant select, insert, update, delete on table public.sms_messages to authenticated;

drop trigger if exists sms_send_batches_set_updated_at on public.sms_send_batches;
create trigger sms_send_batches_set_updated_at
before update on public.sms_send_batches
for each row execute function public.set_updated_at();

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('sms_send_batches', 'sms_messages')
order by table_name;
