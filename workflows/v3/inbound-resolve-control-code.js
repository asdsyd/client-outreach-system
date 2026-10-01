const plan = $('Correlate and Plan').first().json;
const rows = $input.all().map((item) => item.json ?? {});
const existing = rows.find((row) => row.suppression_key) ?? {};
const text = (value) => String(value ?? '').trim();
const asBoolean = (value) =>
  value === true || ['true', '1', 'yes'].includes(text(value).toLowerCase());

const controlEmail = text(plan.control_email).toLowerCase();
if (!controlEmail || !controlEmail.includes('@')) {
  throw new Error('CONTROL_EMAIL_NOT_VERIFIED');
}

const rank = (row) => {
  if (!asBoolean(row.active)) return 0;
  const type = text(row.control_type).toUpperCase();
  if (type === 'SUPPRESS' && asBoolean(row.permanent)) return 3;
  if (type === 'SUPPRESS') return 2;
  if (type === 'HOLD') return 1;
  return 0;
};

const proposed = {
  control_type: text(plan.control_type).toUpperCase(),
  permanent: asBoolean(plan.permanent),
  reason_code: text(plan.reason_code),
  reason_detail: `${text(plan.event_type)} via ${text(plan.match_method)}`,
};
const existingRank = rank(existing);
const proposedRank = rank({ ...proposed, active: true });
const preserveExisting = existingRank >= proposedRank && existingRank > 0;
const chosen = preserveExisting
  ? {
      control_type: text(existing.control_type).toUpperCase(),
      permanent: asBoolean(existing.permanent),
      reason_code: text(existing.reason_code),
      reason_detail: text(existing.reason_detail),
    }
  : proposed;

let audit = [];
try {
  const parsed = JSON.parse(text(existing.audit_json) || '[]');
  if (Array.isArray(parsed)) audit = parsed;
} catch {}

const now = new Date().toISOString();
audit = [
  ...audit.slice(-49),
  {
    action: preserveExisting ? 'CONTROL_PRESERVED' : 'CONTROL_UPSERTED',
    proposed_control_type: proposed.control_type,
    effective_control_type: chosen.control_type,
    event_id: text(plan.event_id),
    at: now,
  },
];

return [
  {
    json: {
      ...plan,
      suppression_key: `email:${controlEmail}`,
      control_email: controlEmail,
      effective_control_type: chosen.control_type,
      effective_permanent: chosen.permanent,
      effective_reason_code: chosen.reason_code,
      effective_reason_detail: chosen.reason_detail,
      control_created_by: text(existing.created_by) || 'n8n:inbound-v3',
      control_created_at: text(existing.created_at) || now,
      control_audit_json: JSON.stringify(audit),
      control_precedence_result: preserveExisting
        ? 'EXISTING_CONTROL_PRESERVED'
        : 'PROPOSED_CONTROL_APPLIED',
      updated_at: now,
    },
  },
];
