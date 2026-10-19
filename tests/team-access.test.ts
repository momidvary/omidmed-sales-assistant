import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { OWNER_ONLY_SECTIONS } from "../src/lib/team";

const read = (path: string) => readFileSync(path, "utf8");

test("owner-only sections are wrapped by the owner guard", () => {
  for (const section of ["accounting", "settings", "campaigns"]) {
    assert.match(read(`src/app/${section}/layout.tsx`), /<OwnerOnly>/, section);
  }
  for (const key of ["accounting", "holo-sync", "campaigns", "team"]) {
    assert.ok(OWNER_ONLY_SECTIONS.has(key), key);
  }
});

test("bank upload and campaign SMS refuse a team member", () => {
  for (const route of ["src/app/api/bank/statements/route.ts", "src/app/api/sms/send-campaign/route.ts"]) {
    assert.match(read(route), /if \(!\(await isOwner\(\)\)\)/, route);
  }
});

test("team logins are created only after the owner is checked, never for an existing account", () => {
  const page = read("src/app/settings/team/page.tsx");
  for (const action of ["addMember", "changePassword", "removeMember"]) {
    const body = page.slice(page.indexOf(`async function ${action}`));
    assert.match(body.slice(0, 400), /await requireOwner\(\)/, action);
  }
  assert.match(page, /admin\.auth\.admin\.createUser\(/);
  assert.match(page, /deleteUser\(created\.user\.id\)/, "a login without membership is rolled back");
});

test("the service-role client is server-only", () => {
  const admin = read("src/lib/supabase/admin.ts");
  assert.doesNotMatch(admin, /NEXT_PUBLIC_SUPABASE_SERVICE/);
  assert.doesNotMatch(admin, /"use client"/);
});
