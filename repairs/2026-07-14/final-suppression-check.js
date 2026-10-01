function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

const row = $('Apply Approval Decision').item.json;
const config = $('Preflight Send Config').first().json;
const suppressionSet = new Set(
  $('Re-read Suppression Before Send')
    .all()
    .map((item) => normalizeEmail(item.json.email))
    .filter(Boolean),
);

if (String(row.approval_status).toUpperCase() !== 'APPROVED') {
  throw new Error('SEND_GATE_REJECTED: approval_status');
}
if (String(row.send_status).toUpperCase() !== 'UNSENT') {
  throw new Error(`SEND_GATE_REJECTED: send_status=${row.send_status}`);
}
if (
  String(row.research_status).toUpperCase() !== 'RESEARCHED' ||
  !String(row.draft_subject ?? '').trim() ||
  !String(row.draft_body ?? '').trim() ||
  /^(SYSTEM|SOURCE|SKIP)::/.test(String(row.contact_key ?? ''))
) {
  throw new Error('SEND_GATE_REJECTED: validated draft');
}
if (suppressionSet.has(normalizeEmail(row.email))) {
  throw new Error('SEND_GATE_REJECTED: SUPPRESSED');
}
if (row.provider !== 'smtp') throw new Error('SEND_GATE_REJECTED: provider');

const sendTo = normalizeEmail(row.send_to);
if (!sendTo) throw new Error('SEND_GATE_REJECTED: missing recipient');
if (
  config.send_mode === 'TEST' &&
  sendTo !== normalizeEmail(config.test_recipient)
) {
  throw new Error('SEND_GATE_REJECTED: TEST recipient mismatch');
}
if (
  config.send_mode === 'LIVE' &&
  sendTo !== normalizeEmail(row.intended_recipient)
) {
  throw new Error('SEND_GATE_REJECTED: LIVE recipient mismatch');
}

return [{ json: row }];
