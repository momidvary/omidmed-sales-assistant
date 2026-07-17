-- OmidMed Sales Assistant
-- Automatic read-only Holoo SQL sync receiver
-- Version: 013

begin;

-- =========================================================
-- 1) Holoo metadata on customers
-- =========================================================

alter table public.customers
  add column if not exists holo_balance_amount numeric(18, 0)
    not null default 0,
  add column if not exists holo_balance_status text
    not null default 'unknown',
  add column if not exists holo_source_updated_at timestamptz,
  add column if not exists holo_last_synced_at timestamptz;

alter table public.customers
  drop constraint if exists customers_holo_balance_amount_check;

alter table public.customers
  add constraint customers_holo_balance_amount_check
  check (holo_balance_amount >= 0);

alter table public.customers
  drop constraint if exists customers_holo_balance_status_check;

alter table public.customers
  add constraint customers_holo_balance_status_check
  check (
    holo_balance_status in (
      'debtor',
      'creditor',
      'zero',
      'unknown'
    )
  );

create index if not exists customers_owner_holo_balance_idx
  on public.customers (
    owner_id,
    holo_balance_status,
    holo_balance_amount desc
  );

create index if not exists customers_owner_holo_synced_idx
  on public.customers (owner_id, holo_last_synced_at desc);

-- =========================================================
-- 2) Holoo metadata on invoices and items
-- =========================================================

alter table public.invoices
  add column if not exists holo_fac_code text,
  add column if not exists holo_fac_type text,
  add column if not exists holo_creation_at timestamptz,
  add column if not exists holo_is_deleted boolean
    not null default false;

alter table public.invoices
  drop constraint if exists invoices_source_check;

alter table public.invoices
  add constraint invoices_source_check
  check (source in ('holo_qrp', 'holo_agent', 'manual'));

create unique index if not exists
  invoices_owner_holo_fac_unique
  on public.invoices (
    owner_id,
    holo_fac_type,
    holo_fac_code
  );

create index if not exists invoices_owner_holo_creation_idx
  on public.invoices (owner_id, holo_creation_at desc);

alter table public.invoice_items
  add column if not exists holo_article_code text,
  add column if not exists holo_article_index integer,
  add column if not exists buy_price numeric(18, 3),
  add column if not exists discount_amount numeric(18, 0)
    not null default 0,
  add column if not exists levy_amount numeric(18, 0)
    not null default 0,
  add column if not exists tax_amount numeric(18, 0)
    not null default 0;

create index if not exists invoice_items_owner_holo_article_idx
  on public.invoice_items (
    owner_id,
    holo_article_code
  );

-- =========================================================
-- 3) Sync run history
-- =========================================================

create table if not exists public.holo_sync_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null
    references auth.users(id) on delete cascade,
  agent_run_id text not null,
  mode text not null default 'incremental'
    check (mode in ('initial', 'incremental', 'weekly_full', 'manual_full')),
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  source_server text,
  source_database text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  customer_count integer not null default 0,
  invoice_count integer not null default 0,
  item_count integer not null default 0,
  batch_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, agent_run_id)
);

create index if not exists holo_sync_runs_owner_started_idx
  on public.holo_sync_runs (owner_id, started_at desc);

drop trigger if exists holo_sync_runs_set_updated_at
  on public.holo_sync_runs;

create trigger holo_sync_runs_set_updated_at
before update on public.holo_sync_runs
for each row execute function public.set_updated_at();

alter table public.holo_sync_runs enable row level security;

drop policy if exists "Owner reads own Holo sync runs"
  on public.holo_sync_runs;

create policy "Owner reads own Holo sync runs"
  on public.holo_sync_runs
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on table public.holo_sync_runs from anon;
revoke all on table public.holo_sync_runs from authenticated;
grant select on table public.holo_sync_runs to authenticated;

-- =========================================================
-- 4) Phone normalization used by the receiver
-- =========================================================

create or replace function public.normalize_iran_phone(
  input_phone text
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits text;
begin
  digits := regexp_replace(
    coalesce(input_phone, ''),
    '[^0-9]',
    '',
    'g'
  );

  if digits = '' then
    return null;
  end if;

  if digits like '0098%' then
    digits := substring(digits from 5);
  elsif digits like '98%' and length(digits) >= 12 then
    digits := substring(digits from 3);
  end if;

  if length(digits) = 10 and digits like '9%' then
    digits := '0' || digits;
  end if;

  return digits;
end;
$$;

revoke all on function public.normalize_iran_phone(text)
  from public;

-- =========================================================
-- 5) One-batch receiver
-- Only service_role may call this function.
-- =========================================================

create or replace function public.sync_holoo_agent_batch(
  p_owner_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_run_id text := nullif(p_payload->>'runId', '');
  v_mode text := coalesce(
    nullif(p_payload->>'mode', ''),
    'incremental'
  );
  v_batch_type text := coalesce(
    nullif(p_payload->>'batchType', ''),
    'unknown'
  );
  v_source_server text :=
    nullif(p_payload->>'sourceServer', '');
  v_source_database text :=
    nullif(p_payload->>'sourceDatabase', '');
  v_final boolean := coalesce(
    (p_payload->>'final')::boolean,
    false
  );

  v_customer jsonb;
  v_invoice jsonb;
  v_item jsonb;

  v_customer_id uuid;
  v_invoice_id uuid;

  v_customer_code text;
  v_customer_name text;
  v_phone text;
  v_normalized_phone text;
  v_balance_amount numeric(18, 0);
  v_balance_status text;

  v_fac_code text;
  v_fac_type text;
  v_invoice_number text;
  v_document_number text;
  v_external_key text;

  v_customer_count integer := 0;
  v_invoice_count integer := 0;
  v_item_count integer := 0;
  v_skipped_count integer := 0;
begin
  if p_owner_id is null then
    raise exception 'Owner id is required';
  end if;

  if v_run_id is null then
    raise exception 'runId is required';
  end if;

  if v_mode not in (
    'initial',
    'incremental',
    'weekly_full',
    'manual_full'
  ) then
    v_mode := 'incremental';
  end if;

  insert into public.holo_sync_runs (
    owner_id,
    agent_run_id,
    mode,
    status,
    source_server,
    source_database,
    started_at
  )
  values (
    p_owner_id,
    v_run_id,
    v_mode,
    'running',
    v_source_server,
    v_source_database,
    v_now
  )
  on conflict (owner_id, agent_run_id)
  do update set
    source_server = coalesce(
      excluded.source_server,
      public.holo_sync_runs.source_server
    ),
    source_database = coalesce(
      excluded.source_database,
      public.holo_sync_runs.source_database
    ),
    status = case
      when public.holo_sync_runs.status = 'completed'
        then 'completed'
      else 'running'
    end;

  -- -------------------------------------------------------
  -- Customers and current balances
  -- -------------------------------------------------------

  if jsonb_typeof(p_payload->'customers') = 'array' then
    for v_customer in
      select value
      from jsonb_array_elements(p_payload->'customers')
    loop
      v_customer_code :=
        nullif(btrim(v_customer->>'code'), '');

      v_customer_name := coalesce(
        nullif(btrim(v_customer->>'name'), ''),
        'مشتری بدون نام'
      );

      v_phone := coalesce(
        nullif(btrim(v_customer->>'mobile'), ''),
        nullif(btrim(v_customer->>'telephone'), '')
      );

      v_normalized_phone :=
        public.normalize_iran_phone(v_phone);

      v_balance_amount := abs(
        coalesce(
          nullif(v_customer->>'balanceAmount', '')::numeric,
          0
        )
      );

      v_balance_status := coalesce(
        nullif(v_customer->>'balanceStatus', ''),
        'unknown'
      );

      if v_balance_status not in (
        'debtor',
        'creditor',
        'zero',
        'unknown'
      ) then
        v_balance_status := 'unknown';
      end if;

      v_customer_id := null;

      if v_customer_code is not null then
        select c.id
        into v_customer_id
        from public.customers c
        where c.owner_id = p_owner_id
          and c.customer_code = v_customer_code
        limit 1;
      end if;

      if v_customer_id is null
         and v_normalized_phone is not null then
        select c.id
        into v_customer_id
        from public.customers c
        where c.owner_id = p_owner_id
          and c.normalized_phone = v_normalized_phone
          and c.customer_code is null
        order by c.created_at
        limit 1;
      end if;

      if v_customer_id is null then
        insert into public.customers (
          owner_id,
          customer_code,
          name,
          contact_name,
          phone,
          normalized_phone,
          province,
          city,
          address,
          status,
          priority,
          holo_balance_amount,
          holo_balance_status,
          holo_source_updated_at,
          holo_last_synced_at
        )
        values (
          p_owner_id,
          v_customer_code,
          v_customer_name,
          nullif(btrim(v_customer->>'contactName'), ''),
          v_phone,
          v_normalized_phone,
          nullif(btrim(v_customer->>'province'), ''),
          nullif(btrim(v_customer->>'city'), ''),
          nullif(btrim(v_customer->>'address'), ''),
          'active',
          'normal',
          v_balance_amount,
          v_balance_status,
          nullif(
            v_customer->>'sourceUpdatedAt',
            ''
          )::timestamptz,
          v_now
        )
        returning id into v_customer_id;
      else
        update public.customers
        set
          customer_code = coalesce(
            v_customer_code,
            customer_code
          ),
          name = v_customer_name,
          contact_name = coalesce(
            nullif(btrim(v_customer->>'contactName'), ''),
            contact_name
          ),
          phone = coalesce(v_phone, phone),
          normalized_phone = coalesce(
            v_normalized_phone,
            normalized_phone
          ),
          province = coalesce(
            nullif(btrim(v_customer->>'province'), ''),
            province
          ),
          city = coalesce(
            nullif(btrim(v_customer->>'city'), ''),
            city
          ),
          address = coalesce(
            nullif(btrim(v_customer->>'address'), ''),
            address
          ),
          holo_balance_amount = v_balance_amount,
          holo_balance_status = v_balance_status,
          holo_source_updated_at = coalesce(
            nullif(
              v_customer->>'sourceUpdatedAt',
              ''
            )::timestamptz,
            holo_source_updated_at
          ),
          holo_last_synced_at = v_now,
          status = case
            when status = 'prospect'
              and v_customer_code is not null
              then 'active'
            else status
          end,
          lead_stage = case
            when status = 'prospect'
              and v_customer_code is not null
              then 'converted'
            else lead_stage
          end
        where id = v_customer_id;
      end if;

      v_customer_count := v_customer_count + 1;
    end loop;
  end if;

  -- -------------------------------------------------------
  -- Sales invoices (Holoo Fac_Type = F) and line items
  -- -------------------------------------------------------

  if jsonb_typeof(p_payload->'invoices') = 'array' then
    for v_invoice in
      select value
      from jsonb_array_elements(p_payload->'invoices')
    loop
      v_fac_code :=
        nullif(btrim(v_invoice->>'facCode'), '');

      v_fac_type := coalesce(
        nullif(btrim(v_invoice->>'facType'), ''),
        'F'
      );

      v_invoice_number := coalesce(
        nullif(btrim(v_invoice->>'invoiceNumber'), ''),
        v_fac_code
      );

      v_document_number :=
        nullif(btrim(v_invoice->>'documentNumber'), '');

      v_external_key :=
        'holoo:' || v_fac_type || ':' || v_fac_code;

      v_customer_code :=
        nullif(btrim(v_invoice->>'customerCode'), '');

      v_customer_id := null;

      select c.id
      into v_customer_id
      from public.customers c
      where c.owner_id = p_owner_id
        and c.customer_code = v_customer_code
      limit 1;

      if v_customer_id is null then
        v_skipped_count := v_skipped_count + 1;
        continue;
      end if;

      v_invoice_id := null;

      select i.id
      into v_invoice_id
      from public.invoices i
      where i.owner_id = p_owner_id
        and i.holo_fac_type = v_fac_type
        and i.holo_fac_code = v_fac_code
      limit 1;

      if v_invoice_id is null
         and v_invoice_number is not null then
        select i.id
        into v_invoice_id
        from public.invoices i
        where i.owner_id = p_owner_id
          and i.invoice_number = v_invoice_number
        limit 1;
      end if;

      if v_invoice_id is null
         and v_document_number is not null then
        select i.id
        into v_invoice_id
        from public.invoices i
        where i.owner_id = p_owner_id
          and i.document_number = v_document_number
        limit 1;
      end if;

      if coalesce(
        (v_invoice->>'isDeleted')::boolean,
        false
      ) then
        if v_invoice_id is not null then
          delete from public.invoices
          where id = v_invoice_id;
        end if;

        v_invoice_count := v_invoice_count + 1;
        continue;
      end if;

      if v_invoice_id is null then
        insert into public.invoices (
          owner_id,
          customer_id,
          invoice_number,
          document_number,
          invoice_date,
          due_date,
          total_quantity,
          total_amount,
          cash_amount,
          check_amount,
          card_amount,
          account_balance_amount,
          account_balance_status,
          discount_amount,
          discount_percent,
          transaction_status,
          raw_customer_name,
          source,
          external_key,
          holo_fac_code,
          holo_fac_type,
          holo_creation_at,
          holo_is_deleted
        )
        values (
          p_owner_id,
          v_customer_id,
          v_invoice_number,
          v_document_number,
          (v_invoice->>'invoiceDate')::date,
          nullif(v_invoice->>'dueDate', '')::date,
          coalesce(
            nullif(v_invoice->>'totalQuantity', '')::numeric,
            0
          ),
          greatest(
            coalesce(
              nullif(v_invoice->>'totalAmount', '')::numeric,
              0
            ),
            0
          ),
          greatest(
            coalesce(
              nullif(v_invoice->>'cashAmount', '')::numeric,
              0
            ),
            0
          ),
          greatest(
            coalesce(
              nullif(v_invoice->>'checkAmount', '')::numeric,
              0
            ),
            0
          ),
          greatest(
            coalesce(
              nullif(v_invoice->>'cardAmount', '')::numeric,
              0
            ),
            0
          ),
          0,
          'unknown',
          greatest(
            coalesce(
              nullif(v_invoice->>'discountAmount', '')::numeric,
              0
            ),
            0
          ),
          0,
          case
            when coalesce(
              nullif(v_invoice->>'creditAmount', '')::numeric,
              0
            ) > 0 then 'اعتباری'
            else 'نقدی'
          end,
          nullif(btrim(v_invoice->>'customerName'), ''),
          'holo_agent',
          v_external_key,
          v_fac_code,
          v_fac_type,
          nullif(
            v_invoice->>'creationDate',
            ''
          )::timestamptz,
          false
        )
        returning id into v_invoice_id;
      else
        update public.invoices
        set
          customer_id = v_customer_id,
          invoice_number = v_invoice_number,
          document_number = v_document_number,
          invoice_date =
            (v_invoice->>'invoiceDate')::date,
          due_date =
            nullif(v_invoice->>'dueDate', '')::date,
          total_quantity = coalesce(
            nullif(v_invoice->>'totalQuantity', '')::numeric,
            0
          ),
          total_amount = greatest(
            coalesce(
              nullif(v_invoice->>'totalAmount', '')::numeric,
              0
            ),
            0
          ),
          cash_amount = greatest(
            coalesce(
              nullif(v_invoice->>'cashAmount', '')::numeric,
              0
            ),
            0
          ),
          check_amount = greatest(
            coalesce(
              nullif(v_invoice->>'checkAmount', '')::numeric,
              0
            ),
            0
          ),
          card_amount = greatest(
            coalesce(
              nullif(v_invoice->>'cardAmount', '')::numeric,
              0
            ),
            0
          ),
          discount_amount = greatest(
            coalesce(
              nullif(v_invoice->>'discountAmount', '')::numeric,
              0
            ),
            0
          ),
          transaction_status = case
            when coalesce(
              nullif(v_invoice->>'creditAmount', '')::numeric,
              0
            ) > 0 then 'اعتباری'
            else 'نقدی'
          end,
          raw_customer_name =
            nullif(btrim(v_invoice->>'customerName'), ''),
          source = 'holo_agent',
          external_key = v_external_key,
          holo_fac_code = v_fac_code,
          holo_fac_type = v_fac_type,
          holo_creation_at = coalesce(
            nullif(
              v_invoice->>'creationDate',
              ''
            )::timestamptz,
            holo_creation_at
          ),
          holo_is_deleted = false,
          updated_at = v_now
        where id = v_invoice_id;
      end if;

      delete from public.invoice_items
      where owner_id = p_owner_id
        and invoice_id = v_invoice_id;

      if jsonb_typeof(v_invoice->'items') = 'array' then
        for v_item in
          select value
          from jsonb_array_elements(v_invoice->'items')
        loop
          insert into public.invoice_items (
            owner_id,
            invoice_id,
            row_number,
            product_name,
            quantity,
            unit_price,
            line_total,
            description,
            external_key,
            holo_article_code,
            holo_article_index,
            buy_price,
            discount_amount,
            levy_amount,
            tax_amount
          )
          values (
            p_owner_id,
            v_invoice_id,
            nullif(v_item->>'rowNumber', '')::integer,
            coalesce(
              nullif(btrim(v_item->>'productName'), ''),
              'کالای بدون نام'
            ),
            coalesce(
              nullif(v_item->>'quantity', '')::numeric,
              0
            ),
            greatest(
              coalesce(
                nullif(v_item->>'unitPrice', '')::numeric,
                0
              ),
              0
            ),
            greatest(
              coalesce(
                nullif(v_item->>'lineTotal', '')::numeric,
                0
              ),
              0
            ),
            nullif(btrim(v_item->>'description'), ''),
            v_external_key || ':' ||
              coalesce(
                nullif(v_item->>'articleCode', ''),
                'unknown'
              ) || ':' ||
              coalesce(
                nullif(v_item->>'articleIndex', ''),
                '0'
              ),
            nullif(v_item->>'articleCode', ''),
            nullif(v_item->>'articleIndex', '')::integer,
            nullif(v_item->>'buyPrice', '')::numeric,
            greatest(
              coalesce(
                nullif(v_item->>'discountAmount', '')::numeric,
                0
              ),
              0
            ),
            greatest(
              coalesce(
                nullif(v_item->>'levyAmount', '')::numeric,
                0
              ),
              0
            ),
            greatest(
              coalesce(
                nullif(v_item->>'taxAmount', '')::numeric,
                0
              ),
              0
            )
          );

          v_item_count := v_item_count + 1;
        end loop;
      end if;

      v_invoice_count := v_invoice_count + 1;
    end loop;
  end if;

  update public.holo_sync_runs
  set
    customer_count =
      customer_count + v_customer_count,
    invoice_count =
      invoice_count + v_invoice_count,
    item_count =
      item_count + v_item_count,
    batch_count =
      batch_count + 1,
    status = case
      when v_final then 'completed'
      else status
    end,
    completed_at = case
      when v_final then v_now
      else completed_at
    end,
    error_message = null
  where owner_id = p_owner_id
    and agent_run_id = v_run_id;

  return jsonb_build_object(
    'ok', true,
    'runId', v_run_id,
    'batchType', v_batch_type,
    'customersProcessed', v_customer_count,
    'invoicesProcessed', v_invoice_count,
    'itemsProcessed', v_item_count,
    'skipped', v_skipped_count,
    'final', v_final
  );
exception
  when others then
    update public.holo_sync_runs
    set
      status = 'failed',
      completed_at = now(),
      error_message = left(sqlerrm, 2000)
    where owner_id = p_owner_id
      and agent_run_id = v_run_id;

    raise;
end;
$$;

revoke all on function public.sync_holoo_agent_batch(
  uuid,
  jsonb
) from public;

revoke all on function public.sync_holoo_agent_batch(
  uuid,
  jsonb
) from anon;

revoke all on function public.sync_holoo_agent_batch(
  uuid,
  jsonb
) from authenticated;

grant execute on function public.sync_holoo_agent_batch(
  uuid,
  jsonb
) to service_role;

commit;

-- Verification
select
  table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'holo_sync_runs';
