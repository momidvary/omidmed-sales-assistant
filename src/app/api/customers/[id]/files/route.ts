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
const fileTypes = new Set(["print_design", "invoice", "logo", "other"]);

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ ok: false, code, message }, { status });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: customerId } = await context.params;
  if (!uuidPattern.test(customerId)) {
    return errorResponse("INVALID_CUSTOMER_ID", "شناسه مشتری معتبر نیست.", 400);
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_FILE_SIZE + 100_000) {
    return errorResponse("PAYLOAD_TOO_LARGE", "حجم فایل بیش از حد مجاز است.", 413);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorResponse("UNAUTHORIZED", "ورود به حساب لازم است.", 401);

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (customerError) {
    return errorResponse("CUSTOMER_READ_FAILED", "بررسی مشتری انجام نشد.", 503);
  }
  if (!customer) return errorResponse("CUSTOMER_NOT_FOUND", "مشتری در دسترس نیست.", 404);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("INVALID_FORM", "ساختار فایل ارسالی معتبر نیست.", 400);
  }

  const file = formData.get("file");
  const fileType = String(formData.get("fileType") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim().slice(0, 120);
  const invoiceNumber = String(formData.get("invoiceNumber") ?? "").trim().slice(0, 80);
  if (!(file instanceof File) || !fileTypes.has(fileType)) {
    return errorResponse("INVALID_FILE_INPUT", "فایل یا نوع فایل معتبر نیست.", 400);
  }

  let validated: Awaited<ReturnType<typeof validateMedicalDocument>>;
  try {
    validated = await validateMedicalDocument(file, MAX_FILE_SIZE);
  } catch {
    return errorResponse(
      "INVALID_FILE",
      "فایل باید PNG، JPEG یا PDF معتبر و حداکثر ۱۰ مگابایت باشد.",
      400,
    );
  }

  const storagePath = `${user.id}/${customerId}/${crypto.randomUUID()}.${validated.extension}`;
  const { error: uploadError } = await supabase.storage
    .from("customer-files")
    .upload(storagePath, file, {
      cacheControl: "3600",
      contentType: validated.mimeType,
      upsert: false,
    });
  if (uploadError) {
    return errorResponse("CUSTOMER_FILE_UPLOAD", "بارگذاری فایل انجام نشد.", 503);
  }

  const { data: insertedFile, error: insertError } = await supabase
    .from("customer_files")
    .insert({
      customer_id: customerId,
      file_type: fileType,
      title: title || null,
      invoice_number: fileType === "invoice" && invoiceNumber ? invoiceNumber : null,
      storage_path: storagePath,
      original_name: safeOriginalFilename(file.name),
      mime_type: validated.mimeType,
      size_bytes: file.size,
    })
    .select(
      "id,file_type,title,invoice_number,storage_path,original_name,mime_type,size_bytes,created_at",
    )
    .single();
  if (insertError || !insertedFile) {
    await supabase.storage.from("customer-files").remove([storagePath]);
    return errorResponse("CUSTOMER_FILE_SAVE", "ثبت مشخصات فایل انجام نشد.", 503);
  }

  return NextResponse.json({ ok: true, file: insertedFile }, { status: 201 });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: customerId } = await context.params;
  if (!uuidPattern.test(customerId)) {
    return errorResponse("INVALID_CUSTOMER_ID", "شناسه مشتری معتبر نیست.", 400);
  }

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
    return errorResponse("INVALID_FILE_ID", "شناسه فایل معتبر نیست.", 400);
  }

  const { data: row, error: readError } = await supabase
    .from("customer_files")
    .select("id,storage_path")
    .eq("id", fileId)
    .eq("customer_id", customerId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (readError) return errorResponse("CUSTOMER_FILE_READ", "بررسی فایل انجام نشد.", 503);
  if (!row) return errorResponse("CUSTOMER_FILE_NOT_FOUND", "فایل در دسترس نیست.", 404);

  const { error: deleteError } = await supabase
    .from("customer_files")
    .delete()
    .eq("id", row.id)
    .eq("owner_id", user.id);
  if (deleteError) return errorResponse("CUSTOMER_FILE_DELETE", "حذف فایل انجام نشد.", 503);

  // The database record is removed first so a storage-cleanup outage cannot
  // leave a live record pointing at a missing object. A private orphan object
  // is safer and can be cleaned later; it remains owner-scoped by storage RLS.
  const { error: storageError } = await supabase.storage
    .from("customer-files")
    .remove([row.storage_path]);

  return NextResponse.json({
    ok: true,
    cleanupPending: Boolean(storageError),
    message: storageError
      ? "فایل از پرونده حذف شد؛ پاک‌سازی فضای ذخیره‌سازی بعداً قابل تکرار است."
      : "فایل حذف شد.",
  });
}
