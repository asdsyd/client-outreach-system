import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(
  path.join(here, '../../repairs/2026-07-14/preflight-send-config.js'),
  'utf8',
);
const run = new Function('$input', code);

function config(overrides = {}) {
  return {
    campaign_version: '2026-06-v1',
    email_provider: 'smtp',
    sender_name: 'Demo Sender | IAWebDevelopment × Nunoon',
    sender_email: 'outreach@example.com',
    reply_to: 'outreach@example.com',
    test_recipient: 'internal-test@example.com',
    slack_channel: 'EXAMPLE_SLACK_CHANNEL',
    send_mode: 'LIVE',
    batch_limit: 1,
    inter_send_seconds: 90,
    sender_domain_authenticated: 'TRUE',
    pilot_complete: 'FALSE',
    ...overrides,
  };
}

function execute(input) {
  return run({ first: () => ({ json: input }) })[0].json;
}

test('uses the fixed five-email LIVE pilot batch', () => {
  const result = execute(config());
  assert.equal(result.batch_limit, 5);
  assert.equal(result.pilot_complete, false);
});

test('keeps TEST mode at one recipient', () => {
  const result = execute(config({ send_mode: 'TEST' }));
  assert.equal(result.batch_limit, 1);
});

test('keeps the configured limit after the pilot is complete', () => {
  const result = execute(config({ batch_limit: 12, pilot_complete: 'TRUE' }));
  assert.equal(result.batch_limit, 12);
});

test('rejects a configured LIVE pilot limit above five', () => {
  assert.throws(
    () => execute(config({ batch_limit: 6 })),
    /LIVE_PILOT_BATCH_CAP_EXCEEDED/,
  );
});
