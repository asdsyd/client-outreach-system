const config = $input.first().json ?? {};
const required = [
  'campaign_version',
  'email_provider',
  'sender_name',
  'sender_email',
  'reply_to',
  'slack_channel',
  'send_mode',
  'batch_limit',
  'inter_send_seconds',
  'sender_domain_authenticated',
  'pilot_complete',
];
const missing = required.filter(
  (key) => config[key] === undefined || !String(config[key]).trim(),
);
if (missing.length) throw new Error(`CONFIG_MISSING: ${missing.join(', ')}`);

const provider = String(config.email_provider).trim().toLowerCase();
if (provider !== 'smtp') throw new Error('CONFIG_INVALID: email_provider must be smtp');

const mode = String(config.send_mode).trim().toUpperCase();
if (!['TEST', 'LIVE'].includes(mode)) {
  throw new Error('CONFIG_INVALID: send_mode must be TEST or LIVE');
}

const configuredLimit = Number(config.batch_limit);
if (
  !Number.isInteger(configuredLimit) ||
  configuredLimit < 1 ||
  configuredLimit > 25
) {
  throw new Error('CONFIG_INVALID: batch_limit must be 1..25');
}

const interSendSeconds = Number(config.inter_send_seconds);
if (!Number.isFinite(interSendSeconds) || interSendSeconds < 90) {
  throw new Error('CONFIG_INVALID: inter_send_seconds must be at least 90');
}

const asBool = (value) =>
  value === true || ['true', 'yes', '1'].includes(String(value).trim().toLowerCase());
const senderDomainAuthenticated = asBool(config.sender_domain_authenticated);
const pilotComplete = asBool(config.pilot_complete);
const limit = mode === 'LIVE' && !pilotComplete ? 5 : configuredLimit;
const senderEmail = String(config.sender_email).trim().toLowerCase();
const replyTo = String(config.reply_to).trim().toLowerCase();

if (senderEmail !== 'outreach@example.com') {
  throw new Error('CONFIG_INVALID: SMTP sender must be outreach@example.com');
}
if (replyTo !== senderEmail) {
  throw new Error('CONFIG_INVALID: reply_to must match the authenticated SMTP sender');
}
if (!senderDomainAuthenticated) {
  throw new Error('SENDER_DOMAIN_NOT_AUTHENTICATED: SPF_DKIM_DMARC_REQUIRED');
}

if (mode === 'TEST') {
  const testRecipient = String(config.test_recipient ?? '').trim().toLowerCase();
  const approvedTestRecipients = new Set(['internal-test@example.com']);
  if (!approvedTestRecipients.has(testRecipient)) {
    throw new Error('TEST_RECIPIENT_NOT_ALLOWLISTED');
  }
  if (limit !== 1) throw new Error('TEST_BATCH_CAP_EXCEEDED: batch_limit must be 1');
}

if (mode === 'LIVE' && !pilotComplete && configuredLimit > 5) {
  throw new Error('LIVE_PILOT_BATCH_CAP_EXCEEDED: batch_limit must be 1..5');
}

return [
  {
    json: {
      ...config,
      email_provider: provider,
      send_mode: mode,
      batch_limit: limit,
      inter_send_seconds: interSendSeconds,
      sender_domain_authenticated: senderDomainAuthenticated,
      pilot_complete: pilotComplete,
      sender_email: senderEmail,
      reply_to: replyTo,
    },
  },
];
