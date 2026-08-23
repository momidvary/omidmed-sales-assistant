-- Legacy rows as they exist on a pre-024 database, used to prove what
-- migration 024 does and does not rewrite.
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@example.test');

insert into public.employees (id, owner_id, name, role_title, monthly_base_salary)
values ('22222222-2222-4222-8222-222222222222',
        '11111111-1111-4111-8111-111111111111', 'کارگر نمونه', 'دوزنده', 10000000);

-- A: net_pay already matches the derived formula (must stay untouched).
insert into public.payroll_entries
  (id, owner_id, employee_id, jalali_year, jalali_month,
   base_salary, overtime_amount, bonus_amount, allowance_amount,
   deductions_amount, advance_amount, paid_amount, net_pay, status)
values ('33333333-3333-4333-8333-333333333331',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222', 1404, 1,
        10000000, 1000000, 0, 0, 500000, 0, 10500000, 10500000, 'paid');

-- B: advance paid, nothing else (advance must count as payment, not a cost cut).
insert into public.payroll_entries
  (id, owner_id, employee_id, jalali_year, jalali_month,
   base_salary, overtime_amount, bonus_amount, allowance_amount,
   deductions_amount, advance_amount, paid_amount, net_pay, status)
values ('33333333-3333-4333-8333-333333333332',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222', 1404, 2,
        10000000, 0, 0, 0, 0, 4000000, 0, 10000000, 'unpaid');

-- C: net_pay deliberately overridden by the user (a negotiated settlement).
insert into public.payroll_entries
  (id, owner_id, employee_id, jalali_year, jalali_month,
   base_salary, overtime_amount, bonus_amount, allowance_amount,
   deductions_amount, advance_amount, paid_amount, net_pay, status)
values ('33333333-3333-4333-8333-333333333333',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222', 1404, 3,
        10000000, 0, 0, 0, 0, 0, 0, 7777777, 'unpaid');

insert into public.suppliers (id, owner_id, name)
values ('44444444-4444-4444-8444-444444444444',
        '11111111-1111-4111-8111-111111111111', 'تأمین‌کننده نمونه');

insert into public.purchase_invoices
  (id, owner_id, supplier_id, invoice_number, invoice_date, subtotal,
   total_amount, payment_status)
values
  ('55555555-5555-4555-8555-555555555551','11111111-1111-4111-8111-111111111111',
   '44444444-4444-4444-8444-444444444444','P-PAID', current_date, 5000000, 5000000, 'paid'),
  ('55555555-5555-4555-8555-555555555552','11111111-1111-4111-8111-111111111111',
   '44444444-4444-4444-8444-444444444444','P-UNPAID', current_date, 3000000, 3000000, 'unpaid'),
  ('55555555-5555-4555-8555-555555555553','11111111-1111-4111-8111-111111111111',
   '44444444-4444-4444-8444-444444444444','P-PARTIAL', current_date, 8000000, 8000000, 'partial');
