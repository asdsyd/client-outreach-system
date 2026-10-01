const event = $('Normalize and Classify').first().json;
const candidateRows = $('Read Candidate Delivery Items')
  .all()
  .map((item) => item.json ?? {})
  .filter((row) => row.item_key);
const batches = $input
  .all()
  .map((item) => item.json ?? {})
  .filter((row) => row.batch_id);
const text = (value) => String(value ?? '');
const normalizeEmail = (value) => {
  const raw = text(value).trim().toLowerCase();
  const bracketed = raw.match(/<([^<>\s]+@[^<>\s]+)>/);
  return (bracketed?.[1] ?? raw.match(/[^\s<>,;]+@[^\s<>,;]+/)?.[0] ?? '')
    .replace(/[)>.,;]+$/g, '');
};
const normalizeMessageId = (value) => {
  const raw = text(value).trim();
  const candidate = raw.match(/<([^<>\r\n]+)>/)?.[1] ?? raw.split(/\s+/)[0] ?? '';
  return candidate && candidate.includes('@') ? `<${candidate}>` : '';
};

const batchById = new Map(batches.map((row) => [text(row.batch_id), row]));
const correlationIds = new Set(
  (Array.isArray(event.correlation_ids) ? event.correlation_ids : [])
    .map(normalizeMessageId)
    .filter(Boolean),
);
const exactMatches = candidateRows.filter((row) => {
  const providerId = normalizeMessageId(row.provider_message_id);
  return providerId && correlationIds.has(providerId);
});
let matchedItem = null;
let matchMethod = 'UNMATCHED';
let matchConfidence = 0;
let authoritative = false;
if (exactMatches.length === 1) {
  matchedItem = exactMatches[0];
  matchMethod = 'PROVIDER_MESSAGE_ID';
  matchConfidence = 1;
  authoritative = true;
} else if (!exactMatches.length && event.lookup_email) {
  const fallbackMatches = candidateRows
    .filter((row) => {
      const batch = batchById.get(text(row.batch_id));
      const sentAt = Date.parse(row.sent_at);
      const recent =
        Number.isFinite(sentAt) && Date.now() - sentAt <= 30 * 24 * 60 * 60 * 1000;
      return (
        recent &&
        text(row.status).toUpperCase() === 'SENT' &&
        normalizeEmail(row.send_to) === normalizeEmail(event.lookup_email) &&
        batch
      );
    })
    .sort((left, right) => Date.parse(right.sent_at) - Date.parse(left.sent_at));
  if (fallbackMatches.length === 1) {
    matchedItem = fallbackMatches[0];
    matchMethod = 'UNIQUE_RECENT_SENDER';
    matchConfidence = 0.7;
  } else if (fallbackMatches.length > 1) {
    matchMethod = 'AMBIGUOUS_RECENT_SENDER';
  }
}

const matchedBatch = matchedItem
  ? batchById.get(text(matchedItem.batch_id)) ?? null
  : null;
const sendMode = text(matchedBatch?.send_mode).toUpperCase();
const intendedRecipient = normalizeEmail(matchedItem?.intended_recipient);
const actualSendTo = normalizeEmail(matchedItem?.send_to);
const replySender = normalizeEmail(event.from_email);
const dsnRecipient = normalizeEmail(event.bounce_recipient);
const isBounceEvent = ['HARD_BOUNCE', 'SOFT_BOUNCE', 'UNKNOWN_BOUNCE'].includes(
  text(event.event_type).toUpperCase(),
);
const recipientFieldsMatch = Boolean(
  intendedRecipient &&
    actualSendTo &&
    intendedRecipient === actualSendTo,
);
const inboundIdentityMatches = Boolean(
  intendedRecipient &&
    (isBounceEvent
      ? dsnRecipient && dsnRecipient === intendedRecipient
      : replySender && replySender === intendedRecipient),
);
const isTest =
  sendMode === 'TEST' ||
  Boolean(
    matchedItem &&
      !recipientFieldsMatch,
  );
const liveAuthoritative =
  Boolean(matchedItem && matchedBatch) &&
  authoritative &&
  sendMode === 'LIVE' &&
  text(matchedItem.status).toUpperCase() === 'SENT' &&
  ['SENDING', 'COMPLETE'].includes(
    text(matchedBatch.status).toUpperCase(),
  ) &&
  recipientFieldsMatch &&
  inboundIdentityMatches;
const controlEmail = liveAuthoritative ? intendedRecipient : '';

let eventType = event.event_type;
if (!matchedItem && !['AUTO_REPLY', 'HARD_BOUNCE', 'SOFT_BOUNCE', 'UNKNOWN_BOUNCE'].includes(eventType)) {
  eventType = 'UNMATCHED';
}

let controlType = '';
let reasonCode = '';
let permanent = false;
if (['INTERESTED', 'HUMAN_REPLY'].includes(eventType)) {
  controlType = 'HOLD';
  reasonCode = 'HUMAN_REPLY_REVIEW';
} else if (eventType === 'OPT_OUT') {
  controlType = 'SUPPRESS';
  reasonCode = 'OPT_OUT';
  permanent = true;
} else if (eventType === 'HARD_BOUNCE') {
  controlType = 'SUPPRESS';
  reasonCode = 'HARD_BOUNCE';
  permanent = true;
}

const shadowMode = false;
const wantsControl = Boolean(controlType);
const applyControl = wantsControl && liveAuthoritative && !shadowMode;
const updateEngagement =
  Boolean(matchedItem) &&
  liveAuthoritative &&
  !isTest &&
  !shadowMode &&
  ['INTERESTED', 'HUMAN_REPLY', 'OPT_OUT', 'HARD_BOUNCE', 'SOFT_BOUNCE', 'AUTO_REPLY'].includes(eventType);
const shouldNotify = eventType !== 'AUTO_REPLY';
const mutationRoute = applyControl ? 0 : updateEngagement ? 1 : 2;
const notificationRoute = shouldNotify ? 0 : 1;
const plannedAction = wantsControl
  ? controlType
  : updateEngagement
    ? 'UPDATE_ENGAGEMENT'
    : 'NONE';
let processingStatus = 'NEEDS_REVIEW';
if (isTest) processingStatus = 'IGNORED_TEST';
else if (eventType === 'AUTO_REPLY') processingStatus = 'APPLIED';
else if (applyControl || updateEngagement) processingStatus = 'PROCESSING';

const statusLabel = isTest
  ? 'TEST — no mutation'
  : matchedItem && (!recipientFieldsMatch || !inboundIdentityMatches)
    ? 'IDENTITY MISMATCH — manual review'
  : shadowMode
    ? 'SHADOW — no mutation'
    : applyControl
      ? `${controlType} planned`
      : 'review';
const company = text(matchedItem?.company_name_snapshot).trim();
const excerpt = text(event.body_excerpt).replace(/\s+/g, ' ').slice(0, 300);
const slackMessage = [
  `*Inbound outreach: ${eventType}*`,
  `Status: ${statusLabel}`,
  `From: ${event.from_email || 'unknown'}`,
  `Subject: ${event.subject || '(no subject)'}`,
  company ? `Contact: ${company}` : '',
  matchedItem ? `Intended: ${matchedItem.intended_recipient}` : '',
  matchedBatch ? `Batch: ${matchedBatch.batch_id} (${sendMode})` : '',
  `Match: ${matchMethod}`,
  excerpt ? `Reply: ${excerpt}` : '',
].filter(Boolean).join('\n');

const engagementStatus =
  eventType === 'INTERESTED'
    ? 'INTERESTED'
    : eventType === 'OPT_OUT'
      ? 'OPTED_OUT'
      : eventType;
const now = new Date().toISOString();
return [{
  json: {
    ...event,
    event_type: eventType,
    match_method: matchMethod,
    match_confidence: matchConfidence,
    authoritative_match: authoritative,
    review_id: text(matchedItem?.review_id),
    contact_key: text(matchedItem?.contact_key),
    campaign_version: text(matchedItem?.campaign_version),
    batch_id: text(matchedItem?.batch_id),
    item_key: text(matchedItem?.item_key),
    company_name: company,
    outbound_provider_message_id: text(matchedItem?.provider_message_id),
    send_mode: sendMode,
    intended_recipient: intendedRecipient,
    actual_send_to: actualSendTo,
    control_email: controlEmail,
    recipient_fields_match: recipientFieldsMatch,
    inbound_identity_match: inboundIdentityMatches,
    mutation_authorized: liveAuthoritative,
    is_test: isTest,
    control_type: controlType,
    reason_code: reasonCode,
    permanent,
    planned_action: plannedAction,
    action_applied: false,
    processing_status: processingStatus,
    notification_status: shouldNotify ? 'PENDING' : 'NOT_REQUIRED',
    mutation_route: mutationRoute,
    notification_route: notificationRoute,
    shadow_mode: shadowMode,
    engagement_status: engagementStatus,
    slack_message: slackMessage,
    updated_at: now,
  },
}];
