import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflowId = 'EXAMPLE_SENDERV3';
const local = JSON.parse(
  execFileSync(process.execPath, [path.join(here, 'build-sender-v3.mjs')], {
    encoding: 'utf8',
  }),
);

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function byName(workflow) {
  return new Map(workflow.nodes.map((node) => [node.name, node]));
}

function requireNode(workflow, name) {
  const node = byName(workflow).get(name);
  assert.ok(node, `missing node ${name}`);
  return node;
}

function compileCodeNodes(workflow, label) {
  for (const node of workflow.nodes) {
    if (node.type !== 'n8n-nodes-base.code') continue;
    const code = String(node.parameters?.jsCode ?? '');
    assert.ok(code, `${label}: ${node.name} has empty JavaScript`);
    assert.doesNotThrow(
      () =>
        new Function(
          '$',
          '$input',
          '$execution',
          '$now',
          `return (async () => {${code}})();`,
        ),
      `${label}: ${node.name} does not compile`,
    );
  }
}

function validateGraph(workflow, label) {
  assert.equal(workflow.nodes.length, 52, `${label}: unexpected node count`);
  const names = workflow.nodes.map((node) => node.name);
  assert.equal(new Set(names).size, names.length, `${label}: duplicate node name`);
  const known = new Set(names);
  for (const [source, typedConnections] of Object.entries(workflow.connections)) {
    assert.ok(known.has(source), `${label}: missing connection source ${source}`);
    for (const outputLists of Object.values(typedConnections)) {
      for (const targets of outputLists) {
        for (const target of targets) {
          assert.ok(
            known.has(target.node),
            `${label}: missing connection target ${target.node}`,
          );
        }
      }
    }
  }
}

function validateSafety(workflow, label) {
  validateGraph(workflow, label);
  compileCodeNodes(workflow, label);

  const schedule = requireNode(workflow, 'Schedule Trigger');
  assert.equal(
    schedule.parameters.rule.interval[0].minutesInterval,
    1,
    `${label}: sender schedule must poll every minute`,
  );

  const preflight = String(
    requireNode(workflow, 'Preflight Send Config').parameters.jsCode,
  );
  assert.match(preflight, /interSendSeconds < 90/);
  assert.match(preflight, /LIVE_PILOT_BATCH_CAP_EXCEEDED/);
  assert.match(preflight, /senderDomainAuthenticated/);

  const sendGate = String(
    requireNode(workflow, 'Fail-Closed Send Gate').parameters.jsCode,
  );
  assert.match(
    sendGate,
    /activeHtmlUnsubscribeUrls\.includes\(unsubscribeUrl\)/,
  );
  assert.match(sendGate, /batch_limit exceeds current cap/);
  assert.doesNotMatch(sendGate, /\\1/);

  for (const name of [
    'Re-read SENT Batch Items',
    'Re-read SENT Review Rows',
  ]) {
    assert.equal(
      requireNode(workflow, name).executeOnce,
      true,
      `${label}: ${name} must execute once`,
    );
  }

  const itemFinalizer = String(
    requireNode(workflow, 'Assert All Items SENT').parameters.jsCode,
  );
  assert.match(itemFinalizer, /byItemKey/);
  assert.match(itemFinalizer, /BATCH_ITEM_COMPLETION_CONFLICT/);
  assert.match(itemFinalizer, /new Set\(providerIds\)\.size/);

  const queueFinalizer = String(
    requireNode(workflow, 'Assert All Review Rows SENT').parameters.jsCode,
  );
  assert.match(queueFinalizer, /byReviewId/);
  assert.match(queueFinalizer, /QUEUE_COMPLETION_CONFLICT/);
  assert.match(queueFinalizer, /sortedItemProviderIds/);

  const smtp = requireNode(workflow, 'SMTP Send');
  assert.equal(smtp.parameters.emailFormat, 'both');
  assert.equal(smtp.parameters.text, '={{ $json.email_text }}');
  assert.equal(smtp.parameters.html, '={{ $json.email_html }}');
  assert.equal(smtp.parameters.toEmail, '={{ $json.send_to }}');

  const wait = requireNode(workflow, 'Wait Between Sends');
  assert.equal(
    wait.parameters.amount,
    "={{ $('Loop Locked Items').item.json.inter_send_seconds }}",
  );

  assert.deepEqual(
    workflow.connections['Loop Locked Items'].main,
    [
      [{ node: 'Re-read SENT Batch Items', type: 'main', index: 0 }],
      [{ node: 'Mark Item SENDING', type: 'main', index: 0 }],
    ],
    `${label}: loop outputs changed`,
  );
}

function criticalNode(node) {
  return {
    name: node.name,
    type: node.type,
    typeVersion: node.typeVersion,
    parameters: node.parameters,
    executeOnce: node.executeOnce ?? false,
    alwaysOutputData: node.alwaysOutputData ?? false,
    onError: node.onError ?? 'stopWorkflow',
    retryOnFail: node.retryOnFail ?? false,
    maxTries: node.maxTries ?? null,
    waitBetweenTries: node.waitBetweenTries ?? null,
  };
}

function assertCriticalParity(localWorkflow, liveWorkflow) {
  const criticalNames = [
    'Schedule Trigger',
    'Preflight Send Config',
    'Fail-Closed Send Gate',
    'Re-read SENT Batch Items',
    'Assert All Items SENT',
    'Re-read SENT Review Rows',
    'Assert All Review Rows SENT',
    'SMTP Send',
    'Wait Between Sends',
    'Mark Batch COMPLETE',
  ];
  for (const name of criticalNames) {
    assert.deepEqual(
      criticalNode(requireNode(liveWorkflow, name)),
      criticalNode(requireNode(localWorkflow, name)),
      `live drift in critical node ${name}`,
    );
  }
  assert.deepEqual(
    liveWorkflow.connections,
    localWorkflow.connections,
    'live workflow connections drifted from the release source',
  );
}

validateSafety(local, 'local');

if (process.argv.includes('--live')) {
  const baseUrl = String(process.env.N8N_BASE_URL ?? '').replace(/\/+$/, '');
  const apiKey = String(process.env.N8N_API_KEY ?? '');
  assert.ok(baseUrl && apiKey, 'N8N_BASE_URL and N8N_API_KEY are required');
  const response = await fetch(`${baseUrl}/workflows/${workflowId}`, {
    headers: {
      Accept: 'application/json',
      'X-N8N-API-KEY': apiKey,
    },
  });
  assert.equal(response.ok, true, `n8n workflow read failed: ${response.status}`);
  const live = await response.json();
  validateSafety(live, 'live');
  assert.equal(live.active, true, 'live sender is not active');
  assert.equal(
    live.versionId,
    live.activeVersionId,
    'the active sender version is not the current draft version',
  );
  assertCriticalParity(local, live);
  process.stdout.write(
    `sender live release verification passed (${live.activeVersionId}, ${sha256(JSON.stringify(live.connections)).slice(0, 12)})\n`,
  );
} else {
  process.stdout.write(
    `sender local release verification passed (${sha256(JSON.stringify(local.connections)).slice(0, 12)})\n`,
  );
}
