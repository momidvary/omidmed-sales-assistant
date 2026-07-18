-- OmidMed Sales Assistant
-- 014: Reconcile cross-identity duplicate Holoo invoices before unique checks.
--
-- The Holoo receiver can encounter two historic invoice rows where one row
-- owns the Holoo/invoice identity and another row owns the document number.
-- Updating either row directly then violates one of the existing unique
-- indexes. This trigger keeps all unique indexes intact and removes only the
-- conflicting historic duplicate immediately before the incoming holo_agent
-- row is inserted or updated. The RPC recreates invoice_items from the current
-- Holoo payload in the same transaction, so stale items belonging to the
-- duplicate rows are intentionally removed.

begin;

-- Fail closed if a future migration adds another table that references
-- invoices. The reconciliation below is intentionally scoped to the currently
-- known invoice_items relation.
do $$
declare
  v_unexpected_references text;
begin
  select string_agg(
    format('%I.%I (%I)', child_ns.nspname, child.relname, con.conname),
    ', '
  )
  into v_unexpected_references
  from pg_constraint con
  join pg_class parent
    on parent.oid = con.confrelid
  join pg_namespace parent_ns
    on parent_ns.oid = parent.relnamespace
  join pg_class child
    on child.oid = con.conrelid
  join pg_namespace child_ns
    on child_ns.oid = child.relnamespace
  where con.contype = 'f'
    and parent_ns.nspname = 'public'
    and parent.relname = 'invoices'
    and not (
      child_ns.nspname = 'public'
      and child.relname = 'invoice_items'
    );

  if v_unexpected_references is not null then
    raise exception
      'Unexpected foreign-key references to public.invoices: %',
      v_unexpected_references;
  end if;
end
$$;

create or replace function public.reconcile_holoo_invoice_identity_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_duplicate_id uuid;
begin
  -- Never alter manual or QRP imports. This repair is limited to the automatic
  -- Windows Holoo agent and requires a real Holoo identity.
  if new.source is distinct from 'holo_agent'
     or nullif(btrim(new.holo_fac_code), '') is null then
    return new;
  end if;

  -- Lock and remove only rows that represent the same Holoo invoice through a
  -- different unique identity. The incoming row remains canonical. Existing
  -- unique indexes are preserved and will still reject unrelated duplicates.
  for v_duplicate_id in
    select i.id
    from public.invoices i
    where i.owner_id = new.owner_id
      and i.id <> new.id
      and (
        (
          nullif(btrim(new.holo_fac_type), '') is not null
          and i.holo_fac_type = new.holo_fac_type
          and i.holo_fac_code = new.holo_fac_code
        )
        or (
          nullif(btrim(new.invoice_number), '') is not null
          and i.invoice_number = new.invoice_number
        )
        or (
          nullif(btrim(new.document_number), '') is not null
          and i.document_number = new.document_number
        )
        or (
          nullif(btrim(new.external_key), '') is not null
          and i.source = new.source
          and i.external_key = new.external_key
        )
      )
    order by i.created_at, i.id
    for update
  loop
    delete from public.invoice_items
    where owner_id = new.owner_id
      and invoice_id = v_duplicate_id;

    delete from public.invoices
    where owner_id = new.owner_id
      and id = v_duplicate_id;
  end loop;

  return new;
end;
$$;

revoke all on function public.reconcile_holoo_invoice_identity_before_write()
  from public;
revoke all on function public.reconcile_holoo_invoice_identity_before_write()
  from anon;
revoke all on function public.reconcile_holoo_invoice_identity_before_write()
  from authenticated;

-- The trigger runs before PostgreSQL evaluates the unique indexes, which is
-- precisely where the cross-identity conflict must be reconciled.
drop trigger if exists invoices_reconcile_holoo_identity
  on public.invoices;

create trigger invoices_reconcile_holoo_identity
before insert or update of
  owner_id,
  source,
  external_key,
  invoice_number,
  document_number,
  holo_fac_type,
  holo_fac_code
on public.invoices
for each row
execute function public.reconcile_holoo_invoice_identity_before_write();

commit;

-- Metadata-only verification.
select
  trigger_name,
  event_manipulation,
  action_timing
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'invoices'
  and trigger_name = 'invoices_reconcile_holoo_identity'
order by event_manipulation;
