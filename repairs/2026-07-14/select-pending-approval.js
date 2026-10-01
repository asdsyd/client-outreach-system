function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function canRequestApproval(row, suppressionSet) {
  const email = normalizeEmail(row.email);
  const hasValidatedDraft =
    String(row.research_status).toUpperCase() === 'RESEARCHED' &&
    Boolean(String(row.draft_subject ?? '').trim()) &&
    Boolean(String(row.draft_body ?? '').trim()) &&
    !/^(SYSTEM|SOURCE|SKIP)::/.test(String(row.contact_key ?? ''));

  return (
    Boolean(email) &&
    hasValidatedDraft &&
    String(row.approval_status).toUpperCase() === 'PENDING_APPROVAL' &&
    String(row.send_status).toUpperCase() === 'UNSENT' &&
    !suppressionSet.has(email)
  );
}

const config = $('Preflight Send Config').first().json;
const suppressionSet = new Set(
  $('Read Suppression Set')
    .all()
    .map((item) => normalizeEmail(item.json.email))
    .filter(Boolean),
);
const queue = $('Read Outreach Queue')
  .all()
  .map((item) => item.json)
  .filter((row) => row.contact_key);

const unreconciled = queue.filter(
  (row) =>
    row.campaign_version === config.campaign_version &&
    String(row.send_status).toUpperCase() === 'SENDING',
);
if (unreconciled.length) {
  throw new Error(
    `UNRECONCILED_SENDING_ROWS: count=${unreconciled.length}; reconcile SMTP/Sent history before starting another batch`,
  );
}

const selected = queue
  .filter(
    (row) =>
      row.campaign_version === config.campaign_version &&
      canRequestApproval(row, suppressionSet),
  )
  .sort((a, b) => Number(a.source_row_number) - Number(b.source_row_number))
  .slice(0, config.batch_limit);

return selected.map((row) => ({
  json: {
    ...row,
    provider: 'smtp',
    sender_name: config.sender_name,
    sender_email: config.sender_email,
    reply_to: config.reply_to,
    send_mode: config.send_mode,
    intended_recipient: normalizeEmail(row.email),
    send_to:
      config.send_mode === 'TEST'
        ? normalizeEmail(config.test_recipient)
        : normalizeEmail(row.email),
    inter_send_seconds: config.inter_send_seconds,
  },
}));
