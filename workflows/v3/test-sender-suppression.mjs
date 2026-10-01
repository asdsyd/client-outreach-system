import assert from 'node:assert/strict';
import fs from 'node:fs';

const payloadPath = process.argv[2];
if (!payloadPath) {
  throw new Error('Usage: node test-sender-suppression.mjs <workflow-payload.json>');
}

const workflow = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
const byName = new Map(workflow.nodes.map((candidate) => [candidate.name, candidate]));
const node = (name) => {
  const found = byName.get(name);
  assert.ok(found, `missing node ${name}`);
  return found;
};

assert.equal(workflow.nodes.length, 52);
assert.equal(workflow.active, false);

for (const name of ['Re-read Active Controls', 'Pre-SMTP Active Controls']) {
  const read = node(name);
  assert.equal(read.type, 'n8n-nodes-base.dataTable');
  assert.equal(
    read.parameters.dataTableId.cachedResultName,
    'outreach_suppressions_v3',
  );
  assert.equal(read.parameters.filters.conditions[0].keyName, 'active');
  assert.equal(read.parameters.filters.conditions[0].condition, 'isTrue');
  assert.equal(read.alwaysOutputData, true);
}

const queueSentinel = node('Pre-SMTP Queue Sentinel');
assert.equal(
  queueSentinel.parameters.dataTableId.cachedResultName,
  'outreach_review_queue_v3',
);
assert.deepEqual(
  queueSentinel.parameters.filters.conditions.map((condition) => [
    condition.keyName,
    condition.condition,
  ]),
  [
    ['send_status', 'eq'],
    ['email', 'eq'],
  ],
);
assert.equal(queueSentinel.executeOnce, true);
assert.equal(queueSentinel.alwaysOutputData, true);

function targets(source, output = 0) {
  return (workflow.connections[source]?.main?.[output] ?? []).map(
    (target) => `${target.node}:${target.index}`,
  );
}

assert.deepEqual(targets('Collapse Review Re-read'), [
  'Re-read Active Controls:0',
]);
assert.deepEqual(targets('Re-read Active Controls'), [
  'Collapse Active Controls:0',
]);
assert.deepEqual(targets('Collapse Active Controls'), [
  'Re-read Suppression:0',
]);
assert.deepEqual(targets('Assert Review Row SENDING'), [
  'Pre-SMTP Active Controls:0',
]);
assert.deepEqual(targets('Pre-SMTP Active Controls'), [
  'Pre-SMTP Queue Sentinel:0',
]);
assert.deepEqual(targets('Pre-SMTP Queue Sentinel'), [
  'Final Pre-SMTP Control Gate:0',
]);
assert.deepEqual(targets('Final Pre-SMTP Control Gate'), ['SMTP Send:0']);

for (const name of [
  'Re-read SENT Batch Items',
  'Re-read SENT Review Rows',
]) {
  assert.equal(
    node(name).executeOnce,
    true,
    `${name} must execute once after the item loop`,
  );
}

const smtp = node('SMTP Send');
assert.match(smtp.parameters.toEmail, /\$json\.send_to/);
assert.doesNotMatch(smtp.parameters.toEmail, /Loop Locked Items/);
assert.equal(smtp.parameters.emailFormat, 'both');
assert.equal(smtp.parameters.text, '={{ $json.email_text }}');
assert.equal(smtp.parameters.html, '={{ $json.email_html }}');
assert.doesNotMatch(smtp.parameters.text, /draft_body|unsubscribe_url/);
assert.doesNotMatch(smtp.parameters.html, /draft_body|unsubscribe_url/);
assert.equal(
  node('Persist Item SENT').parameters.columns.value.unsubscribe_token,
  '',
);
assert.match(
  node('Normalize SMTP Result').parameters.jsCode,
  /Final Pre-SMTP Control Gate/,
);
assert.match(
  node('Fail-Closed Send Gate').parameters.jsCode,
  /Re-read Active Controls/,
);
assert.match(
  node('Fail-Closed Send Gate').parameters.jsCode,
  /Re-read Suppression/,
);
assert.match(
  node('Fail-Closed Send Gate').parameters.jsCode,
  /outreach-batch-item-manifest\.v3/,
);
assert.match(
  node('Fail-Closed Send Gate').parameters.jsCode,
  /outreach-batch-manifest\.v3/,
);
assert.match(
  node('Fail-Closed Send Gate').parameters.jsCode,
  /unsubscribe_token_hash/,
);
assert.match(
  node('Fail-Closed Send Gate').parameters.jsCode,
  /unsubscribe_url/,
);
assert.match(
  node('Fail-Closed Send Gate').parameters.jsCode,
  /iawebdev-nunoon-outreach\.v2/,
);
assert.match(
  node('Fail-Closed Send Gate').parameters.jsCode,
  /activeHtmlUnsubscribeUrls\.includes\(unsubscribeUrl\)/,
);
assert.doesNotMatch(
  node('Fail-Closed Send Gate').parameters.jsCode,
  /\\1/,
);
assert.match(
  node('Fail-Closed Send Gate').parameters.jsCode,
  /email_html_snapshot/,
);
assert.match(
  node('Fail-Closed Send Gate').parameters.jsCode,
  /email_text_snapshot/,
);
assert.match(
  node('Fail-Closed Send Gate').parameters.jsCode,
  /containsDangerousEmailHtml/,
);

for (const [source, typedConnections] of Object.entries(workflow.connections)) {
  assert.ok(byName.has(source), `connection source is missing: ${source}`);
  for (const lists of Object.values(typedConnections)) {
    for (const targetsForOutput of lists) {
      for (const target of targetsForOutput) {
        assert.ok(
          byName.has(target.node),
          `connection target is missing: ${target.node}`,
        );
      }
    }
  }
}

const gateCode = node('Final Pre-SMTP Control Gate').parameters.jsCode;
const executeGate = new Function(
  '$',
  `return (async () => {${gateCode}})();`,
);

function item(json) {
  return { json };
}

async function runGate({ controls = [], sentinels = [] } = {}) {
  const current = {
    intended_recipient: 'clinic@example.com',
    send_to: 'clinic@example.com',
    item_key: 'item-1',
  };
  const sources = {
    'Loop Locked Items': [item(current)],
    'Pre-SMTP Active Controls': controls.map(item),
    'Pre-SMTP Queue Sentinel': sentinels.map(item),
  };
  const select = (name) => ({
    all: () => sources[name] ?? [],
    item: (sources[name] ?? [item({})])[0],
  });
  return executeGate(select);
}

const clean = await runGate();
assert.equal(clean.length, 1);
assert.equal(clean[0].json.intended_recipient, 'clinic@example.com');
assert.match(clean[0].json.pre_smtp_control_checked_at, /^\d{4}-\d{2}-\d{2}T/);

await assert.rejects(
  runGate({
    controls: [
      {
        suppression_key: 'email:clinic@example.com',
        scope: 'EMAIL',
        normalized_email: 'clinic@example.com',
        control_type: 'SUPPRESS',
        active: true,
      },
    ],
  }),
  /PRE_SMTP_CONTROL_REJECTED: active SUPPRESS email control/,
);

await assert.rejects(
  runGate({
    controls: [
      {
        suppression_key: 'domain:example.com',
        scope: 'DOMAIN',
        normalized_domain: 'example.com',
        control_type: 'HOLD',
        active: true,
      },
    ],
  }),
  /PRE_SMTP_CONTROL_REJECTED: active HOLD domain control/,
);

const inactive = await runGate({
  controls: [
    {
      suppression_key: 'email:clinic@example.com',
      scope: 'EMAIL',
      normalized_email: 'clinic@example.com',
      control_type: 'SUPPRESS',
      active: false,
    },
  ],
});
assert.equal(inactive.length, 1);

await assert.rejects(
  runGate({
    sentinels: [
      {
        review_id: 'CONTROL::clinic@example.com',
        email: 'clinic@example.com',
        send_status: 'SUPPRESSED',
      },
    ],
  }),
  /PRE_SMTP_CONTROL_REJECTED: queue suppression sentinel/,
);

process.stdout.write('sender suppression tests passed\n');
