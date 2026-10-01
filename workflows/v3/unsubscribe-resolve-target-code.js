const request = $('Normalize One-Click Request').first().json ?? {};
const rows = $input
  .all()
  .map((item) => item.json ?? {})
  .filter((row) => row.unsubscribe_token_hash);
const text = (value) => String(value ?? '').trim();
const digest = text(request.unsubscribe_token_hash).toLowerCase();
const exact = rows.filter(
  (row) => text(row.unsubscribe_token_hash).toLowerCase() === digest,
);

if (request.valid_request && exact.length > 1) {
  throw new Error('UNSUBSCRIBE_TARGET_CARDINALITY');
}

const target = exact[0] ?? {};
const recipient = text(target.intended_recipient).toLowerCase();
const applyControl =
  request.valid_request === true &&
  exact.length === 1 &&
  text(target.send_mode).toUpperCase() === 'LIVE' &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);

return [
  {
    json: {
      apply_control: applyControl,
      control_email: applyControl ? recipient : '',
      suppression_key: applyControl ? `email:${recipient}` : '',
      source_review_id: applyControl ? text(target.review_id) : '',
      source_item_key: applyControl ? text(target.item_key) : '',
      source_event_id: applyControl ? `one-click:${digest}` : '',
      received_at: text(request.received_at),
    },
  },
];
