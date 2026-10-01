const row = $input.first().json ?? {};
if (
  !String(row.contact_key ?? '').trim() ||
  String(row.research_status ?? '').toUpperCase() !== 'RESEARCHING' ||
  !Number.isInteger(Number(row.attempt_count)) ||
  Number(row.attempt_count) < 1 ||
  !String(row.execution_id ?? '').trim()
) {
  throw new Error('RESEARCH_CLAIM_PERSISTENCE_MISMATCH');
}
return [{ json: row, pairedItem: { item: 0 } }];
