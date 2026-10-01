import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hardenResearchWorkflow } from './harden-research-v3.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const resources = JSON.parse(
  fs.readFileSync(path.join(here, 'live-resources.example.json'), 'utf8'),
);
const revisionCode = fs.readFileSync(
  path.join(here, 'research-to-review-upsert.js'),
  'utf8',
);
const normalizerCode = fs.readFileSync(
  path.join(here, 'normalize-website-result.js'),
  'utf8',
);
const workflow = JSON.parse(fs.readFileSync(0, 'utf8'));

if (workflow.active) throw new Error('Refusing to patch an active workflow');
if (workflow.nodes.some((node) => node.name === 'Read Legacy Queue Keys')) {
  throw new Error('Live dual-read patch is already installed');
}

function requiredNode(name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`Missing node: ${name}`);
  return node;
}

const canonicalRead = requiredNode('Read Existing Queue');
if (
  canonicalRead.type !== 'n8n-nodes-base.dataTable' ||
  canonicalRead.parameters?.dataTableId?.value !==
    resources.tables.outreach_review_queue_v3
) {
  throw new Error('Read Existing Queue is not the canonical v3 Data Table');
}

const researchingPersist = requiredNode('Persist RESEARCHING');
const skippedPersist = requiredNode('Persist SKIPPED');
const eligibility = requiredNode('Eligibility and Dedup');
const buildRevision = requiredNode('Build Review Revision');
const normalizer = requiredNode('Normalize Website Result');

if (
  researchingPersist.parameters?.operation !== 'appendOrUpdate' ||
  !researchingPersist.parameters?.columns?.matchingColumns?.includes('contact_key')
) {
  throw new Error('Persist RESEARCHING is not a contact-key upsert');
}

const legacyQueueRead = {
  parameters: {
    documentId: JSON.parse(
      JSON.stringify(researchingPersist.parameters.documentId),
    ),
    sheetName: JSON.parse(
      JSON.stringify(researchingPersist.parameters.sheetName),
    ),
    options: {},
  },
  id: '30000000-0000-4000-8000-000000000006',
  name: 'Read Legacy Queue Keys',
  type: 'n8n-nodes-base.googleSheets',
  typeVersion: 4.6,
  position: [-912, 656],
  executeOnce: true,
  alwaysOutputData: true,
  retryOnFail: true,
  maxTries: 4,
  waitBetweenTries: 30000,
  credentials: JSON.parse(JSON.stringify(researchingPersist.credentials)),
};

const originalEligibilityFields = `const email = normalizeEmail(row.email);
  const status = rawValidationStatus(row).toUpperCase();
  const contactKey = email ? buildContactKey(email, campaignVersion) : '';

  if (!email) return { eligible: false, reason: 'MISSING_EMAIL', contactKey };`;
const companyEligibilityFields = `const email = normalizeEmail(row.email);
  const status = rawValidationStatus(row).toUpperCase();
  const contactKey = email ? buildContactKey(email, campaignVersion) : '';
  const companyName = String(
    row.company_name ?? row['company name'] ?? '',
  ).trim();

  if (!companyName) {
    return { eligible: false, reason: 'MISSING_COMPANY_NAME', contactKey };
  }
  if (!email) return { eligible: false, reason: 'MISSING_EMAIL', contactKey };`;

const originalQueueCode = `const queue = $('Read Existing Queue')
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
const rawByEmail = new Map();`;

const dualQueueCode = `const canonicalQueue = $('Read Existing Queue')
  .all()
  .map((item) => item.json)
  .filter((row) => row.contact_key);
const legacyQueue = $('Read Legacy Queue Keys')
  .all()
  .map((item) => item.json)
  .filter((row) => row.contact_key);
const allQueueRows = [...canonicalQueue, ...legacyQueue];

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
      storeName + '_DUPLICATE_CONTACT_KEYS: count=' + String(duplicates.size),
    );
  }
}

assertUniqueContactKeys(canonicalQueue, 'CANONICAL_QUEUE');
assertUniqueContactKeys(legacyQueue, 'LEGACY_QUEUE');

const suppressionSet = new Set(
  allQueueRows
    .filter((row) => String(row.send_status).toUpperCase() === 'SUPPRESSED')
    .map((row) => normalizeEmail(row.email)),
);
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
const rawByEmail = new Map();`;

const originalResumeLoop = `for (const queued of queue) {
  if (eligibleCount >= config.batch_limit) break;`;
const dualResumeLoop = `for (const queued of legacyQueue) {
  const queuedKey = String(queued.contact_key ?? '').trim();
  if (!queuedKey || canonicalKeys.has(queuedKey)) continue;
  if (eligibleCount >= config.batch_limit) break;`;
const originalResumeStatus =
  `if (String(queued.research_status).toUpperCase() !== 'QUEUED') continue;`;
const resumableStatuses = `const researchStatus = String(
    queued.research_status,
  ).toUpperCase();
  if (!['QUEUED', 'RESEARCHING', 'FAILED'].includes(researchStatus)) continue;`;

for (const [before, after, label] of [
  [originalEligibilityFields, companyEligibilityFields, 'company eligibility'],
  [originalQueueCode, dualQueueCode, 'dual queue'],
  [originalResumeLoop, dualResumeLoop, 'legacy resume loop'],
  [originalResumeStatus, resumableStatuses, 'resume statuses'],
]) {
  if (!eligibility.parameters.jsCode.includes(before)) {
    throw new Error(`Eligibility contract changed: ${label}`);
  }
  eligibility.parameters.jsCode = eligibility.parameters.jsCode.replace(
    before,
    after,
  );
}

skippedPersist.parameters.operation = 'appendOrUpdate';
skippedPersist.parameters.columns.matchingColumns = ['contact_key'];
buildRevision.parameters.jsCode = revisionCode;
normalizer.parameters.jsCode = normalizerCode;
workflow.nodes.push(legacyQueueRead);

const canonicalTargets = workflow.connections?.['Read Existing Queue']?.main?.[0];
if (!Array.isArray(canonicalTargets)) {
  throw new Error('Read Existing Queue connection is missing');
}
workflow.connections['Read Existing Queue'].main[0] = canonicalTargets.map(
  (connection) =>
    connection.node === 'Eligibility and Dedup'
      ? { ...connection, node: 'Read Legacy Queue Keys' }
      : connection,
);
if (
  !workflow.connections['Read Existing Queue'].main[0].some(
    (connection) => connection.node === 'Read Legacy Queue Keys',
  )
) {
  throw new Error('Eligibility and Dedup was not downstream of canonical read');
}
workflow.connections['Read Legacy Queue Keys'] = {
  main: [[{ node: 'Eligibility and Dedup', type: 'main', index: 0 }]],
};

hardenResearchWorkflow(workflow);

const writableSettings = { ...workflow.settings };
delete writableSettings.binaryMode;
delete writableSettings.timeSavedMode;

process.stdout.write(
  `${JSON.stringify(
    {
      name: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections,
      settings: {
        ...writableSettings,
        executionOrder: 'v1',
      },
    },
    null,
    2,
  )}\n`,
);
