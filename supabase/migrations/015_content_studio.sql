-- OmidMed content studio: AI drafts, images, calendar and approval workflow.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'content_channel'
  ) then
    create type public.content_channel as enum (
      'instagram',
      'whatsapp',
      'website'
    );
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'content_format'
  ) then
    create type public.content_format as enum (
      'post',
      'carousel',
      'story',
      'reel',
      'article'
    );
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'content_status'
  ) then
    create type public.content_status as enum (
      'draft',
      'pending_review',
      'approved',
      'published',
      'rejected'
    );
  end if;
end
$$;

create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null
    references auth.users(id) on delete restrict,
  reviewed_by uuid
    references auth.users(id) on delete set null,
  title text not null,
  topic text not null,
  product_name text,
  objective text not null default 'sales',
  audience text not null default 'physiotherapists',
  channel public.content_channel not null default 'instagram',
  format public.content_format not null default 'post',
  caption text not null,
  on_image_text text,
  call_to_action text,
  hashtags text[] not null default '{}',
  image_prompt text,
  image_path text,
  image_url text,
  scheduled_for timestamptz,
  status public.content_status not null default 'draft',
  approved_at timestamptz,
  published_at timestamptz,
  rejection_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_items_schedule_idx
  on public.content_items (scheduled_for);
create index if not exists content_items_status_idx
  on public.content_items (status, created_at desc);
create index if not exists content_items_created_by_idx
  on public.content_items (created_by, created_at desc);

alter table public.content_items enable row level security;

drop policy if exists "Authenticated team can read content"
  on public.content_items;
create policy "Authenticated team can read content"
  on public.content_items
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated team can create content"
  on public.content_items;
create policy "Authenticated team can create content"
  on public.content_items
  for insert
  to authenticated
  with check (created_by = (select auth.uid()));

drop policy if exists "Authenticated team can update content"
  on public.content_items;
create policy "Authenticated team can update content"
  on public.content_items
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated team can delete drafts"
  on public.content_items;
create policy "Authenticated team can delete drafts"
  on public.content_items
  for delete
  to authenticated
  using (status in ('draft', 'rejected'));

revoke all on table public.content_items from anon;
grant select, insert, update, delete
  on table public.content_items to authenticated;

insert into storage.buckets (id, name, public)
values ('content-studio', 'content-studio', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "Public can view content studio images"
  on storage.objects;
create policy "Public can view content studio images"
  on storage.objects
  for select
  to public
  using (bucket_id = 'content-studio');

drop policy if exists "Authenticated team can upload content studio images"
  on storage.objects;
create policy "Authenticated team can upload content studio images"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'content-studio');

drop policy if exists "Authenticated team can update content studio images"
  on storage.objects;
create policy "Authenticated team can update content studio images"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'content-studio')
  with check (bucket_id = 'content-studio');

drop policy if exists "Authenticated team can delete content studio images"
  on storage.objects;
create policy "Authenticated team can delete content studio images"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'content-studio');

create or replace function public.touch_content_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists content_items_touch_updated_at
  on public.content_items;
create trigger content_items_touch_updated_at
before update on public.content_items
for each row execute function public.touch_content_item();

commit;
