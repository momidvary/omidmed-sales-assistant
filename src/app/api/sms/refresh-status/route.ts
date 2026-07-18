import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { checkMeliPayamakDelivery } from "@/lib/sms/melipayamak-delivery";

type MessageRow = {
  id: string;
  provider_rec_id: string;
};

export async function POST() {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();

  if (authError || !auth.user) {
    return NextResponse.json(
      { error: "ابتدا وارد برنامه شو." },
      { status: 401 },
    );
  }

  const { data, error } = await supabase
    .from("sms_messages")
    .select("id,provider_rec_id")
    .eq("request_success", true)
    .not("provider_rec_id", "is", null)
    .in("delivery_status", ["accepted", "unknown"])
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as MessageRow[];

  if (!rows.length) {
    return NextResponse.json({
      success: true,
      checked: 0,
      delivered: 0,
      undelivered: 0,
      pending: 0,
    });
  }

  let statuses: Awaited<ReturnType<typeof checkMeliPayamakDelivery>>;

  try {
    statuses = await checkMeliPayamakDelivery(
      rows.map((row) => row.provider_rec_id),
    );
  } catch (caught) {
    return NextResponse.json(
      {
        error:
          caught instanceof Error
            ? caught.message
            : "بررسی وضعیت تحویل انجام نشد.",
      },
      { status: 502 },
    );
  }

  const statusMap = new Map(statuses.map((status) => [status.recId, status]));
  const updateErrors: string[] = [];

  for (let index = 0; index < rows.length; index += 10) {
    const chunk = rows.slice(index, index + 10);
    const results = await Promise.all(
      chunk.map(async (row) => {
        const status = statusMap.get(row.provider_rec_id);
        if (!status) return null;

        const providerStatus = status.code
          ? `${status.label} (کد ${status.code})`
          : status.label;

        const { error: updateError } = await supabase
          .from("sms_messages")
          .update({
            delivery_status: status.deliveryStatus,
            provider_status: providerStatus,
            error_message:
              status.deliveryStatus === "undelivered"
                ? providerStatus
                : null,
          })
          .eq("id", row.id);

        return updateError?.message ?? null;
      }),
    );

    updateErrors.push(
      ...results.filter((message): message is string => Boolean(message)),
    );
  }

  if (updateErrors.length) {
    return NextResponse.json(
      {
        error: "بخشی از وضعیت‌ها دریافت شد، اما ثبت کامل انجام نشد.",
        details: updateErrors.slice(0, 3),
      },
      { status: 500 },
    );
  }

  const delivered = statuses.filter(
    (status) => status.deliveryStatus === "delivered",
  ).length;
  const undelivered = statuses.filter(
    (status) => status.deliveryStatus === "undelivered",
  ).length;

  return NextResponse.json({
    success: true,
    checked: statuses.length,
    delivered,
    undelivered,
    pending: statuses.length - delivered - undelivered,
  });
}
