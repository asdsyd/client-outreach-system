const row = $input.first().json ?? {};
if (
  !String(row.review_id ?? '').trim() ||
  !String(row.contact_key ?? '').trim() ||
  String(row.research_status ?? '').toUpperCase() !== 'RESEARCHED' ||
  String(row.approval_status ?? '').toUpperCase() !== 'PENDING_APPROVAL' ||
  String(row.send_status ?? '').toUpperCase() !== 'UNSENT'
) {
  throw new Error('REVIEW_QUEUE_UPSERT_MISMATCH');
}
return [{ json: row, pairedItem: { item: 0 } }];
