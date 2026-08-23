export type MedicalDocumentMime = "image/png" | "image/jpeg" | "application/pdf";

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export function detectMedicalDocumentMime(bytes: Uint8Array): MedicalDocumentMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

export async function validateMedicalDocument(
  file: File,
  maxBytes = 10 * 1024 * 1024,
) {
  if (file.size < 5 || file.size > maxBytes) {
    throw new Error("حجم فایل معتبر نیست.");
  }
  const declared = file.type as MedicalDocumentMime;
  if (!["image/png", "image/jpeg", "application/pdf"].includes(declared)) {
    throw new Error("فقط PNG، JPEG یا PDF مجاز است.");
  }
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detected = detectMedicalDocumentMime(bytes);
  if (!detected || detected !== declared) {
    throw new Error("نوع واقعی فایل با نوع اعلام‌شده مطابقت ندارد.");
  }
  return {
    mimeType: detected,
    extension: detected === "image/png" ? "png" : detected === "image/jpeg" ? "jpg" : "pdf",
  } as const;
}

export function safeOriginalFilename(value: string) {
  const normalized = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "");
  const basename = normalized.split(/[\\/]/).pop() ?? "document";
  return basename.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 180) || "document";
}
