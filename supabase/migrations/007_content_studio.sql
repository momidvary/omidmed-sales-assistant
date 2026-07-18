-- Omidmed content studio: AI drafts, images, calendar and approval workflow

create type public.content_channel as enum ('instagram', 'whatsapp', 'website');
create type public.content_format as enum ('post', 'carousel', 'story', 'reel', 'article');
create type public.content_status as enum ('draft', 'pending_review', 'approved', 'published', 'rejected');

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete restrict,
  reviewed_by uuid references auth.users(id) on delete set null,
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

create index content_items_schedule_idx on public.content_items (scheduled_for);
create index content_items_status_idx on public.content_items (status, created_at desc);

alter table public.content_items enable row level security;

create policy "Authenticated team can read content"
on public.content_items for select
to authenticated
using (true);

create policy "Authenticated team can create content"
on public.content_items for insert
to authenticated
with check (created_by = auth.uid());

create policy "Authenticated team can update content"
on public.content_items for update
to authenticated
using (true)
with check (true);

create policy "Authenticated team can delete drafts"
on public.content_items for delete
to authenticated
using (status in ('draft', 'rejected'));

insert into storage.buckets (id, name, public)
values ('content-studio', 'content-studio', true)
on conflict (id) do update set public = excluded.public;

create policy "Public can view content studio images"
on storage.objects for select
to public
using (bucket_id = 'content-studio');

create policy "Authenticated team can upload content studio images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'content-studio');

create policy "Authenticated team can update content studio images"
on storage.objects for update
to authenticated
using (bucket_id = 'content-studio')
with check (bucket_id = 'content-studio');

create policy "Authenticated team can delete content studio images"
on storage.objects for delete
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

create trigger content_items_touch_updated_at
before update on public.content_items
for each row execute function public.touch_content_item();
