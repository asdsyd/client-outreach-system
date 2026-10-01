export type ReviewMode = "TEST" | "LIVE";
export type ConnectionMode = "live" | "demo";

export type ReviewStatus =
  | "PENDING_APPROVAL"
  | "NEEDS_ATTENTION"
  | "APPROVED"
  | "SKIPPED"
  | "BLOCKED"
  | "QUEUED"
  | "SENDING"
  | "SENT";

export type GroundingLevel = "Strong" | "Medium" | "Low";
export type EmailSource = "Verified" | "Inferred";

export type DraftRisk = {
  label: string;
  tone: "amber" | "red";
};

export type DraftSource = {
  label: string;
  url: string;
};

export type ReviewDraft = {
  reviewId: string;
  contactKey: string;
  campaignVersion: string;
  clinic: string;
  city: string;
  specialty: string;
  recipient: string;
  role: string;
  subject: string;
  body: string;
  researchSummary: string;
  personalizationBasis: string;
  sources: DraftSource[];
  emailSource: EmailSource;
  grounding: GroundingLevel;
  status: ReviewStatus;
  revision: number;
  draftHash: string;
  approvedRevision: number | null;
  approvedHash: string | null;
  batchId: string | null;
  risks: DraftRisk[];
  updatedAt: string | null;
};

export type ReviewConfig = {
  mode: ReviewMode;
  provider: "smtp";
  senderName: string;
  senderEmail: string;
  replyTo: string;
  pacingSeconds: number;
  maxBatchSize: number;
  testRecipient: string | null;
  senderDomainAuthenticated: boolean;
  pilotComplete: boolean;
};

export type ReviewOperator = {
  displayName: string;
  email: string;
};

export type ReviewQueueResponse = {
  connection: ConnectionMode;
  operator: ReviewOperator;
  config: ReviewConfig;
  drafts: ReviewDraft[];
  syncedAt: string;
};

export type DraftUpdateInput = {
  revision: number;
  subject: string;
  body: string;
};

export type DraftDecisionInput = {
  action: "approve" | "skip" | "block" | "restore";
  revision: number;
  draftHash: string;
  reason?: string;
};

export type BatchItemInput = {
  reviewId: string;
  revision: number;
  draftHash: string;
};

export type BatchCreateInput = {
  mode: ReviewMode;
  items: BatchItemInput[];
};

export type ReviewBatch = {
  batchId: string;
  mode: ReviewMode;
  status:
    | "DRAFT"
    | "CONFIRMED"
    | "LOCKED"
    | "SENDING"
    | "COMPLETE"
    | "FAILED"
    | "NEEDS_RECONCILIATION"
    | "CANCELLED";
  itemCount: number;
  manifestHash: string;
  confirmedBy: string;
  confirmedAt: string;
};

export type DraftValidation = {
  valid: boolean;
  errors: string[];
  wordCount: number;
};

export function validateDraftContent(
  subjectValue: string,
  bodyValue: string,
): DraftValidation {
  const subject = subjectValue.trim();
  const body = bodyValue.trim();
  const words = wordCount(body);
  const errors: string[] = [];

  if (!subject) errors.push("Subject is required.");
  if (/[\r\n]/.test(subject)) errors.push("Subject must be one line.");
  if (subject.length > 160) errors.push("Subject must be 160 characters or fewer.");
  if (!body) errors.push("Message is required.");
  if (body.length > 4_000) errors.push("Message must be 4,000 characters or fewer.");
  if (words < 40 || words > 250) {
    errors.push("Message must be between 40 and 250 words.");
  }
  const partnershipName = "IAWebDevelopment × Nunoon";
  const partnershipMentions = body.split(partnershipName).length - 1;
  const bodyWithoutPartnership = body.split(partnershipName).join("");
  if (partnershipMentions < 2) {
    errors.push(
      "Message must identify IAWebDevelopment × Nunoon in the positioning and signature.",
    );
  }
  if (
    /\bNunoon\b/i.test(bodyWithoutPartnership) ||
    /\bdental clinics\b/i.test(body) ||
    /عيادات الأسنان/u.test(body)
  ) {
    errors.push(
      "Use the full IAWebDevelopment × Nunoon name and describe the recipient's clinic type.",
    );
  }
  return {
    valid: errors.length === 0,
    errors,
    wordCount: words,
  };
}

export function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
