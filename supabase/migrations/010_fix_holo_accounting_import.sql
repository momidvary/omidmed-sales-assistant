-- OmidMed Sales Assistant
-- 010: Fix Holo accounting import conflict indexes
--
-- The importer uses Supabase upsert with:
--   onConflict: owner_id,source,external_key
-- PostgreSQL must be able to infer a matching UNIQUE index.
-- The previous indexes were partial (WHERE external_key IS NOT NULL),
-- which could not be inferred by this upsert request.

begin;

drop index if exists public.workshop_expenses_owner_source_external_unique;
create unique index workshop_expenses_owner_source_external_unique
  on public.workshop_expenses (owner_id, source, external_key);

drop index if exists public.partner_withdrawals_owner_source_external_unique;
create unique index partner_withdrawals_owner_source_external_unique
  on public.partner_withdrawals (owner_id, source, external_key);

drop index if exists public.accounting_review_items_owner_source_external_unique;
create unique index accounting_review_items_owner_source_external_unique
  on public.accounting_review_items (owner_id, source, external_key);

-- Mark the interrupted attempt as failed.
-- Re-importing the same file will reuse the same batch and complete it.
update public.accounting_import_batches
set
  status = 'failed',
  completed_at = now(),
  updated_at = now()
where status = 'processing'
  and inserted_count = 0;

commit;

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'workshop_expenses_owner_source_external_unique',
    'partner_withdrawals_owner_source_external_unique',
    'accounting_review_items_owner_source_external_unique'
  )
order by indexname;
