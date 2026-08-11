"use client";

import { useEffect, useRef, useState } from "react";

import {
  overlayFontSize,
  overlaySafeMargin,
  sanitizeOverlayText,
  wrapRtlText,
} from "@/lib/content-studio/persian-overlay";

import styles from "./content-studio.module.css";

type Props = {
  imageUrl: string;
  defaultHeadline?: string | null;
  defaultCta?: string | null;
  filename?: string;
};

function drawTextBlock(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  weight: number,
  maxLines: number,
) {
  context.save();
  context.direction = "rtl";
  context.textAlign = "right";
  context.textBaseline = "top";
  context.font = `${weight} ${fontSize}px Tahoma, Arial, sans-serif`;
  const lines = wrapRtlText(
    (value) => context.measureText(value).width,
    text,
    maxWidth,
    maxLines,
  );
  const lineHeight = Math.round(fontSize * 1.45);
  for (let index = 0; index < lines.length; index += 1) {
    context.fillText(lines[index], x, y + index * lineHeight, maxWidth);
  }
  context.restore();
  return lines.length * lineHeight;
}

export default function PersianImageOverlay({
  imageUrl,
  defaultHeadline,
  defaultCta,
  filename = "omidmed-content.png",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [headline, setHeadline] = useState(sanitizeOverlayText(defaultHeadline ?? "", 180));
  const [subheadline, setSubheadline] = useState("");
  const [cta, setCta] = useState(sanitizeOverlayText(defaultCta ?? "", 100));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setHeadline(sanitizeOverlayText(defaultHeadline ?? "", 180));
    setCta(sanitizeOverlayText(defaultCta ?? "", 100));
  }, [defaultHeadline, defaultCta]);

  async function renderOverlay() {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(imageUrl, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error();
      const bitmap = await createImageBitmap(blob);
      const maxDimension = 2048;
      const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error();

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();

      const margin = overlaySafeMargin(canvas.width, canvas.height);
      const maxWidth = Math.round(canvas.width * 0.78);
      const cleanHeadline = sanitizeOverlayText(headline, 180);
      const cleanSubheadline = sanitizeOverlayText(subheadline, 260);
      const cleanCta = sanitizeOverlayText(cta, 100);
      const headlineSize = overlayFontSize(canvas.width, 0.055, 30, 92);
      const bodySize = overlayFontSize(canvas.width, 0.028, 20, 46);
      const ctaSize = overlayFontSize(canvas.width, 0.025, 18, 40);

      const gradientHeight = Math.min(
        canvas.height,
        Math.max(Math.round(canvas.height * 0.5), headlineSize * 6),
      );
      const gradient = context.createLinearGradient(
        0,
        canvas.height - gradientHeight,
        0,
        canvas.height,
      );
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(1, "rgba(0,0,0,0.72)");
      context.fillStyle = gradient;
      context.fillRect(0, canvas.height - gradientHeight, canvas.width, gradientHeight);

      let cursorY = canvas.height - margin;
      context.fillStyle = "#ffffff";

      if (cleanCta) {
        context.font = `700 ${ctaSize}px Tahoma, Arial, sans-serif`;
        const ctaLines = wrapRtlText(
          (value) => context.measureText(value).width,
          cleanCta,
          maxWidth,
          2,
        );
        const ctaHeight = Math.max(ctaSize * 1.5, ctaLines.length * ctaSize * 1.45);
        cursorY -= ctaHeight;
        drawTextBlock(
          context,
          cleanCta,
          canvas.width - margin,
          cursorY,
          maxWidth,
          ctaSize,
          700,
          2,
        );
        cursorY -= Math.round(bodySize * 0.5);
      }

      if (cleanSubheadline) {
        context.fillStyle = "rgba(255,255,255,0.9)";
        context.font = `500 ${bodySize}px Tahoma, Arial, sans-serif`;
        const bodyLines = wrapRtlText(
          (value) => context.measureText(value).width,
          cleanSubheadline,
          maxWidth,
          3,
        );
        const bodyHeight = Math.max(bodySize * 1.5, bodyLines.length * bodySize * 1.45);
        cursorY -= bodyHeight;
        drawTextBlock(
          context,
          cleanSubheadline,
          canvas.width - margin,
          cursorY,
          maxWidth,
          bodySize,
          500,
          3,
        );
        cursorY -= Math.round(bodySize * 0.45);
      }

      if (cleanHeadline) {
        context.fillStyle = "#ffffff";
        context.font = `800 ${headlineSize}px Tahoma, Arial, sans-serif`;
        const headlineLines = wrapRtlText(
          (value) => context.measureText(value).width,
          cleanHeadline,
          maxWidth,
          3,
        );
        const headlineHeight = Math.max(
          headlineSize * 1.5,
          headlineLines.length * headlineSize * 1.45,
        );
        cursorY -= headlineHeight;
        drawTextBlock(
          context,
          cleanHeadline,
          canvas.width - margin,
          Math.max(margin, cursorY),
          maxWidth,
          headlineSize,
          800,
          3,
        );
      }

      setMessage("پیش‌نمایش فارسی آماده است؛ متن توسط خود برنامه روی تصویر قرار گرفت.");
      return true;
    } catch {
      setMessage("ساخت پیش‌نمایش فارسی انجام نشد. شناسه خطا: CONTENT-OVERLAY");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const rendered = await renderOverlay();
    const canvas = canvasRef.current;
    if (!rendered || !canvas) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
    if (!blob) {
      setMessage("خروجی PNG ساخته نشد. شناسه خطا: CONTENT-OVERLAY-EXPORT");
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename.replace(/[^a-zA-Z0-9_.-]/g, "-");
    link.click();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <details className={styles.advancedPanel}>
      <summary>افزودن نوشته فارسی خوانا روی تصویر</summary>
      <p>مدل تصویر فارسی نمی‌نویسد؛ این ابزار متن را با RTL و حاشیه امن داخل مرورگر روی تصویر نهایی رندر می‌کند.</p>
      <div className={styles.form}>
        <label>
          تیتر
          <input
            value={headline}
            maxLength={180}
            onChange={(event) => setHeadline(event.target.value)}
            placeholder="تیتر کوتاه و واقعی"
          />
        </label>
        <label>
          زیرتیتر
          <textarea
            value={subheadline}
            maxLength={260}
            onChange={(event) => setSubheadline(event.target.value)}
            placeholder="توضیح کوتاه اختیاری"
          />
        </label>
        <label>
          دعوت به اقدام
          <input
            value={cta}
            maxLength={100}
            onChange={(event) => setCta(event.target.value)}
            placeholder="مثلاً برای دریافت اطلاعات تماس بگیرید"
          />
        </label>
        <div className={styles.textTools}>
          <button type="button" disabled={busy} onClick={() => void renderOverlay()}>
            {busy ? "در حال ساخت..." : "پیش‌نمایش"}
          </button>
          <button type="button" disabled={busy} onClick={() => void download()}>
            خروجی PNG
          </button>
        </div>
        {message ? <small>{message}</small> : null}
        <canvas
          ref={canvasRef}
          aria-label="پیش‌نمایش تصویر با نوشته فارسی"
          style={{ width: "100%", height: "auto", borderRadius: 12, background: "#eef2f6" }}
        />
      </div>
    </details>
  );
}
