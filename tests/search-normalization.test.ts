import assert from "node:assert/strict";
import test from "node:test";

import { escapeLike, normalizeSearchText } from "../src/lib/search/normalize";

test("search normalization unifies Persian/Arabic letters and digits", () => {
  assert.equal(normalizeSearchText("  كلينيك ۱۲٣  "), "کلینیک 123");
});

test("wildcards cannot alter the intended ilike search", () => {
  assert.equal(escapeLike("مرکز%_توان"), "مرکزتوان");
});
