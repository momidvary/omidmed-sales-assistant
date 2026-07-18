import Link from "next/link";
import type { ReactNode } from "react";

import { createClient } from "@/lib/supabase/server";

type InvoiceRow = {
  id: string;
  invoice_number: string | null;
  document_number: string | null;
  invoice_date: string | null;
  total_amount: number | string | null;
};

type InvoiceItemRow = {
  invoice_id: string;
  product_name: string;
  quantity: number | string | null;
};

const numberFormatter = new Intl.NumberFormat("fa-IR");

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number | string | null | undefined) {
  return numberFormatter.format(Math.round(numeric(value)));
}

function formatQuantity(value: number | string | null | undefined) {
  const parsed = numeric(value);
  return numberFormatter.format(
    Number.isInteger(parsed) ? parsed : Number(parsed.toFixed(2)),
  );
}

function formatDate(value: string | null) {
  if (!value) return "تاریخ نامشخص";

  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeZone: "Asia/Tehran",
  }).format(date);
}

export default async function CustomerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: invoiceData } = await supabase
    .from("invoices")
    .select("id,invoice_number,document_number,invoice_date,total_amount")
    .eq("customer_id", id)
    .order("invoice_date", { ascending: false })
    .limit(5);

  const invoices = (invoiceData ?? []) as InvoiceRow[];
  const invoiceIds = invoices.map((invoice) => invoice.id);

  const { data: itemData } = invoiceIds.length
    ? await supabase
        .from("invoice_items")
        .select("invoice_id,product_name,quantity")
        .in("invoice_id", invoiceIds)
        .order("row_number", { ascending: true })
    : { data: [] as InvoiceItemRow[] };

  const itemsByInvoice = new Map<string, InvoiceItemRow[]>();
  for (const item of (itemData ?? []) as InvoiceItemRow[]) {
    const current = itemsByInvoice.get(item.invoice_id) ?? [];
    current.push(item);
    itemsByInvoice.set(item.invoice_id, current);
  }

  return (
    <>
      {children}

      <aside
        aria-label="دسترسی سریع به سابقه فاکتورهای مشتری"
        style={{
          position: "fixed",
          left: 22,
          bottom: 22,
          zIndex: 80,
          width: "min(390px, calc(100vw - 32px))",
          direction: "rtl",
          fontFamily: "inherit",
        }}
      >
        <details
          style={{
            overflow: "hidden",
            border: "1px solid #dbe7ec",
            borderRadius: 18,
            background: "rgba(255,255,255,.98)",
            boxShadow: "0 18px 55px rgba(15,42,64,.18)",
          }}
        >
          <summary
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "13px 16px",
              cursor: "pointer",
              listStyle: "none",
              background: "linear-gradient(135deg,#0a7180,#12455f)",
              color: "white",
              fontWeight: 850,
            }}
          >
            <span>آخرین فاکتورهای این مشتری</span>
            <span
              style={{
                minWidth: 28,
                padding: "3px 8px",
                borderRadius: 999,
                background: "rgba(255,255,255,.18)",
                textAlign: "center",
              }}
            >
              {numberFormatter.format(invoices.length)}
            </span>
          </summary>

          <div
            style={{
              maxHeight: "68vh",
              overflowY: "auto",
              padding: 14,
              background: "#f8fbfc",
            }}
          >
            {invoices.length === 0 ? (
              <div
                style={{
                  padding: 18,
                  borderRadius: 13,
                  background: "white",
                  color: "#607485",
                  lineHeight: 1.9,
                  textAlign: "center",
                }}
              >
                هنوز فاکتوری برای این پرونده ثبت نشده است. پس از تکمیل Sync هلو،
                فاکتورهای قبلی اینجا نمایش داده می‌شوند.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {invoices.map((invoice) => {
                  const items = itemsByInvoice.get(invoice.id) ?? [];
                  const visibleItems = items.slice(0, 3);

                  return (
                    <article
                      key={invoice.id}
                      style={{
                        padding: 13,
                        border: "1px solid #e3ecef",
                        borderRadius: 14,
                        background: "white",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <div>
                          <strong style={{ color: "#12344d" }}>
                            فاکتور {invoice.invoice_number || "بدون شماره"}
                          </strong>
                          <small
                            style={{
                              display: "block",
                              marginTop: 5,
                              color: "#718292",
                            }}
                          >
                            {formatDate(invoice.invoice_date)} · سند {invoice.document_number || "—"}
                          </small>
                        </div>

                        <b style={{ color: "#08745f", whiteSpace: "nowrap" }}>
                          {formatMoney(invoice.total_amount)} تومان
                        </b>
                      </div>

                      {visibleItems.length ? (
                        <ul
                          style={{
                            display: "grid",
                            gap: 4,
                            margin: "10px 0 0",
                            padding: "0 18px 0 0",
                            color: "#435d6e",
                            fontSize: 13,
                            lineHeight: 1.7,
                          }}
                        >
                          {visibleItems.map((item, index) => (
                            <li key={`${invoice.id}-${item.product_name}-${index}`}>
                              {item.product_name} · {formatQuantity(item.quantity)} عدد
                            </li>
                          ))}
                          {items.length > visibleItems.length ? (
                            <li>و {numberFormatter.format(items.length - visibleItems.length)} قلم دیگر</li>
                          ) : null}
                        </ul>
                      ) : (
                        <small
                          style={{
                            display: "block",
                            marginTop: 9,
                            color: "#8a6a35",
                          }}
                        >
                          اقلام این فاکتور هنوز همگام نشده‌اند.
                        </small>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            <Link
              href="#invoices"
              style={{
                display: "block",
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 11,
                background: "#e8f3f5",
                color: "#0b6674",
                textAlign: "center",
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              مشاهده همه فاکتورها و جزئیات کالاها
            </Link>
          </div>
        </details>
      </aside>
    </>
  );
}
