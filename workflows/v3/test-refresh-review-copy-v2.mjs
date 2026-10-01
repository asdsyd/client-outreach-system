import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const code = fs.readFileSync(
  new URL('./refresh-review-copy-v2.js', import.meta.url),
  'utf8',
);
const refresh = new Function(
  '$input',
  '$execution',
  `return (async () => {${code}})();`,
);

const evidence = JSON.stringify({
  services: ['Dental Implants'],
  personalization_points: ['Family-focused dental care in Dubai.'],
});
const oldBody = `Hello Precision Dental Clinic - Dubai team,

Your public information lists “Family-focused dental care in Dubai” among your services.

IAWebDevelopment × Nunoon offers a free assessment.

If this is useful, reply to this email and I will share the assessment.

If you prefer not to receive future messages, reply no and I will opt you out.

Best,
Demo Sender | IAWebDevelopment × Nunoon`;
const base = {
  review_id: 'rvw_1',
  contact_key: 'info@example.com::pilot-v1',
  campaign_version: 'pilot-v1',
  company_name: 'Precision Dental Clinic - Dubai',
  email: 'info@example.com',
  intended_recipient: 'info@example.com',
  website: 'https://example.com',
  language: 'en',
  research_status: 'RESEARCHED',
  research_sources_json: evidence,
  draft_subject: 'Free assessment for Precision Dental Clinic - Dubai',
  draft_body: oldBody,
  draft_revision: 2,
  draft_hash: 'old',
  draft_hash_schema: 'outreach-draft-hash.v1',
  approval_status: 'APPROVED',
  approved_revision: 2,
  approved_hash: 'old',
  approved_by: 'asad@example.com',
  approved_at: '2026-07-20T12:00:00.000Z',
  batch_status: 'UNBATCHED',
  send_status: 'UNSENT',
  audit_json: '[]',
};

const result = await refresh(
  {
    all: () => [
      { json: base },
      {
        json: {
          ...base,
          review_id: 'rvw_sent',
          send_status: 'SENT',
        },
      },
      {
        json: {
          ...base,
          review_id: 'rvw_skipped',
          approval_status: 'SKIPPED',
          send_status: 'SKIPPED',
        },
      },
    ],
  },
  { id: 'exec_test' },
);

assert.equal(result.length, 1);
const refreshed = result[0].json;
assert.equal(refreshed.review_id, 'rvw_1');
assert.equal(refreshed.draft_revision, 3);
assert.equal(refreshed.approval_status, 'PENDING_APPROVAL');
assert.equal(refreshed.approved_revision, 0);
assert.equal(refreshed.approved_hash, '');
assert.equal(refreshed.approved_by, '');
assert.equal(refreshed.approved_at, null);
assert.equal(refreshed.batch_status, 'UNBATCHED');
assert.equal(refreshed.send_status, 'UNSENT');
assert.equal(refreshed.execution_id, 'exec_test');
assert.equal(refreshed.updated_by, 'n8n:copy-refresh-v2');
assert.match(
  refreshed.draft_body,
  /While reviewing Precision Dental Clinic - Dubai’s website/,
);
assert.match(
  refreshed.draft_body,
  /reply to this email and I’ll send the free revenue-recovery assessment/,
);
assert.doesNotMatch(
  refreshed.draft_body,
  /public information|reply no|prefer not to receive/i,
);

const canonical = {
  schema: 'outreach-draft-hash.v1',
  campaign_version: refreshed.campaign_version,
  contact_key: refreshed.contact_key,
  intended_recipient: refreshed.intended_recipient,
  draft_subject: refreshed.draft_subject,
  draft_body: refreshed.draft_body,
};
assert.equal(
  refreshed.draft_hash,
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical))
    .digest('hex'),
);
assert.equal(
  JSON.parse(refreshed.audit_json).at(-1).previous_approval_status,
  'APPROVED',
);

const onlinePresence = await refresh(
  {
    all: () => [
      {
        json: {
          ...base,
          review_id: 'rvw_2',
          website: '',
          approval_status: 'PENDING_APPROVAL',
        },
      },
    ],
  },
  { id: 'exec_test_2' },
);
assert.match(onlinePresence[0].json.draft_body, /online presence/);
