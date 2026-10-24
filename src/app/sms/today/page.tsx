import Link from "next/link";

import AppShell from "@/components/app-shell";
import { DAILY_SMS_TARGETS, SMS_COOLDOWN_DAYS } from "@/lib/sales/sms-targets";
import { createClient } from "@/lib/supabase/server";

import styles from "../sms.module.css";
import { loadTodayTargets } from "./load";
import todayStyles from "./today.module.css";
import TodaySmsList from "./today-sms-list";

const number = new Intl.NumberFormat("fa-IR");

const MAX_LIMIT = 100;

export default async function TodaySmsPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string }>;
}) {
  const params = await searchParams;
  const requested = Number.parseInt(params.limit ?? "", 10);
  const limit = Number.isFinite(requested)
    ? Math.min(MAX_LIMIT, Math.max(DAILY_SMS_TARGETS, requested))
    : DAILY_SMS_TARGETS;
  const supabase = await createClient();
  const { items, candidates, skipped, failed } = await loadTodayTargets(supabase, limit);

  return (
    <AppShell active="sms-today" title="پیامک‌های امروز" subtitle="مشتری‌هایی که امروز ارزش پیام دادن دارند">
      <section className={styles.hero}>
        <div>
          <span>فروش و بازاریابی</span>
          <h2>{number.format(items.length)} مشتری برای پیامک امروز</h2>
          <p>
            از بین {number.format(candidates)} مشتری که امروز دلیلی برای پیام دارند، {number.format(items.length)} نفر با
            بیشترین امتیاز آمده‌اند. امتیاز از موعد خرید، کم شدن خرید، قیمت گرفتن، ارزش مشتری و پیگیری‌های شما ساخته
            می‌شود. بدهکاری هلو در آن حساب نمی‌شود.
          </p>
        </div>
        <Link href="/sms" className={styles.ready}>
          تاریخچه پیامک‌ها
        </Link>
      </section>

      {failed ? <p className={todayStyles.hint}>اطلاعات مشتری‌ها کامل خوانده نشد؛ صفحه را دوباره باز کنید.</p> : null}

      <p className={todayStyles.hint}>
        کنار گذاشته شده‌ها:{" "}
        {[
          ["پیامک اخیر", `پیامک در ${number.format(SMS_COOLDOWN_DAYS)} روز اخیر`],
          ["تماس اخیر", "تماس در هفته اخیر"],
          ["موبایل ندارد", "بدون موبایل معتبر"],
          ["از دست رفته", "از دست رفته"],
        ]
          .map(([key, label]) => `${label}: ${number.format(skipped[key] ?? 0)}`)
          .join(" · ")}
      </p>

      <TodaySmsList targets={items} />

      {candidates > items.length && limit < MAX_LIMIT ? (
        <Link className={todayStyles.more} href={`/sms/today?limit=${Math.min(MAX_LIMIT, limit + DAILY_SMS_TARGETS)}`}>
          {number.format(Math.min(DAILY_SMS_TARGETS, candidates - items.length))} نفر بیشتر
        </Link>
      ) : null}
    </AppShell>
  );
}
