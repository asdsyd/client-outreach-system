import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';

const normalizeCode = fs.readFileSync(
  new URL('./unsubscribe-normalize-code.js', import.meta.url),
  'utf8',
);
const resolveCode = fs.readFileSync(
  new URL('./unsubscribe-resolve-target-code.js', import.meta.url),
  'utf8',
);
const prepareCode = fs.readFileSync(
  new URL('./unsubscribe-prepare-control-code.js', import.meta.url),
  'utf8',
);
const confirmationHtml = fs.readFileSync(
  new URL('./unsubscribe-confirmation.html', import.meta.url),
  'utf8',
);
const successHtml = fs.readFileSync(
  new URL('./unsubscribe-success.html', import.meta.url),
  'utf8',
);

const item = (json) => ({ json });
const token = randomBytes(32).toString('base64url');
const expectedDigest = createHash('sha256').update(token).digest('hex');

async function normalize(input) {
  const execute = new Function(
    '$input',
    `return (async () => {${normalizeCode}})();`,
  );
  return execute({ first: () => item(input) });
}

const valid = await normalize({
  query: { token },
  body: { token, 'List-Unsubscribe': 'One-Click' },
});
assert.equal(valid[0].json.valid_request, true);
assert.equal(valid[0].json.unsubscribe_token_hash, expectedDigest);
assert.doesNotMatch(JSON.stringify(valid), new RegExp(token));

for (const invalidInput of [
  { query: { token }, body: {} },
  {
    query: { token },
    body: {
      token: randomBytes(32).toString('base64url'),
      'List-Unsubscribe': 'One-Click',
    },
  },
  {
    query: { token: `${token}x` },
    body: { 'List-Unsubscribe': 'One-Click' },
  },
  {
    query: { token },
    body: { 'List-Unsubscribe': ['One-Click', 'One-Click'] },
  },
]) {
  const result = await normalize(invalidInput);
  assert.equal(result[0].json.valid_request, false);
  assert.equal(result[0].json.unsubscribe_token_hash, '0'.repeat(64));
}

async function resolve({ request, rows }) {
  const execute = new Function(
    '$',
    '$input',
    `return (async () => {${resolveCode}})();`,
  );
  const sources = {
    'Normalize One-Click Request': [item(request)],
  };
  const select = (name) => ({
    first: () => sources[name]?.[0] ?? item({}),
  });
  return execute(select, { all: () => rows.map(item) });
}

const liveTarget = {
  item_key: 'BATCH::001',
  review_id: 'review-1',
  intended_recipient: 'clinic@example.com',
  send_mode: 'LIVE',
  unsubscribe_token_hash: expectedDigest,
};
const resolvedLive = await resolve({
  request: valid[0].json,
  rows: [liveTarget],
});
assert.equal(resolvedLive[0].json.apply_control, true);
assert.equal(
  resolvedLive[0].json.suppression_key,
  'email:clinic@example.com',
);

const resolvedTest = await resolve({
  request: valid[0].json,
  rows: [{ ...liveTarget, send_mode: 'TEST' }],
});
assert.equal(resolvedTest[0].json.apply_control, false);

const resolvedUnknown = await resolve({
  request: valid[0].json,
  rows: [],
});
assert.equal(resolvedUnknown[0].json.apply_control, false);

await assert.rejects(
  resolve({
    request: valid[0].json,
    rows: [liveTarget, { ...liveTarget, item_key: 'BATCH::002' }],
  }),
  /UNSUBSCRIBE_TARGET_CARDINALITY/,
);

async function prepare(existing = {}) {
  const execute = new Function(
    '$',
    '$input',
    `return (async () => {${prepareCode}})();`,
  );
  const target = resolvedLive[0];
  const select = () => ({ first: () => target });
  return execute(select, { all: () => [item(existing)] });
}

const prepared = await prepare();
assert.equal(prepared[0].json.control_type, 'SUPPRESS');
assert.equal(prepared[0].json.reason_code, 'OPT_OUT');
assert.equal(prepared[0].json.active, true);
assert.equal(prepared[0].json.permanent, true);

const preserved = await prepare({
  suppression_key: 'email:clinic@example.com',
  active: true,
  permanent: true,
  control_type: 'SUPPRESS',
  reason_code: 'HARD_BOUNCE',
  reason_detail: 'Existing permanent control',
  created_by: 'n8n:inbound-v3',
  created_at: '2026-07-01T00:00:00.000Z',
  audit_json: '[]',
});
assert.equal(preserved[0].json.reason_code, 'HARD_BOUNCE');
assert.equal(preserved[0].json.created_by, 'n8n:inbound-v3');
assert.equal(
  JSON.parse(preserved[0].json.audit_json).at(-1).action,
  'ONE_CLICK_UNSUBSCRIBE',
);

assert.match(confirmationHtml, /method="post"/);
assert.match(confirmationHtml, /List-Unsubscribe/);
assert.match(confirmationHtml, /__TOKEN__/);
assert.doesNotMatch(confirmationHtml, /<script\b/i);
assert.match(successHtml, /You’re unsubscribed/);

process.stdout.write('unsubscribe runtime tests passed\n');
