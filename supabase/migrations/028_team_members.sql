-- OmidMed Sales Assistant
-- 028: Team members (a secretary working in the owner's data).
--
-- Every row belongs to the owner's account (owner_id). A team member logs in
-- with their own user and works in the owner's sales data: customers,
-- invoices, follow-ups, SMS, quotes and campaigns. Bank accounting, Holoo
-- sync history and the old management-accounting tables stay owner-only,
-- enforced here by RLS, not only by the menu.
--
-- public.current_owner_id() is the account a request works in: the owner's
-- id for a team member, the user's own id for everyone else. Policies and
-- column defaults of shared tables use it instead of auth.uid().

begin;

-- =========================================================
-- 1) Team membership
-- =========================================================
create table if not exists public.team_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'secretary' check (role in ('secretary')),
  display_name text not null check (length(display_name) between 1 and 60),
  created_at timestamptz not null default now(),
  constraint team_members_not_self check (user_id <> owner_id)
);

create index if not exists team_members_owner_idx on public.team_members (owner_id);

alter table public.team_members enable row level security;

drop policy if exists "Owner and member read team" on public.team_members;
create policy "Owner and member read team"
on public.team_members for select to authenticated
using (owner_id = (select auth.uid()) or user_id = (select auth.uid()));

-- Members are added and removed by the server (service role) after the
-- owner's request is checked; nobody writes this table directly.
revoke all on table public.team_members from anon;
revoke insert, update, delete on table public.team_members from authenticated;
grant select on table public.team_members to authenticated;

create or replace function public.current_owner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select tm.owner_id from public.team_members tm where tm.user_id = auth.uid()),
    auth.uid()
  );
$$;

-- 'owner' or the member's role; null when not logged in.
create or replace function public.current_team_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then null
    else coalesce((select tm.role from public.team_members tm where tm.user_id = auth.uid()), 'owner')
  end;
$$;

revoke all on function public.current_owner_id() from public, anon;
revoke all on function public.current_team_role() from public, anon;
grant execute on function public.current_owner_id() to authenticated;
grant execute on function public.current_team_role() to authenticated;

-- =========================================================
-- 2) Shared sales tables: policies and defaults follow the owner
-- =========================================================
do $$
declare
  v_table text;
  v_policy record;
  v_shared text[] := array[
    'customers', 'customer_files', 'sales', 'followups', 'tasks',
    'invoices', 'invoice_items', 'campaigns', 'campaign_members',
    'sales_opportunities', 'sms_messages', 'sms_send_batches'
  ];
begin
  foreach v_table in array v_shared loop
    for v_policy in
      select policyname from pg_policies where schemaname = 'public' and tablename = v_table
    loop
      execute format('drop policy %I on public.%I', v_policy.policyname, v_table);
    end loop;
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (owner_id = (select public.current_owner_id()))
         with check (owner_id = (select public.current_owner_id()))',
      'Team manages owner ' || v_table, v_table
    );
    execute format(
      'alter table public.%I alter column owner_id set default public.current_owner_id()', v_table
    );
  end loop;
end;
$$;

-- Read-only Holoo code mapping used by the customer pages.
drop policy if exists "Owner reads own Holoo customer codes" on public.customer_holoo_codes;
drop policy if exists "Team reads owner Holoo customer codes" on public.customer_holoo_codes;
create policy "Team reads owner Holoo customer codes"
on public.customer_holoo_codes for select to authenticated
using (owner_id = (select public.current_owner_id()));

-- Idempotency keys written by the CRM functions.
alter table public.crm_mutation_requests
  alter column owner_id set default public.current_owner_id();

-- =========================================================
-- 3) CRM functions work in the owner's account
-- =========================================================
-- Each of them starts with exactly this assignment; anything else means the
-- function changed and must be reviewed by hand rather than rewritten.
do $$
declare
  v_name text;
  v_oid oid;
  v_def text;
  v_old constant text := 'v_owner_id uuid := auth.uid();';
  v_new constant text := 'v_owner_id uuid := public.current_owner_id();';
begin
  foreach v_name in array array[
    'create_campaign_with_members', 'record_campaign_member_result', 'record_customer_followup',
    'record_sms_crm_outcome', 'transition_crm_prospect', 'transition_sales_opportunity'
  ] loop
    for v_oid in
      select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_name
    loop
      v_def := pg_get_functiondef(v_oid);
      if position(v_new in v_def) > 0 then
        continue; -- already migrated
      end if;
      if position(v_old in v_def) = 0 then
        raise exception 'Function % does not start with the expected owner assignment', v_name;
      end if;
      execute replace(v_def, v_old, v_new);
    end loop;
  end loop;
end;
$$;

-- =========================================================
-- 4) Customer files in storage live under the owner's folder
-- =========================================================
drop policy if exists "Owner reads own customer storage files" on storage.objects;
drop policy if exists "Owner uploads own customer storage files" on storage.objects;
drop policy if exists "Owner updates own customer storage files" on storage.objects;
drop policy if exists "Owner deletes own customer storage files" on storage.objects;
drop policy if exists "Team reads owner customer storage files" on storage.objects;
drop policy if exists "Team uploads owner customer storage files" on storage.objects;
drop policy if exists "Team updates owner customer storage files" on storage.objects;
drop policy if exists "Team deletes owner customer storage files" on storage.objects;

create policy "Team reads owner customer storage files"
on storage.objects for select to authenticated
using (bucket_id = 'customer-files' and (storage.foldername(name))[1] = (select public.current_owner_id())::text);

create policy "Team uploads owner customer storage files"
on storage.objects for insert to authenticated
with check (bucket_id = 'customer-files' and (storage.foldername(name))[1] = (select public.current_owner_id())::text);

create policy "Team updates owner customer storage files"
on storage.objects for update to authenticated
using (bucket_id = 'customer-files' and (storage.foldername(name))[1] = (select public.current_owner_id())::text)
with check (bucket_id = 'customer-files' and (storage.foldername(name))[1] = (select public.current_owner_id())::text);

create policy "Team deletes owner customer storage files"
on storage.objects for delete to authenticated
using (bucket_id = 'customer-files' and (storage.foldername(name))[1] = (select public.current_owner_id())::text);

-- =========================================================
-- 5) Only the owner changes whether an invoice is settled
-- =========================================================
create or replace function public.guard_invoice_settlement()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Service-role writes (Holoo sync) have no user and are not affected.
  if auth.uid() is not null
     and auth.uid() <> public.current_owner_id()
     and (
       new.settled_at is distinct from old.settled_at
       or new.settled_source is distinct from old.settled_source
       or new.settled_transaction_id is distinct from old.settled_transaction_id
       or new.settled_note is distinct from old.settled_note
     ) then
    raise exception 'only the owner can change invoice settlement';
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_guard_settlement on public.invoices;
create trigger invoices_guard_settlement
before update on public.invoices
for each row execute function public.guard_invoice_settlement();

-- =========================================================
-- 6) Who did it
-- =========================================================
alter table public.sms_messages
  add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null;
alter table public.followups
  add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null;

commit;
