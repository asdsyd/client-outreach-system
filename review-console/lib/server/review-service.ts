import type {
  BatchCreateInput,
  DraftDecisionInput,
  DraftUpdateInput,
  ReviewBatch,
  ReviewDraft,
  ReviewQueueResponse,
} from "@/lib/contracts/review";
import { requireReviewer, type ReviewContext } from "@/lib/server/auth";
import { getReviewConfig } from "@/lib/server/config";
import {
  createDemoBatch,
  decideDemoDraft,
  getDemoBatch,
  getDemoDrafts,
  updateDemoDraft,
} from "@/lib/server/demo-store";
import {
  createLiveBatch,
  decideLiveDraft,
  getLiveBatch,
  getLiveDrafts,
  updateLiveDraft,
} from "@/lib/server/live-store";

export async function getReviewQueue(): Promise<ReviewQueueResponse> {
  const context = await requireReviewer();
  const config = getReviewConfig();
  const drafts =
    context.connection === "demo" ? getDemoDrafts() : await getLiveDrafts();
  return {
    connection: context.connection,
    operator: context.operator,
    config,
    drafts,
    syncedAt: new Date().toISOString(),
  };
}
export async function updateReviewDraft(
  reviewId: string,
  input: DraftUpdateInput,
): Promise<{ context: ReviewContext; draft: ReviewDraft }> {
  const context = await requireReviewer();
  const draft =
    context.connection === "demo"
      ? updateDemoDraft(reviewId, input)
      : await updateLiveDraft(reviewId, input, context.operator);
  return { context, draft };
}

export async function decideReviewDraft(
  reviewId: string,
  input: DraftDecisionInput,
): Promise<{ context: ReviewContext; draft: ReviewDraft }> {
  const context = await requireReviewer();
  const draft =
    context.connection === "demo"
      ? decideDemoDraft(reviewId, input)
      : await decideLiveDraft(reviewId, input, context.operator);
  return { context, draft };
}

export async function createReviewBatch(
  input: BatchCreateInput,
): Promise<{ context: ReviewContext; batch: ReviewBatch }> {
  const context = await requireReviewer();
  const config = getReviewConfig();
  const batch =
    context.connection === "demo"
      ? createDemoBatch(input, config, context.operator)
      : await createLiveBatch(input, config, context.operator);
  return { context, batch };
}

export async function getReviewBatch(
  batchId: string,
): Promise<{ context: ReviewContext; batch: ReviewBatch | null }> {
  const context = await requireReviewer();
  const batch =
    context.connection === "demo"
      ? getDemoBatch(batchId)
      : await getLiveBatch(batchId);
  return { context, batch };
}
