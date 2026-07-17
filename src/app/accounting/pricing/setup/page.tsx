import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import AppShell from "@/components/app-shell";
import AccountingNav from "@/components/accounting-nav";
import { expenseCategoryLabels, productCategoryLabels } from "@/lib/accounting/constants";
import {
  currentJalaliMonthRange,
  formatDecimal,
  formatMoney,
  normalizeDigits,
  parseInteger,
} from "@/lib/accounting/format";
import { jalaliToGregorian } from "@/lib/jalali";
import { createClient } from "@/lib/supabase/server";

import styles from "./setup.module.css";

type SetupProfile = {
  jalali_year: number;
  jalali_month: number;
  working_days: number;
  daily_work_hours: number | string;
  allocation_method: "standard_minutes" | "units" | "manual";
  monthly_sales_target: number | string;
  notes: string | null;
};

type Employee = {
  id: string;
  name: string;
  role_title: string | null;
  monthly_base_salary: number | string;
};

type EmployeeProfile = {
  employee_id: string;
  department: string;
  production_share_percent: number | string;
  productive_hours_per_month: number | string | null;
  notes: string | null;
};

type Product = {
  id: string;
  name: string;
  category: string;
  unit: string;
  direct_labor_per_unit: number | string;
  packaging_per_unit: number | string;
  other_variable_per_unit: number | string;
  current_cash_price: number | string | null;
};

type ProductProfile = {
  product_id: string;
  planned_monthly_output: number | string;
  standard_minutes_per_unit: number | string;
  actual_scrap_percent: number | string;
  manual_overhead_per_unit: number | string | null;
  notes: string | null;
};

type ExpenseRule = {
  category: string;
  include_in_product_cost: boolean;
  manufacturing_share_percent: number | string;
  allocation_basis: string;
  notes: string | null;
};

type CostingSettings = {
  default_min_margin: number | string;
  default_cash_margin: number | string;
  default_wholesale_margin: number | string;
  default_festival_margin: number | string;
  default_credit_monthly_rate: number | string;
  inflation_buffer_percent: number | string;
  stale_price_days: number | string;
  rounding_step: number | string;
  include_payroll_in_overhead: boolean;
};

const departments: Record<string, string> = {
  production: "تولید",
  printing: "چاپ",
  packing: "بسته‌بندی",
  sales: "فروش",
  admin: "مدیریت و اداری",
  other: "سایر",
};

const expenseDefaults: Record<string, number> = {
  rent: 100,
  utilities: 100,
  direct_labor: 100,
  indirect_labor: 70,
  sewing: 100,
  printing: 100,
  packaging: 100,
  shipping: 30,
  maintenance: 100,
  advertising: 0,
  equipment: 0,
  tax_fee: 0,
  insurance: 70,
  software: 20,
  other: 50,
};

function numberValue(value: FormDataEntryValue | null, fallback = 0) {
  const normalized = normalizeDigits(String(value ?? "").trim());
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function textValue(value: FormDataEntryValue | null, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function monthRange(year: number, month: number) {
  const start = jalaliToGregorian(year, month, 1);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = jalaliToGregorian(nextYear, nextMonth, 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  const iso = (date: { gy: number; gm: number; gd: number } | null) =>
    date ? `${date.gy}-${pad(date.gm)}-${pad(date.gd)}` : "";
  return { from: iso(start), toExclusive: iso(end) };
}

function suggestDepartment(role: string | null) {
  const normalized = String(role ?? "").toLowerCase();
  if (normalized.includes("چاپ")) return "printing";
  if (normalized.includes("بسته")) return "packing";
  if (normalized.includes("فروش")) return "sales";
  if (normalized.includes("مدیر") || normalized.includes("اداری") || normalized.includes("حساب")) return "admin";
  return "production";
}

async function saveGeneralSetup(formData: FormData) {
  "use server";

  const current = currentJalaliMonthRange();
  const year = parseInteger(formData.get("jalali_year"), current.year);
  const month = parseInteger(formData.get("jalali_month"), current.month);
  const workingDays = parseInteger(formData.get("working_days"), 26);
  const dailyHours = numberValue(formData.get("daily_work_hours"), 7);
  const allocationMethod = textValue(formData.get("allocation_method"), 30);
  const monthlySalesTarget = numberValue(formData.get("monthly_sales_target"));
  const notes = textValue(formData.get("notes"), 2000) || null;

  if (
    year < 1300 ||
    year > 1700 ||
    month < 1 ||
    month > 12 ||
    workingDays < 1 ||
    workingDays > 31 ||
    dailyHours <= 0 ||
    dailyHours > 24 ||
    !new Set(["standard_minutes", "units", "manual"]).has(allocationMethod)
  ) {
    redirect("/accounting/pricing/setup?error=general-invalid");
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { error } = await supabase.from("pricing_setup_profiles").upsert({
    owner_id: userData.user.id,
    jalali_year: year,
    jalali_month: month,
    working_days: workingDays,
    daily_work_hours: dailyHours,
    allocation_method: allocationMethod,
    monthly_sales_target: monthlySalesTarget,
    notes,
  });

  if (error) redirect("/accounting/pricing/setup?error=general-save");
  revalidatePath("/accounting/pricing/setup");
  redirect("/accounting/pricing/setup?saved=general");
}

async function saveEmployeeProfiles(formData: FormData) {
  "use server";

  const employeeIds = formData.getAll("employee_id").map(String).filter(Boolean);
  const rows = employeeIds.map((employeeId) => ({
    employee_id: employeeId,
    department: textValue(formData.get(`department_${employeeId}`), 30) || "production",
    production_share_percent: numberValue(formData.get(`production_share_${employeeId}`), 100),
    productive_hours_per_month: numberValue(formData.get(`productive_hours_${employeeId}`), 0) || null,
    notes: textValue(formData.get(`employee_notes_${employeeId}`), 500) || null,
  }));

  if (
    rows.some(
      (row) =>
        !Object.hasOwn(departments, row.department) ||
        row.production_share_percent < 0 ||
        row.production_share_percent > 100,
    )
  ) {
    redirect("/accounting/pricing/setup?error=employees-invalid");
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  if (rows.length) {
    const { error } = await supabase.from("employee_costing_profiles").upsert(
      rows.map((row) => ({ ...row, owner_id: userData.user!.id })),
      { onConflict: "owner_id,employee_id" },
    );
    if (error) redirect("/accounting/pricing/setup?error=employees-save");
  }

  revalidatePath("/accounting/pricing/setup");
  redirect("/accounting/pricing/setup?saved=employees");
}

async function saveProductProfiles(formData: FormData) {
  "use server";

  const productIds = formData.getAll("product_id").map(String).filter(Boolean);
  const rows = productIds.map((productId) => ({
    product_id: productId,
    planned_monthly_output: numberValue(formData.get(`planned_output_${productId}`)),
    standard_minutes_per_unit: numberValue(formData.get(`standard_minutes_${productId}`)),
    actual_scrap_percent: numberValue(formData.get(`actual_scrap_${productId}`)),
    manual_overhead_per_unit: numberValue(formData.get(`manual_overhead_${productId}`), 0) || null,
    notes: textValue(formData.get(`product_notes_${productId}`), 500) || null,
  }));

  if (rows.some((row) => row.actual_scrap_percent > 500)) {
    redirect("/accounting/pricing/setup?error=products-invalid");
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  if (rows.length) {
    const { error } = await supabase.from("product_costing_profiles").upsert(
      rows.map((row) => ({ ...row, owner_id: userData.user!.id })),
      { onConflict: "owner_id,product_id" },
    );
    if (error) redirect("/accounting/pricing/setup?error=products-save");
  }

  revalidatePath("/accounting/pricing/setup");
  redirect("/accounting/pricing/setup?saved=products");
}

async function saveExpenseRules(formData: FormData) {
  "use server";

  const categories = formData.getAll("expense_category").map(String).filter(Boolean);
  const rows = categories.map((category) => ({
    category,
    include_in_product_cost: formData.get(`include_${category}`) === "on",
    manufacturing_share_percent: numberValue(
      formData.get(`manufacturing_share_${category}`),
      expenseDefaults[category] ?? 50,
    ),
    allocation_basis: textValue(formData.get(`allocation_basis_${category}`), 30) || "standard_minutes",
    notes: textValue(formData.get(`expense_notes_${category}`), 500) || null,
  }));

  if (
    rows.some(
      (row) =>
        row.manufacturing_share_percent > 100 ||
        !new Set(["standard_minutes", "units", "manual"]).has(row.allocation_basis),
    )
  ) {
    redirect("/accounting/pricing/setup?error=expenses-invalid");
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { error } = await supabase.from("expense_costing_rules").upsert(
    rows.map((row) => ({ ...row, owner_id: userData.user!.id })),
    { onConflict: "owner_id,category" },
  );

  if (error) redirect("/accounting/pricing/setup?error=expenses-save");
  revalidatePath("/accounting/pricing/setup");
  redirect("/accounting/pricing/setup?saved=expenses");
}

async function savePricingPolicy(formData: FormData) {
  "use server";

  const values = {
    default_min_margin: numberValue(formData.get("default_min_margin"), 10),
    default_cash_margin: numberValue(formData.get("default_cash_margin"), 30),
    default_wholesale_margin: numberValue(formData.get("default_wholesale_margin"), 20),
    default_festival_margin: numberValue(formData.get("default_festival_margin"), 15),
    default_credit_monthly_rate: numberValue(formData.get("default_credit_monthly_rate"), 3),
    inflation_buffer_percent: numberValue(formData.get("inflation_buffer_percent"), 10),
    stale_price_days: parseInteger(formData.get("stale_price_days"), 30),
    rounding_step: numberValue(formData.get("rounding_step"), 1000),
    include_payroll_in_overhead: formData.get("include_payroll_in_overhead") === "on",
  };

  const margins = [
    values.default_min_margin,
    values.default_cash_margin,
    values.default_wholesale_margin,
    values.default_festival_margin,
  ];

  if (
    margins.some((margin) => margin < 0 || margin >= 95) ||
    values.default_credit_monthly_rate > 100 ||
    values.inflation_buffer_percent > 300 ||
    values.stale_price_days < 1 ||
    values.rounding_step <= 0
  ) {
    redirect("/accounting/pricing/setup?error=policy-invalid");
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: existing } = await supabase
    .from("costing_settings")
    .select("monthly_fixed_overhead,overhead_mode,planned_monthly_output")
    .maybeSingle();

  const { error } = await supabase.from("costing_settings").upsert({
    owner_id: userData.user.id,
    monthly_fixed_overhead: Number(existing?.monthly_fixed_overhead ?? 0),
    overhead_mode: existing?.overhead_mode ?? "actual_current_month",
    planned_monthly_output: Math.max(1, Number(existing?.planned_monthly_output ?? 1)),
    ...values,
  });

  if (error) redirect("/accounting/pricing/setup?error=policy-save");
  revalidatePath("/accounting/pricing/setup");
  revalidatePath("/accounting/pricing");
  redirect("/accounting/pricing/setup?saved=policy");
}

async function applyCalculatedOverhead() {
  "use server";

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: setup, error: setupError } = await supabase
    .from("pricing_setup_profiles")
    .select("jalali_year,jalali_month,allocation_method")
    .maybeSingle();
  if (setupError || !setup) redirect("/accounting/pricing/setup?error=apply-setup");

  const range = monthRange(setup.jalali_year, setup.jalali_month);
  const [employeeProfilesResult, payrollResult, rulesResult, expensesResult, productProfilesResult] =
    await Promise.all([
      supabase
        .from("employee_costing_profiles")
        .select("employee_id,department,production_share_percent"),
      supabase
        .from("payroll_entries")
        .select("employee_id,net_pay,employer_costs")
        .eq("jalali_year", setup.jalali_year)
        .eq("jalali_month", setup.jalali_month),
      supabase
        .from("expense_costing_rules")
        .select("category,include_in_product_cost,manufacturing_share_percent"),
      supabase
        .from("workshop_expenses")
        .select("category,amount,cost_scope,manufacturing_share_percent,classification_status")
        .gte("expense_date", range.from)
        .lt("expense_date", range.toExclusive),
      supabase
        .from("product_costing_profiles")
        .select("product_id,planned_monthly_output,standard_minutes_per_unit,actual_scrap_percent,manual_overhead_per_unit"),
    ]);

  const error =
    employeeProfilesResult.error ||
    payrollResult.error ||
    rulesResult.error ||
    expensesResult.error ||
    productProfilesResult.error;
  if (error) redirect("/accounting/pricing/setup?error=apply-read");

  const employeeMap = new Map(
    (employeeProfilesResult.data ?? []).map((row) => [row.employee_id, row]),
  );
  let productionPayroll = 0;
  let sellingPayroll = 0;
  for (const row of payrollResult.data ?? []) {
    const profile = employeeMap.get(row.employee_id);
    const total = Number(row.net_pay ?? 0) + Number(row.employer_costs ?? 0);
    const share = Number(profile?.production_share_percent ?? 0) / 100;
    if (["production", "printing", "packing"].includes(profile?.department ?? "")) {
      productionPayroll += total * share;
    } else if (profile?.department === "sales") {
      sellingPayroll += total;
    }
  }

  const ruleMap = new Map(
    (rulesResult.data ?? []).map((row) => [row.category, row]),
  );
  let allocatedExpenses = 0;
  let allocatedSellingExpenses = 0;
  for (const row of expensesResult.data ?? []) {
    const amount = Number(row.amount ?? 0);
    if (["confirmed", "auto"].includes(row.classification_status ?? "")) {
      if (row.cost_scope === "manufacturing") {
        allocatedExpenses += amount * (Number(row.manufacturing_share_percent ?? 0) / 100);
      } else if (row.cost_scope === "selling") {
        allocatedSellingExpenses += amount;
      }
      continue;
    }
    const rule = ruleMap.get(row.category);
    if (rule?.include_in_product_cost) {
      allocatedExpenses += amount * (Number(rule.manufacturing_share_percent ?? 0) / 100);
    }
  }

  const profiles = (productProfilesResult.data ?? []) as ProductProfile[];
  const totalPlannedOutput = profiles.reduce(
    (sum, profile) => sum + Number(profile.planned_monthly_output ?? 0),
    0,
  );
  const totalProductiveMinutes = profiles.reduce(
    (sum, profile) =>
      sum +
      Number(profile.planned_monthly_output ?? 0) *
        Number(profile.standard_minutes_per_unit ?? 0) *
        (1 + Number(profile.actual_scrap_percent ?? 0) / 100),
    0,
  );

  if (!profiles.length || totalPlannedOutput <= 0) {
    redirect("/accounting/pricing/setup?error=apply-products");
  }

  const overheadPool = productionPayroll + allocatedExpenses;
  const sellingPool = sellingPayroll + allocatedSellingExpenses;
  const costPerMinute = totalProductiveMinutes > 0 ? overheadPool / totalProductiveMinutes : 0;
  const costPerUnit = totalPlannedOutput > 0 ? overheadPool / totalPlannedOutput : 0;
  const sellingCostPerUnit = totalPlannedOutput > 0 ? sellingPool / totalPlannedOutput : 0;

  const updates = profiles.map((profile) => {
    const manual = Number(profile.manual_overhead_per_unit ?? 0);
    const minutes =
      Number(profile.standard_minutes_per_unit ?? 0) *
      (1 + Number(profile.actual_scrap_percent ?? 0) / 100);
    const calculated =
      setup.allocation_method === "manual" && manual > 0
        ? manual
        : setup.allocation_method === "units"
          ? costPerUnit
          : minutes * costPerMinute;
    return {
      id: profile.product_id,
      overhead_per_unit_override: Math.max(0, Math.round(calculated)),
      selling_cost_per_unit_override: Math.max(0, Math.round(sellingCostPerUnit)),
    };
  });

  for (const update of updates) {
    const { error: updateError } = await supabase
      .from("costing_products")
      .update({
        overhead_per_unit_override: update.overhead_per_unit_override,
        selling_cost_per_unit_override: update.selling_cost_per_unit_override,
      })
      .eq("id", update.id);
    if (updateError) redirect("/accounting/pricing/setup?error=apply-update");
  }

  const { error: settingsError } = await supabase.from("costing_settings").upsert({
    owner_id: userData.user.id,
    monthly_fixed_overhead: Math.round(overheadPool),
    monthly_selling_overhead: Math.round(sellingPool),
    overhead_mode: "manual",
    planned_monthly_output: Math.max(1, totalPlannedOutput),
  });
  if (settingsError) redirect("/accounting/pricing/setup?error=apply-settings");

  const { error: runError } = await supabase.from("pricing_setup_runs").insert({
    owner_id: userData.user.id,
    jalali_year: setup.jalali_year,
    jalali_month: setup.jalali_month,
    production_payroll_cost: Math.round(productionPayroll),
    selling_payroll_cost: Math.round(sellingPayroll),
    allocated_expense_cost: Math.round(allocatedExpenses),
    allocated_selling_cost: Math.round(allocatedSellingExpenses),
    total_productive_minutes: totalProductiveMinutes,
    overhead_cost_per_minute: costPerMinute,
    selling_cost_per_unit: sellingCostPerUnit,
    product_count: profiles.length,
    details: {
      allocation_method: setup.allocation_method,
      total_planned_output: totalPlannedOutput,
      selling_pool: sellingPool,
      product_overheads: updates,
    },
  });
  if (runError) redirect("/accounting/pricing/setup?error=apply-run");

  revalidatePath("/accounting/pricing/setup");
  revalidatePath("/accounting/pricing");
  revalidatePath("/accounting/products");
  redirect("/accounting/pricing/setup?saved=applied");
}

function readinessCard(title: string, ready: boolean, text: string) {
  return { title, ready, text };
}

export default async function PricingSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const current = currentJalaliMonthRange();

  const [setupResult, settingsResult] = await Promise.all([
    supabase
      .from("pricing_setup_profiles")
      .select("jalali_year,jalali_month,working_days,daily_work_hours,allocation_method,monthly_sales_target,notes")
      .maybeSingle(),
    supabase
      .from("costing_settings")
      .select("default_min_margin,default_cash_margin,default_wholesale_margin,default_festival_margin,default_credit_monthly_rate,inflation_buffer_percent,stale_price_days,rounding_step,include_payroll_in_overhead")
      .maybeSingle(),
  ]);

  const setup: SetupProfile = (setupResult.data as SetupProfile | null) ?? {
    jalali_year: current.year,
    jalali_month: current.month,
    working_days: 26,
    daily_work_hours: 7,
    allocation_method: "standard_minutes",
    monthly_sales_target: 0,
    notes: null,
  };
  const range = monthRange(setup.jalali_year, setup.jalali_month);

  const [
    employeesResult,
    employeeProfilesResult,
    payrollResult,
    productsResult,
    productProfilesResult,
    componentsResult,
    materialsResult,
    expensesResult,
    expenseRulesResult,
    lastRunResult,
  ] = await Promise.all([
    supabase
      .from("employees")
      .select("id,name,role_title,monthly_base_salary")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("employee_costing_profiles")
      .select("employee_id,department,production_share_percent,productive_hours_per_month,notes"),
    supabase
      .from("payroll_entries")
      .select("employee_id,net_pay,employer_costs")
      .eq("jalali_year", setup.jalali_year)
      .eq("jalali_month", setup.jalali_month),
    supabase
      .from("costing_products")
      .select("id,name,category,unit,direct_labor_per_unit,packaging_per_unit,other_variable_per_unit,current_cash_price")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("product_costing_profiles")
      .select("product_id,planned_monthly_output,standard_minutes_per_unit,actual_scrap_percent,manual_overhead_per_unit,notes"),
    supabase
      .from("product_materials")
      .select("product_id,material_id")
      .limit(5000),
    supabase
      .from("material_cost_summary")
      .select("id,name,replacement_unit_cost,latest_purchase_date,replacement_price_at")
      .eq("is_active", true)
      .limit(5000),
    supabase
      .from("workshop_expenses")
      .select("category,amount,cost_scope,manufacturing_share_percent,classification_status")
      .gte("expense_date", range.from)
      .lt("expense_date", range.toExclusive),
    supabase
      .from("expense_costing_rules")
      .select("category,include_in_product_cost,manufacturing_share_percent,allocation_basis,notes"),
    supabase
      .from("pricing_setup_runs")
      .select("created_at,production_payroll_cost,selling_payroll_cost,allocated_expense_cost,allocated_selling_cost,total_productive_minutes,overhead_cost_per_minute,selling_cost_per_unit,product_count")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const databaseError =
    setupResult.error ||
    settingsResult.error ||
    employeesResult.error ||
    employeeProfilesResult.error ||
    payrollResult.error ||
    productsResult.error ||
    productProfilesResult.error ||
    componentsResult.error ||
    materialsResult.error ||
    expensesResult.error ||
    expenseRulesResult.error ||
    lastRunResult.error;

  const employees = (employeesResult.data ?? []) as Employee[];
  const employeeProfiles = (employeeProfilesResult.data ?? []) as EmployeeProfile[];
  const products = (productsResult.data ?? []) as Product[];
  const productProfiles = (productProfilesResult.data ?? []) as ProductProfile[];
  const expenseRules = (expenseRulesResult.data ?? []) as ExpenseRule[];
  const settings = settingsResult.data as CostingSettings | null;

  const employeeProfileMap = new Map(employeeProfiles.map((row) => [row.employee_id, row]));
  const productProfileMap = new Map(productProfiles.map((row) => [row.product_id, row]));
  const expenseRuleMap = new Map(expenseRules.map((row) => [row.category, row]));
  const payrollMap = new Map(
    (payrollResult.data ?? []).map((row) => [
      row.employee_id,
      Number(row.net_pay ?? 0) + Number(row.employer_costs ?? 0),
    ]),
  );

  const componentCounts = new Map<string, number>();
  const productMaterialIds = new Map<string, string[]>();
  for (const row of componentsResult.data ?? []) {
    componentCounts.set(row.product_id, (componentCounts.get(row.product_id) ?? 0) + 1);
    productMaterialIds.set(row.product_id, [
      ...(productMaterialIds.get(row.product_id) ?? []),
      row.material_id,
    ]);
  }

  const materialReadyMap = new Map<string, boolean>();
  for (const material of materialsResult.data ?? []) {
    const date = material.replacement_price_at || material.latest_purchase_date;
    const cost = Number(material.replacement_unit_cost ?? 0);
    materialReadyMap.set(material.id, Boolean(cost > 0 && date));
  }

  const expensesByCategory = new Map<string, number>();
  for (const row of expensesResult.data ?? []) {
    expensesByCategory.set(
      row.category,
      (expensesByCategory.get(row.category) ?? 0) + Number(row.amount ?? 0),
    );
  }

  let productionPayroll = 0;
  let sellingPayroll = 0;
  for (const employee of employees) {
    const profile = employeeProfileMap.get(employee.id);
    const total = Number(payrollMap.get(employee.id) ?? 0);
    const share = Number(profile?.production_share_percent ?? 0) / 100;
    if (["production", "printing", "packing"].includes(profile?.department ?? "")) {
      productionPayroll += total * share;
    } else if (profile?.department === "sales") {
      sellingPayroll += total;
    }
  }

  let allocatedExpenses = 0;
  let allocatedSellingExpenses = 0;
  let pendingExpenseCount = 0;
  for (const row of expensesResult.data ?? []) {
    const amount = Number(row.amount ?? 0);
    if (["confirmed", "auto"].includes(row.classification_status ?? "")) {
      if (row.cost_scope === "manufacturing") {
        allocatedExpenses += amount * (Number(row.manufacturing_share_percent ?? 0) / 100);
      } else if (row.cost_scope === "selling") {
        allocatedSellingExpenses += amount;
      }
    } else {
      pendingExpenseCount += 1;
      const rule = expenseRuleMap.get(row.category);
      if (rule?.include_in_product_cost) {
        allocatedExpenses += amount * (Number(rule.manufacturing_share_percent ?? 0) / 100);
      }
    }
  }

  const totalOutput = products.reduce(
    (sum, product) => sum + Number(productProfileMap.get(product.id)?.planned_monthly_output ?? 0),
    0,
  );
  const totalMinutes = products.reduce((sum, product) => {
    const profile = productProfileMap.get(product.id);
    return (
      sum +
      Number(profile?.planned_monthly_output ?? 0) *
        Number(profile?.standard_minutes_per_unit ?? 0) *
        (1 + Number(profile?.actual_scrap_percent ?? 0) / 100)
    );
  }, 0);
  const overheadPool = productionPayroll + allocatedExpenses;
  const sellingPool = sellingPayroll + allocatedSellingExpenses;
  const costPerMinute = totalMinutes > 0 ? overheadPool / totalMinutes : 0;
  const sellingCostPerUnit = totalOutput > 0 ? sellingPool / totalOutput : 0;
  const setupReady = Boolean(setupResult.data);
  const employeeReady =
    employees.length > 0 &&
    employees.every((employee) => {
      const profile = employeeProfileMap.get(employee.id);
      return Boolean(profile?.department) && Number(profile?.production_share_percent ?? -1) >= 0;
    }) &&
    payrollMap.size > 0;
  const productReady =
    products.length > 0 &&
    products.every((product) => {
      const profile = productProfileMap.get(product.id);
      return (
        Number(profile?.planned_monthly_output ?? 0) > 0 &&
        Number(profile?.standard_minutes_per_unit ?? 0) > 0 &&
        (componentCounts.get(product.id) ?? 0) > 0
      );
    });
  const materialReady =
    products.length > 0 &&
    products.every((product) =>
      (productMaterialIds.get(product.id) ?? []).every(
        (materialId) => materialReadyMap.get(materialId) === true,
      ),
    );
  const expenseReady =
    Object.keys(expenseCategoryLabels).every((category) => expenseRuleMap.has(category)) &&
    pendingExpenseCount === 0;
  const policyReady = Boolean(settingsResult.data);

  const readiness = [
    readinessCard("دوره و ظرفیت کارگاه", setupReady, "ماه مبنا، روز کاری و روش تقسیم هزینه‌ها"),
    readinessCard("مواد و قیمت روز", materialReady, "قیمت جایگزینی مواد فرمول محصولات معتبر باشد"),
    readinessCard("فرمول و تولید محصولات", productReady, "BOM، تیراژ ماهانه، زمان استاندارد و ضایعات"),
    readinessCard("حقوق و سهم تولید", employeeReady, "حقوق ماه مبنا و درصد زمان تولید هر نیرو"),
    readinessCard("هزینه‌های مرتب‌شده", expenseReady, pendingExpenseCount ? `${pendingExpenseCount.toLocaleString("fa-IR")} ردیف هنوز نیازمند بررسی است` : "تولید، فروش، دارایی و هزینه عمومی از هم جدا شده‌اند"),
    readinessCard("سیاست قیمت‌گذاری", policyReady, "حاشیه سود، محافظ تورم، اعتبار و گرد کردن"),
  ];
  const weights = [10, 20, 20, 15, 15, 20];
  const readinessScore = readiness.reduce(
    (sum, item, index) => sum + (item.ready ? weights[index] : 0),
    0,
  );
  const reliability =
    readinessScore >= 90
      ? "قابل اتکا"
      : readinessScore >= 70
        ? "نسبتاً قابل اتکا"
        : "تقریبی";
  const canApply = setupReady && productReady && expenseReady && totalOutput > 0;

  const errorMessage: Record<string, string> = {
    "general-invalid": "اطلاعات دوره و ظرفیت کارگاه معتبر نیست.",
    "general-save": "ذخیره اطلاعات عمومی انجام نشد.",
    "employees-invalid": "درصد سهم تولید نیروها باید بین صفر تا صد باشد.",
    "employees-save": "ذخیره اطلاعات نیروها انجام نشد.",
    "products-invalid": "اطلاعات تولید یا ضایعات محصولات معتبر نیست.",
    "products-save": "ذخیره اطلاعات تولید محصولات انجام نشد.",
    "expenses-invalid": "قواعد تقسیم هزینه معتبر نیست.",
    "expenses-save": "ذخیره قواعد هزینه انجام نشد.",
    "policy-invalid": "حاشیه‌ها یا تنظیمات قیمت‌گذاری معتبر نیست.",
    "policy-save": "ذخیره سیاست قیمت‌گذاری انجام نشد.",
    "apply-setup": "ابتدا دوره مبنا را ذخیره کن.",
    "apply-read": "خواندن داده‌های لازم برای محاسبه سربار انجام نشد.",
    "apply-products": "تیراژ ماهانه محصولات کامل نیست.",
    "apply-update": "ثبت سربار محاسبه‌شده روی یکی از محصولات انجام نشد.",
    "apply-settings": "به‌روزرسانی تنظیمات بهای تمام‌شده انجام نشد.",
    "apply-run": "محاسبه انجام شد، اما سابقه اجرای آن ذخیره نشد.",
  };

  const savedMessage: Record<string, string> = {
    general: "اطلاعات دوره و ظرفیت کارگاه ذخیره شد.",
    employees: "اطلاعات سهم تولید نیروها ذخیره شد.",
    products: "برنامه تولید و زمان استاندارد محصولات ذخیره شد.",
    expenses: "قواعد تقسیم هزینه‌ها ذخیره شد.",
    policy: "سیاست قیمت‌گذاری ذخیره شد.",
    applied: "سربار واقعی محاسبه و روی محصولات اعمال شد؛ اکنون صفحه قیمت‌گذاری را بررسی کن.",
  };

  return (
    <AppShell
      active="accounting"
      title="آماده‌سازی قیمت‌گذاری هوشمند"
      subtitle="اطلاعات پایه را یک‌بار کامل کن؛ بعد از هر فاکتور خرید جدید، بهای تمام‌شده و قیمت پیشنهادی با داده واقعی به‌روزرسانی می‌شود."
    >
      <AccountingNav active="pricing_setup" />
      <div className={styles.page}>
        {databaseError ? (
          <div className={styles.alert}>
            ابتدا فایل SQL شماره ۰۰۸ را در Supabase اجرا کن. جزئیات: {databaseError.message}
          </div>
        ) : null}
        {params.error && errorMessage[params.error] ? (
          <div className={styles.alert}>{errorMessage[params.error]}</div>
        ) : null}
        {params.saved && savedMessage[params.saved] ? (
          <div className={styles.success}>{savedMessage[params.saved]}</div>
        ) : null}

        <section className={styles.alert} style={{ background: "#f3fbf8", borderColor: "#c9e8dd", color: "#285f51" }}>
          <strong>روش ساده:</strong> لازم نیست هزینه‌های هلو را دستی در جدول پایین پیدا کنی. ابتدا به {" "}
          <Link href="/accounting/pricing/cost-review">مرتب‌سازی هوشمند هزینه‌ها</Link> برو، پیشنهادها را تأیید کن و بعد به همین صفحه برگرد.
        </section>

        <section className={styles.hero}>
          <div>
            <span className={styles.heroEyebrow}>مرحله صفر قبل از پیشنهاد قیمت با هوش مصنوعی</span>
            <h2>آمادگی محاسبه قیمت: {readinessScore.toLocaleString("fa-IR")}٪ — {reliability}</h2>
            <p>
              محاسبات عددی توسط فرمول قطعی انجام می‌شود؛ هوش مصنوعی بعداً نتیجه را تحلیل می‌کند، سناریو می‌سازد و قیمت فروش را توضیح می‌دهد. تا وقتی داده اصلی ناقص باشد، برنامه قیمت را «تقریبی» علامت می‌زند.
            </p>
          </div>
          <div
            className={styles.score}
            style={{ "--progress": `${readinessScore}%` } as React.CSSProperties}
          >
            <strong>{readinessScore.toLocaleString("fa-IR")}٪</strong>
            <span>{reliability}</span>
          </div>
        </section>

        <section className={styles.readinessGrid}>
          {readiness.map((item) => (
            <article className={styles.readinessCard} key={item.title}>
              <header>
                <h3>{item.title}</h3>
                <span className={item.ready ? styles.badgeReady : styles.badgePending}>
                  {item.ready ? "کامل" : "نیازمند تکمیل"}
                </span>
              </header>
              <p>{item.text}</p>
            </article>
          ))}
        </section>

        <section className={styles.summaryGrid}>
          <article className={styles.summaryCard}>
            <header><h3>حقوق منتسب به تولید</h3></header>
            <strong>{formatMoney(productionPayroll)}</strong>
            <p>حقوق و هزینه کارفرما × درصد زمانی که هر نیرو برای تولید صرف می‌کند.</p>
          </article>
          <article className={styles.summaryCard}>
            <header><h3>هزینه قابل سرشکن</h3></header>
            <strong>{formatMoney(allocatedExpenses)}</strong>
            <p>فقط سهم تولیدی هزینه‌هایی که خودت در قواعد پایین تأیید کرده‌ای.</p>
          </article>
          <article className={styles.summaryCard}>
            <header><h3>فروش، ارسال و توزیع</h3></header>
            <strong>{formatMoney(sellingPool)}</strong>
            <p>حقوق ارسال، پست، باربری، تبلیغات و هزینه‌های فروش؛ میانگین هر واحد {formatMoney(sellingCostPerUnit)}.</p>
          </article>
          <article className={styles.summaryCard}>
            <header><h3>دقایق تولید برنامه‌ریزی‌شده</h3></header>
            <strong>{formatDecimal(totalMinutes, 0)}</strong>
            <p>تیراژ × زمان استاندارد، با لحاظ درصد ضایعات واقعی.</p>
          </article>
          <article className={styles.summaryCard}>
            <header><h3>هزینه سربار هر دقیقه</h3></header>
            <strong>{formatMoney(costPerMinute)}</strong>
            <p>برای تقسیم عادلانه هزینه میان پد، کیف، ملحفه و پک‌ها.</p>
          </article>
          <article className={styles.summaryCard}>
            <header><h3>کل تیراژ برنامه‌ریزی‌شده</h3></header>
            <strong>{formatDecimal(totalOutput, 0)}</strong>
            <p>جمع واحدهای فروش همه محصولات در ماه مبنا.</p>
          </article>
          <article className={styles.summaryCard}>
            <header><h3>هدف فروش ماهانه</h3></header>
            <strong>{formatMoney(setup.monthly_sales_target)}</strong>
            <p>برای سنجش اینکه ظرفیت تولید و قیمت‌ها با هدف فروش هماهنگ هستند یا نه.</p>
          </article>
        </section>

        <details className={styles.section} open>
          <summary>۱. دوره مبنا و ظرفیت کارگاه</summary>
          <div className={styles.sectionBody}>
            <p className={styles.sectionIntro}>
              ماهی را انتخاب کن که حقوق، هزینه و تولید آن نسبتاً کامل است. بعداً می‌توانی ماه مبنا را تغییر بدهی و محاسبه را دوباره اجرا کنی.
            </p>
            <form action={saveGeneralSetup}>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label htmlFor="jalali_year">سال شمسی</label>
                  <input id="jalali_year" name="jalali_year" defaultValue={setup.jalali_year} inputMode="numeric" required />
                </div>
                <div className={styles.field}>
                  <label htmlFor="jalali_month">ماه شمسی</label>
                  <select id="jalali_month" name="jalali_month" defaultValue={setup.jalali_month}>
                    {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                      <option value={month} key={month}>ماه {month.toLocaleString("fa-IR")}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="working_days">روز کاری ماه</label>
                  <input id="working_days" name="working_days" defaultValue={setup.working_days} inputMode="numeric" required />
                </div>
                <div className={styles.field}>
                  <label htmlFor="daily_work_hours">ساعت کار روزانه</label>
                  <input id="daily_work_hours" name="daily_work_hours" defaultValue={Number(setup.daily_work_hours)} inputMode="decimal" required />
                </div>
                <div className={styles.field}>
                  <label htmlFor="allocation_method">روش تقسیم سربار</label>
                  <select id="allocation_method" name="allocation_method" defaultValue={setup.allocation_method}>
                    <option value="standard_minutes">بر اساس زمان استاندارد تولید — پیشنهادی</option>
                    <option value="units">بر اساس تعداد واحد تولید</option>
                    <option value="manual">سربار دستی هر محصول</option>
                  </select>
                </div>
                <div className={styles.field}>
                  <label htmlFor="monthly_sales_target">هدف فروش ماهانه، تومان</label>
                  <input id="monthly_sales_target" name="monthly_sales_target" defaultValue={Number(setup.monthly_sales_target)} inputMode="numeric" />
                </div>
                <div className={`${styles.field} ${styles.fieldWide}`}>
                  <label htmlFor="notes">توضیح دوره مبنا</label>
                  <textarea id="notes" name="notes" defaultValue={setup.notes ?? ""} placeholder="مثلاً این ماه تولید عادی بود و تعطیلی غیرمعمول نداشتیم." />
                </div>
              </div>
              <div className={styles.actions}>
                <button className={styles.primaryButton} type="submit">ذخیره دوره و ظرفیت</button>
              </div>
            </form>
          </div>
        </details>

        <details className={styles.section} open={!employeeReady}>
          <summary>۲. نیروها، حقوق و سهم واقعی تولید</summary>
          <div className={styles.sectionBody}>
            <p className={styles.sectionIntro}>
              برای هر نیرو مشخص کن چند درصد از هزینه او واقعاً مربوط به تولید است. فروش و مدیریت معمولاً سهم تولید صفر یا کم دارند؛ چاپ، بسته‌بندی و تولید سهم بالاتری دارند.
            </p>
            {!employees.length ? (
              <div className={styles.warning}>
                هنوز نیروی فعالی ثبت نشده است. ابتدا در بخش حقوق، نیروها را اضافه کن.
              </div>
            ) : (
              <form action={saveEmployeeProfiles}>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>نیرو</th>
                        <th>هزینه حقوق ماه مبنا</th>
                        <th>بخش اصلی</th>
                        <th>درصد منتسب به تولید</th>
                        <th>ساعت مفید ماهانه</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((employee) => {
                        const profile = employeeProfileMap.get(employee.id);
                        const department = profile?.department ?? suggestDepartment(employee.role_title);
                        const defaultShare = profile
                          ? Number(profile.production_share_percent)
                          : ["sales", "admin"].includes(department)
                            ? 0
                            : 100;
                        return (
                          <tr key={employee.id}>
                            <td>
                              <input type="hidden" name="employee_id" value={employee.id} />
                              <strong>{employee.name}</strong>
                              <small>{employee.role_title || "بدون عنوان شغلی"}</small>
                            </td>
                            <td>{formatMoney(payrollMap.get(employee.id) ?? employee.monthly_base_salary)}</td>
                            <td>
                              <select name={`department_${employee.id}`} defaultValue={department}>
                                {Object.entries(departments).map(([value, label]) => (
                                  <option value={value} key={value}>{label}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <input
                                name={`production_share_${employee.id}`}
                                defaultValue={defaultShare}
                                inputMode="decimal"
                                aria-label={`درصد سهم تولید ${employee.name}`}
                              />
                            </td>
                            <td>
                              <input
                                name={`productive_hours_${employee.id}`}
                                defaultValue={profile?.productive_hours_per_month == null ? "" : Number(profile.productive_hours_per_month)}
                                inputMode="decimal"
                                placeholder="اختیاری"
                                aria-label={`ساعت مفید ${employee.name}`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className={styles.actions}>
                  <button className={styles.primaryButton} type="submit">ذخیره سهم نیروها</button>
                  <Link className={styles.linkButton} href="/accounting/payroll">رفتن به ثبت حقوق</Link>
                </div>
              </form>
            )}
          </div>
        </details>

        <details className={styles.section} open={!expenseReady}>
          <summary>۳. تعیین سهم هزینه‌های کارگاه در قیمت محصول</summary>
          <div className={styles.sectionBody}>
            <p className={styles.sectionIntro}>
              این جدول فقط تنظیم پشتیبان است. تصمیم دقیق هر شرح هزینه در صفحه «مرتب‌سازی هوشمند هزینه‌ها» ذخیره می‌شود. هزینه فروش و ارسال جدا از سربار تولید نگهداری می‌شود ولی در قیمت نهایی لحاظ خواهد شد.
            </p>
            <form action={saveExpenseRules}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>گروه هزینه</th>
                      <th>مبلغ ماه مبنا</th>
                      <th>داخل بهای محصول</th>
                      <th>سهم تولیدی</th>
                      <th>روش تقسیم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(expenseCategoryLabels).map(([category, label]) => {
                      const rule = expenseRuleMap.get(category);
                      const defaultShare = Number(rule?.manufacturing_share_percent ?? expenseDefaults[category] ?? 50);
                      const include = rule?.include_in_product_cost ?? defaultShare > 0;
                      return (
                        <tr key={category}>
                          <td>
                            <input type="hidden" name="expense_category" value={category} />
                            <strong>{label}</strong>
                          </td>
                          <td>{formatMoney(expensesByCategory.get(category) ?? 0)}</td>
                          <td>
                            <label className={styles.checkbox}>
                              <input type="checkbox" name={`include_${category}`} defaultChecked={include} />
                              لحاظ شود
                            </label>
                          </td>
                          <td>
                            <input
                              name={`manufacturing_share_${category}`}
                              defaultValue={defaultShare}
                              inputMode="decimal"
                              aria-label={`درصد سهم تولیدی ${label}`}
                            />
                          </td>
                          <td>
                            <select name={`allocation_basis_${category}`} defaultValue={rule?.allocation_basis ?? "standard_minutes"}>
                              <option value="standard_minutes">زمان استاندارد</option>
                              <option value="units">تعداد واحد</option>
                              <option value="manual">دستی</option>
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className={styles.actions}>
                <button className={styles.primaryButton} type="submit">ذخیره قواعد هزینه</button>
                <Link className={styles.linkButton} href="/accounting/expenses">بررسی هزینه‌های ثبت‌شده</Link>
              </div>
            </form>
          </div>
        </details>

        <details className={styles.section} open={!productReady}>
          <summary>۴. برنامه تولید، زمان استاندارد و ضایعات هر محصول</summary>
          <div className={styles.sectionBody}>
            <p className={styles.sectionIntro}>
              تیراژ ماهانه و زمان تولید هر واحد باعث می‌شود سربار به محصولی که زمان بیشتری می‌گیرد، سهم بیشتری بدهد. زمان را از یک تولید عادی اندازه بگیر، نه سریع‌ترین رکورد.
            </p>
            {!products.length ? (
              <div className={styles.warning}>
                هنوز محصولی در بخش فرمول محصولات ثبت نشده است.
              </div>
            ) : (
              <form action={saveProductProfiles}>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>محصول</th>
                        <th>وضعیت BOM</th>
                        <th>تولید ماهانه</th>
                        <th>دقیقه برای هر واحد</th>
                        <th>ضایعات واقعی</th>
                        <th>سربار دستی</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((product) => {
                        const profile = productProfileMap.get(product.id);
                        const materialIds = productMaterialIds.get(product.id) ?? [];
                        const missingPrices = materialIds.filter(
                          (materialId) => !materialReadyMap.get(materialId),
                        );
                        return (
                          <tr key={product.id}>
                            <td>
                              <input type="hidden" name="product_id" value={product.id} />
                              <strong>{product.name}</strong>
                              <small>{productCategoryLabels[product.category] ?? product.category} · واحد {product.unit}</small>
                            </td>
                            <td>
                              {(componentCounts.get(product.id) ?? 0).toLocaleString("fa-IR")} ماده
                              <small>{missingPrices.length ? `${missingPrices.length.toLocaleString("fa-IR")} قیمت ناقص یا قدیمی` : "قیمت مواد آماده"}</small>
                            </td>
                            <td>
                              <input
                                name={`planned_output_${product.id}`}
                                defaultValue={Number(profile?.planned_monthly_output ?? 0) || ""}
                                inputMode="decimal"
                                placeholder="مثلاً ۲۰۰۰۰"
                                aria-label={`تولید ماهانه ${product.name}`}
                              />
                            </td>
                            <td>
                              <input
                                name={`standard_minutes_${product.id}`}
                                defaultValue={Number(profile?.standard_minutes_per_unit ?? 0) || ""}
                                inputMode="decimal"
                                placeholder="مثلاً ۰.۷۵"
                                aria-label={`زمان استاندارد ${product.name}`}
                              />
                            </td>
                            <td>
                              <input
                                name={`actual_scrap_${product.id}`}
                                defaultValue={Number(profile?.actual_scrap_percent ?? 0)}
                                inputMode="decimal"
                                aria-label={`ضایعات ${product.name}`}
                              />
                            </td>
                            <td>
                              <input
                                name={`manual_overhead_${product.id}`}
                                defaultValue={profile?.manual_overhead_per_unit == null ? "" : Number(profile.manual_overhead_per_unit)}
                                inputMode="numeric"
                                placeholder="فقط حالت دستی"
                                aria-label={`سربار دستی ${product.name}`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className={styles.actions}>
                  <button className={styles.primaryButton} type="submit">ذخیره برنامه تولید</button>
                  <Link className={styles.linkButton} href="/accounting/products">اصلاح فرمول محصولات</Link>
                  <Link className={styles.linkButton} href="/accounting/materials">به‌روزرسانی قیمت مواد</Link>
                </div>
              </form>
            )}
          </div>
        </details>

        <details className={styles.section} open={!policyReady}>
          <summary>۵. سیاست سود، تورم و شرایط فروش</summary>
          <div className={styles.sectionBody}>
            <p className={styles.sectionIntro}>
              درصدها حاشیه سود از «قیمت فروش» هستند، نه درصد اضافه روی هزینه. محافظ تورم برای حفظ توان خرید مجدد مواد استفاده می‌شود.
            </p>
            <form action={savePricingPolicy}>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label htmlFor="default_min_margin">حداقل حاشیه امن، درصد</label>
                  <input id="default_min_margin" name="default_min_margin" defaultValue={Number(settings?.default_min_margin ?? 10)} inputMode="decimal" />
                </div>
                <div className={styles.field}>
                  <label htmlFor="default_cash_margin">حاشیه نقدی هدف، درصد</label>
                  <input id="default_cash_margin" name="default_cash_margin" defaultValue={Number(settings?.default_cash_margin ?? 30)} inputMode="decimal" />
                </div>
                <div className={styles.field}>
                  <label htmlFor="default_wholesale_margin">حاشیه عمده، درصد</label>
                  <input id="default_wholesale_margin" name="default_wholesale_margin" defaultValue={Number(settings?.default_wholesale_margin ?? 20)} inputMode="decimal" />
                </div>
                <div className={styles.field}>
                  <label htmlFor="default_festival_margin">کف حاشیه جشنواره، درصد</label>
                  <input id="default_festival_margin" name="default_festival_margin" defaultValue={Number(settings?.default_festival_margin ?? 15)} inputMode="decimal" />
                </div>
                <div className={styles.field}>
                  <label htmlFor="default_credit_monthly_rate">هزینه اعتبار ماهانه، درصد</label>
                  <input id="default_credit_monthly_rate" name="default_credit_monthly_rate" defaultValue={Number(settings?.default_credit_monthly_rate ?? 3)} inputMode="decimal" />
                </div>
                <div className={styles.field}>
                  <label htmlFor="inflation_buffer_percent">محافظ تورمی، درصد</label>
                  <input id="inflation_buffer_percent" name="inflation_buffer_percent" defaultValue={Number(settings?.inflation_buffer_percent ?? 10)} inputMode="decimal" />
                </div>
                <div className={styles.field}>
                  <label htmlFor="stale_price_days">حداکثر عمر قیمت ماده، روز</label>
                  <input id="stale_price_days" name="stale_price_days" defaultValue={Number(settings?.stale_price_days ?? 30)} inputMode="numeric" />
                </div>
                <div className={styles.field}>
                  <label htmlFor="rounding_step">گرد کردن قیمت به مضرب</label>
                  <input id="rounding_step" name="rounding_step" defaultValue={Number(settings?.rounding_step ?? 1000)} inputMode="numeric" />
                </div>
              </div>
              <div className={styles.actions}>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    name="include_payroll_in_overhead"
                    defaultChecked={settings?.include_payroll_in_overhead ?? true}
                  />
                  حقوق منتسب به تولید در سربار لحاظ شود
                </label>
              </div>
              <div className={styles.actions}>
                <button className={styles.primaryButton} type="submit">ذخیره سیاست قیمت‌گذاری</button>
              </div>
            </form>
          </div>
        </details>

        <section className={styles.finalCard}>
          <h3>اعمال سربار واقعی و آماده‌کردن موتور قیمت‌گذاری</h3>
          <p>
            استخر هزینه فعلی {formatMoney(overheadPool)} تومان است. با روش انتخاب‌شده، سهم سربار هر محصول محاسبه و در موتور بهای تمام‌شده ثبت می‌شود. این کار قیمت فروش را خودکار تغییر نمی‌دهد؛ فقط هزینه درست را برای پیشنهاد قیمت آماده می‌کند.
          </p>
          {!canApply ? (
            <ul className={styles.missingList}>
              {!setupReady ? <li>دوره مبنا ذخیره نشده است.</li> : null}
              {!productReady ? <li>تیراژ، زمان استاندارد یا BOM بعضی محصولات ناقص است.</li> : null}
              {!expenseReady ? <li>قواعد همه گروه‌های هزینه هنوز تأیید نشده است.</li> : null}
              {!materialReady ? <li>قیمت جایگزینی بعضی مواد ناقص یا قدیمی است؛ قیمت نهایی همچنان تقریبی خواهد بود.</li> : null}
              {!employeeReady ? <li>حقوق ماه مبنا یا سهم تولید بعضی نیروها ناقص است.</li> : null}
            </ul>
          ) : null}
          <div className={styles.actions}>
            <form action={applyCalculatedOverhead}>
              <button className={styles.primaryButton} type="submit" disabled={!canApply}>
                محاسبه و اعمال سربار روی محصولات
              </button>
            </form>
            <Link className={styles.secondaryButton} href="/accounting/pricing">
              مشاهده قیمت‌های محاسبه‌شده
            </Link>
          </div>
          {lastRunResult.data ? (
            <p>
              آخرین اجرا: هزینه حقوق تولید {formatMoney(lastRunResult.data.production_payroll_cost)}، هزینه کارگاه {formatMoney(lastRunResult.data.allocated_expense_cost)} و نرخ سربار هر دقیقه {formatMoney(lastRunResult.data.overhead_cost_per_minute)} تومان.
            </p>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}
