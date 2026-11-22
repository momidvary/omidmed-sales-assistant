import { tehranDateKey } from "@/lib/finance/metrics";
import { readHistory } from "@/lib/supabase/read-history";
import type { createClient } from "@/lib/supabase/server";
import { normalizeIranMobile } from "./melipayamak";

type Supabase = Awaited<ReturnType<typeof createClient>>;
export type DismissalChoice = "today" | "week" | "month" | "indefinite" | "restore";
export type DismissedCustomer = { id: string; name: string; daily_sms_hidden_through: string };

export function hiddenThrough(choice: DismissalChoice, now: Date) {
  if (choice === "restore") return null;
  if (choice === "indefinite") return "infinity";
  const days = { today: 1, week: 7, month: 30 };
  const today = Date.parse(tehranDateKey(now) + "T00:00:00Z");
  return new Date(today + (days[choice] - 1) * 86_400_000).toISOString().slice(0, 10);
}

export async function loadDailySmsDismissals(supabase: Supabase, now: Date) {
  const result = await readHistory<DismissedCustomer & { phone: string | null }>((from, to) =>
    supabase.from("customers").select("id,name,phone,daily_sms_hidden_through")
      .gte("daily_sms_hidden_through", tehranDateKey(now)).order("id").range(from, to),
  );
  const keys = new Set<string>();
  const customers = result.rows.map(({ phone, ...customer }) => {
    keys.add(customer.id);
    const mobile = normalizeIranMobile(phone);
    if (mobile) keys.add(mobile);
    return customer;
  });
  return { customers, keys, error: result.error };
}

export async function dailySmsSendBlock(supabase: Supabase, customerId: string | null, mobile: string) {
  const hidden = await loadDailySmsDismissals(supabase, new Date());
  if (hidden.error) return { status: 503, error: "وضعیت فهرست کنارگذاشته‌ها خوانده نشد. دوباره تلاش کنید." };
  if (hidden.keys.has(customerId ?? "") || hidden.keys.has(mobile)) {
    return { status: 409, error: "این مشتری از پیامک‌های امروز کنار گذاشته شده است. فهرست را به‌روز کنید." };
  }
  return null;
}
