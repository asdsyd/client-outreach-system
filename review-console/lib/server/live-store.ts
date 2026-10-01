import { randomBytes, randomUUID } from "node:crypto";
import type {
  BatchCreateInput,
  DraftDecisionInput,
  DraftUpdateInput,
  ReviewBatch,
  ReviewConfig,
  ReviewDraft,
  ReviewOperator,
  ReviewStatus,
} from "@/lib/contracts/review";
import { validateDraftContent } from "@/lib/contracts/review";
import {
  EMAIL_TEMPLATE_HASH,
  EMAIL_TEMPLATE_VERSION,
  renderBrandedEmail,
} from "@/lib/email-template";
import { ReviewError } from "@/lib/server/errors";
import {
  BATCH_HASH_SCHEMA,
  DRAFT_HASH_SCHEMA,
  ITEM_HASH_SCHEMA,
  hashBatch,
  hashBatchItem,
  hashDraft,
  hashJson,
  hashOpaqueToken,
  hashText,
  normalizeBody,
  normalizeEmail,
  normalizeSubject,
  type BatchItemCanonicalInput,
} from "@/lib/server/hashing";
import {
  andFilter,
  eq,
  findRow,
  insertRows,
  listRows,
  updateRows,
  type DataTableRow,
} from "@/lib/server/n8n";
import { appendAudit, rowToDraft } from "@/lib/server/row-mapper";

const UNSUBSCRIBE_URL_PREFIX =
  "https://n8n.example.com/webhook/nunoon-outreach-unsubscribe?token=";

export async function getLiveDrafts(): Promise<ReviewDraft[]> {
  const rows = await listRows("queue", {
    limit: 250,
    sortBy: "updatedAt:desc",
  });
  const seen = new Set<string>();

  return rows
    .filter((row) => {
      const reviewId = text(row.review_id);
      if (!reviewId) return false;
      if (seen.has(reviewId)) {
        throw new ReviewError(
          `Duplicate review id: ${reviewId}`,
          409,
          "DUPLICATE_REVIEW_ID",
        );
      }
      seen.add(reviewId);
      return true;
    })
    .map(rowToDraft);
}

export async function updateLiveDraft(
  reviewId: string,
  input: DraftUpdateInput,
  operator: ReviewOperator,
): Promise<ReviewDraft> {
  const row = await getDraftRow(reviewId);
  const current = rowToDraft(row);
  assertEditable(current.status);

  if (current.revision !== input.revision) throw staleRevision();

  const validation = validateDraftContent(input.subject, input.body);
  if (!validation.valid) {
    throw new ReviewError(
      validation.errors.join(" "),
      422,
      "DRAFT_VALIDATION_FAILED",
    );
  }

  const nextRevision = current.revision + 1;
  const subject = normalizeSubject(input.subject);
  const body = normalizeBody(input.body);
  const draftHash = hashDraft({
    campaignVersion: current.campaignVersion,
    contactKey: current.contactKey,
    recipient: current.recipient,
    subject,
    body,
  });
  const now = new Date().toISOString();
  const audit = appendAudit(row, {
    action: "DRAFT_UPDATED",
    actor: operator.email,
    revision: nextRevision,
    draft_hash: draftHash,
    at: now,
  });

  const updated = await updateRows(
    "queue",
    andFilter(
      eq("review_id", reviewId),
      eq("draft_revision", current.revision),
      eq("draft_hash", current.draftHash),
    ),
    {
      draft_subject: subject,
      draft_body: body,
      draft_revision: nextRevision,
      draft_hash: draftHash,
      draft_hash_schema: DRAFT_HASH_SCHEMA,
      approval_status: "PENDING_APPROVAL",
      approved_revision: 0,
      approved_hash: "",
      approved_by: "",
      approved_at: null,
      decision_reason: "",
      batch_id: "",
      batch_position: 0,
      batch_status: "UNBATCHED",
      batch_confirmed_by: "",
      batch_confirmed_at: null,
      send_status: "UNSENT",
      provider: "",
      provider_message_id: "",
      lock_token: "",
      locked_at: null,
      updated_by: operator.email,
      updated_at: now,
      audit_json: JSON.stringify(audit),
    },
  );

  if (updated.length !== 1) throw staleRevision();
  return rowToDraft(updated[0]);
}

export async function decideLiveDraft(
  reviewId: string,
  input: DraftDecisionInput,
  operator: ReviewOperator,
): Promise<ReviewDraft> {
  const row = await getDraftRow(reviewId);
  const current = rowToDraft(row);

  if (
    current.revision !== input.revision ||
    current.draftHash !== input.draftHash
  ) {
    throw staleRevision();
  }
  if (["QUEUED", "SENDING", "SENT"].includes(current.status)) {
    throw new ReviewError(
      "This draft is already locked for sending.",
      409,
      "DRAFT_LOCKED",
    );
  }

  const now = new Date().toISOString();
  const reason = input.reason?.trim().slice(0, 500) || "";
  let changes: DataTableRow;

  if (input.action === "approve") {
    const validation = validateDraftContent(current.subject, current.body);
    if (!validation.valid) {
      throw new ReviewError(
        validation.errors.join(" "),
        422,
        "DRAFT_VALIDATION_FAILED",
      );
    }
    if (current.status === "BLOCKED") {
      throw new ReviewError(
        "A blocked recipient cannot be approved.",
        409,
        "RECIPIENT_BLOCKED",
      );
    }
    changes = {
      approval_status: "APPROVED",
      approved_revision: current.revision,
      approved_hash: current.draftHash,
      approved_by: operator.email,
      approved_at: now,
      decision_reason: "",
      batch_id: "",
      batch_position: 0,
      batch_status: "UNBATCHED",
      batch_confirmed_by: "",
      batch_confirmed_at: null,
      send_status: "UNSENT",
      suppressed_reason: "",
    };
  } else if (input.action === "skip") {
    changes = {
      ...clearApproval(reason || "Skipped by reviewer"),
      approval_status: "SKIPPED",
      send_status: "SKIPPED",
    };
  } else if (input.action === "block") {
    changes = {
      ...clearApproval(reason || "Blocked by reviewer"),
      approval_status: "BLOCKED",
      send_status: "SUPPRESSED",
      suppressed_reason: reason || "Blocked by reviewer",
    };
  } else {
    if (current.status === "BLOCKED") {
      throw new ReviewError(
        "Remove the recipient from suppression before restoring it.",
        409,
        "SUPPRESSION_STILL_ACTIVE",
      );
    }
    changes = {
      ...clearApproval(""),
      approval_status: "PENDING_APPROVAL",
      send_status: "UNSENT",
      suppressed_reason: "",
    };
  }

  const audit = appendAudit(row, {
    action: `DRAFT_${input.action.toUpperCase()}`,
    actor: operator.email,
    revision: current.revision,
    draft_hash: current.draftHash,
    reason,
    at: now,
  });
  const updated = await updateRows(
    "queue",
    andFilter(
      eq("review_id", reviewId),
      eq("draft_revision", current.revision),
      eq("draft_hash", current.draftHash),
      eq("approval_status", text(row.approval_status)),
      eq("send_status", text(row.send_status)),
    ),
    {
      ...changes,
      updated_by: operator.email,
      updated_at: now,
      audit_json: JSON.stringify(audit),
    },
  );

  if (updated.length !== 1) throw staleRevision();
  return rowToDraft(updated[0]);
}

export async function createLiveBatch(
  input: BatchCreateInput,
  config: ReviewConfig,
  operator: ReviewOperator,
): Promise<ReviewBatch> {
  validateBatchRequest(input, config);
  if (!config.senderDomainAuthenticated) {
    throw new ReviewError(
      "Sender-domain authentication is not confirmed.",
      503,
      "SENDER_DOMAIN_NOT_AUTHENTICATED",
    );
  }

  const idempotencyKey = hashJson({
    schema: "outreach-batch-request.v1",
    mode: input.mode,
    actor: operator.email,
    items: input.items,
  });
  const existing = await findRow(
    "batches",
    andFilter(eq("idempotency_key", idempotencyKey)),
  );
  if (existing && text(existing.status).toUpperCase() !== "FAILED") {
    return rowToBatch(existing);
  }

  const queueRows = await listRows("queue", { limit: 250 });
  const queueById = new Map(
    queueRows
      .filter((row) => text(row.review_id))
      .map((row) => [text(row.review_id), row]),
  );
  const selected = input.items.map((item) => {
    const row = queueById.get(item.reviewId);
    if (!row) {
      throw new ReviewError(
        "A selected draft no longer exists.",
        409,
        "BATCH_ITEM_MISSING",
      );
    }
    const draft = rowToDraft(row);
    if (
      draft.status !== "APPROVED" ||
      draft.revision !== item.revision ||
      draft.draftHash !== item.draftHash ||
      draft.approvedRevision !== item.revision ||
      draft.approvedHash !== item.draftHash
    ) {
      throw new ReviewError(
        `${draft.clinic} changed after approval. Review it again.`,
        409,
        "BATCH_ITEM_STALE",
      );
    }
    const recipient = normalizeEmail(draft.recipient);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      throw new ReviewError(
        `${draft.clinic} has an invalid recipient.`,
        422,
        "BATCH_RECIPIENT_INVALID",
      );
    }
    if (text(row.draft_hash_schema) !== DRAFT_HASH_SCHEMA) {
      throw new ReviewError(
        `${draft.clinic} uses an unsupported draft hash.`,
        409,
        "DRAFT_HASH_SCHEMA_MISMATCH",
      );
    }
    return { row, draft };
  });

  const campaigns = new Set(selected.map(({ draft }) => draft.campaignVersion));
  if (campaigns.size !== 1) {
    throw new ReviewError(
      "A batch cannot mix campaign versions.",
      422,
      "BATCH_CAMPAIGN_MISMATCH",
    );
  }

  const now = new Date().toISOString();
  const batchId = `BATCH-${now.slice(0, 10).replaceAll("-", "")}-${randomUUID()
    .slice(0, 8)
    .toUpperCase()}`;
  const campaignVersion = selected[0]?.draft.campaignVersion ?? "";
  const canonicalItems: Array<
    BatchItemCanonicalInput & {
      itemManifestHash: string;
      companyName: string;
      unsubscribeToken: string;
      emailHtmlSnapshot: string;
      emailTextSnapshot: string;
    }
  > = selected.map(({ draft }, index) => {
    const batchPosition = index + 1;
    const itemKey = `${batchId}::${String(batchPosition).padStart(3, "0")}`;
    const unsubscribeToken = randomBytes(32).toString("base64url");
    const email = renderBrandedEmail({
      subject: draft.subject,
      body: draft.body,
      mode: input.mode,
      unsubscribeUrl:
        input.mode === "LIVE"
          ? `${UNSUBSCRIBE_URL_PREFIX}${encodeURIComponent(unsubscribeToken)}`
          : null,
    });
    const item: BatchItemCanonicalInput = {
      batchId,
      batchPosition,
      itemKey,
      reviewId: draft.reviewId,
      contactKey: draft.contactKey,
      campaignVersion: draft.campaignVersion,
      sendMode: input.mode,
      intendedRecipient: normalizeEmail(draft.recipient),
      sendTo:
        input.mode === "TEST"
          ? normalizeEmail(config.testRecipient ?? "")
          : normalizeEmail(draft.recipient),
      unsubscribeTokenHash: hashOpaqueToken(unsubscribeToken),
      approvedRevision: draft.approvedRevision ?? 0,
      approvedHash: draft.approvedHash ?? "",
      subject: draft.subject,
      body: draft.body,
      emailTemplateVersion: EMAIL_TEMPLATE_VERSION,
      emailTemplateHash: EMAIL_TEMPLATE_HASH,
      emailHtmlHash: hashText(email.html),
      emailTextHash: hashText(email.text),
    };
    return {
      ...item,
      itemManifestHash: hashBatchItem(item),
      companyName: draft.clinic,
      unsubscribeToken,
      emailHtmlSnapshot: email.html,
      emailTextSnapshot: email.text,
    };
  });
  const manifestHash = hashBatch({
    batchId,
    campaignVersion,
    sendMode: input.mode,
    provider: config.provider,
    senderName: config.senderName,
    senderEmail: config.senderEmail,
    replyTo: config.replyTo,
    testRecipient: config.testRecipient ?? "",
    batchLimit: config.maxBatchSize,
    interSendSeconds: config.pacingSeconds,
    senderDomainAuthenticated: config.senderDomainAuthenticated,
    pilotComplete: config.pilotComplete,
    items: canonicalItems,
  });

  const insertedBatch = await insertRows("batches", [
    {
      batch_id: batchId,
      idempotency_key: idempotencyKey,
      campaign_version: campaignVersion,
      send_mode: input.mode,
      status: "DRAFT",
      item_count: selected.length,
      manifest_hash: manifestHash,
      manifest_hash_schema: BATCH_HASH_SCHEMA,
      provider_snapshot: config.provider,
      sender_name_snapshot: config.senderName,
      sender_email_snapshot: config.senderEmail,
      reply_to_snapshot: config.replyTo,
      test_recipient_snapshot: config.testRecipient ?? "",
      batch_limit_snapshot: config.maxBatchSize,
      inter_send_seconds_snapshot: config.pacingSeconds,
      sender_domain_authenticated_snapshot: config.senderDomainAuthenticated,
      pilot_complete_snapshot: config.pilotComplete,
      confirmed_by: "",
      confirmed_at: null,
      created_by: operator.email,
      created_at: now,
      started_at: null,
      completed_at: null,
      lock_token: "",
      locked_at: null,
      execution_id: "",
      last_error_code: "",
      last_error_message: "",
      updated_at: now,
    },
  ]);
  if (insertedBatch.length !== 1) {
    throw new ReviewError(
      "n8n did not create the batch ledger.",
      502,
      "BATCH_LEDGER_INSERT_FAILED",
    );
  }

  const batchItems = canonicalItems.map((item) => ({
    item_key: item.itemKey,
    batch_id: item.batchId,
    batch_position: item.batchPosition,
    review_id: item.reviewId,
    contact_key: item.contactKey,
    campaign_version: item.campaignVersion,
    send_mode: item.sendMode,
    company_name_snapshot: item.companyName,
    intended_recipient: item.intendedRecipient,
    send_to: item.sendTo,
    unsubscribe_token: item.unsubscribeToken,
    unsubscribe_token_hash: item.unsubscribeTokenHash,
    approved_revision: item.approvedRevision,
    approved_hash: item.approvedHash,
    draft_hash_schema: DRAFT_HASH_SCHEMA,
    draft_subject_snapshot: normalizeSubject(item.subject),
    draft_body_snapshot: normalizeBody(item.body),
    email_template_version: item.emailTemplateVersion,
    email_template_hash: item.emailTemplateHash,
    email_html_snapshot: item.emailHtmlSnapshot,
    email_text_snapshot: item.emailTextSnapshot,
    email_html_hash: item.emailHtmlHash,
    email_text_hash: item.emailTextHash,
    item_manifest_hash: item.itemManifestHash,
    item_manifest_hash_schema: ITEM_HASH_SCHEMA,
    status: "CONFIRMED",
    attempt_count: 0,
    provider_message_id: "",
    sent_at: null,
    lock_token: "",
    locked_at: null,
    execution_id: "",
    last_error_code: "",
    last_error_message: "",
    created_at: now,
    updated_at: now,
  }));

  try {
    const insertedItems = await insertRows("batchItems", batchItems);
    if (insertedItems.length !== batchItems.length) {
      throw new ReviewError(
        "n8n did not create the complete batch manifest.",
        502,
        "BATCH_MANIFEST_INSERT_FAILED",
      );
    }

    for (const [index, { draft, row }] of selected.entries()) {
      const audit = appendAudit(row, {
        action: "BATCH_CONFIRMED",
        actor: operator.email,
        batch_id: batchId,
        position: index + 1,
        revision: draft.revision,
        draft_hash: draft.draftHash,
        at: now,
      });
      const updated = await updateRows(
        "queue",
        andFilter(
          eq("review_id", draft.reviewId),
          eq("approval_status", "APPROVED"),
          eq("send_status", "UNSENT"),
          eq("batch_status", text(row.batch_status) || "UNBATCHED"),
          eq("draft_revision", draft.revision),
          eq("draft_hash", draft.draftHash),
          eq("approved_revision", draft.revision),
          eq("approved_hash", draft.draftHash),
        ),
        {
          batch_id: batchId,
          batch_position: index + 1,
          batch_status: "CONFIRMED",
          batch_confirmed_by: operator.email,
          batch_confirmed_at: now,
          updated_by: operator.email,
          updated_at: now,
          audit_json: JSON.stringify(audit),
        },
      );
      if (updated.length !== 1) {
        throw new ReviewError(
          `${draft.clinic} changed while the batch was being confirmed.`,
          409,
          "BATCH_CONFIRMATION_RACE",
        );
      }
    }

    const confirmed = await updateRows(
      "batches",
      andFilter(eq("batch_id", batchId), eq("status", "DRAFT")),
      {
        status: "CONFIRMED",
        confirmed_by: operator.email,
        confirmed_at: now,
        updated_at: now,
        last_error_code: "",
        last_error_message: "",
      },
    );
    if (confirmed.length !== 1) {
      throw new ReviewError(
        "The batch ledger could not be confirmed.",
        502,
        "BATCH_CONFIRMATION_FAILED",
      );
    }
    return rowToBatch(confirmed[0]);
  } catch (error) {
    await markBatchFailed(batchId, error);
    await rollbackQueueBatch(batchId, operator.email);
    throw error;
  }
}

export async function getLiveBatch(batchId: string): Promise<ReviewBatch | null> {
  const row = await findRow("batches", andFilter(eq("batch_id", batchId)));
  return row ? rowToBatch(row) : null;
}

async function getDraftRow(reviewId: string): Promise<DataTableRow> {
  const row = await findRow("queue", andFilter(eq("review_id", reviewId)));
  if (!row) {
    throw new ReviewError("Draft not found.", 404, "DRAFT_NOT_FOUND");
  }
  return row;
}

function assertEditable(status: ReviewStatus): void {
  if (["BLOCKED", "QUEUED", "SENDING", "SENT"].includes(status)) {
    throw new ReviewError(
      "This draft cannot be edited in its current state.",
      409,
      "DRAFT_NOT_EDITABLE",
    );
  }
}

function clearApproval(reason: string): DataTableRow {
  return {
    approved_revision: 0,
    approved_hash: "",
    approved_by: "",
    approved_at: null,
    decision_reason: reason,
    batch_id: "",
    batch_position: 0,
    batch_status: "UNBATCHED",
    batch_confirmed_by: "",
    batch_confirmed_at: null,
    lock_token: "",
    locked_at: null,
  };
}

function validateBatchRequest(
  input: BatchCreateInput,
  config: ReviewConfig,
): void {
  if (input.mode !== config.mode) {
    throw new ReviewError(
      "The batch mode changed. Refresh before confirming.",
      409,
      "BATCH_MODE_CHANGED",
    );
  }
  if (input.items.length < 1 || input.items.length > config.maxBatchSize) {
    throw new ReviewError(
      `Select between 1 and ${config.maxBatchSize} approved drafts.`,
      422,
      "BATCH_SIZE_INVALID",
    );
  }
  if (new Set(input.items.map((item) => item.reviewId)).size !== input.items.length) {
    throw new ReviewError(
      "A draft can appear only once in a batch.",
      422,
      "BATCH_DUPLICATE_ITEM",
    );
  }
}

async function markBatchFailed(batchId: string, error: unknown): Promise<void> {
  const message =
    error instanceof Error ? error.message.slice(0, 500) : "Unknown batch failure";
  const now = new Date().toISOString();
  await updateRows("batches", andFilter(eq("batch_id", batchId)), {
    status: "FAILED",
    last_error_code: "BATCH_CONFIRMATION_FAILED",
    last_error_message: message,
    updated_at: now,
  }).catch((ledgerError) => {
    console.error("Failed to mark outreach batch as failed", ledgerError);
  });
  await updateRows(
    "batchItems",
    andFilter(eq("batch_id", batchId), eq("status", "CONFIRMED")),
    {
      status: "CANCELLED",
      last_error_code: "BATCH_CONFIRMATION_FAILED",
      last_error_message: message,
      updated_at: now,
    },
  ).catch((ledgerError) => {
    console.error("Failed to cancel outreach batch items", ledgerError);
  });
}

async function rollbackQueueBatch(
  batchId: string,
  actor: string,
): Promise<void> {
  await updateRows(
    "queue",
    andFilter(eq("batch_id", batchId), eq("batch_status", "CONFIRMED")),
    {
      batch_id: "",
      batch_position: 0,
      batch_status: "UNBATCHED",
      batch_confirmed_by: "",
      batch_confirmed_at: null,
      updated_by: actor,
      updated_at: new Date().toISOString(),
    },
  ).catch((rollbackError) => {
    console.error("Failed to roll back queued outreach rows", rollbackError);
  });
}

function rowToBatch(row: DataTableRow): ReviewBatch {
  const mode = text(row.send_mode).toUpperCase() === "LIVE" ? "LIVE" : "TEST";
  const statusValue = text(row.status).toUpperCase() as ReviewBatch["status"];
  const statuses = new Set<ReviewBatch["status"]>([
    "DRAFT",
    "CONFIRMED",
    "LOCKED",
    "SENDING",
    "COMPLETE",
    "FAILED",
    "NEEDS_RECONCILIATION",
    "CANCELLED",
  ]);
  return {
    batchId: text(row.batch_id),
    mode,
    status: statuses.has(statusValue) ? statusValue : "FAILED",
    itemCount: Number(row.item_count ?? 0),
    manifestHash: text(row.manifest_hash),
    confirmedBy: text(row.confirmed_by),
    confirmedAt:
      text(row.confirmed_at) || text(row.createdAt) || new Date(0).toISOString(),
  };
}

function staleRevision(): ReviewError {
  return new ReviewError(
    "This draft changed elsewhere. Refresh before continuing.",
    409,
    "DRAFT_REVISION_STALE",
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}
