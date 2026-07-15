export type InvoiceDocumentType = "purchase_invoice" | "preinvoice" | "receipt" | "unknown";
export type InvoiceCurrency = "toman" | "rial" | "unknown";
export type InvoicePaymentStatus = "unpaid" | "partial" | "paid" | "unknown";
export type InvoicePaymentMethod = "cash" | "card" | "bank_transfer" | "cheque" | "credit" | "other" | "unknown";

export type AIInvoiceItem = {
  description: string;
  matched_material_name: string | null;
  quantity: number;
  unit: string;
  unit_price_toman: number;
  discount_amount_toman: number;
  tax_amount_toman: number;
  line_total_toman: number;
  confidence: number;
  warning: string | null;
};

export type AIInvoiceExtraction = {
  document_type: InvoiceDocumentType;
  supplier_name: string | null;
  supplier_match_name: string | null;
  invoice_number: string | null;
  invoice_date_jalali: string | null;
  due_date_jalali: string | null;
  original_currency: InvoiceCurrency;
  converted_to_toman: boolean;
  subtotal_toman: number;
  discount_amount_toman: number;
  tax_amount_toman: number;
  shipping_amount_toman: number;
  other_costs_toman: number;
  total_amount_toman: number;
  payment_status: InvoicePaymentStatus;
  payment_method: InvoicePaymentMethod;
  notes: string | null;
  items: AIInvoiceItem[];
  warnings: string[];
  overall_confidence: number;
};

export function normalizeMatchText(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("fa-IR")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[\s\-_/()（）،,:؛.]+/g, " ")
    .trim();
}
