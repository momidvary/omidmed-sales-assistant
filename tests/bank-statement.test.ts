import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  extractCounterparty,
  fixMojibake,
  parseResalatStatement,
  statementProblems,
  type PdfTextItem,
} from "../src/lib/bank/resalat-statement";
import { jalaliToGregorian } from "../src/lib/jalali";

// Positioned text items extracted with pdf.js from a real one-day Resalat
// statement, with names, cards and the account number replaced.
const pages = JSON.parse(
  readFileSync("tests/fixtures/resalat-statement.items.json", "utf8"),
) as PdfTextItem[][];

test("parses every row of a Resalat statement with amounts in rial", () => {
  const statement = parseResalatStatement(pages, jalaliToGregorian);
  assert.equal(statement.accountNo, "10.99999999.1");
  assert.equal(statement.fromDate, "1405/07/24");
  assert.equal(statement.transactions.length, 6);
  // The statement's own footer totals.
  assert.equal(statement.totals.withdrawalRial, 13_595_500);
  assert.equal(statement.totals.depositRial, 180_600_000);
  assert.deepEqual(statement.balanceMismatches, []);
  assert.deepEqual(statement.statementTotals, { withdrawalRial: 13_595_500, depositRial: 180_600_000 });
  assert.deepEqual(statementProblems(statement), []);

  const [first, fee, , , paya, named] = statement.transactions;
  assert.equal(first.gregorianDate, "2026-10-16");
  assert.equal(first.time, "19:47:17");
  assert.equal(first.documentNo, "1-1405-10-IRR-14700000001");
  assert.equal(first.withdrawalRial, 2_400_000);
  assert.equal(first.kind, "withdrawal");
  assert.equal(first.counterpartyName, "تامین کننده الف");
  assert.equal(first.counterpartyCard, "6219860000000002");
  assert.match(first.description, /\(کاربر نمونه\)/, "mirrored brackets are restored");

  assert.equal(fee.isFee, true);
  assert.equal(fee.withdrawalRial, 11_000);
  assert.equal(fee.documentNo, first.documentNo, "a fee shares its transfer's document number");

  assert.equal(paya.kind, "deposit");
  assert.equal(paya.depositRial, 175_000_000);
  assert.equal(paya.counterpartyName, "رضا علي", "mis-encoded depositor names are repaired");

  assert.equal(named.counterpartyName, "مشتری نمونه");
  assert.equal(new Set(statement.transactions.map((tx) => tx.fingerprint)).size, 6);
});

test("a corrupted amount is caught by the balance chain", () => {
  const tampered = pages.map((page) =>
    page.map((item) => (item.str === "11,170,000" ? { ...item, str: "11,710,000" } : item)),
  );
  const statement = parseResalatStatement(tampered, jalaliToGregorian);
  assert.ok(statement.balanceMismatches.includes(3));
  assert.equal(statementProblems(statement).length, 2, "balance chain and footer total both fail");
});

test("counterparty is the receiver for withdrawals and the sender for deposits", () => {
  const text =
    "انتقال از کارت 1111222233334444 متعلق به الف ب (الف ب) به کارت 5555666677778888 متعلق به ج د از اینترنت 115";
  assert.deepEqual(extractCounterparty(text, "withdrawal"), { card: "5555666677778888", name: "ج د" });
  assert.deepEqual(extractCounterparty(text, "deposit"), { card: "1111222233334444", name: "الف ب" });
  assert.equal(fixMojibake("plain text"), "plain text");
});
