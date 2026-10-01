return $input.all().map((item, index) => {
  const contactKey = String(item.json.contact_key ?? '').trim();
  const campaignVersion = String(item.json.campaign_version ?? '').trim();
  if (!contactKey || !campaignVersion) throw new Error('REVIEW_KEY_INVALID');
  return {
    json: {
      ...item.json,
      review_id:
        'rvw_' + encodeURIComponent(`${campaignVersion}\n${contactKey}`),
    },
    pairedItem: { item: index },
  };
});
