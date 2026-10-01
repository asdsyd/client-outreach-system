const target = $('Resolve Unsubscribe Target').first().json ?? {};
const rows = $input.all().map((item) => item.json ?? {});
const existing = rows.find((row) => row.suppression_key) ?? {};
const text = (value) => String(value ?? '').trim();
const asBoolean = (value) =>
  value === true || ['true', '1', 'yes'].includes(text(value).toLowerCase());

if (
  target.apply_control !== true ||
  !text(target.control_email) ||
  !text(target.suppression_key)
) {
  throw new Error('UNSUBSCRIBE_CONTROL_TARGET_INVALID');
}

const preserveExisting =
  asBoolean(existing.active) &&
  text(existing.control_type).toUpperCase() === 'SUPPRESS' &&
  asBoolean(existing.permanent);
const now = new Date().toISOString();
let audit = [];
try {
  const parsed = JSON.parse(text(existing.audit_json) || '[]');
  if (Array.isArray(parsed)) audit = parsed;
} catch {}
audit = [
  ...audit.slice(-49),
  {
    action: 'ONE_CLICK_UNSUBSCRIBE',
    source_event_id: text(target.source_event_id),
    source_item_key: text(target.source_item_key),
    at: now,
  },
];

return [
  {
    json: {
      suppression_key: text(target.suppression_key),
      control_email: text(target.control_email),
      normalized_domain: text(target.control_email).split('@')[1] || '',
      control_type: 'SUPPRESS',
      reason_code: preserveExisting
        ? text(existing.reason_code) || 'OPT_OUT'
        : 'OPT_OUT',
      reason_detail: preserveExisting
        ? text(existing.reason_detail) || 'Permanent outreach suppression'
        : 'One-click outreach unsubscribe',
      active: true,
      permanent: true,
      source_event_id: text(target.source_event_id),
      source_review_id: text(target.source_review_id),
      created_by: text(existing.created_by) || 'n8n:unsubscribe-v3',
      created_at: text(existing.created_at) || now,
      updated_by: 'n8n:unsubscribe-v3',
      updated_at: now,
      audit_json: JSON.stringify(audit),
    },
  },
];
