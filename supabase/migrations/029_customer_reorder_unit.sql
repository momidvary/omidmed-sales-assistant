-- The customer's existing RLS and Holoo identity apply to the optional unit.
alter table public.customers add column if not exists reorder_unit jsonb
  check (reorder_unit is null or jsonb_typeof(reorder_unit) = 'object');
