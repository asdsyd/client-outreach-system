const rows = $input.all();
return [
  {
    json: {
      status: 'COMPLETE',
      processed_items: rows.length,
      execution_id: String($execution.id),
      completed_at: new Date().toISOString(),
    },
  },
];
