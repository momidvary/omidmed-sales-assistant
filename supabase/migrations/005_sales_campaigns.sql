-- OmidMed Sales Assistant
-- Sales campaigns and quote follow-up pipeline
-- Version: 005

begin;

-- =========================================================
-- 1) Campaigns
-- =========================================================
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,

  name text not null,
  campaign_type text not null default 'reactivation'
    check (campaign_type in ('reactivation', 'product', 'price_followup', 'seasonal', 'custom')),
  channel text not null default 'phone'
    check (channel in ('phone', 'sms', 'whatsapp', 'mixed')),
  status text not null default 'active'
    check (status in ('draft', 'active', 'completed', 'archived')),

  target_product text,
  target_city text,
  min_days_inactive integer not null default 0
    check (min_days_inactive >= 0),
  priority_filter text not null default 'all'
    check (priority_filter in ('all', 'urgent', 'vip', 'high', 'normal', 'low')),

  message_template text,
  notes text,
  filters jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, owner_id)
);

create index if not exists campaigns_owner_status_created_idx
  on public.campaigns (owner_id, status, created_at desc);

-- =========================================================
-- 2) Campaign members / targets
-- =========================================================
create table if not exists public.campaign_members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  campaign_id uuid not null,
  customer_id uuid not null,

  status text not null default 'pending'
    check (
      status in (
        'pending',
        'contacted',
        'requested_price',
        'ordered',
        'no_answer',
        'no_need',
        'follow_up',
        'lost'
      )
    ),
  contacted_at timestamptz,
  responded_at timestamptz,
  ordered_at timestamptz,
  next_followup_at timestamptz,
  order_value numeric(18, 0)
    check (order_value is null or order_value >= 0),
  lost_reason text
    check (
      lost_reason is null
      or lost_reason in (
        'price',
        'shipping',
        'timing',
        'competitor',
        'quality',
        'stock_available',
        'no_answer',
        'other'
      )
    ),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, owner_id),
  unique (campaign_id, customer_id),

  constraint campaign_members_campaign_owner_fk
    foreign key (campaign_id, owner_id)
    references public.campaigns (id, owner_id)
    on delete cascade,

  constraint campaign_members_customer_owner_fk
    foreign key (customer_id, owner_id)
    references public.customers (id, owner_id)
    on delete cascade
);

create index if not exists campaign_members_owner_campaign_status_idx
  on public.campaign_members (owner_id, campaign_id, status);

create index if not exists campaign_members_owner_next_followup_idx
  on public.campaign_members (owner_id, next_followup_at);

create index if not exists campaign_members_owner_customer_idx
  on public.campaign_members (owner_id, customer_id);

-- =========================================================
-- 3) Open quotes / sales opportunities
-- =========================================================
create table if not exists public.sales_opportunities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  customer_id uuid not null,
  campaign_id uuid,
  campaign_member_id uuid,

  status text not null default 'open'
    check (status in ('open', 'on_hold', 'won', 'lost')),
  stage text not null default 'quote_sent'
    check (stage in ('quote_sent', 'followup_1', 'followup_2', 'final_followup')),
  source text not null default 'followup'
    check (source in ('manual', 'campaign', 'followup')),

  product_interest text,
  quoted_at timestamptz not null default now(),
  last_contact_at timestamptz,
  next_followup_at timestamptz,
  estimated_value numeric(18, 0)
    check (estimated_value is null or estimated_value >= 0),
  final_value numeric(18, 0)
    check (final_value is null or final_value >= 0),
  lost_reason text
    check (
      lost_reason is null
      or lost_reason in (
        'price',
        'shipping',
        'timing',
        'competitor',
        'quality',
        'stock_available',
        'no_answer',
        'other'
      )
    ),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, owner_id),

  constraint sales_opportunities_customer_owner_fk
    foreign key (customer_id, owner_id)
    references public.customers (id, owner_id)
    on delete cascade,

  constraint sales_opportunities_campaign_owner_fk
    foreign key (campaign_id, owner_id)
    references public.campaigns (id, owner_id)
    on delete set null (campaign_id),

  constraint sales_opportunities_member_owner_fk
    foreign key (campaign_member_id, owner_id)
    references public.campaign_members (id, owner_id)
    on delete set null (campaign_member_id)
);

create unique index if not exists sales_opportunities_one_open_per_customer
  on public.sales_opportunities (owner_id, customer_id)
  where status in ('open', 'on_hold');

create index if not exists sales_opportunities_owner_status_due_idx
  on public.sales_opportunities (owner_id, status, next_followup_at);

create index if not exists sales_opportunities_owner_campaign_idx
  on public.sales_opportunities (owner_id, campaign_id);

-- =========================================================
-- 4) Link ordinary follow-ups to a campaign/opportunity
-- =========================================================
alter table public.followups
  add column if not exists campaign_id uuid,
  add column if not exists campaign_member_id uuid,
  add column if not exists opportunity_id uuid;

alter table public.followups
  drop constraint if exists followups_campaign_owner_fk;
alter table public.followups
  add constraint followups_campaign_owner_fk
  foreign key (campaign_id, owner_id)
  references public.campaigns (id, owner_id)
  on delete set null (campaign_id);

alter table public.followups
  drop constraint if exists followups_campaign_member_owner_fk;
alter table public.followups
  add constraint followups_campaign_member_owner_fk
  foreign key (campaign_member_id, owner_id)
  references public.campaign_members (id, owner_id)
  on delete set null (campaign_member_id);

alter table public.followups
  drop constraint if exists followups_opportunity_owner_fk;
alter table public.followups
  add constraint followups_opportunity_owner_fk
  foreign key (opportunity_id, owner_id)
  references public.sales_opportunities (id, owner_id)
  on delete set null (opportunity_id);

create index if not exists followups_owner_campaign_idx
  on public.followups (owner_id, campaign_id);

create index if not exists followups_owner_opportunity_idx
  on public.followups (owner_id, opportunity_id);

-- =========================================================
-- 5) updated_at triggers
-- =========================================================
drop trigger if exists campaigns_set_updated_at on public.campaigns;
create trigger campaigns_set_updated_at
before update on public.campaigns
for each row execute function public.set_updated_at();

drop trigger if exists campaign_members_set_updated_at on public.campaign_members;
create trigger campaign_members_set_updated_at
before update on public.campaign_members
for each row execute function public.set_updated_at();

drop trigger if exists sales_opportunities_set_updated_at on public.sales_opportunities;
create trigger sales_opportunities_set_updated_at
before update on public.sales_opportunities
for each row execute function public.set_updated_at();

-- =========================================================
-- 6) Automatically turn a price request into an opportunity
-- =========================================================
create or replace function public.sync_followup_to_opportunity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  opportunity_uuid uuid;
begin
  if new.outcome = 'requested_price' then
    select so.id
      into opportunity_uuid
    from public.sales_opportunities so
    where so.owner_id = new.owner_id
      and so.customer_id = new.customer_id
      and so.status in ('open', 'on_hold')
    order by so.updated_at desc
    limit 1;

    if opportunity_uuid is null then
      insert into public.sales_opportunities (
        owner_id,
        customer_id,
        campaign_id,
        campaign_member_id,
        status,
        stage,
        source,
        quoted_at,
        last_contact_at,
        next_followup_at,
        estimated_value,
        notes
      ) values (
        new.owner_id,
        new.customer_id,
        new.campaign_id,
        new.campaign_member_id,
        'open',
        'quote_sent',
        case when new.campaign_id is null then 'followup' else 'campaign' end,
        new.followup_at,
        new.followup_at,
        coalesce(new.next_followup_at, new.followup_at + interval '1 day'),
        new.potential_value,
        new.notes
      )
      returning id into opportunity_uuid;
    else
      update public.sales_opportunities
      set status = 'open',
          stage = 'quote_sent',
          campaign_id = coalesce(new.campaign_id, campaign_id),
          campaign_member_id = coalesce(new.campaign_member_id, campaign_member_id),
          quoted_at = new.followup_at,
          last_contact_at = new.followup_at,
          next_followup_at = coalesce(new.next_followup_at, new.followup_at + interval '1 day'),
          estimated_value = coalesce(new.potential_value, estimated_value),
          lost_reason = null,
          notes = coalesce(new.notes, notes)
      where id = opportunity_uuid;
    end if;

    update public.followups
      set opportunity_id = opportunity_uuid
      where id = new.id
        and opportunity_id is null;

  elsif new.outcome = 'order_placed' then
    update public.sales_opportunities
    set status = 'won',
        last_contact_at = new.followup_at,
        next_followup_at = null,
        final_value = coalesce(new.potential_value, estimated_value),
        lost_reason = null
    where owner_id = new.owner_id
      and customer_id = new.customer_id
      and status in ('open', 'on_hold');

  elsif new.outcome = 'lost' then
    update public.sales_opportunities
    set status = 'lost',
        last_contact_at = new.followup_at,
        next_followup_at = null,
        lost_reason = coalesce(lost_reason, 'other')
    where owner_id = new.owner_id
      and customer_id = new.customer_id
      and status in ('open', 'on_hold');

  elsif new.outcome = 'no_need' then
    update public.sales_opportunities
    set status = 'on_hold',
        last_contact_at = new.followup_at,
        next_followup_at = coalesce(new.next_followup_at, new.followup_at + interval '30 days')
    where owner_id = new.owner_id
      and customer_id = new.customer_id
      and status = 'open';
  end if;

  return new;
end;
$$;

drop trigger if exists followups_sync_opportunity on public.followups;
create trigger followups_sync_opportunity
after insert on public.followups
for each row execute function public.sync_followup_to_opportunity();

-- =========================================================
-- 7) Campaign performance view
-- =========================================================
create or replace view public.campaign_performance_summary
with (security_invoker = true)
as
select
  c.*,
  count(cm.id)::integer as target_count,
  count(cm.id) filter (where cm.status <> 'pending')::integer as contacted_count,
  count(cm.id) filter (
    where cm.status in ('requested_price', 'ordered', 'no_need', 'follow_up', 'lost')
  )::integer as response_count,
  count(cm.id) filter (where cm.status = 'requested_price')::integer as requested_price_count,
  count(cm.id) filter (where cm.status = 'ordered')::integer as ordered_count,
  count(cm.id) filter (where cm.status = 'no_answer')::integer as no_answer_count,
  count(cm.id) filter (where cm.status = 'no_need')::integer as no_need_count,
  coalesce(sum(cm.order_value) filter (where cm.status = 'ordered'), 0)::numeric(18, 0)
    as order_value,
  case
    when count(cm.id) = 0 then 0
    else round(
      (count(cm.id) filter (where cm.status = 'ordered')::numeric / count(cm.id)::numeric) * 100,
      2
    )
  end as conversion_rate
from public.campaigns c
left join public.campaign_members cm
  on cm.owner_id = c.owner_id
 and cm.campaign_id = c.id
group by c.id;

-- =========================================================
-- 8) Backfill open opportunities from previous price requests
-- =========================================================
with latest_followup as (
  select distinct on (f.owner_id, f.customer_id)
    f.owner_id,
    f.customer_id,
    f.followup_at,
    f.next_followup_at,
    f.notes,
    f.outcome
  from public.followups f
  order by f.owner_id, f.customer_id, f.followup_at desc
),
eligible as (
  select lf.*
  from latest_followup lf
  left join public.customer_sales_summary css
    on css.owner_id = lf.owner_id
   and css.id = lf.customer_id
  where lf.outcome = 'requested_price'
    and (
      css.last_purchase_at is null
      or lf.followup_at::date > css.last_purchase_at
    )
)
insert into public.sales_opportunities (
  owner_id,
  customer_id,
  status,
  stage,
  source,
  quoted_at,
  last_contact_at,
  next_followup_at,
  notes
)
select
  e.owner_id,
  e.customer_id,
  'open',
  'quote_sent',
  'followup',
  e.followup_at,
  e.followup_at,
  coalesce(e.next_followup_at, e.followup_at + interval '1 day'),
  e.notes
from eligible e
where not exists (
  select 1
  from public.sales_opportunities so
  where so.owner_id = e.owner_id
    and so.customer_id = e.customer_id
    and so.status in ('open', 'on_hold')
);

-- =========================================================
-- 9) Row Level Security
-- =========================================================
alter table public.campaigns enable row level security;
alter table public.campaign_members enable row level security;
alter table public.sales_opportunities enable row level security;

drop policy if exists "Owner manages own campaigns" on public.campaigns;
create policy "Owner manages own campaigns"
on public.campaigns
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Owner manages own campaign members" on public.campaign_members;
create policy "Owner manages own campaign members"
on public.campaign_members
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Owner manages own opportunities" on public.sales_opportunities;
create policy "Owner manages own opportunities"
on public.sales_opportunities
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

-- =========================================================
-- 10) API permissions
-- =========================================================
revoke all on table public.campaigns from anon;
revoke all on table public.campaign_members from anon;
revoke all on table public.sales_opportunities from anon;
revoke all on table public.campaign_performance_summary from anon;

grant select, insert, update, delete
  on table public.campaigns to authenticated;
grant select, insert, update, delete
  on table public.campaign_members to authenticated;
grant select, insert, update, delete
  on table public.sales_opportunities to authenticated;
grant select
  on table public.campaign_performance_summary to authenticated;

commit;

-- Verification
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('campaigns', 'campaign_members', 'sales_opportunities')
order by table_name;
