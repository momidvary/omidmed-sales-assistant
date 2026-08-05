import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  buildWhatsAppReadiness,
  probeWhatsAppSchema,
} from "@/lib/whatsapp/readiness";

export const runtime = "nodejs";
export const maxDuration = 15;

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { message: "Authentication required." },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  let schemaReady = false;
  if (supabaseUrl && serviceKey) {
    const admin = createAdminClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    schemaReady = await probeWhatsAppSchema(admin);
  }

  const readiness = buildWhatsAppReadiness(schemaReady);
  return NextResponse.json(
    {
      ...readiness,
      message: readiness.sendReady
        ? "WhatsApp server prerequisites are ready."
        : "One or more WhatsApp server prerequisites are incomplete.",
    },
    { headers: noStoreHeaders },
  );
}
