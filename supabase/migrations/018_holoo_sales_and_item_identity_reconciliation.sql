-- OmidMed Sales Assistant
-- 018: Reconcile downstream sales rows and make Holoo invoice-item identity deterministic.
--
-- Invoice header identities are reconciled by migrations 014 and 016. A late
-- historic invoice can still fail in one of the two downstream side effects:
--   1) sync_invoice_to_sales() can encounter separate rows owning the document
--      number and the generated Holo sales external key.
--   2) two lines can produce the same legacy invoice_items.external_key when
--      article code/index values are duplicated or missing.

begin;

create or replace function public.sync_invoice_to_sales()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_external_key text := concat('holo-qrp-invoice-', new.invoice_number);
  v_candidate_ids uuid[];
  v_document_candidate_id uuid;
  v_external_candidate_id uuid;
  v_canonical_id uuid;
begin
  select coalesce(array_agg(locked.id order by locked.id), '{}'::uuid[])
  into v_candidate_ids
  from (
    select s.id
    from public.sales s
    where s.owner_id = new.owner_id
      and (
        (
          new.document_number is not null
          and s.document_number = new.document_number
        )
        or (
          s.source = 'holo_qrp'
          and s.external_key = v_external_key
        )
      )
    order by s.id
    for update
  ) locked;

  v_document_candidate_id := null;
  v_external_candidate_id := null;

  if new.document_number is not null then
    select s.id
    into v_document_candidate_id
    from public.sales s
    where s.id = any(v_candidate_ids)
      and s.document_number = new.document_number
    order by s.id
    limit 1;
  end if;

  select s.id
  into v_external_candidate_id
  from public.sales s
  where s.id = any(v_candidate_ids)
    and s.source = 'holo_qrp'
    and s.external_key = v_external_key
  order by s.id
  limit 1;

  v_canonical_id := coalesce(
    v_document_candidate_id,
    v_external_candidate_id
  );

  if v_canonical_id is not null then
    delete from public.sales
    where owner_id = new.owner_id
      and id = any(v_candidate_ids)
      and id <> v_canonical_id;

    update public.sales
    set
      customer_id = new.customer_id,
      invoice_number = new.invoice_number,
      document_number = new.document_number,
      sale_date = new.invoice_date,
      amount = new.total_amount,
      description = concat(
        'فاکتور ',
        new.invoice_number,
        ' - سند ',
        coalesce(new.document_number, '—')
      ),
      source = 'holo_qrp',
      source_row = new.source_row,
      external_key = v_external_key,
      raw_customer_name = new.raw_customer_name
    where owner_id = new.owner_id
      and id = v_canonical_id;
  else
    insert into public.sales (
      owner_id,
      customer_id,
      invoice_number,
      document_number,
      sale_date,
      amount,
      description,
      source,
      source_row,
      external_key,
      raw_customer_name
    ) values (
      new.owner_id,
      new.customer_id,
      new.invoice_number,
      new.document_number,
      new.invoice_date,
      new.total_amount,
      concat(
        'فاکتور ',
        new.invoice_number,
        ' - سند ',
        coalesce(new.document_number, '—')
      ),
      'holo_qrp',
      new.source_row,
      v_external_key,
      new.raw_customer_name
    );
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_sync_sales on public.invoices;
create trigger invoices_sync_sales
after insert or update of
  customer_id,
  invoice_number,
  document_number,
  invoice_date,
  total_amount
on public.invoices
for each row execute function public.sync_invoice_to_sales();

create or replace function public.normalize_holoo_invoice_item_external_key()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_base_key text;
begin
  if new.external_key like 'holoo:%' then
    v_base_key := new.external_key
      || ':row:'
      || coalesce(new.row_number::text, 'none');

    new.external_key := v_base_key;

    if exists (
      select 1
      from public.invoice_items ii
      where ii.owner_id = new.owner_id
        and ii.external_key = new.external_key
        and ii.id <> new.id
    ) then
      new.external_key := v_base_key || ':id:' || new.id::text;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists invoice_items_normalize_holoo_external_key
  on public.invoice_items;
create trigger invoice_items_normalize_holoo_external_key
before insert or update of external_key, row_number
on public.invoice_items
for each row execute function public.normalize_holoo_invoice_item_external_key();

commit;
