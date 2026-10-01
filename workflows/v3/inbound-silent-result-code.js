const plan = $('Select Final Plan').first().json;
return [{
  json: {
    ...plan,
    notification_status: 'NOT_REQUIRED',
    notified_at: '',
    updated_at: new Date().toISOString(),
  },
}];
