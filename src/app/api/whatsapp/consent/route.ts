import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    customerId?: unknown;
    status?: unknown;
    source?: unknown;
  } | null;
  const customerId = typeof body?.customerId === "string" ? body.customerId : "";
  const status = body?.status;
  const source = typeof body?.source === "string" ? body.source.trim().slice(0, 200) : "";
  if (
    !uuidPattern.test(customerId) ||
    !["opted_in", "opted_out"].includes(String(status)) ||
    !source
  ) {
    return NextResponse.json(
      { ok: false, message: "اطلاعات رضایت معتبر نیست." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("customers")
    .update({
      whatsapp_consent_status: status,
      whatsapp_consent_at: new Date().toISOString(),
      whatsapp_consent_source: source,
    })
    .eq("id", customerId)
    .eq("owner_id", user.id)
    .select("id,whatsapp_consent_status,whatsapp_consent_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, message: "ثبت رضایت واتساپ ممکن نشد." },
      { status: 503 },
    );
  }
  if (!data) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, consent: data });
}
