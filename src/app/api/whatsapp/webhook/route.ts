import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import {
  parseWebhookStatusEvents,
  reconcileWebhookBatch,
  type WebhookReconcileOutcome,
  webhookBatchHttpStatus,
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

  const reconciled = await reconcileWebhookBatch(events, async (event) => {
    const { data, error } = await admin.rpc("process_whatsapp_webhook_status", {
      p_event_key: event.eventKey,
      p_provider_message_id: event.providerMessageId,
      p_status: event.status,
      p_provider_timestamp: event.providerTimestamp,
      p_error_code: event.errorCode,
      p_error_message: event.errorMessage,
    });
    if (error) throw new Error("Webhook transaction failed");
    const row = Array.isArray(data) ? data[0] : data;
    const outcome = row && typeof row === "object" && "outcome" in row
      ? String(row.outcome)
      : "";
    if (!["applied", "reconciled", "duplicate", "ignored", "untracked"].includes(outcome)) {
      throw new Error("Webhook transaction returned an invalid result");
    }
    return outcome as WebhookReconcileOutcome;
  });
  if (!reconciled.ok) {
    return NextResponse.json(
      { received: false, retryable: true },
      { status: webhookBatchHttpStatus(reconciled) },
    );
  }
  return NextResponse.json({ received: true });
}
