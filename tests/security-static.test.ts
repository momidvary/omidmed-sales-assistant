import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

function filesUnder(root: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) result.push(...filesUnder(path));
    else if (/\.(?:ts|tsx|js|jsx)$/.test(entry)) result.push(path);
  }
  return result;
}

const sourceFiles = filesUnder("src");

test("React source does not render stored or AI HTML directly", () => {
  const offenders = sourceFiles
    .filter((path) => readFileSync(path, "utf8").includes("dangerouslySetInnerHTML"))
    .map((path) => relative(process.cwd(), path));
  assert.deepEqual(offenders, []);
});

test("secret-like environment variables are never exposed through NEXT_PUBLIC", () => {
  const pattern = /NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|SERVICE_ROLE|PRIVATE_KEY)/g;
  const offenders: string[] = [];
  for (const path of sourceFiles) {
    const content = readFileSync(path, "utf8");
    if (pattern.test(content)) offenders.push(relative(process.cwd(), path));
    pattern.lastIndex = 0;
  }
  assert.deepEqual(offenders, []);
});

test("client components do not contain service-role credentials", () => {
  const offenders: string[] = [];
  for (const path of sourceFiles) {
    const content = readFileSync(path, "utf8");
    const clientComponent = /^\s*["']use client["'];?/m.test(content);
    if (clientComponent && /SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(content)) {
      offenders.push(relative(process.cwd(), path));
    }
  }
  assert.deepEqual(offenders, []);
});

test("API routes do not assign ownership from request-body fields", () => {
  const apiFiles = sourceFiles.filter((path) => path.includes(`${join("src", "app", "api")}`));
  const dangerousOwnerAssignment = /(?:owner_id|created_by|ownerId)\s*:\s*(?:body|payload|input|data)\s*[.\[]/g;
  const offenders: string[] = [];
  for (const path of apiFiles) {
    const content = readFileSync(path, "utf8");
    if (dangerousOwnerAssignment.test(content)) offenders.push(relative(process.cwd(), path));
    dangerousOwnerAssignment.lastIndex = 0;
  }
  assert.deepEqual(offenders, []);
});
