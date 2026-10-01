import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaContract = JSON.parse(
  fs.readFileSync(path.join(here, 'canonical-data-table-schema.json'), 'utf8'),
);
const resources = JSON.parse(
  fs.readFileSync(path.join(here, 'live-resources.example.json'), 'utf8'),
);
const preflightCode = fs.readFileSync(
  path.join(here, '../../repairs/2026-07-14/preflight-send-config.js'),
  'utf8',
);
const sendGateCode = fs.readFileSync(
  path.join(here, 'fail-closed-send-gate.js'),
  'utf8',
);
const preSmtpControlGateCode = fs.readFileSync(
  path.join(here, 'pre-smtp-control-gate.js'),
  'utf8',
);

const tables = Object.fromEntries(
  schemaContract.tables.map((table) => [table.name, table]),
);

const tableConfig = {
  queue: {
    id: resources.tables.outreach_review_queue_v3,
    name: 'outreach_review_queue_v3',
  },
  batches: {
    id: resources.tables.outreach_batches_v3,
    name: 'outreach_batches_v3',
  },
  items: {
    id: resources.tables.outreach_batch_items_v3,
    name: 'outreach_batch_items_v3',
  },
  suppressions: {
    id: resources.tables.outreach_suppressions_v3,
    name: 'outreach_suppressions_v3',
  },
};

let nodeSequence = 0;

function nextId() {
  nodeSequence += 1;
  return `10000000-0000-4000-8000-${String(nodeSequence).padStart(12, '0')}`;
}

function node(name, type, typeVersion, position, parameters, extra = {}) {
  return {
    parameters,
    type,
    typeVersion,
    position,
    id: nextId(),
    name,
    ...extra,
  };
}

function codeNode(name, position, jsCode, extra = {}) {
  const { mode, language, ...nodeExtra } = extra;
  return node(
    name,
    'n8n-nodes-base.code',
    2,
    position,
    {
      ...(mode ? { mode } : {}),
      ...(language ? { language } : {}),
      jsCode,
    },
    nodeExtra,
  );
}

function locator(kind) {
  const table = tableConfig[kind];
  return {
    __rl: true,
    mode: 'list',
    value: table.id,
    cachedResultName: table.name,
  };
}

function columnSchema(kind) {
  const table = tables[tableConfig[kind].name];
  return table.createPayload.columns.map((column) => ({
    id: column.name,
    type: column.type === 'date' ? 'dateTime' : column.type,
    display: true,
    removed: false,
    readOnly: false,
    required: false,
    displayName: column.name,
    defaultMatch: false,
  }));
}

function conditions(filters) {
  return {
    matchType: 'allConditions',
    filters: {
      conditions: filters.map(([keyName, keyValue]) => ({
        keyName,
        condition: 'eq',
        keyValue,
      })),
    },
  };
}

function dataTableGet(name, kind, position, options = {}) {
  const parameters = {
    operation: 'get',
    dataTableId: locator(kind),
    ...(options.filters ? conditions(options.filters) : {}),
    returnAll: options.returnAll ?? true,
  };
  if (options.returnAll === false) parameters.limit = options.limit ?? 1;
  return node(
    name,
    'n8n-nodes-base.dataTable',
    1.1,
    position,
    parameters,
    {
      ...(options.alwaysOutputData ? { alwaysOutputData: true } : {}),
      ...(options.executeOnce ? { executeOnce: true } : {}),
    },
  );
}

function activeControlsGet(name, position, options = {}) {
  return node(
    name,
    'n8n-nodes-base.dataTable',
    1.1,
    position,
    {
      resource: 'row',
      operation: 'get',
      dataTableId: locator('suppressions'),
      matchType: 'allConditions',
      filters: {
        conditions: [
          {
            keyName: 'active',
            condition: 'isTrue',
          },
        ],
      },
      returnAll: true,
    },
    {
      ...(options.alwaysOutputData ? { alwaysOutputData: true } : {}),
      ...(options.executeOnce ? { executeOnce: true } : {}),
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 5000,
    },
  );
}

function dataTableUpdate(name, kind, position, filters, values, extra = {}) {
  return node(
    name,
    'n8n-nodes-base.dataTable',
    1.1,
    position,
    {
      operation: 'update',
      dataTableId: locator(kind),
      ...conditions(filters),
      columns: {
        mappingMode: 'defineBelow',
        value: values,
        schema: columnSchema(kind),
        matchingColumns: [],
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
      options: {},
    },
    extra,
  );
}

function booleanIf(name, position, leftValue) {
  return node(name, 'n8n-nodes-base.if', 2.3, position, {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: '',
        typeValidation: 'strict',
        version: 2,
      },
      conditions: [
        {
          id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-condition`,
          leftValue,
          rightValue: true,
          operator: {
            type: 'boolean',
            operation: 'true',
            singleValue: true,
          },
        },
      ],
      combinator: 'and',
    },
    options: {},
  });
}

const requestedBatchLockCode = `const rows = $input.all().map((item) => item.json ?? {}).filter((row) => row.batch_id);
const blockingStatuses = new Set(['LOCKED', 'SENDING', 'NEEDS_RECONCILIATION']);
const blockers = rows.filter((row) => blockingStatuses.has(String(row.status ?? '').toUpperCase()));
// The execution that created the blocker already alerts the error workflow.
// Stop quietly here so the one-minute schedule does not create alert spam.
if (blockers.length) return [];
const candidates = rows
  .filter((row) => String(row.status ?? '').toUpperCase() === 'CONFIRMED')
  .sort((left, right) => Date.parse(left.confirmed_at) - Date.parse(right.confirmed_at));
if (!candidates.length) return [];
const batch = candidates[0];
if (!String(batch.batch_id ?? '').trim()) throw new Error('BATCH_SELECTION_INVALID: missing batch_id');
if (!Number.isInteger(Number(batch.item_count)) || Number(batch.item_count) < 1 || Number(batch.item_count) > 25) {
  throw new Error('BATCH_SELECTION_INVALID: item_count');
}
const lockedAt = new Date().toISOString();
const lockToken = 'lock_' + String($execution.id) + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 14);
return [{ json: { batch_id: String(batch.batch_id), item_count: Number(batch.item_count), lock_token: lockToken, locked_at: lockedAt } }];`;

const assertBatchClaimCode = `const rows = $input.all().map((item) => item.json ?? {}).filter((row) => row.batch_id);
const request = $('Requested Batch Lock').first().json;
if (rows.length !== 1 || String(rows[0].batch_id) !== String(request.batch_id) || String(rows[0].status).toUpperCase() !== 'LOCKED' || String(rows[0].lock_token) !== String(request.lock_token)) {
  throw new Error('BATCH_CLAIM_FAILED: batch_id=' + String(request.batch_id));
}
return [{ json: request }];`;

const assertItemClaimCode = `const request = $('Requested Batch Lock').first().json;
const rows = $input.all().map((item) => item.json ?? {}).filter((row) => row.item_key);
if (rows.length !== Number(request.item_count)) {
  throw new Error('BATCH_ITEM_CLAIM_COUNT_MISMATCH: batch_id=' + String(request.batch_id) + ' expected=' + String(request.item_count) + ' actual=' + String(rows.length));
}
if (rows.some((row) => String(row.batch_id) !== String(request.batch_id) || String(row.status).toUpperCase() !== 'LOCKED' || String(row.lock_token) !== String(request.lock_token))) {
  throw new Error('BATCH_ITEM_CLAIM_INVALID: batch_id=' + String(request.batch_id));
}
return [{ json: request }];`;

const assertQueueClaimCode = `const request = $('Requested Batch Lock').first().json;
const rows = $input.all().map((item) => item.json ?? {}).filter((row) => row.review_id);
if (rows.length !== Number(request.item_count)) {
  throw new Error('QUEUE_CLAIM_COUNT_MISMATCH: batch_id=' + String(request.batch_id) + ' expected=' + String(request.item_count) + ' actual=' + String(rows.length));
}
if (rows.some((row) => String(row.batch_id) !== String(request.batch_id) || String(row.batch_status).toUpperCase() !== 'LOCKED' || String(row.send_status).toUpperCase() !== 'UNSENT' || String(row.lock_token) !== String(request.lock_token))) {
  throw new Error('QUEUE_CLAIM_INVALID: batch_id=' + String(request.batch_id));
}
return [{ json: request }];`;

const assertReReadBatchCode = `const request = $('Requested Batch Lock').first().json;
const rows = $input.all().map((item) => item.json ?? {}).filter((row) => row.batch_id);
if (rows.length !== 1 || String(rows[0].batch_id) !== String(request.batch_id)) {
  throw new Error('BATCH_REREAD_CARDINALITY: batch_id=' + String(request.batch_id));
}
return [{ json: request }];`;

const collapseReviewRowsCode = `const request = $('Requested Batch Lock').first().json;
const rows = $input.all().map((item) => item.json ?? {}).filter((row) => row.review_id);
if (rows.length !== Number(request.item_count)) {
  throw new Error('QUEUE_REREAD_CARDINALITY: batch_id=' + String(request.batch_id));
}
return [{ json: request }];`;

const collapseActiveControlsCode = `const request = $('Requested Batch Lock').first().json;
const rows = $input.all().map((item) => item.json ?? {});
if (rows.some((row) => row.error || row.errorMessage)) {
  throw new Error('ACTIVE_CONTROL_REREAD_FAILED: batch_id=' + String(request.batch_id));
}
return [{ json: request }];`;

const collapseSuppressionCode = `const request = $('Requested Batch Lock').first().json;
const rows = $input.all().map((item) => item.json ?? {});
if (rows.some((row) => row.error || row.errorMessage)) {
  throw new Error('SUPPRESSION_REREAD_FAILED: batch_id=' + String(request.batch_id));
}
return [{ json: request }];`;

const prepareBatchStartCode = `const request = $('Requested Batch Lock').first().json;
const items = $input.all().map((item) => item.json ?? {}).filter((row) => row.item_key);
if (items.length !== Number(request.item_count)) throw new Error('SEND_GATE_OUTPUT_COUNT_MISMATCH: batch_id=' + String(request.batch_id));
return [{ json: request }];`;

const restoreSendItemsCode = `return $('Fail-Closed Send Gate').all().map((item) => ({ json: item.json }));`;

const assertBatchSendingCode = `const request = $('Requested Batch Lock').first().json;
const rows = $input.all().map((item) => item.json ?? {}).filter((row) => row.batch_id);
if (rows.length !== 1 || String(rows[0].status).toUpperCase() !== 'SENDING' || String(rows[0].lock_token) !== String(request.lock_token)) {
  throw new Error('BATCH_START_FAILED: batch_id=' + String(request.batch_id));
}
return [{ json: request }];`;

const assertItemSendingCode = `const gateItem = $('Loop Locked Items').item.json;
const rows = $input.all().map((item) => item.json ?? {}).filter((row) => row.item_key);
if (rows.length !== 1 || String(rows[0].item_key) !== String(gateItem.item_key) || String(rows[0].status).toUpperCase() !== 'SENDING') {
  throw new Error('ITEM_START_FAILED: item_key=' + String(gateItem.item_key));
}
return [{ json: gateItem }];`;

const assertQueueSendingCode = `const gateItem = $('Loop Locked Items').item.json;
const rows = $input.all().map((item) => item.json ?? {}).filter((row) => row.review_id);
if (rows.length !== 1 || String(rows[0].review_id) !== String(gateItem.review_id) || String(rows[0].send_status).toUpperCase() !== 'SENDING') {
  throw new Error('QUEUE_START_FAILED: review_id=' + String(gateItem.review_id));
}
return [{ json: gateItem }];`;

const normalizeSmtpCode = `function normalizeEmail(value) { return String(value ?? '').trim().toLowerCase(); }
const row = $('Final Pre-SMTP Control Gate').item.json;
const response = $input.first().json ?? {};
const accepted = Array.isArray(response.accepted) ? response.accepted.map(normalizeEmail) : [];
const rejected = Array.isArray(response.rejected) ? response.rejected.map(normalizeEmail) : [];
const target = normalizeEmail(row.send_to);
const providerMessageId = String(response.messageId ?? '').trim();
const providerAccepted = Boolean(providerMessageId && accepted.includes(target) && !rejected.includes(target));
const now = new Date().toISOString();
let audit = [];
try { audit = JSON.parse(String(row.audit_json || '[]')); } catch { audit = []; }
if (!Array.isArray(audit)) audit = [];
audit = [...audit.slice(-49), { action: providerAccepted ? 'EMAIL_SENT' : 'SMTP_NEEDS_RECONCILIATION', actor: 'n8n:sender-v3', batch_id: row.batch_id, item_key: row.item_key, provider_message_id: providerMessageId, at: now }];
const errorDetail = JSON.stringify({ accepted, rejected, messageId: providerMessageId, error: response.error?.message ?? response.message ?? '' }).slice(0, 500);
return [{ json: { ...row, provider_accepted: providerAccepted, provider_message_id: providerMessageId, sent_at: now, audit_json: JSON.stringify(audit), last_error_code: providerAccepted ? '' : 'PROVIDER_AMBIGUOUS_ACCEPTANCE', last_error_message: providerAccepted ? '' : errorDetail, updated_at: now } }];`;

const finalizeItemsCode = `const request = $('Requested Batch Lock').first().json;
const rawRows = $input.all().map((item) => item.json ?? {}).filter((row) => row.item_key);
const byItemKey = new Map();
for (const row of rawRows) {
  const itemKey = String(row.item_key ?? '').trim();
  const signature = JSON.stringify({
    batch_id: String(row.batch_id ?? '').trim(),
    status: String(row.status ?? '').trim().toUpperCase(),
    lock_token: String(row.lock_token ?? '').trim(),
    provider_message_id: String(row.provider_message_id ?? '').trim(),
  });
  const existing = byItemKey.get(itemKey);
  if (existing && existing.signature !== signature) {
    throw new Error('BATCH_ITEM_COMPLETION_CONFLICT: item_key=' + itemKey);
  }
  if (!existing) byItemKey.set(itemKey, { row, signature });
}
const rows = [...byItemKey.values()].map((entry) => entry.row);
const providerIds = rows.map((row) => String(row.provider_message_id ?? '').trim());
const invalid = rows.some((row) =>
  String(row.batch_id ?? '').trim() !== String(request.batch_id) ||
  String(row.status ?? '').trim().toUpperCase() !== 'SENT' ||
  String(row.lock_token ?? '').trim() !== String(request.lock_token) ||
  !String(row.provider_message_id ?? '').trim()
);
if (
  rows.length !== Number(request.item_count) ||
  invalid ||
  new Set(providerIds).size !== rows.length
) {
  throw new Error('BATCH_ITEM_COMPLETION_MISMATCH: batch_id=' + String(request.batch_id));
}
return [{ json: request }];`;

const finalizeQueueCode = `const request = $('Requested Batch Lock').first().json;
const rawRows = $input.all().map((item) => item.json ?? {}).filter((row) => row.review_id);
const byReviewId = new Map();
for (const row of rawRows) {
  const reviewId = String(row.review_id ?? '').trim();
  const signature = JSON.stringify({
    batch_id: String(row.batch_id ?? '').trim(),
    batch_status: String(row.batch_status ?? '').trim().toUpperCase(),
    send_status: String(row.send_status ?? '').trim().toUpperCase(),
    lock_token: String(row.lock_token ?? '').trim(),
    provider_message_id: String(row.provider_message_id ?? '').trim(),
  });
  const existing = byReviewId.get(reviewId);
  if (existing && existing.signature !== signature) {
    throw new Error('QUEUE_COMPLETION_CONFLICT: review_id=' + reviewId);
  }
  if (!existing) byReviewId.set(reviewId, { row, signature });
}
const rows = [...byReviewId.values()].map((entry) => entry.row);
const providerIds = rows.map((row) => String(row.provider_message_id ?? '').trim());
const invalid = rows.some((row) =>
  String(row.batch_id ?? '').trim() !== String(request.batch_id) ||
  String(row.batch_status ?? '').trim().toUpperCase() !== 'SENT' ||
  String(row.send_status ?? '').trim().toUpperCase() !== 'SENT' ||
  String(row.lock_token ?? '').trim() !== String(request.lock_token) ||
  !String(row.provider_message_id ?? '').trim()
);
const sentItems = $('Re-read SENT Batch Items')
  .all()
  .map((item) => item.json ?? {})
  .filter((row) => row.item_key);
const itemProviderIds = [...new Map(
  sentItems.map((row) => [
    String(row.item_key ?? '').trim(),
    String(row.provider_message_id ?? '').trim(),
  ]),
).values()];
const sortedQueueProviderIds = [...providerIds].sort();
const sortedItemProviderIds = [...itemProviderIds].sort();
if (
  rows.length !== Number(request.item_count) ||
  invalid ||
  new Set(providerIds).size !== rows.length ||
  itemProviderIds.length !== Number(request.item_count) ||
  JSON.stringify(sortedQueueProviderIds) !== JSON.stringify(sortedItemProviderIds)
) {
  throw new Error('QUEUE_COMPLETION_MISMATCH: batch_id=' + String(request.batch_id));
}
return [{ json: request }];`;

const batchSummaryCode = `const batch = $input.first().json ?? {};
const request = $('Requested Batch Lock').first().json;
if (String(batch.status).toUpperCase() !== 'COMPLETE') throw new Error('BATCH_FINALIZE_FAILED: batch_id=' + String(request.batch_id));
return [{ json: { batch_id: request.batch_id, item_count: request.item_count, status: 'COMPLETE', execution_id: String($execution.id), completed_at: batch.completed_at } }];`;

const stopReconciliationCode = `const row = $('Normalize SMTP Result').item.json;
throw new Error('SMTP_NEEDS_RECONCILIATION: batch_id=' + String(row.batch_id) + ' item_key=' + String(row.item_key) + ' detail=' + String(row.last_error_message));`;

const n = [];
n.push(node('Schedule Trigger', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], {
  rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] },
}));
n.push(node('Manual Trigger', 'n8n-nodes-base.manualTrigger', 1, [0, 208], {}));
n.push(node('Read Config', 'n8n-nodes-base.googleSheets', 4.6, [224, 0], {
  documentId: {
    __rl: true,
    value: 'EXAMPLE_CONFIG_SHEET_ID',
    mode: 'list',
    cachedResultName: 'Example clinic configuration',
  },
  sheetName: {
    __rl: true,
    value: 1700000000,
    mode: 'list',
    cachedResultName: 'Config',
  },
  options: {},
}, {
  executeOnce: true,
  credentials: {
    googleSheetsOAuth2Api: {
      id: 'EXAMPLE_SHEETS_CREDENTIAL',
      name: 'Google Sheets account',
    },
  },
}));
n.push(codeNode('Preflight Send Config', [448, 0], preflightCode));
n.push(dataTableGet('Read Batch Ledger', 'batches', [672, 0], {
  returnAll: true,
  alwaysOutputData: true,
  executeOnce: true,
}));
n.push(codeNode('Requested Batch Lock', [896, 0], requestedBatchLockCode, {
  mode: 'runOnceForAllItems',
}));
n.push(dataTableUpdate('Claim Batch LOCKED', 'batches', [1120, 0], [
  ['batch_id', "={{ $('Requested Batch Lock').first().json.batch_id }}"],
  ['status', 'CONFIRMED'],
  ['lock_token', ''],
], {
  status: 'LOCKED',
  lock_token: "={{ $('Requested Batch Lock').first().json.lock_token }}",
  locked_at: "={{ $('Requested Batch Lock').first().json.locked_at }}",
  execution_id: '={{ $execution.id }}',
  updated_at: '={{ $now.toISO() }}',
}, { alwaysOutputData: true }));
n.push(codeNode('Assert Batch Claim', [1344, 0], assertBatchClaimCode, {
  mode: 'runOnceForAllItems',
}));
n.push(dataTableUpdate('Claim Batch Items LOCKED', 'items', [1568, 0], [
  ['batch_id', "={{ $('Requested Batch Lock').first().json.batch_id }}"],
  ['status', 'CONFIRMED'],
  ['lock_token', ''],
], {
  status: 'LOCKED',
  lock_token: "={{ $('Requested Batch Lock').first().json.lock_token }}",
  locked_at: "={{ $('Requested Batch Lock').first().json.locked_at }}",
  execution_id: '={{ $execution.id }}',
  updated_at: '={{ $now.toISO() }}',
}, { alwaysOutputData: true }));
n.push(codeNode('Assert Batch Item Claim', [1792, 0], assertItemClaimCode, {
  mode: 'runOnceForAllItems',
}));
n.push(dataTableUpdate('Claim Review Rows LOCKED', 'queue', [2016, 0], [
  ['batch_id', "={{ $('Requested Batch Lock').first().json.batch_id }}"],
  ['batch_status', 'CONFIRMED'],
  ['approval_status', 'APPROVED'],
  ['send_status', 'UNSENT'],
  ['lock_token', ''],
], {
  batch_status: 'LOCKED',
  lock_token: "={{ $('Requested Batch Lock').first().json.lock_token }}",
  locked_at: "={{ $('Requested Batch Lock').first().json.locked_at }}",
  execution_id: '={{ $execution.id }}',
  updated_by: 'n8n:sender-v3',
  updated_at: '={{ $now.toISO() }}',
}, { alwaysOutputData: true }));
n.push(codeNode('Assert Review Row Claim', [2240, 0], assertQueueClaimCode, {
  mode: 'runOnceForAllItems',
}));
n.push(dataTableGet('Re-read Claimed Batch', 'batches', [2464, 0], {
  filters: [
    ['batch_id', "={{ $('Requested Batch Lock').first().json.batch_id }}"],
    ['status', 'LOCKED'],
    ['lock_token', "={{ $('Requested Batch Lock').first().json.lock_token }}"],
  ],
  returnAll: true,
  alwaysOutputData: true,
}));
n.push(codeNode('Assert Re-read Batch', [2688, 0], assertReReadBatchCode, {
  mode: 'runOnceForAllItems',
}));
n.push(dataTableGet('Re-read Locked Review Rows', 'queue', [2912, 0], {
  filters: [
    ['batch_id', "={{ $('Requested Batch Lock').first().json.batch_id }}"],
    ['batch_status', 'LOCKED'],
    ['lock_token', "={{ $('Requested Batch Lock').first().json.lock_token }}"],
  ],
  returnAll: true,
  alwaysOutputData: true,
}));
n.push(codeNode('Collapse Review Re-read', [3136, 0], collapseReviewRowsCode, {
  mode: 'runOnceForAllItems',
}));
n.push(activeControlsGet('Re-read Active Controls', [3360, 0], {
  alwaysOutputData: true,
  executeOnce: true,
}));
n.push(codeNode('Collapse Active Controls', [3584, 0], collapseActiveControlsCode, {
  mode: 'runOnceForAllItems',
}));
n.push(dataTableGet('Re-read Suppression', 'queue', [3808, 0], {
  filters: [['send_status', 'SUPPRESSED']],
  returnAll: true,
  alwaysOutputData: true,
}));
n.push(codeNode('Collapse Suppression Re-read', [4032, 0], collapseSuppressionCode, {
  mode: 'runOnceForAllItems',
}));
n.push(dataTableGet('Re-read Locked Batch Items', 'items', [4256, 0], {
  filters: [
    ['batch_id', "={{ $('Requested Batch Lock').first().json.batch_id }}"],
    ['status', 'LOCKED'],
    ['lock_token', "={{ $('Requested Batch Lock').first().json.lock_token }}"],
  ],
  returnAll: true,
  alwaysOutputData: true,
}));
n.push(codeNode('Fail-Closed Send Gate', [4480, 0], sendGateCode, {
  mode: 'runOnceForAllItems',
}));
n.push(codeNode('Prepare Batch Start', [4704, 0], prepareBatchStartCode, {
  mode: 'runOnceForAllItems',
}));
n.push(dataTableUpdate('Mark Batch SENDING', 'batches', [4928, 0], [
  ['batch_id', "={{ $('Requested Batch Lock').first().json.batch_id }}"],
  ['status', 'LOCKED'],
  ['lock_token', "={{ $('Requested Batch Lock').first().json.lock_token }}"],
], {
  status: 'SENDING',
  started_at: '={{ $now.toISO() }}',
  execution_id: '={{ $execution.id }}',
  updated_at: '={{ $now.toISO() }}',
}, { alwaysOutputData: true }));
n.push(codeNode('Assert Batch SENDING', [5152, 0], assertBatchSendingCode, {
  mode: 'runOnceForAllItems',
}));
n.push(codeNode('Restore Locked Send Items', [5376, 0], restoreSendItemsCode, {
  mode: 'runOnceForAllItems',
}));
n.push(node('Loop Locked Items', 'n8n-nodes-base.splitInBatches', 3, [5600, 0], {
  options: { reset: false },
}));
n.push(dataTableUpdate('Mark Item SENDING', 'items', [5824, 208], [
  ['item_key', "={{ $('Loop Locked Items').item.json.item_key }}"],
  ['status', 'LOCKED'],
  ['lock_token', "={{ $('Loop Locked Items').item.json.lock_token }}"],
], {
  status: 'SENDING',
  attempt_count: "={{ $('Loop Locked Items').item.json.item_attempt_count }}",
  execution_id: '={{ $execution.id }}',
  updated_at: '={{ $now.toISO() }}',
}, { alwaysOutputData: true }));
n.push(codeNode('Assert Item SENDING', [6048, 208], assertItemSendingCode, {
  mode: 'runOnceForAllItems',
}));
n.push(dataTableUpdate('Mark Review Row SENDING', 'queue', [6272, 208], [
  ['review_id', "={{ $('Loop Locked Items').item.json.review_id }}"],
  ['batch_id', "={{ $('Loop Locked Items').item.json.batch_id }}"],
  ['batch_status', 'LOCKED'],
  ['send_status', 'UNSENT'],
  ['lock_token', "={{ $('Loop Locked Items').item.json.lock_token }}"],
], {
  batch_status: 'SENDING',
  send_status: 'SENDING',
  provider: 'smtp',
  attempt_count: "={{ $('Loop Locked Items').item.json.queue_attempt_count }}",
  execution_id: '={{ $execution.id }}',
  updated_by: 'n8n:sender-v3',
  updated_at: '={{ $now.toISO() }}',
}, { alwaysOutputData: true }));
n.push(codeNode('Assert Review Row SENDING', [6496, 208], assertQueueSendingCode, {
  mode: 'runOnceForAllItems',
}));
n.push(activeControlsGet('Pre-SMTP Active Controls', [6720, 208], {
  alwaysOutputData: true,
}));
n.push(dataTableGet('Pre-SMTP Queue Sentinel', 'queue', [6944, 208], {
  filters: [
    ['send_status', 'SUPPRESSED'],
    ['email', "={{ $('Loop Locked Items').item.json.intended_recipient }}"],
  ],
  returnAll: true,
  alwaysOutputData: true,
  executeOnce: true,
}));
n.push(codeNode('Final Pre-SMTP Control Gate', [7168, 208], preSmtpControlGateCode, {
  mode: 'runOnceForAllItems',
}));
n.push(node('SMTP Send', 'n8n-nodes-base.emailSend', 2.1, [7392, 208], {
  operation: 'send',
  fromEmail: "={{ $json.sender_name + ' <' + $json.sender_email + '>' }}",
  toEmail: '={{ $json.send_to }}',
  subject: "={{ $json.send_mode === 'TEST' ? '[TEST — ' + $json.company_name + '] ' + $json.draft_subject : $json.draft_subject }}",
  emailFormat: 'both',
  text: '={{ $json.email_text }}',
  html: '={{ $json.email_html }}',
  options: {
    appendAttribution: false,
    allowUnauthorizedCerts: false,
    replyTo: '={{ $json.reply_to }}',
  },
}, {
  onError: 'continueRegularOutput',
  credentials: {
    smtp: {
      id: 'EXAMPLE_SMTP_CREDENTIAL',
      name: 'Zoho SMTP - service@iawebdev',
    },
  },
}));
n.push(codeNode('Normalize SMTP Result', [7616, 208], normalizeSmtpCode));
n.push(booleanIf('Provider Accepted?', [7840, 208], '={{ $json.provider_accepted }}'));
n.push(dataTableUpdate('Persist Item SENT', 'items', [8064, 96], [
  ['item_key', '={{ $json.item_key }}'],
  ['status', 'SENDING'],
  ['lock_token', '={{ $json.lock_token }}'],
], {
  status: 'SENT',
  attempt_count: '={{ $json.item_attempt_count }}',
  provider_message_id: '={{ $json.provider_message_id }}',
  sent_at: '={{ $json.sent_at }}',
  unsubscribe_token: '',
  execution_id: '={{ $execution.id }}',
  last_error_code: '',
  last_error_message: '',
  updated_at: '={{ $json.updated_at }}',
}, {
  alwaysOutputData: true,
  onError: 'continueRegularOutput',
}));
n.push(booleanIf('Item SENT Persisted?', [8288, 96], "={{ $json.status === 'SENT' && Boolean($json.provider_message_id) }}"));
n.push(dataTableUpdate('Persist Review Row SENT', 'queue', [8512, 0], [
  ['review_id', "={{ $('Normalize SMTP Result').item.json.review_id }}"],
  ['batch_id', "={{ $('Normalize SMTP Result').item.json.batch_id }}"],
  ['batch_status', 'SENDING'],
  ['send_status', 'SENDING'],
  ['lock_token', "={{ $('Normalize SMTP Result').item.json.lock_token }}"],
], {
  batch_status: 'SENT',
  send_status: 'SENT',
  provider: 'smtp',
  provider_message_id: "={{ $('Normalize SMTP Result').item.json.provider_message_id }}",
  attempt_count: "={{ $('Normalize SMTP Result').item.json.queue_attempt_count }}",
  execution_id: '={{ $execution.id }}',
  last_error_code: '',
  last_error_message: '',
  updated_by: 'n8n:sender-v3',
  audit_json: "={{ $('Normalize SMTP Result').item.json.audit_json }}",
  updated_at: "={{ $('Normalize SMTP Result').item.json.updated_at }}",
}, {
  alwaysOutputData: true,
  onError: 'continueRegularOutput',
}));
n.push(booleanIf('Review Row SENT Persisted?', [8736, 0], "={{ $json.send_status === 'SENT' && $json.batch_status === 'SENT' && Boolean($json.provider_message_id) }}"));
n.push(node('Wait Between Sends', 'n8n-nodes-base.wait', 1.1, [8960, 0], {
  amount: "={{ $('Loop Locked Items').item.json.inter_send_seconds }}",
}));
n.push(dataTableUpdate('Mark Item NEEDS_RECONCILIATION', 'items', [8064, 368], [
  ['item_key', "={{ $('Normalize SMTP Result').item.json.item_key }}"],
  ['batch_id', "={{ $('Normalize SMTP Result').item.json.batch_id }}"],
  ['lock_token', "={{ $('Normalize SMTP Result').item.json.lock_token }}"],
], {
  status: 'NEEDS_RECONCILIATION',
  attempt_count: "={{ $('Normalize SMTP Result').item.json.item_attempt_count }}",
  provider_message_id: "={{ $('Normalize SMTP Result').item.json.provider_message_id }}",
  execution_id: '={{ $execution.id }}',
  last_error_code: "={{ $('Normalize SMTP Result').item.json.last_error_code || 'POST_SMTP_PERSISTENCE_FAILED' }}",
  last_error_message: "={{ $('Normalize SMTP Result').item.json.last_error_message || 'Provider response or post-send persistence is ambiguous.' }}",
  updated_at: '={{ $now.toISO() }}',
}, { onError: 'continueRegularOutput' }));
n.push(dataTableUpdate('Mark Review Row NEEDS_RECONCILIATION', 'queue', [8288, 368], [
  ['review_id', "={{ $('Normalize SMTP Result').item.json.review_id }}"],
  ['batch_id', "={{ $('Normalize SMTP Result').item.json.batch_id }}"],
  ['lock_token', "={{ $('Normalize SMTP Result').item.json.lock_token }}"],
], {
  batch_status: 'NEEDS_RECONCILIATION',
  send_status: 'NEEDS_RECONCILIATION',
  provider: 'smtp',
  provider_message_id: "={{ $('Normalize SMTP Result').item.json.provider_message_id }}",
  attempt_count: "={{ $('Normalize SMTP Result').item.json.queue_attempt_count }}",
  execution_id: '={{ $execution.id }}',
  last_error_code: "={{ $('Normalize SMTP Result').item.json.last_error_code || 'POST_SMTP_PERSISTENCE_FAILED' }}",
  last_error_message: "={{ $('Normalize SMTP Result').item.json.last_error_message || 'Provider response or post-send persistence is ambiguous.' }}",
  updated_by: 'n8n:sender-v3',
  audit_json: "={{ $('Normalize SMTP Result').item.json.audit_json }}",
  updated_at: '={{ $now.toISO() }}',
}, { onError: 'continueRegularOutput' }));
n.push(dataTableUpdate('Mark Batch NEEDS_RECONCILIATION', 'batches', [8512, 368], [
  ['batch_id', "={{ $('Normalize SMTP Result').item.json.batch_id }}"],
  ['lock_token', "={{ $('Normalize SMTP Result').item.json.lock_token }}"],
], {
  status: 'NEEDS_RECONCILIATION',
  execution_id: '={{ $execution.id }}',
  last_error_code: "={{ $('Normalize SMTP Result').item.json.last_error_code || 'POST_SMTP_PERSISTENCE_FAILED' }}",
  last_error_message: "={{ $('Normalize SMTP Result').item.json.last_error_message || 'Provider response or post-send persistence is ambiguous.' }}",
  updated_at: '={{ $now.toISO() }}',
}, { onError: 'continueRegularOutput' }));
n.push(codeNode('Stop for Reconciliation', [8736, 368], stopReconciliationCode));
n.push(dataTableGet('Re-read SENT Batch Items', 'items', [5824, -208], {
  filters: [
    ['batch_id', "={{ $('Requested Batch Lock').first().json.batch_id }}"],
    ['status', 'SENT'],
    ['lock_token', "={{ $('Requested Batch Lock').first().json.lock_token }}"],
  ],
  returnAll: true,
  alwaysOutputData: true,
  executeOnce: true,
}));
n.push(codeNode('Assert All Items SENT', [6048, -208], finalizeItemsCode, {
  mode: 'runOnceForAllItems',
}));
n.push(dataTableGet('Re-read SENT Review Rows', 'queue', [6272, -208], {
  filters: [
    ['batch_id', "={{ $('Requested Batch Lock').first().json.batch_id }}"],
    ['batch_status', 'SENT'],
    ['send_status', 'SENT'],
    ['lock_token', "={{ $('Requested Batch Lock').first().json.lock_token }}"],
  ],
  returnAll: true,
  alwaysOutputData: true,
  executeOnce: true,
}));
n.push(codeNode('Assert All Review Rows SENT', [6496, -208], finalizeQueueCode, {
  mode: 'runOnceForAllItems',
}));
n.push(dataTableUpdate('Mark Batch COMPLETE', 'batches', [6720, -208], [
  ['batch_id', "={{ $('Requested Batch Lock').first().json.batch_id }}"],
  ['status', 'SENDING'],
  ['lock_token', "={{ $('Requested Batch Lock').first().json.lock_token }}"],
], {
  status: 'COMPLETE',
  completed_at: '={{ $now.toISO() }}',
  execution_id: '={{ $execution.id }}',
  last_error_code: '',
  last_error_message: '',
  updated_at: '={{ $now.toISO() }}',
}, { alwaysOutputData: true }));
n.push(codeNode('Batch Summary', [6944, -208], batchSummaryCode));

const connections = {};
function connect(from, to, output = 0) {
  connections[from] ??= { main: [] };
  connections[from].main[output] ??= [];
  connections[from].main[output].push({ node: to, type: 'main', index: 0 });
}

connect('Schedule Trigger', 'Read Config');
connect('Manual Trigger', 'Read Config');
connect('Read Config', 'Preflight Send Config');
connect('Preflight Send Config', 'Read Batch Ledger');
connect('Read Batch Ledger', 'Requested Batch Lock');
connect('Requested Batch Lock', 'Claim Batch LOCKED');
connect('Claim Batch LOCKED', 'Assert Batch Claim');
connect('Assert Batch Claim', 'Claim Batch Items LOCKED');
connect('Claim Batch Items LOCKED', 'Assert Batch Item Claim');
connect('Assert Batch Item Claim', 'Claim Review Rows LOCKED');
connect('Claim Review Rows LOCKED', 'Assert Review Row Claim');
connect('Assert Review Row Claim', 'Re-read Claimed Batch');
connect('Re-read Claimed Batch', 'Assert Re-read Batch');
connect('Assert Re-read Batch', 'Re-read Locked Review Rows');
connect('Re-read Locked Review Rows', 'Collapse Review Re-read');
connect('Collapse Review Re-read', 'Re-read Active Controls');
connect('Re-read Active Controls', 'Collapse Active Controls');
connect('Collapse Active Controls', 'Re-read Suppression');
connect('Re-read Suppression', 'Collapse Suppression Re-read');
connect('Collapse Suppression Re-read', 'Re-read Locked Batch Items');
connect('Re-read Locked Batch Items', 'Fail-Closed Send Gate');
connect('Fail-Closed Send Gate', 'Prepare Batch Start');
connect('Prepare Batch Start', 'Mark Batch SENDING');
connect('Mark Batch SENDING', 'Assert Batch SENDING');
connect('Assert Batch SENDING', 'Restore Locked Send Items');
connect('Restore Locked Send Items', 'Loop Locked Items');
connect('Loop Locked Items', 'Re-read SENT Batch Items', 0);
connect('Loop Locked Items', 'Mark Item SENDING', 1);
connect('Mark Item SENDING', 'Assert Item SENDING');
connect('Assert Item SENDING', 'Mark Review Row SENDING');
connect('Mark Review Row SENDING', 'Assert Review Row SENDING');
connect('Assert Review Row SENDING', 'Pre-SMTP Active Controls');
connect('Pre-SMTP Active Controls', 'Pre-SMTP Queue Sentinel');
connect('Pre-SMTP Queue Sentinel', 'Final Pre-SMTP Control Gate');
connect('Final Pre-SMTP Control Gate', 'SMTP Send');
connect('SMTP Send', 'Normalize SMTP Result');
connect('Normalize SMTP Result', 'Provider Accepted?');
connect('Provider Accepted?', 'Persist Item SENT', 0);
connect('Provider Accepted?', 'Mark Item NEEDS_RECONCILIATION', 1);
connect('Persist Item SENT', 'Item SENT Persisted?');
connect('Item SENT Persisted?', 'Persist Review Row SENT', 0);
connect('Item SENT Persisted?', 'Mark Item NEEDS_RECONCILIATION', 1);
connect('Persist Review Row SENT', 'Review Row SENT Persisted?');
connect('Review Row SENT Persisted?', 'Wait Between Sends', 0);
connect('Review Row SENT Persisted?', 'Mark Item NEEDS_RECONCILIATION', 1);
connect('Wait Between Sends', 'Loop Locked Items');
connect('Mark Item NEEDS_RECONCILIATION', 'Mark Review Row NEEDS_RECONCILIATION');
connect('Mark Review Row NEEDS_RECONCILIATION', 'Mark Batch NEEDS_RECONCILIATION');
connect('Mark Batch NEEDS_RECONCILIATION', 'Stop for Reconciliation');
connect('Re-read SENT Batch Items', 'Assert All Items SENT');
connect('Assert All Items SENT', 'Re-read SENT Review Rows');
connect('Re-read SENT Review Rows', 'Assert All Review Rows SENT');
connect('Assert All Review Rows SENT', 'Mark Batch COMPLETE');
connect('Mark Batch COMPLETE', 'Batch Summary');

const workflow = {
  name: 'Nunoon - Exact Batch Sender v3',
  nodes: n,
  connections,
  active: false,
  settings: {
    executionOrder: 'v1',
    binaryMode: 'separate',
    timeSavedMode: 'fixed',
    timezone: 'Asia/Dubai',
    errorWorkflow: 'ORFPwT8MCSaXI3Kr',
    saveExecutionProgress: true,
    callerPolicy: 'workflowsFromSameOwner',
    availableInMCP: false,
  },
  staticData: null,
  pinData: {},
  meta: {
    templateCredsSetupCompleted: true,
  },
};

process.stdout.write(`${JSON.stringify(workflow, null, 2)}\n`);
