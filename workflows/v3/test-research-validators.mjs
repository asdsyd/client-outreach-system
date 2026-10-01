import assert from 'node:assert/strict';
import fs from 'node:fs';

function compile(name, args) {
  const code = fs.readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
  return new Function(...args, `return (async () => {${code}})();`);
}

const validateResearch = compile('validate-research.js', ['$input']);
const validateDraft = compile('validate-draft.js', ['$input', '$']);
const buildDraft = compile('build-draft.js', ['$input', '$']);
const detectLanguage = compile('detect-language.js', ['$input']);

const url = 'https://example.com/net-dental-karama';
const excerpt =
  'Net Dental Clinic Al Karama is a dental clinic in Dubai, UAE offering root canal treatment and preventive dental care.';
const steps = [
  {
    action: {
      tool: 'Tavily Search',
      toolInput: { query: 'Net Dental Clinic Al Karama Dubai UAE' },
    },
    observation: {
      results: [{ url, content: excerpt }],
    },
  },
];
const base = {
  contact_key: 'info@example.com::pilot-v1',
  campaign_version: 'pilot-v1',
  company_name: 'Net Dental Clinic Al Karama',
  email: 'info@example.com',
  language: 'en',
  website: url,
  website_text: excerpt,
  location_link: 'https://www.google.com/maps/place/Net+Dental+Clinic+Dubai',
  attempt_count: 1,
};
const researchOutput = {
  company_name: 'Net Dental Clinic Al Karama',
  location: 'Al Karama, Dubai, UAE',
  services: ['root canal treatment'],
  personalization_points: ['preventive dental care'],
  source_urls: [url],
  source_excerpts: [excerpt],
  research_summary: 'This free text is replaced by a deterministic summary.',
};

async function runResearch(output = researchOutput, intermediateSteps = steps) {
  return validateResearch({
    first: () => ({ json: { ...base, output, intermediateSteps } }),
  });
}

const researched = await runResearch();
assert.equal(researched[0].json.research_status, 'RESEARCHED');
assert.match(researched[0].json.research_summary, /Verified details:/);
assert.equal(researched[0].json.output, undefined);
assert.deepEqual(researched[0].pairedItem, { item: 0 });

await assert.rejects(
  runResearch({
    ...researchOutput,
    company_name: 'Net Medical Center',
  }),
  /RESEARCH_IDENTITY_MISMATCH/,
);
await assert.rejects(
  runResearch({
    ...researchOutput,
    location: 'London, UK',
  }),
  /RESEARCH_UAE_LOCATION_UNCONFIRMED/,
);
const fallbackResearch = await runResearch({
  ...researchOutput,
  services: ['invented service label'],
  personalization_points: [],
});
const fallbackEvidence = JSON.parse(
  fallbackResearch[0].json.research_sources_json,
);
assert.deepEqual(fallbackEvidence.services, []);
assert.equal(fallbackEvidence.personalization_points.length, 1);
assert.deepEqual(fallbackEvidence.rejected_details, [
  'invented service label',
]);
await assert.rejects(
  runResearch(
    {
      ...researchOutput,
      source_urls: ['https://unobserved.example/clinic'],
    },
    [],
  ),
  /RESEARCH_SOURCE_NOT_OBSERVED/,
);

const websiteOnlyResearch = await runResearch(
  `Here is the requested JSON:
\`\`\`json
${JSON.stringify(researchOutput)}
\`\`\``,
  [],
);
assert.equal(websiteOnlyResearch[0].json.research_status, 'RESEARCHED');
assert.deepEqual(
  JSON.parse(websiteOnlyResearch[0].json.research_sources_json).source_urls,
  [url],
);

const validatedBase = researched[0].json;
const config = {
  sender_name: 'Demo Sender | IAWebDevelopment × Nunoon',
  approved_positioning:
    'IAWebDevelopment × Nunoon offers clinics like yours a free assessment of follow-up, billing, collections, and revenue-cycle operations to identify potential process gaps without assuming any already exist.',
  allowed_claims:
    'Free assessment; identify potential process gaps; improve follow-up visibility. No guaranteed outcomes.',
};
const select = (name) => {
  assert.equal(name, 'Preflight Research Config');
  return { first: () => ({ json: config }) };
};
const validBody = `Hello Net Dental Clinic Al Karama team,

While reviewing Net Dental Clinic Al Karama’s website, “root canal treatment” stood out among the services you offer. It gave us a useful sense of how your team presents its care.

IAWebDevelopment × Nunoon would be glad to prepare a complimentary assessment of your follow-up, billing, collections, and revenue-cycle workflows—focused on practical opportunities without assuming any gaps already exist.

If this is relevant, reply to this email and I’ll send the free revenue-recovery assessment tailored to Net Dental Clinic Al Karama.

Best,
Demo Sender | IAWebDevelopment × Nunoon`;

async function runDraft(draft) {
  return validateDraft(
    {
      first: () => ({
        json: {
          ...validatedBase,
          output: {
            draft_subject: 'A review for Net Dental Clinic Al Karama',
            draft_body: validBody,
            ...draft,
          },
        },
      }),
    },
    select,
  );
}

const drafted = await runDraft({});
assert.equal(drafted[0].json.approval_status, 'PENDING_APPROVAL');
assert.equal(drafted[0].json.send_status, 'UNSENT');
assert.equal(drafted[0].json.attempt_count, 1);
assert.equal(drafted[0].json.output, undefined);

const deterministicDraft = await buildDraft(
  { first: () => ({ json: validatedBase }) },
  select,
);
const deterministicValidated = await runDraft(deterministicDraft[0].json.output);
assert.equal(
  deterministicValidated[0].json.approval_status,
  'PENDING_APPROVAL',
);
assert.match(
  deterministicValidated[0].json.draft_body,
  /free revenue-recovery assessment/,
);
assert.match(
  deterministicValidated[0].json.draft_body,
  /While reviewing Net Dental Clinic Al Karama’s website/,
);
assert.doesNotMatch(
  deterministicValidated[0].json.draft_body,
  /public information|reply no|prefer not to receive/i,
);
assert.equal(
  deterministicValidated[0].json.draft_body.split(
    'IAWebDevelopment × Nunoon',
  ).length - 1,
  2,
);
assert.doesNotMatch(
  deterministicValidated[0].json.draft_body,
  /Nunoon helps|dental clinics/i,
);

const healthFamilyEvidence = {
  services: ['General Dentistry'],
  personalization_points: [
    'Example Family Clinic is a multi-specialty healthcare center offering comprehensive medical services for individuals and families across Dubai.',
    'State-of-the-art technology meets compassionate care.',
  ],
};
const healthFamilyBase = {
  ...validatedBase,
  company_name: 'Example Family Clinic',
  research_sources_json: JSON.stringify(healthFamilyEvidence),
};
const healthFamilyDraft = await buildDraft(
  { first: () => ({ json: healthFamilyBase }) },
  select,
);
assert.match(
  healthFamilyDraft[0].json.output.draft_body,
  /State-of-the-art technology meets compassionate care/,
);
assert.doesNotMatch(
  healthFamilyDraft[0].json.output.draft_body,
  /General Dentistry|Nunoon helps|dental clinics/i,
);

const terminalPunctuationBase = {
  ...validatedBase,
  company_name: 'Smile Essentials Dental Clinic',
  research_sources_json: JSON.stringify({
    services: ['Dental Implants'],
    personalization_points: [
      'Smile Essential is the new leading dental healthcare in Karama, Dubai.',
    ],
  }),
};
const terminalPunctuationDraft = await buildDraft(
  { first: () => ({ json: terminalPunctuationBase }) },
  select,
);
assert.match(
  terminalPunctuationDraft[0].json.output.draft_body,
  /Karama, Dubai\.” It gave us/,
);
assert.doesNotMatch(
  terminalPunctuationDraft[0].json.output.draft_body,
  /Karama, Dubai\.\.”/,
);

const arabicBase = { ...validatedBase, language: 'ar' };
const deterministicArabicDraft = await buildDraft(
  { first: () => ({ json: arabicBase }) },
  select,
);
const deterministicArabicValidated = await validateDraft(
  {
    first: () => ({
      json: {
        ...arabicBase,
        output: deterministicArabicDraft[0].json.output,
      },
    }),
  },
  select,
);
assert.equal(
  deterministicArabicValidated[0].json.approval_status,
  'PENDING_APPROVAL',
);
assert.match(deterministicArabicValidated[0].json.draft_body, /تقييم مجاني/);
assert.doesNotMatch(
  deterministicArabicValidated[0].json.draft_body,
  /عيادات الأسنان|إيقاف/,
);

await assert.rejects(
  runDraft({
    draft_subject: 'Guaranteed results',
    draft_body: `${validBody}\nWe guarantee your revenue will double.`,
  }),
  /DRAFT_UNAPPROVED_CLAIM/,
);
await assert.rejects(
  runDraft({
    draft_body: `${validBody}\nYou will see results in 30 days.`,
  }),
  /DRAFT_UNSUPPORTED_NUMBER/,
);
await assert.rejects(
  runDraft({
    draft_body: validBody.replace(
      'IAWebDevelopment × Nunoon would be glad to prepare',
      'Nunoon helps dental clinics',
    ),
  }),
  /DRAFT_GENERIC_OR_INCOMPLETE_BRAND/,
);
await assert.rejects(
  runDraft({
    draft_subject: 'Invalid\nsubject',
  }),
  /DRAFT_SUBJECT_INVALID/,
);
await assert.rejects(
  runDraft({
    draft_body:
      'Hello Net Dental Clinic Al Karama. root canal treatment. Please reply for a free revenue-recovery assessment. If not interested, opt out. Demo Sender | IAWebDevelopment × Nunoon',
  }),
  /DRAFT_BODY_LENGTH_INVALID/,
);

const explicitArabic = await detectLanguage({
  all: () => [
    {
      json: {
        language: 'ar',
        website_text: '',
      },
    },
  ],
});
assert.equal(explicitArabic[0].json.language, 'ar');

process.stdout.write('research validator tests passed\n');
