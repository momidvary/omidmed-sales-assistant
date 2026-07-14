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

const ALLOWED = ["image/png", "image/jpeg", "application/pdf"];
const MAX = 10 * 1024 * 1024;

function extension(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/jpeg") return "jpg";
  return "pdf";
}

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
    if (!ALLOWED.includes(selected.type)) return setMessage("فقط PNG، JPG و PDF مجاز است.");
    if (selected.size > MAX) return setMessage("حجم فایل باید کمتر از ۱۰ مگابایت باشد.");

    setBusy(true);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setBusy(false);
      return setMessage("نشست ورود معتبر نیست.");
    }

    const path = `${userId}/${entityType}/${entityId}/${crypto.randomUUID()}.${extension(selected)}`;
    const { error: uploadError } = await supabase.storage
      .from("accounting-files")
      .upload(path, selected, { contentType: selected.type, upsert: false });
    if (uploadError) {
      setBusy(false);
      return setMessage(`بارگذاری انجام نشد: ${uploadError.message}`);
    }

    const { data, error } = await supabase
      .from("accounting_attachments")
      .insert({
        entity_type: entityType,
        entity_id: entityId,
        storage_path: path,
        original_name: selected.name,
        mime_type: selected.type,
        size_bytes: selected.size,
      })
      .select("id,entity_type,entity_id,storage_path,original_name,mime_type,size_bytes,created_at")
      .single();

    if (error || !data) {
      await supabase.storage.from("accounting-files").remove([path]);
      setBusy(false);
      return setMessage(`ثبت فایل انجام نشد: ${error?.message ?? "خطای نامشخص"}`);
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
    if (error) setMessage(`حذف انجام نشد: ${error.message}`);
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
