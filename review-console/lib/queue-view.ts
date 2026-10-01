import type { ReviewDraft, ReviewStatus } from "@/lib/contracts/review";

export type QueueFilter = "review" | "approved" | "completed" | "all";

const FILTER_STATUSES: Record<
  Exclude<QueueFilter, "all">,
  ReadonlySet<ReviewStatus>
> = {
  review: new Set(["PENDING_APPROVAL", "NEEDS_ATTENTION", "BLOCKED"]),
  approved: new Set(["APPROVED", "QUEUED", "SENDING"]),
  completed: new Set(["SKIPPED", "SENT"]),
};

export function filterQueueDrafts(
  drafts: ReviewDraft[],
  filter: QueueFilter,
): ReviewDraft[] {
  if (filter === "all") return drafts;
  return drafts.filter((draft) => FILTER_STATUSES[filter].has(draft.status));
}

export function draftMatchesQueueFilter(
  draft: ReviewDraft,
  filter: QueueFilter,
): boolean {
  return filter === "all" || FILTER_STATUSES[filter].has(draft.status);
}
