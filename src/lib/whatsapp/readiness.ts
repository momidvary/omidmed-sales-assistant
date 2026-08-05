import type { SupabaseClient } from "@supabase/supabase-js";

import { loadWhatsAppCloudConfig } from "./cloud-api";

export type WhatsAppEnvironmentReadiness = {
  cloudApiConfigured: boolean;
  webhookConfigured: boolean;
  graphApiVersionConfigured: boolean;
};

export type WhatsAppReadiness = WhatsAppEnvironmentReadiness & {
  schemaReady: boolean;
  sendReady: boolean;
};

export function getWhatsAppEnvironmentReadiness(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WhatsAppEnvironmentReadiness {
  const graphApiVersionConfigured = /^v[0-9]+(?:\.[0-9]+)?$/.test(
    env.WHATSAPP_GRAPH_API_VERSION?.trim() ?? "",
  );
  return {
    graphApiVersionConfigured,
    cloudApiConfigured: Boolean(loadWhatsAppCloudConfig(env)),
    webhookConfigured: Boolean(
      env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() && env.WHATSAPP_APP_SECRET?.trim(),
    ),
  };
}

export function buildWhatsAppReadiness(
  schemaReady: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
): WhatsAppReadiness {
  const environment = getWhatsAppEnvironmentReadiness(env);
  const serverPersistenceConfigured = Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
  return {
    schemaReady,
    ...environment,
    sendReady: schemaReady && environment.cloudApiConfigured && serverPersistenceConfigured,
  };
}

export async function probeWhatsAppSchema(admin: SupabaseClient) {
  const [content, customers, messages, events, rpc] = await Promise.all([
    admin.from("content_items").select("id,channel_payload").limit(0),
    admin
      .from("customers")
      .select("id,whatsapp_consent_status,whatsapp_consent_at,whatsapp_consent_source")
      .limit(0),
    admin
      .from("whatsapp_messages")
      .select("id,status,provider_result_unknown_at")
      .limit(0),
    admin.from("whatsapp_webhook_events").select("event_key").limit(0),
    admin.rpc("process_whatsapp_webhook_status", {
      p_event_key: "0".repeat(64),
      p_provider_message_id: "wamid.health-check-untracked",
      p_status: "sent",
      p_provider_timestamp: null,
      p_error_code: null,
      p_error_message: null,
    }),
  ]);

  const rpcRow = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
  const rpcReady =
    !rpc.error &&
    rpcRow &&
    typeof rpcRow === "object" &&
    "outcome" in rpcRow &&
    rpcRow.outcome === "untracked";
  return !content.error && !customers.error && !messages.error && !events.error && rpcReady;
}
