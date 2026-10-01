import assert from "node:assert/strict";
import test from "node:test";
import {
  draftMatchesQueueFilter,
  filterQueueDrafts,
} from "../lib/queue-view.ts";

const drafts = [
  { reviewId: "pending", status: "PENDING_APPROVAL" },
  { reviewId: "attention", status: "NEEDS_ATTENTION" },
  { reviewId: "blocked", status: "BLOCKED" },
  { reviewId: "approved", status: "APPROVED" },
  { reviewId: "queued", status: "QUEUED" },
  { reviewId: "sending", status: "SENDING" },
  { reviewId: "skipped", status: "SKIPPED" },
  { reviewId: "sent", status: "SENT" },
];

test("All includes every draft, including sent and skipped records", () => {
  assert.deepEqual(
    filterQueueDrafts(drafts, "all").map((draft) => draft.reviewId),
    drafts.map((draft) => draft.reviewId),
  );
});

test("queue views form a complete status partition", () => {
  assert.deepEqual(
    filterQueueDrafts(drafts, "review").map((draft) => draft.reviewId),
    ["pending", "attention", "blocked"],
  );
  assert.deepEqual(
    filterQueueDrafts(drafts, "approved").map((draft) => draft.reviewId),
    ["approved", "queued", "sending"],
  );
  assert.deepEqual(
    filterQueueDrafts(drafts, "completed").map((draft) => draft.reviewId),
    ["skipped", "sent"],
  );
});

test("draft matching uses the same status rules as the queue views", () => {
  assert.equal(draftMatchesQueueFilter(drafts[0], "review"), true);
  assert.equal(draftMatchesQueueFilter(drafts[0], "approved"), false);
  assert.equal(draftMatchesQueueFilter(drafts.at(-1), "all"), true);
});
