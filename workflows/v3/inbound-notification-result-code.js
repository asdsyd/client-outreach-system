const plan = $('Select Final Plan').first().json;
const response = $input.first().json ?? {};
const failed = Boolean(
  response.error ||
    response.errorMessage ||
    response.message === 'error' ||
    response.ok === false,
);
return [{
  json: {
    ...plan,
    notification_status: failed ? 'FAILED' : 'SENT',
    notified_at: failed ? '' : new Date().toISOString(),
    processing_status: failed ? 'NEEDS_REVIEW' : plan.processing_status,
    last_error_code: failed ? 'SLACK_NOTIFICATION_FAILED' : '',
    last_error_message: failed
      ? String(response.error?.message ?? response.errorMessage ?? response.message ?? 'Slack notification failed').slice(0, 500)
      : '',
    updated_at: new Date().toISOString(),
  },
}];
