import { randomUUID } from "node:crypto";
import type {
  BatchCreateInput,
  DraftDecisionInput,
  DraftUpdateInput,
  ReviewBatch,
  ReviewConfig,
  ReviewDraft,
  ReviewOperator,
} from "@/lib/contracts/review";
import { validateDraftContent } from "@/lib/contracts/review";
import { ReviewError } from "@/lib/server/errors";
import { hashDraft, hashJson } from "@/lib/server/hashing";

type DemoState = {
  drafts: ReviewDraft[];
  batches: ReviewBatch[];
};

declare global {
  var __nunoonOutreachDemoState: DemoState | undefined;
}

export function getDemoDrafts(): ReviewDraft[] {
  return clone(state().drafts);
}

export function updateDemoDraft(
  reviewId: string,
  input: DraftUpdateInput,
): ReviewDraft {
  const draft = findDraft(reviewId);
  assertEditable(draft);
  if (draft.revision !== input.revision) {
    throw staleRevision();
  }

  const validation = validateDraftContent(input.subject, input.body);
  if (!validation.valid) {
    throw new ReviewError(
      validation.errors.join(" "),
      422,
      "DRAFT_VALIDATION_FAILED",
    );
  }

  draft.subject = input.subject.trim();
  draft.body = input.body.trim();
  draft.revision += 1;
  draft.draftHash = hashDraft({
    campaignVersion: draft.campaignVersion,
    contactKey: draft.contactKey,
    recipient: draft.recipient,
    subject: draft.subject,
    body: draft.body,
  });
  draft.status = "PENDING_APPROVAL";
  draft.approvedRevision = null;
  draft.approvedHash = null;
  draft.batchId = null;
  draft.updatedAt = new Date().toISOString();
  return clone(draft);
}

export function decideDemoDraft(
  reviewId: string,
  input: DraftDecisionInput,
): ReviewDraft {
  const draft = findDraft(reviewId);
  if (
    draft.revision !== input.revision ||
    draft.draftHash !== input.draftHash
  ) {
    throw staleRevision();
  }

  if (["QUEUED", "SENDING", "SENT"].includes(draft.status)) {
    throw new ReviewError(
      "This draft is already locked for a batch.",
      409,
      "DRAFT_LOCKED",
    );
  }

  if (input.action === "approve") {
    const validation = validateDraftContent(draft.subject, draft.body);
    if (!validation.valid) {
      throw new ReviewError(
        validation.errors.join(" "),
        422,
        "DRAFT_VALIDATION_FAILED",
      );
    }
    draft.status = "APPROVED";
    draft.approvedRevision = draft.revision;
    draft.approvedHash = draft.draftHash;
  } else if (input.action === "skip") {
    draft.status = "SKIPPED";
    draft.approvedRevision = null;
    draft.approvedHash = null;
  } else if (input.action === "block") {
    draft.status = "BLOCKED";
    draft.approvedRevision = null;
    draft.approvedHash = null;
    draft.risks = [
      ...draft.risks.filter((risk) => risk.tone !== "red"),
      { label: input.reason?.trim() || "Blocked by reviewer", tone: "red" },
    ];
  } else {
    draft.status = "PENDING_APPROVAL";
    draft.approvedRevision = null;
    draft.approvedHash = null;
  }

  draft.updatedAt = new Date().toISOString();
  return clone(draft);
}

export function createDemoBatch(
  input: BatchCreateInput,
  config: ReviewConfig,
  operator: ReviewOperator,
): ReviewBatch {
  validateBatchRequest(input, config);
  const requestedDrafts = input.items.map((item) => {
    const draft = findDraft(item.reviewId);
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
    return draft;
  });

  const confirmedAt = new Date().toISOString();
  const manifestHash = hashJson({
    schema: "nunoon-outreach-batch-v1",
    mode: input.mode,
    items: input.items,
  });
  const batch: ReviewBatch = {
    batchId: `DEMO-${randomUUID().slice(0, 8).toUpperCase()}`,
    mode: input.mode,
    status: "CONFIRMED",
    itemCount: requestedDrafts.length,
    manifestHash,
    confirmedBy: operator.email,
    confirmedAt,
  };

  requestedDrafts.forEach((draft) => {
    draft.status = "QUEUED";
    draft.batchId = batch.batchId;
    draft.updatedAt = confirmedAt;
  });
  state().batches.push(batch);
  return clone(batch);
}

export function getDemoBatch(batchId: string): ReviewBatch | null {
  const batch = state().batches.find((item) => item.batchId === batchId);
  return batch ? clone(batch) : null;
}

function state(): DemoState {
  if (!globalThis.__nunoonOutreachDemoState) {
    globalThis.__nunoonOutreachDemoState = {
      drafts: buildSeedDrafts(),
      batches: [],
    };
  }
  return globalThis.__nunoonOutreachDemoState;
}

function findDraft(reviewId: string): ReviewDraft {
  const draft = state().drafts.find((item) => item.reviewId === reviewId);
  if (!draft) {
    throw new ReviewError("Draft not found.", 404, "DRAFT_NOT_FOUND");
  }
  return draft;
}

function assertEditable(draft: ReviewDraft): void {
  if (["BLOCKED", "QUEUED", "SENDING", "SENT"].includes(draft.status)) {
    throw new ReviewError(
      "This draft cannot be edited in its current state.",
      409,
      "DRAFT_NOT_EDITABLE",
    );
  }
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

function staleRevision(): ReviewError {
  return new ReviewError(
    "This draft changed elsewhere. Refresh before continuing.",
    409,
    "DRAFT_REVISION_STALE",
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildSeedDrafts(): ReviewDraft[] {
  const drafts: Array<Omit<ReviewDraft, "draftHash">> = [
    {
      reviewId: "rvw_demo%0Aclinic",
      contactKey: "operations@pearl-dental.example::pilot-v3",
      campaignVersion: "pilot-v3",
      clinic: "Pearl Dental Clinic",
      city: "Dubai",
      specialty: "Dental",
      recipient: "operations@pearl-dental.example",
      role: "Clinic Manager",
      subject: "A simpler way to follow up on missed enquiries",
      body:
        "Hello Clinic Manager,\n\nWhile reviewing Pearl Dental Clinic’s website, its online appointment requests across several dental services stood out. It gave us a useful sense of how your team presents its care.\n\nIAWebDevelopment × Nunoon would be glad to prepare a complimentary review of your booking follow-up, reminders, and patient reactivation workflows.\n\nIf this is relevant, reply and I’ll send the assessment tailored to Pearl Dental Clinic.\n\nBest,\nDemo Sender\nIAWebDevelopment × Nunoon",
      researchSummary:
        "The clinic promotes general dentistry, cosmetic treatments, and online appointment requests from its Dubai location.",
      personalizationBasis:
        "Lead with booking follow-up because the public site emphasizes appointment requests across several high-intent services.",
      sources: [
        { label: "Clinic website", url: "https://example.com/clinic" },
        { label: "Services page", url: "https://example.com/services" },
      ],
      emailSource: "Verified",
      grounding: "Strong",
      status: "PENDING_APPROVAL",
      revision: 1,
      approvedRevision: null,
      approvedHash: null,
      batchId: null,
      risks: [],
      updatedAt: new Date().toISOString(),
    },
    {
      reviewId: "CLN-1048",
      contactKey: "info@lumen-aesthetic.example::pilot-v3",
      campaignVersion: "pilot-v3",
      clinic: "Lumen Aesthetic Centre",
      city: "Abu Dhabi",
      specialty: "Aesthetic medicine",
      recipient: "info@lumen-aesthetic.example",
      role: "Operations Director",
      subject: "Turning consultation interest into booked visits",
      body:
        "Hello Operations Director,\n\nWhile reviewing Lumen Aesthetic Centre’s website, its consultation-led treatments and repeat-care services stood out. It gave us a useful sense of how your team presents its care.\n\nIAWebDevelopment × Nunoon would be glad to prepare a complimentary review of your consultation follow-up, booking, reminders, and patient reactivation workflows.\n\nIf this is relevant, reply and I’ll send the assessment tailored to Lumen Aesthetic Centre.\n\nBest,\nDemo Sender\nIAWebDevelopment × Nunoon",
      researchSummary:
        "Public pages describe consultation-led aesthetic treatments and repeat-care services in Abu Dhabi.",
      personalizationBasis:
        "Use consultation conversion and repeat-care follow-up as cautious sector hypotheses, not observed clinic problems.",
      sources: [
        { label: "Clinic website", url: "https://example.com/lumen" },
        { label: "Treatment overview", url: "https://example.com/treatments" },
      ],
      emailSource: "Inferred",
      grounding: "Medium",
      status: "NEEDS_ATTENTION",
      revision: 1,
      approvedRevision: null,
      approvedHash: null,
      batchId: null,
      risks: [{ label: "Email inferred from domain", tone: "amber" }],
      updatedAt: new Date().toISOString(),
    },
    {
      reviewId: "CLN-1051",
      contactKey: "care@oasis-dermatology.example::pilot-v3",
      campaignVersion: "pilot-v3",
      clinic: "Oasis Dermatology Centre",
      city: "Sharjah",
      specialty: "Dermatology",
      recipient: "care@oasis-dermatology.example",
      role: "Patient Experience Lead",
      subject: "Consistent follow-up for treatment enquiries",
      body:
        "Hello Patient Experience Lead,\n\nWhile reviewing Oasis Dermatology Centre’s website, its medical, cosmetic, and repeat-care treatment programmes stood out. It gave us a useful sense of how your team presents its care.\n\nIAWebDevelopment × Nunoon would be glad to prepare a complimentary review of your enquiry follow-up, booking, reminders, and patient reactivation workflows.\n\nIf this is relevant, reply and I’ll send the assessment tailored to Oasis Dermatology Centre.\n\nBest,\nDemo Sender\nIAWebDevelopment × Nunoon",
      researchSummary:
        "The clinic lists medical dermatology, cosmetic dermatology, and recurring treatment programmes.",
      personalizationBasis:
        "Reference the breadth of listed services and keep operational language conditional.",
      sources: [
        { label: "Clinic profile", url: "https://example.com/oasis" },
        { label: "Treatment list", url: "https://example.com/dermatology" },
      ],
      emailSource: "Verified",
      grounding: "Strong",
      status: "PENDING_APPROVAL",
      revision: 2,
      approvedRevision: null,
      approvedHash: null,
      batchId: null,
      risks: [],
      updatedAt: new Date().toISOString(),
    },
    {
      reviewId: "CLN-1068",
      contactKey: "appointments@mosaic-family.example::pilot-v3",
      campaignVersion: "pilot-v3",
      clinic: "Mosaic Family Clinic",
      city: "Abu Dhabi",
      specialty: "Family medicine",
      recipient: "appointments@mosaic-family.example",
      role: "Clinic Administrator",
      subject: "Reducing missed booking opportunities",
      body:
        "Hello Clinic Administrator,\n\nWhile reviewing Mosaic Family Clinic’s website, its family medicine and routine appointment services stood out. It gave us a useful sense of how your team presents its care.\n\nIAWebDevelopment × Nunoon would be glad to prepare a complimentary review of your appointment follow-up, reminders, and returning-patient workflows.\n\nIf this is relevant, reply and I’ll send the assessment tailored to Mosaic Family Clinic.\n\nBest,\nDemo Sender\nIAWebDevelopment × Nunoon",
      researchSummary:
        "The clinic's public profile lists family medicine and routine appointment services.",
      personalizationBasis:
        "Keep the message broad because the website supplied limited differentiating detail.",
      sources: [{ label: "Clinic profile", url: "https://example.com/mosaic" }],
      emailSource: "Inferred",
      grounding: "Low",
      status: "BLOCKED",
      revision: 1,
      approvedRevision: null,
      approvedHash: null,
      batchId: null,
      risks: [{ label: "Suppressed after draft", tone: "red" }],
      updatedAt: new Date().toISOString(),
    },
  ];

  return drafts.map((draft) => ({
    ...draft,
    draftHash: hashDraft({
      campaignVersion: draft.campaignVersion,
      contactKey: draft.contactKey,
      recipient: draft.recipient,
      subject: draft.subject,
      body: draft.body,
    }),
  }));
}
