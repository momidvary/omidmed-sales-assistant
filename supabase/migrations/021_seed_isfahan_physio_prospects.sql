-- Seed public business mobile numbers for Isfahan physiotherapy prospects.
--
-- This migration is intentionally idempotent:
-- - it never changes an existing customer with the same normalized phone;
-- - it uses stable customer codes and ON CONFLICT DO NOTHING;
-- - eight lower-confidence public listings are clearly marked for a test call.

begin;

do $$
declare
  target_owner_id uuid;
begin
  -- The application is currently single-user. Prefer the owner that already has
  -- the largest customer bank, then fall back to the first authenticated user.
  select c.owner_id
  into target_owner_id
  from public.customers c
  where c.owner_id is not null
  group by c.owner_id
  order by count(*) desc
  limit 1;

  if target_owner_id is null then
    select u.id
    into target_owner_id
    from auth.users u
    order by u.created_at asc
    limit 1;
  end if;

  if target_owner_id is null then
    raise exception 'No application owner was found; create the first user before running migration 021.';
  end if;

  insert into public.customers (
    owner_id,
    customer_code,
    name,
    phone,
    normalized_phone,
    province,
    city,
    status,
    priority,
    lead_stage,
    lead_source,
    notes
  )
  select
    target_owner_id,
    'PROSPECT-ISFAHAN-' || prospect.phone,
    prospect.name,
    prospect.phone,
    prospect.phone,
    'اصفهان',
    'اصفهان',
    'prospect',
    'normal',
    'new',
    'بانک اطلاعات عمومی فیزیوتراپی اصفهان',
    case prospect.verification
      when 'strong' then
        'شماره موبایل عمومی کسب‌وکار با تطبیق قوی نام و نشانی؛ افزوده‌شده به فهرست مشتریان بالقوه اصفهان.'
      else
        'شماره موبایل عمومی نیازمند تماس آزمایشی پیش از ارسال انبوه؛ نام، نشانی یا قدمت منبع نیاز به تأیید دارد.'
    end
  from (
    values
      ('فیزیوتراپی آوای زندگی', '09022216861', 'strong'),
      ('فیزیوتراپی ابوریحان', '09138927924', 'strong'),
      ('فیزیوتراپی استقلال', '09135406920', 'strong'),
      ('فیزیوتراپی الهیه', '09136842562', 'strong'),
      ('فیزیوتراپی امین', '09126450938', 'strong'),
      ('فیزیوتراپی برهان اصفهان', '09228673072', 'strong'),
      ('فیزیوتراپی بهار', '09902461016', 'strong'),
      ('فیزیوتراپی تریتا', '09351771145', 'strong'),
      ('فیزیوتراپی توحید', '09387494548', 'strong'),
      ('فیزیوتراپی دکتر علی اصغر کلانتری', '09131299687', 'strong'),
      ('فیزیوتراپی راحیل', '09134097240', 'strong'),
      ('فیزیوتراپی سبز', '09137262655', 'strong'),
      ('فیزیوتراپی سلامت', '09301376530', 'strong'),
      ('فیزیوتراپی شکیبا', '09135738340', 'strong'),
      ('فیزیوتراپی عمومی غیرمستقل فرهنگیان اصفهان', '09370723675', 'strong'),
      ('فیزیوتراپی نسیم سلامت', '09132113550', 'strong'),
      ('فیزیوتراپی نیکا', '09135858090', 'strong'),
      ('فیزیوتراپی کاظمیه', '09132107439', 'strong'),
      ('فیزیوتراپی باران', '09130803070', 'review'),
      ('فیزیوتراپی بهروش', '09135355117', 'review'),
      ('فیزیوتراپی رازی', '09123079511', 'review'),
      ('فیزیوتراپی سپهر', '09166803044', 'review'),
      ('فیزیوتراپی نادریان', '09202344232', 'review'),
      ('فیزیوتراپی پارسیس', '09138282952', 'review'),
      ('فیزیوتراپی یکتا', '09103592896', 'review'),
      ('فیزیوتراپی یگانه', '09133011206', 'review')
  ) as prospect(name, phone, verification)
  where not exists (
    select 1
    from public.customers existing
    where existing.owner_id = target_owner_id
      and existing.normalized_phone = prospect.phone
  )
  on conflict do nothing;
end
$$;

commit;

-- Verification: expected maximum is 26 rows; fewer means some phones already existed.
select
  count(*) as isfahan_physio_prospect_count,
  count(*) filter (
    where notes like 'شماره موبایل عمومی نیازمند تماس آزمایشی%'
  ) as needs_test_call_count
from public.customers
where customer_code like 'PROSPECT-ISFAHAN-%';
