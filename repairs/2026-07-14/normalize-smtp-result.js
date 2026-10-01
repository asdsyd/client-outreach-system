function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

const row = $('Apply Approval Decision').item.json;
const response = $input.first().json ?? {};
const accepted = Array.isArray(response.accepted)
  ? response.accepted.map(normalizeEmail)
  : [];
const rejected = Array.isArray(response.rejected)
  ? response.rejected.map(normalizeEmail)
  : [];
const target = normalizeEmail(row.send_to);
const providerMessageId = String(response.messageId ?? '').trim();

if (
  !providerMessageId ||
  !accepted.includes(target) ||
  rejected.includes(target)
) {
  const detail = JSON.stringify({ accepted, rejected, messageId: providerMessageId });
  throw new Error(
    `PROVIDER_AMBIGUOUS_ACCEPTANCE: SMTP did not confirm exactly the target recipient: ${detail}`,
  );
}

const now = new Date().toISOString();
return [
  {
    json: {
      ...row,
      approval_status: 'APPROVED',
      send_status: 'SENT',
      provider: 'smtp',
      provider_message_id: providerMessageId,
      attempt_count: Number(row.attempt_count || 0) + 1,
      execution_id: $execution.id,
      sent_at: now,
      last_error_code: '',
      last_error_message: '',
      updated_at: now,
    },
  },
];
