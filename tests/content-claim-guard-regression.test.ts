import assert from "node:assert/strict";
import test from "node:test";

import { removeUnsupportedMedicalClaims } from "../src/lib/content-studio/quality";

test("one approved regulated claim cannot authorise a different fabricated claim in the same sentence", () => {
  const approvedCe = "این دستگاه دارای گواهی CE برای کاربرد فیزیوتراپی است";
  const result = removeUnsupportedMedicalClaims(
    `${approvedCe} و درمان قطعی را تضمین می‌کند.`,
    {
      name: "محصول آزمایشی",
      approvedMarketingClaims: [approvedCe],
    },
  );
  assert.equal(result.text, "");
  assert.equal(result.removed.length, 1);
});

test("every explicit price in a sentence must match grounded Toman price", () => {
  const result = removeUnsupportedMedicalClaims(
    "قیمت ثبت‌شده ۵٬۰۰۰٬۰۰۰ تومان است و قیمت ویژه ۶٬۰۰۰٬۰۰۰ تومان است.",
    { name: "محصول آزمایشی", price: "5000000.00" },
  );
  assert.equal(result.text, "");
  assert.equal(result.removed.length, 1);
});

test("multiple equivalent Toman and Rial prices in the same sentence remain valid", () => {
  const result = removeUnsupportedMedicalClaims(
    "قیمت ۵٬۰۰۰٬۰۰۰ تومان، معادل ۵۰٬۰۰۰٬۰۰۰ ریال است.",
    { name: "محصول آزمایشی", price: "5000000.00" },
  );
  assert.equal(result.removed.length, 0);
});
