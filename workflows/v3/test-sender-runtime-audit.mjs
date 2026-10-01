import assert from 'node:assert/strict';
import { auditSenderRuntime } from './audit-sender-runtime.mjs';

const now = Date.parse('2026-07-21T00:00:00.000Z');
const completeBatch = {
  batch_id: 'batch-complete',
  status: 'COMPLETE',
  item_count: 2,
  completed_at: '2026-07-20T23:00:00.000Z',
};
const sendingBatch = {
  batch_id: 'batch-sending',
  status: 'SENDING',
  item_count: 1,
  inter_send_seconds_snapshot: 90,
  lock_token: 'lock-current',
  started_at: '2026-07-20T23:55:00.000Z',
};
const items = [
  {
    item_key: 'complete-1',
    review_id: 'review-1',
    batch_id: completeBatch.batch_id,
    status: 'SENT',
    provider_message_id: 'provider-1',
  },
  {
    item_key: 'complete-2',
    review_id: 'review-2',
    batch_id: completeBatch.batch_id,
    status: 'SENT',
    provider_message_id: 'provider-2',
  },
  {
    item_key: 'sending-1',
    review_id: 'review-3',
    batch_id: sendingBatch.batch_id,
    status: 'LOCKED',
    lock_token: sendingBatch.lock_token,
  },
];
const queue = [
  {
    review_id: 'review-1',
    batch_id: completeBatch.batch_id,
    batch_status: 'SENT',
    send_status: 'SENT',
    provider_message_id: 'provider-1',
  },
  {
    review_id: 'review-2',
    batch_id: completeBatch.batch_id,
    batch_status: 'SENT',
    send_status: 'SENT',
    provider_message_id: 'provider-2',
  },
  {
    review_id: 'review-3',
    batch_id: sendingBatch.batch_id,
    batch_status: 'SENDING',
    send_status: 'UNSENT',
  },
];
const fixture = () => ({
  batches: [{ ...completeBatch }, { ...sendingBatch }],
  items: items.map((row) => ({ ...row })),
  queue: queue.map((row) => ({ ...row })),
});

assert.deepEqual(auditSenderRuntime(fixture(), { now }), {
  batches: 2,
  items: 3,
  queueRows: 3,
  completeBatches: 1,
  confirmedBatches: 0,
  cancelledBatches: 0,
  sendingBatchId: 'batch-sending',
  sentItems: 2,
});

const duplicateItem = fixture();
duplicateItem.items.push({ ...duplicateItem.items[0] });
assert.throws(
  () => auditSenderRuntime(duplicateItem, { now }),
  /batch items duplicate item_key: complete-1/,
);

const providerMismatch = fixture();
providerMismatch.queue[1].provider_message_id = 'wrong-provider';
assert.throws(
  () => auditSenderRuntime(providerMismatch, { now }),
  /provider ID mismatch for review row review-2/,
);

const stale = fixture();
stale.batches[1].started_at = '2026-07-20T22:00:00.000Z';
assert.throws(
  () => auditSenderRuntime(stale, { now }),
  /stale SENDING batch batch-sending/,
);

const multipleSending = fixture();
multipleSending.batches.push({
  ...sendingBatch,
  batch_id: 'batch-sending-2',
  item_count: 1,
});
multipleSending.items.push({
  item_key: 'sending-2',
  review_id: 'review-4',
  batch_id: 'batch-sending-2',
  status: 'LOCKED',
  lock_token: sendingBatch.lock_token,
});
multipleSending.queue.push({
  review_id: 'review-4',
  batch_id: 'batch-sending-2',
  batch_status: 'SENDING',
  send_status: 'UNSENT',
});
assert.throws(
  () => auditSenderRuntime(multipleSending, { now }),
  /more than one SENDING batch/,
);

process.stdout.write('sender runtime audit tests passed\n');
