-- OmidMed Sales Assistant
-- Customer print files and invoice attachments
-- Version: 002

begin;

create table if not exists public.customer_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,

  customer_id uuid not null,
  file_type text not null default 'print_design'
    check (file_type in ('print_design', 'invoice', 'logo', 'other')),
  title text,
  invoice_number text,

  storage_path text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),

  created_at timestamptz not null default now(),

  constraint customer_files_customer_owner_fk
    foreign key (customer_id, owner_id)
    references public.customers (id, owner_id)
    on delete cascade,

  unique (owner_id, storage_path)
);

create index if not exists customer_files_owner_customer_created_idx
  on public.customer_files (owner_id, customer_id, created_at desc);

create index if not exists customer_files_owner_invoice_idx
  on public.customer_files (owner_id, invoice_number)
  where invoice_number is not null;

alter table public.customer_files enable row level security;

drop policy if exists "Owner manages own customer files" on public.customer_files;
create policy "Owner manages own customer files"
on public.customer_files
for all
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

revoke all on table public.customer_files from anon;
grant select, insert, update, delete
  on table public.customer_files to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'customer-files',
  'customer-files',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Every object path starts with the signed-in user's UUID:
-- <owner_id>/<customer_id>/<random-file-name>
drop policy if exists "Owner reads own customer storage files" on storage.objects;
create policy "Owner reads own customer storage files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'customer-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Owner uploads own customer storage files" on storage.objects;
create policy "Owner uploads own customer storage files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'customer-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Owner updates own customer storage files" on storage.objects;
create policy "Owner updates own customer storage files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'customer-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'customer-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "Owner deletes own customer storage files" on storage.objects;
create policy "Owner deletes own customer storage files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'customer-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

commit;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'customer_files';
