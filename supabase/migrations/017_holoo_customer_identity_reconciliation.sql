-- OmidMed Sales Assistant
-- 017: Safely merge duplicate customer profiles and keep every Holoo code as an alias.
--
-- The original receiver matched a phone number only when the existing profile had
-- no customer_code. A manual/legacy profile and its Holoo profile could therefore
-- coexist. This migration preserves all related invoices, sales, follow-ups,
-- tasks, files, campaigns, opportunities and SMS records while merging only
-- conservative duplicate matches.

begin;

create or replace function public.normalize_customer_identity_name(input_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      replace(
        replace(
          replace(lower(btrim(coalesce(input_name, ''))), 'ي', 'ی'),
          'ك', 'ک'
        ),
        '‌', ''
      ),
      '[[:space:]\-_/.,،؛:()\[\]{}]+',
      '',
      'g'
    ),
    ''
  );
$$;

create table if not exists public.customer_holoo_codes (
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null,
  customer_code text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (owner_id, customer_code),
  constraint customer_holoo_codes_customer_owner_fk
    foreign key (customer_id, owner_id)
    references public.customers (id, owner_id)
    on delete cascade
);

create index if not exists customer_holoo_codes_customer_idx
  on public.customer_holoo_codes (owner_id, customer_id);

alter table public.customer_holoo_codes enable row level security;

drop policy if exists "Owner reads own Holoo customer codes"
  on public.customer_holoo_codes;
create policy "Owner reads own Holoo customer codes"
  on public.customer_holoo_codes
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on table public.customer_holoo_codes from anon;
revoke all on table public.customer_holoo_codes from authenticated;
grant select on table public.customer_holoo_codes to authenticated;

insert into public.customer_holoo_codes (
  owner_id,
  customer_id,
  customer_code
)
select c.owner_id, c.id, c.customer_code
from public.customers c
where c.customer_code is not null
  and btrim(c.customer_code) <> ''
on conflict (owner_id, customer_code)
do update set
  customer_id = excluded.customer_id,
  last_seen_at = now();

create or replace function public.merge_customer_duplicate(
  p_owner_id uuid,
  p_canonical_id uuid,
  p_duplicate_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canonical public.customers%rowtype;
  v_duplicate public.customers%rowtype;
  v_duplicate_member record;
  v_canonical_member_id uuid;
  v_duplicate_opportunity record;
  v_canonical_opportunity_id uuid;
begin
  if p_owner_id is null
     or p_canonical_id is null
     or p_duplicate_id is null
     or p_canonical_id = p_duplicate_id then
    return;
  end if;

  select * into v_canonical
  from public.customers
  where owner_id = p_owner_id and id = p_canonical_id
  for update;

  select * into v_duplicate
  from public.customers
  where owner_id = p_owner_id and id = p_duplicate_id
  for update;

  if v_canonical.id is null or v_duplicate.id is null then
    return;
  end if;

  if v_canonical.customer_code is not null then
    insert into public.customer_holoo_codes (owner_id, customer_id, customer_code)
    values (p_owner_id, p_canonical_id, v_canonical.customer_code)
    on conflict (owner_id, customer_code)
    do update set customer_id = excluded.customer_id, last_seen_at = now();
  end if;

  if v_duplicate.customer_code is not null then
    insert into public.customer_holoo_codes (owner_id, customer_id, customer_code)
    values (p_owner_id, p_canonical_id, v_duplicate.customer_code)
    on conflict (owner_id, customer_code)
    do update set customer_id = excluded.customer_id, last_seen_at = now();
  end if;

  update public.customer_holoo_codes
  set customer_id = p_canonical_id,
      last_seen_at = now()
  where owner_id = p_owner_id
    and customer_id = p_duplicate_id;

  -- Campaign membership has a unique (campaign_id, customer_id) key.
  for v_duplicate_member in
    select cm.*
    from public.campaign_members cm
    where cm.owner_id = p_owner_id
      and cm.customer_id = p_duplicate_id
    order by cm.created_at
  loop
    select cm.id
    into v_canonical_member_id
    from public.campaign_members cm
    where cm.owner_id = p_owner_id
      and cm.campaign_id = v_duplicate_member.campaign_id
      and cm.customer_id = p_canonical_id
    limit 1;

    if v_canonical_member_id is null then
      update public.campaign_members
      set customer_id = p_canonical_id
      where id = v_duplicate_member.id
        and owner_id = p_owner_id;
    else
      update public.followups
      set campaign_member_id = v_canonical_member_id
      where owner_id = p_owner_id
        and campaign_member_id = v_duplicate_member.id;

      update public.sales_opportunities
      set campaign_member_id = v_canonical_member_id
      where owner_id = p_owner_id
        and campaign_member_id = v_duplicate_member.id;

      update public.sms_messages
      set campaign_member_id = v_canonical_member_id
      where owner_id = p_owner_id
        and campaign_member_id = v_duplicate_member.id;

      update public.campaign_members cm
      set
        status = case
          when cm.status = 'ordered' or v_duplicate_member.status = 'ordered' then 'ordered'
          when cm.status = 'requested_price' or v_duplicate_member.status = 'requested_price' then 'requested_price'
          when cm.status = 'follow_up' or v_duplicate_member.status = 'follow_up' then 'follow_up'
          when cm.status = 'contacted' or v_duplicate_member.status = 'contacted' then 'contacted'
          else cm.status
        end,
        contacted_at = coalesce(cm.contacted_at, v_duplicate_member.contacted_at),
        responded_at = coalesce(cm.responded_at, v_duplicate_member.responded_at),
        ordered_at = coalesce(cm.ordered_at, v_duplicate_member.ordered_at),
        next_followup_at = coalesce(
          least(cm.next_followup_at, v_duplicate_member.next_followup_at),
          cm.next_followup_at,
          v_duplicate_member.next_followup_at
        ),
        order_value = greatest(
          coalesce(cm.order_value, 0),
          coalesce(v_duplicate_member.order_value, 0)
        ),
        notes = coalesce(cm.notes, v_duplicate_member.notes),
        updated_at = now()
      where cm.owner_id = p_owner_id
        and cm.id = v_canonical_member_id;

      delete from public.campaign_members
      where owner_id = p_owner_id
        and id = v_duplicate_member.id;
    end if;
  end loop;

  -- Preserve the one-open-opportunity-per-customer invariant.
  for v_duplicate_opportunity in
    select so.*
    from public.sales_opportunities so
    where so.owner_id = p_owner_id
      and so.customer_id = p_duplicate_id
    order by so.created_at
  loop
    v_canonical_opportunity_id := null;

    if v_duplicate_opportunity.status in ('open', 'on_hold') then
      select so.id
      into v_canonical_opportunity_id
      from public.sales_opportunities so
      where so.owner_id = p_owner_id
        and so.customer_id = p_canonical_id
        and so.status in ('open', 'on_hold')
      order by so.updated_at desc
      limit 1;
    end if;

    if v_canonical_opportunity_id is null then
      update public.sales_opportunities
      set customer_id = p_canonical_id
      where owner_id = p_owner_id
        and id = v_duplicate_opportunity.id;
    else
      update public.followups
      set opportunity_id = v_canonical_opportunity_id
      where owner_id = p_owner_id
        and opportunity_id = v_duplicate_opportunity.id;

      update public.sms_messages
      set opportunity_id = v_canonical_opportunity_id
      where owner_id = p_owner_id
        and opportunity_id = v_duplicate_opportunity.id;

      update public.sales_opportunities so
      set
        product_interest = coalesce(so.product_interest, v_duplicate_opportunity.product_interest),
        quoted_at = least(so.quoted_at, v_duplicate_opportunity.quoted_at),
        last_contact_at = greatest(so.last_contact_at, v_duplicate_opportunity.last_contact_at),
        next_followup_at = coalesce(
          least(so.next_followup_at, v_duplicate_opportunity.next_followup_at),
          so.next_followup_at,
          v_duplicate_opportunity.next_followup_at
        ),
        estimated_value = greatest(
          coalesce(so.estimated_value, 0),
          coalesce(v_duplicate_opportunity.estimated_value, 0)
        ),
        notes = coalesce(so.notes, v_duplicate_opportunity.notes),
        updated_at = now()
      where so.owner_id = p_owner_id
        and so.id = v_canonical_opportunity_id;

      delete from public.sales_opportunities
      where owner_id = p_owner_id
        and id = v_duplicate_opportunity.id;
    end if;
  end loop;

  update public.invoices
  set customer_id = p_canonical_id
  where owner_id = p_owner_id and customer_id = p_duplicate_id;

  update public.sales
  set customer_id = p_canonical_id
  where owner_id = p_owner_id and customer_id = p_duplicate_id;

  update public.followups
  set customer_id = p_canonical_id
  where owner_id = p_owner_id and customer_id = p_duplicate_id;

  update public.tasks
  set customer_id = p_canonical_id
  where owner_id = p_owner_id and customer_id = p_duplicate_id;

  update public.customer_files
  set customer_id = p_canonical_id
  where owner_id = p_owner_id and customer_id = p_duplicate_id;

  update public.sms_messages
  set customer_id = p_canonical_id
  where owner_id = p_owner_id and customer_id = p_duplicate_id;

  update public.customers c
  set
    customer_code = coalesce(c.customer_code, v_duplicate.customer_code),
    name = case
      when c.name = 'مشتری بدون نام' and v_duplicate.name <> 'مشتری بدون نام'
        then v_duplicate.name
      when length(v_duplicate.name) > length(c.name)
        then v_duplicate.name
      else c.name
    end,
    contact_name = coalesce(c.contact_name, v_duplicate.contact_name),
    phone = coalesce(c.phone, v_duplicate.phone),
    normalized_phone = coalesce(c.normalized_phone, v_duplicate.normalized_phone),
    province = coalesce(c.province, v_duplicate.province),
    city = coalesce(c.city, v_duplicate.city),
    address = coalesce(c.address, v_duplicate.address),
    preferred_products = array(
      select distinct value
      from unnest(
        coalesce(c.preferred_products, '{}'::text[])
        || coalesce(v_duplicate.preferred_products, '{}'::text[])
      ) as value
      where value is not null and btrim(value) <> ''
    ),
    status = case
      when c.status = 'active' or v_duplicate.status = 'active' then 'active'
      when c.status = 'prospect' or v_duplicate.status = 'prospect' then 'prospect'
      when c.status = 'inactive' or v_duplicate.status = 'inactive' then 'inactive'
      else 'lost'
    end,
    priority = case
      when c.priority = 'vip' or v_duplicate.priority = 'vip' then 'vip'
      when c.priority = 'high' or v_duplicate.priority = 'high' then 'high'
      when c.priority = 'normal' or v_duplicate.priority = 'normal' then 'normal'
      else 'low'
    end,
    notes = case
      when c.notes is null then v_duplicate.notes
      when v_duplicate.notes is null or c.notes = v_duplicate.notes then c.notes
      else c.notes || E'\n---\n' || v_duplicate.notes
    end,
    next_followup_at = coalesce(
      least(c.next_followup_at, v_duplicate.next_followup_at),
      c.next_followup_at,
      v_duplicate.next_followup_at
    ),
    imported_last_purchase_at = greatest(c.imported_last_purchase_at, v_duplicate.imported_last_purchase_at),
    imported_purchase_count = greatest(c.imported_purchase_count, v_duplicate.imported_purchase_count),
    imported_total_sales = greatest(c.imported_total_sales, v_duplicate.imported_total_sales),
    imported_avg_purchase_gap_days = coalesce(c.imported_avg_purchase_gap_days, v_duplicate.imported_avg_purchase_gap_days),
    lead_stage = case
      when c.lead_stage = 'converted' or v_duplicate.lead_stage = 'converted' then 'converted'
      else coalesce(c.lead_stage, v_duplicate.lead_stage)
    end,
    lead_source = coalesce(c.lead_source, v_duplicate.lead_source),
    potential_value = greatest(coalesce(c.potential_value, 0), coalesce(v_duplicate.potential_value, 0)),
    archived_at = case
      when c.archived_at is null or v_duplicate.archived_at is null then null
      else least(c.archived_at, v_duplicate.archived_at)
    end,
    holo_balance_amount = case
      when coalesce(v_duplicate.holo_last_synced_at, '-infinity'::timestamptz)
        > coalesce(c.holo_last_synced_at, '-infinity'::timestamptz)
        then v_duplicate.holo_balance_amount
      else c.holo_balance_amount
    end,
    holo_balance_status = case
      when coalesce(v_duplicate.holo_last_synced_at, '-infinity'::timestamptz)
        > coalesce(c.holo_last_synced_at, '-infinity'::timestamptz)
        then v_duplicate.holo_balance_status
      else c.holo_balance_status
    end,
    holo_source_updated_at = greatest(c.holo_source_updated_at, v_duplicate.holo_source_updated_at),
    holo_last_synced_at = greatest(c.holo_last_synced_at, v_duplicate.holo_last_synced_at),
    created_at = least(c.created_at, v_duplicate.created_at),
    updated_at = now()
  where c.owner_id = p_owner_id
    and c.id = p_canonical_id;

  delete from public.customers
  where owner_id = p_owner_id
    and id = p_duplicate_id;
end;
$$;

revoke all on function public.merge_customer_duplicate(uuid, uuid, uuid)
  from public, anon, authenticated;

-- Merge only conservative duplicates: same normalized phone and identical or
-- containing normalized names. Exact shared-phone but unrelated names remain separate.
do $$
declare
  v_pair record;
  v_canonical_id uuid;
  v_duplicate_id uuid;
begin
  for v_pair in
    select
      a.owner_id,
      a.id as a_id,
      b.id as b_id
    from public.customers a
    join public.customers b
      on b.owner_id = a.owner_id
     and b.id > a.id
     and b.normalized_phone = a.normalized_phone
    where a.normalized_phone is not null
      and length(a.normalized_phone) >= 7
      and (
        public.normalize_customer_identity_name(a.name)
          = public.normalize_customer_identity_name(b.name)
        or (
          least(
            length(coalesce(public.normalize_customer_identity_name(a.name), '')),
            length(coalesce(public.normalize_customer_identity_name(b.name), ''))
          ) >= 5
          and (
            public.normalize_customer_identity_name(a.name)
              like '%' || public.normalize_customer_identity_name(b.name) || '%'
            or public.normalize_customer_identity_name(b.name)
              like '%' || public.normalize_customer_identity_name(a.name) || '%'
          )
        )
      )
    order by a.owner_id, a.normalized_phone, a.created_at, b.created_at
  loop
    select candidate.id
    into v_canonical_id
    from (
      select c.id, c.customer_code, c.created_at,
        (
          (select count(*) from public.invoices i where i.owner_id = c.owner_id and i.customer_id = c.id)
          + (select count(*) from public.sales s where s.owner_id = c.owner_id and s.customer_id = c.id)
          + (select count(*) from public.followups f where f.owner_id = c.owner_id and f.customer_id = c.id)
        ) as activity_count
      from public.customers c
      where c.owner_id = v_pair.owner_id
        and c.id in (v_pair.a_id, v_pair.b_id)
    ) candidate
    order by
      (candidate.customer_code is not null) desc,
      candidate.activity_count desc,
      candidate.created_at,
      candidate.id
    limit 1;

    if v_canonical_id is null then
      continue;
    end if;

    v_duplicate_id := case
      when v_canonical_id = v_pair.a_id then v_pair.b_id
      else v_pair.a_id
    end;

    perform public.merge_customer_duplicate(
      v_pair.owner_id,
      v_canonical_id,
      v_duplicate_id
    );
  end loop;
end
$$;

-- Wrap the receiver so every current/future Holoo code resolves through aliases.
do $$
begin
  if to_regprocedure('public.sync_holoo_agent_batch_v16(uuid,jsonb)') is null then
    alter function public.sync_holoo_agent_batch(uuid, jsonb)
      rename to sync_holoo_agent_batch_v16;
  end if;
end
$$;

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
  v_payload jsonb := p_payload;
  v_customer jsonb;
  v_invoice jsonb;
  v_customers jsonb := '[]'::jsonb;
  v_invoices jsonb := '[]'::jsonb;
  v_batch_map jsonb := '{}'::jsonb;
  v_pending_aliases jsonb := '[]'::jsonb;
  v_alias jsonb;
  v_code text;
  v_primary_code text;
  v_name text;
  v_name_key text;
  v_phone text;
  v_normalized_phone text;
  v_identity_key text;
  v_customer_id uuid;
  v_result jsonb;
begin
  if p_owner_id is null then
    raise exception 'Owner id is required';
  end if;

  if jsonb_typeof(p_payload->'customers') = 'array' then
    for v_customer in
      select value from jsonb_array_elements(p_payload->'customers')
    loop
      v_code := nullif(btrim(v_customer->>'code'), '');
      v_name := coalesce(nullif(btrim(v_customer->>'name'), ''), 'مشتری بدون نام');
      v_name_key := public.normalize_customer_identity_name(v_name);
      v_phone := coalesce(
        nullif(btrim(v_customer->>'mobile'), ''),
        nullif(btrim(v_customer->>'telephone'), '')
      );
      v_normalized_phone := public.normalize_iran_phone(v_phone);
      v_identity_key := coalesce(v_normalized_phone, '') || '|' || coalesce(v_name_key, '');
      v_customer_id := null;
      v_primary_code := null;

      if v_code is not null then
        select h.customer_id
        into v_customer_id
        from public.customer_holoo_codes h
        where h.owner_id = p_owner_id
          and h.customer_code = v_code;
      end if;

      if v_customer_id is null and v_code is not null then
        select c.id
        into v_customer_id
        from public.customers c
        where c.owner_id = p_owner_id
          and c.customer_code = v_code
        limit 1;
      end if;

      if v_customer_id is null
         and v_normalized_phone is not null
         and v_name_key is not null then
        select c.id
        into v_customer_id
        from public.customers c
        where c.owner_id = p_owner_id
          and c.normalized_phone = v_normalized_phone
          and public.normalize_customer_identity_name(c.name) = v_name_key
        order by
          (c.customer_code is not null) desc,
          c.created_at
        limit 1;
      end if;

      if v_customer_id is not null then
        select c.customer_code
        into v_primary_code
        from public.customers c
        where c.owner_id = p_owner_id
          and c.id = v_customer_id
        for update;

        if v_primary_code is null and v_code is not null then
          update public.customers
          set customer_code = v_code,
              updated_at = now()
          where owner_id = p_owner_id
            and id = v_customer_id;
          v_primary_code := v_code;
        end if;

        if v_code is not null then
          insert into public.customer_holoo_codes (
            owner_id, customer_id, customer_code, last_seen_at
          ) values (
            p_owner_id, v_customer_id, v_code, now()
          )
          on conflict (owner_id, customer_code)
          do update set
            customer_id = excluded.customer_id,
            last_seen_at = now();
        end if;

        if v_primary_code is not null then
          v_customer := jsonb_set(
            v_customer,
            '{code}',
            to_jsonb(v_primary_code),
            true
          );
          v_batch_map := jsonb_set(
            v_batch_map,
            array[v_identity_key],
            to_jsonb(v_primary_code),
            true
          );
        end if;
      elsif v_identity_key <> '|'
        and v_batch_map ? v_identity_key then
        v_primary_code := v_batch_map->>v_identity_key;

        if v_primary_code is not null then
          if v_code is not null and v_code <> v_primary_code then
            v_pending_aliases := v_pending_aliases || jsonb_build_array(
              jsonb_build_object(
                'incomingCode', v_code,
                'primaryCode', v_primary_code
              )
            );
          end if;

          v_customer := jsonb_set(
            v_customer,
            '{code}',
            to_jsonb(v_primary_code),
            true
          );
        end if;
      elsif v_identity_key <> '|' and v_code is not null then
        v_batch_map := jsonb_set(
          v_batch_map,
          array[v_identity_key],
          to_jsonb(v_code),
          true
        );
      end if;

      v_customers := v_customers || jsonb_build_array(v_customer);
    end loop;

    v_payload := jsonb_set(v_payload, '{customers}', v_customers, true);
  end if;

  if jsonb_typeof(p_payload->'invoices') = 'array' then
    for v_invoice in
      select value from jsonb_array_elements(p_payload->'invoices')
    loop
      v_code := nullif(btrim(v_invoice->>'customerCode'), '');
      v_customer_id := null;
      v_primary_code := null;

      if v_code is not null then
        select h.customer_id
        into v_customer_id
        from public.customer_holoo_codes h
        where h.owner_id = p_owner_id
          and h.customer_code = v_code;
      end if;

      if v_customer_id is not null then
        select c.customer_code
        into v_primary_code
        from public.customers c
        where c.owner_id = p_owner_id
          and c.id = v_customer_id;

        if v_primary_code is not null then
          v_invoice := jsonb_set(
            v_invoice,
            '{customerCode}',
            to_jsonb(v_primary_code),
            true
          );
        end if;
      end if;

      v_invoices := v_invoices || jsonb_build_array(v_invoice);
    end loop;

    v_payload := jsonb_set(v_payload, '{invoices}', v_invoices, true);
  end if;

  v_result := public.sync_holoo_agent_batch_v16(
    p_owner_id,
    v_payload
  );

  for v_alias in
    select value from jsonb_array_elements(v_pending_aliases)
  loop
    select c.id
    into v_customer_id
    from public.customers c
    where c.owner_id = p_owner_id
      and c.customer_code = v_alias->>'primaryCode'
    limit 1;

    if v_customer_id is not null then
      insert into public.customer_holoo_codes (
        owner_id, customer_id, customer_code, last_seen_at
      ) values (
        p_owner_id,
        v_customer_id,
        v_alias->>'incomingCode',
        now()
      )
      on conflict (owner_id, customer_code)
      do update set
        customer_id = excluded.customer_id,
        last_seen_at = now();
    end if;
  end loop;

  return v_result;
end;
$$;

revoke all on function public.sync_holoo_agent_batch_v16(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.sync_holoo_agent_batch(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_holoo_agent_batch(uuid, jsonb)
  to service_role;

commit;
