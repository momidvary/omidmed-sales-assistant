import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTehranLocalDateTime,
  tehranDateTimeToIso,
} from "../src/lib/tehran-time";

test("datetime-local is interpreted as Tehran wall time instead of host UTC", () => {
  assert.equal(
    tehranDateTimeToIso("2026-08-11T15:30"),
    "2026-08-11T12:00:00.000Z",
  );
});

test("Tehran conversion preserves the selected wall-clock time", () => {
  const instant = parseTehranLocalDateTime("2026-12-01T09:05");
  assert.ok(instant);
  const rendered = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
  assert.match(rendered, /2026.*12.*01.*09.*05/);
});

test("invalid or ambiguous input is rejected instead of silently shifted", () => {
  for (const value of [
    "",
    "2026-02-30T12:00",
    "2026-13-01T12:00",
    "2026-08-11T25:00",
    "2026-08-11",
    "2026-08-11T12:00Z",
  ]) {
    assert.equal(parseTehranLocalDateTime(value), null, value);
  }
});
