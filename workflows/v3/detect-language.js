function detectLanguage(value) {
  const visibleText = String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const letters = visibleText.match(/\p{L}/gu) ?? [];
  const arabic = visibleText.match(/\p{Script=Arabic}/gu) ?? [];
  return letters.length >= 200 && arabic.length / letters.length >= 0.6
    ? 'ar'
    : 'en';
}

return $input.all().map((item, index) => {
  const explicit = String(item.json.language ?? '').trim().toLowerCase();
  const language = ['ar', 'en'].includes(explicit)
    ? explicit
    : detectLanguage(item.json.website_text);
  return {
    json: { ...item.json, language },
    pairedItem: { item: index },
  };
});
