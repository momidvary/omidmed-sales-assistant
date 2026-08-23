"use client";

import { useState } from "react";

import styles from "./content-studio.module.css";

type Version = {
  id: string;
  version_number: number;
  caption: string;
  final_text: string | null;
  change_kind: string;
  created_at: string;
};

type Variant = { kind: string; text: string };

const variantLabels: Record<string, string> = {
  short: "کوتاه و مستقیم",
  professional: "حرفه‌ای و فروش‌محور",
  educational: "آموزشی و اعتمادساز",
};

export default function ContentRevisionEditor({
  itemId,
  initialText,
  channelPayload,
}: {
  itemId: string;
  initialText: string;
  channelPayload: Record<string, unknown>;
}) {
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingKind, setPendingKind] = useState("edit");
  const [variants, setVariants] = useState<Variant[]>([]);

  async function persistRevision(
    nextText: string,
    changeKind: string,
    successMessage: string,
  ) {
    const response = await fetch(`/api/content-studio/items/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caption: nextText,
        finalText: nextText,
        channelPayload,
        changeKind,
      }),
    });
    if (!response.ok) throw new Error();
    setText(nextText);
    setMessage(successMessage);
    setPendingKind("edit");
    setVariants([]);
    setVersions([]);
  }

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await persistRevision(text, pendingKind, "نسخه ویرایش‌شده ذخیره شد.");
    } catch {
      setMessage("ذخیره انجام نشد. شناسه خطا: CONTENT-REVISION-SAVE");
    } finally {
      setBusy(false);
    }
  }

  async function restoreVersion(version: Version) {
    const restoredText = (version.final_text || version.caption).trim();
    if (!restoredText) return;
    setBusy(true);
    setMessage("");
    try {
      await persistRevision(
        restoredText,
        "edit",
        `نسخه ${version.version_number} به‌عنوان نسخه جدید بازیابی و ذخیره شد.`,
      );
      setHistoryOpen(false);
    } catch {
      setMessage("بازیابی نسخه انجام نشد. شناسه خطا: CONTENT-REVISION-RESTORE");
    } finally {
      setBusy(false);
    }
  }

  async function refine(action: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/content-studio/items/${encodeURIComponent(itemId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, action }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        text?: string;
        changeKind?: string;
        variants?: Variant[];
        message?: string;
      };
      if (!response.ok || !data.ok) throw new Error(data.message || "بازنویسی انجام نشد.");
      if (data.variants?.length) {
        setVariants(data.variants);
        setMessage("سه نسخه آماده شد؛ یکی را برای ویرایش یا ذخیره انتخاب کن.");
      } else if (data.text) {
        setText(data.text);
        setPendingKind(data.changeKind || action);
        setVariants([]);
        setMessage("بازنویسی آماده است؛ پس از بررسی آن را ذخیره کن.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "بازنویسی انجام نشد. شناسه خطا: CONTENT-REFINE",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!next || versions.length) return;
    try {
      const response = await fetch(
        `/api/content-studio/items/${encodeURIComponent(itemId)}?page=1&pageSize=20`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as { ok?: boolean; versions?: Version[] };
      if (!response.ok || !data.ok) throw new Error();
      setVersions(data.versions ?? []);
    } catch {
      setMessage("تاریخچه نسخه‌ها دریافت نشد. شناسه خطا: CONTENT-HISTORY-READ");
    }
  }

  return (
    <div className={styles.revisionEditor}>
      <textarea
        aria-label="متن نهایی قابل ویرایش"
        maxLength={8000}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className={styles.textTools}>
        <button type="button" disabled={busy || !text.trim()} onClick={save}>
          {busy ? "در حال ذخیره..." : "ذخیره نسخه"}
        </button>
        <button type="button" disabled={busy} onClick={toggleHistory}>
          {historyOpen ? "بستن تاریخچه" : "تاریخچه نسخه‌ها"}
        </button>
        <button type="button" disabled={busy || !text.trim()} onClick={() => refine("variants")}>سه نسخه</button>
        <button type="button" disabled={busy || !text.trim()} onClick={() => refine("shorten")}>کوتاه‌تر</button>
        <button type="button" disabled={busy || !text.trim()} onClick={() => refine("expand")}>کامل‌تر</button>
        <button type="button" disabled={busy || !text.trim()} onClick={() => refine("cta")}>تغییر CTA</button>
        <button type="button" disabled={busy || !text.trim()} onClick={() => refine("professional")}>حرفه‌ای</button>
        <button type="button" disabled={busy || !text.trim()} onClick={() => refine("friendly")}>صمیمی</button>
        <button type="button" disabled={busy || !text.trim()} onClick={() => refine("hook")}>Hook تازه</button>
      </div>
      {variants.length ? (
        <div className={styles.versionHistory}>
          {variants.map((variant) => (
            <button
              type="button"
              key={variant.kind}
              onClick={() => {
                setText(variant.text);
                setPendingKind(variant.kind === "short" ? "shorten" : variant.kind);
                setVariants([]);
              }}
            >
              <strong>{variantLabels[variant.kind] || variant.kind}</strong>
              <span>{variant.text}</span>
            </button>
          ))}
        </div>
      ) : null}
      {message ? <small>{message}</small> : null}
      {historyOpen ? (
        <div className={styles.versionHistory}>
          {versions.length ? versions.map((version) => (
            <details key={version.id}>
              <summary>نسخه {version.version_number} · {version.change_kind}</summary>
              <p>{version.final_text || version.caption}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => restoreVersion(version)}
              >
                بازیابی به‌عنوان نسخه جدید
              </button>
            </details>
          )) : <span>نسخه‌ای دریافت نشد.</span>}
        </div>
      ) : null}
    </div>
  );
}
