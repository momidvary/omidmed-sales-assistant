// Draws a product poster on a canvas: the original photo, untouched, inside a
// card, with Persian copy laid out right-to-left underneath. Runs in the
// browser only.

export type PosterFormat = "story" | "post";

export type PosterTheme = {
  key: string;
  label: string;
  backgroundFrom: string;
  backgroundTo: string;
  text: string;
  mutedText: string;
  accent: string;
  accentText: string;
};

export const POSTER_THEMES: PosterTheme[] = [
  {
    key: "teal",
    label: "سبز امیدمِد",
    backgroundFrom: "#044f49",
    backgroundTo: "#0b8f80",
    text: "#ffffff",
    mutedText: "rgba(255,255,255,0.82)",
    accent: "#e2b15b",
    accentText: "#1f2a28",
  },
  {
    key: "navy",
    label: "آبی",
    backgroundFrom: "#123f5c",
    backgroundTo: "#2a7fab",
    text: "#ffffff",
    mutedText: "rgba(255,255,255,0.82)",
    accent: "#f2c14e",
    accentText: "#1b2530",
  },
  {
    key: "light",
    label: "روشن",
    backgroundFrom: "#f4efe4",
    backgroundTo: "#ffffff",
    text: "#123a36",
    mutedText: "#4f6b67",
    accent: "#087f73",
    accentText: "#ffffff",
  },
];

export const POSTER_SIZES: Record<PosterFormat, { width: number; height: number; label: string }> = {
  story: { width: 1080, height: 1920, label: "استاتوس واتساپ / استوری (۹:۱۶)" },
  post: { width: 1080, height: 1350, label: "پست اینستاگرام (۴:۵)" },
};

export type PosterContent = {
  brand: string;
  headline: string;
  subheadline: string;
  bullets: string[];
  cta: string;
  contact: string;
};

const FONT_FAMILY = '"Vazirmatn Variable", Vazirmatn, Tahoma, sans-serif';

export async function loadPosterFonts() {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all([
    document.fonts.load(`800 80px ${FONT_FAMILY}`),
    document.fonts.load(`500 40px ${FONT_FAMILY}`),
  ]).catch(() => undefined);
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
    current -= 4;
  }
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

type Block = { lines: string[]; size: number; weight: number; color: string; gapAfter: number };

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
  const margin = 90;
  const textWidth = width - margin * 2;

  ctx.direction = "rtl";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const background = ctx.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, theme.backgroundFrom);
  background.addColorStop(1, theme.backgroundTo);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  // Brand line.
  const brandY = story ? 150 : 100;
  if (content.brand.trim()) {
    ctx.font = font(800, story ? 46 : 40);
    ctx.fillStyle = theme.text;
    ctx.fillText(content.brand.trim(), width / 2, brandY);
  }

  // Bottom zone: CTA pill and contact line.
  const contactY = height - (story ? 110 : 60);
  const pillHeight = story ? 116 : 92;
  const pillTop = contactY - (story ? 90 : 70) - pillHeight;
  const bottomLimit = content.cta.trim() ? pillTop - (story ? 60 : 40) : contactY - 80;

  // Text blocks, measured first so the photo can take whatever height is left.
  const headline = content.headline.trim()
    ? fitText(ctx, content.headline, 900, story ? 96 : 76, story ? 64 : 52, textWidth, 2)
    : null;
  const subheadline = content.subheadline.trim()
    ? fitText(ctx, content.subheadline, 500, story ? 48 : 38, story ? 36 : 30, textWidth, 2)
    : null;
  const bullets = content.bullets
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, story ? 3 : 2);

  const blocks: Block[] = [];
  if (headline) blocks.push({ ...headline, weight: 900, color: theme.text, gapAfter: story ? 26 : 18 });
  if (subheadline) blocks.push({ ...subheadline, weight: 500, color: theme.mutedText, gapAfter: story ? 28 : 18 });
  for (const bullet of bullets) {
    const fitted = fitText(ctx, `• ${bullet}`, 600, story ? 42 : 34, story ? 32 : 28, textWidth, 1);
    blocks.push({ ...fitted, weight: 600, color: theme.text, gapAfter: story ? 12 : 8 });
  }
  const lineHeight = (size: number) => size * 1.4;
  const textHeight = blocks.reduce(
    (sum, block) => sum + block.lines.length * lineHeight(block.size) + block.gapAfter,
    0,
  );

  // Photo card fills the space between the brand line and the text.
  const cardTop = brandY + (story ? 70 : 50);
  const cardGap = story ? 70 : 45;
  const minCard = story ? 560 : 380;
  const cardHeight = Math.max(minCard, bottomLimit - textHeight - cardGap - cardTop);
  const cardWidth = width - margin * 2;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.22)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 16;
  ctx.fillStyle = "#ffffff";
  roundedRect(ctx, margin, cardTop, cardWidth, cardHeight, 44);
  ctx.fill();
  ctx.restore();

  if (image && image.naturalWidth && image.naturalHeight) {
    const padding = 34;
    const boxW = cardWidth - padding * 2;
    const boxH = cardHeight - padding * 2;
    const scale = Math.min(boxW / image.naturalWidth, boxH / image.naturalHeight);
    const drawW = image.naturalWidth * scale;
    const drawH = image.naturalHeight * scale;
    ctx.save();
    roundedRect(ctx, margin, cardTop, cardWidth, cardHeight, 44);
    ctx.clip();
    ctx.drawImage(
      image,
      margin + padding + (boxW - drawW) / 2,
      cardTop + padding + (boxH - drawH) / 2,
      drawW,
      drawH,
    );
    ctx.restore();
  } else {
    ctx.font = font(500, 40);
    ctx.fillStyle = "#8aa29e";
    ctx.fillText("عکس محصول اینجا قرار می‌گیرد", width / 2, cardTop + cardHeight / 2);
  }

  // Text under the photo.
  let cursor = cardTop + cardHeight + cardGap;
  for (const block of blocks) {
    ctx.font = font(block.weight, block.size);
    ctx.fillStyle = block.color;
    for (const line of block.lines) {
      cursor += lineHeight(block.size) * 0.8;
      ctx.fillText(line, width / 2, cursor);
      cursor += lineHeight(block.size) * 0.2;
    }
    cursor += block.gapAfter;
  }

  if (content.cta.trim()) {
    const cta = fitText(ctx, content.cta, 800, story ? 48 : 40, 30, textWidth - 120, 1);
    ctx.font = font(800, cta.size);
    const pillWidth = Math.min(textWidth, ctx.measureText(cta.lines[0] ?? "").width + 140);
    ctx.fillStyle = theme.accent;
    roundedRect(ctx, (width - pillWidth) / 2, pillTop, pillWidth, pillHeight, pillHeight / 2);
    ctx.fill();
    ctx.fillStyle = theme.accentText;
    ctx.textBaseline = "middle";
    ctx.fillText(cta.lines[0] ?? "", width / 2, pillTop + pillHeight / 2 + 2);
    ctx.textBaseline = "alphabetic";
  }

  if (content.contact.trim()) {
    const contact = fitText(ctx, content.contact, 600, story ? 38 : 32, 24, textWidth, 1);
    ctx.font = font(600, contact.size);
    ctx.fillStyle = theme.mutedText;
    ctx.fillText(contact.lines[0] ?? "", width / 2, contactY);
  }
}
