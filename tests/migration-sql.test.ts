import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration024 = readFileSync(
  "supabase/migrations/024_product_completion.sql",
  "utf8",
);

/**
 * The harness runs only when a disposable PostgreSQL server is reachable.
 * Set PGHOST/PGPORT/PGUSER to enable it; without them the SQL-contract
 * assertions below still run.
 */
function postgresAvailable() {
  if (!process.env.PGHOST) return false;
  try {
    execFileSync("psql", ["-tc", "select 1"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const hasDb = postgresAvailable();

// --------------------------------------------------------------------------
// Contract assertions — these always run.
// --------------------------------------------------------------------------

test("actual sales are derived in SQL and exclude soft-deleted invoices", () => {
  const view = migration024.slice(
    migration024.indexOf("create or replace view public.owner_sales_daily"),
  );
  const body = view.slice(0, view.indexOf(";"));
  assert.match(body, /from public\.invoices/);
  assert.match(body, /coalesce\(holo_is_deleted, false\) = false/);
});

test("purchase outstanding never guesses an unknown legacy payment", () => {
  assert.match(
    migration024,
    /when i\.opening_paid_amount is null then 'needs_review'/,
  );
  // A partial invoice with an unknown paid amount must report NULL, not 0.
  assert.match(
    migration024,
    /case when i\.opening_paid_amount is null then null else[\s\S]*?end as outstanding_amount/,
  );
  assert.match(
    migration024,
    /update public\.purchase_invoices\s+set opening_paid_amount = null\s+where payment_status = 'partial'/,
  );
});

test("payroll repair is restricted and never overwrites a manual net_pay", () => {
  const update = migration024.slice(
    migration024.indexOf("update public.payroll_entries\nset net_pay"),
  );
  const statement = update.slice(0, update.indexOf(";"));
  // Must be guarded: only the 0 default or the legacy advance-deducting value.
  assert.match(statement, /where net_pay is distinct from/);
  assert.match(statement, /net_pay = 0/);
  assert.match(statement, /- advance_amount/);
  // An unconditional rewrite would have no WHERE clause at all.
  assert.ok(
    statement.includes("where"),
    "payroll net_pay update must be conditional",
  );
});

test("advance counts as a payment, not a reduction of labor cost", () => {
  assert.match(migration024, /paid_amount \+ advance_amount >= net_pay/);
});

// --------------------------------------------------------------------------
// Executed migration tests — real PostgreSQL.
// --------------------------------------------------------------------------

test("fresh database applies 001 through the latest migration", { skip: !hasDb }, () => {
  const out = execFileSync("supabase/tests/harness/run.sh", ["fresh"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  assert.match(out, /FRESH_OK/);
});

test("upgrade from 023 repairs derived data without clobbering manual data", { skip: !hasDb }, () => {
  const out = execFileSync("supabase/tests/harness/run.sh", ["upgrade"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const rows = out.split("\n").map((line) => line.trim()).filter(Boolean);

  // month | net_pay | status
  assert.ok(rows.includes("1|10500000|paid"), "already-correct row must be untouched");
  assert.ok(rows.includes("2|10000000|partial"), "advance must move status to partial");
  assert.ok(rows.includes("3|7777777|unpaid"), "manual net_pay must survive the migration");

  // invoice | opening_paid | derived status
  assert.ok(rows.includes("P-PAID|5000000|paid"));
  assert.ok(rows.includes("P-UNPAID|0|unpaid"));
  assert.ok(
    rows.includes("P-PARTIAL|NULL|needs_review"),
    "unknown legacy partial must be flagged, not guessed",
  );
});

// --------------------------------------------------------------------------
// Search normalisation parity.
//
// The customer query is normalised in TypeScript and matched with ilike
// against customers.search_document, which Postgres generates with
// normalize_search_text(). The two must agree exactly: a rule on one side
// only means the query and the stored document disagree and search silently
// returns nothing. Collapsing internal whitespace was missing from the SQL
// side, so a customer stored with a double space in their name could not be
// found by typing that same name.
// --------------------------------------------------------------------------

const NORMALISER_INPUTS = [
  "محمد امیدواری",
  "محمد  امیدواری",
  "  محمد   امیدواری  ",
  "محمدي",
  "شركت",
  "۰۹۱۲۳۴۵۶۷۸۹",
  "٠٩١٢٣٤٥٦٧٨٩",
  "09123456789",
  "ABC Medical Co",
  "کلینیک\tفیزیوتراپی",
  "تهران\nشرق",
  "",
  "   ",
];

test("SQL and TypeScript search normalisers agree", { skip: !hasDb }, async () => {
  const { normalizeSearchText } = await import("../src/lib/search/normalize");

  for (const input of NORMALISER_INPUTS) {
    const sql = execFileSync(
      "psql",
      [
        "-d",
        "migtest_fresh",
        "-tA",
        "-c",
        "select public.normalize_search_text($$" + input + "$$);",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).replace(/\n$/, "");

    const ts = normalizeSearchText(input);
    assert.equal(
      sql,
      ts,
      `normaliser drift for ${JSON.stringify(input)}: SQL ${JSON.stringify(sql)} vs TS ${JSON.stringify(ts)}`,
    );
  }
});
