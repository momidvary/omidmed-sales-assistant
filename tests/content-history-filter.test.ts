import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("content history validates channel-specific content types", () => {
  const page = readFileSync("src/app/content-studio/page.tsx", "utf8");
  assert.match(page, /allowedContentTypes/);
  assert.match(page, /WHATSAPP_CONTENT_TYPES/);
  assert.match(page, /contentQuery = contentQuery\.eq\("content_type", params\.content_type\)/);
});

test("content history date range is applied server-side using Tehran boundaries", () => {
  const page = readFileSync("src/app/content-studio/page.tsx", "utf8");
  assert.match(page, /tehranDateRange\(params\.date_from, params\.date_to\)/);
  assert.match(page, /\.gte\("created_at", historyRange\.start\.toISOString\(\)\)/);
  assert.match(page, /\.lt\("created_at", historyRange\.endExclusive\.toISOString\(\)\)/);
  assert.match(page, /name="date_from"/);
  assert.match(page, /name="date_to"/);
});
