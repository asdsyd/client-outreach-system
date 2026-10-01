const planned = $('Correlate and Plan').first().json;
const current = $input.first().json ?? {};
return [
  {
    json: {
      ...planned,
      ...current,
      slack_message: planned.slack_message,
      updated_at: new Date().toISOString(),
    },
  },
];
