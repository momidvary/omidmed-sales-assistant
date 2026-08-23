"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
    if (selected.size < 5 || selected.size > MAX) {
      return setMessage("حجم فایل معتبر نیست؛ حداکثر ۱۰ مگابایت مجاز است.");
    }

    setBusy(true);
    try {
      const payload = new FormData();
      payload.set("file", selected);
      payload.set("entityType", entityType);
      payload.set("entityId", entityId);
      const response = await fetch("/api/accounting/attachments", {
        method: "POST",
        body: payload,
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        file?: AccountingAttachment;
        message?: string;
      };
      if (!response.ok || !result.ok || !result.file) {
        setMessage(result.message || "بارگذاری انجام نشد. شناسه خطا: ATTACHMENT-UPLOAD");
        return;
      }

      setFiles((current) => [result.file as AccountingAttachment, ...current]);
      setSelected(null);
      const input = document.getElementById(`attachment-${entityId}`) as HTMLInputElement | null;
      if (input) input.value = "";
      setMessage("فایل با موفقیت ذخیره شد.");
    } catch {
      setMessage("ارتباط برای ثبت پیوست کامل نشد. شناسه خطا: ATTACHMENT-NETWORK");
    } finally {
      setBusy(false);
    }
  }

  async function remove(file: AccountingAttachment) {
    if (!window.confirm("این فایل حذف شود؟")) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/accounting/attachments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: file.id }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        cleanupPending?: boolean;
        message?: string;
      };
      if (!response.ok || !result.ok) {
        setMessage(result.message || "حذف فایل انجام نشد. شناسه خطا: ATTACHMENT-DELETE");
        return;
      }
      setFiles((current) => current.filter((item) => item.id !== file.id));
      setMessage(
        result.message ||
          (result.cleanupPending
            ? "پیوست از رکورد حذف شد؛ پاک‌سازی Storage بعداً انجام می‌شود."
            : "فایل حذف شد."),
      );
    } catch {
      setMessage("ارتباط برای حذف پیوست کامل نشد. شناسه خطا: ATTACHMENT-DELETE-NETWORK");
    } finally {
      setBusy(false);
    }
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
