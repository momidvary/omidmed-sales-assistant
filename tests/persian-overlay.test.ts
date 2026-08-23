import assert from "node:assert/strict";
import test from "node:test";

import {
  overlayFontSize,
  overlaySafeMargin,
  sanitizeOverlayText,
  wrapRtlText,
} from "../src/lib/content-studio/persian-overlay";

test("overlay sanitizes control characters and bounds text length", () => {
  assert.equal(sanitizeOverlayText("  تیتر\n\u0000  فارسی  "), "تیتر فارسی");
  assert.equal(sanitizeOverlayText("الف".repeat(500), 180).length, 180);
});

test("RTL wrapping respects maximum line width and line count", () => {
  const lines = wrapRtlText(
    (value) => value.length * 10,
    "یک تیتر فارسی برای معرفی محصول پزشکی با متن طولانی",
    110,
    3,
  );
  assert.ok(lines.length >= 2 && lines.length <= 3);
  assert.ok(lines.every((line) => line.length <= 12));
});

test("truncated overlay text receives an ellipsis", () => {
  const lines = wrapRtlText(
    (value) => value.length * 10,
    "یک دو سه چهار پنج شش هفت هشت نه ده یازده دوازده",
    80,
    2,
  );
  assert.equal(lines.length, 2);
  assert.match(lines[1], /…$/);
});

test("overlay dimensions remain usable on small and large images", () => {
  assert.equal(overlaySafeMargin(360, 360), 24);
  assert.ok(overlaySafeMargin(2048, 2048) > 100);
  assert.equal(overlayFontSize(320, 0.055, 30, 92), 30);
  assert.equal(overlayFontSize(3000, 0.055, 30, 92), 92);
});
