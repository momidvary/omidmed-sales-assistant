import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  safeOriginalFilename,
  validateMedicalDocument,
} from "@/lib/uploads/medical-document";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const entityTables = {
  purchase_invoice: "purchase_invoices",
  expense: "workshop_expenses",
  payroll: "payroll_entries",
  material: "materials",
  product: "costing_products",
} as const;

type EntityType = keyof typeof entityTables;

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

function isEntityType(value: string): value is EntityType {
  return Object.hasOwn(entityTables, value);
}

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_FILE_SIZE + 100_000) {
    return errorResponse("PAYLOAD_TOO_LARGE", "حجم فایل بیش از حد مجاز است.", 413);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorResponse("UNAUTHORIZED", "ورود به حساب لازم است.", 401);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("INVALID_FORM", "ساختار فایل ارسالی معتبر نیست.", 400);
  }

  const file = formData.get("file");
  const entityType = String(formData.get("entityType") ?? "").trim();
  const entityId = String(formData.get("entityId") ?? "").trim();
  if (!(file instanceof File) || !isEntityType(entityType) || !uuidPattern.test(entityId)) {
    return errorResponse("INVALID_ATTACHMENT", "اطلاعات پیوست معتبر نیست.", 400);
  }

  const table = entityTables[entityType];
  const { data: entity, error: entityError } = await supabase
    .from(table)
    .select("id")
    .eq("id", entityId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (entityError) {
    return errorResponse("ENTITY_READ_FAILED", "بررسی رکورد حسابداری انجام نشد.", 503);
  }
  if (!entity) return errorResponse("ENTITY_NOT_FOUND", "رکورد حسابداری در دسترس نیست.", 404);

  let validated: Awaited<ReturnType<typeof validateMedicalDocument>>;
  try {
    validated = await validateMedicalDocument(file, MAX_FILE_SIZE);
  } catch {
    return errorResponse(
      "INVALID_FILE",
      "پیوست باید PNG، JPEG یا PDF معتبر و حداکثر ۱۰ مگابایت باشد.",
      400,
    );
  }

  const path = `${user.id}/${entityType}/${entityId}/${crypto.randomUUID()}.${validated.extension}`;
  const { error: uploadError } = await supabase.storage
    .from("accounting-files")
    .upload(path, file, {
      contentType: validated.mimeType,
      upsert: false,
    });
  if (uploadError) {
    return errorResponse("ATTACHMENT_UPLOAD", "بارگذاری پیوست انجام نشد.", 503);
  }

  const { data, error } = await supabase
    .from("accounting_attachments")
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      storage_path: path,
      original_name: safeOriginalFilename(file.name),
      mime_type: validated.mimeType,
      size_bytes: file.size,
    })
    .select("id,entity_type,entity_id,storage_path,original_name,mime_type,size_bytes,created_at")
    .single();
  if (error || !data) {
    await supabase.storage.from("accounting-files").remove([path]);
    return errorResponse("ATTACHMENT_SAVE", "ثبت مشخصات پیوست انجام نشد.", 503);
  }

  return NextResponse.json({ ok: true, file: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorResponse("UNAUTHORIZED", "ورود به حساب لازم است.", 401);

  let body: { fileId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("INVALID_JSON", "ساختار درخواست معتبر نیست.", 400);
  }
  const fileId = typeof body.fileId === "string" ? body.fileId : "";
  if (!uuidPattern.test(fileId)) {
    return errorResponse("INVALID_FILE_ID", "شناسه پیوست معتبر نیست.", 400);
  }

  const { data: file, error: readError } = await supabase
    .from("accounting_attachments")
    .select("id,storage_path")
    .eq("id", fileId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (readError) return errorResponse("ATTACHMENT_READ", "بررسی پیوست انجام نشد.", 503);
  if (!file) return errorResponse("ATTACHMENT_NOT_FOUND", "پیوست در دسترس نیست.", 404);

  const { error: deleteError } = await supabase
    .from("accounting_attachments")
    .delete()
    .eq("id", file.id)
    .eq("owner_id", user.id);
  if (deleteError) return errorResponse("ATTACHMENT_DELETE", "حذف پیوست انجام نشد.", 503);

  const { error: storageError } = await supabase.storage
    .from("accounting-files")
    .remove([file.storage_path]);

  return NextResponse.json({
    ok: true,
    cleanupPending: Boolean(storageError),
    message: storageError
      ? "پیوست از رکورد حذف شد؛ پاک‌سازی Storage بعداً قابل تکرار است."
      : "پیوست حذف شد.",
  });
}
