import {
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
      jsCode: "const input = $input.first().json ?? {};\nconst rawToken = String(input.query?.token ?? '').trim();\nconst token = /^[A-Za-z0-9_-]{43}$/.test(rawToken) ? rawToken : '';\nreturn [{ json: { html: \"<!doctype html>\\n<html lang=\\\"en\\\">\\n  <head>\\n    <meta charset=\\\"utf-8\\\" />\\n    <meta name=\\\"viewport\\\" content=\\\"width=device-width, initial-scale=1\\\" />\\n    <meta name=\\\"robots\\\" content=\\\"noindex, nofollow, noarchive\\\" />\\n    <title>Unsubscribe from outreach</title>\\n    <style>\\n      :root {\\n        color-scheme: light;\\n        font-family:\\n          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,\\n          \\\"Segoe UI\\\", sans-serif;\\n        background: #f3f7f5;\\n        color: #17352b;\\n      }\\n      * {\\n        box-sizing: border-box;\\n      }\\n      body {\\n        min-height: 100vh;\\n        margin: 0;\\n        display: grid;\\n        place-items: center;\\n        padding: 24px;\\n      }\\n      main {\\n        width: min(100%, 520px);\\n        padding: 40px;\\n        border: 1px solid #d8e5df;\\n        border-radius: 24px;\\n        background: #fff;\\n        box-shadow: 0 18px 60px rgba(23, 53, 43, 0.1);\\n      }\\n      .eyebrow {\\n        margin: 0 0 12px;\\n        color: #28735a;\\n        font-size: 13px;\\n        font-weight: 700;\\n        letter-spacing: 0.12em;\\n        text-transform: uppercase;\\n      }\\n      h1 {\\n        margin: 0;\\n        font-size: clamp(28px, 7vw, 40px);\\n        line-height: 1.08;\\n        letter-spacing: -0.04em;\\n      }\\n      p {\\n        margin: 18px 0 0;\\n        color: #49665c;\\n        font-size: 17px;\\n        line-height: 1.6;\\n      }\\n      form {\\n        margin-top: 28px;\\n      }\\n      button {\\n        width: 100%;\\n        min-height: 52px;\\n        border: 0;\\n        border-radius: 14px;\\n        background: #176a4e;\\n        color: #fff;\\n        cursor: pointer;\\n        font: inherit;\\n        font-weight: 700;\\n      }\\n      button:hover {\\n        background: #12583f;\\n      }\\n      button:focus-visible {\\n        outline: 3px solid #7fc7ac;\\n        outline-offset: 3px;\\n      }\\n      .note {\\n        font-size: 14px;\\n      }\\n    </style>\\n  </head>\\n  <body>\\n    <main>\\n      <p class=\\\"eyebrow\\\">Nunoon outreach</p>\\n      <h1>Stop future outreach emails?</h1>\\n      <p>\\n        Confirm below and this address will be added to our permanent outreach\\n        suppression list.\\n      </p>\\n      <form\\n        method=\\\"post\\\"\\n        action=\\\"https://n8n.example.com/webhook/nunoon-outreach-unsubscribe?token=__TOKEN__\\\"\\n      >\\n        <input type=\\\"hidden\\\" name=\\\"token\\\" value=\\\"__TOKEN__\\\" />\\n        <input type=\\\"hidden\\\" name=\\\"List-Unsubscribe\\\" value=\\\"One-Click\\\" />\\n        <button type=\\\"submit\\\">Unsubscribe</button>\\n      </form>\\n      <p class=\\\"note\\\">No sign-in is required.</p>\\n    </main>\\n  </body>\\n</html>\\n\".replaceAll('__TOKEN__', token) } }];"
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
      options: {
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
}
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
      jsCode: "const input = $input.first().json ?? {};\nconst text = (value) => String(value ?? '').trim();\n\nfunction singleValue(value) {\n  if (Array.isArray(value)) {\n    return value.length === 1 ? text(value[0]) : '';\n  }\n  return text(value);\n}\n\nfunction sha256(value) {\n  const bytes = new TextEncoder().encode(value);\n  const bitLength = bytes.length * 8;\n  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;\n  const padded = new Uint8Array(paddedLength);\n  padded.set(bytes);\n  padded[bytes.length] = 0x80;\n  const view = new DataView(padded.buffer);\n  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);\n  view.setUint32(paddedLength - 4, bitLength >>> 0, false);\n\n  const constants = [\n    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,\n    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,\n    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,\n    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,\n    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,\n    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,\n    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,\n    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,\n    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,\n    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,\n    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,\n    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,\n    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,\n    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,\n    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,\n    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,\n  ];\n  const state = [\n    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,\n    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,\n  ];\n  const words = new Uint32Array(64);\n  const rotateRight = (number, bits) =>\n    (number >>> bits) | (number << (32 - bits));\n\n  for (let offset = 0; offset < paddedLength; offset += 64) {\n    for (let index = 0; index < 16; index += 1) {\n      words[index] = view.getUint32(offset + index * 4, false);\n    }\n    for (let index = 16; index < 64; index += 1) {\n      const s0 =\n        rotateRight(words[index - 15], 7) ^\n        rotateRight(words[index - 15], 18) ^\n        (words[index - 15] >>> 3);\n      const s1 =\n        rotateRight(words[index - 2], 17) ^\n        rotateRight(words[index - 2], 19) ^\n        (words[index - 2] >>> 10);\n      words[index] =\n        (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;\n    }\n\n    let [a, b, c, d, e, f, g, h] = state;\n    for (let index = 0; index < 64; index += 1) {\n      const sum1 =\n        rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);\n      const choice = (e & f) ^ (~e & g);\n      const temporary1 =\n        (h + sum1 + choice + constants[index] + words[index]) >>> 0;\n      const sum0 =\n        rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);\n      const majority = (a & b) ^ (a & c) ^ (b & c);\n      const temporary2 = (sum0 + majority) >>> 0;\n      h = g;\n      g = f;\n      f = e;\n      e = (d + temporary1) >>> 0;\n      d = c;\n      c = b;\n      b = a;\n      a = (temporary1 + temporary2) >>> 0;\n    }\n\n    state[0] = (state[0] + a) >>> 0;\n    state[1] = (state[1] + b) >>> 0;\n    state[2] = (state[2] + c) >>> 0;\n    state[3] = (state[3] + d) >>> 0;\n    state[4] = (state[4] + e) >>> 0;\n    state[5] = (state[5] + f) >>> 0;\n    state[6] = (state[6] + g) >>> 0;\n    state[7] = (state[7] + h) >>> 0;\n  }\n\n  return state\n    .map((word) => word.toString(16).padStart(8, '0'))\n    .join('');\n}\n\nconst queryToken = singleValue(input.query?.token);\nconst bodyToken = singleValue(input.body?.token);\nconst marker = singleValue(input.body?.['List-Unsubscribe']);\nconst tokensAgree = !queryToken || !bodyToken || queryToken === bodyToken;\nconst token = queryToken || bodyToken;\nconst validRequest =\n  tokensAgree &&\n  marker === 'One-Click' &&\n  /^[A-Za-z0-9_-]{43}$/.test(token);\n\nreturn [\n  {\n    json: {\n      valid_request: validRequest,\n      unsubscribe_token_hash: validRequest\n        ? sha256(token)\n        : '0'.repeat(64),\n      received_at: new Date().toISOString(),\n    },\n  },\n];\n"
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
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_3", cachedResultName: "outreach_batch_items_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "unsubscribe_token_hash", condition: 'eq', keyValue: expr('{{ $json.unsubscribe_token_hash }}') }] },
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
      jsCode: "const request = $('Normalize One-Click Request').first().json ?? {};\nconst rows = $input\n  .all()\n  .map((item) => item.json ?? {})\n  .filter((row) => row.unsubscribe_token_hash);\nconst text = (value) => String(value ?? '').trim();\nconst digest = text(request.unsubscribe_token_hash).toLowerCase();\nconst exact = rows.filter(\n  (row) => text(row.unsubscribe_token_hash).toLowerCase() === digest,\n);\n\nif (request.valid_request && exact.length > 1) {\n  throw new Error('UNSUBSCRIBE_TARGET_CARDINALITY');\n}\n\nconst target = exact[0] ?? {};\nconst recipient = text(target.intended_recipient).toLowerCase();\nconst applyControl =\n  request.valid_request === true &&\n  exact.length === 1 &&\n  text(target.send_mode).toUpperCase() === 'LIVE' &&\n  /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(recipient);\n\nreturn [\n  {\n    json: {\n      apply_control: applyControl,\n      control_email: applyControl ? recipient : '',\n      suppression_key: applyControl ? `email:${recipient}` : '',\n      source_review_id: applyControl ? text(target.review_id) : '',\n      source_item_key: applyControl ? text(target.item_key) : '',\n      source_event_id: applyControl ? `one-click:${digest}` : '',\n      received_at: text(request.received_at),\n    },\n  },\n];\n"
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
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_5", cachedResultName: "outreach_suppressions_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "suppression_key", condition: 'eq', keyValue: expr('{{ $json.suppression_key }}') }] },
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
      jsCode: "const target = $('Resolve Unsubscribe Target').first().json ?? {};\nconst rows = $input.all().map((item) => item.json ?? {});\nconst existing = rows.find((row) => row.suppression_key) ?? {};\nconst text = (value) => String(value ?? '').trim();\nconst asBoolean = (value) =>\n  value === true || ['true', '1', 'yes'].includes(text(value).toLowerCase());\n\nif (\n  target.apply_control !== true ||\n  !text(target.control_email) ||\n  !text(target.suppression_key)\n) {\n  throw new Error('UNSUBSCRIBE_CONTROL_TARGET_INVALID');\n}\n\nconst preserveExisting =\n  asBoolean(existing.active) &&\n  text(existing.control_type).toUpperCase() === 'SUPPRESS' &&\n  asBoolean(existing.permanent);\nconst now = new Date().toISOString();\nlet audit = [];\ntry {\n  const parsed = JSON.parse(text(existing.audit_json) || '[]');\n  if (Array.isArray(parsed)) audit = parsed;\n} catch {}\naudit = [\n  ...audit.slice(-49),\n  {\n    action: 'ONE_CLICK_UNSUBSCRIBE',\n    source_event_id: text(target.source_event_id),\n    source_item_key: text(target.source_item_key),\n    at: now,\n  },\n];\n\nreturn [\n  {\n    json: {\n      suppression_key: text(target.suppression_key),\n      control_email: text(target.control_email),\n      normalized_domain: text(target.control_email).split('@')[1] || '',\n      control_type: 'SUPPRESS',\n      reason_code: preserveExisting\n        ? text(existing.reason_code) || 'OPT_OUT'\n        : 'OPT_OUT',\n      reason_detail: preserveExisting\n        ? text(existing.reason_detail) || 'Permanent outreach suppression'\n        : 'One-click outreach unsubscribe',\n      active: true,\n      permanent: true,\n      source_event_id: text(target.source_event_id),\n      source_review_id: text(target.source_review_id),\n      created_by: text(existing.created_by) || 'n8n:unsubscribe-v3',\n      created_at: text(existing.created_at) || now,\n      updated_by: 'n8n:unsubscribe-v3',\n      updated_at: now,\n      audit_json: JSON.stringify(audit),\n    },\n  },\n];\n"
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
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_5", cachedResultName: "outreach_suppressions_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "suppression_key", condition: 'eq', keyValue: expr('{{ $json.suppression_key }}') }] },
      columns: { mappingMode: 'defineBelow', value: {
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
      }, matchingColumns: [] },
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
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_1", cachedResultName: "outreach_review_queue_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "review_id", condition: 'eq', keyValue: expr("{{ 'CONTROL::' + $('Prepare Durable Suppression').item.json.control_email }}") }] },
      columns: { mappingMode: 'defineBelow', value: {
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
      }, matchingColumns: [] },
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
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_1", cachedResultName: "outreach_review_queue_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "email", condition: 'eq', keyValue: expr("{{ $('Prepare Durable Suppression').item.json.control_email }}") }, { keyName: "send_status", condition: 'eq', keyValue: 'UNSENT' }, { keyName: "batch_status", condition: 'eq', keyValue: 'UNBATCHED' }] },
      columns: { mappingMode: 'defineBelow', value: {
        approval_status: 'BLOCKED',
        send_status: 'SUPPRESSED',
        batch_status: 'CANCELLED',
        suppressed_reason: 'OPT_OUT',
        decision_reason: 'OPT_OUT',
        updated_by: 'n8n:unsubscribe-v3',
        updated_at: expr('{{ $now.toISO() }}')
      }, matchingColumns: [] },
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
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_1", cachedResultName: "outreach_review_queue_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "review_id", condition: 'eq', keyValue: expr("{{ $('Prepare Durable Suppression').item.json.source_review_id }}") }, { keyName: "intended_recipient", condition: 'eq', keyValue: expr("{{ $('Prepare Durable Suppression').item.json.control_email }}") }] },
      columns: { mappingMode: 'defineBelow', value: {
        engagement_status: 'OPTED_OUT',
        last_inbound_type: 'ONE_CLICK_UNSUBSCRIBE',
        last_inbound_event_id: expr("{{ $('Prepare Durable Suppression').item.json.source_event_id }}"),
        last_inbound_at: expr('{{ $now.toISO() }}'),
        opted_out_at: expr('{{ $now.toISO() }}'),
        engagement_updated_at: expr('{{ $now.toISO() }}'),
        engagement_updated_by: 'n8n:unsubscribe-v3',
        updated_at: expr('{{ $now.toISO() }}')
      }, matchingColumns: [] },
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
      responseBody: "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n    <meta name=\"robots\" content=\"noindex, nofollow, noarchive\" />\n    <title>Unsubscribed</title>\n    <style>\n      :root {\n        color-scheme: light;\n        font-family:\n          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,\n          \"Segoe UI\", sans-serif;\n        background: #f3f7f5;\n        color: #17352b;\n      }\n      * {\n        box-sizing: border-box;\n      }\n      body {\n        min-height: 100vh;\n        margin: 0;\n        display: grid;\n        place-items: center;\n        padding: 24px;\n      }\n      main {\n        width: min(100%, 520px);\n        padding: 40px;\n        border: 1px solid #d8e5df;\n        border-radius: 24px;\n        background: #fff;\n        box-shadow: 0 18px 60px rgba(23, 53, 43, 0.1);\n      }\n      .check {\n        width: 52px;\n        height: 52px;\n        display: grid;\n        place-items: center;\n        border-radius: 50%;\n        background: #dff3e9;\n        color: #176a4e;\n        font-size: 28px;\n        font-weight: 800;\n      }\n      h1 {\n        margin: 24px 0 0;\n        font-size: clamp(28px, 7vw, 40px);\n        line-height: 1.08;\n        letter-spacing: -0.04em;\n      }\n      p {\n        margin: 18px 0 0;\n        color: #49665c;\n        font-size: 17px;\n        line-height: 1.6;\n      }\n    </style>\n  </head>\n  <body>\n    <main>\n      <div class=\"check\" aria-hidden=\"true\">✓</div>\n      <h1>You’re unsubscribed.</h1>\n      <p>\n        This address will not receive future Nunoon outreach emails. You can\n        close this page.\n      </p>\n    </main>\n  </body>\n</html>\n",
      options: {
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
}
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
      responseBody: "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n    <meta name=\"robots\" content=\"noindex, nofollow, noarchive\" />\n    <title>Unsubscribed</title>\n    <style>\n      :root {\n        color-scheme: light;\n        font-family:\n          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,\n          \"Segoe UI\", sans-serif;\n        background: #f3f7f5;\n        color: #17352b;\n      }\n      * {\n        box-sizing: border-box;\n      }\n      body {\n        min-height: 100vh;\n        margin: 0;\n        display: grid;\n        place-items: center;\n        padding: 24px;\n      }\n      main {\n        width: min(100%, 520px);\n        padding: 40px;\n        border: 1px solid #d8e5df;\n        border-radius: 24px;\n        background: #fff;\n        box-shadow: 0 18px 60px rgba(23, 53, 43, 0.1);\n      }\n      .check {\n        width: 52px;\n        height: 52px;\n        display: grid;\n        place-items: center;\n        border-radius: 50%;\n        background: #dff3e9;\n        color: #176a4e;\n        font-size: 28px;\n        font-weight: 800;\n      }\n      h1 {\n        margin: 24px 0 0;\n        font-size: clamp(28px, 7vw, 40px);\n        line-height: 1.08;\n        letter-spacing: -0.04em;\n      }\n      p {\n        margin: 18px 0 0;\n        color: #49665c;\n        font-size: 17px;\n        line-height: 1.6;\n      }\n    </style>\n  </head>\n  <body>\n    <main>\n      <div class=\"check\" aria-hidden=\"true\">✓</div>\n      <h1>You’re unsubscribed.</h1>\n      <p>\n        This address will not receive future Nunoon outreach emails. You can\n        close this page.\n      </p>\n    </main>\n  </body>\n</html>\n",
      options: {
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
}
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
