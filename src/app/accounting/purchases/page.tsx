import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import AppShell from "@/components/app-shell";
import AccountingNav from "@/components/accounting-nav";
import AccountingAttachmentUploader, { type AccountingAttachment } from "@/components/accounting-attachment-uploader";
import { createClient } from "@/lib/supabase/server";
import { cleanText, formatDate, formatMoney } from "@/lib/accounting/format";
import { paymentStatusLabels } from "@/lib/accounting/constants";
import PurchaseInvoiceForm from "./purchase-invoice-form";
import styles from "../accounting.module.css";

async function addSupplier(formData: FormData) {
  "use server";
  const name = cleanText(formData, "name", 140);
  const contactName = cleanText(formData, "contact_name", 100);
  const phone = cleanText(formData, "phone", 30);
  const city = cleanText(formData, "city", 80);
  const notes = cleanText(formData, "notes", 800);
  if (!name) redirect("/accounting/purchases?error=supplier-invalid");
  const supabase = await createClient();
  const { error } = await supabase.from("suppliers").insert({ name, contact_name: contactName || null, phone: phone || null, city: city || null, notes: notes || null });
  if (error) redirect(`/accounting/purchases?error=${error.code === "23505" ? "supplier-duplicate" : "supplier-save"}`);
  revalidatePath("/accounting/purchases");
  redirect("/accounting/purchases?saved=supplier");
}

type Invoice = {
  id: string;
  invoice_number: string | null;
  invoice_date: string;
  subtotal: number | string;
  shipping_amount: number | string;
  other_costs: number | string;
  total_amount: number | string;
  payment_status: string;
  due_date: string | null;
  supplier: { name: string } | null;
};

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const [supplierResult, materialResult, invoiceResult, attachmentResult] = await Promise.all([
    supabase.from("suppliers").select("id,name").eq("is_active", true).order("name"),
    supabase.from("materials").select("id,name,unit").eq("is_active", true).order("name"),
    supabase.from("purchase_invoices").select("id,invoice_number,invoice_date,subtotal,shipping_amount,other_costs,total_amount,payment_status,due_date,supplier:suppliers(name)").order("invoice_date", { ascending: false }).limit(50),
    supabase.from("accounting_attachments").select("id,entity_type,entity_id,storage_path,original_name,mime_type,size_bytes,created_at").eq("entity_type", "purchase_invoice").order("created_at", { ascending: false }).limit(200),
  ]);

  const suppliers = supplierResult.data ?? [];
  const materials = materialResult.data ?? [];
  const invoices = (invoiceResult.data ?? []) as unknown as Invoice[];
  const attachments = (attachmentResult.data ?? []) as AccountingAttachment[];
  const attachmentMap = new Map<string, AccountingAttachment[]>();
  for (const file of attachments) attachmentMap.set(file.entity_id, [...(attachmentMap.get(file.entity_id) ?? []), file]);
  const databaseError = supplierResult.error || materialResult.error || invoiceResult.error;
  const errorMessage = params.error === "supplier-invalid" ? "نام تأمین‌کننده الزامی است." : params.error === "supplier-duplicate" ? "این تأمین‌کننده قبلاً ثبت شده است." : params.error ? "ثبت تأمین‌کننده انجام نشد." : null;

  return (
    <AppShell active="accounting" title="فاکتورهای خرید" subtitle="خرید مواد، حمل و هزینه‌های جانبی را ثبت کن تا بهای مؤثر هر واحد محاسبه شود.">
      <AccountingNav active="purchases" />
      {databaseError ? <div className={styles.alert}>ابتدا SQL مرحله ۱۴ را اجرا کن. جزئیات: {databaseError.message}</div> : null}
      {errorMessage ? <div className={styles.alert}>{errorMessage}</div> : null}
      {params.saved === "invoice-ai" ? <div className={styles.success}>فاکتور هوشمند با موفقیت ثبت و فایل آن آرشیو شد.</div> : params.saved ? <div className={styles.success}>تأمین‌کننده با موفقیت ثبت شد.</div> : null}

      <section className={styles.grid}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><h2>ثبت تأمین‌کننده</h2><p>برای پارچه، کیف خام، دوخت، چاپ و سایر خریدها.</p></div></header>
          <form action={addSupplier} className={styles.form}>
            <div className={styles.formGrid2}><label>نام تأمین‌کننده<input name="name" required /></label><label>نام رابط<input name="contact_name" /></label><label>شماره تماس<input name="phone" dir="ltr" /></label><label>شهر<input name="city" /></label></div>
            <label>یادداشت<textarea name="notes" /></label>
            <div className={styles.actionRow}><button className={styles.submitButton}>ثبت تأمین‌کننده</button></div>
          </form>
        </article>
        <article className={styles.panel}>
          <header className={styles.panelHeader}><div><h2>آمادگی ثبت خرید</h2><p>فاکتور خرید باید به یک تأمین‌کننده و حداقل یک ماده متصل شود.</p></div></header>
          <div className={styles.list}><div className={styles.listItem}><div><strong>{suppliers.length.toLocaleString("fa-IR")} تأمین‌کننده</strong><small>ثبت شده در بانک تأمین‌کنندگان</small></div></div><div className={styles.listItem}><div><strong>{materials.length.toLocaleString("fa-IR")} ماده</strong><small>قابل انتخاب در اقلام فاکتور</small></div></div></div>
          {!materials.length ? <div className={styles.warning}>قبل از ثبت فاکتور، مواد اولیه را در بخش «مواد و قیمت خرید» تعریف کن.</div> : null}
        </article>
      </section>

      <article className={`${styles.panel} ${styles.panelWide}`} style={{ marginTop: 16 }}>
        <header className={styles.panelHeader}><div><h2>ثبت فاکتور خرید جدید</h2><p>هزینه حمل و سایر هزینه‌ها به نسبت مبلغ اقلام روی بهای هر ماده سرشکن می‌شود.</p></div></header>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
          <Link href="/accounting/purchases/scan" className={styles.submitButton} style={{ textDecoration: "none", display: "inline-flex", width: "auto" }}>✦ ثبت با عکس یا PDF و هوش مصنوعی</Link>
        </div>
        <PurchaseInvoiceForm suppliers={suppliers} materials={materials} />
      </article>

      <article className={`${styles.panel} ${styles.panelWide}`} style={{ marginTop: 16 }}>
        <header className={styles.panelHeader}><div><h2>آخرین فاکتورهای خرید</h2><p>فایل اصل فاکتور را نیز می‌توانی کنار هر ردیف نگه داری.</p></div></header>
        {invoices.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>تأمین‌کننده / شماره</th><th>تاریخ</th><th>جمع اقلام</th><th>هزینه جانبی</th><th>مبلغ نهایی</th><th>وضعیت</th><th>فایل فاکتور</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.supplier?.name ?? "نامشخص"}</strong><small>شماره: {invoice.invoice_number || "ثبت نشده"}</small></td><td>{formatDate(invoice.invoice_date)}<small>{invoice.due_date ? `سررسید ${formatDate(invoice.due_date)}` : "بدون سررسید"}</small></td><td className={styles.numberCell}>{formatMoney(invoice.subtotal)}</td><td className={styles.numberCell}>{formatMoney(Number(invoice.shipping_amount) + Number(invoice.other_costs))}</td><td className={styles.numberCell}><strong>{formatMoney(invoice.total_amount)}</strong></td><td><span className={styles.status}>{paymentStatusLabels[invoice.payment_status] ?? invoice.payment_status}</span></td><td><AccountingAttachmentUploader entityType="purchase_invoice" entityId={invoice.id} initialFiles={attachmentMap.get(invoice.id) ?? []} /></td></tr>)}</tbody></table></div> : <div className={styles.empty}>هنوز فاکتور خریدی ثبت نشده است.</div>}
      </article>
    </AppShell>
  );
}
