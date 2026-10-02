"use client";

import { useEffect, useRef, useState } from "react";

import {
  loadPosterFonts,
  POSTER_SIZES,
  POSTER_THEMES,
  renderPoster,
  type PosterFormat,
} from "@/lib/poster/render";
import styles from "./poster-studio.module.css";

const FORMATS: PosterFormat[] = ["story", "post"];
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const CONTACT_STORAGE_KEY = "omidmed.poster.contact";

function readStoredContact() {
  try {
    return window.localStorage.getItem(CONTACT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

export default function PosterStudio() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageName, setImageName] = useState("");
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState("امیدمِد");
  const [headline, setHeadline] = useState("");
  const [subheadline, setSubheadline] = useState("");
  const [bulletsText, setBulletsText] = useState("");
  const [cta, setCta] = useState("سفارش از طریق واتساپ");
  const [contact, setContact] = useState("");
  const [caption, setCaption] = useState("");
  const [themeKey, setThemeKey] = useState(POSTER_THEMES[0].key);
  const [fontsReady, setFontsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canvases = useRef<Record<PosterFormat, HTMLCanvasElement | null>>({ story: null, post: null });

  useEffect(() => {
    // Read once on mount; localStorage is unavailable during server render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContact(readStoredContact());
    loadPosterFonts().finally(() => setFontsReady(true));
  }, []);

  useEffect(() => {
    if (!fontsReady) return;
    const theme = POSTER_THEMES.find((item) => item.key === themeKey) ?? POSTER_THEMES[0];
    const content = {
      brand,
      headline,
      subheadline,
      bullets: bulletsText.split("\n"),
      cta,
      contact,
    };
    for (const format of FORMATS) {
      const canvas = canvases.current[format];
      if (canvas) renderPoster(canvas, format, image, content, theme);
    }
  }, [fontsReady, image, brand, headline, subheadline, bulletsText, cta, contact, themeKey]);

  function updateContact(value: string) {
    setContact(value);
    try {
      window.localStorage.setItem(CONTACT_STORAGE_KEY, value);
    } catch {
      // Storage can be blocked; the poster still works without remembering it.
    }
  }

  function chooseImage(file: File | undefined) {
    setError("");
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError("فقط عکس JPG، PNG یا WEBP قابل استفاده است.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("حجم عکس باید کمتر از ۱۵ مگابایت باشد.");
      return;
    }
    const url = URL.createObjectURL(file);
    const element = new Image();
    element.onload = () => {
      setImage(element);
      setImageName(file.name);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      setError("این عکس باز نشد. عکس دیگری انتخاب کن.");
    };
    element.src = url;
  }

  async function writeWithAi() {
    setError("");
    setNotice("");
    if (!description.trim()) {
      setError("اول چند جمله درباره محصول بنویس؛ مثلاً نام، ویژگی‌ها و اگر خواستی قیمت.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/poster/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        text?: { headline: string; subheadline: string; bullets: string[]; cta: string; caption: string };
      };
      if (!response.ok || !data.text) {
        throw new Error(data.error || "تولید متن انجام نشد.");
      }
      setHeadline(data.text.headline);
      setSubheadline(data.text.subheadline);
      setBulletsText(data.text.bullets.join("\n"));
      if (data.text.cta) setCta(data.text.cta);
      setCaption(data.text.caption);
      setNotice("متن نوشته شد. اگر لازم است، پایین‌تر ویرایشش کن.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تولید متن انجام نشد.");
    } finally {
      setLoading(false);
    }
  }

  function fileName(format: PosterFormat) {
    const base = (headline || imageName.replace(/\.[^.]+$/, "") || "poster")
      .replace(/[\\/:*?"<>|]+/g, "")
      .slice(0, 40);
    return `${base}-${format === "story" ? "status" : "instagram"}.png`;
  }

  async function download(format: PosterFormat) {
    const canvas = canvases.current[format];
    if (!canvas) return;
    const blob = await canvasBlob(canvas);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName(format);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function share(format: PosterFormat) {
    const canvas = canvases.current[format];
    if (!canvas) return;
    const blob = await canvasBlob(canvas);
    if (!blob) return;
    const file = new File([blob], fileName(format), { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] }).catch(() => undefined);
    } else {
      await download(format);
    }
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption);
      setNotice("کپشن کپی شد.");
    } catch {
      setError("کپی انجام نشد؛ متن را دستی انتخاب و کپی کن.");
    }
  }

  return (
    <div className={styles.layout}>
      <section className={styles.panel}>
        <h3>۱. عکس محصول</h3>
        <label className={styles.upload}>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => chooseImage(event.target.files?.[0])}
          />
          <span>{imageName || "انتخاب عکس (JPG، PNG یا WEBP)"}</span>
        </label>

        <h3>۲. درباره این محصول بنویس</h3>
        <textarea
          className={styles.textarea}
          rows={4}
          value={description}
          maxLength={1500}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="مثلاً: پد یکبار مصرف فیزیوتراپی، بسته ۱۰۰ عددی، جاذب و نرم، مناسب کلینیک‌ها. قیمت ویژه این هفته ۴۵۰ هزار تومان."
        />
        <button className={styles.primary} type="button" onClick={writeWithAi} disabled={loading}>
          {loading ? "در حال نوشتن…" : "نوشتن متن پوستر با هوش مصنوعی"}
        </button>

        {error ? <p className={styles.error}>{error}</p> : null}
        {notice ? <p className={styles.notice}>{notice}</p> : null}

        <h3>۳. متن پوستر (قابل ویرایش)</h3>
        <label className={styles.field}>
          <span>تیتر</span>
          <input value={headline} maxLength={40} onChange={(event) => setHeadline(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span>زیرتیتر</span>
          <input value={subheadline} maxLength={80} onChange={(event) => setSubheadline(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span>ویژگی‌ها (هر خط یکی، حداکثر ۳)</span>
          <textarea rows={3} value={bulletsText} onChange={(event) => setBulletsText(event.target.value)} />
        </label>
        <label className={styles.field}>
          <span>دکمه / فراخوان</span>
          <input value={cta} maxLength={30} onChange={(event) => setCta(event.target.value)} />
        </label>
        <div className={styles.row}>
          <label className={styles.field}>
            <span>نام برند</span>
            <input value={brand} maxLength={30} onChange={(event) => setBrand(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>شماره تماس / آیدی (ذخیره می‌شود)</span>
            <input
              value={contact}
              maxLength={60}
              dir="auto"
              onChange={(event) => updateContact(event.target.value)}
              placeholder="مثلاً ۰۹۱۲۱۲۳۴۵۶۷"
            />
          </label>
        </div>

        <div className={styles.themes} role="radiogroup" aria-label="رنگ پوستر">
          {POSTER_THEMES.map((theme) => (
            <button
              key={theme.key}
              type="button"
              role="radio"
              aria-checked={themeKey === theme.key}
              className={`${styles.theme} ${themeKey === theme.key ? styles.themeActive : ""}`}
              style={{ background: `linear-gradient(135deg, ${theme.backgroundFrom}, ${theme.backgroundTo})`, color: theme.text }}
              onClick={() => setThemeKey(theme.key)}
            >
              {theme.label}
            </button>
          ))}
        </div>

        {caption ? (
          <>
            <h3>کپشن اینستاگرام</h3>
            <textarea className={styles.textarea} rows={5} value={caption} onChange={(event) => setCaption(event.target.value)} />
            <button className={styles.secondary} type="button" onClick={copyCaption}>
              کپی کپشن
            </button>
          </>
        ) : null}
      </section>

      <section className={styles.previews}>
        {FORMATS.map((format) => (
          <figure className={styles.preview} key={format}>
            <figcaption>{POSTER_SIZES[format].label}</figcaption>
            <canvas
              className={format === "story" ? styles.storyCanvas : styles.postCanvas}
              ref={(element) => {
                canvases.current[format] = element;
              }}
            />
            <div className={styles.previewActions}>
              <button className={styles.primary} type="button" onClick={() => download(format)}>
                دانلود
              </button>
              <button className={styles.secondary} type="button" onClick={() => share(format)}>
                اشتراک‌گذاری
              </button>
            </div>
          </figure>
        ))}
      </section>
    </div>
  );
}
