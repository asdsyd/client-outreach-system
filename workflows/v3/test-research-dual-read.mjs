import assert from 'node:assert/strict';
import fs from 'node:fs';

const payloadPath = process.argv[2];
if (!payloadPath) {
  throw new Error('Usage: node test-research-dual-read.mjs <workflow-payload.json>');
}

const workflow = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const eligibility = workflow.nodes.find(
  (node) => node.name === 'Eligibility and Dedup',
);
if (!eligibility?.parameters?.jsCode) {
  throw new Error('Eligibility and Dedup code is missing');
}

const executeEligibility = new Function(
  '$',
  '$execution',
  `return (async () => {${eligibility.parameters.jsCode}})();`,
);

function item(json) {
  return { json };
}

async function run({
  raw = [],
  canonical = [],
  legacy = [],
  controls = [],
  batchLimit = 1,
}) {
  const sources = {
    'Preflight Research Config': [
      item({ campaign_version: 'pilot-v1', batch_limit: batchLimit }),
    ],
    'Read Raw Clinics': raw.map(item),
    'Read Existing Queue': canonical.map(item),
    'Read Legacy Queue Keys': legacy.map(item),
    'Read Active Suppressions': controls.map(item),
  };
  const select = (name) => ({
    all: () => sources[name] ?? [],
    first: () => (sources[name] ?? [item({})])[0],
  });
  return executeEligibility(select, { id: 'test-execution' });
}

function clinic(email, companyName, overrides = {}) {
  return {
    'company name': companyName,
    email,
    'email.emails_validator.status': 'RECEIVING',
    ...overrides,
  };
}

function queued(
  email,
  companyName,
  researchStatus = 'QUEUED',
  overrides = {},
) {
  return {
    contact_key: `${email}::pilot-v1`,
    campaign_version: 'pilot-v1',
    company_name: companyName,
    email,
    email_validation_status: 'RECEIVING',
    research_status: researchStatus,
    approval_status: 'PENDING_APPROVAL',
    send_status: 'UNSENT',
    ...overrides,
  };
}

const first = queued('one@example.com', 'One Clinic');
const second = queued('two@example.com', 'Two Clinic');

const resumed = await run({
  raw: [clinic('one@example.com', 'One Clinic')],
  legacy: [first, second],
});
assert.equal(resumed.length, 1);
assert.equal(resumed[0].json.contact_key, first.contact_key);
assert.equal(resumed[0].json.research_status, 'RESEARCHING');
assert.equal(resumed[0].json.attempt_count, 1);
assert.equal(resumed[0].json.execution_id, 'test-execution');

const canonicalSkip = await run({
  raw: [clinic('one@example.com', 'One Clinic')],
  canonical: [{ ...first, review_id: 'rvw-existing' }],
  legacy: [first, second],
});
assert.equal(canonicalSkip.length, 1);
assert.equal(canonicalSkip[0].json.contact_key, second.contact_key);

const interrupted = await run({
  legacy: [queued('retry@example.com', 'Retry Clinic', 'RESEARCHING')],
});
assert.equal(interrupted.length, 1);
assert.equal(interrupted[0].json.eligible, true);
assert.equal(interrupted[0].json.attempt_count, 1);

const exhausted = await run({
  raw: [clinic('retry@example.com', 'Retry Clinic'), clinic('next@example.com', 'Next Clinic')],
  legacy: [
    {
      ...queued('retry@example.com', 'Retry Clinic', 'RESEARCHING'),
      attempt_count: 6,
    },
  ],
});
assert.equal(exhausted[0].json.research_status, 'ERROR');
assert.equal(exhausted[0].json.approval_status, 'BLOCKED');
assert.equal(exhausted[0].json.suppressed_reason, 'MAX_RESEARCH_ATTEMPTS');
assert.equal(exhausted[1].json.email, 'next@example.com');

const missingCompany = await run({
  raw: [clinic('missing@example.com', ''), clinic('good@example.com', 'Good Clinic')],
});
assert.equal(missingCompany[0].json.suppressed_reason, 'MISSING_COMPANY_NAME');
assert.equal(missingCompany[1].json.email, 'good@example.com');

const existingClinicDedup = await run({
  raw: [
    clinic('hello@unrelated-business.example', 'Example Family Clinic', {
      website: 'https://www.family-clinic.example/',
      location_link:
        'https://www.google.com/maps/place/Example+Family+Clinic/@0,0,14z',
    }),
    clinic(
      'info@dental-clinic.example',
      'Example Dental Clinic, Karama Dubai',
      {
        website: 'http://www.dental-clinic.example/',
        location_link:
          'https://www.google.com/maps/place/Example+Dental+Clinic/@0,0,14z',
      },
    ),
  ],
  canonical: [
    {
      ...queued(
        'family-clinic@gmail.example',
        'Example Family Clinic',
        'COMPLETE',
        {
          website: 'https://www.family-clinic.example/',
          location_link:
            'https://www.google.com/maps/place/Example+Family+Clinic/@0,0,14z',
        },
      ),
      approval_status: 'APPROVED',
      send_status: 'SENT',
    },
  ],
});
assert.equal(existingClinicDedup.length, 1);
assert.equal(
  existingClinicDedup[0].json.email,
  'info@dental-clinic.example',
);
assert.equal(
  existingClinicDedup[0].json.website,
  'http://www.dental-clinic.example/',
);
assert.equal(existingClinicDedup[0].json.eligible, true);

const domainMismatch = await run({
  raw: [
    clinic('hello@unrelated-business.example', 'Example Family Clinic', {
      website: 'https://www.family-clinic.example/',
    }),
    clinic('info@alignedclinic.com', 'Aligned Clinic', {
      website: 'https://alignedclinic.com/',
    }),
  ],
});
assert.equal(
  domainMismatch[0].json.suppressed_reason,
  'EMAIL_DOMAIN_MISMATCH',
);
assert.equal(domainMismatch[1].json.email, 'info@alignedclinic.com');

const preferredClinicContact = await run({
  raw: [
    clinic('owner@gmail.com', 'Preferred Clinic', {
      website: 'https://preferredclinic.com/',
      location_link:
        'https://www.google.com/maps/place/Preferred+Clinic/@0,0,14z',
    }),
    clinic('careers@preferredclinic.com', 'Preferred Clinic', {
      website: 'https://preferredclinic.com/',
      location_link:
        'https://www.google.com/maps/place/Preferred+Clinic/@0,0,14z',
    }),
    clinic('info@preferredclinic.com', 'Preferred Clinic', {
      website: 'https://preferredclinic.com/',
      location_link:
        'https://www.google.com/maps/place/Preferred+Clinic/@0,0,14z',
      'email.emails_validator.status_details': 'SMTP validated',
    }),
  ],
});
assert.equal(
  preferredClinicContact[0].json.suppressed_reason,
  'DUPLICATE_CLINIC_CONTACT',
);
assert.equal(
  preferredClinicContact[1].json.suppressed_reason,
  'BLOCKED_ROLE_MAILBOX',
);
assert.equal(
  preferredClinicContact[2].json.email,
  'info@preferredclinic.com',
);
assert.equal(preferredClinicContact[2].json.eligible, true);

const freeMailboxValidation = await run({
  raw: [
    clinic('l@gmail.com', 'Invalid Local Clinic'),
    clinic('clinicname@gmail.com', 'Free Mail Clinic'),
  ],
});
assert.equal(
  freeMailboxValidation[0].json.suppressed_reason,
  'INVALID_EMAIL_FORMAT',
);
assert.equal(freeMailboxValidation[1].json.email, 'clinicname@gmail.com');
assert.equal(freeMailboxValidation[1].json.eligible, true);

const encodedWebsiteQuery = await run({
  raw: [
    clinic('encodedclinic@gmail.com', 'Encoded Website Clinic', {
      website:
        'https://brightway.clinic/%3Futm_source%3Dgoogle%26utm_medium%3Dorganic',
    }),
  ],
});
assert.equal(
  encodedWebsiteQuery[0].json.website,
  'https://brightway.clinic?utm_source=google&utm_medium=organic',
);
assert.equal(encodedWebsiteQuery[0].json.eligible, true);

const activeEmailControl = await run({
  raw: [
    clinic('controlled@example.com', 'Controlled Clinic'),
    clinic('open@example.com', 'Open Clinic'),
  ],
  controls: [
    {
      suppression_key: 'email:controlled@example.com',
      scope: 'EMAIL',
      normalized_email: 'controlled@example.com',
      control_type: 'SUPPRESS',
      active: true,
    },
  ],
});
assert.equal(activeEmailControl[0].json.suppressed_reason, 'SUPPRESSED');
assert.equal(activeEmailControl[0].json.send_status, 'SUPPRESSED');
assert.equal(activeEmailControl[1].json.email, 'open@example.com');

const activeDomainHold = await run({
  raw: [
    clinic('clinic@held.example', 'Held Clinic'),
    clinic('clinic@open.example', 'Open Clinic'),
  ],
  controls: [
    {
      suppression_key: 'domain:held.example',
      scope: 'DOMAIN',
      normalized_domain: 'held.example',
      control_type: 'HOLD',
      active: true,
    },
  ],
});
assert.equal(activeDomainHold[0].json.suppressed_reason, 'SUPPRESSED');
assert.equal(activeDomainHold[1].json.email, 'clinic@open.example');

const inactiveControlIgnored = await run({
  raw: [clinic('released@example.com', 'Released Clinic')],
  controls: [
    {
      suppression_key: 'email:released@example.com',
      scope: 'EMAIL',
      normalized_email: 'released@example.com',
      control_type: 'SUPPRESS',
      active: false,
    },
  ],
});
assert.equal(inactiveControlIgnored[0].json.eligible, true);

const queueSentinelCompatible = await run({
  raw: [
    clinic('sentinel@example.com', 'Sentinel Clinic'),
    clinic('next@example.com', 'Next Clinic'),
  ],
  canonical: [
    {
      review_id: 'CONTROL::sentinel@example.com',
      contact_key: 'CONTROL::sentinel@example.com',
      email: 'sentinel@example.com',
      intended_recipient: 'sentinel@example.com',
      send_status: 'SUPPRESSED',
    },
  ],
});
assert.equal(queueSentinelCompatible[0].json.suppressed_reason, 'SUPPRESSED');
assert.equal(queueSentinelCompatible[1].json.email, 'next@example.com');

await assert.rejects(
  run({
    raw: [clinic('invalid@example.com', 'Invalid Clinic')],
    controls: [
      {
        suppression_key: 'email:invalid@example.com',
        scope: 'EMAIL',
        normalized_email: 'invalid@example.com',
        control_type: 'UNKNOWN',
        active: true,
      },
    ],
  }),
  /ACTIVE_CONTROL_INVALID: control_type/,
);

await assert.rejects(
  run({ legacy: [first, { ...first }] }),
  /LEGACY_QUEUE_DUPLICATE_CONTACT_KEYS/,
);

process.stdout.write('research dual-read tests passed\n');
