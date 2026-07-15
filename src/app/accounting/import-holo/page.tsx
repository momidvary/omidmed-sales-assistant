import AppShell from "@/components/app-shell";
import AccountingNav from "@/components/accounting-nav";
import HoloAccountingImporter from "./holo-accounting-importer";

export default function HoloAccountingImportPage() {
  return (
    <AppShell
      active="accounting"
      title="ورود هزینه‌ها و برداشت شرکا از هلو"
      subtitle="فایل FP3 دفتر هزینه و جاری شرکا را مستقیم بخوان، دسته‌بندی‌ها را کنترل کن و سپس ثبت نهایی انجام بده."
    >
      <AccountingNav active="holo-accounting" />
      <HoloAccountingImporter />
    </AppShell>
  );
}
