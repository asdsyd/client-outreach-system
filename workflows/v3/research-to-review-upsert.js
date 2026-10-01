/**
 * n8n Code node, "Run Once for All Items".
 *
 * Upstream contract:
 * - item.json is the newly researched/drafted record.
 * - item.json.existing_row is the current outreach_review_queue_v3 row, or {}.
 * - A following Data Table node must UPSERT on review_id.
 */

const DRAFT_HASH_SCHEMA = 'outreach-draft-hash.v1';
const MIN_BODY_WORDS = 40;
const MAX_BODY_WORDS = 250;

function text(value) {
  return String(value ?? '');
}

function requiredText(value, field) {
  const normalized = text(value).trim();
  if (!normalized) throw new Error(`REVIEW_UPSERT_INVALID: missing ${field}`);
  return normalized;
}

function normalizeEmail(value) {
  return text(value).trim().toLowerCase();
}

function normalizeSubject(value) {
  return text(value).replace(/\s+/g, ' ').trim();
}

function normalizeBody(value) {
  return text(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

function sha256(input) {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Uint32Array(64);
  const rotr = (value, bits) => (value >>> bits) | (value << (32 - bits));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++) {
      w[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index++) {
      const s0 = rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3);
      const s1 = rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let index = 0; index < 64; index++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + choice + k[index] + w[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  return h.map((value) => value.toString(16).padStart(8, '0')).join('');
}

function draftCanonical(row) {
  return {
    schema: DRAFT_HASH_SCHEMA,
    campaign_version: requiredText(row.campaign_version, 'campaign_version'),
    contact_key: requiredText(row.contact_key, 'contact_key'),
    intended_recipient: normalizeEmail(row.intended_recipient ?? row.email),
    draft_subject: normalizeSubject(row.draft_subject),
    draft_body: normalizeBody(row.draft_body),
  };
}

function validateDraft(canonical) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(canonical.intended_recipient)) {
    throw new Error('REVIEW_UPSERT_INVALID: intended_recipient');
  }
  if (!canonical.draft_subject || canonical.draft_subject.length > 160) {
    throw new Error('REVIEW_UPSERT_INVALID: draft_subject must be 1..160 characters');
  }
  const wordCount = canonical.draft_body.split(/\s+/).filter(Boolean).length;
  if (wordCount < MIN_BODY_WORDS || wordCount > MAX_BODY_WORDS) {
    throw new Error(
      `REVIEW_UPSERT_INVALID: draft_body must be ${MIN_BODY_WORDS}..${MAX_BODY_WORDS} words`,
    );
  }
}

function cleanSources(value) {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      throw new Error('REVIEW_UPSERT_INVALID: research_sources_json is not valid JSON');
    }
  }
  return value;
}

const now = new Date().toISOString();
const seenReviewIds = new Set();

return $input.all().map((item) => {
  const incoming = item.json ?? {};
  const existing =
    incoming.existing_row && typeof incoming.existing_row === 'object'
      ? incoming.existing_row
      : {};
  const canonical = draftCanonical(incoming);
  validateDraft(canonical);
  if (
    text(existing.review_id).trim() &&
    text(existing.review_id).trim() !== text(incoming.review_id).trim()
  ) {
    throw new Error(
      `REVIEW_LOOKUP_MISMATCH: expected=${incoming.review_id}; actual=${existing.review_id}`,
    );
  }

  const draftHash = sha256(JSON.stringify(canonical));
  const reviewId =
    text(existing.review_id || incoming.review_id).trim() ||
    `rvw_${sha256(`${canonical.campaign_version}\n${canonical.contact_key}`).slice(0, 32)}`;

  if (seenReviewIds.has(reviewId)) {
    throw new Error(`REVIEW_UPSERT_DUPLICATE_INPUT: review_id=${reviewId}`);
  }
  seenReviewIds.add(reviewId);

  const currentRevision = Number(existing.draft_revision || 0);
  if (!Number.isInteger(currentRevision) || currentRevision < 0) {
    throw new Error(`REVIEW_UPSERT_INVALID_EXISTING_REVISION: review_id=${reviewId}`);
  }

  const priorHash = text(existing.draft_hash).trim();
  const contentChanged =
    !priorHash ||
    text(existing.draft_hash_schema).trim() !== DRAFT_HASH_SCHEMA ||
    priorHash !== draftHash;
  const draftRevision = contentChanged ? currentRevision + 1 : Math.max(currentRevision, 1);
  const protectedSendStates = new Set([
    'SENDING',
    'SENT',
    'SUPPRESSED',
    'NEEDS_RECONCILIATION',
  ]);
  const protectedBatchStates = new Set([
    'CONFIRMED',
    'LOCKED',
    'SENDING',
    'NEEDS_RECONCILIATION',
  ]);

  if (contentChanged && protectedSendStates.has(text(existing.send_status).toUpperCase())) {
    throw new Error(
      `REVIEW_UPSERT_IMMUTABLE_SEND_STATE: review_id=${reviewId}; send_status=${existing.send_status}`,
    );
  }
  if (contentChanged && protectedBatchStates.has(text(existing.batch_status).toUpperCase())) {
    throw new Error(
      `REVIEW_UPSERT_IMMUTABLE_BATCH_STATE: review_id=${reviewId}; batch_status=${existing.batch_status}`,
    );
  }
  if (
    !contentChanged &&
    text(existing.approval_status).toUpperCase() === 'APPROVED' &&
    (Number(existing.approved_revision) !== draftRevision ||
      text(existing.approved_hash).trim() !== draftHash ||
      !text(existing.approved_by).trim() ||
      !text(existing.approved_at).trim())
  ) {
    throw new Error(`REVIEW_UPSERT_INVALID_EXISTING_APPROVAL: review_id=${reviewId}`);
  }
  if (
    !contentChanged &&
    text(existing.batch_status || 'UNBATCHED').toUpperCase() !== 'UNBATCHED' &&
    text(existing.approval_status).toUpperCase() !== 'APPROVED'
  ) {
    throw new Error(`REVIEW_UPSERT_INVALID_EXISTING_BATCH: review_id=${reviewId}`);
  }

  const preserved = contentChanged
    ? {
        approval_status: 'PENDING_APPROVAL',
        approved_revision: 0,
        approved_hash: '',
        approved_by: '',
        approved_at: null,
        decision_reason: '',
        batch_id: '',
        batch_position: 0,
        batch_status: 'UNBATCHED',
        batch_confirmed_by: '',
        batch_confirmed_at: null,
        send_status: 'UNSENT',
        provider: '',
        provider_message_id: '',
        lock_token: '',
        locked_at: null,
      }
    : {
        approval_status: existing.approval_status || 'PENDING_APPROVAL',
        approved_revision: Number(existing.approved_revision || 0),
        approved_hash: existing.approved_hash || '',
        approved_by: existing.approved_by || '',
        approved_at: existing.approved_at || null,
        decision_reason: existing.decision_reason || '',
        batch_id: existing.batch_id || '',
        batch_position: Number(existing.batch_position || 0),
        batch_status: existing.batch_status || 'UNBATCHED',
        batch_confirmed_by: existing.batch_confirmed_by || '',
        batch_confirmed_at: existing.batch_confirmed_at || null,
        send_status: existing.send_status || 'UNSENT',
        provider: existing.provider || '',
        provider_message_id: existing.provider_message_id || '',
        lock_token: existing.lock_token || '',
        locked_at: existing.locked_at || null,
      };

  return {
    json: {
      review_id: reviewId,
      contact_key: canonical.contact_key,
      campaign_version: canonical.campaign_version,
      source_row_number: Number(incoming.source_row_number || existing.source_row_number || 0),
      company_name: requiredText(
        incoming.company_name || existing.company_name,
        'company_name',
      ),
      email: canonical.intended_recipient,
      intended_recipient: canonical.intended_recipient,
      email_validation_status: text(
        incoming.email_validation_status || existing.email_validation_status,
      ).trim(),
      website: text(incoming.website || existing.website).trim(),
      location: text(
        incoming.location || incoming.location_link || existing.location,
      ).trim(),
      language: text(incoming.language || existing.language).trim(),
      research_status: 'RESEARCHED',
      research_summary: requiredText(
        incoming.research_summary || existing.research_summary,
        'research_summary',
      ),
      research_sources_json: JSON.stringify(
        cleanSources(
          incoming.research_sources_json ?? existing.research_sources_json,
        ),
      ),
      draft_subject: canonical.draft_subject,
      draft_body: canonical.draft_body,
      draft_revision: draftRevision,
      draft_hash: draftHash,
      draft_hash_schema: DRAFT_HASH_SCHEMA,
      ...preserved,
      attempt_count: Number(
        incoming.attempt_count ?? existing.attempt_count ?? 0,
      ),
      suppressed_reason: contentChanged ? '' : existing.suppressed_reason || '',
      execution_id: String($execution.id),
      last_error_code: '',
      last_error_message: '',
      updated_by: text(incoming.updated_by || 'n8n:research-draft-v3').trim(),
      created_at: existing.created_at || now,
      updated_at: now,
    },
  };
});
