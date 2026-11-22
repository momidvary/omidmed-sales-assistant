"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { hiddenThrough, type DismissalChoice } from "@/lib/sms/daily-dismissals";

export async function setDailySmsDismissal(id: string, choice: DismissalChoice) {
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) ||
      !["today", "week", "month", "indefinite", "restore"].includes(choice)) {
    return { error: "مشتری یا مدت انتخاب‌شده معتبر نیست." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.from("customers")
    .update({ daily_sms_hidden_through: hiddenThrough(choice, new Date()) })
    .eq("id", id).select("id").single();
  if (error || !data) return { error: "تغییر فهرست ذخیره نشد. دوباره تلاش کنید." };
  revalidatePath("/sms/today");
  revalidatePath("/");
  return { error: null };
}
