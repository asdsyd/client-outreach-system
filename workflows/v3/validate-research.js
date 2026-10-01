const merged = $input.first().json ?? {};
const {
  output,
  intermediateSteps: rawIntermediateSteps,
  ...base
} = merged;
const intermediateSteps = Array.isArray(rawIntermediateSteps)
  ? rawIntermediateSteps
  : [];

let research = output ?? merged;
if (typeof research === 'string') {
  const trimmed = research
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    research = JSON.parse(trimmed);
  } catch (firstError) {
    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');
    if (objectStart < 0 || objectEnd <= objectStart) {
      throw new Error('RESEARCH_MALFORMED_JSON');
    }
    try {
      research = JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
    } catch {
      throw new Error('RESEARCH_MALFORMED_JSON');
    }
  }
}
if (Array.isArray(research) && research.length === 1) {
  [research] = research;
}
if (!research || typeof research !== 'object' || Array.isArray(research)) {
  throw new Error('RESEARCH_MALFORMED_JSON');
}

function collectSearchResults(value, outputRows = []) {
  if (typeof value === 'string') {
    try {
      collectSearchResults(JSON.parse(value), outputRows);
    } catch {
      // Non-JSON observation text is not source evidence.
    }
    return outputRows;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectSearchResults(entry, outputRows);
    return outputRows;
  }
  if (!value || typeof value !== 'object') return outputRows;
  if (
    /^https?:\/\//i.test(String(value.url ?? '')) &&
    String(value.content ?? '').trim()
  ) {
    outputRows.push({
      url: String(value.url).trim(),
      content: String(value.content).replace(/\s+/g, ' ').trim(),
    });
  }
  for (const nested of Object.values(value)) {
    collectSearchResults(nested, outputRows);
  }
  return outputRows;
}

const searchResults = [];
for (const step of intermediateSteps) {
  collectSearchResults(step?.observation, searchResults);
}
const websiteUrl = String(base.website ?? '').trim();
const websiteText = String(base.website_text ?? '')
  .replace(/\s+/g, ' ')
  .trim();
if (/^https?:\/\//i.test(websiteUrl) && websiteText) {
  searchResults.push({
    url: websiteUrl,
    content: websiteText,
  });
}
const normalizeUrl = (value) => String(value ?? '').trim().replace(/\/+$/, '');
const resultByUrl = new Map();
for (const result of searchResults) {
  const key = normalizeUrl(result.url);
  if (key && !resultByUrl.has(key)) resultByUrl.set(key, result);
}
if (!resultByUrl.size) throw new Error('RESEARCH_SOURCE_EVIDENCE_MISSING');

const requestedUrls = Array.isArray(research.source_urls)
  ? research.source_urls
      .map((url) => String(url).trim())
      .filter((url) => /^https?:\/\//i.test(url))
  : [];
const submittedExcerpts = Array.isArray(research.source_excerpts)
  ? research.source_excerpts.map((excerpt) => String(excerpt).trim())
  : [];
if (!requestedUrls.length || !submittedExcerpts.length) {
  throw new Error('RESEARCH_MISSING_SOURCES');
}
const missingResultUrls = requestedUrls.filter(
  (url) => !resultByUrl.has(normalizeUrl(url)),
);
if (missingResultUrls.length) {
  throw new Error(
    `RESEARCH_SOURCE_NOT_OBSERVED: ${missingResultUrls.join(', ')}`,
  );
}
const selectedResults = requestedUrls.map((url) =>
  resultByUrl.get(normalizeUrl(url)),
);
const urls = selectedResults.map((result) => result.url);
const excerpts = submittedExcerpts;

const norm = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const genericNameTokens = new Set([
  'dental',
  'clinic',
  'clinics',
  'centre',
  'center',
  'medical',
  'health',
  'care',
  'the',
  'llc',
  'uae',
  'dubai',
  'abu',
  'dhabi',
]);
const expectedName = norm(base.company_name);
const actualName = norm(research.company_name);
const expectedDistinctive = expectedName
  .split(' ')
  .filter((token) => token.length > 2 && !genericNameTokens.has(token));
const actualTokens = new Set(
  actualName.split(' ').filter((token) => token.length > 2),
);
const matchedTokens = expectedDistinctive.filter((token) =>
  actualTokens.has(token),
);
const requiredMatches = Math.max(
  1,
  Math.ceil(expectedDistinctive.length * 0.6),
);
const identityMatches = expectedDistinctive.length
  ? matchedTokens.length >= requiredMatches
  : expectedName === actualName;
if (!identityMatches) throw new Error('RESEARCH_IDENTITY_MISMATCH');

const observedEvidence = (
  `${selectedResults.map((result) => result.content).join(' ')} ` +
  `${base.website ?? ''} ${base.location_link ?? ''} ` +
  `${base.location ?? ''} ${base.website_text ?? ''}`
)
  .toLowerCase()
  .replace(/\s+/g, ' ');
const unobservedExcerpts = submittedExcerpts.filter((excerpt) => {
  const normalized = excerpt.toLowerCase().replace(/\s+/g, ' ').trim();
  return normalized.length < 20 || !observedEvidence.includes(normalized.slice(0, 80));
});
if (unobservedExcerpts.length) {
  throw new Error('RESEARCH_EXCERPT_NOT_OBSERVED');
}

const location = String(research.location ?? '').trim();
const uaeLocation =
  /(uae|united arab emirates|dubai|abu dhabi|sharjah|ajman|fujairah|ras al khaimah|umm al quwain|الإمارات|دبي|أبوظبي|الشارقة|عجمان|الفجيرة)/iu;
if (!location || !uaeLocation.test(location)) {
  throw new Error('RESEARCH_UAE_LOCATION_UNCONFIRMED');
}
if (!uaeLocation.test(`${location} ${observedEvidence}`)) {
  throw new Error('RESEARCH_UAE_EVIDENCE_MISSING');
}

const services = Array.isArray(research.services)
  ? research.services.map(String).map((value) => value.trim()).filter(Boolean)
  : [];
const personalizationPoints = Array.isArray(research.personalization_points)
  ? research.personalization_points
      .map(String)
      .map((value) => value.trim())
      .filter(Boolean)
  : [];
const normalizedObservedEvidence = norm(observedEvidence);
const detailIsObserved = (detail) => {
  const normalized = norm(detail);
  return !(
    normalized.length < 4 ||
    !normalizedObservedEvidence.includes(normalized)
  );
};
const verifiedServices = services.filter(detailIsObserved);
const verifiedPersonalization = personalizationPoints.filter(detailIsObserved);
const rejectedDetails = [...services, ...personalizationPoints].filter(
  (detail) => !detailIsObserved(detail),
);

if (!verifiedServices.length && !verifiedPersonalization.length) {
  const candidates = excerpts
    .flatMap((excerpt) =>
      excerpt.split(/\s+(?:\.\.\.|[|•])\s+|(?<=[.!?])\s+(?=[A-Z])/),
    )
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 30 && segment.length <= 220)
    .map((segment) => {
      const tokens = new Set(norm(segment).split(' '));
      const nameMatches = expectedDistinctive.filter((token) =>
        tokens.has(token),
      ).length;
      const score =
        nameMatches * 10 +
        (/\d/.test(segment) ? 0 : 5) +
        (segment.length <= 180 ? 2 : 0);
      return { segment, nameMatches, score };
    })
    .filter((candidate) => candidate.nameMatches >= requiredMatches)
    .sort((left, right) => right.score - left.score);
  if (candidates[0]) verifiedPersonalization.push(candidates[0].segment);
}
const details = [...verifiedServices, ...verifiedPersonalization];
if (!details.length) throw new Error('RESEARCH_NO_DRAFTABLE_DETAIL');

const summary =
  `${base.company_name} is confirmed in ${location}. ` +
  `Verified details: ${details.slice(0, 3).join('; ')}.`;

return [
  {
    json: {
      ...base,
      research_status: 'RESEARCHED',
      research_summary: summary,
      research_sources_json: JSON.stringify({
        source_urls: urls,
        source_excerpts: excerpts,
        services: verifiedServices,
        personalization_points: verifiedPersonalization,
        rejected_details: rejectedDetails,
        location,
      }),
      last_error_code: '',
      last_error_message: '',
      updated_at: new Date().toISOString(),
    },
    pairedItem: { item: 0 },
  },
];
