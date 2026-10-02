import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { autoOrderSmsEnabled, sendAutoOrderSms } from "../src/lib/sms/auto-order";

type Row = Record<string, unknown>;

/** In-memory stand-in for the few PostgREST calls the auto SMS makes. */
function fakeAdmin(tables: Record<string, Row[]>) {
  function builder(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let mode: "select" | "update" | "insert" = "select";
    let patch: Row = {};
    let inserted: Row | null = null;
    let limit = Infinity;
    const api = {
      select: () => api,
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), api),
      is: (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), api),
      gte: (column: string, value: string) => (filters.push((row) => String(row[column] ?? "") >= value), api),
      gt: (column: string, value: number) => (filters.push((row) => Number(row[column]) > value), api),
      not: (column: string) => (filters.push((row) => row[column] != null), api),
      or: () => api,
      order: () => api,
      limit: (value: number) => ((limit = value), api),
      update: (values: Row) => ((mode = "update"), (patch = values), api),
      insert: (values: Row) => {
        mode = "insert";
        inserted = values;
        return api;
      },
      run() {
        const rows = tables[table] ?? (tables[table] = []);
        if (mode === "insert" && inserted) {
          const duplicate = rows.some(
            (row) => row.client_request_id && row.client_request_id === inserted!.client_request_id,
          );
          if (duplicate) return { data: null, error: { message: "duplicate" } };
          const row = { id: `msg-${rows.length + 1}`, ...inserted };
          rows.push(row);
          return { data: [row], error: null };
        }
        const matched = rows.filter((row) => filters.every((filter) => filter(row))).slice(0, limit);
        if (mode === "update") matched.forEach((row) => Object.assign(row, patch));
        return { data: matched, error: null };
      },
      single: async () => {
        const { data, error } = api.run();
        return { data: data?.[0] ?? null, error: error ?? (data?.length ? null : { message: "none" }) };
      },
      maybeSingle: async () => {
        const { data } = api.run();
        return { data: data?.[0] ?? null, error: null };
      },
      then(resolve: (value: unknown) => void) {
        resolve(api.run());
      },
    };
    return api;
  }
  return { from: builder } as unknown as SupabaseClient;
}

function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return run().finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const now = new Date("2026-10-02T12:00:00Z");
const owner = "11111111-1111-1111-1111-111111111111";

function sampleTables(): Record<string, Row[]> {
  return {
    invoices: [
      { id: "inv-new", owner_id: owner, customer_id: "c1", invoice_number: "1205", total_amount: 12000000, holo_creation_at: "2026-10-02T11:50:00Z", order_sms_at: null },
      { id: "inv-old", owner_id: owner, customer_id: "c1", invoice_number: "900", total_amount: 5000000, holo_creation_at: "2026-09-01T10:00:00Z", order_sms_at: null },
      { id: "inv-done", owner_id: owner, customer_id: "c1", invoice_number: "1100", total_amount: 5000000, holo_creation_at: "2026-10-02T11:00:00Z", order_sms_at: "2026-10-02T11:01:00Z" },
      { id: "inv-nophone", owner_id: owner, customer_id: "c2", invoice_number: "1206", total_amount: 1000, holo_creation_at: "2026-10-02T11:55:00Z", order_sms_at: null },
    ],
    customers: [
      { id: "c1", name: "کلینیک سلامت", contact_name: "علی رضایی", phone: "09121234567" },
      { id: "c2", name: "بی‌شماره", contact_name: null, phone: null },
    ],
    invoice_items: [{ invoice_id: "inv-new", product_name: "پد", quantity: 2 }],
    sms_messages: [],
  };
}

test("auto order SMS is on by default and can be switched off", () => {
  assert.equal(autoOrderSmsEnabled({ MELIPAYAMAK_API_TOKEN: "t" }), true);
  assert.equal(autoOrderSmsEnabled({ MELIPAYAMAK_API_TOKEN: "t", MELIPAYAMAK_AUTO_ORDER_SMS: "off" }), false);
  assert.equal(autoOrderSmsEnabled({}), false);
});

test("only new, unhandled invoices are messaged, once each", async () => {
  const tables = sampleTables();
  const admin = fakeAdmin(tables);
  const bodies: Array<Record<string, unknown>> = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ recId: 4512345678, status: "ارسال موفق بود" }));
  }) as unknown as typeof fetch;

  try {
    await withEnv({ MELIPAYAMAK_API_TOKEN: "t", MELIPAYAMAK_AUTO_ORDER_SMS: undefined, MELIPAYAMAK_PATTERN_ORDER: undefined }, async () => {
      const first = await sendAutoOrderSms(admin, owner, now);
      assert.deepEqual(first, { enabled: true, sent: 1, failed: 0, skipped: 1 });
      const second = await sendAutoOrderSms(admin, owner, now);
      assert.deepEqual(second, { enabled: true, sent: 0, failed: 0, skipped: 0 });
    });
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0], {
    bodyId: 428045,
    to: "09121234567",
    args: ["آقا/خانم", "علی رضایی", "1205", "پد ۲ عدد", "۱۲٬۰۰۰٬۰۰۰"],
  });
  const byId = Object.fromEntries(tables.invoices.map((row) => [row.id, row.order_sms_status]));
  assert.equal(byId["inv-new"], "sent");
  assert.equal(byId["inv-nophone"], "skipped_no_mobile");
  assert.equal(byId["inv-old"], undefined);
  assert.equal(tables.sms_messages[0].client_request_id, "inv-new");
});

test("nothing is sent when switched off", async () => {
  const tables = sampleTables();
  await withEnv({ MELIPAYAMAK_API_TOKEN: "t", MELIPAYAMAK_AUTO_ORDER_SMS: "off" }, async () => {
    const summary = await sendAutoOrderSms(fakeAdmin(tables), owner, now);
    assert.equal(summary.enabled, false);
  });
  assert.equal(tables.sms_messages.length, 0);
});
