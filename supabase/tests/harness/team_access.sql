-- Owner O, secretary S (member of O) and an unrelated user X.
-- Prints one "check|result" line per expectation.
begin;
insert into auth.users(id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a3');
insert into public.team_members(user_id, owner_id, display_name)
values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'منشی');
insert into public.customers(id, owner_id, name)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'مشتری');
insert into public.invoices(id, owner_id, customer_id, invoice_number, invoice_date, total_amount, external_key)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000c1', 'T-1', '2026-10-10', 1000, 't-1');
insert into public.bank_transactions(owner_id, account_no, fingerprint, jalali_date, tx_date, kind, amount_rial)
values ('00000000-0000-0000-0000-0000000000a1', '1', 'team-1', '1405/07/24', '2026-10-16', 'deposit', 10000);

set local role authenticated;

-- Secretary
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
select 'secretary_role|' || public.current_team_role();
select 'secretary_customers|' || count(*) from public.customers;
select 'secretary_invoices|' || count(*) from public.invoices;
select 'secretary_bank|' || count(*) from public.bank_transactions;
insert into public.followups(customer_id, outcome) values ('00000000-0000-0000-0000-0000000000c1', 'no_answer');
select 'followup_owner|' || (owner_id = '00000000-0000-0000-0000-0000000000a1')::text
  || '|' || (created_by = '00000000-0000-0000-0000-0000000000a2')::text from public.followups;
select public.record_customer_followup('00000000-0000-0000-0000-00000000f001',
  '00000000-0000-0000-0000-0000000000c1', 'phone', 'requested_price', null, null, null) is not null as ok \gset
select 'rpc_followups|' || count(*) from public.followups;
savepoint settle;
update public.invoices set settled_at = now(), settled_source = 'manual' where id = '00000000-0000-0000-0000-0000000000e1';
rollback to savepoint settle;
select 'secretary_settle_blocked|' || (select settled_at is null from public.invoices)::text;
update public.invoices set total_amount = total_amount where id = '00000000-0000-0000-0000-0000000000e1';
select 'secretary_plain_update|ok';

-- Stranger
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
select 'stranger_role|' || public.current_team_role();
select 'stranger_customers|' || count(*) from public.customers;

-- Owner
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select 'owner_bank|' || count(*) from public.bank_transactions;
update public.invoices set settled_at = now(), settled_source = 'manual' where id = '00000000-0000-0000-0000-0000000000e1';
select 'owner_settle|' || (select settled_at is not null from public.invoices)::text;
rollback;
