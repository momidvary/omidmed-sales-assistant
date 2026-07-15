import AppShell from "@/components/app-shell";
import AccountingNav from "@/components/accounting-nav";
import { createClient } from "@/lib/supabase/server";
import InvoiceAIScanner from "./invoice-ai-scanner";
import styles from "./invoice-ai-scanner.module.css";

export default async function InvoiceScanPage() {
  const supabase = await createClient();
  const [supplierResult, materialResult] = await Promise.all([
    supabase.from("suppliers").select("id,name").eq("is_active", true).order("name"),
    supabase.from("materials").select("id,name,unit").eq("is_active", true).order("name"),
  ]);

  const databaseError = supplierResult.error || materialResult.error;

  return (
    <AppShell
      active="accounting"
      title="ثبت هوشمند فاکتور خرید"
      subtitle="عکس یا PDF را بده؛ هوش مصنوعی اطلاعات را به پیش‌نویس قابل ویرایش تبدیل می‌کند. ثبت نهایی فقط با تأیید تو انجام می‌شود."
    >
      <AccountingNav active="purchase_scan" />
      {databaseError ? (
        <div className={styles.alert}>دریافت تأمین‌کنندگان یا مواد انجام نشد. ابتدا SQL مرحله ۱۴ را بررسی کن: {databaseError.message}</div>
      ) : null}
      <InvoiceAIScanner
        suppliers={supplierResult.data ?? []}
        materials={materialResult.data ?? []}
      />
    </AppShell>
  );
}
