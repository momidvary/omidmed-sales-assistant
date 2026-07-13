import {
  buildFollowupCandidates,
  type CustomerForFollowup,
  type FollowupForScoring,
} from "@/lib/sales/followup-priority";
import type { createClient } from "@/lib/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type InvoiceRow = {
  customer_id: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: number | string | null;
  discount_amount: number | string | null;
  account_balance_amount: number | string | null;
  account_balance_status: string | null;
};

type ProductRow = {
  customer_id: string;
  product_name: string;
  invoice_count: number | string | null;
  total_quantity: number | string | null;
  total_amount: number | string | null;
  last_purchase_at: string | null;
};

const number = new Intl.NumberFormat("fa-IR");
const persianMonth = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  year: "numeric",
  month: "2-digit",
  timeZone: "Asia/Tehran",
});
const persianDate = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Tehran",
});

const stopWords = new Set([
  "برای",
  "این",
  "اون",
  "آن",
  "های",
  "هایی",
  "یک",
  "چند",
  "کدام",
  "چه",
  "چطور",
  "چگونه",
  "بگو",
  "بده",
  "کن",
  "کنم",
  "کنیم",
  "مشتری",
  "مشتریان",
  "فروش",
  "خرید",
  "امروز",
  "فردا",
  "ماه",
  "قبل",
  "بعد",
  "گزارش",
  "پیگیری",
  "تماس",
  "متن",
  "پیام",
  "واتساپ",
  "پیامک",
  "را",
  "رو",
  "از",
  "به",
  "در",
  "با",
  "و",
  "یا",
  "که",
  "است",
  "هست",
  "شده",
  "نشده",
]);

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeText(value: string) {
  return value
    .toLocaleLowerCase("fa")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(value: string) {
  return Array.from(
    new Set(
      normalizeText(value)
        .split(" ")
        .filter((token) => token.length >= 2 && !stopWords.has(token)),
    ),
  ).slice(0, 10);
}

function monthKey(value: string) {
  const parts = persianMonth.formatToParts(new Date(`${value}T12:00:00+03:30`));
  const year = parts.find((part) => part.type === "year")?.value ?? "";
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  return `${year}/${month}`;
}

function formatDate(value: string | null) {
  if (!value) return null;
  return persianDate.format(new Date(`${value}T12:00:00+03:30`));
}

function nameMatchScore(name: string, tokens: string[], rawQuery: string) {
  const normalizedName = normalizeText(name);
  const normalizedQuery = normalizeText(rawQuery);
  if (normalizedName && normalizedQuery.includes(normalizedName)) return 100;

  let score = 0;
  for (const token of tokens) {
    if (normalizedName.includes(token)) score += token.length >= 4 ? 12 : 6;
  }
  return score;
}

function productMatchScore(productName: string, tokens: string[]) {
  const normalizedProduct = normalizeText(productName);
  let score = 0;
  for (const token of tokens) {
    if (normalizedProduct.includes(token)) score += token.length >= 4 ? 10 : 5;
  }
  return score;
}

function latestByCustomer(followups: FollowupForScoring[]) {
  const result = new Map<string, FollowupForScoring>();
  for (const row of followups) {
    if (!result.has(row.customer_id)) result.set(row.customer_id, row);
  }
  return result;
}

export async function buildAssistantContext({
  supabase,
  message,
}: {
  supabase: SupabaseClient;
  message: string;
}) {
  const [customerResult, followupResult, invoiceResult, productResult] =
    await Promise.all([
      supabase
        .from("customer_sales_summary")
        .select(
          "id,name,status,priority,next_followup_at,last_purchase_at,purchase_count,total_sales,avg_purchase_gap_days,days_since_last_purchase",
        )
        .order("total_sales", { ascending: false })
        .limit(1500),
      supabase
        .from("followups")
        .select("customer_id,followup_at,outcome,next_followup_at,notes")
        .order("followup_at", { ascending: false })
        .limit(5000),
      supabase
        .from("invoices")
        .select(
          "customer_id,invoice_number,invoice_date,total_amount,discount_amount,account_balance_amount,account_balance_status",
        )
        .order("invoice_date", { ascending: false })
        .limit(5000),
      supabase
        .from("customer_product_summary")
        .select(
          "customer_id,product_name,invoice_count,total_quantity,total_amount,last_purchase_at",
        )
        .order("total_amount", { ascending: false })
        .limit(5000),
    ]);

  const errors = [
    customerResult.error,
    followupResult.error,
    invoiceResult.error,
    productResult.error,
  ].filter(Boolean);

  if (errors.length) {
    throw new Error(errors.map((error) => error?.message).join(" | "));
  }

  const customers = (customerResult.data ?? []) as CustomerForFollowup[];
  const followups = (followupResult.data ?? []) as FollowupForScoring[];
  const invoices = (invoiceResult.data ?? []) as InvoiceRow[];
  const products = (productResult.data ?? []) as ProductRow[];
  const tokens = meaningfulTokens(message);
  const candidates = buildFollowupCandidates({ customers, followups });
  const latestFollowups = latestByCustomer(followups);
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));

  const matchedCustomers = customers
    .map((customer) => ({
      customer,
      score: nameMatchScore(customer.name, tokens, message),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((item) => item.customer);

  const relevantProducts = products
    .map((product) => ({
      product,
      score: productMatchScore(product.product_name, tokens),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return numeric(b.product.total_amount) - numeric(a.product.total_amount);
    })
    .slice(0, 120)
    .map((item) => item.product);

  const focusCustomerIds = new Set([
    ...matchedCustomers.map((customer) => customer.id),
    ...relevantProducts.slice(0, 50).map((product) => product.customer_id),
    ...candidates.slice(0, 40).map((customer) => customer.id),
  ]);

  const selectedCustomerIds = Array.from(focusCustomerIds).slice(0, 80);
  const selectedCustomers = selectedCustomerIds
    .map((id) => customerById.get(id))
    .filter((customer): customer is CustomerForFollowup => Boolean(customer));

  const monthlySales = new Map<string, { amount: number; count: number }>();
  for (const invoice of invoices) {
    const key = monthKey(invoice.invoice_date);
    const current = monthlySales.get(key) ?? { amount: 0, count: 0 };
    current.amount += numeric(invoice.total_amount);
    current.count += 1;
    monthlySales.set(key, current);
  }

  const monthlySummary = Array.from(monthlySales.entries())
    .map(([month, value]) => ({ month, ...value }))
    .slice(0, 18);

  const topProducts = new Map<
    string,
    { amount: number; quantity: number; customers: Set<string>; last: string | null }
  >();
  for (const product of products) {
    const current = topProducts.get(product.product_name) ?? {
      amount: 0,
      quantity: 0,
      customers: new Set<string>(),
      last: null,
    };
    current.amount += numeric(product.total_amount);
    current.quantity += numeric(product.total_quantity);
    current.customers.add(product.customer_id);
    if (!current.last || (product.last_purchase_at ?? "") > current.last) {
      current.last = product.last_purchase_at;
    }
    topProducts.set(product.product_name, current);
  }

  const selectedCustomerContext = selectedCustomers.map((customer) => {
    const latest = latestFollowups.get(customer.id) ?? null;
    const recentInvoices = invoices
      .filter((invoice) => invoice.customer_id === customer.id)
      .slice(0, 8)
      .map((invoice) => ({
        invoice_number: invoice.invoice_number,
        date_jalali: formatDate(invoice.invoice_date),
        amount: numeric(invoice.total_amount),
        discount: numeric(invoice.discount_amount),
        balance: numeric(invoice.account_balance_amount),
        balance_status: invoice.account_balance_status,
      }));
    const customerProducts = products
      .filter((product) => product.customer_id === customer.id)
      .sort((a, b) => numeric(b.total_amount) - numeric(a.total_amount))
      .slice(0, 12)
      .map((product) => ({
        name: product.product_name,
        invoice_count: numeric(product.invoice_count),
        total_quantity: numeric(product.total_quantity),
        total_amount: numeric(product.total_amount),
        last_purchase_jalali: formatDate(product.last_purchase_at),
      }));

    return {
      id: customer.id,
      name: customer.name,
      profile_url: `/customers/${customer.id}`,
      status: customer.status,
      priority: customer.priority,
      last_purchase_jalali: formatDate(customer.last_purchase_at),
      days_since_last_purchase: numeric(customer.days_since_last_purchase),
      average_purchase_gap_days: numeric(customer.avg_purchase_gap_days),
      purchase_count: numeric(customer.purchase_count),
      total_sales: numeric(customer.total_sales),
      next_followup_at: customer.next_followup_at,
      latest_followup: latest
        ? {
            outcome: latest.outcome,
            followup_at: latest.followup_at,
            next_followup_at: latest.next_followup_at,
            notes: latest.notes,
          }
        : null,
      recent_invoices: recentInvoices,
      products: customerProducts,
    };
  });

  return {
    generated_at_tehran: new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Asia/Tehran",
    }).format(new Date()),
    dataset_summary: {
      customers: customers.length,
      invoices: invoices.length,
      followups: followups.length,
      product_customer_rows: products.length,
      total_invoice_sales: invoices.reduce(
        (sum, invoice) => sum + numeric(invoice.total_amount),
        0,
      ),
    },
    daily_followup_candidates: candidates.slice(0, 60).map((customer) => ({
      id: customer.id,
      name: customer.name,
      profile_url: `/customers/${customer.id}`,
      score: customer.score,
      reasons: customer.reasons,
      priority: customer.priority,
      last_purchase_jalali: formatDate(customer.last_purchase_at),
      days_since_last_purchase: numeric(customer.days_since_last_purchase),
      average_purchase_gap_days: numeric(customer.avg_purchase_gap_days),
      total_sales: numeric(customer.total_sales),
      latest_outcome: customer.latestFollowup?.outcome ?? null,
      next_followup_at: customer.next_followup_at,
    })),
    monthly_sales: monthlySummary,
    top_products: Array.from(topProducts.entries())
      .map(([name, value]) => ({
        name,
        total_amount: Math.round(value.amount),
        total_quantity: Math.round(value.quantity * 1000) / 1000,
        customer_count: value.customers.size,
        last_purchase_jalali: formatDate(value.last),
      }))
      .sort((a, b) => b.total_amount - a.total_amount)
      .slice(0, 35),
    matched_product_customers: relevantProducts.slice(0, 80).map((product) => ({
      customer_id: product.customer_id,
      customer_name: customerById.get(product.customer_id)?.name ?? "نامشخص",
      profile_url: `/customers/${product.customer_id}`,
      product_name: product.product_name,
      invoice_count: numeric(product.invoice_count),
      total_quantity: numeric(product.total_quantity),
      total_amount: numeric(product.total_amount),
      last_purchase_jalali: formatDate(product.last_purchase_at),
    })),
    focused_customers: selectedCustomerContext,
    formatting_note: `اعداد پولی بدون تعیین واحد هستند. نمونه نمایش عدد: ${number.format(12500000)}.`,
  };
}
