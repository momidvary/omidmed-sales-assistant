import assert from "node:assert/strict";
import test from "node:test";

import { parseInstagramContent } from "../src/lib/content-studio/generation";

function payload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: "نمونه",
    caption: "متن امن برای معرفی محصول.",
    on_image_text: "انتخاب حرفه‌ای برای کلینیک",
    call_to_action: "برای اطلاعات بیشتر تماس بگیرید.",
    hashtags: ["#فیزیوتراپی"],
    image_prompt: "clean clinical product scene",
    ...overrides,
  });
}

test("Instagram parser removes unsupported medical claims from on-image text", () => {
  const parsed = parseInstagramContent(
    payload({ on_image_text: "تأیید FDA دارد و درمان قطعی را تضمین می‌کند." }),
  );
  assert.equal(parsed.on_image_text, null);
});

test("Instagram parser removes ungrounded price and inventory claims from CTA", () => {
  const parsed = parseInstagramContent(
    payload({ call_to_action: "فقط امروز ۱۲ میلیون تومان و آماده ارسال در انبار است." }),
  );
  assert.equal(parsed.call_to_action, null);
});

test("Instagram parser preserves safe high-visibility copy", () => {
  const parsed = parseInstagramContent(payload());
  assert.equal(parsed.on_image_text, "انتخاب حرفه‌ای برای کلینیک");
  assert.equal(parsed.call_to_action, "برای اطلاعات بیشتر تماس بگیرید.");
});
