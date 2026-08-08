"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeOriginalFilename, validateMedicalDocument } from "@/lib/uploads/medical-document";
import styles from "./accounting-attachment-uploader.module.css";

export type AccountingAttachment = {
  id: string;
  entity_type: "purchase_invoice" | "expense" | "payroll" | "material" | "product";
  entity_id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

const MAX = 10 * 1024 * 1024;

export default function AccountingAttachmentUploader({
  entityType,
  entityId,
  initialFiles = [],
}: {
  entityType: AccountingAttachment["entity_type"];
  entityId: string;
  initialFiles?: AccountingAttachment[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [files, setFiles] = useState(initialFiles);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const pairs = await Promise.all(files.map(async (file) => {
        const { data } = await supabase.storage.from("accounting-files").createSignedUrl(file.storage_path, 3600);
        return [file.id, data?.signedUrl ?? ""] as const;
      }));
      if (!cancelled) setUrls(Object.fromEntries(pairs));
    }
    void load();
    return () => { cancelled = true; };
  }, [files, supabase]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (!selected) return setMessage("ابتدا فایل را انتخاب کن.");
    let validated;
    try {
      validated = await validateMedicalDocument(selected, MAX);
    } catch (error) {
      return setMessage(error instanceof Error ? error.message : "فایل معتبر نیست.");
    }

    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setBusy(false);
      return setMessage("نشست ورود معتبر نیست.");
    }

    const path = `${userId}/${entityType}/${entityId}/${crypto.randomUUID()}.${validated.extension}`;
    const { error: uploadError } = await supabase.storage
      .from("accounting-files")
      .upload(path, selected, { contentType: validated.mimeType, upsert: false });
    if (uploadError) {
      setBusy(false);
      return setMessage("بارگذاری انجام نشد. شناسه خطا: ATTACHMENT-UPLOAD");
    }

    const { data, error } = await supabase
      .from("accounting_attachments")
      .insert({
        entity_type: entityType,
        entity_id: entityId,
        storage_path: path,
        original_name: safeOriginalFilename(selected.name),
        mime_type: validated.mimeType,
        size_bytes: selected.size,
      })
      .select("id,entity_type,entity_id,storage_path,original_name,mime_type,size_bytes,created_at")
      .single();

    if (error || !data) {
      await supabase.storage.from("accounting-files").remove([path]);
      setBusy(false);
      return setMessage("ثبت فایل انجام نشد. شناسه خطا: ATTACHMENT-SAVE");
    }

    setFiles((current) => [data as AccountingAttachment, ...current]);
    setSelected(null);
    const input = document.getElementById(`attachment-${entityId}`) as HTMLInputElement | null;
    if (input) input.value = "";
    setBusy(false);
    setMessage("فایل با موفقیت ذخیره شد.");
  }

  async function remove(file: AccountingAttachment) {
    if (!window.confirm("این فایل حذف شود؟")) return;
    setBusy(true);
    const { error } = await supabase.from("accounting_attachments").delete().eq("id", file.id);
    if (!error) await supabase.storage.from("accounting-files").remove([file.storage_path]);
    if (error) setMessage("حذف فایل انجام نشد. شناسه خطا: ATTACHMENT-DELETE");
    else setFiles((current) => current.filter((item) => item.id !== file.id));
    setBusy(false);
  }

  return (
    <div className={styles.wrapper}>
      <form onSubmit={upload} className={styles.form}>
        <input
          id={`attachment-${entityId}`}
          type="file"
          accept="image/png,image/jpeg,application/pdf"
          onChange={(event) => setSelected(event.target.files?.[0] ?? null)}
        />
        <button type="submit" disabled={busy}>{busy ? "در حال ثبت..." : "افزودن فایل"}</button>
      </form>
      {message ? <small className={styles.message}>{message}</small> : null}
      {files.length ? (
        <div className={styles.files}>
          {files.map((file) => (
            <span key={file.id}>
              {urls[file.id] ? <a href={urls[file.id]} target="_blank" rel="noreferrer">{file.original_name}</a> : file.original_name}
              <button type="button" disabled={busy} onClick={() => void remove(file)}>×</button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
