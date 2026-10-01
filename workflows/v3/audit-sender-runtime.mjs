import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const resources = JSON.parse(
  fs.readFileSync(path.join(here, 'live-resources.example.json'), 'utf8'),
);

function normalized(value) {
  return String(value ?? '').trim();
}

function state(value) {
  return normalized(value).toUpperCase();
}

function uniqueIndex(rows, key, label) {
  const index = new Map();
  for (const row of rows) {
    const value = normalized(row[key]);
    assert.ok(value, `${label} contains a row without ${key}`);
    assert.equal(index.has(value), false, `${label} duplicate ${key}: ${value}`);
    index.set(value, row);
  }
  return index;
}

function assertValidDate(value, label) {
  const timestamp = Date.parse(normalized(value));
  assert.equal(Number.isFinite(timestamp), true, `${label} is not a valid date`);
  return timestamp;
}

export function auditSenderRuntime(
  { batches, items, queue },
  { now = Date.now() } = {},
) {
  assert.ok(Array.isArray(batches), 'batches must be an array');
  assert.ok(Array.isArray(items), 'items must be an array');
  assert.ok(Array.isArray(queue), 'queue must be an array');

  const batchById = uniqueIndex(batches, 'batch_id', 'batch ledger');
  const itemByKey = uniqueIndex(items, 'item_key', 'batch items');
  const queueByReviewId = uniqueIndex(queue, 'review_id', 'review queue');
  const sendingBatches = batches.filter((row) => state(row.status) === 'SENDING');
  assert.ok(
    sendingBatches.length <= 1,
    `more than one SENDING batch: ${sendingBatches.map((row) => row.batch_id).join(', ')}`,
  );

  for (const batch of sendingBatches) {
    const batchId = normalized(batch.batch_id);
    const startedAt = assertValidDate(
      batch.started_at || batch.locked_at,
      `SENDING batch ${batchId} started_at`,
    );
    const itemCount = Number(batch.item_count);
    const pacingSeconds = Number(batch.inter_send_seconds_snapshot || 90);
    const expectedPacingMs = Math.max(0, itemCount - 1) * pacingSeconds * 1000;
    const staleAfterMs = Math.max(20 * 60 * 1000, expectedPacingMs + 10 * 60 * 1000);
    assert.ok(
      now - startedAt <= staleAfterMs,
      `stale SENDING batch ${batchId}: active for ${Math.floor((now - startedAt) / 60000)} minutes`,
    );
  }

  const providerOwner = new Map();
  for (const item of items) {
    const batchId = normalized(item.batch_id);
    assert.ok(batchById.has(batchId), `orphan batch item ${item.item_key}: ${batchId}`);
    const reviewId = normalized(item.review_id);
    assert.ok(queueByReviewId.has(reviewId), `batch item ${item.item_key} has no review row`);

    if (state(item.status) !== 'SENT') continue;
    const providerId = normalized(item.provider_message_id);
    assert.ok(providerId, `SENT item ${item.item_key} has no provider message ID`);
    assert.equal(
      providerOwner.has(providerId),
      false,
      `duplicate provider message ID: ${providerId}`,
    );
    providerOwner.set(providerId, normalized(item.item_key));

    const review = queueByReviewId.get(reviewId);
    assert.equal(
      normalized(review.batch_id),
      batchId,
      `review row ${reviewId} points to the wrong batch`,
    );
    assert.equal(
      normalized(review.provider_message_id),
      providerId,
      `provider ID mismatch for review row ${reviewId}`,
    );
    assert.equal(state(review.send_status), 'SENT', `review row ${reviewId} is not SENT`);
  }

  for (const batch of batches) {
    const batchId = normalized(batch.batch_id);
    const batchState = state(batch.status);
    const expectedCount = Number(batch.item_count);
    assert.ok(Number.isInteger(expectedCount) && expectedCount > 0, `invalid item_count for ${batchId}`);

    const batchItems = items.filter((row) => normalized(row.batch_id) === batchId);
    if (batchState === 'CANCELLED') continue;
    assert.equal(
      batchItems.length,
      expectedCount,
      `batch item count mismatch for ${batchId}`,
    );

    if (batchState === 'SENDING') {
      const lockToken = normalized(batch.lock_token);
      assert.ok(lockToken, `SENDING batch ${batchId} has no lock token`);
      for (const item of batchItems) {
        assert.ok(
          ['LOCKED', 'SENDING', 'SENT'].includes(state(item.status)),
          `SENDING batch ${batchId} has invalid item state ${item.status}`,
        );
        assert.equal(
          normalized(item.lock_token),
          lockToken,
          `lock mismatch for item ${item.item_key}`,
        );
      }
    }

    if (batchState !== 'COMPLETE') continue;
    assertValidDate(batch.completed_at, `COMPLETE batch ${batchId} completed_at`);
    const itemProviderIds = [];
    const queueProviderIds = [];
    for (const item of batchItems) {
      assert.equal(state(item.status), 'SENT', `COMPLETE batch ${batchId} has a non-SENT item`);
      const review = queueByReviewId.get(normalized(item.review_id));
      assert.equal(
        state(review.batch_status),
        'SENT',
        `COMPLETE batch ${batchId} has a non-SENT review batch state`,
      );
      itemProviderIds.push(normalized(item.provider_message_id));
      queueProviderIds.push(normalized(review.provider_message_id));
    }
    assert.equal(new Set(itemProviderIds).size, expectedCount, `provider IDs are not unique for ${batchId}`);
    assert.deepEqual(
      [...queueProviderIds].sort(),
      [...itemProviderIds].sort(),
      `queue and item provider IDs differ for ${batchId}`,
    );
  }

  return {
    batches: batchById.size,
    items: itemByKey.size,
    queueRows: queueByReviewId.size,
    completeBatches: batches.filter((row) => state(row.status) === 'COMPLETE').length,
    confirmedBatches: batches.filter((row) => state(row.status) === 'CONFIRMED').length,
    cancelledBatches: batches.filter((row) => state(row.status) === 'CANCELLED').length,
    sendingBatchId: sendingBatches[0]?.batch_id ?? null,
    sentItems: items.filter((row) => state(row.status) === 'SENT').length,
  };
}

async function fetchAllRows(baseUrl, apiKey, tableId) {
  const rows = [];
  let cursor = '';
  const seenCursors = new Set();
  for (let page = 0; page < 100; page += 1) {
    const url = new URL(
      `${baseUrl}/data-tables/${encodeURIComponent(tableId)}/rows`,
    );
    url.searchParams.set('limit', '250');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'X-N8N-API-KEY': apiKey },
    });
    assert.equal(
      response.ok,
      true,
      `n8n data-table read failed (${tableId}): ${response.status}`,
    );
    const payload = await response.json();
    assert.ok(Array.isArray(payload.data), `n8n returned invalid rows for ${tableId}`);
    rows.push(...payload.data);
    const nextCursor = normalized(payload.nextCursor);
    if (!nextCursor) return rows;
    assert.equal(seenCursors.has(nextCursor), false, `repeated cursor for ${tableId}`);
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new Error(`n8n data-table pagination exceeded 100 pages (${tableId})`);
}

async function main() {
  const baseUrl = normalized(process.env.N8N_BASE_URL).replace(/\/+$/, '');
  const apiKey = normalized(process.env.N8N_API_KEY);
  assert.ok(baseUrl && apiKey, 'N8N_BASE_URL and N8N_API_KEY are required');
  const [batches, items, queue] = await Promise.all([
    fetchAllRows(baseUrl, apiKey, resources.tables.outreach_batches_v3),
    fetchAllRows(baseUrl, apiKey, resources.tables.outreach_batch_items_v3),
    fetchAllRows(baseUrl, apiKey, resources.tables.outreach_review_queue_v3),
  ]);
  const result = auditSenderRuntime({ batches, items, queue });
  process.stdout.write(`sender runtime audit passed ${JSON.stringify(result)}\n`);
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await main();
}
