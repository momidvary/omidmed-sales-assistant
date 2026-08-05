import assert from "node:assert/strict";
import test from "node:test";

import {
  parseMeliPayamakProviderJson,
  parseMeliPayamakSendResults,
} from "../src/lib/sms/melipayamak.ts";
import {
  parseMeliPayamakDeliveryResults,
} from "../src/lib/sms/melipayamak-delivery.ts";

test("preserves 19-digit provider receipt ids without numeric rounding", () => {
  const response = parseMeliPayamakProviderJson(
    '{"recIds":[9223372036854775801,9223372036854775802],"status":"عملیات موفق"}',
  );

  assert.deepEqual(response.recIds, [
    "9223372036854775801",
    "9223372036854775802",
  ]);
});

test("respects a documented per-recipient rejection despite a recId", () => {
  const [result] = parseMeliPayamakSendResults(
    { to: ["09120000000"], text: ["test"] },
    {
      recIds: ["123456789"],
      success: [false],
      status: "عملیات موفق",
    },
  );

  assert.equal(result.success, false);
  assert.equal(result.recId, "123456789");
  assert.match(result.status, /بلک‌لیست|خط فرستنده/);
});

test("accepts a recipient when success[] is true", () => {
  const [result] = parseMeliPayamakSendResults(
    { to: ["09120000000"], text: ["test"] },
    {
      recIds: ["123456789"],
      success: [true],
      status: "عملیات موفق",
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.recId, "123456789");
});

test("rejects missing and non-positive provider receipt ids", () => {
  const results = parseMeliPayamakSendResults(
    {
      to: ["09120000000", "09120000001", "09120000002"],
      text: ["one", "two", "three"],
    },
    {
      recIds: [null, 0, -1],
      status: "عملیات موفق",
    },
  );

  assert.deepEqual(
    results.map(({ success, recId }) => ({ success, recId })),
    [
      { success: false, recId: null },
      { success: false, recId: null },
      { success: false, recId: null },
    ],
  );
});

test("does not invent delivery states when provider returns fewer results", () => {
  const results = parseMeliPayamakDeliveryResults(
    ["111", "222", "333"],
    {
      results: ["ارسال شده"],
      resultsAsCode: [-1],
      status: "عملیات موفق",
    },
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].recId, "111");
  assert.equal(results[0].deliveryStatus, "delivered");
});

test("keeps provider report errors unknown instead of marking them accepted", () => {
  const [result] = parseMeliPayamakDeliveryResults(["111"], {
    results: ["بروز خطا در دریافت گزارش تحویل"],
    resultsAsCode: [-10],
    status: "عملیات موفق",
  });

  assert.equal(result.deliveryStatus, "unknown");
});
