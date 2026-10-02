-- OmidMed Sales Assistant
-- 025: Automatic "order registered" SMS for new Holoo invoices.
--
-- order_sms_at marks an invoice as handled by the automatic SMS: set when
-- the app claims it for sending, so every invoice is messaged at most once
-- no matter how often the agent re-syncs it. Every invoice that exists when
-- this migration runs is marked as handled, so only invoices created in
-- Holoo afterwards can ever trigger a message.

begin;

alter table public.invoices
  add column if not exists order_sms_at timestamptz,
  add column if not exists order_sms_status text;

update public.invoices
set order_sms_at = now(),
    order_sms_status = 'baseline'
where order_sms_at is null;

create index if not exists invoices_owner_order_sms_pending_idx
  on public.invoices (owner_id, holo_creation_at)
  where order_sms_at is null;

commit;
