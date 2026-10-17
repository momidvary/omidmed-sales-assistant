-- OmidMed Sales Assistant
-- 026: Bank-based accounting from Resalat statement PDFs.
--
-- Every row of an imported statement becomes one bank_transactions row.
-- Amounts stay in rial exactly as the bank prints them; Holoo invoices are in
-- toman, so the app divides by 10 when it compares the two.
--
-- Deposits are linked to customers (and the invoices they settle) only after
-- the user confirms; withdrawals get a spending category. Learned rules
-- remember a card number or a name for next time.
--
-- The old management-accounting tables (006-009) are left untouched so no
-- data is lost; the app no longer uses them.

begin;

-- =========================================================
-- 1) Statement uploads
-- =========================================================
create table if not exists public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  bank text not null default 'resalat',
  account_no text not null,
  from_date text,
  to_date text,
  file_name text,
  transaction_count integer not null default 0 check (transaction_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  deposit_total_rial numeric(18, 0) not null default 0 check (deposit_total_rial >= 0),
  withdrawal_total_rial numeric(18, 0) not null default 0 check (withdrawal_total_rial >= 0),
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create index if not exists bank_statement_imports_owner_created_idx
  on public.bank_statement_imports (owner_id, created_at desc);

-- =========================================================
-- 2) Learned rules: card number or name -> category / customer
-- =========================================================
create table if not exists public.bank_counterparty_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  kind text not null check (kind in ('deposit', 'withdrawal')),
  match_type text not null check (match_type in ('card', 'name')),
  match_value text not null check (length(match_value) between 2 and 120),
  category text check (category is null or category ~ '^[a-z_]{2,40}$'),
  customer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id),
  constraint bank_counterparty_rules_target_check
    check (category is not null or customer_id is not null),
  constraint bank_counterparty_rules_customer_owner_fk
    foreign key (customer_id, owner_id)
    references public.customers (id, owner_id)
    on delete cascade
);

create unique index if not exists bank_counterparty_rules_owner_match_unique
  on public.bank_counterparty_rules (owner_id, kind, match_type, match_value);

-- =========================================================
-- 3) Bank transactions
-- =========================================================
create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  import_id uuid,
  bank text not null default 'resalat',
  account_no text not null,
  -- account|date|time|document|withdrawal|deposit|balance: the same row in
  -- two overlapping statements has the same fingerprint.
  fingerprint text not null,

  jalali_date text not null check (jalali_date ~ '^\d{4}/\d{2}/\d{2}$'),
  tx_date date not null,
  tx_time text,
  row_no integer,
  branch text,
  document_no text,
  reference_no text,
  cheque_no text,
  description text not null default '',
  note text,

  kind text not null check (kind in ('deposit', 'withdrawal')),
  amount_rial numeric(18, 0) not null check (amount_rial > 0),
  balance_rial numeric(18, 0),
  is_fee boolean not null default false,
  counterparty_name text,
  counterparty_card text check (counterparty_card is null or counterparty_card ~ '^\d{16}$'),

  category text check (category is null or category ~ '^[a-z_]{2,40}$'),
  category_source text check (category_source in ('fee', 'rule', 'manual')),
  customer_id uuid,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'confirmed', 'ignored')),
  user_note text check (user_note is null or length(user_note) <= 300),
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, owner_id),
  constraint bank_transactions_import_owner_fk
    foreign key (import_id, owner_id)
    references public.bank_statement_imports (id, owner_id)
    on delete set null (import_id),
  constraint bank_transactions_customer_owner_fk
    foreign key (customer_id, owner_id)
    references public.customers (id, owner_id)
    on delete set null (customer_id)
);

create unique index if not exists bank_transactions_owner_fingerprint_unique
  on public.bank_transactions (owner_id, fingerprint);

create index if not exists bank_transactions_owner_date_idx
  on public.bank_transactions (owner_id, tx_date desc, tx_time desc);

create index if not exists bank_transactions_owner_pending_idx
  on public.bank_transactions (owner_id, kind, tx_date desc)
  where review_status = 'pending';

create index if not exists bank_transactions_owner_customer_idx
  on public.bank_transactions (owner_id, customer_id, tx_date desc)
  where customer_id is not null;

-- =========================================================
-- 4) Invoice settlement
-- =========================================================
-- settled_at is set only by an explicit user action: confirming a bank
-- deposit for the invoice, or marking it settled by hand (cash, old
-- payments Holoo never recorded). Nothing sets it automatically.
alter table public.invoices
  add column if not exists settled_at timestamptz,
  add column if not exists settled_source text,
  add column if not exists settled_transaction_id uuid,
  add column if not exists settled_note text;

alter table public.invoices
  drop constraint if exists invoices_settled_source_check;
alter table public.invoices
  add constraint invoices_settled_source_check
  check (settled_source is null or settled_source in ('bank', 'manual'));

alter table public.invoices
  drop constraint if exists invoices_settled_note_check;
alter table public.invoices
  add constraint invoices_settled_note_check
  check (settled_note is null or length(settled_note) <= 300);

alter table public.invoices
  drop constraint if exists invoices_settled_transaction_owner_fk;
alter table public.invoices
  add constraint invoices_settled_transaction_owner_fk
  foreign key (settled_transaction_id, owner_id)
  references public.bank_transactions (id, owner_id)
  on delete set null (settled_transaction_id);

create index if not exists invoices_owner_unsettled_idx
  on public.invoices (owner_id, invoice_date desc)
  where settled_at is null;

create index if not exists invoices_owner_settled_transaction_idx
  on public.invoices (owner_id, settled_transaction_id)
  where settled_transaction_id is not null;

-- =========================================================
-- 5) Row level security
-- =========================================================
alter table public.bank_statement_imports enable row level security;
alter table public.bank_counterparty_rules enable row level security;
alter table public.bank_transactions enable row level security;

drop policy if exists "Owner manages own bank imports" on public.bank_statement_imports;
create policy "Owner manages own bank imports"
on public.bank_statement_imports for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Owner manages own bank rules" on public.bank_counterparty_rules;
create policy "Owner manages own bank rules"
on public.bank_counterparty_rules for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Owner manages own bank transactions" on public.bank_transactions;
create policy "Owner manages own bank transactions"
on public.bank_transactions for all to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

revoke all on table public.bank_statement_imports from anon;
revoke all on table public.bank_counterparty_rules from anon;
revoke all on table public.bank_transactions from anon;
grant select, insert, update, delete on table public.bank_statement_imports to authenticated;
grant select, insert, update, delete on table public.bank_counterparty_rules to authenticated;
grant select, insert, update, delete on table public.bank_transactions to authenticated;

drop trigger if exists bank_counterparty_rules_set_updated_at on public.bank_counterparty_rules;
create trigger bank_counterparty_rules_set_updated_at
before update on public.bank_counterparty_rules
for each row execute function public.set_updated_at();

drop trigger if exists bank_transactions_set_updated_at on public.bank_transactions;
create trigger bank_transactions_set_updated_at
before update on public.bank_transactions
for each row execute function public.set_updated_at();

commit;
