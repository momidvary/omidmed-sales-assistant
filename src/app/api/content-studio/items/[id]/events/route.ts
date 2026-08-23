import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clientEvents = new Set(["copied"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!uuidPattern.test(id)) {
    return NextResponse.json({ ok: false, code: "INVALID_ID" }, { status: 400 });
  }
  const raw = await request.text();
  if (raw.length > 2000) {
    return NextResponse.json({ ok: false, code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }
  let body: { eventType?: unknown };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_JSON" }, { status: 400 });
  }
  const eventType = typeof body.eventType === "string" ? body.eventType : "";
  if (!clientEvents.has(eventType)) {
    return NextResponse.json({ ok: false, code: "INVALID_EVENT" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });

  const { error } = await supabase.from("content_events").insert({
    owner_id: user.id,
    content_item_id: id,
    event_type: eventType,
  });
  if (error) {
    return NextResponse.json({ ok: false, code: "EVENT_SAVE_FAILED" }, { status: 503 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
