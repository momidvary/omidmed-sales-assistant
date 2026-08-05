import {
  WHATSAPP_CONTENT_TYPES,
  type WhatsAppGeneratedContent,
} from "./generation";

const legacyPayloadPrefix = "__omidmed_whatsapp_payload_v1__:";

export type StoredWhatsAppPayload = WhatsAppGeneratedContent & {
  content_type: (typeof WHATSAPP_CONTENT_TYPES)[number];
};

export function isStoredWhatsAppPayload(value: unknown): value is StoredWhatsAppPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.content_type === "string" &&
    WHATSAPP_CONTENT_TYPES.includes(payload.content_type as StoredWhatsAppPayload["content_type"]) &&
    [
      "title",
      "whatsapp_short_text",
      "whatsapp_long_text",
      "whatsapp_status_text",
      "call_to_action",
      "image_prompt",
      "suggested_template_name",
      "compliance_note",
    ].every((key) => typeof payload[key] === "string") &&
    Array.isArray(payload.template_variables) &&
    payload.template_variables.every((item) => typeof item === "string")
  );
}

export function encodeLegacyWhatsAppPayload(payload: StoredWhatsAppPayload) {
  if (!isStoredWhatsAppPayload(payload)) {
    throw new Error("Invalid WhatsApp compatibility payload");
  }
  return `${legacyPayloadPrefix}${JSON.stringify(payload)}`;
}

export function decodeLegacyWhatsAppPayload(values: readonly string[] | null | undefined) {
  const encoded = values?.find((value) => value.startsWith(legacyPayloadPrefix));
  if (!encoded) return null;
  try {
    const value = JSON.parse(encoded.slice(legacyPayloadPrefix.length)) as unknown;
    return isStoredWhatsAppPayload(value) ? value : null;
  } catch {
    return null;
  }
}
