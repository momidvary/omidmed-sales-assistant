import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type WhatsAppStatus = "sent" | "delivered" | "read" | "failed";

export type WhatsAppStoredStatus =
  | "draft"
  | "pending_confirmation"
  | "accepted"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "provider_result_unknown";

export type WhatsAppStatusEvent = {
  eventKey: string;
  providerMessageId: string;
  status: WhatsAppStatus;
  providerTimestamp: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export function verifyWebhookChallenge(input: {
  mode: string | null;
  token: string | null;
  challenge: string | null;
  expectedToken: string;
}) {
  return input.mode === "subscribe" &&
    Boolean(input.expectedToken) &&
    input.token === input.expectedToken &&
    Boolean(input.challenge)
    ? input.challenge
    : null;
}

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
) {
  if (!signatureHeader?.startsWith("sha256=") || !appSecret) return false;
  const supplied = signatureHeader.slice(7);
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}

export function parseWebhookStatusEvents(value: unknown): WhatsAppStatusEvent[] {
  if (!value || typeof value !== "object") return [];
  const entries = (value as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  const result: WhatsAppStatusEvent[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const changes = (entry as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (!change || typeof change !== "object") continue;
      const statuses = (change as { value?: { statuses?: unknown } }).value?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const rawStatus of statuses) {
        if (!rawStatus || typeof rawStatus !== "object") continue;
        const statusValue = rawStatus as {
          id?: unknown;
          status?: unknown;
          timestamp?: unknown;
          errors?: unknown;
        };
        if (
          typeof statusValue.id !== "string" ||
          !["sent", "delivered", "read", "failed"].includes(String(statusValue.status))
        ) {
          continue;
        }
        const status = statusValue.status as WhatsAppStatus;
        const timestamp =
          typeof statusValue.timestamp === "string" && /^\d+$/.test(statusValue.timestamp)
            ? new Date(Number(statusValue.timestamp) * 1000).toISOString()
            : null;
        const firstError = Array.isArray(statusValue.errors) ? statusValue.errors[0] : null;
        const errorCode =
          firstError && typeof firstError === "object" &&
          (typeof (firstError as { code?: unknown }).code === "string" ||
            typeof (firstError as { code?: unknown }).code === "number")
            ? String((firstError as { code: string | number }).code)
            : null;
        const errorMessage =
          firstError &&
          typeof firstError === "object" &&
          typeof (firstError as { title?: unknown }).title === "string"
            ? (firstError as { title: string }).title.slice(0, 500)
            : null;
        const identity = `${statusValue.id}|${status}|${statusValue.timestamp ?? ""}`;
        result.push({
          eventKey: createHash("sha256").update(identity).digest("hex"),
          providerMessageId: statusValue.id,
          status,
          providerTimestamp: timestamp,
          errorCode,
          errorMessage,
        });
      }
    }
  }
  return result;
}

const allowedWebhookTransitions: Readonly<Record<WhatsAppStoredStatus, readonly WhatsAppStatus[]>> = {
  draft: ["sent", "delivered", "read", "failed"],
  pending_confirmation: ["sent", "delivered", "read", "failed"],
  accepted: ["sent", "delivered", "read", "failed"],
  sent: ["delivered", "read", "failed"],
  delivered: ["read"],
  read: [],
  failed: [],
  provider_result_unknown: ["sent", "delivered", "read", "failed"],
};

export function shouldApplyStatus(current: string, next: WhatsAppStatus) {
  if (!(current in allowedWebhookTransitions)) return false;
  return allowedWebhookTransitions[current as WhatsAppStoredStatus].includes(next);
}

export type WebhookReconcileOutcome =
  | "applied"
  | "reconciled"
  | "duplicate"
  | "ignored"
  | "untracked";

export async function reconcileWebhookBatch(
  events: readonly WhatsAppStatusEvent[],
  reconcile: (event: WhatsAppStatusEvent) => Promise<WebhookReconcileOutcome>,
) {
  const outcomes: WebhookReconcileOutcome[] = [];
  try {
    for (const event of events) {
      outcomes.push(await reconcile(event));
    }
    return { ok: true as const, outcomes };
  } catch {
    return { ok: false as const, outcomes: [] };
  }
}

export function webhookBatchHttpStatus(result: { ok: boolean }) {
  return result.ok ? 200 : 503;
}
