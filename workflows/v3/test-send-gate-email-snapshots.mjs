import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';

const DRAFT_HASH_SCHEMA = 'outreach-draft-hash.v1';
const ITEM_HASH_SCHEMA = 'outreach-batch-item-manifest.v3';
const BATCH_HASH_SCHEMA = 'outreach-batch-manifest.v3';
const EMAIL_TEMPLATE_VERSION = 'iawebdev-nunoon-outreach.v2';
const EMAIL_TEMPLATE_HASH =
  'ef68eb3c2ca3e5652eed80ec724c665a24ae705e13ca7086e53641b195a2f59b';
const UNSUBSCRIBE_URL_PREFIX =
  'https://n8n.example.com/webhook/nunoon-outreach-unsubscribe?token=';

const gateCode = fs.readFileSync(
  new URL('./fail-closed-send-gate.js', import.meta.url),
  'utf8',
);
const executeGateCode = new Function(
  '$',
  '$input',
  '$execution',
  `return (async () => {${gateCode}})();`,
);

function text(value) {
  return String(value ?? '');
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

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
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

function batchCanonical(batch, items) {
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
    sender_domain_authenticated:
      batch.sender_domain_authenticated_snapshot === true,
    pilot_complete: batch.pilot_complete_snapshot === true,
    items: items.map((item) => ({
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

function wrap(json) {
  return { json };
}

function makeFixture(options = {}) {
  const mode = options.mode ?? 'LIVE';
  const token = 'Ab'.repeat(21) + 'A';
  const unsubscribeUrl = UNSUBSCRIBE_URL_PREFIX + encodeURIComponent(token);
  const recipient = 'clinic@example.com';
  const testRecipient = 'test@iawebdev.com';
  const sendTo = mode === 'TEST' ? testRecipient : recipient;
  const subject = 'A practical idea for Example Clinic';
  const body =
    'Hello Dr. Example,\n\nWe noticed a useful opportunity for your clinic website.\n\nWould a short walkthrough be helpful?\n\nBest,\nDemo Sender\nIAWebDevelopment × Nunoon';
  const resolve = (candidate, fallback) =>
    typeof candidate === 'function'
      ? candidate({ unsubscribeUrl, token })
      : candidate ?? fallback;
  const emailHtml = resolve(
    options.html,
    mode === 'LIVE'
      ? `<!doctype html><html><body><p>Hello Dr. Example,</p><a href="${unsubscribeUrl}">Unsubscribe</a></body></html>`
      : '<!doctype html><html><body><p>Internal test preview</p><span>Unsubscribe unavailable in TEST.</span></body></html>',
  );
  const emailText = resolve(
    options.text,
    mode === 'LIVE'
      ? `${body}\n\nUnsubscribe: ${unsubscribeUrl}`
      : `INTERNAL TEST ONLY\nIntended recipient: ${recipient}\n\n${body}`,
  );
  const confirmedAt = new Date(Date.now() - 120_000).toISOString();
  const lockedAt = new Date(Date.now() - 60_000).toISOString();
  const batchId = 'batch-1';
  const lockToken = 'lock-1';
  const reviewId = 'review-1';
  const contactKey = 'contact-1';
  const campaignVersion = 'campaign-v3';

  const current = {
    review_id: reviewId,
    contact_key: contactKey,
    campaign_version: campaignVersion,
    email: recipient,
    intended_recipient: recipient,
    draft_subject: subject,
    draft_body: body,
    draft_revision: 1,
    approved_revision: 1,
    draft_hash_schema: DRAFT_HASH_SCHEMA,
    approval_status: 'APPROVED',
    send_status: 'UNSENT',
    batch_id: batchId,
    batch_position: 1,
    batch_status: 'LOCKED',
    lock_token: lockToken,
    locked_at: lockedAt,
    approved_by: 'reviewer@example.com',
    approved_at: confirmedAt,
    batch_confirmed_by: 'reviewer@example.com',
    batch_confirmed_at: confirmedAt,
    provider_message_id: '',
    attempt_count: 0,
    audit_json: '[]',
  };
  current.draft_hash = sha256(JSON.stringify(draftCanonical(current)));
  current.approved_hash = current.draft_hash;

  const item = {
    batch_id: batchId,
    batch_position: 1,
    item_key: 'item-1',
    review_id: reviewId,
    contact_key: contactKey,
    company_name_snapshot: 'Example Clinic',
    campaign_version: campaignVersion,
    send_mode: mode,
    intended_recipient: recipient,
    send_to: sendTo,
    unsubscribe_token: token,
    unsubscribe_token_hash: sha256(token),
    approved_revision: 1,
    approved_hash: current.approved_hash,
    draft_hash_schema: DRAFT_HASH_SCHEMA,
    draft_subject_snapshot: subject,
    draft_body_snapshot: body,
    email_template_version:
      options.templateVersion ?? EMAIL_TEMPLATE_VERSION,
    email_template_hash: options.templateHash ?? EMAIL_TEMPLATE_HASH,
    email_html_snapshot: emailHtml,
    email_text_snapshot: emailText,
    email_html_hash: sha256(emailHtml),
    email_text_hash: sha256(emailText),
    item_manifest_hash_schema: ITEM_HASH_SCHEMA,
    status: 'LOCKED',
    lock_token: lockToken,
    locked_at: lockedAt,
    attempt_count: 0,
    provider_message_id: '',
  };
  item.item_manifest_hash = sha256(JSON.stringify(itemCanonical(item)));

  const batch = {
    batch_id: batchId,
    campaign_version: campaignVersion,
    send_mode: mode,
    provider_snapshot: 'smtp',
    sender_name_snapshot: 'IAWebDevelopment × Nunoon',
    sender_email_snapshot: 'outreach@example.com',
    reply_to_snapshot: 'outreach@example.com',
    test_recipient_snapshot: testRecipient,
    batch_limit_snapshot: options.batchLimitSnapshot ?? 25,
    inter_send_seconds_snapshot: 90,
    sender_domain_authenticated_snapshot: true,
    pilot_complete_snapshot: false,
    item_count: 1,
    status: 'LOCKED',
    lock_token: lockToken,
    locked_at: lockedAt,
    confirmed_by: 'reviewer@example.com',
    confirmed_at: confirmedAt,
    manifest_hash_schema: BATCH_HASH_SCHEMA,
  };
  batch.manifest_hash = sha256(JSON.stringify(batchCanonical(batch, [item])));

  const config = {
    email_provider: 'smtp',
    sender_name: batch.sender_name_snapshot,
    sender_email: batch.sender_email_snapshot,
    reply_to: batch.reply_to_snapshot,
    campaign_version: campaignVersion,
    send_mode: mode,
    batch_limit: options.configBatchLimit ?? 25,
    inter_send_seconds: 90,
    sender_domain_authenticated: true,
    pilot_complete: false,
    test_recipient: testRecipient,
  };

  return {
    batch,
    config,
    current,
    item,
    lock: { batch_id: batchId, lock_token: lockToken },
    unsubscribeUrl,
  };
}

async function runGate(fixture) {
  const sources = {
    'Re-read Claimed Batch': [wrap(fixture.batch)],
    'Requested Batch Lock': [wrap(fixture.lock)],
    'Preflight Send Config': [wrap(fixture.config)],
    'Re-read Locked Review Rows': [wrap(fixture.current)],
    'Re-read Active Controls': [],
    'Re-read Suppression': [],
  };
  const select = (name) => ({
    first: () => sources[name]?.[0] ?? wrap({}),
    all: () => sources[name] ?? [],
  });
  return executeGateCode(
    select,
    { all: () => [wrap(fixture.item)] },
    { id: 'execution-test-1' },
  );
}

const live = makeFixture();
const liveResult = await runGate(live);
assert.equal(liveResult.length, 1);
assert.equal(liveResult[0].json.email_html, live.item.email_html_snapshot);
assert.equal(liveResult[0].json.email_text, live.item.email_text_snapshot);
assert.equal(liveResult[0].json.unsubscribe_url, live.unsubscribeUrl);
assert.equal(liveResult[0].json.email_template_version, EMAIL_TEMPLATE_VERSION);

const lowerConfirmedLimit = makeFixture({
  batchLimitSnapshot: 1,
  configBatchLimit: 5,
});
assert.equal((await runGate(lowerConfirmedLimit)).length, 1);

await assert.rejects(
  runGate(
    makeFixture({
      batchLimitSnapshot: 5,
      configBatchLimit: 1,
    }),
  ),
  /SEND_GATE_REJECTED: batch_limit exceeds current cap/,
);

const testMode = makeFixture({ mode: 'TEST' });
const testResult = await runGate(testMode);
assert.equal(testResult.length, 1);
assert.equal(testResult[0].json.unsubscribe_url, '');
assert.equal(testResult[0].json.email_html, testMode.item.email_html_snapshot);
assert.equal(testResult[0].json.email_text, testMode.item.email_text_snapshot);

const htmlDrift = makeFixture();
htmlDrift.item.email_html_snapshot += '<p>mutated after approval</p>';
await assert.rejects(
  runGate(htmlDrift),
  /SEND_GATE_REJECTED: item 1 email HTML snapshot drift/,
);

const textDrift = makeFixture();
textDrift.item.email_text_snapshot += '\nmutated after approval';
await assert.rejects(
  runGate(textDrift),
  /SEND_GATE_REJECTED: item 1 email text snapshot drift/,
);

await assert.rejects(
  runGate(makeFixture({ templateVersion: 'iawebdev-nunoon-outreach.v1' })),
  /SEND_GATE_REJECTED: item 1 email template version/,
);

await assert.rejects(
  runGate(makeFixture({ templateHash: '0'.repeat(64) })),
  /SEND_GATE_REJECTED: item 1 email template hash/,
);

for (const html of [
  '<html><body><script>alert(1)</script></body></html>',
  '<html><body><form action="https://evil.example"></form></body></html>',
  '<html><body><iframe src="https://evil.example"></iframe></body></html>',
  '<html><body><a href="java&#x73;cript:alert(1)">Open</a></body></html>',
]) {
  await assert.rejects(
    runGate(
      makeFixture({
        html: ({ unsubscribeUrl }) =>
          html.replace(
            '</body>',
            `<a href="${unsubscribeUrl}">Unsubscribe</a></body>`,
          ),
      }),
    ),
    /SEND_GATE_REJECTED: item 1 unsafe email HTML/,
  );
}

await assert.rejects(
  runGate(
    makeFixture({
      mode: 'TEST',
      html: ({ unsubscribeUrl }) =>
        `<html><body><a href="${unsubscribeUrl}">Unsubscribe</a></body></html>`,
    }),
  ),
  /SEND_GATE_REJECTED: item 1 TEST active unsubscribe/,
);

await assert.rejects(
  runGate(
    makeFixture({
      html: '<html><body><p>No unsubscribe link</p></body></html>',
      text: 'No unsubscribe link',
    }),
  ),
  /SEND_GATE_REJECTED: item 1 LIVE unsubscribe href/,
);

await assert.rejects(
  runGate(
    makeFixture({
      html: ({ unsubscribeUrl }) =>
        `<html><body><a href="${unsubscribeUrl}">Unsubscribe</a></body></html>`,
      text: ({ unsubscribeUrl }) =>
        `Unsubscribe: ${unsubscribeUrl.replace(/A$/, 'B')}`,
    }),
  ),
  /SEND_GATE_REJECTED: item 1 LIVE unsubscribe text URL/,
);

await assert.rejects(
  runGate(
    makeFixture({
      html: ({ unsubscribeUrl }) =>
        `<html><body><a href="${unsubscribeUrl}">Unsubscribe</a><a href="https://evil.example/unsubscribe">Other</a></body></html>`,
    }),
  ),
  /SEND_GATE_REJECTED: item 1 LIVE unexpected unsubscribe URL/,
);

process.stdout.write('sender email snapshot gate tests passed\n');
