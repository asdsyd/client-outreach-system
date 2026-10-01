import assert from 'node:assert/strict';
import {
  buildEventKey,
  classifyInboundContent,
  evaluateInbound,
  evaluateInboundBatch,
  extractDsn,
  normalizeEmail,
  normalizeMessageId,
  stripQuotedHistory,
} from './inbound-classifier.mjs';

const NOW = new Date('2026-07-18T00:00:00.000Z');
const PROCESSED_AT = NOW.toISOString();
const OUTBOUND_MESSAGE_ID =
  '<692ae573-4eb3-47da-dfdd-9d6cd03339ce@iawebdev.com>';
const baseOutbound = {
  review_id: 'review-net-dental',
  item_key: 'BATCH-20260717-1869807B::1',
  contact_key: 'infodocdxb@gmail.com::2026-06-v1',
  batch_id: 'BATCH-20260717-1869807B',
  campaign_version: '2026-06-v1',
  company_name: 'Net Dental Clinic Al Karama',
  intended_recipient: 'infodocdxb@gmail.com',
  send_to: 'internal-test@example.com',
  send_mode: 'TEST',
  provider_message_id: OUTBOUND_MESSAGE_ID,
  sent_at: '2026-07-17T21:29:03.846Z',
  send_status: 'SENT',
  batch_status: 'SENT',
};

function inbound(overrides = {}) {
  return {
    mailbox: 'outreach@example.com',
    messageId: '<fixture-default@example.test>',
    from: 'internal-test@example.com',
    to: 'outreach@example.com',
    subject: 'Re: Free assessment',
    inReplyTo: OUTBOUND_MESSAGE_ID,
    references: OUTBOUND_MESSAGE_ID,
    text: '',
    headers: {},
    ...overrides,
  };
}

function evaluate(message, options = {}) {
  return evaluateInbound(message, {
    outboundRows: [baseOutbound],
    executionMode: 'TEST',
    processedAt: PROCESSED_AT,
    now: NOW,
    ...options,
  });
}

assert.equal(
  normalizeMessageId(`  ${OUTBOUND_MESSAGE_ID} extra`),
  OUTBOUND_MESSAGE_ID,
);
assert.equal(
  normalizeEmail({
    value: [{ address: 'internal-test@example.com', name: 'Demo Sender' }],
    text: '"Demo Sender" <internal-test@example.com>',
  }),
  'internal-test@example.com',
);
assert.equal(
  stripQuotedHistory(`Yes, please send the assessment.

On Fri, Jul 17, 2026 at 9:29 PM Asad wrote:
> If you are not interested, reply no.`),
  'Yes, please send the assessment.',
);
assert.equal(
  stripQuotedHistory(`No thanks — please opt me out.

On Fri, 17 Jul 2026 21:27:28 +0000, "Demo Sender | IAWebDevelopment ×
Nunoon" <outreach@example.com> wrote:
> If you prefer not to receive future messages, reply no.`),
  'No thanks — please opt me out.',
);
assert.equal(
  buildEventKey(inbound({ messageId: '', raw: 'stable raw bytes' })),
  `outreach@example.com::sha256:b4dac8e8c53950a550a8fcb57d51f07456584a6922af03ea7d4f377ef086b528`,
);
assert.equal(
  buildEventKey(
    inbound({
      messageId: '',
      raw: '',
      uidValidity: '1721260800',
      uid: 941,
    }),
  ),
  'outreach@example.com::imap:1721260800:941',
);
assert.equal(
  buildEventKey(inbound({ messageId: '', raw: '', uidValidity: '', uid: '' })),
  buildEventKey(inbound({ messageId: '', raw: '', uidValidity: '', uid: '' })),
);
assert.throws(
  () => buildEventKey(inbound({ mailbox: '' })),
  /INBOUND_MAILBOX_REQUIRED/,
);

const interested = evaluate(
  inbound({
    messageId: '<interested@example.test>',
    text: `Yes, I'm interested. Please send the assessment.`,
  }),
);
assert.equal(interested.classification, 'INTERESTED');
assert.equal(
  interested.correlation.method,
  'IN_REPLY_TO_PROVIDER_MESSAGE_ID',
);
assert.equal(interested.correlation.authoritative, true);
assert.equal(interested.notification.should_notify, true);
assert.equal(interested.notification.prefix, '[TEST] ');
assert.equal(interested.action.action_applied, false);
assert.equal(interested.action.queue_patch, null);

const optOut = evaluate(
  inbound({
    messageId: '<optout@example.test>',
    text: `No thanks — please remove me from future emails.`,
  }),
);
assert.equal(optOut.classification, 'OPTOUT');
assert.equal(optOut.correlation.outbound.intended_recipient, 'infodocdxb@gmail.com');
assert.equal(optOut.action.planned_action, 'SUPPRESS');
assert.equal(optOut.action.action_applied, false);
assert.equal(optOut.action.reason, 'TEST_MODE_NO_MUTATION');
assert.equal(optOut.action.queue_patch, null);

const runtimeLiveBatchTest = evaluateInbound(
  inbound({
    messageId: '<runtime-live-batch-test@example.test>',
    text: 'Please unsubscribe me.',
  }),
  {
    outboundRows: [baseOutbound],
    executionMode: 'LIVE',
    processedAt: PROCESSED_AT,
    now: NOW,
    shadowMode: false,
  },
);
assert.equal(runtimeLiveBatchTest.action.reason, 'TEST_MODE_NO_MUTATION');
assert.equal(runtimeLiveBatchTest.action.queue_patch, null);

const hardBounce = evaluate(
  inbound({
    messageId: '<hard-bounce@example.test>',
    from: 'MAILER-DAEMON@mx.example.test',
    inReplyTo: '',
    references: '',
    contentType: 'multipart/report; report-type=delivery-status',
    text: '',
    deliveryStatus: `Final-Recipient: rfc822; infodocdxb@gmail.com
Action: failed
Status: 5.1.1
Original-Message-ID: ${OUTBOUND_MESSAGE_ID}`,
  }),
);
assert.equal(hardBounce.classification, 'BOUNCE_HARD');
assert.equal(hardBounce.dsn.status, '5.1.1');
assert.equal(hardBounce.dsn.final_recipient, 'infodocdxb@gmail.com');
assert.equal(
  hardBounce.correlation.method,
  'ORIGINAL_PROVIDER_MESSAGE_ID',
);
assert.equal(hardBounce.action.planned_action, 'SUPPRESS');
assert.equal(hardBounce.action.action_applied, false);
assert.equal(hardBounce.action.reason, 'TEST_MODE_NO_MUTATION');

const nestedDsn = extractDsn(
  inbound({
    deliveryStatus: [
      {
        recipient: 'rfc822; infodocdxb@gmail.com',
        action: 'failed',
        status: '5.1.1',
        originalMessageId: OUTBOUND_MESSAGE_ID,
        diagnosticCode: 'smtp; 550 mailbox unavailable',
      },
    ],
  }),
);
assert.equal(nestedDsn.structural, true);
assert.equal(nestedDsn.final_recipient, 'infodocdxb@gmail.com');
assert.equal(nestedDsn.original_message_id, OUTBOUND_MESSAGE_ID);
assert.equal(nestedDsn.diagnostic_code, 'smtp; 550 mailbox unavailable');

const rawDsn = classifyInboundContent(
  inbound({
    from: 'mailer-daemon@example.test',
    inReplyTo: '',
    references: '',
    text: '',
    contentType: 'multipart/report; report-type=delivery-status',
    raw: `Content-Type: message/delivery-status

Final-Recipient: rfc822; infodocdxb@gmail.com
Action: delayed
Status: 4.2.0
Original-Message-ID: ${OUTBOUND_MESSAGE_ID}`,
  }),
);
assert.equal(rawDsn.classification, 'BOUNCE_SOFT');
assert.equal(rawDsn.dsn.original_message_id, OUTBOUND_MESSAGE_ID);

const autoReply = evaluate(
  inbound({
    messageId: '<auto-reply@example.test>',
    subject: 'Automatic reply',
    headers: { 'Auto-Submitted': 'auto-replied' },
    text: `I am away until Monday.

On Friday Asad wrote:
> If you are not interested, reply no and we will opt you out.`,
  }),
);
assert.equal(autoReply.classification, 'AUTO_REPLY');
assert.equal(autoReply.notification.should_notify, false);
assert.equal(autoReply.action.queue_patch, null);

const uncorrelatedAutoReply = evaluate(
  inbound({
    messageId: '<uncorrelated-auto-reply@example.test>',
    from: 'unknown@example.test',
    inReplyTo: '',
    references: '',
    headers: { 'Auto-Submitted': 'auto-replied' },
    text: 'I am away.',
  }),
);
assert.equal(uncorrelatedAutoReply.classification, 'AUTO_REPLY');
assert.equal(uncorrelatedAutoReply.notification.should_notify, false);
assert.equal(uncorrelatedAutoReply.action.queue_patch, null);

const unmatched = evaluate(
  inbound({
    messageId: '<unmatched@example.test>',
    from: 'unrelated@example.test',
    inReplyTo: '',
    references: '',
    text: 'Hello, what is this?',
  }),
);
assert.equal(unmatched.classification, 'UNMATCHED');
assert.equal(unmatched.correlation.method, 'NONE');
assert.equal(unmatched.notification.kind, 'UNMATCHED_INBOUND');
assert.equal(unmatched.action.action_applied, false);
assert.equal(unmatched.action.queue_patch, null);

const replayMessage = inbound({
  messageId: '<replay-interested@example.test>',
  text: `Yes, I'm interested. Please send the assessment.`,
});
const replayBatch = evaluateInboundBatch(
  [replayMessage, replayMessage, replayMessage],
  {
    outboundRows: [baseOutbound],
    executionMode: 'TEST',
    processedAt: PROCESSED_AT,
    now: NOW,
  },
);
assert.equal(replayBatch.ledgerEntries.length, 1);
assert.deepEqual(
  replayBatch.results.map((result) => result.classification),
  ['INTERESTED', 'DUPLICATE', 'DUPLICATE'],
);
assert.equal(
  replayBatch.results.filter((result) => result.notification.should_notify).length,
  1,
);
assert.equal(
  replayBatch.results.filter((result) => result.action.action_applied).length,
  0,
);

const uniqueFixtures = [interested, optOut, hardBounce, autoReply, unmatched];
assert.equal(uniqueFixtures.length, 5);
assert.equal(
  uniqueFixtures.filter(
    (result) => result.notification.kind === 'INTERESTED_REPLY',
  ).length,
  1,
);
assert.equal(
  uniqueFixtures.filter((result) => result.notification.kind === 'OPTOUT').length,
  1,
);
assert.equal(
  uniqueFixtures.filter(
    (result) => result.notification.kind === 'HARD_BOUNCE',
  ).length,
  1,
);
assert.equal(
  uniqueFixtures.filter(
    (result) => result.notification.kind === 'UNMATCHED_INBOUND',
  ).length,
  1,
);
assert.equal(
  uniqueFixtures.filter((result) => result.classification === 'AUTO_REPLY' &&
    result.notification.should_notify).length,
  0,
);
assert.equal(
  uniqueFixtures.filter((result) => result.action.action_applied).length,
  0,
);

const liveOutbound = {
  ...baseOutbound,
  send_to: 'infodocdxb@gmail.com',
  send_mode: 'LIVE',
  batch_status: 'COMPLETE',
};
const liveOptions = {
  outboundRows: [liveOutbound],
  executionMode: 'LIVE',
  processedAt: PROCESSED_AT,
  now: NOW,
};
const runtimeTestBatchLive = evaluateInbound(
  inbound({
    messageId: '<runtime-test-batch-live@example.test>',
    from: 'infodocdxb@gmail.com',
    text: 'Please unsubscribe me.',
  }),
  {
    ...liveOptions,
    executionMode: 'TEST',
  },
);
assert.equal(runtimeTestBatchLive.action.reason, 'TEST_MODE_NO_MUTATION');
assert.equal(runtimeTestBatchLive.action.queue_patch, null);

const shadowOptOut = evaluateInbound(
  inbound({
    messageId: '<shadow-optout@example.test>',
    from: 'infodocdxb@gmail.com',
    text: 'Thanks, but I am not interested. Please unsubscribe me.',
  }),
  liveOptions,
);
assert.equal(shadowOptOut.classification, 'OPTOUT');
assert.equal(shadowOptOut.correlation.control_email, 'infodocdxb@gmail.com');
assert.equal(shadowOptOut.correlation.recipient_fields_match, true);
assert.equal(shadowOptOut.correlation.inbound_identity_match, true);
assert.equal(shadowOptOut.action.planned_action, 'SUPPRESS');
assert.equal(shadowOptOut.action.action_applied, false);
assert.equal(shadowOptOut.action.reason, 'SHADOW_MODE_NO_MUTATION');
assert.equal(shadowOptOut.action.queue_patch, null);
assert.equal(shadowOptOut.action.control_record, null);

const liveOptOut = evaluateInbound(
  inbound({
    messageId: '<live-optout@example.test>',
    from: 'infodocdxb@gmail.com',
    text: 'Thanks, but I am not interested. Please unsubscribe me.',
  }),
  { ...liveOptions, shadowMode: false },
);
assert.equal(liveOptOut.action.action_applied, false);
assert.equal(liveOptOut.action.reason, 'MUTATION_PLANNED');
assert.equal(liveOptOut.action.mutation_route, 0);
assert.equal(liveOptOut.action.queue_patch, null);
assert.deepEqual(liveOptOut.action.control_record, {
  email: 'infodocdxb@gmail.com',
  control_type: 'SUPPRESS',
  reason_code: 'OPT_OUT',
  permanent: true,
  source: 'INBOUND',
  updated_by: 'n8n:inbound-v3',
  updated_at: PROCESSED_AT,
});
assert.equal(liveOptOut.action.engagement_patch.review_id, 'review-net-dental');

const liveHardBounce = evaluateInbound(
  inbound({
    messageId: '<live-hard-bounce@example.test>',
    from: 'mailer-daemon@example.test',
    inReplyTo: '',
    references: '',
    contentType: 'multipart/report; report-type=delivery-status',
    deliveryStatus: `Final-Recipient: rfc822; infodocdxb@gmail.com
Action: failed
Status: 5.1.1
Original-Message-ID: ${OUTBOUND_MESSAGE_ID}`,
  }),
  { ...liveOptions, shadowMode: false },
);
assert.equal(liveHardBounce.action.action_applied, false);
assert.equal(liveHardBounce.action.reason, 'MUTATION_PLANNED');
assert.equal(liveHardBounce.action.mutation_route, 0);
assert.equal(
  liveHardBounce.action.control_record.reason_code,
  'HARD_BOUNCE_5.1.1',
);
assert.equal(
  liveHardBounce.action.control_record.email,
  'infodocdxb@gmail.com',
);

const wrongReplySender = evaluateInbound(
  inbound({
    messageId: '<wrong-reply-sender@example.test>',
    from: 'forwarder@example.test',
    text: 'Please unsubscribe me.',
  }),
  { ...liveOptions, shadowMode: false },
);
assert.equal(wrongReplySender.correlation.authoritative, true);
assert.equal(wrongReplySender.correlation.inbound_identity_match, false);
assert.equal(wrongReplySender.action.action_applied, false);
assert.equal(wrongReplySender.action.reason, 'RECIPIENT_IDENTITY_MISMATCH');
assert.equal(wrongReplySender.action.control_record, null);

const wrongDsnRecipient = evaluateInbound(
  inbound({
    messageId: '<wrong-dsn-recipient@example.test>',
    from: 'mailer-daemon@example.test',
    inReplyTo: '',
    references: '',
    contentType: 'multipart/report; report-type=delivery-status',
    deliveryStatus: {
      finalRecipient: 'rfc822; another@example.test',
      action: 'failed',
      status: '5.1.1',
      originalMessageId: OUTBOUND_MESSAGE_ID,
    },
  }),
  { ...liveOptions, shadowMode: false },
);
assert.equal(wrongDsnRecipient.classification, 'BOUNCE_HARD');
assert.equal(wrongDsnRecipient.correlation.inbound_identity_match, false);
assert.equal(wrongDsnRecipient.action.action_applied, false);
assert.equal(wrongDsnRecipient.action.reason, 'RECIPIENT_IDENTITY_MISMATCH');

for (const outbound of [
  { ...liveOutbound, send_to: '', intended_recipient: '' },
  { ...liveOutbound, send_to: 'alias@example.test' },
]) {
  const invalidRecipientFields = evaluateInbound(
    inbound({
      messageId: `<invalid-recipient-${outbound.send_to || 'empty'}@example.test>`,
      from: 'infodocdxb@gmail.com',
      text: 'Please unsubscribe me.',
    }),
    {
      ...liveOptions,
      outboundRows: [outbound],
      shadowMode: false,
    },
  );
  assert.equal(invalidRecipientFields.correlation.recipient_fields_match, false);
  assert.equal(invalidRecipientFields.action.action_applied, false);
  assert.equal(
    invalidRecipientFields.action.reason,
    'RECIPIENT_IDENTITY_MISMATCH',
  );
}

for (const [message, expected] of [
  [
    inbound({
      messageId: '<live-interested@example.test>',
      from: 'infodocdxb@gmail.com',
      text: 'Yes, please send the assessment.',
    }),
    'INTERESTED',
  ],
  [
    inbound({
      messageId: '<live-auto@example.test>',
      from: 'infodocdxb@gmail.com',
      headers: { 'Auto-Submitted': 'auto-replied' },
      text: 'Automatic reply',
    }),
    'AUTO_REPLY',
  ],
]) {
  const result = evaluateInbound(message, liveOptions);
  assert.equal(result.classification, expected);
  assert.equal(result.action.action_applied, false);
  assert.equal(result.action.queue_patch, null);
}

const softBounce = evaluateInbound(
  inbound({
    messageId: '<soft-bounce@example.test>',
    from: 'mailer-daemon@example.test',
    inReplyTo: '',
    references: '',
    contentType: 'multipart/report; report-type=delivery-status',
    deliveryStatus: `Final-Recipient: rfc822; infodocdxb@gmail.com
Action: delayed
Status: 4.2.0
Original-Message-ID: ${OUTBOUND_MESSAGE_ID}`,
  }),
  liveOptions,
);
assert.equal(softBounce.classification, 'BOUNCE_SOFT');
assert.equal(softBounce.action.action_applied, false);
assert.equal(softBounce.action.queue_patch, null);

const fallbackOptOut = evaluateInbound(
  inbound({
    messageId: '<fallback-optout@example.test>',
    from: 'infodocdxb@gmail.com',
    inReplyTo: '',
    references: '',
    text: 'Please unsubscribe me.',
  }),
  liveOptions,
);
assert.equal(fallbackOptOut.classification, 'OPTOUT');
assert.equal(fallbackOptOut.correlation.method, 'SENDER_EMAIL_UNIQUE_RECENT');
assert.equal(fallbackOptOut.correlation.authoritative, false);
assert.equal(fallbackOptOut.action.planned_action, 'MANUAL_REVIEW');
assert.equal(fallbackOptOut.action.action_applied, false);
assert.equal(fallbackOptOut.action.reason, 'NON_AUTHORITATIVE_CORRELATION');
assert.equal(fallbackOptOut.action.queue_patch, null);

const ambiguousExact = evaluateInbound(
  inbound({
    messageId: '<ambiguous-provider-id@example.test>',
    from: 'infodocdxb@gmail.com',
    text: 'Please unsubscribe me.',
  }),
  {
    ...liveOptions,
    outboundRows: [
      liveOutbound,
      { ...liveOutbound, review_id: 'duplicate-review' },
    ],
  },
);
assert.equal(ambiguousExact.correlation.method, 'AMBIGUOUS_PROVIDER_MESSAGE_ID');
assert.equal(ambiguousExact.action.action_applied, false);
assert.equal(ambiguousExact.action.queue_patch, null);

const quotedOptOutButInterested = evaluateInbound(
  inbound({
    messageId: '<quoted-optout-interested@example.test>',
    from: 'infodocdxb@gmail.com',
    text: `Yes, please send the assessment.

On Friday Asad wrote:
> If you are not interested, reply no and we will opt you out.`,
  }),
  liveOptions,
);
assert.equal(quotedOptOutButInterested.classification, 'INTERESTED');
assert.equal(quotedOptOutButInterested.action.action_applied, false);

const quotedOptOut = classifyInboundContent(
  inbound({
    headers: { 'Auto-Submitted': 'auto-replied' },
    text: `Automatic reply

On Friday Asad wrote:
> reply no and we will opt you out`,
  }),
);
assert.equal(quotedOptOut.classification, 'AUTO_REPLY');

process.stdout.write('inbound classifier tests passed\n');
