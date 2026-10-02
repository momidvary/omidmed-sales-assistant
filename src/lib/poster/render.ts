// Draws a product poster on a canvas: the original photo, untouched, inside a
// card, with the brand header, Persian copy, feature chips, a call to action
// and contact numbers laid out right-to-left. Runs in the browser only.
//
// Visual language follows current medical-supply marketing: airy mint/white
// or deep clinical backgrounds, soft blurred shapes, a subtle "+" pattern,
// a floating product card, right-aligned bold type and pill chips.

export type PosterFormat = "story" | "post";

export type PosterTheme = {
  key: string;
  label: string;
  background: [string, string];
  blobA: string;
  blobB: string;
  pattern: string;
  title: string;
  body: string;
  chipBg: string;
  chipText: string;
  check: string;
  accent: string;
  accentText: string;
  cardShadow: string;
  cardBack: string;
};

// Colours follow the Omidmed logo: navy #0f2b4c and leaf green #3d9a46.
export const POSTER_THEMES: PosterTheme[] = [
  {
    key: "light",
    label: "سفید و سرمه‌ای",
    background: ["#f6fafd", "#e6f2ec"],
    blobA: "rgba(61, 154, 70, 0.18)",
    blobB: "rgba(29, 92, 160, 0.14)",
    pattern: "rgba(15, 43, 76, 0.09)",
    title: "#0f2b4c",
    body: "#4a5f78",
    chipBg: "#ffffff",
    chipText: "#0f2b4c",
    check: "#3d9a46",
    accent: "#0f2b4c",
    accentText: "#ffffff",
    cardShadow: "rgba(15, 43, 76, 0.16)",
    cardBack: "rgba(61, 154, 70, 0.16)",
  },
  {
    key: "navy",
    label: "سرمه‌ای",
    background: ["#0b2240", "#1b4b78"],
    blobA: "rgba(92, 196, 104, 0.22)",
    blobB: "rgba(90, 170, 255, 0.16)",
    pattern: "rgba(255, 255, 255, 0.07)",
    title: "#ffffff",
    body: "rgba(226, 238, 255, 0.86)",
    chipBg: "rgba(255, 255, 255, 0.13)",
    chipText: "#ffffff",
    check: "#5cc468",
    accent: "#3d9a46",
    accentText: "#ffffff",
    cardShadow: "rgba(0, 0, 0, 0.34)",
    cardBack: "rgba(92, 196, 104, 0.20)",
  },
  {
    key: "green",
    label: "سبز طبیعی",
    background: ["#215f2b", "#3d9a46"],
    blobA: "rgba(255, 255, 255, 0.16)",
    blobB: "rgba(15, 43, 76, 0.22)",
    pattern: "rgba(255, 255, 255, 0.09)",
    title: "#ffffff",
    body: "rgba(240, 255, 241, 0.88)",
    chipBg: "rgba(255, 255, 255, 0.16)",
    chipText: "#ffffff",
    check: "#0f2b4c",
    accent: "#0f2b4c",
    accentText: "#ffffff",
    cardShadow: "rgba(0, 0, 0, 0.28)",
    cardBack: "rgba(255, 255, 255, 0.20)",
  },
];

export const POSTER_SIZES: Record<PosterFormat, { width: number; height: number; label: string }> = {
  story: { width: 1080, height: 1920, label: "استاتوس واتساپ / استوری (۹:۱۶)" },
  post: { width: 1080, height: 1350, label: "پست اینستاگرام (۴:۵)" },
};

export type PosterContent = {
  brand: string;
  tagline: string;
  logo: HTMLImageElement | null;
  headline: string;
  subheadline: string;
  bullets: string[];
  cta: string;
  phones: string[];
  website: string;
  /** Pre-rendered QR code for the purchase link, or null. */
  qr: HTMLCanvasElement | null;
};

const FONT_FAMILY = '"Vazirmatn Variable", Vazirmatn, Tahoma, sans-serif';
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export async function loadPosterFonts() {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all([
    document.fonts.load(`900 80px ${FONT_FAMILY}`),
    document.fonts.load(`600 40px ${FONT_FAMILY}`),
    document.fonts.load(`400 40px ${FONT_FAMILY}`),
  ]).catch(() => undefined);
}

export function toPersianDigits(value: string) {
  return value.replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

function font(weight: number, size: number) {
  return `${weight} ${Math.round(size)}px ${FONT_FAMILY}`;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest size (down to minSize) at which text fits in maxLines lines. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  size: number,
  minSize: number,
  maxWidth: number,
  maxLines: number,
) {
  let current = size;
  for (;;) {
    ctx.font = font(weight, current);
    const lines = wrapLines(ctx, text, maxWidth);
    if (lines.length <= maxLines || current <= minSize) {
      return { size: current, lines: lines.slice(0, maxLines) };
    }
    current -= 3;
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function plusPattern(ctx: CanvasRenderingContext2D, x: number, y: number, cols: number, rows: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cx = x + col * 46;
      const cy = y + row * 46;
      ctx.beginPath();
      ctx.moveTo(cx - 8, cy);
      ctx.lineTo(cx + 8, cy);
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx, cy + 8);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function checkIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = radius * 0.28;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - radius * 0.45, cy + radius * 0.02);
  ctx.lineTo(cx - radius * 0.1, cy + radius * 0.36);
  ctx.lineTo(cx + radius * 0.48, cy - radius * 0.32);
  ctx.stroke();
  ctx.restore();
}

function phoneIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(
    new Path2D(
      "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.92Z",
    ),
  );
  ctx.restore();
}

type Chip = { text: string; width: number };

function layoutChips(
  ctx: CanvasRenderingContext2D,
  items: string[],
  fontSize: number,
  maxWidth: number,
) {
  ctx.font = font(700, fontSize);
  const paddingX = fontSize * 0.7;
  const icon = fontSize * 0.9;
  const gap = fontSize * 0.45;
  const chips: Chip[] = items.map((text) => ({
    text,
    width: Math.min(maxWidth, ctx.measureText(text).width + paddingX * 2 + icon + gap),
  }));
  const rows: Chip[][] = [];
  let row: Chip[] = [];
  let rowWidth = 0;
  for (const chip of chips) {
    const next = rowWidth + (row.length ? fontSize * 0.5 : 0) + chip.width;
    if (row.length && next > maxWidth) {
      rows.push(row);
      row = [chip];
      rowWidth = chip.width;
    } else {
      row.push(chip);
      rowWidth = next;
    }
  }
  if (row.length) rows.push(row);
  return { rows, height: fontSize * 1.9, paddingX, icon, gap };
}

function drawContained(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight);
  const drawW = image.naturalWidth * scale;
  const drawH = image.naturalHeight * scale;
  ctx.drawImage(image, x + (w - drawW) / 2, y + (h - drawH) / 2, drawW, drawH);
  return { drawW, drawH };
}

export function renderPoster(
  canvas: HTMLCanvasElement,
  format: PosterFormat,
  image: HTMLImageElement | null,
  content: PosterContent,
  theme: PosterTheme,
) {
  const { width, height } = POSTER_SIZES[format];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const story = format === "story";
  const k = story ? 1 : 0.84;
  const margin = 84;
  const right = width - margin;
  const innerWidth = width - margin * 2;

  ctx.direction = "rtl";
  ctx.textBaseline = "alphabetic";

  // Background, soft blurred shapes and a faint medical "+" grid.
  const background = ctx.createLinearGradient(0, 0, width * 0.4, height);
  background.addColorStop(0, theme.background[0]);
  background.addColorStop(1, theme.background[1]);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  blob(ctx, width * 0.95, height * 0.08, width * 0.62, theme.blobA);
  blob(ctx, width * 0.02, height * 0.62, width * 0.7, theme.blobB);

  // Header: Persian brand and tagline on the right, logo in a white badge
  // on the left (the logo artwork has its own white background).
  const headerTop = story ? 78 : 56;
  const headerHeight = 132 * k;
  if (content.logo && content.logo.naturalWidth) {
    const badgeH = headerHeight;
    const innerH = badgeH - 36 * k;
    const logoW = Math.min(360 * k, (content.logo.naturalWidth / content.logo.naturalHeight) * innerH);
    const badgeW = logoW + 48 * k;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.10)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#ffffff";
    roundedRect(ctx, margin, headerTop, badgeW, badgeH, 30 * k);
    ctx.fill();
    ctx.restore();
    drawContained(ctx, content.logo, margin + 24 * k, headerTop + 18 * k, logoW, innerH);
  }
  const brand = content.brand.trim();
  const tagline = content.tagline.trim();
  ctx.textAlign = "right";
  if (brand) {
    ctx.font = font(900, 54 * k);
    ctx.fillStyle = theme.title;
    ctx.fillText(brand, right, headerTop + (tagline ? 62 : 84) * k);
  }
  if (tagline) {
    ctx.font = font(600, 32 * k);
    ctx.fillStyle = theme.check;
    ctx.fillText(tagline, right, headerTop + (brand ? 112 : 80) * k);
  }
  const headerBottom = headerTop + headerHeight;
  // Faint "+" grid between the logo badge and the brand name.
  plusPattern(ctx, width * 0.36, headerTop + 30 * k, 4, 2, theme.pattern);

  // Bottom-up: contact footer (numbers, website, optional QR), call to
  // action, then the text block.
  const phones = content.phones.map((value) => toPersianDigits(value.trim())).filter(Boolean).slice(0, 3);
  const website = content.website.trim();
  const qrSize = content.qr ? 196 * k : 0;
  const footerTextWidth = innerWidth - (qrSize ? qrSize + 40 * k : 0);
  const phoneSize = 38 * k;
  ctx.font = font(700, phoneSize);
  const joined = phones.join("   •   ");
  const phoneLines = phones.length
    ? ctx.measureText(joined).width + 70 < footerTextWidth
      ? [joined]
      : phones
    : [];
  const lineStep = phoneSize * 1.55;
  const textLinesHeight = (phoneLines.length + (website ? 1 : 0)) * lineStep;
  const qrBlockHeight = qrSize ? qrSize + 46 * k : 0;
  const footerHeight = Math.max(textLinesHeight, qrBlockHeight);
  const footerTop = height - (story ? 70 : 44) - footerHeight;

  const ctaHeight = 118 * k;
  const ctaTop = content.cta.trim()
    ? footerTop - (footerHeight ? 36 * k : 0) - ctaHeight
    : footerTop;

  const headline = content.headline.trim()
    ? fitText(ctx, content.headline, 900, 94 * k, 60 * k, innerWidth, 2)
    : null;
  const subheadline = content.subheadline.trim()
    ? fitText(ctx, content.subheadline, 500, 46 * k, 34 * k, innerWidth, 2)
    : null;
  const bullets = content.bullets.map((item) => item.trim()).filter(Boolean).slice(0, 3);
  const chips = bullets.length ? layoutChips(ctx, bullets, 34 * k, innerWidth) : null;

  const headlineLine = headline ? headline.size * 1.28 : 0;
  const subLine = subheadline ? subheadline.size * 1.5 : 0;
  const blockGap = 22 * k;
  const textHeight =
    (headline ? headline.lines.length * headlineLine + blockGap : 0) +
    (subheadline ? subheadline.lines.length * subLine + blockGap : 0) +
    (chips ? chips.rows.length * (chips.height + 14 * k) + blockGap : 0);

  // Product card takes the remaining height.
  const cardTop = headerBottom + (story ? 58 : 36);
  const cardGap = story ? 56 : 34;
  const cardHeight = Math.max(story ? 560 : 340, ctaTop - cardGap - textHeight - cardTop);
  const cardX = margin;
  const cardW = innerWidth;

  ctx.save();
  ctx.fillStyle = theme.cardBack;
  roundedRect(ctx, cardX + 26, cardTop + 26, cardW, cardHeight, 56);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.shadowColor = theme.cardShadow;
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  ctx.fillStyle = "#ffffff";
  roundedRect(ctx, cardX, cardTop, cardW, cardHeight, 56);
  ctx.fill();
  ctx.restore();

  if (image && image.naturalWidth && image.naturalHeight) {
    const padding = 40 * k;
    ctx.save();
    roundedRect(ctx, cardX, cardTop, cardW, cardHeight, 56);
    ctx.clip();
    drawContained(ctx, image, cardX + padding, cardTop + padding, cardW - padding * 2, cardHeight - padding * 2);
    ctx.restore();
  } else {
    ctx.textAlign = "center";
    ctx.font = font(500, 40 * k);
    ctx.fillStyle = "#8aa29e";
    ctx.fillText("عکس محصول اینجا قرار می‌گیرد", width / 2, cardTop + cardHeight / 2);
  }

  // Copy, right-aligned under the card.
  let cursor = cardTop + cardHeight + cardGap;
  ctx.textAlign = "right";
  if (headline) {
    ctx.font = font(900, headline.size);
    ctx.fillStyle = theme.title;
    for (const line of headline.lines) {
      cursor += headlineLine;
      ctx.fillText(line, right, cursor - headlineLine * 0.24);
    }
    cursor += blockGap;
  }
  if (subheadline) {
    ctx.font = font(500, subheadline.size);
    ctx.fillStyle = theme.body;
    for (const line of subheadline.lines) {
      cursor += subLine;
      ctx.fillText(line, right, cursor - subLine * 0.3);
    }
    cursor += blockGap;
  }
  if (chips) {
    for (const row of chips.rows) {
      let x = right;
      for (const chip of row) {
        ctx.save();
        ctx.fillStyle = theme.chipBg;
        ctx.shadowColor = "rgba(0,0,0,0.06)";
        ctx.shadowBlur = 16;
        ctx.shadowOffsetY = 6;
        roundedRect(ctx, x - chip.width, cursor, chip.width, chips.height, chips.height / 2);
        ctx.fill();
        ctx.restore();
        const iconCx = x - chips.paddingX - chips.icon / 2;
        checkIcon(ctx, iconCx, cursor + chips.height / 2, chips.icon / 2, theme.check);
        ctx.font = font(700, 34 * k);
        ctx.fillStyle = theme.chipText;
        ctx.textBaseline = "middle";
        ctx.fillText(chip.text, iconCx - chips.icon / 2 - chips.gap, cursor + chips.height / 2 + 2);
        ctx.textBaseline = "alphabetic";
        x -= chip.width + 34 * k * 0.5;
      }
      cursor += chips.height + 14 * k;
    }
  }

  // Call to action: full-width pill.
  if (content.cta.trim()) {
    const cta = fitText(ctx, content.cta, 800, 46 * k, 30, innerWidth - 120, 1);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.16)";
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = theme.accent;
    roundedRect(ctx, margin, ctaTop, innerWidth, ctaHeight, ctaHeight / 2);
    ctx.fill();
    ctx.restore();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = font(800, cta.size);
    ctx.fillStyle = theme.accentText;
    ctx.fillText(`${cta.lines[0] ?? ""}  ←`, width / 2, ctaTop + ctaHeight / 2 + 2);
    ctx.textBaseline = "alphabetic";
  }

  // Contact footer.
  if (qrSize && content.qr) {
    const qrX = margin;
    const qrY = footerTop + (footerHeight - qrBlockHeight) / 2;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.10)";
    ctx.shadowBlur = 18;
    roundedRect(ctx, qrX, qrY, qrSize, qrSize, 22 * k);
    ctx.fill();
    ctx.restore();
    const pad = 14 * k;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(content.qr, qrX + pad, qrY + pad, qrSize - pad * 2, qrSize - pad * 2);
    ctx.imageSmoothingEnabled = true;
    ctx.textAlign = "center";
    ctx.font = font(700, 26 * k);
    ctx.fillStyle = theme.title;
    ctx.fillText("اسکن برای خرید", qrX + qrSize / 2, qrY + qrSize + 36 * k);
  }

  if (phoneLines.length || website) {
    const lines: Array<{ text: string; kind: "phone" | "web" }> = [
      ...phoneLines.map((text) => ({ text, kind: "phone" as const })),
      ...(website ? [{ text: website, kind: "web" as const }] : []),
    ];
    const centerX = qrSize ? right - footerTextWidth / 2 : width / 2;
    let y = footerTop + (footerHeight - lines.length * lineStep) / 2 + lineStep / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const line of lines) {
      ctx.font = font(line.kind === "web" ? 800 : 700, line.kind === "web" ? phoneSize * 0.95 : phoneSize);
      ctx.fillStyle = line.kind === "web" ? theme.check : theme.title;
      if (line.kind === "web") ctx.direction = "ltr";
      const lineWidth = ctx.measureText(line.text).width;
      ctx.fillText(line.text, centerX - (line.kind === "phone" ? 26 * k : 0), y);
      ctx.direction = "rtl";
      if (line.kind === "phone") {
        phoneIcon(ctx, centerX + lineWidth / 2 + 6 * k, y, phoneSize * 0.9, theme.check);
      }
      y += lineStep;
    }
    ctx.textBaseline = "alphabetic";
  }
}
