import assert from 'node:assert/strict';
import fs from 'node:fs';

const payloadPath = process.argv[2];
if (!payloadPath) {
  throw new Error('Usage: node test-sender-finalization.mjs <workflow-payload.json>');
}

const workflow = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const byName = new Map(workflow.nodes.map((candidate) => [candidate.name, candidate]));
const node = (name) => {
  const found = byName.get(name);
  assert.ok(found, `missing node ${name}`);
  return found;
};

for (const name of [
  'Re-read SENT Batch Items',
  'Re-read SENT Review Rows',
]) {
  assert.equal(node(name).executeOnce, true, `${name} must execute once`);
}

const compile = (name) =>
  new Function(
    '$',
    '$input',
    `return (async () => {${node(name).parameters.jsCode}})();`,
  );

const executeItems = compile('Assert All Items SENT');
const executeQueue = compile('Assert All Review Rows SENT');
const request = {
  batch_id: 'batch-5',
  item_count: 5,
  lock_token: 'lock-5',
};
const wrap = (json) => ({ json });
const items = Array.from({ length: 5 }, (_, index) => ({
  batch_id: request.batch_id,
  item_key: `item-${index + 1}`,
  status: 'SENT',
  lock_token: request.lock_token,
  provider_message_id: `provider-${index + 1}`,
}));
const rows = Array.from({ length: 5 }, (_, index) => ({
  batch_id: request.batch_id,
  review_id: `review-${index + 1}`,
  batch_status: 'SENT',
  send_status: 'SENT',
  lock_token: request.lock_token,
  provider_message_id: `provider-${index + 1}`,
}));

const repeated = (values, copies = 4) =>
  Array.from({ length: copies }, () => values.map((value) => wrap({ ...value }))).flat();

const selectItems = (name) => ({
  first: () => (name === 'Requested Batch Lock' ? wrap(request) : wrap({})),
  all: () => [],
});
const itemResult = await executeItems(selectItems, {
  all: () => repeated(items),
});
assert.deepEqual(itemResult, [{ json: request }]);

const conflictingItems = repeated(items);
conflictingItems.at(-1).json.item_key = 'item-1';
conflictingItems.at(-1).json.provider_message_id = 'provider-conflict';
await assert.rejects(
  executeItems(selectItems, { all: () => conflictingItems }),
  /BATCH_ITEM_COMPLETION_CONFLICT: item_key=item-1/,
);

const duplicateProviderItems = items.map((item) => ({ ...item }));
duplicateProviderItems[4].provider_message_id = duplicateProviderItems[0].provider_message_id;
await assert.rejects(
  executeItems(selectItems, { all: () => duplicateProviderItems.map(wrap) }),
  /BATCH_ITEM_COMPLETION_MISMATCH: batch_id=batch-5/,
);

const selectQueue = (name) => ({
  first: () => (name === 'Requested Batch Lock' ? wrap(request) : wrap({})),
  all: () =>
    name === 'Re-read SENT Batch Items' ? repeated(items) : [],
});
const queueResult = await executeQueue(selectQueue, {
  all: () => repeated(rows),
});
assert.deepEqual(queueResult, [{ json: request }]);

const conflictingRows = repeated(rows);
conflictingRows.at(-1).json.review_id = 'review-1';
conflictingRows.at(-1).json.provider_message_id = 'provider-conflict';
await assert.rejects(
  executeQueue(selectQueue, { all: () => conflictingRows }),
  /QUEUE_COMPLETION_CONFLICT: review_id=review-1/,
);

const mismatchedRows = rows.map((row) => ({ ...row }));
mismatchedRows[4].provider_message_id = 'provider-not-in-items';
await assert.rejects(
  executeQueue(selectQueue, { all: () => mismatchedRows.map(wrap) }),
  /QUEUE_COMPLETION_MISMATCH: batch_id=batch-5/,
);

process.stdout.write('sender finalization tests passed\n');
