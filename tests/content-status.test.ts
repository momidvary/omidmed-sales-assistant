import assert from "node:assert/strict";
import test from "node:test";

import {
  canTransitionContentStatus,
  isContentWorkflowStatus,
  nextContentStatusActions,
} from "../src/lib/content-studio/status";

test("content workflow only permits deliberate review transitions", () => {
  assert.equal(canTransitionContentStatus("draft", "published"), false);
  assert.equal(canTransitionContentStatus("draft", "approved"), false);
  assert.equal(canTransitionContentStatus("draft", "pending_review"), true);
  assert.equal(canTransitionContentStatus("pending_review", "approved"), true);
  assert.equal(canTransitionContentStatus("approved", "published"), true);
  assert.equal(canTransitionContentStatus("published", "draft"), true);
});

test("rejected content returns to editing before publication", () => {
  assert.deepEqual(nextContentStatusActions("rejected"), ["draft", "pending_review"]);
  assert.equal(canTransitionContentStatus("rejected", "published"), false);
});

test("status validation rejects arbitrary client values", () => {
  assert.equal(isContentWorkflowStatus("approved"), true);
  assert.equal(isContentWorkflowStatus("deleted"), false);
  assert.equal(isContentWorkflowStatus(""), false);
});
