import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (name) =>
  new Function(
    '$',
    '$input',
    fs.readFileSync(path.join(here, name), 'utf8'),
  );

const resolveControl = load('inbound-resolve-control-code.js');
const confirmMutation = load('inbound-confirm-mutation-code.js');

const mockNode = (value) => ({
  first: () => ({ json: value }),
  all: () =>
    (Array.isArray(value) ? value : [value]).map((json) => ({ json })),
});

function runResolve(plan, existingRows) {
  return resolveControl(
    (name) => {
      assert.equal(name, 'Correlate and Plan');
      return mockNode(plan);
    },
    {
      all: () => existingRows.map((json) => ({ json })),
    },
  )[0].json;
}

const preserved = runResolve(
  {
    control_email: 'clinic@example.com',
    control_type: 'HOLD',
    permanent: false,
    reason_code: 'HUMAN_REPLY_REVIEW',
    event_type: 'INTERESTED',
    match_method: 'PROVIDER_MESSAGE_ID',
    event_id: 'event-new',
  },
  [
    {
      suppression_key: 'email:clinic@example.com',
      active: true,
      control_type: 'SUPPRESS',
      permanent: true,
      reason_code: 'OPT_OUT',
      created_by: 'n8n:inbound-v3',
      created_at: '2026-07-18T00:00:00.000Z',
      audit_json: '[{"action":"CONTROL_UPSERTED","event_id":"event-old"}]',
    },
  ],
);
assert.equal(preserved.effective_control_type, 'SUPPRESS');
assert.equal(preserved.effective_permanent, true);
assert.equal(preserved.effective_reason_code, 'OPT_OUT');
assert.equal(preserved.control_created_at, '2026-07-18T00:00:00.000Z');
assert.equal(
  JSON.parse(preserved.control_audit_json).at(-1).action,
  'CONTROL_PRESERVED',
);

const upgraded = runResolve(
  {
    control_email: 'clinic@example.com',
    control_type: 'SUPPRESS',
    permanent: true,
    reason_code: 'HARD_BOUNCE',
    event_type: 'HARD_BOUNCE',
    match_method: 'PROVIDER_MESSAGE_ID',
    event_id: 'event-bounce',
  },
  [
    {
      suppression_key: 'email:clinic@example.com',
      active: true,
      control_type: 'HOLD',
      permanent: false,
      reason_code: 'HUMAN_REPLY_REVIEW',
    },
  ],
);
assert.equal(upgraded.effective_control_type, 'SUPPRESS');
assert.equal(upgraded.effective_permanent, true);
assert.equal(upgraded.effective_reason_code, 'HARD_BOUNCE');
assert.equal(
  JSON.parse(upgraded.control_audit_json).at(-1).action,
  'CONTROL_UPSERTED',
);

assert.throws(
  () =>
    runResolve(
      {
        control_email: '',
        control_type: 'SUPPRESS',
        permanent: true,
      },
      [],
    ),
  /CONTROL_EMAIL_NOT_VERIFIED/,
);

function runConfirm({ plan, projectionRows, controlRows, mirrorRows, resolved }) {
  const nodes = {
    'Correlate and Plan': plan,
    'Upsert Contact Control': controlRows,
    'Mirror Control to Queue': mirrorRows,
    'Resolve Control Precedence': resolved,
  };
  return confirmMutation(
    (name) => mockNode(nodes[name]),
    {
      all: () => projectionRows.map((json) => ({ json })),
    },
  )[0].json;
}

const confirmed = runConfirm({
  plan: {
    mutation_route: 0,
    event_id: 'event-1',
    review_id: 'review-1',
    control_email: 'clinic@example.com',
  },
  projectionRows: [
    { review_id: 'review-1', last_inbound_event_id: 'event-1' },
  ],
  controlRows: [
    { suppression_key: 'email:clinic@example.com', active: true },
  ],
  mirrorRows: [
    {
      review_id: 'CONTROL::clinic@example.com',
      send_status: 'SUPPRESSED',
    },
  ],
  resolved: { suppression_key: 'email:clinic@example.com' },
});
assert.equal(confirmed.action_applied, true);
assert.equal(confirmed.processing_status, 'APPLIED');

const notConfirmed = runConfirm({
  plan: {
    mutation_route: 1,
    event_id: 'event-2',
    review_id: 'review-2',
  },
  projectionRows: [{}],
  controlRows: [],
  mirrorRows: [],
  resolved: {},
});
assert.equal(notConfirmed.action_applied, false);
assert.equal(notConfirmed.processing_status, 'NEEDS_REVIEW');
assert.equal(
  notConfirmed.last_error_code,
  'ENGAGEMENT_PROJECTION_NOT_CONFIRMED',
);

console.log('inbound control guard tests passed');
