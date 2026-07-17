import AppShell from "@/components/app-shell";
import AccountingNav from "@/components/accounting-nav";

import SmartCostReview from "./smart-cost-review";

export default function SmartCostReviewPage() {
  return (
    <AppShell
      active="accounting"
      title="مرتب‌سازی هوشمند هزینه‌ها"
      subtitle="برنامه هزینه‌های هلو را گروه‌بندی می‌کند؛ تو فقط پیشنهادها را مرور و یک‌بار تأیید می‌کنی."
    >
      <AccountingNav active="cost_review" />
      <SmartCostReview />
    </AppShell>
  );
}
