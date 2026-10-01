import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const resources = JSON.parse(
  fs.readFileSync(path.join(here, 'live-resources.example.json'), 'utf8'),
);
const confirmationHtml = fs.readFileSync(
  path.join(here, 'unsubscribe-confirmation.html'),
  'utf8',
);
const successHtml = fs.readFileSync(
  path.join(here, 'unsubscribe-success.html'),
  'utf8',
);
const normalizeCode = fs.readFileSync(
  path.join(here, 'unsubscribe-normalize-code.js'),
  'utf8',
);
const resolveTargetCode = fs.readFileSync(
  path.join(here, 'unsubscribe-resolve-target-code.js'),
  'utf8',
);
const prepareControlCode = fs.readFileSync(
  path.join(here, 'unsubscribe-prepare-control-code.js'),
  'utf8',
);

const tables = {
  queue: {
    id: resources.tables.outreach_review_queue_v3,
    name: 'outreach_review_queue_v3',
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

const q = (value) => JSON.stringify(value);
const locator = (kind) =>
  `{ __rl: true, mode: 'list', value: ${q(tables[kind].id)}, cachedResultName: ${q(tables[kind].name)} }`;
const condition = (keyName, keyValue) =>
  `{ keyName: ${q(keyName)}, condition: 'eq', keyValue: ${keyValue} }`;
const filters = (pairs) =>
  `matchType: 'allConditions', filters: { conditions: [${pairs
    .map(([key, value]) => condition(key, value))
    .join(', ')}] }`;
const mapper = (values) =>
  `{ mappingMode: 'defineBelow', value: ${values}, matchingColumns: [] }`;

const confirmationCode = `const input = $input.first().json ?? {};
const rawToken = String(input.query?.token ?? '').trim();
const token = /^[A-Za-z0-9_-]{43}$/.test(rawToken) ? rawToken : '';
return [{ json: { html: ${q(confirmationHtml)}.replaceAll('__TOKEN__', token) } }];`;

const responseHeaders = `{
  responseCode: 200,
  responseHeaders: {
    entries: [
      { name: 'Content-Type', value: 'text/html; charset=utf-8' },
      { name: 'Cache-Control', value: 'no-store, max-age=0' },
      { name: 'Referrer-Policy', value: 'no-referrer' },
      { name: 'X-Content-Type-Options', value: 'nosniff' },
      { name: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }
    ]
  },
  enableStreaming: false
}`;

const source = `import {
  workflow,
  node,
  trigger,
  ifElse,
  expr
} from '@n8n/workflow-sdk';

const getUnsubscribe = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'GET Unsubscribe Confirmation',
    parameters: {
      httpMethod: 'GET',
      path: 'nunoon-outreach-unsubscribe',
      authentication: 'none',
      responseMode: 'responseNode',
      options: { ignoreBots: false }
    },
    position: [0, -240]
  },
  output: [{
    query: { token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    body: {}
  }]
});

const buildConfirmation = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Build Unsubscribe Confirmation',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: ${q(confirmationCode)}
    },
    position: [240, -240]
  },
  output: [{ html: '<!doctype html><title>Unsubscribe</title>' }]
});

const respondConfirmation = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond Confirmation Page',
    parameters: {
      respondWith: 'text',
      responseBody: expr('{{ $json.html }}'),
      options: ${responseHeaders}
    },
    position: [480, -240]
  },
  output: [{ responseCode: 200 }]
});

const headUnsubscribe = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'HEAD Unsubscribe',
    parameters: {
      httpMethod: 'HEAD',
      path: 'nunoon-outreach-unsubscribe',
      authentication: 'none',
      responseMode: 'responseNode',
      options: { ignoreBots: false }
    },
    position: [0, -80]
  },
  output: [{ query: {}, body: {} }]
});

const respondHead = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond HEAD',
    parameters: {
      respondWith: 'noData',
      options: {
        responseCode: 200,
        responseHeaders: {
          entries: [
            { name: 'Cache-Control', value: 'no-store, max-age=0' },
            { name: 'Referrer-Policy', value: 'no-referrer' },
            { name: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }
          ]
        },
        enableStreaming: false
      }
    },
    position: [240, -80]
  },
  output: [{ responseCode: 200 }]
});

const postUnsubscribe = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'POST One-Click Unsubscribe',
    parameters: {
      httpMethod: 'POST',
      path: 'nunoon-outreach-unsubscribe',
      authentication: 'none',
      responseMode: 'responseNode',
      options: { binaryData: false, ignoreBots: false }
    },
    position: [0, 160]
  },
  output: [{
    query: { token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    body: {
      token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'List-Unsubscribe': 'One-Click'
    }
  }]
});

const normalizeRequest = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize One-Click Request',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: ${q(normalizeCode)}
    },
    position: [240, 160]
  },
  output: [{
    valid_request: true,
    unsubscribe_token_hash: 'a'.repeat(64),
    received_at: '2026-07-19T00:00:00.000Z'
  }]
});

const findTarget = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Find Unsubscribe Target',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: ${locator('items')},
      ${filters([['unsubscribe_token_hash', "expr('{{ $json.unsubscribe_token_hash }}')"]])},
      returnAll: true
    },
    alwaysOutputData: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    position: [480, 160]
  },
  output: [{
    item_key: 'BATCH::001',
    review_id: 'review',
    intended_recipient: 'clinic@example.com',
    send_mode: 'LIVE',
    unsubscribe_token_hash: 'a'.repeat(64)
  }]
});

const resolveTarget = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Resolve Unsubscribe Target',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: ${q(resolveTargetCode)}
    },
    position: [720, 160]
  },
  output: [{
    apply_control: true,
    control_email: 'clinic@example.com',
    suppression_key: 'email:clinic@example.com',
    source_review_id: 'review',
    source_item_key: 'BATCH::001',
    source_event_id: 'one-click:digest'
  }]
});

const validTarget = ifElse({
  version: 2.3,
  config: {
    name: 'Valid LIVE Unsubscribe Target?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 2
        },
        conditions: [{
          leftValue: expr('{{ Boolean($json.apply_control) }}'),
          rightValue: true,
          operator: {
            type: 'boolean',
            operation: 'true',
            singleValue: true
          }
        }]
      },
      options: {}
    },
    position: [960, 160]
  }
});

const readExistingControl = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read Existing Suppression',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: ${locator('suppressions')},
      ${filters([['suppression_key', "expr('{{ $json.suppression_key }}')"]])},
      returnAll: true
    },
    alwaysOutputData: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    position: [1200, 40]
  },
  output: [{
    suppression_key: 'email:clinic@example.com',
    active: true,
    permanent: true
  }]
});

const prepareControl = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Durable Suppression',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: ${q(prepareControlCode)}
    },
    position: [1440, 40]
  },
  output: [{
    suppression_key: 'email:clinic@example.com',
    control_email: 'clinic@example.com',
    control_type: 'SUPPRESS',
    reason_code: 'OPT_OUT',
    active: true,
    permanent: true
  }]
});

const upsertSuppression = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Upsert Global Suppression',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: ${locator('suppressions')},
      ${filters([['suppression_key', "expr('{{ $json.suppression_key }}')"]])},
      columns: ${mapper(`{
        suppression_key: expr('{{ $json.suppression_key }}'),
        scope: 'EMAIL',
        normalized_email: expr('{{ $json.control_email }}'),
        normalized_domain: expr('{{ $json.normalized_domain }}'),
        control_type: 'SUPPRESS',
        reason_code: expr('{{ $json.reason_code }}'),
        reason_detail: expr('{{ $json.reason_detail }}'),
        active: true,
        permanent: true,
        source_event_id: expr('{{ $json.source_event_id }}'),
        source_review_id: expr('{{ $json.source_review_id }}'),
        created_by: expr('{{ $json.created_by }}'),
        created_at: expr('{{ $json.created_at }}'),
        updated_by: 'n8n:unsubscribe-v3',
        updated_at: expr('{{ $json.updated_at }}'),
        released_by: '',
        released_at: null,
        release_reason: '',
        audit_json: expr('{{ $json.audit_json }}')
      }`)},
      options: {}
    },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    position: [1680, 40]
  },
  output: [{
    suppression_key: 'email:clinic@example.com',
    active: true,
    permanent: true
  }]
});

const mirrorControl = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Mirror Suppression to Queue',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: ${locator('queue')},
      ${filters([['review_id', "expr(\"{{ 'CONTROL::' + $('Prepare Durable Suppression').item.json.control_email }}\")"]])},
      columns: ${mapper(`{
        review_id: expr("{{ 'CONTROL::' + $('Prepare Durable Suppression').item.json.control_email }}"),
        contact_key: expr("{{ 'CONTROL::' + $('Prepare Durable Suppression').item.json.control_email }}"),
        campaign_version: 'GLOBAL-CONTROL',
        company_name: 'Global contact control',
        email: expr("{{ $('Prepare Durable Suppression').item.json.control_email }}"),
        intended_recipient: expr("{{ $('Prepare Durable Suppression').item.json.control_email }}"),
        research_status: 'SKIPPED',
        draft_subject: '',
        draft_body: '',
        draft_revision: 0,
        draft_hash: '',
        draft_hash_schema: '',
        approval_status: 'BLOCKED',
        batch_status: 'CANCELLED',
        send_status: 'SUPPRESSED',
        attempt_count: 0,
        suppressed_reason: 'OPT_OUT',
        decision_reason: 'OPT_OUT',
        updated_by: 'n8n:unsubscribe-v3',
        audit_json: expr("{{ JSON.stringify([{ action: 'ONE_CLICK_SUPPRESSION_MIRRORED', source_event_id: $('Prepare Durable Suppression').item.json.source_event_id, at: $now.toISO() }]) }}"),
        created_at: expr('{{ $now.toISO() }}'),
        updated_at: expr('{{ $now.toISO() }}')
      }`)},
      options: {}
    },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    position: [1920, 40]
  },
  output: [{
    review_id: 'CONTROL::clinic@example.com',
    send_status: 'SUPPRESSED'
  }]
});

const blockPending = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Block Other Unsent Rows',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: ${locator('queue')},
      ${filters([
        ['email', "expr(\"{{ $('Prepare Durable Suppression').item.json.control_email }}\")"],
        ['send_status', "'UNSENT'"],
        ['batch_status', "'UNBATCHED'"]
      ])},
      columns: ${mapper(`{
        approval_status: 'BLOCKED',
        send_status: 'SUPPRESSED',
        batch_status: 'CANCELLED',
        suppressed_reason: 'OPT_OUT',
        decision_reason: 'OPT_OUT',
        updated_by: 'n8n:unsubscribe-v3',
        updated_at: expr('{{ $now.toISO() }}')
      }`)},
      options: {}
    },
    alwaysOutputData: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    position: [2160, 40]
  },
  output: [{ review_id: 'future-review', send_status: 'SUPPRESSED' }]
});

const updateEngagement = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Mark Source Contact Opted Out',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: ${locator('queue')},
      ${filters([
        ['review_id', "expr(\"{{ $('Prepare Durable Suppression').item.json.source_review_id }}\")"],
        ['intended_recipient', "expr(\"{{ $('Prepare Durable Suppression').item.json.control_email }}\")"]
      ])},
      columns: ${mapper(`{
        engagement_status: 'OPTED_OUT',
        last_inbound_type: 'ONE_CLICK_UNSUBSCRIBE',
        last_inbound_event_id: expr("{{ $('Prepare Durable Suppression').item.json.source_event_id }}"),
        last_inbound_at: expr('{{ $now.toISO() }}'),
        opted_out_at: expr('{{ $now.toISO() }}'),
        engagement_updated_at: expr('{{ $now.toISO() }}'),
        engagement_updated_by: 'n8n:unsubscribe-v3',
        updated_at: expr('{{ $now.toISO() }}')
      }`)},
      options: {}
    },
    alwaysOutputData: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    position: [2400, 40]
  },
  output: [{ review_id: 'review', engagement_status: 'OPTED_OUT' }]
});

const respondApplied = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond Unsubscribed',
    parameters: {
      respondWith: 'text',
      responseBody: ${q(successHtml)},
      options: ${responseHeaders}
    },
    position: [2640, 40]
  },
  output: [{ responseCode: 200 }]
});

const respondNoOp = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Respond Generic No-Op',
    parameters: {
      respondWith: 'text',
      responseBody: ${q(successHtml)},
      options: ${responseHeaders}
    },
    position: [1200, 280]
  },
  output: [{ responseCode: 200 }]
});

const durableSuppressionFlow = readExistingControl
  .to(prepareControl)
  .to(upsertSuppression)
  .to(mirrorControl)
  .to(blockPending)
  .to(updateEngagement)
  .to(respondApplied);
const routeTarget = validTarget
  .onTrue(durableSuppressionFlow)
  .onFalse(respondNoOp);

export default workflow('nunoon-unsubscribe-v3', 'Nunoon - Public Unsubscribe v3')
  .add(getUnsubscribe)
  .to(buildConfirmation)
  .to(respondConfirmation)
  .add(headUnsubscribe)
  .to(respondHead)
  .add(postUnsubscribe)
  .to(normalizeRequest)
  .to(findTarget)
  .to(resolveTarget)
  .to(routeTarget);
`;

const output = path.join(here, 'unsubscribe-v3.workflow.js');
fs.writeFileSync(output, source);
console.log(output);
