import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGroundedBrief,
  removeUnsupportedMedicalClaims,
} from "../src/lib/content-studio/quality";

const customer = {
  name: "مشتری آزمایشی",
  city: "تهران",
  customerType: "customer",
  crmStage: "active",
  lastPurchase: "2026-08-01",
  purchasedProducts: ["محصول الف"],
  interests: ["محصول ب"],
  lastContact: "2026-08-10 · تماس موفق",
  opportunity: "فرصت محرمانه",
  quote: "پیش‌فاکتور محرمانه",
  actualSales: 987654321,
  balanceAmount: 123456789,
  balanceStatus: "debtor",
  commercialPriority: "vip",
  urgency: "due_soon",
};

test("educational content omits unnecessary customer financial data", () => {
  const brief = buildGroundedBrief({
    topic: "آموزش استفاده صحیح",
    goal: "educational",
    audience: "physiotherapist",
    contentType: "educational",
    tone: "professional",
    customer,
  });
  assert.match(brief, /مشتری آزمایشی/);
  assert.match(brief, /محصول الف/);
  assert.doesNotMatch(brief, /987654321/);
  assert.doesNotMatch(brief, /123456789/);
  assert.doesNotMatch(brief, /فرصت محرمانه/);
  assert.doesNotMatch(brief, /پیش‌فاکتور محرمانه/);
});

test("quote follow-up includes the financial context needed for personalization", () => {
  const brief = buildGroundedBrief({
    topic: "پیگیری پیش‌فاکتور",
    goal: "quote_follow_up",
    audience: "clinic_manager",
    contentType: "whatsapp_quote_follow_up",
    tone: "professional",
    customer,
  });
  assert.match(brief, /987654321/);
  assert.match(brief, /123456789/);
  assert.match(brief, /فرصت محرمانه/);
  assert.match(brief, /پیش‌فاکتور محرمانه/);
});

test("contradictory inventory statements are rejected", () => {
  for (const status of ["in_stock", "low_stock", "out_of_stock", "made_to_order"]) {
    const result = removeUnsupportedMedicalClaims(
      "این محصول موجود است و هم‌زمان ناموجود است.",
      { name: "محصول آزمایشی", inventoryStatus: status },
    );
    assert.equal(result.text, "", status);
    assert.equal(result.removed.length, 1, status);
  }
});

test("specific verified inventory wording remains available", () => {
  const inStock = removeUnsupportedMedicalClaims("موجودی کافی است و محصول در انبار است.", {
    name: "محصول آزمایشی",
    inventoryStatus: "in_stock",
  });
  assert.equal(inStock.removed.length, 0);

  const lowStock = removeUnsupportedMedicalClaims("موجودی محدود و رو به اتمام است.", {
    name: "محصول آزمایشی",
    inventoryStatus: "low_stock",
  });
  assert.equal(lowStock.removed.length, 0);

  const madeToOrder = removeUnsupportedMedicalClaims("این محصول سفارشی است.", {
    name: "محصول آزمایشی",
    inventoryStatus: "made_to_order",
  });
  assert.equal(madeToOrder.removed.length, 0);
});
