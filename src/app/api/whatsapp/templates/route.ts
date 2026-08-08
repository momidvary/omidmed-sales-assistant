import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { fetchWhatsAppTemplates, loadWhatsAppCloudConfig } from "@/lib/whatsapp/cloud-api";

export const runtime = "nodejs";
export const maxDuration = 30;

function responseError(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

async function authenticatedUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const { supabase, user } = await authenticatedUser();
  if (!user) return responseError("UNAUTHORIZED", "ورود به حساب لازم است.", 401);
  const { data, error } = await supabase
    .from("whatsapp_templates")
    .select("id,name,status,language,category,variable_count,last_synced_at")
    .eq("owner_id", user.id)
    .eq("status", "APPROVED")
    .order("name");
  if (error) {
    return responseError("SCHEMA_UNAVAILABLE", "زیرساخت Templateها هنوز آماده نیست.", 503);
  }
  return NextResponse.json({ ok: true, templates: data ?? [] });
}

export async function POST() {
  const { user } = await authenticatedUser();
  if (!user) return responseError("UNAUTHORIZED", "ورود به حساب لازم است.", 401);
  const config = loadWhatsAppCloudConfig();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!config || !supabaseUrl || !serviceKey) {
    return responseError("SERVER_CONFIG_MISSING", "تنظیمات امن Meta کامل نیست.", 503);
  }

  let templates;
  try {
    templates = await fetchWhatsAppTemplates({ config });
  } catch {
    return responseError("META_UNAVAILABLE", "همگام‌سازی Templateهای Meta انجام نشد.", 502);
  }

  const admin = createAdminClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: syncResult, error } = await admin.rpc("sync_whatsapp_templates", {
    p_owner_id: user.id,
    p_business_account_id: config.businessAccountId,
    p_templates: templates,
  });
  if (error) return responseError("DATABASE_ERROR", "ذخیره Templateها انجام نشد.", 503);
  const result = syncResult && typeof syncResult === "object"
    ? (syncResult as { synced?: unknown; approved?: unknown })
    : {};
  return NextResponse.json({
    ok: true,
    synced: Number(result.synced ?? 0),
    approved: Number(result.approved ?? 0),
  });
}
