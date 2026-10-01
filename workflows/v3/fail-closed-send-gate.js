/**
 * n8n Code node, "Run Once for All Items".
 *
 * Required upstream node names:
 * - Re-read Claimed Batch: exactly one outreach_batches_v3 row after lock claim.
 * - Requested Batch Lock: the locally generated batch_id and lock_token.
 * - Re-read Locked Review Rows: current outreach_review_queue_v3 rows.
 * - Re-read Active Controls: active outreach_suppressions_v3 rows.
 * - Re-read Suppression: current queue suppression sentinels.
 * - Preflight Send Config: normalized current sending configuration.
 *
 * $input.all() must contain only the locked outreach_batch_items_v3 rows for
 * the claimed batch. The send node must use only this gate's output.
 */

const DRAFT_HASH_SCHEMA = 'outreach-draft-hash.v1';
const ITEM_HASH_SCHEMA = 'outreach-batch-item-manifest.v3';
const BATCH_HASH_SCHEMA = 'outreach-batch-manifest.v3';
const EMAIL_TEMPLATE_VERSION = 'iawebdev-nunoon-outreach.v2';
// Template identity shared with the deterministic review-console renderer.
// Exact HTML and text bytes are independently bound by their snapshot hashes.
const EMAIL_TEMPLATE_HASH =
  'ef68eb3c2ca3e5652eed80ec724c665a24ae705e13ca7086e53641b195a2f59b';
const UNSUBSCRIBE_URL_PREFIX =
  'https://n8n.example.com/webhook/nunoon-outreach-unsubscribe?token=';
const MAX_BATCH_SIZE = 25;
const MAX_LOCK_AGE_SECONDS = 4 * 60 * 60;

function text(value) {
  return String(value ?? '');
}

function normalizeEmail(value) {
  return text(value).trim().toLowerCase();
}

function normalizeDomain(value) {
  return text(value).trim().toLowerCase().replace(/^@/, '');
}

function emailDomain(value) {
  const email = normalizeEmail(value);
  return email.includes('@') ? email.split('@').pop() : '';
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

function decodeSchemeEntities(value) {
  return text(value)
    .replace(/&#x([0-9a-f]+);?/gi, (_, encoded) => {
      const codePoint = Number.parseInt(encoded, 16);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : '';
    })
    .replace(/&#([0-9]+);?/g, (_, encoded) => {
      const codePoint = Number.parseInt(encoded, 10);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : '';
    })
    .replace(/&colon;/gi, ':')
    .replace(/&(?:tab|newline);/gi, '');
}

function containsDangerousEmailHtml(value) {
  const html = text(value);
  if (/<\s*\/?\s*(?:script|form|iframe)\b/i.test(html)) return true;
  if (/<[^>]+\son[a-z]+\s*=/i.test(html)) return true;
  const compact = decodeSchemeEntities(html)
    .replace(/[\u0000-\u0020\u007f]+/g, '')
    .toLowerCase();
  return compact.includes('javascript:');
}

function containsActiveUnsubscribe(value) {
  const decoded = decodeSchemeEntities(value);
  return (
    /https?:\/\/[^\s"'<>]*(?:unsubscribe|opt-?out)/i.test(decoded) ||
    /mailto:[^\s"'<>]*(?:unsubscribe|opt-?out)/i.test(decoded) ||
    /href\s*=\s*["'][^"']*(?:unsubscribe|opt-?out)/i.test(decoded)
  );
}

function activeUnsubscribeTargets(value) {
  return (
    decodeSchemeEntities(value).match(
      /(?:https?:\/\/|mailto:)[^\s"'<>]*(?:unsubscribe|opt-?out)[^\s"'<>]*/gi,
    ) ?? []
  );
}

function unsubscribeUrls(value) {
  return (
    text(value).match(
      /https:\/\/n8n\.example\.com\/webhook\/nunoon-outreach-unsubscribe\?token=[^"'<>\s&]+/g,
    ) ?? []
  );
}

function asBoolean(value) {
  return value === true || ['true', 'yes', '1'].includes(text(value).trim().toLowerCase());
}

function asPositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`SEND_GATE_REJECTED: ${field}`);
  }
  return number;
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
    campaign_version: text(row.campaign_version).trim(),
    contact_key: text(row.contact_key).trim(),
    intended_recipient: normalizeEmail(row.intended_recipient ?? row.email),
    draft_subject: normalizeSubject(row.draft_subject),
    draft_body: normalizeBody(row.draft_body),
  };
}

function itemCanonical(item) {
  return {
    schema: ITEM_HASH_SCHEMA,
    batch_id: text(item.batch_id).trim(),
    batch_position: Number(item.batch_position),
    item_key: text(item.item_key).trim(),
    review_id: text(item.review_id).trim(),
    contact_key: text(item.contact_key).trim(),
    campaign_version: text(item.campaign_version).trim(),
    send_mode: text(item.send_mode).trim().toUpperCase(),
    intended_recipient: normalizeEmail(item.intended_recipient),
    send_to: normalizeEmail(item.send_to),
    unsubscribe_token_hash: text(item.unsubscribe_token_hash).trim().toLowerCase(),
    approved_revision: Number(item.approved_revision),
    approved_hash: text(item.approved_hash).trim(),
    draft_hash_schema: text(item.draft_hash_schema).trim(),
    draft_subject_snapshot: normalizeSubject(item.draft_subject_snapshot),
    draft_body_snapshot: normalizeBody(item.draft_body_snapshot),
    email_template_version: text(item.email_template_version).trim(),
    email_template_hash: text(item.email_template_hash).trim(),
    email_html_hash: text(item.email_html_hash).trim(),
    email_text_hash: text(item.email_text_hash).trim(),
  };
}

function batchCanonical(batch, sortedItems) {
  return {
    schema: BATCH_HASH_SCHEMA,
    batch_id: text(batch.batch_id).trim(),
    campaign_version: text(batch.campaign_version).trim(),
    send_mode: text(batch.send_mode).trim().toUpperCase(),
    provider: text(batch.provider_snapshot).trim().toLowerCase(),
    sender_name: text(batch.sender_name_snapshot).trim(),
    sender_email: normalizeEmail(batch.sender_email_snapshot),
    reply_to: normalizeEmail(batch.reply_to_snapshot),
    test_recipient: normalizeEmail(batch.test_recipient_snapshot),
    batch_limit: Number(batch.batch_limit_snapshot),
    inter_send_seconds: Number(batch.inter_send_seconds_snapshot),
    sender_domain_authenticated: asBoolean(batch.sender_domain_authenticated_snapshot),
    pilot_complete: asBoolean(batch.pilot_complete_snapshot),
    items: sortedItems.map((item) => ({
      batch_position: Number(item.batch_position),
      item_key: text(item.item_key).trim(),
      review_id: text(item.review_id).trim(),
      contact_key: text(item.contact_key).trim(),
      intended_recipient: normalizeEmail(item.intended_recipient),
      send_to: normalizeEmail(item.send_to),
      approved_revision: Number(item.approved_revision),
      approved_hash: text(item.approved_hash).trim(),
      item_manifest_hash: text(item.item_manifest_hash).trim(),
    })),
  };
}

function reject(condition, detail) {
  if (condition) throw new Error(`SEND_GATE_REJECTED: ${detail}`);
}

const batch = $('Re-read Claimed Batch').first().json ?? {};
const requestedLock = $('Requested Batch Lock').first().json ?? {};
const config = $('Preflight Send Config').first().json ?? {};
const currentRows = $('Re-read Locked Review Rows').all().map((item) => item.json ?? {});
const activeControlRows = $('Re-read Active Controls')
  .all()
  .map((item) => item.json ?? {});
const queueSuppressionRows = $('Re-read Suppression')
  .all()
  .map((item) => item.json ?? {});
const items = $input.all().map((item) => item.json ?? {});

reject(
  [...activeControlRows, ...queueSuppressionRows].some(
    (row) => row.error || row.errorMessage || row.last_error_message,
  ),
  'suppression read error',
);

const batchId = text(batch.batch_id).trim();
const lockToken = text(requestedLock.lock_token).trim();
reject(!batchId || batchId !== text(requestedLock.batch_id).trim(), 'batch claim mismatch');
reject(!lockToken || lockToken !== text(batch.lock_token).trim(), 'batch lock token mismatch');
reject(text(batch.status).toUpperCase() !== 'LOCKED', `batch status=${batch.status}`);
reject(!text(batch.confirmed_by).trim() || !text(batch.confirmed_at).trim(), 'batch not confirmed');
reject(text(batch.manifest_hash_schema).trim() !== BATCH_HASH_SCHEMA, 'batch hash schema');

const lockedAtMs = Date.parse(batch.locked_at);
const confirmedAtMs = Date.parse(batch.confirmed_at);
const lockAgeSeconds = (Date.now() - lockedAtMs) / 1000;
reject(!Number.isFinite(lockedAtMs), 'invalid locked_at');
reject(!Number.isFinite(confirmedAtMs), 'invalid confirmed_at');
reject(confirmedAtMs > lockedAtMs, 'batch locked before confirmation');
reject(lockAgeSeconds < -300 || lockAgeSeconds > MAX_LOCK_AGE_SECONDS, 'stale or future lock');

const itemCount = asPositiveInteger(batch.item_count, 'item_count');
reject(itemCount > MAX_BATCH_SIZE, `item_count exceeds ${MAX_BATCH_SIZE}`);
reject(items.length !== itemCount, `exact item count expected=${itemCount} actual=${items.length}`);
reject(Number(batch.batch_limit_snapshot) < itemCount, 'batch exceeds confirmed batch limit');

const mode = text(batch.send_mode).trim().toUpperCase();
reject(!['TEST', 'LIVE'].includes(mode), `send_mode=${mode}`);
reject(text(batch.provider_snapshot).trim().toLowerCase() !== 'smtp', 'provider must be smtp');
reject(text(config.email_provider).trim().toLowerCase() !== 'smtp', 'current provider must be smtp');
reject(text(batch.sender_name_snapshot).trim() !== text(config.sender_name).trim(), 'sender name drift');
reject(normalizeEmail(batch.sender_email_snapshot) !== normalizeEmail(config.sender_email), 'sender drift');
reject(normalizeEmail(batch.reply_to_snapshot) !== normalizeEmail(config.reply_to), 'reply_to drift');
reject(normalizeEmail(batch.sender_email_snapshot) !== 'outreach@example.com', 'unexpected SMTP sender');
reject(
  normalizeEmail(batch.reply_to_snapshot) !== normalizeEmail(batch.sender_email_snapshot),
  'reply_to must match SMTP sender',
);
reject(text(batch.campaign_version).trim() !== text(config.campaign_version).trim(), 'campaign drift');
reject(mode !== text(config.send_mode).trim().toUpperCase(), 'send_mode drift');
reject(
  Number(batch.batch_limit_snapshot) > Number(config.batch_limit),
  'batch_limit exceeds current cap',
);
reject(
  Number(batch.inter_send_seconds_snapshot) !== Number(config.inter_send_seconds),
  'inter_send_seconds drift',
);
reject(Number(batch.inter_send_seconds_snapshot) < 90, 'inter_send_seconds below 90');
reject(!asBoolean(batch.sender_domain_authenticated_snapshot), 'sender domain not authenticated');
reject(
  asBoolean(batch.sender_domain_authenticated_snapshot) !==
    asBoolean(config.sender_domain_authenticated),
  'sender authentication drift',
);

if (mode === 'TEST') {
  reject(itemCount !== 1, 'TEST batch must contain exactly one item');
  reject(
    normalizeEmail(batch.test_recipient_snapshot) !== normalizeEmail(config.test_recipient),
    'TEST recipient drift',
  );
  reject(!normalizeEmail(batch.test_recipient_snapshot), 'missing TEST recipient');
}
if (mode === 'LIVE' && !asBoolean(batch.pilot_complete_snapshot)) {
  reject(itemCount > 5, 'LIVE pilot batch cap exceeded');
}
reject(
  asBoolean(batch.pilot_complete_snapshot) !== asBoolean(config.pilot_complete),
  'pilot status drift',
);

const sortedItems = [...items].sort(
  (left, right) => Number(left.batch_position) - Number(right.batch_position),
);
const itemKeys = new Set();
const reviewIds = new Set();

for (let index = 0; index < sortedItems.length; index++) {
  const item = sortedItems[index];
  const position = index + 1;
  reject(text(item.batch_id).trim() !== batchId, `item ${position} batch_id`);
  reject(Number(item.batch_position) !== position, `batch position ${position}`);
  reject(text(item.status).toUpperCase() !== 'LOCKED', `item ${position} status`);
  reject(text(item.lock_token).trim() !== lockToken, `item ${position} lock`);
  reject(!Number.isFinite(Date.parse(item.locked_at)), `item ${position} locked_at`);
  reject(Number(item.attempt_count || 0) !== 0, `item ${position} already attempted`);
  reject(Boolean(text(item.provider_message_id).trim()), `item ${position} already has provider ID`);
  reject(text(item.item_manifest_hash_schema).trim() !== ITEM_HASH_SCHEMA, `item ${position} hash schema`);
  reject(text(item.draft_hash_schema).trim() !== DRAFT_HASH_SCHEMA, `item ${position} draft hash schema`);
  reject(text(item.send_mode).trim().toUpperCase() !== mode, `item ${position} send_mode`);
  reject(!text(item.item_key).trim() || itemKeys.has(item.item_key), `item ${position} duplicate item_key`);
  reject(!text(item.review_id).trim() || reviewIds.has(item.review_id), `item ${position} duplicate review_id`);
  itemKeys.add(item.item_key);
  reviewIds.add(item.review_id);

  const computedItemHash = sha256(JSON.stringify(itemCanonical(item)));
  reject(computedItemHash !== text(item.item_manifest_hash).trim(), `item ${position} manifest drift`);
  const unsubscribeToken = text(item.unsubscribe_token).trim();
  const unsubscribeTokenHash = text(item.unsubscribe_token_hash).trim().toLowerCase();
  reject(!/^[A-Za-z0-9_-]{43}$/.test(unsubscribeToken), `item ${position} unsubscribe token`);
  reject(!/^[a-f0-9]{64}$/.test(unsubscribeTokenHash), `item ${position} unsubscribe token hash`);
  reject(sha256(unsubscribeToken) !== unsubscribeTokenHash, `item ${position} unsubscribe token drift`);

  const emailTemplateVersion = text(item.email_template_version).trim();
  const emailTemplateHash = text(item.email_template_hash).trim();
  const emailHtml = text(item.email_html_snapshot);
  const emailText = text(item.email_text_snapshot);
  const emailHtmlHash = text(item.email_html_hash).trim();
  const emailTextHash = text(item.email_text_hash).trim();
  reject(
    emailTemplateVersion !== EMAIL_TEMPLATE_VERSION,
    `item ${position} email template version`,
  );
  reject(
    emailTemplateHash !== EMAIL_TEMPLATE_HASH,
    `item ${position} email template hash`,
  );
  reject(!emailHtml.trim(), `item ${position} empty email HTML snapshot`);
  reject(!emailText.trim(), `item ${position} empty email text snapshot`);
  reject(!/^[a-f0-9]{64}$/.test(emailHtmlHash), `item ${position} email HTML hash`);
  reject(!/^[a-f0-9]{64}$/.test(emailTextHash), `item ${position} email text hash`);
  reject(
    sha256(emailHtml) !== emailHtmlHash,
    `item ${position} email HTML snapshot drift`,
  );
  reject(
    sha256(emailText) !== emailTextHash,
    `item ${position} email text snapshot drift`,
  );
  reject(containsDangerousEmailHtml(emailHtml), `item ${position} unsafe email HTML`);

  const unsubscribeUrl = UNSUBSCRIBE_URL_PREFIX + encodeURIComponent(unsubscribeToken);
  if (mode === 'TEST') {
    reject(
      containsActiveUnsubscribe(emailHtml) || containsActiveUnsubscribe(emailText),
      `item ${position} TEST active unsubscribe`,
    );
  } else {
    const htmlUnsubscribeUrls = unsubscribeUrls(emailHtml);
    const textUnsubscribeUrls = unsubscribeUrls(emailText);
    const activeHtmlUnsubscribeUrls = activeUnsubscribeTargets(emailHtml);
    const activeUnsubscribeUrls = [
      ...activeHtmlUnsubscribeUrls,
      ...activeUnsubscribeTargets(emailText),
    ];
    reject(
      !activeHtmlUnsubscribeUrls.includes(unsubscribeUrl),
      `item ${position} LIVE unsubscribe href`,
    );
    reject(
      !emailText.includes(unsubscribeUrl),
      `item ${position} LIVE unsubscribe text URL`,
    );
    reject(
      htmlUnsubscribeUrls.length < 1 ||
        htmlUnsubscribeUrls.some((value) => value !== unsubscribeUrl),
      `item ${position} LIVE unsubscribe HTML token`,
    );
    reject(
      textUnsubscribeUrls.length < 1 ||
        textUnsubscribeUrls.some((value) => value !== unsubscribeUrl),
      `item ${position} LIVE unsubscribe text token`,
    );
    reject(
      activeUnsubscribeUrls.some((value) => value !== unsubscribeUrl),
      `item ${position} LIVE unexpected unsubscribe URL`,
    );
  }

  const expectedSendTo =
    mode === 'TEST'
      ? normalizeEmail(batch.test_recipient_snapshot)
      : normalizeEmail(item.intended_recipient);
  reject(normalizeEmail(item.send_to) !== expectedSendTo, `item ${position} send_to`);
}

const computedBatchHash = sha256(JSON.stringify(batchCanonical(batch, sortedItems)));
reject(computedBatchHash !== text(batch.manifest_hash).trim(), 'batch manifest drift');

const currentByReviewId = new Map();
for (const row of currentRows) {
  const reviewId = text(row.review_id).trim();
  reject(!reviewId || currentByReviewId.has(reviewId), 'current review row cardinality');
  currentByReviewId.set(reviewId, row);
}
reject(currentByReviewId.size !== itemCount, 'current queue does not equal exact batch');

const suppressedEmails = new Set();
const suppressedDomains = new Set();
for (const row of activeControlRows) {
  const populated = Boolean(
    text(row.suppression_key).trim() ||
      text(row.normalized_email).trim() ||
      text(row.normalized_domain).trim() ||
      text(row.control_type).trim(),
  );
  if (!populated || !asBoolean(row.active)) continue;

  const scope = text(row.scope).trim().toUpperCase();
  const controlType = text(row.control_type).trim().toUpperCase();
  reject(
    !['SUPPRESS', 'HOLD'].includes(controlType),
    'active control_type',
  );
  if (scope === 'EMAIL') {
    const email = normalizeEmail(row.normalized_email);
    reject(!email || !email.includes('@'), 'active control email');
    suppressedEmails.add(email);
  } else if (scope === 'DOMAIN') {
    const domain = normalizeDomain(row.normalized_domain);
    reject(!domain || domain.includes('@'), 'active control domain');
    suppressedDomains.add(domain);
  } else {
    reject(true, 'active control scope');
  }
}
for (const row of queueSuppressionRows) {
  if (text(row.send_status).trim().toUpperCase() !== 'SUPPRESSED') continue;
  const email = normalizeEmail(row.intended_recipient ?? row.email);
  if (email) suppressedEmails.add(email);
}

const gateCheckedAt = new Date().toISOString();
return sortedItems.map((item) => {
  const current = currentByReviewId.get(text(item.review_id).trim());
  reject(!current, `missing current row review_id=${item.review_id}`);
  reject(text(current.contact_key).trim() !== text(item.contact_key).trim(), 'contact_key drift');
  reject(text(current.campaign_version).trim() !== text(item.campaign_version).trim(), 'item campaign drift');
  reject(text(current.approval_status).toUpperCase() !== 'APPROVED', 'approval_status');
  reject(text(current.send_status).toUpperCase() !== 'UNSENT', `send_status=${current.send_status}`);
  reject(text(current.batch_id).trim() !== batchId, 'queue batch_id');
  reject(Number(current.batch_position) !== Number(item.batch_position), 'queue batch_position');
  reject(text(current.batch_status).toUpperCase() !== 'LOCKED', 'queue batch_status');
  reject(text(current.lock_token).trim() !== lockToken, 'queue lock token');
  reject(!Number.isFinite(Date.parse(current.locked_at)), 'queue locked_at');
  reject(text(current.draft_hash_schema).trim() !== DRAFT_HASH_SCHEMA, 'queue draft hash schema');
  reject(!text(current.approved_by).trim() || !text(current.approved_at).trim(), 'approval audit missing');
  reject(
    text(current.batch_confirmed_by).trim() !== text(batch.confirmed_by).trim(),
    'batch confirmer drift',
  );
  reject(
    Date.parse(current.batch_confirmed_at) !== Date.parse(batch.confirmed_at),
    'batch confirmation time drift',
  );
  reject(Boolean(text(current.provider_message_id).trim()), 'queue already has provider ID');

  const currentRevision = asPositiveInteger(current.draft_revision, 'current draft_revision');
  const approvedRevision = asPositiveInteger(current.approved_revision, 'current approved_revision');
  reject(currentRevision !== Number(item.approved_revision), 'draft revision drift');
  reject(approvedRevision !== Number(item.approved_revision), 'approved revision drift');

  const currentCanonical = draftCanonical(current);
  const currentHash = sha256(JSON.stringify(currentCanonical));
  reject(currentHash !== text(current.draft_hash).trim(), 'current draft hash invalid');
  reject(currentHash !== text(current.approved_hash).trim(), 'current approval hash drift');
  reject(currentHash !== text(item.approved_hash).trim(), 'batch approval hash drift');
  reject(
    normalizeSubject(current.draft_subject) !== normalizeSubject(item.draft_subject_snapshot),
    'subject snapshot drift',
  );
  reject(
    normalizeBody(current.draft_body) !== normalizeBody(item.draft_body_snapshot),
    'body snapshot drift',
  );

  const recipient = normalizeEmail(current.intended_recipient ?? current.email);
  reject(recipient !== normalizeEmail(item.intended_recipient), 'recipient drift');
  reject(
    suppressedEmails.has(recipient) || suppressedDomains.has(emailDomain(recipient)),
    `suppressed recipient=${recipient}`,
  );

  return {
    json: {
      batch_id: batchId,
      batch_position: Number(item.batch_position),
      item_key: text(item.item_key).trim(),
      review_id: text(item.review_id).trim(),
      contact_key: text(item.contact_key).trim(),
      company_name: text(item.company_name_snapshot).trim(),
      intended_recipient: recipient,
      send_to: normalizeEmail(item.send_to),
      unsubscribe_token: text(item.unsubscribe_token).trim(),
      unsubscribe_token_hash: text(item.unsubscribe_token_hash).trim().toLowerCase(),
      unsubscribe_url:
        mode === 'LIVE'
          ? UNSUBSCRIBE_URL_PREFIX +
            encodeURIComponent(text(item.unsubscribe_token).trim())
          : '',
      draft_subject: normalizeSubject(item.draft_subject_snapshot),
      draft_body: normalizeBody(item.draft_body_snapshot),
      email_template_version: text(item.email_template_version).trim(),
      email_template_hash: text(item.email_template_hash).trim(),
      email_html: text(item.email_html_snapshot),
      email_text: text(item.email_text_snapshot),
      email_html_hash: text(item.email_html_hash).trim(),
      email_text_hash: text(item.email_text_hash).trim(),
      approved_revision: Number(item.approved_revision),
      approved_hash: text(item.approved_hash).trim(),
      item_attempt_count: Number(item.attempt_count || 0) + 1,
      queue_attempt_count: Number(current.attempt_count || 0) + 1,
      audit_json: text(current.audit_json).trim(),
      provider: 'smtp',
      sender_name: text(batch.sender_name_snapshot).trim(),
      sender_email: normalizeEmail(batch.sender_email_snapshot),
      reply_to: normalizeEmail(batch.reply_to_snapshot),
      send_mode: mode,
      inter_send_seconds: Number(batch.inter_send_seconds_snapshot),
      lock_token: lockToken,
      manifest_hash: text(batch.manifest_hash).trim(),
      gate_checked_at: gateCheckedAt,
      execution_id: String($execution.id),
    },
  };
});
