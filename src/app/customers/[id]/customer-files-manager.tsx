"use client";

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import styles from "./customer.module.css";

export type CustomerFileRecord = {
  id: string;
  file_type: "print_design" | "invoice" | "logo" | "other";
  title: string | null;
  invoice_number: string | null;
  storage_path: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

const fileTypeLabels: Record<CustomerFileRecord["file_type"], string> = {
  print_design: "طرح چاپ کیف",
  invoice: "فاکتور",
  logo: "لوگو",
  other: "سایر فایل‌ها",
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} بایت`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} کیلوبایت`;
  return `${(bytes / 1024 / 1024).toFixed(1)} مگابایت`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
}

export default function CustomerFilesManager({
  customerId,
  initialFiles,
}: {
  customerId: string;
  initialFiles: CustomerFileRecord[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [files, setFiles] = useState(initialFiles);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<CustomerFileRecord["file_type"]>(
    "print_design",
  );
  const [title, setTitle] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSignedUrls() {
      const entries = await Promise.all(
        files.map(async (file) => {
          const { data } = await supabase.storage
            .from("customer-files")
            .createSignedUrl(file.storage_path, 60 * 60);
          return [file.id, data?.signedUrl ?? ""] as const;
        }),
      );

      if (!cancelled) setSignedUrls(Object.fromEntries(entries));
    }

    void loadSignedUrls();
    return () => {
      cancelled = true;
    };
  }, [files, supabase]);

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!selectedFile) {
      setError("ابتدا یک فایل انتخاب کن.");
      return;
    }
    if (selectedFile.size < 5 || selectedFile.size > MAX_FILE_SIZE) {
      setError("حجم فایل معتبر نیست؛ حداکثر ۱۰ مگابایت مجاز است.");
      return;
    }

    setIsUploading(true);
    try {
      const payload = new FormData();
      payload.set("file", selectedFile);
      payload.set("fileType", fileType);
      payload.set("title", title.trim());
      payload.set("invoiceNumber", fileType === "invoice" ? invoiceNumber.trim() : "");

      const response = await fetch(
        `/api/customers/${encodeURIComponent(customerId)}/files`,
        { method: "POST", body: payload },
      );
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        file?: CustomerFileRecord;
        message?: string;
      };
      if (!response.ok || !data.ok || !data.file) {
        setError(data.message || "بارگذاری فایل انجام نشد. شناسه خطا: CUSTOMER-FILE-UPLOAD");
        return;
      }

      setFiles((current) => [data.file as CustomerFileRecord, ...current]);
      setSelectedFile(null);
      setTitle("");
      setInvoiceNumber("");
      const input = document.getElementById("customer-file-input") as HTMLInputElement | null;
      if (input) input.value = "";
      setMessage("فایل با موفقیت در پرونده مشتری ذخیره شد.");
    } catch {
      setError("ارتباط برای بارگذاری فایل کامل نشد. شناسه خطا: CUSTOMER-FILE-NETWORK");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(file: CustomerFileRecord) {
    const confirmed = window.confirm(
      `فایل «${file.title || file.original_name}» حذف شود؟`,
    );
    if (!confirmed) return;

    setError(null);
    setMessage(null);
    setDeletingId(file.id);
    try {
      const response = await fetch(
        `/api/customers/${encodeURIComponent(customerId)}/files`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId: file.id }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        cleanupPending?: boolean;
        message?: string;
      };
      if (!response.ok || !data.ok) {
        setError(data.message || "حذف فایل انجام نشد. شناسه خطا: CUSTOMER-FILE-DELETE");
        return;
      }
      setFiles((current) => current.filter((item) => item.id !== file.id));
      setMessage(
        data.message ||
          (data.cleanupPending
            ? "فایل از پرونده حذف شد؛ پاک‌سازی فضای ذخیره‌سازی بعداً انجام می‌شود."
            : "فایل حذف شد."),
      );
    } catch {
      setError("ارتباط برای حذف فایل کامل نشد. شناسه خطا: CUSTOMER-FILE-DELETE-NETWORK");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className={styles.filesSection}>
      <article className={styles.fileUploadCard}>
        <div className={styles.sectionHeading}>
          <div className={styles.fileIcon}>فایل</div>
          <div>
            <h3>فایل‌های اختصاصی مشتری</h3>
            <p>طرح چاپ کیف، لوگو و تصویر یا PDF فاکتور را اینجا نگه دار.</p>
          </div>
        </div>

        {message ? <div className={styles.inlineSuccess}>{message}</div> : null}
        {error ? <div className={styles.inlineError}>{error}</div> : null}

        <form className={styles.fileUploadForm} onSubmit={handleUpload}>
          <label>
            نوع فایل
            <select
              value={fileType}
              onChange={(event) =>
                setFileType(event.target.value as CustomerFileRecord["file_type"])
              }
            >
              <option value="print_design">طرح چاپ کیف</option>
              <option value="logo">لوگو</option>
              <option value="invoice">فاکتور</option>
              <option value="other">سایر</option>
            </select>
          </label>

          <label>
            عنوان فایل
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              placeholder="مثلاً طرح چاپ اصلی کیف ۳۰×۴۰"
            />
          </label>

          {fileType === "invoice" ? (
            <label>
              شماره فاکتور
              <input
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
                maxLength={80}
                placeholder="مثلاً ۱۲۵۴"
                dir="ltr"
              />
            </label>
          ) : null}

          <label>
            انتخاب فایل
            <input
              id="customer-file-input"
              type="file"
              accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              required
            />
            <small>PNG، JPG یا PDF؛ حداکثر ۱۰ مگابایت</small>
          </label>

          <button type="submit" disabled={isUploading}>
            {isUploading ? "در حال بارگذاری..." : "بارگذاری و ذخیره فایل"}
          </button>
        </form>
      </article>

      <article className={styles.fileGalleryCard}>
        <div className={styles.sectionHeading}>
          <div className={styles.fileIcon}>آرشیو</div>
          <div>
            <h3>آرشیو فایل‌های مشتری</h3>
            <p>{files.length.toLocaleString("fa-IR")} فایل ذخیره‌شده</p>
          </div>
        </div>

        {files.length === 0 ? (
          <div className={styles.emptyFiles}>
            هنوز طرح چاپ، لوگو یا فاکتوری برای این مشتری ثبت نشده است.
          </div>
        ) : (
          <div className={styles.fileGrid}>
            {files.map((file) => {
              const signedUrl = signedUrls[file.id];
              const isImage = file.mime_type.startsWith("image/");

              return (
                <article className={styles.fileItem} key={file.id}>
                  <div className={styles.filePreview}>
                    {isImage && signedUrl ? (
                      <img
                        src={signedUrl}
                        alt={file.title || file.original_name}
                      />
                    ) : (
                      <span>{file.mime_type === "application/pdf" ? "PDF" : "FILE"}</span>
                    )}
                  </div>

                  <div className={styles.fileBody}>
                    <div className={styles.fileMetaTop}>
                      <span className={styles.fileTypeBadge}>
                        {fileTypeLabels[file.file_type]}
                      </span>
                      <time>{formatDateTime(file.created_at)}</time>
                    </div>
                    <strong>{file.title || file.original_name}</strong>
                    <p dir="auto">{file.original_name}</p>
                    {file.invoice_number ? (
                      <div className={styles.invoiceTag} dir="ltr">
                        فاکتور: {file.invoice_number}
                      </div>
                    ) : null}
                    <small>{formatSize(file.size_bytes)}</small>

                    <div className={styles.fileActions}>
                      {signedUrl ? (
                        <a href={signedUrl} target="_blank" rel="noreferrer">
                          مشاهده فایل
                        </a>
                      ) : (
                        <span>در حال آماده‌سازی...</span>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDelete(file)}
                        disabled={deletingId === file.id}
                      >
                        {deletingId === file.id ? "حذف..." : "حذف"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </article>
    </section>
  );
}
