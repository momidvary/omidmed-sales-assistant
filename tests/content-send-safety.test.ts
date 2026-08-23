import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("WhatsApp send accepts only persisted content and re-runs grounding guard", () => {
  const route = readFileSync("src/app/api/whatsapp/send/route.ts", "utf8");

  assert.match(route, /isStoredWhatsAppPayload/);
  assert.match(route, /savedTexts\.includes\(messageText\)/);
  assert.match(route, /CONTENT_NOT_SAVED/);
  assert.match(route, /removeUnsupportedMedicalClaims\(messageText, product\)/);
  assert.match(route, /UNSUPPORTED_CONTENT_CLAIM/);
  assert.match(route, /\.eq\("created_by", user\.id\)/);
  assert.match(route, /\.eq\("owner_id", user\.id\)/);
});

test("manual content revision is guarded before a new version is saved", () => {
  const route = readFileSync("src/app/api/content-studio/items/[id]/route.ts", "utf8");

  assert.match(route, /hasUnsupportedContent\(caption, product\)/);
  assert.match(route, /isStoredWhatsAppPayload\(body\.channelPayload\)/);
  assert.match(route, /INCONSISTENT_WHATSAPP_CONTENT/);
  assert.match(route, /save_content_revision/);
});

test("WhatsApp UI invalidates confirmation after content or delivery choices change", () => {
  const component = readFileSync("src/app/content-studio/whatsapp-content-card.tsx", "utf8");

  assert.match(component, /const \[dirty, setDirty\]/);
  assert.match(component, /setFinalConfirmed\(false\)/);
  assert.match(component, /disabled=\{dirty\}/);
  assert.match(component, /dirty \|\| !cloudSendAvailable/);
  assert.match(component, /ابتدا نسخه جدید را ذخیره/);
});
