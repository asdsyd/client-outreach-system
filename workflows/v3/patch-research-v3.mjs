import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hardenResearchWorkflow } from './harden-research-v3.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaContract = JSON.parse(
  fs.readFileSync(path.join(here, 'canonical-data-table-schema.json'), 'utf8'),
);
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
const queueTable = schemaContract.tables.find(
  (table) => table.name === 'outreach_review_queue_v3',
);

if (!queueTable) throw new Error('Missing outreach_review_queue_v3 schema');
if (workflow.nodes.some((node) => node.name === 'Upsert Review Queue')) {
  throw new Error('Research v3 canonical queue nodes already exist');
}

const columnSchema = queueTable.createPayload.columns.map((column) => ({
  id: column.name,
  displayName: column.name,
  required: false,
  defaultMatch: false,
  display: true,
  type: column.type === 'date' ? 'dateTime' : column.type,
  canBeUsedToMatch: true,
  removed: false,
  readOnly: false,
}));

const reviewIdCode = `return $input.all().map((item) => {
  const contactKey = String(item.json.contact_key ?? '').trim();
  const campaignVersion = String(item.json.campaign_version ?? '').trim();
  if (!contactKey || !campaignVersion) throw new Error('REVIEW_KEY_INVALID');
  return {
    json: {
      ...item.json,
      review_id: 'rvw_' + encodeURIComponent(campaignVersion + '\\n' + contactKey),
    },
  };
});`;

const attachExistingCode = `const draft = $('Prepare Review Key').item.json;
const candidate = $input.first().json ?? {};
const existing = String(candidate.review_id ?? '').trim() ? candidate : {};
if (existing.review_id && String(existing.review_id) !== String(draft.review_id)) {
  throw new Error('REVIEW_LOOKUP_MISMATCH: review_id=' + String(draft.review_id));
}
return [{ json: { ...draft, existing_row: existing } }];`;

const nodes = [
  {
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: reviewIdCode,
    },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2176, -48],
    id: '30000000-0000-4000-8000-000000000001',
    name: 'Prepare Review Key',
  },
  {
    parameters: {
      operation: 'get',
      dataTableId: {
        __rl: true,
        mode: 'list',
        value: resources.tables.outreach_review_queue_v3,
        cachedResultName: 'outreach_review_queue_v3',
      },
      matchType: 'allConditions',
      filters: {
        conditions: [
          {
            keyName: 'review_id',
            condition: 'eq',
            keyValue: '={{ $json.review_id }}',
          },
        ],
      },
      returnAll: false,
      limit: 1,
    },
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [2400, -48],
    id: '30000000-0000-4000-8000-000000000002',
    name: 'Get Existing Review',
    alwaysOutputData: true,
  },
  {
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: attachExistingCode,
    },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2624, -48],
    id: '30000000-0000-4000-8000-000000000003',
    name: 'Attach Existing Review',
  },
  {
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: revisionCode,
    },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [2848, -48],
    id: '30000000-0000-4000-8000-000000000004',
    name: 'Build Review Revision',
  },
  {
    parameters: {
      operation: 'upsert',
      dataTableId: {
        __rl: true,
        mode: 'list',
        value: resources.tables.outreach_review_queue_v3,
        cachedResultName: 'outreach_review_queue_v3',
      },
      matchType: 'allConditions',
      filters: {
        conditions: [
          {
            keyName: 'review_id',
            condition: 'eq',
            keyValue: '={{ $json.review_id }}',
          },
        ],
      },
      columns: {
        mappingMode: 'autoMapInputData',
        value: {},
        matchingColumns: [],
        schema: columnSchema,
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
      options: {},
    },
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position: [3072, -48],
    id: '30000000-0000-4000-8000-000000000005',
    name: 'Upsert Review Queue',
  },
];

workflow.nodes.push(...nodes);

const queueRead = workflow.nodes.find((node) => node.name === 'Read Existing Queue');
if (!queueRead) throw new Error('Read Existing Queue node is missing');

const legacyQueueRead = JSON.parse(JSON.stringify(queueRead));
legacyQueueRead.id = '30000000-0000-4000-8000-000000000006';
legacyQueueRead.name = 'Read Legacy Queue Keys';
legacyQueueRead.position = [-912, 656];
workflow.nodes.push(legacyQueueRead);

queueRead.type = 'n8n-nodes-base.dataTable';
queueRead.typeVersion = 1.1;
queueRead.parameters = {
  operation: 'get',
  dataTableId: {
    __rl: true,
    mode: 'list',
    value: resources.tables.outreach_review_queue_v3,
    cachedResultName: 'outreach_review_queue_v3',
  },
  returnAll: true,
};
queueRead.alwaysOutputData = true;
delete queueRead.credentials;

if (!workflow.nodes.some((node) => node.name === 'Eligibility and Dedup')) {
  throw new Error('Eligibility and Dedup node is missing');
}

const normalizer = workflow.nodes.find(
  (node) => node.name === 'Normalize Website Result',
);
if (!normalizer || normalizer.type !== 'n8n-nodes-base.code') {
  throw new Error('Normalize Website Result Code node is missing');
}
normalizer.parameters.jsCode = normalizerCode;

const skippedPersist = workflow.nodes.find(
  (node) => node.name === 'Persist SKIPPED',
);
if (!skippedPersist?.parameters?.columns) {
  throw new Error('Persist SKIPPED node is missing its column mapping');
}
skippedPersist.parameters.operation = 'appendOrUpdate';
skippedPersist.parameters.columns.matchingColumns = ['contact_key'];

const validateDraftTargets = workflow.connections?.['Validate Draft']?.main?.[0];
if (!Array.isArray(validateDraftTargets)) {
  throw new Error('Validate Draft main connection is missing');
}
workflow.connections['Validate Draft'].main[0] = validateDraftTargets.filter(
  (connection) => connection.node !== 'Persist PENDING_APPROVAL',
);

const queueReadTargets = workflow.connections?.['Read Existing Queue']?.main?.[0];
if (!Array.isArray(queueReadTargets)) {
  throw new Error('Read Existing Queue main connection is missing');
}
workflow.connections['Read Existing Queue'].main[0] = queueReadTargets.filter(
  (connection) => connection.node !== 'Eligibility and Dedup',
);

function connect(from, to) {
  workflow.connections[from] ??= { main: [[]] };
  workflow.connections[from].main ??= [[]];
  workflow.connections[from].main[0] ??= [];
  workflow.connections[from].main[0].push({ node: to, type: 'main', index: 0 });
}

connect('Validate Draft', 'Prepare Review Key');
connect('Read Existing Queue', 'Read Legacy Queue Keys');
connect('Read Legacy Queue Keys', 'Eligibility and Dedup');
connect('Prepare Review Key', 'Get Existing Review');
connect('Get Existing Review', 'Attach Existing Review');
connect('Attach Existing Review', 'Build Review Revision');
connect('Build Review Revision', 'Upsert Review Queue');
connect('Upsert Review Queue', 'Persist PENDING_APPROVAL');

const legacyPersist = workflow.nodes.find(
  (node) => node.name === 'Persist PENDING_APPROVAL',
);
const wait = workflow.nodes.find((node) => node.name === 'Wait Research Pace');
if (legacyPersist) legacyPersist.position = [3296, -48];
if (wait) wait.position = [3520, 336];

hardenResearchWorkflow(workflow);

const writableSettings = { ...workflow.settings };
delete writableSettings.binaryMode;
delete writableSettings.timeSavedMode;

process.stdout.write(
  `${JSON.stringify(
    {
      name: 'Nunoon - Research and Draft v3',
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
