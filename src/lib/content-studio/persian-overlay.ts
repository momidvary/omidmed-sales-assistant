export type OverlayTextBlock = {
  text: string;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700 | 800;
  maxWidthRatio: number;
  maxLines: number;
};

export function sanitizeOverlayText(value: string, maxLength = 300) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function wrapRtlText(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
) {
  const clean = sanitizeOverlayText(text);
  if (!clean || maxWidth <= 0 || maxLines <= 0) return [];

  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }

  if (lines.length < maxLines && current) lines.push(current);

  const consumed = lines.join(" ").split(" ").length;
  if (consumed < words.length && lines.length) {
    const lastIndex = lines.length - 1;
    let last = lines[lastIndex];
    while (last && measure(`${last}…`) > maxWidth) {
      const parts = last.split(" ");
      parts.pop();
      last = parts.join(" ");
    }
    lines[lastIndex] = `${last || lines[lastIndex].slice(0, 1)}…`;
  }

  return lines;
}

export function overlaySafeMargin(width: number, height: number) {
  return Math.max(24, Math.round(Math.min(width, height) * 0.055));
}

export function overlayFontSize(width: number, ratio: number, min = 24, max = 96) {
  return Math.max(min, Math.min(max, Math.round(width * ratio)));
}
