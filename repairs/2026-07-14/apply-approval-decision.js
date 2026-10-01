const row = $('Loop Approved').item.json;
const response = $input.first().json ?? {};
const approved = response.data?.approved === true;
const now = new Date().toISOString();

return [
  {
    json: {
      ...row,
      approval_approved: approved,
      approval_status: approved ? 'APPROVED' : 'REJECTED',
      send_status: approved ? 'UNSENT' : 'SKIPPED',
      suppressed_reason: approved ? '' : 'REJECTED_BY_APPROVER',
      execution_id: $execution.id,
      updated_at: now,
    },
  },
];
