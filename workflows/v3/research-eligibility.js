function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeDomain(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/^www\./, '');
}

function emailDomain(value) {
  const email = normalizeEmail(value);
  return email.includes('@') ? normalizeDomain(email.split('@').pop()) : '';
}

function emailLocalPart(value) {
  const email = normalizeEmail(value);
  return email.includes('@') ? email.slice(0, email.lastIndexOf('@')) : '';
}

function asBoolean(value) {
  return (
    value === true ||
    ['true', 'yes', '1'].includes(String(value ?? '').trim().toLowerCase())
  );
}

function parseHttpUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const match = candidate.match(
    /^(https?):\/\/([^/?#]+)([^?#]*)(?:\?[^#]*)?(?:#.*)?$/i,
  );
  if (!match) return null;

  const protocol = `${match[1].toLowerCase()}:`;
  const authority = match[2].trim().toLowerCase();
  const host = authority.replace(/\.$/, '');
  if (
    authority.includes('@') ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.includes(':') ||
    /\s/.test(host)
  ) {
    return null;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    const [a, b] = octets;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    ) {
      return null;
    }
  } else if (
    !host.includes('.') ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(
      host,
    )
  ) {
    return null;
  }

  const path = match[3] || '/';
  const withoutFragment = candidate.split('#')[0];
  return {
    protocol,
    hostname: host,
    path,
    href: withoutFragment,
  };
}

function sanitizeWebsite(value) {
  const raw = String(value ?? '').trim();
  const encodedQueryMarker = raw.search(/\/%3f/i);
  if (encodedQueryMarker < 0) return parseHttpUrl(raw)?.href ?? '';

  const encodedQuery = raw.slice(encodedQueryMarker + 4);
  let decodedQuery = encodedQuery;
  try {
    decodedQuery = decodeURIComponent(encodedQuery);
  } catch {
    decodedQuery = encodedQuery
      .replace(/%3d/gi, '=')
      .replace(/%26/gi, '&');
  }

  const repaired = `${raw.slice(0, encodedQueryMarker)}?${decodedQuery}`;
  return parseHttpUrl(repaired)?.href ?? '';
}

const FREE_EMAIL_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'gmx.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mail.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
  'ymail.com',
]);

const BLOCKED_ROLE_MAILBOXES = new Set([
  'career',
  'careers',
  'hr',
  'insurance',
  'job',
  'jobs',
  'marketing',
  'media',
  'press',
  'recruit',
  'recruiting',
  'recruitment',
]);

const PREFERRED_CONTACT_MAILBOXES = new Set([
  'admin',
  'appointment',
  'appointments',
  'care',
  'clinic',
  'contact',
  'enquiries',
  'enquiry',
  'hello',
  'info',
  'inquiries',
  'inquiry',
  'office',
  'reception',
  'support',
]);

function mailboxTokens(value) {
  return String(value ?? '')
    .toLowerCase()
    .split(/[.+_-]+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
}

function compactMailbox(value) {
  return String(value ?? '')
    .split('+')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function isBlockedRoleMailbox(value) {
  const compact = compactMailbox(value);
  return (
    BLOCKED_ROLE_MAILBOXES.has(compact) ||
    mailboxTokens(value).some((token) => BLOCKED_ROLE_MAILBOXES.has(token))
  );
}

function websiteDomain(value) {
  return normalizeDomain(parseHttpUrl(value)?.hostname ?? '');
}

function domainsAligned(left, right) {
  const a = normalizeDomain(left);
  const b = normalizeDomain(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function companyNameFor(row) {
  return String(row.company_name ?? row['company name'] ?? '').trim();
}

function normalizeCompanyName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(?:l\.?\s*l\.?\s*c\.?|llc|ltd|limited|inc|fzc|fzco)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function normalizeLocation(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const coordinateMatch =
    raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i) ||
    raw.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i);
  if (coordinateMatch) {
    const latitude = Number(coordinateMatch[1]);
    const longitude = Number(coordinateMatch[2]);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return `geo:${latitude.toFixed(6)},${longitude.toFixed(6)}`;
    }
  }

  const parsed = parseHttpUrl(raw);
  if (parsed) {
    let decodedPath = parsed.path;
    try {
      decodedPath = decodeURIComponent(parsed.path);
    } catch {}
    const path = decodedPath.toLowerCase().replace(/\/+$/, '');
    return `${normalizeDomain(parsed.hostname)}${path}`;
  }

  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

function clinicIdentityKey(row) {
  const location = normalizeLocation(
    row.location_link ?? row.location ?? row['location link'] ?? '',
  );
  if (location) return `location::${location}`;

  const company = normalizeCompanyName(companyNameFor(row));
  const domain = websiteDomain(row.website);
  if (domain && company) return `website::${domain}::${company}`;
  if (domain) return `website::${domain}`;
  return company ? `company::${company}` : '';
}

function validationDetails(row) {
  return String(
    row.email_validation_details ??
      row['email.emails_validator.status_details'] ??
      '',
  )
    .trim()
    .toLowerCase();
}

function contactCandidateScore(row) {
  const email = normalizeEmail(row.email);
  const domain = emailDomain(email);
  const localPart = emailLocalPart(email);
  const siteDomain = websiteDomain(row.website);
  let score = 0;

  if (FREE_EMAIL_DOMAINS.has(domain)) score += 20;
  else if (siteDomain && domainsAligned(domain, siteDomain)) score += 100;
  else if (!siteDomain) score += 50;

  if (PREFERRED_CONTACT_MAILBOXES.has(compactMailbox(localPart))) score += 30;

  const details = validationDetails(row);
  if (details.includes('smtp validated')) score += 10;
  else if (details.includes('verified')) score += 8;
  if (details.includes('role')) score += 2;

  return score;
}

function buildContactKey(email, campaignVersion) {
  return `${normalizeEmail(email)}::${String(campaignVersion).trim()}`;
}

function rawValidationStatus(row) {
  return String(
    row.email_validation_status ?? row['email.emails_validator.status'] ?? '',
  ).trim();
}

function classifyEligibility(
  row,
  suppressedEmails,
  suppressedDomains,
  campaignVersion,
  sentKeys,
) {
  const email = normalizeEmail(row.email);
  const status = rawValidationStatus(row).toUpperCase();
  const contactKey = email ? buildContactKey(email, campaignVersion) : '';
  const companyName = companyNameFor(row);
  const localPart = emailLocalPart(email);
  const domain = emailDomain(email);
  const siteDomain = websiteDomain(row.website);
  const clinicKey = clinicIdentityKey(row);

  if (!companyName) {
    return {
      eligible: false,
      reason: 'MISSING_COMPANY_NAME',
      contactKey,
      clinicKey,
    };
  }
  if (!email) {
    return { eligible: false, reason: 'MISSING_EMAIL', contactKey, clinicKey };
  }
  if (status !== 'RECEIVING') {
    return {
      eligible: false,
      reason: 'INVALID_EMAIL',
      contactKey,
      clinicKey,
    };
  }
  if (
    !localPart ||
    localPart.length < 3 ||
    !domain ||
    !domain.includes('.') ||
    email.indexOf('@') !== email.lastIndexOf('@')
  ) {
    return {
      eligible: false,
      reason: 'INVALID_EMAIL_FORMAT',
      contactKey,
      clinicKey,
    };
  }
  if (isBlockedRoleMailbox(localPart)) {
    return {
      eligible: false,
      reason: 'BLOCKED_ROLE_MAILBOX',
      contactKey,
      clinicKey,
    };
  }
  if (
    !FREE_EMAIL_DOMAINS.has(domain) &&
    siteDomain &&
    !domainsAligned(domain, siteDomain)
  ) {
    return {
      eligible: false,
      reason: 'EMAIL_DOMAIN_MISMATCH',
      contactKey,
      clinicKey,
    };
  }
  if (
    suppressedEmails.has(email) ||
    suppressedDomains.has(emailDomain(email))
  ) {
    return {
      eligible: false,
      reason: 'SUPPRESSED',
      contactKey,
      clinicKey,
    };
  }
  if (sentKeys.has(contactKey)) {
    return {
      eligible: false,
      reason: 'ALREADY_SENT',
      contactKey,
      clinicKey,
    };
  }

  return { eligible: true, reason: '', contactKey, clinicKey };
}

const config = $('Preflight Research Config').first().json;
const raw = $('Read Raw Clinics').all().map((item) => item.json);
const canonicalQueue = $('Read Existing Queue')
  .all()
  .map((item) => item.json)
  .filter((row) => row.contact_key);
const legacyQueue = $('Read Legacy Queue Keys')
  .all()
  .map((item) => item.json)
  .filter((row) => row.contact_key);
const allQueueRows = [...canonicalQueue, ...legacyQueue];
const activeControls = $('Read Active Suppressions')
  .all()
  .map((item) => item.json ?? {});
const maxResearchAttempts = Number(config.max_research_attempts || 6);
const maxSkippedRecords = Number(
  config.max_skipped_records_per_run ||
    Math.max(25, Number(config.batch_limit || 1) * 25),
);
const executionId = String($execution.id);

function assertUniqueContactKeys(rows, storeName) {
  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
    const key = String(row.contact_key ?? '').trim();
    if (!key) continue;
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  if (duplicates.size) {
    throw new Error(
      `${storeName}_DUPLICATE_CONTACT_KEYS: count=${duplicates.size}`,
    );
  }
}

assertUniqueContactKeys(canonicalQueue, 'CANONICAL_QUEUE');
assertUniqueContactKeys(legacyQueue, 'LEGACY_QUEUE');
if (
  !Number.isInteger(maxResearchAttempts) ||
  maxResearchAttempts < 1 ||
  maxResearchAttempts > 10
) {
  throw new Error('CONFIG_INVALID: max_research_attempts must be 1..10');
}
if (
  !Number.isInteger(maxSkippedRecords) ||
  maxSkippedRecords < 0 ||
  maxSkippedRecords > 250
) {
  throw new Error('CONFIG_INVALID: max_skipped_records_per_run must be 0..250');
}

if (
  activeControls.some(
    (row) => row.error || row.errorMessage || row.last_error_message,
  )
) {
  throw new Error('ACTIVE_CONTROL_READ_FAILED');
}

const suppressedEmails = new Set(
  allQueueRows
    .filter((row) => String(row.send_status).toUpperCase() === 'SUPPRESSED')
    .map((row) => normalizeEmail(row.intended_recipient ?? row.email))
    .filter(Boolean),
);
const suppressedDomains = new Set();

for (const row of activeControls) {
  const populated = Boolean(
    String(row.suppression_key ?? '').trim() ||
      String(row.normalized_email ?? '').trim() ||
      String(row.normalized_domain ?? '').trim() ||
      String(row.control_type ?? '').trim(),
  );
  if (!populated || !asBoolean(row.active)) continue;

  const scope = String(row.scope ?? '').trim().toUpperCase();
  const controlType = String(row.control_type ?? '').trim().toUpperCase();
  if (!['SUPPRESS', 'HOLD'].includes(controlType)) {
    throw new Error('ACTIVE_CONTROL_INVALID: control_type');
  }
  if (scope === 'EMAIL') {
    const email = normalizeEmail(row.normalized_email);
    if (!email || !email.includes('@')) {
      throw new Error('ACTIVE_CONTROL_INVALID: normalized_email');
    }
    suppressedEmails.add(email);
  } else if (scope === 'DOMAIN') {
    const domain = normalizeDomain(row.normalized_domain);
    if (!domain || domain.includes('@')) {
      throw new Error('ACTIVE_CONTROL_INVALID: normalized_domain');
    }
    suppressedDomains.add(domain);
  } else {
    throw new Error('ACTIVE_CONTROL_INVALID: scope');
  }
}
const sentKeys = new Set(
  allQueueRows
    .filter((row) => String(row.send_status).toUpperCase() === 'SENT')
    .map((row) => String(row.contact_key)),
);
const canonicalKeys = new Set(
  canonicalQueue.map((row) => String(row.contact_key)),
);
const existingKeys = new Set(
  allQueueRows.map((row) => String(row.contact_key)),
);
const rawByEmail = new Map();
const rawByRowNumber = new Map();

for (let index = 0; index < raw.length; index += 1) {
  const row = raw[index];
  const email = normalizeEmail(row.email);
  const sourceRow = Number(row.row_number ?? index + 2);
  if (email && !rawByEmail.has(email)) rawByEmail.set(email, row);
  if (Number.isInteger(sourceRow) && !rawByRowNumber.has(sourceRow)) {
    rawByRowNumber.set(sourceRow, row);
  }
}

function sourceForQueued(queued) {
  const sourceRow = Number(queued.source_row_number);
  if (Number.isInteger(sourceRow) && rawByRowNumber.has(sourceRow)) {
    return rawByRowNumber.get(sourceRow);
  }
  return rawByEmail.get(
    normalizeEmail(queued.email ?? queued.intended_recipient),
  ) ?? {};
}

function identityForQueued(queued) {
  if (
    String(queued.contact_key ?? '').toUpperCase().startsWith('CONTROL::') ||
    String(queued.review_id ?? '').toUpperCase().startsWith('CONTROL::')
  ) {
    return '';
  }
  const source = sourceForQueued(queued);
  return clinicIdentityKey({
    ...source,
    company_name:
      queued.company_name ||
      source.company_name ||
      source['company name'] ||
      '',
    website: queued.website || source.website || '',
    location_link:
      queued.location_link ||
      queued.location ||
      source.location_link ||
      source.location ||
      '',
  });
}

function blockedReason(reason) {
  return ['MAX_RESEARCH_ATTEMPTS', 'CONTACT_KEY_MISMATCH'].includes(reason);
}

const output = [];
const selectedKeys = new Set();
const selectedClinicKeys = new Set();
let eligibleCount = 0;
let skippedOutputCount = 0;
const canonicalClinicKeys = new Set(
  canonicalQueue.map(identityForQueued).filter(Boolean),
);
const existingClinicKeys = new Set(
  allQueueRows.map(identityForQueued).filter(Boolean),
);
const bestRawCandidateByClinic = new Map();

for (let index = 0; index < raw.length; index += 1) {
  const row = raw[index];
  const classified = classifyEligibility(
    row,
    suppressedEmails,
    suppressedDomains,
    config.campaign_version,
    sentKeys,
  );
  if (!classified.eligible || !classified.clinicKey) continue;
  if (
    existingKeys.has(classified.contactKey) ||
    existingClinicKeys.has(classified.clinicKey)
  ) {
    continue;
  }

  const score = contactCandidateScore(row);
  const current = bestRawCandidateByClinic.get(classified.clinicKey);
  if (!current || score > current.score) {
    bestRawCandidateByClinic.set(classified.clinicKey, { index, score });
  }
}

// Resume unfinished legacy rows before selecting new source rows.
for (const queued of legacyQueue) {
  const queuedKey = String(queued.contact_key ?? '').trim();
  if (!queuedKey || canonicalKeys.has(queuedKey)) continue;
  const queuedClinicKey = identityForQueued(queued);
  if (queuedClinicKey && canonicalClinicKeys.has(queuedClinicKey)) continue;
  if (eligibleCount >= config.batch_limit) break;
  if (String(queued.campaign_version) !== String(config.campaign_version)) {
    continue;
  }

  const researchStatus = String(queued.research_status).toUpperCase();
  if (!['QUEUED', 'RESEARCHING', 'FAILED', 'ERROR'].includes(researchStatus)) {
    continue;
  }
  if (String(queued.approval_status).toUpperCase() !== 'PENDING_APPROVAL') {
    continue;
  }
  if (String(queued.send_status).toUpperCase() !== 'UNSENT') continue;

  const source = sourceForQueued(queued);
  const email = normalizeEmail(queued.email || source.email);
  const merged = {
    ...queued,
    source_row_number:
      Number(queued.source_row_number) || Number(source.row_number) || 0,
    company_name:
      queued.company_name ||
      source.company_name ||
      source['company name'] ||
      '',
    email,
    website: sanitizeWebsite(queued.website || source.website),
    location_link: queued.location_link || source.location_link || '',
    email_validation_status:
      queued.email_validation_status ||
      source.email_validation_status ||
      source['email.emails_validator.status'] ||
      '',
  };
  const classified = classifyEligibility(
    merged,
    suppressedEmails,
    suppressedDomains,
    config.campaign_version,
    sentKeys,
  );
  const expectedKey = classified.contactKey;
  const priorAttempts = Number(queued.attempt_count || 0);
  let reason = classified.reason;

  if (!reason && expectedKey !== queuedKey) reason = 'CONTACT_KEY_MISMATCH';
  if (!reason && priorAttempts >= maxResearchAttempts) {
    reason = 'MAX_RESEARCH_ATTEMPTS';
  }

  const isBlocked = blockedReason(reason);
  output.push({
    json: {
      ...merged,
      contact_key: queuedKey,
      language: queued.language || '',
      research_status: reason
        ? isBlocked
          ? 'ERROR'
          : 'SKIPPED'
        : 'RESEARCHING',
      approval_status: reason ? 'BLOCKED' : 'PENDING_APPROVAL',
      send_status: reason === 'SUPPRESSED' ? 'SUPPRESSED' : 'UNSENT',
      attempt_count: reason ? priorAttempts : priorAttempts + 1,
      suppressed_reason: reason,
      last_error_code: reason,
      last_error_message: '',
      execution_id: executionId,
      updated_at: new Date().toISOString(),
      eligible: !reason,
    },
    pairedItem: { item: 0 },
  });
  selectedKeys.add(queuedKey);
  if (!reason) {
    eligibleCount += 1;
    if (queuedClinicKey) selectedClinicKeys.add(queuedClinicKey);
  }
}

// Fill remaining capacity while bounding how many invalid rows are written.
const seenRawKeys = new Set();
for (
  let index = 0;
  index < raw.length && eligibleCount < config.batch_limit;
  index += 1
) {
  const row = raw[index];
  const classified = classifyEligibility(
    row,
    suppressedEmails,
    suppressedDomains,
    config.campaign_version,
    sentKeys,
  );
  const sourceRow = Number(row.row_number ?? index + 2);
  let reason = classified.reason;
  const clinicKey = classified.clinicKey || clinicIdentityKey(row);

  if (classified.contactKey && seenRawKeys.has(classified.contactKey)) {
    reason = 'DUPLICATE_EMAIL';
  }
  if (
    classified.contactKey &&
    (existingKeys.has(classified.contactKey) ||
      selectedKeys.has(classified.contactKey))
  ) {
    continue;
  }
  if (
    clinicKey &&
    (existingClinicKeys.has(clinicKey) || selectedClinicKeys.has(clinicKey))
  ) {
    continue;
  }
  const bestCandidate = clinicKey
    ? bestRawCandidateByClinic.get(clinicKey)
    : undefined;
  if (!reason && bestCandidate && bestCandidate.index !== index) {
    reason = 'DUPLICATE_CLINIC_CONTACT';
  }

  const isDuplicate = [
    'DUPLICATE_EMAIL',
    'DUPLICATE_CLINIC_CONTACT',
  ].includes(reason);
  if (classified.contactKey) seenRawKeys.add(classified.contactKey);
  if (reason && skippedOutputCount >= maxSkippedRecords) continue;

  const queueKey = isDuplicate
    ? `SKIP::${sourceRow}::${config.campaign_version}`
    : classified.contactKey || `SOURCE::${sourceRow}::${config.campaign_version}`;

  output.push({
    json: {
      contact_key: queueKey,
      source_row_number: sourceRow,
      company_name: row.company_name ?? row['company name'] ?? '',
      email: normalizeEmail(row.email),
      website: sanitizeWebsite(row.website),
      location_link: row.location_link ?? '',
      email_validation_status:
        row.email_validation_status ??
        row['email.emails_validator.status'] ??
        '',
      language: '',
      research_status: reason ? 'SKIPPED' : 'RESEARCHING',
      approval_status: reason ? 'BLOCKED' : 'PENDING_APPROVAL',
      campaign_version: config.campaign_version,
      send_status: reason === 'SUPPRESSED' ? 'SUPPRESSED' : 'UNSENT',
      attempt_count: reason ? 0 : 1,
      suppressed_reason: reason,
      last_error_code: reason,
      last_error_message: '',
      execution_id: executionId,
      updated_at: new Date().toISOString(),
      eligible: !reason,
    },
    pairedItem: { item: index },
  });
  if (reason) skippedOutputCount += 1;
  else {
    eligibleCount += 1;
    if (clinicKey) selectedClinicKeys.add(clinicKey);
  }
}

return output;
