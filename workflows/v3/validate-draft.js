const merged = $input.first().json ?? {};
const output = merged.output;
const base = {
  contact_key: merged.contact_key,
  source_row_number: merged.source_row_number,
  company_name: merged.company_name,
  email: merged.email,
  website: merged.website,
  location_link: merged.location_link,
  email_validation_status: merged.email_validation_status,
  language: merged.language,
  research_status: merged.research_status,
  approval_status: merged.approval_status,
  campaign_version: merged.campaign_version,
  send_status: merged.send_status,
  attempt_count: merged.attempt_count,
  suppressed_reason: merged.suppressed_reason,
  last_error_code: merged.last_error_code,
  last_error_message: merged.last_error_message,
  execution_id: merged.execution_id,
  updated_at: merged.updated_at,
  research_summary: merged.research_summary,
  research_sources_json: merged.research_sources_json,
};
const config = $('Preflight Research Config').first().json;
let draft = output ?? merged;

if (typeof draft === 'string') {
  try {
    draft = JSON.parse(draft);
  } catch {
    throw new Error('DRAFT_MALFORMED_JSON');
  }
}

const subject = String(draft.draft_subject ?? '').trim();
const body = String(draft.draft_body ?? '').trim();
if (!subject || !body) throw new Error('DRAFT_MISSING_FIELDS');
if (/[\r\n]/.test(subject) || subject.length > 160) {
  throw new Error('DRAFT_SUBJECT_INVALID');
}
const wordCount = body.split(/\s+/).filter(Boolean).length;
if (wordCount < 40 || wordCount > 250 || body.length > 4000) {
  throw new Error('DRAFT_BODY_LENGTH_INVALID');
}

const normalize = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const normalizedBody = normalize(body);
const normalizedCompanyName = normalize(base.company_name);
if (
  !normalizedCompanyName ||
  !normalizedBody.includes(normalizedCompanyName)
) {
  throw new Error('DRAFT_MISSING_CLINIC_NAME');
}

let evidence;
try {
  evidence = JSON.parse(String(base.research_sources_json ?? '{}'));
} catch {
  throw new Error('DRAFT_RESEARCH_EVIDENCE_MALFORMED');
}
const verifiedDetails = [
  ...(Array.isArray(evidence.services) ? evidence.services : []),
  ...(Array.isArray(evidence.personalization_points)
    ? evidence.personalization_points
    : []),
]
  .map(normalize)
  .filter((detail) => detail.length >= 4);
if (
  !verifiedDetails.length ||
  !verifiedDetails.some((detail) => normalizedBody.includes(detail))
) {
  throw new Error('DRAFT_MISSING_VERIFIED_DETAIL');
}

const englishOk =
  /(?:free|complimentary) revenue[- ]recovery assessment/i.test(body);
const arabicOk =
  /تقييم مجاني/.test(body) &&
  /استرداد الإيرادات/.test(body);
if (base.language === 'ar' ? !arabicOk : !englishOk) {
  throw new Error('DRAFT_MISSING_CTA');
}
if (!body.includes(String(config.sender_name))) {
  throw new Error('DRAFT_MISSING_SENDER_IDENTITY');
}

const partnershipName = 'IAWebDevelopment × Nunoon';
const partnershipMentions = body.split(partnershipName).length - 1;
const bodyWithoutPartnership = body.split(partnershipName).join('');
if (
  partnershipMentions < 2 ||
  /\bNunoon\b/i.test(bodyWithoutPartnership) ||
  /\bdental clinics\b/i.test(body) ||
  /عيادات الأسنان/u.test(body)
) {
  throw new Error('DRAFT_GENERIC_OR_INCOMPLETE_BRAND');
}

const bannedClaims =
  /\b(guarantee(?:d|s)?|double(?:d)?|triple(?:d)?|proven results?|more patients?|increase(?:d)? revenue by|boost(?:ed)? revenue by)\b|نتائج مضمونة|مضاعفة الإيرادات|زيادة الإيرادات بنسبة/iu;
if (bannedClaims.test(`${subject} ${body}`)) {
  throw new Error('DRAFT_UNAPPROVED_CLAIM');
}
const fabricatedPain =
  /\b(?:your|the)\s+(?:clinic|team)\b[^.!?\n]{0,80}\b(?:los(?:e|es|ing)|struggl(?:e|es|ing)|miss(?:es|ing)?|leak(?:s|ing)?|suffer(?:s|ing)?)\b/iu;
if (fabricatedPain.test(body)) {
  throw new Error('DRAFT_FABRICATED_PAIN_POINT');
}

const allowedNumericEvidence = normalize(
  `${base.company_name} ${base.research_sources_json} ` +
    `${config.approved_positioning} ${config.allowed_claims}`,
);
const numericClaims = `${subject} ${body}`.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? [];
const unsupportedNumbers = numericClaims.filter(
  (claim) => !allowedNumericEvidence.includes(normalize(claim)),
);
if (unsupportedNumbers.length) {
  throw new Error(
    `DRAFT_UNSUPPORTED_NUMBER: ${unsupportedNumbers.join(', ')}`,
  );
}

return [
  {
    json: {
      ...base,
      research_status: 'RESEARCHED',
      draft_subject: subject,
      draft_body: body,
      approval_status: 'PENDING_APPROVAL',
      send_status: 'UNSENT',
      last_error_code: '',
      last_error_message: '',
      updated_at: new Date().toISOString(),
    },
    pairedItem: { item: 0 },
  },
];
