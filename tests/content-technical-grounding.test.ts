import assert from "node:assert/strict";
import test from "node:test";

import { removeUnsupportedMedicalClaims } from "../src/lib/content-studio/quality";

const groundedProduct = {
  name: "محصول آزمایشی",
  technicalSpecifications: {
    frequency: "2 MHz",
    power: "500 W",
    voltage: "220 V",
  },
};

test("verified technical measurement passes in English form", () => {
  const result = removeUnsupportedMedicalClaims(
    "فرکانس کاری دستگاه 2 MHz است.",
    groundedProduct,
  );
  assert.equal(result.removed.length, 0);
});

test("Persian digits and unit wording match the same verified measurement", () => {
  const frequency = removeUnsupportedMedicalClaims(
    "فرکانس کاری دستگاه ۲ مگاهرتز است.",
    groundedProduct,
  );
  assert.equal(frequency.removed.length, 0);

  const power = removeUnsupportedMedicalClaims(
    "توان دستگاه ۵۰۰ وات است.",
    groundedProduct,
  );
  assert.equal(power.removed.length, 0);
});

test("fabricated numeric technical measurement is removed", () => {
  const result = removeUnsupportedMedicalClaims(
    "فرکانس کاری دستگاه 3 MHz است.",
    groundedProduct,
  );
  assert.equal(result.text, "");
  assert.equal(result.removed.length, 1);
});

test("numeric technical claim without verified specifications is removed", () => {
  const result = removeUnsupportedMedicalClaims(
    "توان دستگاه ۵۰۰ وات است.",
    { name: "محصول آزمایشی" },
  );
  assert.equal(result.text, "");
  assert.equal(result.removed.length, 1);
});

test("every technical measurement in the sentence must be grounded", () => {
  const valid = removeUnsupportedMedicalClaims(
    "فرکانس ۲ مگاهرتز و توان ۵۰۰ وات است.",
    groundedProduct,
  );
  assert.equal(valid.removed.length, 0);

  const invalid = removeUnsupportedMedicalClaims(
    "فرکانس ۲ مگاهرتز و توان ۶۰۰ وات است.",
    groundedProduct,
  );
  assert.equal(invalid.text, "");
  assert.equal(invalid.removed.length, 1);
});

test("ungrounded percentage measurement is not allowed", () => {
  const result = removeUnsupportedMedicalClaims(
    "بازده دستگاه ۹۵ درصد است.",
    groundedProduct,
  );
  assert.equal(result.text, "");
  assert.equal(result.removed.length, 1);
});
