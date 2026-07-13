import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchAllCustomers,
  fetchAllFollowups,
  fetchAllInvoices,
  fetchAllSales,
  fetchInvoiceItems,
} from "@/lib/reports/data";
import {
  getReportRange,
  safeReportPeriod,
  type ReportPeriodKey,
} from "@/lib/reports/period";
import {
  createCsv,
  createExcelXml,
  downloadResponse,
  type TableColumn,
  type TableCell,
} from "@/lib/export/tabular";

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeZone: "Asia/Tehran",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00+03:30`));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
}

const priorityLabels: Record<string, string> = {
  low: "کم",
  normal: "متوسط",
  high: "زیاد",
  vip: "ویژه",
};

const outcomeLabels: Record<string, string> = {
  no_answer: "پاسخ نداد",
  requested_price: "قیمت خواست",
  no_need: "فعلاً نیاز ندارد",
  order_placed: "سفارش داد",
  follow_up_later: "پیگیری بعدی",
  payment_pending: "تسویه باقی‌مانده",
  lost: "از دست رفته",
  other: "سایر",
};

const channelLabels: Record<string, string> = {
  phone: "تماس تلفنی",
  sms: "پیامک",
  whatsapp: "واتساپ",
  in_person: "حضوری",
  other: "سایر",
};

function validPhone(value: string | null) {
  if (!value) return false;
  return value.replace(/\D/g, "").length >= 10;
}

function filenamePeriod(period: ReportPeriodKey) {
  return period === "all" ? "all" : period;
}

function makeFile<Row extends Record<string, TableCell>>({
  format,
  name,
  sheet,
  columns,
  rows,
}: {
  format: "csv" | "xls";
  name: string;
  sheet: string;
  columns: TableColumn<Row>[];
  rows: Row[];
}) {
  if (format === "xls") {
    return downloadResponse({
      body: createExcelXml(sheet, columns, rows),
      filename: `${name}.xls`,
      contentType: "application/vnd.ms-excel",
    });
  }
  return downloadResponse({
    body: createCsv(columns, rows),
    filename: `${name}.csv`,
    contentType: "text/csv",
  });
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const type = search.get("type") ?? "customers";
  const format = search.get("format") === "xls" ? "xls" : "csv";
  const period = safeReportPeriod(search.get("period"));
  const range = getReportRange(period);
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const customers = await fetchAllCustomers(supabase);
    const customerMap = new Map(customers.map((item) => [item.id, item]));

    if (type === "customers" || type === "sms") {
      const priority = (search.get("priority") ?? "").trim();
      const inactiveDays = Math.max(
        0,
        Number(search.get("inactive_days") ?? (type === "sms" ? 45 : 0)) || 0,
      );
      const product = (search.get("product") ?? "").trim();
      let allowedIds: Set<string> | null = null;

      if (product) {
        const { data, error } = await supabase
          .from("customer_product_summary")
          .select("customer_id")
          .ilike("product_name", `%${product.replace(/[%_]/g, "")}%`)
          .limit(10000);
        if (error) throw error;
        allowedIds = new Set(
          (data ?? []).map(
            (item: { customer_id: string }) => item.customer_id,
          ),
        );
      }

      const filtered = customers.filter((customer) => {
        if (type === "sms" && !validPhone(customer.phone)) return false;
        if (priority === "urgent" && !["vip", "high"].includes(customer.priority)) {
          return false;
        }
        if (priority && priority !== "urgent" && customer.priority !== priority) {
          return false;
        }
        if (
          inactiveDays &&
          (customer.days_since_last_purchase == null ||
            customer.days_since_last_purchase < inactiveDays)
        ) {
          return false;
        }
        if (allowedIds && !allowedIds.has(customer.id)) return false;
        return true;
      });

      const rows = filtered.map((customer) => ({
        name: customer.name,
        phone: customer.phone ?? "",
        city: customer.city ?? "",
        priority: priorityLabels[customer.priority] ?? customer.priority,
        last_purchase: formatDate(customer.last_purchase_at),
        inactive_days: customer.days_since_last_purchase ?? "",
        purchase_count: customer.purchase_count ?? 0,
        total_sales: numeric(customer.total_sales),
        next_followup: formatDateTime(customer.next_followup_at),
        address: customer.address ?? "",
      }));

      const columns: TableColumn<(typeof rows)[number]>[] = [
        { key: "name", label: "نام مشتری" },
        { key: "phone", label: "موبایل" },
        { key: "city", label: "شهر" },
        { key: "priority", label: "اولویت" },
        { key: "last_purchase", label: "آخرین خرید" },
        { key: "inactive_days", label: "روز از آخرین خرید" },
        { key: "purchase_count", label: "تعداد خرید" },
        { key: "total_sales", label: "جمع فروش" },
        { key: "next_followup", label: "پیگیری بعدی" },
        { key: "address", label: "آدرس" },
      ];

      return makeFile({
        format,
        name: `${type === "sms" ? "sms-customers" : "customers"}-${filenamePeriod(period)}`,
        sheet: type === "sms" ? "لیست پیامک" : "مشتریان",
        columns,
        rows,
      });
    }

    if (type === "sales") {
      const sales = await fetchAllSales(supabase, range);
      const rows = sales.map((sale) => ({
        date: formatDate(sale.sale_date),
        customer: customerMap.get(sale.customer_id)?.name ?? "مشتری نامشخص",
        invoice: sale.invoice_number ?? "",
        document: sale.document_number ?? "",
        amount: numeric(sale.amount),
        description: sale.description ?? "",
      }));
      const columns: TableColumn<(typeof rows)[number]>[] = [
        { key: "date", label: "تاریخ" },
        { key: "customer", label: "مشتری" },
        { key: "invoice", label: "شماره فاکتور" },
        { key: "document", label: "شماره سند" },
        { key: "amount", label: "مبلغ" },
        { key: "description", label: "توضیحات" },
      ];
      return makeFile({
        format,
        name: `sales-${filenamePeriod(period)}`,
        sheet: "فروش",
        columns,
        rows,
      });
    }

    if (type === "followups") {
      const followups = await fetchAllFollowups(supabase, range);
      const rows = followups.map((followup) => ({
        date: formatDateTime(followup.followup_at),
        customer:
          customerMap.get(followup.customer_id)?.name ?? "مشتری نامشخص",
        channel: channelLabels[followup.channel] ?? followup.channel,
        outcome: outcomeLabels[followup.outcome] ?? followup.outcome,
        notes: followup.notes ?? "",
        next_followup: formatDateTime(followup.next_followup_at),
        potential_value: numeric(followup.potential_value),
      }));
      const columns: TableColumn<(typeof rows)[number]>[] = [
        { key: "date", label: "زمان پیگیری" },
        { key: "customer", label: "مشتری" },
        { key: "channel", label: "روش ارتباط" },
        { key: "outcome", label: "نتیجه" },
        { key: "notes", label: "یادداشت" },
        { key: "next_followup", label: "پیگیری بعدی" },
        { key: "potential_value", label: "ارزش احتمالی" },
      ];
      return makeFile({
        format,
        name: `followups-${filenamePeriod(period)}`,
        sheet: "پیگیری‌ها",
        columns,
        rows,
      });
    }

    if (type === "products") {
      const invoices = await fetchAllInvoices(supabase, range);
      const invoiceMap = new Map(invoices.map((item) => [item.id, item]));
      const items = await fetchInvoiceItems(
        supabase,
        invoices.map((item) => item.id),
      );
      const rows = items.map((item) => {
        const invoice = invoiceMap.get(item.invoice_id);
        return {
          date: formatDate(invoice?.invoice_date),
          customer: invoice
            ? customerMap.get(invoice.customer_id)?.name ?? "مشتری نامشخص"
            : "مشتری نامشخص",
          invoice: invoice?.invoice_number ?? "",
          product: item.product_name,
          quantity: numeric(item.quantity),
          unit_price: numeric(item.unit_price),
          line_total: numeric(item.line_total),
        };
      });
      const columns: TableColumn<(typeof rows)[number]>[] = [
        { key: "date", label: "تاریخ" },
        { key: "customer", label: "مشتری" },
        { key: "invoice", label: "شماره فاکتور" },
        { key: "product", label: "کالا" },
        { key: "quantity", label: "تعداد" },
        { key: "unit_price", label: "قیمت واحد" },
        { key: "line_total", label: "جمع ردیف" },
      ];
      return makeFile({
        format,
        name: `products-${filenamePeriod(period)}`,
        sheet: "اقلام فروش",
        columns,
        rows,
      });
    }

    return Response.json({ error: "Invalid export type" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
