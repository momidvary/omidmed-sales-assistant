-- Inclusive Tehran calendar date. NULL is eligible; infinity lasts until restored.
alter table public.customers
  add column if not exists daily_sms_hidden_through date;
