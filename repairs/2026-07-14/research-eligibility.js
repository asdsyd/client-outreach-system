function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function sanitizeWebsite(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';

    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.includes(':')
    ) {
      return '';
    }

    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number);
      if (octets.some((octet) => octet > 255)) return '';
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
        return '';
      }
    }

    return url.href;
  } catch {
    return '';
  }
}

function buildContactKey(email, campaignVersion) {
  return `${normalizeEmail(email)}::${String(campaignVersion).trim()}`;
}

function rawValidationStatus(row) {
  return String(
    row.email_validation_status ?? row['email.emails_validator.status'] ?? '',
  ).trim();
}

function classifyEligibility(row, suppressionSet, campaignVersion, sentKeys) {
  const email = normalizeEmail(row.email);
  const status = rawValidationStatus(row).toUpperCase();
  const contactKey = email ? buildContactKey(email, campaignVersion) : '';

  if (!email) return { eligible: false, reason: 'MISSING_EMAIL', contactKey };
  if (status !== 'RECEIVING') {
    return { eligible: false, reason: 'INVALID_EMAIL', contactKey };
  }
  if (suppressionSet.has(email)) {
    return { eligible: false, reason: 'SUPPRESSED', contactKey };
  }
  if (sentKeys.has(contactKey)) {
    return { eligible: false, reason: 'ALREADY_SENT', contactKey };
  }

  return { eligible: true, reason: '', contactKey };
}

const config = $('Preflight Research Config').first().json;
const raw = $('Read Raw Clinics').all().map((item) => item.json);
const queue = $('Read Existing Queue')
  .all()
  .map((item) => item.json)
  .filter((row) => row.contact_key);

const suppressionSet = new Set(
  queue
    .filter((row) => String(row.send_status).toUpperCase() === 'SUPPRESSED')
    .map((row) => normalizeEmail(row.email)),
);
const sentKeys = new Set(
  queue
    .filter((row) => String(row.send_status).toUpperCase() === 'SENT')
    .map((row) => String(row.contact_key)),
);
const existingKeys = new Set(queue.map((row) => String(row.contact_key)));
const rawByEmail = new Map();

for (const row of raw) {
  const email = normalizeEmail(row.email);
  if (email && !rawByEmail.has(email)) rawByEmail.set(email, row);
}

const output = [];
const selectedKeys = new Set();
let eligibleCount = 0;

// Resume rows already queued in Sheet1 before considering new source rows.
for (const queued of queue) {
  if (eligibleCount >= config.batch_limit) break;
  if (String(queued.campaign_version) !== String(config.campaign_version)) continue;
  if (String(queued.research_status).toUpperCase() !== 'QUEUED') continue;
  if (String(queued.approval_status).toUpperCase() !== 'PENDING_APPROVAL') continue;
  if (String(queued.send_status).toUpperCase() !== 'UNSENT') continue;

  const email = normalizeEmail(queued.email);
  const source = rawByEmail.get(email) ?? {};
  const merged = {
    ...queued,
    company_name: queued.company_name || source['company name'] || '',
    email,
    website: sanitizeWebsite(queued.website || source.website),
    location_link: queued.location_link || source.location_link || '',
    email_validation_status:
      queued.email_validation_status || source['email.emails_validator.status'] || '',
  };
  const result = classifyEligibility(
    merged,
    suppressionSet,
    config.campaign_version,
    sentKeys,
  );

  output.push({
    json: {
      ...merged,
      contact_key: String(queued.contact_key),
      language: queued.language || '',
      research_status: result.reason ? 'SKIPPED' : 'RESEARCHING',
      approval_status: 'PENDING_APPROVAL',
      send_status: result.reason === 'SUPPRESSED' ? 'SUPPRESSED' : 'UNSENT',
      attempt_count: Number(queued.attempt_count || 0),
      suppressed_reason: result.reason,
      updated_at: new Date().toISOString(),
      eligible: !result.reason,
    },
  });
  selectedKeys.add(String(queued.contact_key));
  if (!result.reason) eligibleCount += 1;
}

// Fill any remaining batch capacity from the raw source without duplicating queue rows.
const seenRawKeys = new Set();
for (let index = 0; index < raw.length && eligibleCount < config.batch_limit; index++) {
  const row = raw[index];
  const result = classifyEligibility(
    row,
    suppressionSet,
    config.campaign_version,
    sentKeys,
  );
  const sourceRow = Number(row.row_number ?? index + 2);
  let reason = result.reason;

  if (result.contactKey && seenRawKeys.has(result.contactKey)) reason = 'DUPLICATE_EMAIL';
  if (
    result.contactKey &&
    (existingKeys.has(result.contactKey) || selectedKeys.has(result.contactKey))
  ) {
    continue;
  }

  const isDuplicate = reason === 'DUPLICATE_EMAIL';
  if (result.contactKey && !isDuplicate) seenRawKeys.add(result.contactKey);
  const queueKey = isDuplicate
    ? `SKIP::${sourceRow}::${config.campaign_version}`
    : result.contactKey || `SOURCE::${sourceRow}::${config.campaign_version}`;

  output.push({
    json: {
      contact_key: queueKey,
      source_row_number: sourceRow,
      company_name: row['company name'] ?? '',
      email: normalizeEmail(row.email),
      website: sanitizeWebsite(row.website),
      location_link: row.location_link ?? '',
      email_validation_status: row['email.emails_validator.status'] ?? '',
      language: '',
      research_status: reason ? 'SKIPPED' : 'RESEARCHING',
      approval_status: 'PENDING_APPROVAL',
      campaign_version: config.campaign_version,
      send_status: reason === 'SUPPRESSED' ? 'SUPPRESSED' : 'UNSENT',
      attempt_count: 0,
      suppressed_reason: reason,
      updated_at: new Date().toISOString(),
      eligible: !reason,
    },
  });
  if (!reason) eligibleCount += 1;
}

return output;
