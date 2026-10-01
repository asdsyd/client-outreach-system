const row = $input.first().json ?? {};
if (
  !String(row.contact_key ?? '').trim() ||
  String(row.research_status ?? '').toUpperCase() !== 'RESEARCHED' ||
  String(row.approval_status ?? '').toUpperCase() !== 'PENDING_APPROVAL'
) {
  throw new Error('LEGACY_QUEUE_MIRROR_MISMATCH');
}
return [{ json: row, pairedItem: { item: 0 } }];
