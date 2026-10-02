"use client";

import QRCode from "qrcode";
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
const STORAGE_KEYS = {
  phones: "omidmed.poster.phones",
  website: "omidmed.poster.website",
  logo: "omidmed.poster.logo",
  brand: "omidmed.poster.brand",
  tagline: "omidmed.poster.tagline",
};
const DEFAULTS = {
  brand: "امیدمِد",
  tagline: "لوازم مصرفی فیزیوتراپی",
  website: "omidmed.com",
};

function readStored(key: string, fallback = "") {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Storage can be blocked; the poster still works without remembering it.
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = reject;
    element.src = src;
  });
}

/**
 * Crops the plain white/transparent margin around a logo and scales it down,
 * so it fits the header badge and stays small enough for localStorage.
 */
function trimLogo(image: HTMLImageElement) {
  const scale = Math.min(1, 900 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return image.src;
  ctx.drawImage(image, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  let top = height;
  let bottom = -1;
  let left = width;
  let rightEdge = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const ink = data[i + 3] > 24 && (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235);
      if (ink) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > rightEdge) rightEdge = x;
      }
    }
  }
  if (bottom < 0) return canvas.toDataURL("image/png");
  const pad = Math.round(Math.max(rightEdge - left, bottom - top) * 0.03);
  const cropX = Math.max(0, left - pad);
  const cropY = Math.max(0, top - pad);
  const cropW = Math.min(width, rightEdge + pad + 1) - cropX;
  const cropH = Math.min(height, bottom + pad + 1) - cropY;
  const out = document.createElement("canvas");
  out.width = cropW;
  out.height = cropH;
  out.getContext("2d")?.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return out.toDataURL("image/png");
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
}

function normalizeLink(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export default function PosterStudio() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageName, setImageName] = useState("");
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [description, setDescription] = useState("");
  const [brand, setBrand] = useState(DEFAULTS.brand);
  const [tagline, setTagline] = useState(DEFAULTS.tagline);
  const [headline, setHeadline] = useState("");
  const [subheadline, setSubheadline] = useState("");
  const [bulletsText, setBulletsText] = useState("");
  const [cta, setCta] = useState("سفارش از طریق واتساپ");
  const [phonesText, setPhonesText] = useState("");
  const [website, setWebsite] = useState(DEFAULTS.website);
  const [buyLink, setBuyLink] = useState("");
  const [qr, setQr] = useState<HTMLCanvasElement | null>(null);
  const [caption, setCaption] = useState("");
  const [themeKey, setThemeKey] = useState(POSTER_THEMES[0].key);
  const [fontsReady, setFontsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canvases = useRef<Record<PosterFormat, HTMLCanvasElement | null>>({ story: null, post: null });

  useEffect(() => {
    // Restore saved brand settings once; localStorage is unavailable during
    // server render.
    /* eslint-disable react-hooks/set-state-in-effect */
    setPhonesText(readStored(STORAGE_KEYS.phones));
    setWebsite(readStored(STORAGE_KEYS.website, DEFAULTS.website));
    setBrand(readStored(STORAGE_KEYS.brand, DEFAULTS.brand));
    setTagline(readStored(STORAGE_KEYS.tagline, DEFAULTS.tagline));
    /* eslint-enable react-hooks/set-state-in-effect */
    const savedLogo = readStored(STORAGE_KEYS.logo);
    if (savedLogo) loadImage(savedLogo).then(setLogo, () => writeStored(STORAGE_KEYS.logo, ""));
    loadPosterFonts().finally(() => setFontsReady(true));
  }, []);

  const link = normalizeLink(buyLink);
  useEffect(() => {
    let cancelled = false;
    if (!link) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQr(null);
      return;
    }
    const canvas = document.createElement("canvas");
    QRCode.toCanvas(canvas, link, { margin: 0, width: 360, errorCorrectionLevel: "M", color: { dark: "#0f2b4cff", light: "#ffffffff" } })
      .then(() => {
        if (!cancelled) setQr(canvas);
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [link]);

  useEffect(() => {
    if (!fontsReady) return;
    const theme = POSTER_THEMES.find((item) => item.key === themeKey) ?? POSTER_THEMES[0];
    const content = {
      brand,
      tagline,
      logo,
      headline,
      subheadline,
      bullets: bulletsText.split("\n"),
      cta,
      phones: phonesText.split("\n"),
      website,
      qr,
    };
    for (const format of FORMATS) {
      const canvas = canvases.current[format];
      if (canvas) renderPoster(canvas, format, image, content, theme);
    }
  }, [fontsReady, image, logo, brand, tagline, headline, subheadline, bulletsText, cta, phonesText, website, qr, themeKey]);

  function remember(key: string, setter: (value: string) => void) {
    return (value: string) => {
      setter(value);
      writeStored(key, value);
    };
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
    loadImage(url).then(
      (element) => {
        setImage(element);
        setImageName(file.name);
      },
      () => {
        URL.revokeObjectURL(url);
        setError("این عکس باز نشد. عکس دیگری انتخاب کن.");
      },
    );
  }

  async function chooseLogo(file: File | undefined) {
    setError("");
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|svg\+xml)$/.test(file.type)) {
      setError("لوگو باید PNG، JPG، WEBP یا SVG باشد.");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const trimmed = trimLogo(await loadImage(url));
      const element = await loadImage(trimmed);
      setLogo(element);
      writeStored(STORAGE_KEYS.logo, trimmed);
      setNotice("لوگو ذخیره شد و دفعه بعد هم استفاده می‌شود.");
    } catch {
      setError("این لوگو باز نشد. فایل دیگری انتخاب کن.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function removeLogo() {
    setLogo(null);
    writeStored(STORAGE_KEYS.logo, "");
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
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName(format);
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function share(format: PosterFormat) {
    const canvas = canvases.current[format];
    if (!canvas) return;
    const blob = await canvasBlob(canvas);
    if (!blob) return;
    const file = new File([blob], fileName(format), { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: link || undefined }).catch(() => undefined);
    } else {
      await download(format);
    }
  }

  const fullCaption = [caption.trim(), link ? `🛒 خرید آنلاین: ${link}` : "", phonesText.trim() ? `📞 ${phonesText.trim().split("\n").join(" - ")}` : ""]
    .filter(Boolean)
    .join("\n\n");

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(fullCaption);
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
          {loading ? "در حال جست‌وجو و نوشتن… (تا ۴۰ ثانیه)" : "نوشتن متن پوستر با هوش مصنوعی"}
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
        <label className={styles.field}>
          <span>لینک خرید این محصول (اختیاری؛ روی پوستر QR کد می‌شود)</span>
          <input
            value={buyLink}
            dir="ltr"
            maxLength={300}
            onChange={(event) => setBuyLink(event.target.value)}
            placeholder="https://omidmed.com/product/..."
          />
        </label>

        <h3>۴. برند و تماس (ذخیره می‌شود)</h3>
        <div className={styles.logoRow}>
          <label className={styles.upload}>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(event) => chooseLogo(event.target.files?.[0])}
            />
            <span>{logo ? "تغییر لوگو" : "بارگذاری لوگو"}</span>
          </label>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className={styles.logoPreview} src={logo.src} alt="لوگوی برند" />
          ) : null}
          {logo ? (
            <button className={styles.secondary} type="button" onClick={removeLogo}>
              حذف
            </button>
          ) : null}
        </div>
        <div className={styles.row}>
          <label className={styles.field}>
            <span>نام برند</span>
            <input value={brand} maxLength={30} onChange={(event) => remember(STORAGE_KEYS.brand, setBrand)(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>شعار زیر نام</span>
            <input value={tagline} maxLength={40} onChange={(event) => remember(STORAGE_KEYS.tagline, setTagline)(event.target.value)} />
          </label>
        </div>
        <div className={styles.row}>
          <label className={styles.field}>
            <span>شماره‌های تماس (هر خط یکی، حداکثر ۳)</span>
            <textarea
              rows={3}
              dir="ltr"
              value={phonesText}
              onChange={(event) => remember(STORAGE_KEYS.phones, setPhonesText)(event.target.value)}
              placeholder={"09121234567\n021-12345678"}
            />
          </label>
          <label className={styles.field}>
            <span>آدرس سایت</span>
            <input
              value={website}
              dir="ltr"
              maxLength={60}
              onChange={(event) => remember(STORAGE_KEYS.website, setWebsite)(event.target.value)}
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
              style={{
                background: `linear-gradient(135deg, ${theme.background[0]}, ${theme.background[1]})`,
                color: theme.title,
              }}
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
            <p className={styles.hint}>موقع کپی، لینک خرید و شماره‌ها خودکار به آخر کپشن اضافه می‌شود.</p>
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
              className={styles.canvas}
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
