-- OmidMed Sales Assistant
-- 027: Partial payments. A deposit can pay part of an invoice, and an invoice
-- can be paid by several deposits (e.g. 22m paid as 15m + 7m).
--
-- bank_payment_allocations records how much of each deposit (toman) went to
-- which invoice. An invoice is settled once its allocations reach its total.
-- Confirming and reopening a deposit run as single functions so a deposit,
-- its allocations and the invoices' settled state always change together.

begin;

create table if not exists public.bank_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  transaction_id uuid not null,
  invoice_id uuid not null,
  amount_toman numeric(18, 0) not null check (amount_toman > 0),
  created_at timestamptz not null default now(),
  constraint bank_payment_allocations_transaction_owner_fk
    foreign key (transaction_id, owner_id)
    references public.bank_transactions (id, owner_id)
    on delete cascade,
  constraint bank_payment_allocations_invoice_owner_fk
    foreign key (invoice_id, owner_id)
    references public.invoices (id, owner_id)
    on delete cascade
);

create unique index if not exists bank_payment_allocations_owner_tx_invoice_unique
  on public.bank_payment_allocations (owner_id, transaction_id, invoice_id);

create index if not exists bank_payment_allocations_owner_invoice_idx
  on public.bank_payment_allocations (owner_id, invoice_id);

alter table public.bank_payment_allocations enable row level security;

drop policy if exists "Owner manages own bank allocations" on public.bank_payment_allocations;
create policy "Owner manages own bank allocations"
on public.bank_payment_allocations for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

revoke all on table public.bank_payment_allocations from anon;
grant select, insert, update, delete on table public.bank_payment_allocations to authenticated;

-- Invoices already settled by a deposit under 026 were paid in full by it.
insert into public.bank_payment_allocations (owner_id, transaction_id, invoice_id, amount_toman)
select owner_id, settled_transaction_id, id, total_amount
from public.invoices
where settled_source = 'bank'
  and settled_transaction_id is not null
  and total_amount > 0
on conflict (owner_id, transaction_id, invoice_id) do nothing;

-- =========================================================
-- Confirm a deposit for a customer and pay the chosen invoices with it,
-- oldest first. Errors are short codes the app translates.
-- =========================================================
create or replace function public.confirm_bank_deposit(
  p_transaction_id uuid,
  p_customer_id uuid,
  p_invoice_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tx record;
  v_invoice record;
  v_left numeric;
  v_paid numeric;
  v_due numeric;
  v_part numeric;
  v_allocated numeric := 0;
  v_settled integer := 0;
  v_ids uuid[] := coalesce(p_invoice_ids, '{}'::uuid[]);
  v_found integer := 0;
begin
  select id, kind, review_status, amount_rial
    into v_tx
    from public.bank_transactions
   where id = p_transaction_id
   for update;
  if not found or v_tx.kind <> 'deposit' then
    raise exception 'invalid';
  end if;
  if v_tx.review_status <> 'pending' then
    raise exception 'reviewed';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'customer';
  end if;

  -- Bank amounts are rial, invoices toman.
  v_left := floor(v_tx.amount_rial / 10);

  for v_invoice in
    select id, total_amount
      from public.invoices
     where id = any (v_ids)
       and customer_id = p_customer_id
       and settled_at is null
       and coalesce(holo_is_deleted, false) = false
     order by invoice_date, invoice_number, id
     for update
  loop
    v_found := v_found + 1;
    select coalesce(sum(amount_toman), 0) into v_paid
      from public.bank_payment_allocations
     where invoice_id = v_invoice.id;
    v_due := v_invoice.total_amount - v_paid;
    v_part := least(v_left, greatest(v_due, 0));
    if v_part <= 0 then
      -- More invoices were ticked than this deposit can reach.
      raise exception 'amount';
    end if;

    insert into public.bank_payment_allocations (owner_id, transaction_id, invoice_id, amount_toman)
    values ((select owner_id from public.bank_transactions where id = v_tx.id), v_tx.id, v_invoice.id, v_part);
    v_left := v_left - v_part;
    v_allocated := v_allocated + v_part;

    if v_paid + v_part >= v_invoice.total_amount then
      update public.invoices
         set settled_at = now(),
             settled_source = 'bank',
             settled_transaction_id = v_tx.id,
             settled_note = null
       where id = v_invoice.id;
      v_settled := v_settled + 1;
    end if;
  end loop;

  if v_found <> coalesce(array_length(v_ids, 1), 0) then
    raise exception 'invoice';
  end if;

  update public.bank_transactions
     set customer_id = p_customer_id,
         category = 'customer_payment',
         category_source = 'manual',
         review_status = 'confirmed',
         reviewed_at = now()
   where id = v_tx.id;

  return jsonb_build_object('allocated', v_allocated, 'settled', v_settled, 'left', v_left);
end;
$$;

-- =========================================================
-- Send a transaction back to review. Its allocations are removed and any
-- invoice no longer fully paid by the remaining allocations reopens.
-- =========================================================
create or replace function public.reopen_bank_transaction(p_transaction_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invoice record;
  v_paid numeric;
  v_latest uuid;
begin
  perform 1 from public.bank_transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'invalid';
  end if;

  for v_invoice in
    select i.id, i.total_amount
      from public.invoices i
     where i.settled_source = 'bank'
       and (
         i.settled_transaction_id = p_transaction_id
         or i.id in (select invoice_id from public.bank_payment_allocations where transaction_id = p_transaction_id)
       )
     for update
  loop
    select coalesce(sum(amount_toman), 0) into v_paid
      from public.bank_payment_allocations
     where invoice_id = v_invoice.id
       and transaction_id <> p_transaction_id;
    if v_paid >= v_invoice.total_amount then
      select transaction_id into v_latest
        from public.bank_payment_allocations
       where invoice_id = v_invoice.id
         and transaction_id <> p_transaction_id
       order by created_at desc
       limit 1;
      update public.invoices set settled_transaction_id = v_latest where id = v_invoice.id;
    else
      update public.invoices
         set settled_at = null,
             settled_source = null,
             settled_transaction_id = null,
             settled_note = null
       where id = v_invoice.id;
    end if;
  end loop;

  delete from public.bank_payment_allocations where transaction_id = p_transaction_id;

  update public.bank_transactions
     set category = null,
         category_source = null,
         customer_id = null,
         review_status = 'pending',
         reviewed_at = null
   where id = p_transaction_id;
end;
$$;

revoke all on function public.confirm_bank_deposit(uuid, uuid, uuid[]) from public, anon;
revoke all on function public.reopen_bank_transaction(uuid) from public, anon;
grant execute on function public.confirm_bank_deposit(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.reopen_bank_transaction(uuid) to authenticated;

commit;
