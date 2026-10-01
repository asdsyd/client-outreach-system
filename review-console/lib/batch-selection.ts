function normalizedLimit(maxBatchSize: number): number {
  if (!Number.isFinite(maxBatchSize)) return 0;
  return Math.max(0, Math.floor(maxBatchSize));
}

export function defaultBatchSelection(
  orderedReviewIds: string[],
  maxBatchSize: number,
): Set<string> {
  return new Set(orderedReviewIds.slice(0, normalizedLimit(maxBatchSize)));
}

export function toggleBatchItemSelection(
  current: ReadonlySet<string>,
  reviewId: string,
  maxBatchSize: number,
): Set<string> {
  const next = new Set(current);
  if (next.has(reviewId)) {
    next.delete(reviewId);
  } else if (next.size < normalizedLimit(maxBatchSize)) {
    next.add(reviewId);
  }
  return next;
}

export function toggleAllBatchSelection(
  orderedReviewIds: string[],
  current: ReadonlySet<string>,
  maxBatchSize: number,
): Set<string> {
  const limit = Math.min(
    orderedReviewIds.length,
    normalizedLimit(maxBatchSize),
  );
  const eligibleIds = new Set(orderedReviewIds);
  const validCurrent = new Set(
    [...current].filter((reviewId) => eligibleIds.has(reviewId)),
  );

  if (limit > 0 && validCurrent.size === limit) return new Set();

  for (const reviewId of orderedReviewIds) {
    if (validCurrent.size >= limit) break;
    validCurrent.add(reviewId);
  }
  return validCurrent;
}

export function pruneBatchSelection(
  orderedReviewIds: string[],
  current: ReadonlySet<string>,
  maxBatchSize: number,
): Set<string> {
  const eligibleIds = new Set(orderedReviewIds);
  const limit = normalizedLimit(maxBatchSize);
  return new Set(
    [...current]
      .filter((reviewId) => eligibleIds.has(reviewId))
      .slice(0, limit),
  );
}
