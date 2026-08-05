import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  parseWebhookStatusEvents,
  shouldApplyStatus,
  verifyWebhookSignature,
  verifyWebhookChallenge,
} from "@/lib/whatsapp/webhook";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const verifiedChallenge = verifyWebhookChallenge({
    mode,
    token,
    challenge,
    expectedToken: expected ?? "",
  });
  if (verifiedChallenge) {
    return new Response(verifiedChallenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1_000_000) {
    return new Response("Payload too large", { status: 413 });
  }
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim() ?? "";
  if (!verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) return new Response("Unavailable", { status: 503 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  const events = parseWebhookStatusEvents(payload);
  if (!events.length) return NextResponse.json({ received: true });

  const admin = createAdminClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const event of events) {
    const { data: message } = await admin
      .from("whatsapp_messages")
      .select("id,owner_id,status")
      .eq("provider_message_id", event.providerMessageId)
      .maybeSingle();
    if (!message) continue;

    const { error: eventError } = await admin.from("whatsapp_webhook_events").insert({
      event_key: event.eventKey,
      owner_id: message.owner_id,
      whatsapp_message_id: message.id,
      provider_message_id: event.providerMessageId,
      provider_status: event.status,
      provider_timestamp: event.providerTimestamp,
    });
    if (eventError) continue;
    if (!shouldApplyStatus(message.status, event.status)) continue;

    const timestamp = event.providerTimestamp ?? new Date().toISOString();
    const update: Record<string, string | null> = {
      status: event.status,
      provider_status: event.status,
    };
    if (event.status === "sent") update.sent_at = timestamp;
    if (event.status === "delivered") update.delivered_at = timestamp;
    if (event.status === "read") update.read_at = timestamp;
    if (event.status === "failed") {
      update.failed_at = timestamp;
      update.provider_error_code = event.errorCode;
      update.provider_error_message = event.errorMessage;
    }
    const allowedCurrentStatuses: Record<string, string[]> = {
      sent: ["pending_confirmation", "accepted"],
      delivered: ["pending_confirmation", "accepted", "sent"],
      read: ["pending_confirmation", "accepted", "sent", "delivered"],
      failed: ["draft", "pending_confirmation", "accepted", "sent", "delivered"],
    };
    await admin
      .from("whatsapp_messages")
      .update(update)
      .eq("id", message.id)
      .in("status", allowedCurrentStatuses[event.status]);
  }
  return NextResponse.json({ received: true });
}
