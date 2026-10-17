-- Split payment: a 22m invoice paid as 15m + 7m, then the 15m undone.
-- Runs as the authenticated owner so RLS applies. Prints one line per step.
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-00000000aa01');
insert into public.customers(id, owner_id, name)
values ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000aa01', 'مشتری');
insert into public.invoices(id, owner_id, customer_id, invoice_number, invoice_date, total_amount, external_key)
values ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000aa01',
        '00000000-0000-0000-0000-00000000cc01', 'SPLIT-1', '2026-10-10', 22000000, 'split-1');
insert into public.bank_transactions(id, owner_id, account_no, fingerprint, jalali_date, tx_date, kind, amount_rial) values
  ('00000000-0000-0000-0000-00000000bb01', '00000000-0000-0000-0000-00000000aa01', '1', 'split-a', '1405/07/24', '2026-10-16', 'deposit', 150000000),
  ('00000000-0000-0000-0000-00000000bb02', '00000000-0000-0000-0000-00000000aa01', '1', 'split-b', '1405/07/25', '2026-10-17', 'deposit', 70000000);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aa01', true);

-- Each check reads in its own statement, after the call has committed its changes.
select public.confirm_bank_deposit('00000000-0000-0000-0000-00000000bb01',
  '00000000-0000-0000-0000-00000000cc01', array['00000000-0000-0000-0000-00000000ee01']::uuid[]) is not null as ok \gset
select 'first|' || (select sum(amount_toman) from public.bank_payment_allocations)::text
  || '|' || (select (settled_at is not null)::text from public.invoices);
select public.confirm_bank_deposit('00000000-0000-0000-0000-00000000bb02',
  '00000000-0000-0000-0000-00000000cc01', array['00000000-0000-0000-0000-00000000ee01']::uuid[]) is not null as ok \gset
select 'second|' || (select sum(amount_toman) from public.bank_payment_allocations)::text
  || '|' || (select (settled_at is not null)::text from public.invoices);
select public.reopen_bank_transaction('00000000-0000-0000-0000-00000000bb01') is null as ok \gset
select 'undo|' || (select sum(amount_toman) from public.bank_payment_allocations)::text
  || '|' || (select (settled_at is not null)::text from public.invoices);
rollback;
