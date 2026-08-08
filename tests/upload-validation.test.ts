import assert from "node:assert/strict";
import test from "node:test";

import {
  detectMedicalDocumentMime,
  safeOriginalFilename,
} from "../src/lib/uploads/medical-document";

test("upload validation identifies real PNG, JPEG and PDF signatures", () => {
  assert.equal(
    detectMedicalDocumentMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png",
  );
  assert.equal(detectMedicalDocumentMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(detectMedicalDocumentMime(new TextEncoder().encode("%PDF-1.7")), "application/pdf");
  assert.equal(detectMedicalDocumentMime(new TextEncoder().encode("<script>")), null);
});

test("uploaded filenames cannot preserve paths or control characters", () => {
  assert.equal(safeOriginalFilename("..\\private/evil\u0000<script>.pdf"), "evil_script_.pdf");
  assert.ok(safeOriginalFilename("a".repeat(300)).length <= 180);
});
