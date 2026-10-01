import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const normalizeSource = await readFile(
  new URL('./inbound-normalize-code.js', import.meta.url),
  'utf8',
);
const correlateSource = await readFile(
  new URL('./inbound-correlate-code.js', import.meta.url),
  'utf8',
);
const normalizeRunner = new Function('$input', '$execution', normalizeSource);
const correlateRunner = new Function('$input', '$', correlateSource);

function runNormalize(input, executionId = 'runtime-test-execution') {
  return normalizeRunner(
    { first: () => ({ json: input }) },
    { id: executionId },
  )[0].json;
}

function runCorrelate(event, candidateRows, batches) {
  const nodes = {
    'Normalize and Classify': {
      first: () => ({ json: event }),
    },
    'Read Candidate Delivery Items': {
      all: () => candidateRows.map((json) => ({ json })),
    },
  };
  return correlateRunner(
    { all: () => batches.map((json) => ({ json })) },
    (name) => {
      if (!nodes[name]) throw new Error(`UNEXPECTED_NODE_LOOKUP:${name}`);
      return nodes[name];
    },
  )[0].json;
}

const OUTBOUND_MESSAGE_ID =
  '<692ae573-4eb3-47da-dfdd-9d6cd03339ce@iawebdev.com>';
const liveItem = {
  review_id: 'review-net-dental',
  item_key: 'BATCH-LIVE::1',
  contact_key: 'infodocdxb@gmail.com::2026-06-v1',
  batch_id: 'BATCH-LIVE',
  campaign_version: '2026-06-v1',
  company_name_snapshot: 'Net Dental Clinic Al Karama',
  intended_recipient: 'infodocdxb@gmail.com',
  send_to: 'infodocdxb@gmail.com',
  provider_message_id: OUTBOUND_MESSAGE_ID,
  sent_at: '2026-07-17T21:29:03.846Z',
  status: 'SENT',
};
const liveBatch = {
  batch_id: 'BATCH-LIVE',
  send_mode: 'LIVE',
  status: 'COMPLETE',
};

const stringDsn = runNormalize({
  messageId: '<dsn-string@example.test>',
  from: 'mailer-daemon@example.test',
  contentType: 'multipart/report; report-type=delivery-status',
  deliveryStatus: `Final-Recipient: rfc822; infodocdxb@gmail.com
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 mailbox unavailable
Original-Message-ID: ${OUTBOUND_MESSAGE_ID}`,
});
assert.equal(stringDsn.event_type, 'HARD_BOUNCE');
assert.equal(stringDsn.bounce_recipient, 'infodocdxb@gmail.com');
assert.equal(stringDsn.dsn_status, '5.1.1');
assert.equal(stringDsn.dsn_diagnostic, 'smtp; 550 mailbox unavailable');
assert.deepEqual(stringDsn.correlation_ids, [OUTBOUND_MESSAGE_ID]);

const nestedDsn = runNormalize({
  messageId: '<dsn-object@example.test>',
  from: 'mailer-daemon@example.test',
  deliveryStatus: [
    {
      finalRecipient: 'rfc822; infodocdxb@gmail.com',
      action: 'failed',
      status: '5.2.0',
      originalMessageId: OUTBOUND_MESSAGE_ID,
    },
  ],
});
assert.equal(nestedDsn.event_type, 'HARD_BOUNCE');
assert.equal(nestedDsn.dsn_status, '5.2.0');
assert.deepEqual(nestedDsn.correlation_ids, [OUTBOUND_MESSAGE_ID]);

const rawDsnText = `Content-Type: message/delivery-status

Final-Recipient: rfc822; infodocdxb@gmail.com
Action: delayed
Status: 4.2.0
Original-Message-ID: ${OUTBOUND_MESSAGE_ID}`;
const rawDsn = runNormalize({
  messageId: '<dsn-raw@example.test>',
  from: 'mailer-daemon@example.test',
  contentType: 'multipart/report; report-type=delivery-status',
  raw: {
    type: 'Buffer',
    data: [...Buffer.from(rawDsnText)],
  },
});
assert.equal(rawDsn.event_type, 'SOFT_BOUNCE');
assert.equal(rawDsn.bounce_recipient, 'infodocdxb@gmail.com');
assert.deepEqual(rawDsn.correlation_ids, [OUTBOUND_MESSAGE_ID]);

const uidKey = runNormalize({
  messageId: '',
  uidValidity: '1721260800',
  uid: 941,
  from: 'clinic@example.test',
  text: 'Hello',
});
assert.equal(
  uidKey.event_id,
  'outreach@example.com::imap:1721260800:941',
);

const fallbackFixture = {
  messageId: '',
  from: 'clinic@example.test',
  to: 'outreach@example.com',
  subject: 'No Message-ID',
  text: 'Deterministic fallback',
  headers: { date: 'Fri, 18 Jul 2026 01:00:00 +0400' },
};
const fallbackOne = runNormalize(fallbackFixture, 'execution-one');
const fallbackTwo = runNormalize(fallbackFixture, 'execution-two');
assert.equal(fallbackOne.event_id, fallbackTwo.event_id);
assert.match(
  fallbackOne.event_id,
  /^outreach@example\.com::sha256:[a-f0-9]{64}$/,
);
assert.equal(
  fallbackOne.body_fingerprint,
  createHash('sha256').update(fallbackFixture.text).digest('hex'),
);

const imapResolvedReply = runNormalize({
  messageId: '<imap-resolved-reply@example.test>',
  from: {
    value: [{ address: 'internal-test@example.com', name: 'Demo Sender' }],
    text: '"Demo Sender" <internal-test@example.com>',
  },
  to: {
    value: [{ address: 'outreach@example.com', name: '' }],
    text: 'outreach@example.com',
  },
  inReplyTo: OUTBOUND_MESSAGE_ID,
  text: `No thanks — please opt me out.

On Fri, 17 Jul 2026 21:27:28 +0000, "Demo Sender | IAWebDevelopment ×
Nunoon" <outreach@example.com> wrote:
> If you prefer not to receive future messages, reply no.`,
});
assert.equal(imapResolvedReply.from_email, 'internal-test@example.com');
assert.equal(imapResolvedReply.to_email, 'outreach@example.com');
assert.equal(imapResolvedReply.lookup_email, 'internal-test@example.com');
assert.equal(imapResolvedReply.event_type, 'OPT_OUT');
assert.equal(
  imapResolvedReply.body_excerpt,
  'No thanks — please opt me out.',
);

const liveReply = runNormalize({
  messageId: '<live-reply@example.test>',
  from: 'infodocdxb@gmail.com',
  to: 'outreach@example.com',
  inReplyTo: OUTBOUND_MESSAGE_ID,
  text: 'Please unsubscribe me.',
});
const liveReplyPlan = runCorrelate(liveReply, [liveItem], [liveBatch]);
assert.equal(liveReplyPlan.control_email, 'infodocdxb@gmail.com');
assert.equal(liveReplyPlan.recipient_fields_match, true);
assert.equal(liveReplyPlan.inbound_identity_match, true);
assert.equal(liveReplyPlan.mutation_authorized, true);
assert.equal(liveReplyPlan.shadow_mode, false);
assert.equal(liveReplyPlan.action_applied, false);
assert.equal(liveReplyPlan.mutation_route, 0);
assert.match(liveReplyPlan.slack_message, /Status: SUPPRESS planned/);
assert.doesNotMatch(liveReplyPlan.slack_message, /Status: SUPPRESS applied/);

const sendingBatch = {
  ...liveBatch,
  status: 'SENDING',
};
const sendingBatchOptOut = runNormalize({
  messageId: '<live-sending-batch-opt-out@example.test>',
  from: 'infodocdxb@gmail.com',
  to: 'outreach@example.com',
  inReplyTo: OUTBOUND_MESSAGE_ID,
  text: 'Please unsubscribe me.',
});
const sentItemInSendingBatchPlan = runCorrelate(
  sendingBatchOptOut,
  [liveItem],
  [sendingBatch],
);
assert.equal(sentItemInSendingBatchPlan.match_method, 'PROVIDER_MESSAGE_ID');
assert.equal(sentItemInSendingBatchPlan.authoritative_match, true);
assert.equal(sentItemInSendingBatchPlan.inbound_identity_match, true);
assert.equal(sentItemInSendingBatchPlan.mutation_authorized, true);
assert.equal(sentItemInSendingBatchPlan.control_email, 'infodocdxb@gmail.com');
assert.equal(sentItemInSendingBatchPlan.planned_action, 'SUPPRESS');
assert.equal(sentItemInSendingBatchPlan.action_applied, false);
assert.equal(sentItemInSendingBatchPlan.mutation_route, 0);

const unsentItemInSendingBatchPlan = runCorrelate(
  sendingBatchOptOut,
  [{ ...liveItem, status: 'SENDING' }],
  [sendingBatch],
);
assert.equal(unsentItemInSendingBatchPlan.match_method, 'PROVIDER_MESSAGE_ID');
assert.equal(unsentItemInSendingBatchPlan.authoritative_match, true);
assert.equal(unsentItemInSendingBatchPlan.mutation_authorized, false);
assert.equal(unsentItemInSendingBatchPlan.control_email, '');
assert.equal(unsentItemInSendingBatchPlan.action_applied, false);

const wrongSender = runNormalize({
  messageId: '<forwarded-reply@example.test>',
  from: 'forwarder@example.test',
  inReplyTo: OUTBOUND_MESSAGE_ID,
  text: 'Please unsubscribe me.',
});
const wrongSenderPlan = runCorrelate(wrongSender, [liveItem], [liveBatch]);
assert.equal(wrongSenderPlan.control_email, '');
assert.equal(wrongSenderPlan.inbound_identity_match, false);
assert.equal(wrongSenderPlan.mutation_authorized, false);
assert.equal(wrongSenderPlan.action_applied, false);

const spoofedDsnFieldInHumanReply = runNormalize({
  messageId: '<spoofed-dsn-field@example.test>',
  from: 'forwarder@example.test',
  inReplyTo: OUTBOUND_MESSAGE_ID,
  text: `Please unsubscribe me.
Final-Recipient: rfc822; infodocdxb@gmail.com`,
});
assert.equal(spoofedDsnFieldInHumanReply.event_type, 'OPT_OUT');
assert.equal(
  runCorrelate(spoofedDsnFieldInHumanReply, [liveItem], [liveBatch])
    .mutation_authorized,
  false,
);

for (const item of [
  { ...liveItem, send_to: '', intended_recipient: '' },
  { ...liveItem, send_to: 'alias@example.test' },
]) {
  const invalidPlan = runCorrelate(liveReply, [item], [liveBatch]);
  assert.equal(invalidPlan.recipient_fields_match, false);
  assert.equal(invalidPlan.mutation_authorized, false);
  assert.equal(invalidPlan.action_applied, false);
}

const liveBouncePlan = runCorrelate(stringDsn, [liveItem], [liveBatch]);
assert.equal(liveBouncePlan.control_email, 'infodocdxb@gmail.com');
assert.equal(liveBouncePlan.inbound_identity_match, true);
assert.equal(liveBouncePlan.mutation_authorized, true);
assert.equal(liveBouncePlan.action_applied, false);
assert.equal(liveBouncePlan.mutation_route, 0);

const wrongBounce = runNormalize({
  messageId: '<wrong-bounce@example.test>',
  from: 'mailer-daemon@example.test',
  contentType: 'multipart/report; report-type=delivery-status',
  deliveryStatus: {
    finalRecipient: 'rfc822; another@example.test',
    action: 'failed',
    status: '5.1.1',
    originalMessageId: OUTBOUND_MESSAGE_ID,
  },
});
const wrongBouncePlan = runCorrelate(wrongBounce, [liveItem], [liveBatch]);
assert.equal(wrongBouncePlan.inbound_identity_match, false);
assert.equal(wrongBouncePlan.mutation_authorized, false);
assert.equal(wrongBouncePlan.action_applied, false);

const testItem = {
  ...liveItem,
  batch_id: 'BATCH-TEST',
  send_to: 'internal-test@example.com',
};
const testBatch = {
  batch_id: 'BATCH-TEST',
  send_mode: 'TEST',
  status: 'COMPLETE',
};
const testReply = runNormalize({
  messageId: '<test-reply@example.test>',
  from: 'internal-test@example.com',
  inReplyTo: OUTBOUND_MESSAGE_ID,
  text: 'Please unsubscribe me.',
});
const testPlan = runCorrelate(testReply, [testItem], [testBatch]);
assert.equal(testPlan.is_test, true);
assert.equal(testPlan.control_email, '');
assert.equal(testPlan.mutation_authorized, false);
assert.equal(testPlan.action_applied, false);
assert.equal(testPlan.mutation_route, 2);

process.stdout.write('inbound runtime Code-node tests passed\n');
