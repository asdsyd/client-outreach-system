import { createHash } from "node:crypto";

export const DRAFT_HASH_SCHEMA = "outreach-draft-hash.v1";
export const ITEM_HASH_SCHEMA = "outreach-batch-item-manifest.v3";
export const BATCH_HASH_SCHEMA = "outreach-batch-manifest.v3";

type DraftHashInput = {
  campaignVersion: string;
  contactKey: string;
  recipient: string;
  subject: string;
  body: string;
};

export type BatchItemCanonicalInput = {
  batchId: string;
  batchPosition: number;
  itemKey: string;
  reviewId: string;
  contactKey: string;
  campaignVersion: string;
  sendMode: "TEST" | "LIVE";
  intendedRecipient: string;
  sendTo: string;
  unsubscribeTokenHash: string;
  approvedRevision: number;
  approvedHash: string;
  subject: string;
  body: string;
  emailTemplateVersion: string;
  emailTemplateHash: string;
  emailHtmlHash: string;
  emailTextHash: string;
};

export type BatchCanonicalInput = {
  batchId: string;
  campaignVersion: string;
  sendMode: "TEST" | "LIVE";
  provider: string;
  senderName: string;
  senderEmail: string;
  replyTo: string;
  testRecipient: string;
  batchLimit: number;
  interSendSeconds: number;
  senderDomainAuthenticated: boolean;
  pilotComplete: boolean;
  items: Array<
    Pick<
      BatchItemCanonicalInput,
      | "batchPosition"
      | "itemKey"
      | "reviewId"
      | "contactKey"
      | "intendedRecipient"
      | "sendTo"
      | "approvedRevision"
      | "approvedHash"
    > & { itemManifestHash: string }
  >;
};

export function hashDraft(input: DraftHashInput): string {
  return hashJson({
    schema: DRAFT_HASH_SCHEMA,
    campaign_version: input.campaignVersion.trim(),
    contact_key: input.contactKey.trim(),
    intended_recipient: normalizeEmail(input.recipient),
    draft_subject: normalizeSubject(input.subject),
    draft_body: normalizeBody(input.body),
  });
}

export function hashBatchItem(input: BatchItemCanonicalInput): string {
  return hashJson({
    schema: ITEM_HASH_SCHEMA,
    batch_id: input.batchId.trim(),
    batch_position: input.batchPosition,
    item_key: input.itemKey.trim(),
    review_id: input.reviewId.trim(),
    contact_key: input.contactKey.trim(),
    campaign_version: input.campaignVersion.trim(),
    send_mode: input.sendMode,
    intended_recipient: normalizeEmail(input.intendedRecipient),
    send_to: normalizeEmail(input.sendTo),
    unsubscribe_token_hash: input.unsubscribeTokenHash.trim().toLowerCase(),
    approved_revision: input.approvedRevision,
    approved_hash: input.approvedHash.trim(),
    draft_hash_schema: DRAFT_HASH_SCHEMA,
    draft_subject_snapshot: normalizeSubject(input.subject),
    draft_body_snapshot: normalizeBody(input.body),
    email_template_version: input.emailTemplateVersion.trim(),
    email_template_hash: input.emailTemplateHash.trim().toLowerCase(),
    email_html_hash: input.emailHtmlHash.trim().toLowerCase(),
    email_text_hash: input.emailTextHash.trim().toLowerCase(),
  });
}

export function hashBatch(input: BatchCanonicalInput): string {
  return hashJson({
    schema: BATCH_HASH_SCHEMA,
    batch_id: input.batchId.trim(),
    campaign_version: input.campaignVersion.trim(),
    send_mode: input.sendMode,
    provider: input.provider.trim().toLowerCase(),
    sender_name: input.senderName.trim(),
    sender_email: normalizeEmail(input.senderEmail),
    reply_to: normalizeEmail(input.replyTo),
    test_recipient: normalizeEmail(input.testRecipient),
    batch_limit: input.batchLimit,
    inter_send_seconds: input.interSendSeconds,
    sender_domain_authenticated: input.senderDomainAuthenticated,
    pilot_complete: input.pilotComplete,
    items: input.items.map((item) => ({
      batch_position: item.batchPosition,
      item_key: item.itemKey.trim(),
      review_id: item.reviewId.trim(),
      contact_key: item.contactKey.trim(),
      intended_recipient: normalizeEmail(item.intendedRecipient),
      send_to: normalizeEmail(item.sendTo),
      approved_revision: item.approvedRevision,
      approved_hash: item.approvedHash.trim(),
      item_manifest_hash: item.itemManifestHash.trim(),
    })),
  });
}

export function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function hashOpaqueToken(value: string): string {
  return hashText(value);
}

export function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeSubject(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeBody(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}
