const candidate = $input.first().json ?? {};
const existing = String(candidate.review_id ?? '').trim() ? candidate : {};
return [
  {
    json: { existing_row: existing },
    pairedItem: { item: 0 },
  },
];
