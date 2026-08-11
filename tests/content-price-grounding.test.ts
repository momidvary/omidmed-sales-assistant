import assert from "node:assert/strict";
import test from "node:test";

import { removeUnsupportedMedicalClaims } from "../src/lib/content-studio/quality";

test("Supabase numeric strings with .00 match the same integer Toman claim", () => {
  const result = removeUnsupportedMedicalClaims(
    "قیمت این دستگاه ۵٬۰۰۰٬۰۰۰ تومان است.",
    { name: "محصول آزمایشی", price: "5000000.00" },
  );
  assert.equal(result.removed.length, 0);
  assert.match(result.text, /۵٬۰۰۰٬۰۰۰ تومان/);
});

test("decimal million price claims are compared exactly", () => {
  const supported = removeUnsupportedMedicalClaims(
    "قیمت این دستگاه ۵.۵ میلیون تومان است.",
    { name: "محصول آزمایشی", price: "5500000.00" },
  );
  assert.equal(supported.removed.length, 0);

  const fabricated = removeUnsupportedMedicalClaims(
    "قیمت این دستگاه ۵.۵ میلیون تومان است.",
    { name: "محصول آزمایشی", price: "5000000.00" },
  );
  assert.equal(fabricated.text, "");
  assert.equal(fabricated.removed.length, 1);
});

test("non-zero fractional Toman grounding is rejected instead of mis-scaled", () => {
  const result = removeUnsupportedMedicalClaims(
    "قیمت این دستگاه ۵٬۰۰۰٬۰۰۰ تومان است.",
    { name: "محصول آزمایشی", price: "5000000.50" },
  );
  assert.equal(result.text, "");
  assert.equal(result.removed.length, 1);
});
