const plan = $('Correlate and Plan').first().json;
const rows = $input.all().map((item) => item.json ?? {});
const route = Number(plan.mutation_route);
const projectionUpdated = rows.some(
  (row) =>
    String(row.review_id ?? '') === String(plan.review_id ?? '') &&
    String(row.last_inbound_event_id ?? '') === String(plan.event_id ?? ''),
);

let actionApplied = false;
let failureCode = '';
let failureMessage = '';

if (route === 1) {
  actionApplied = projectionUpdated;
  if (!actionApplied) {
    failureCode = 'ENGAGEMENT_PROJECTION_NOT_CONFIRMED';
    failureMessage = 'The delivered queue row was not confirmed updated.';
  }
} else if (route === 0) {
  const controlRows = $('Upsert Contact Control')
    .all()
    .map((item) => item.json ?? {});
  const mirrorRows = $('Mirror Control to Queue')
    .all()
    .map((item) => item.json ?? {});
  const controlConfirmed = controlRows.some(
    (row) =>
      String(row.suppression_key ?? '') ===
        String($('Resolve Control Precedence').first().json.suppression_key ?? '') &&
      row.active !== false,
  );
  const mirrorConfirmed = mirrorRows.some(
    (row) =>
      String(row.review_id ?? '') ===
        `CONTROL::${String(plan.control_email ?? '')}` &&
      String(row.send_status ?? '').toUpperCase() === 'SUPPRESSED',
  );
  actionApplied = controlConfirmed && mirrorConfirmed && projectionUpdated;
  if (!actionApplied) {
    failureCode = 'CONTROL_MUTATION_NOT_CONFIRMED';
    failureMessage =
      'One or more required control, compatibility, or engagement writes were not confirmed.';
  }
}

return [
  {
    json: {
      ...plan,
      action_applied: actionApplied,
      processing_status: actionApplied ? 'APPLIED' : 'NEEDS_REVIEW',
      last_error_code: failureCode,
      last_error_message: failureMessage,
      updated_at: new Date().toISOString(),
    },
  },
];
