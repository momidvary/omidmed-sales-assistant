import Link from "next/link";

import AppShell from "@/components/app-shell";
import { isOwner } from "@/lib/team";

// Wraps owner-only sections. The database refuses a team member's access to
// the same data anyway; this gives them a clear page instead of empty lists.
export default async function OwnerOnly({ children }: { children: React.ReactNode }) {
  if (await isOwner()) return <>{children}</>;
  return (
    <AppShell active="" title="دسترسی محدود">
      <div className="restricted-card">
        <h2>این بخش فقط برای مدیر است</h2>
        <p>برای کار روزانه از «امروز»، «مشتریان» و «پیامک‌های امروز» استفاده کنید.</p>
        <Link href="/">بازگشت به امروز</Link>
      </div>
    </AppShell>
  );
}
