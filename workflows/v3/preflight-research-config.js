const c = $input.first().json ?? {};
const required = [
  'campaign_version',
  'sender_name',
  'sender_email',
  'reply_to',
  'approved_positioning',
  'allowed_claims',
];
const missing = required.filter((key) => !String(c[key] ?? '').trim());
if (missing.length) {
  throw new Error(`CONFIG_MISSING: ${missing.join(', ')}`);
}

const mode = String(c.send_mode).toUpperCase();
if (!['TEST', 'LIVE'].includes(mode)) {
  throw new Error('CONFIG_INVALID: send_mode must be TEST or LIVE');
}

// Keep the sender's batch limit separate from research throughput. The
// research workflow exposes its own limit as batch_limit only inside this
// execution because the eligibility node already consumes that field.
const sendBatchLimit = Number(c.batch_limit);
if (
  !Number.isInteger(sendBatchLimit) ||
  sendBatchLimit < 1 ||
  sendBatchLimit > 25
) {
  throw new Error('CONFIG_INVALID: batch_limit must be 1..25');
}
if (mode === 'TEST' && sendBatchLimit > 3) {
  throw new Error('TEST_BATCH_CAP_EXCEEDED: sender batch_limit must be 1..3');
}

// The connected Sheet is currently read-only to the automation identity, so
// use 50 as the explicit review-preparation default when the optional column is
// absent. This value is never read by the sender workflow.
const researchBatchLimit = Number(c.research_batch_limit || 50);
if (
  !Number.isInteger(researchBatchLimit) ||
  researchBatchLimit < 1 ||
  researchBatchLimit > 50
) {
  throw new Error('CONFIG_INVALID: research_batch_limit must be 1..50');
}

const maxResearchAttempts = Number(c.max_research_attempts || 6);
if (
  !Number.isInteger(maxResearchAttempts) ||
  maxResearchAttempts < 1 ||
  maxResearchAttempts > 10
) {
  throw new Error('CONFIG_INVALID: max_research_attempts must be 1..10');
}

const maxSkippedRecords = Number(
  c.max_skipped_records_per_run ||
    Math.min(250, Math.max(25, researchBatchLimit * 5)),
);
if (
  !Number.isInteger(maxSkippedRecords) ||
  maxSkippedRecords < 0 ||
  maxSkippedRecords > 250
) {
  throw new Error(
    'CONFIG_INVALID: max_skipped_records_per_run must be 0..250',
  );
}

return [
  {
    json: {
      ...c,
      send_mode: mode,
      send_batch_limit: sendBatchLimit,
      research_batch_limit: researchBatchLimit,
      batch_limit: researchBatchLimit,
      max_research_attempts: maxResearchAttempts,
      max_skipped_records_per_run: maxSkippedRecords,
      inter_send_seconds: Number(c.inter_send_seconds || 90),
    },
  },
];
