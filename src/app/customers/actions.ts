"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const validStatuses = new Set(["active", "inactive", "prospect", "lost"]);
const validPriorities = new Set(["low", "normal", "high", "vip"]);
const validLeadStages = new Set([
  "new",
  "contacted",
  "interested",
  "quoted",
  "decision",
  "converted",
  "lost",
]);

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function latinDigits(value: string) {
  return value
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
}

function clean(value: FormDataEntryValue | null, maxLength = 1000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizePhone(value: string) {
  let digits = latinDigits(value).replace(/\D/g, "");

  if (digits.startsWith("0098")) {
    digits = `0${digits.slice(4)}`;
  } else if (digits.startsWith("98")) {
    digits = `0${digits.slice(2)}`;
  } else if (digits.length === 10 && digits.startsWith("9")) {
    digits = `0${digits}`;
  }

  return digits || null;
}

function parseMoney(value: string) {
  const digits = latinDigits(value).replace(/[^\d.-]/g, "");
  if (!digits) return null;

  const numeric = Number(digits);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
}

function parsePreferredProducts(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,،\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 30),
    ),
  );
}

function parseTehranDateTime(value: string) {
  if (!value) return null;
  const normalized = value.length === 16 ? `${value}:00` : value;
  const date = new Date(`${normalized}+03:30`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildCustomerPayload(formData: FormData) {
  const statusValue = clean(formData.get("status"), 30);
  const priorityValue = clean(formData.get("priority"), 30);
  const leadStageValue = clean(formData.get("lead_stage"), 30);

  const status = validStatuses.has(statusValue) ? statusValue : "active";
  const priority = validPriorities.has(priorityValue)
    ? priorityValue
    : "normal";

  let leadStage: string | null = validLeadStages.has(leadStageValue)
    ? leadStageValue
    : null;

  if (status === "prospect" && !leadStage) {
    leadStage = "new";
  }

  if (status === "active" && leadStage && leadStage !== "converted") {
    leadStage = "converted";
  }

  const phone = clean(formData.get("phone"), 40);
  const preferredProducts = parsePreferredProducts(
    clean(formData.get("preferred_products"), 1000),
  );

  return {
    name: clean(formData.get("name"), 180),
    contact_name: clean(formData.get("contact_name"), 180) || null,
    phone: phone || null,
    normalized_phone: normalizePhone(phone),
    province: clean(formData.get("province"), 100) || null,
    city: clean(formData.get("city"), 100) || null,
    address: clean(formData.get("address"), 1000) || null,
    preferred_products: preferredProducts,
    status,
    priority,
    notes: clean(formData.get("notes"), 3000) || null,
    next_followup_at: parseTehranDateTime(
      clean(formData.get("next_followup_at"), 40),
    ),
    lead_stage: leadStage,
    lead_source: clean(formData.get("lead_source"), 180) || null,
    potential_value: parseMoney(
      clean(formData.get("potential_value"), 40),
    ),
  };
}

async function duplicatePhoneCustomer(
  normalizedPhone: string | null,
  excludedId?: string,
) {
  if (!normalizedPhone) return null;

  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("id,name")
    .eq("normalized_phone", normalizedPhone)
    .limit(1);

  if (excludedId) {
    query = query.neq("id", excludedId);
  }

  const { data } = await query.maybeSingle();
  return data;
}

export async function createCustomer(formData: FormData) {
  const payload = buildCustomerPayload(formData);

  if (!payload.name) {
    redirect("/customers/new?error=name");
  }

  const duplicate = await duplicatePhoneCustomer(payload.normalized_phone);

  if (duplicate) {
    redirect(
      `/customers/new?error=duplicate&duplicate_id=${encodeURIComponent(
        duplicate.id,
      )}`,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({
      ...payload,
      customer_code: `MANUAL-${Date.now()}`,
    })
    .select("id")
    .single();

  if (error || !data) {
    redirect(
      `/customers/new?error=save&message=${encodeURIComponent(
        error?.message ?? "unknown",
      )}`,
    );
  }

  revalidatePath("/");
  revalidatePath("/customers");
  redirect(`/customers/${data.id}?created=1`);
}

export async function updateCustomer(formData: FormData) {
  const customerId = clean(formData.get("customer_id"), 80);
  const payload = buildCustomerPayload(formData);

  if (!customerId || !payload.name) {
    redirect(`/customers/${customerId}/manage?error=required`);
  }

  const duplicate = await duplicatePhoneCustomer(
    payload.normalized_phone,
    customerId,
  );

  if (duplicate) {
    redirect(
      `/customers/${customerId}/manage?error=duplicate&duplicate_id=${encodeURIComponent(
        duplicate.id,
      )}`,
    );
  }

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("customers")
    .select("status")
    .eq("id", customerId)
    .single();

  if (
    current?.status === "prospect" &&
    payload.status === "active"
  ) {
    payload.lead_stage = "converted";
  }

  const { error } = await supabase
    .from("customers")
    .update(payload)
    .eq("id", customerId);

  if (error) {
    redirect(
      `/customers/${customerId}/manage?error=save&message=${encodeURIComponent(
        error.message,
      )}`,
    );
  }

  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}/manage?saved=1`);
}

export async function archiveCustomer(formData: FormData) {
  const customerId = clean(formData.get("customer_id"), 80);

  if (!customerId) {
    redirect("/customers?error=missing");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", customerId);

  if (error) {
    redirect(`/customers/${customerId}/manage?error=archive`);
  }

  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect("/customers?status=archived&archived=1");
}

export async function restoreCustomer(formData: FormData) {
  const customerId = clean(formData.get("customer_id"), 80);

  if (!customerId) {
    redirect("/customers?error=missing");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ archived_at: null })
    .eq("id", customerId);

  if (error) {
    redirect(`/customers/${customerId}/manage?error=restore`);
  }

  revalidatePath("/");
  revalidatePath("/customers");
  revalidatePath(`/customers/${customerId}`);
  redirect(`/customers/${customerId}/manage?restored=1`);
}

type RelationCheck = {
  table: string;
  label: string;
};

const relations: RelationCheck[] = [
  { table: "sales", label: "فروش" },
  { table: "followups", label: "پیگیری" },
  { table: "tasks", label: "وظیفه" },
  { table: "invoices", label: "فاکتور" },
  { table: "customer_files", label: "فایل" },
  { table: "sms_messages", label: "پیامک" },
  { table: "campaign_members", label: "کمپین" },
  { table: "sales_opportunities", label: "فرصت فروش" },
];

function missingTableError(code: string | undefined) {
  return code === "42P01" || code === "PGRST205";
}

export async function deleteCustomer(formData: FormData) {
  const customerId = clean(formData.get("customer_id"), 80);
  const confirmation = clean(formData.get("confirm_name"), 180);

  if (!customerId) {
    redirect("/customers?error=missing");
  }

  const supabase = await createClient();
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select(
      "id,name,imported_purchase_count,imported_total_sales",
    )
    .eq("id", customerId)
    .single();

  if (customerError || !customer) {
    redirect("/customers?error=notfound");
  }

  if (confirmation !== customer.name) {
    redirect(`/customers/${customerId}/manage?error=confirmation`);
  }

  if (
    Number(customer.imported_purchase_count ?? 0) > 0 ||
    Number(customer.imported_total_sales ?? 0) > 0
  ) {
    redirect(`/customers/${customerId}/manage?error=related`);
  }

  for (const relation of relations) {
    const { count, error } = await supabase
      .from(relation.table)
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customerId);

    if (error && !missingTableError(error.code)) {
      redirect(`/customers/${customerId}/manage?error=check`);
    }

    if ((count ?? 0) > 0) {
      redirect(
        `/customers/${customerId}/manage?error=related&relation=${encodeURIComponent(
          relation.label,
        )}`,
      );
    }
  }

  const { error: deleteError } = await supabase
    .from("customers")
    .delete()
    .eq("id", customerId);

  if (deleteError) {
    redirect(`/customers/${customerId}/manage?error=delete`);
  }

  revalidatePath("/");
  revalidatePath("/customers");
  redirect("/customers?deleted=1");
}
