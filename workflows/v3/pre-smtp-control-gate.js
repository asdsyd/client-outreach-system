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

function asBoolean(value) {
  return (
    value === true ||
    ['true', 'yes', '1'].includes(text(value).trim().toLowerCase())
  );
}

function populated(row) {
  return Boolean(
    text(row.suppression_key).trim() ||
      text(row.normalized_email).trim() ||
      text(row.normalized_domain).trim() ||
      text(row.review_id).trim() ||
      text(row.contact_key).trim() ||
      text(row.email).trim(),
  );
}

function reject(detail) {
  throw new Error(`PRE_SMTP_CONTROL_REJECTED: ${detail}`);
}

const current = $('Loop Locked Items').item.json ?? {};
const recipient = normalizeEmail(current.intended_recipient);
const recipientDomain = emailDomain(recipient);
if (!recipient || !recipientDomain) reject('invalid intended recipient');

const activeControls = $('Pre-SMTP Active Controls')
  .all()
  .map((item) => item.json ?? {});
const queueSentinels = $('Pre-SMTP Queue Sentinel')
  .all()
  .map((item) => item.json ?? {});

if (
  [...activeControls, ...queueSentinels].some(
    (row) => row.error || row.errorMessage || row.last_error_message,
  )
) {
  throw new Error('PRE_SMTP_CONTROL_READ_FAILED');
}

for (const row of activeControls.filter(populated)) {
  if (!asBoolean(row.active)) continue;

  const scope = text(row.scope).trim().toUpperCase();
  const controlType = text(row.control_type).trim().toUpperCase();
  if (!['SUPPRESS', 'HOLD'].includes(controlType)) {
    throw new Error('PRE_SMTP_CONTROL_INVALID: control_type');
  }

  if (scope === 'EMAIL') {
    const controlledEmail = normalizeEmail(row.normalized_email);
    if (!controlledEmail || !controlledEmail.includes('@')) {
      throw new Error('PRE_SMTP_CONTROL_INVALID: normalized_email');
    }
    if (controlledEmail === recipient) {
      reject(`active ${controlType} email control recipient=${recipient}`);
    }
  } else if (scope === 'DOMAIN') {
    const controlledDomain = normalizeDomain(row.normalized_domain);
    if (!controlledDomain || controlledDomain.includes('@')) {
      throw new Error('PRE_SMTP_CONTROL_INVALID: normalized_domain');
    }
    if (controlledDomain === recipientDomain) {
      reject(`active ${controlType} domain control recipient=${recipient}`);
    }
  } else {
    throw new Error('PRE_SMTP_CONTROL_INVALID: scope');
  }
}

for (const row of queueSentinels.filter(populated)) {
  if (text(row.send_status).trim().toUpperCase() !== 'SUPPRESSED') continue;
  const sentinelEmail = normalizeEmail(
    row.intended_recipient ?? row.email,
  );
  if (sentinelEmail === recipient) {
    reject(`queue suppression sentinel recipient=${recipient}`);
  }
}

return [
  {
    json: {
      ...current,
      pre_smtp_control_checked_at: new Date().toISOString(),
    },
  },
];
