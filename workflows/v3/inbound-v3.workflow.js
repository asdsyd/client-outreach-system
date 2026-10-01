import {
  workflow,
  node,
  trigger,
  sticky,
  newCredential,
  ifElse,
  switchCase,
  expr
} from '@n8n/workflow-sdk';

const inbox = trigger({
  type: 'n8n-nodes-base.emailReadImap',
  version: 2.1,
  config: {
    name: 'Zoho Inbox',
    parameters: {
      mailbox: 'INBOX',
      postProcessAction: 'read',
      format: 'resolved',
      dataPropertyAttachmentsPrefixName: 'attachment_',
      options: {
        customEmailConfig: '["UNSEEN"]',
        forceReconnect: 60,
        trackLastMessageId: true
      }
    },
    credentials: { imap: newCredential('Zoho IMAP - outreach@example.com') },
    position: [0, 0]
  },
  output: [{
    from: 'Clinic <clinic@example.com>',
    to: 'outreach@example.com',
    subject: 'Re: assessment',
    textPlain: 'Yes, I am interested.',
    messageId: '<inbound@example.com>',
    headers: {
      'message-id': '<inbound@example.com>',
      'in-reply-to': '<outbound@iawebdev.com>'
    }
  }]
});

const normalize = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Normalize and Classify',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const input = $input.first().json ?? {};\nconst text = (value) => String(value ?? '');\n\nfunction utf8Bytes(value) {\n  const bytes = [];\n  for (const character of text(value)) {\n    const codePoint = character.codePointAt(0);\n    if (codePoint <= 0x7f) {\n      bytes.push(codePoint);\n    } else if (codePoint <= 0x7ff) {\n      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));\n    } else if (codePoint <= 0xffff) {\n      bytes.push(\n        0xe0 | (codePoint >>> 12),\n        0x80 | ((codePoint >>> 6) & 0x3f),\n        0x80 | (codePoint & 0x3f),\n      );\n    } else {\n      bytes.push(\n        0xf0 | (codePoint >>> 18),\n        0x80 | ((codePoint >>> 12) & 0x3f),\n        0x80 | ((codePoint >>> 6) & 0x3f),\n        0x80 | (codePoint & 0x3f),\n      );\n    }\n  }\n  return bytes;\n}\n\nfunction sha256(value) {\n  const bytes = utf8Bytes(value);\n  const bitLength = bytes.length * 8;\n  bytes.push(0x80);\n  while (bytes.length % 64 !== 56) bytes.push(0);\n  const high = Math.floor(bitLength / 0x100000000);\n  const low = bitLength >>> 0;\n  for (const shift of [24, 16, 8, 0]) bytes.push((high >>> shift) & 0xff);\n  for (const shift of [24, 16, 8, 0]) bytes.push((low >>> shift) & 0xff);\n\n  const constants = [\n    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,\n    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,\n    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,\n    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,\n    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,\n    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,\n    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,\n    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,\n    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,\n    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,\n    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,\n  ];\n  const state = [\n    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,\n    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,\n  ];\n  const rotateRight = (number, bits) =>\n    (number >>> bits) | (number << (32 - bits));\n\n  for (let offset = 0; offset < bytes.length; offset += 64) {\n    const words = new Array(64).fill(0);\n    for (let index = 0; index < 16; index += 1) {\n      const start = offset + index * 4;\n      words[index] =\n        ((bytes[start] << 24) |\n          (bytes[start + 1] << 16) |\n          (bytes[start + 2] << 8) |\n          bytes[start + 3]) >>>\n        0;\n    }\n    for (let index = 16; index < 64; index += 1) {\n      const s0 =\n        rotateRight(words[index - 15], 7) ^\n        rotateRight(words[index - 15], 18) ^\n        (words[index - 15] >>> 3);\n      const s1 =\n        rotateRight(words[index - 2], 17) ^\n        rotateRight(words[index - 2], 19) ^\n        (words[index - 2] >>> 10);\n      words[index] =\n        (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;\n    }\n\n    let [a, b, c, d, e, f, g, h] = state;\n    for (let index = 0; index < 64; index += 1) {\n      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);\n      const choice = (e & f) ^ (~e & g);\n      const temporary1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;\n      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);\n      const majority = (a & b) ^ (a & c) ^ (b & c);\n      const temporary2 = (sum0 + majority) >>> 0;\n      h = g;\n      g = f;\n      f = e;\n      e = (d + temporary1) >>> 0;\n      d = c;\n      c = b;\n      b = a;\n      a = (temporary1 + temporary2) >>> 0;\n    }\n    state[0] = (state[0] + a) >>> 0;\n    state[1] = (state[1] + b) >>> 0;\n    state[2] = (state[2] + c) >>> 0;\n    state[3] = (state[3] + d) >>> 0;\n    state[4] = (state[4] + e) >>> 0;\n    state[5] = (state[5] + f) >>> 0;\n    state[6] = (state[6] + g) >>> 0;\n    state[7] = (state[7] + h) >>> 0;\n  }\n\n  return state.map((word) => word.toString(16).padStart(8, '0')).join('');\n}\n\nfunction decodeBytes(bytes) {\n  let output = '';\n  for (let index = 0; index < bytes.length; ) {\n    const first = Number(bytes[index++]) & 0xff;\n    if (first < 0x80) {\n      output += String.fromCodePoint(first);\n      continue;\n    }\n    const length = first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4;\n    let codePoint = first & (0x7f >> length);\n    let valid = true;\n    for (let count = 1; count < length; count += 1) {\n      const next = Number(bytes[index++]) & 0xff;\n      if ((next & 0xc0) !== 0x80) {\n        valid = false;\n        break;\n      }\n      codePoint = (codePoint << 6) | (next & 0x3f);\n    }\n    output += String.fromCodePoint(valid ? codePoint : 0xfffd);\n  }\n  return output;\n}\n\nfunction payloadText(value, depth = 0) {\n  if (value === null || value === undefined || depth > 6) return '';\n  if (typeof value === 'string') return value;\n  if (typeof value === 'number' || typeof value === 'boolean') return text(value);\n  if (\n    typeof value === 'object' &&\n    value.type === 'Buffer' &&\n    Array.isArray(value.data)\n  ) {\n    return decodeBytes(value.data);\n  }\n  if (Array.isArray(value)) {\n    return value.map((entry) => payloadText(entry, depth + 1)).filter(Boolean).join('\\n');\n  }\n  if (typeof value === 'object') {\n    return Object.entries(value)\n      .map(([key, entry]) => {\n        const rendered = payloadText(entry, depth + 1);\n        return rendered ? `${key}: ${rendered}` : '';\n      })\n      .filter(Boolean)\n      .join('\\n');\n  }\n  return text(value);\n}\n\nfunction structuredValue(value, aliases, depth = 0) {\n  if (!value || typeof value !== 'object' || depth > 6) return '';\n  const normalizedAliases = new Set(\n    aliases.map((alias) => alias.toLowerCase().replace(/[^a-z0-9]/g, '')),\n  );\n  const entries = Array.isArray(value)\n    ? value.map((entry, index) => [text(index), entry])\n    : Object.entries(value);\n  for (const [key, entry] of entries) {\n    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');\n    if (\n      normalizedAliases.has(normalizedKey) &&\n      entry !== null &&\n      entry !== undefined &&\n      typeof entry !== 'object'\n    ) {\n      const candidate = text(entry).trim();\n      if (candidate) return candidate;\n    }\n  }\n  for (const [, entry] of entries) {\n    const nested = structuredValue(entry, aliases, depth + 1);\n    if (nested) return nested;\n  }\n  return '';\n}\n\nfunction normalizeEmail(value) {\n  function addressText(candidate, depth = 0) {\n    if (candidate === null || candidate === undefined || depth > 5) return '';\n    if (typeof candidate === 'string') return candidate;\n    if (Array.isArray(candidate)) {\n      return candidate\n        .map((entry) => addressText(entry, depth + 1))\n        .filter(Boolean)\n        .join(' ');\n    }\n    if (typeof candidate === 'object') {\n      for (const key of ['address', 'email']) {\n        const direct = candidate[key];\n        if (typeof direct === 'string' && direct.trim()) return direct;\n      }\n      for (const key of ['value', 'text', 'html']) {\n        const nested = addressText(candidate[key], depth + 1);\n        if (nested) return nested;\n      }\n      return '';\n    }\n    return text(candidate);\n  }\n\n  const raw = addressText(value).trim();\n  const bracketed = raw.match(/<([^<>\\s]+@[^<>\\s]+)>/);\n  const candidate =\n    bracketed?.[1] ?? raw.match(/[^\\s<>,;]+@[^\\s<>,;]+/)?.[0] ?? '';\n  return candidate.replace(/^mailto:/i, '').replace(/[)>.,;]+$/g, '').trim().toLowerCase();\n}\n\nfunction normalizeMessageId(value) {\n  const raw = text(value).trim();\n  const candidate = raw.match(/<([^<>\\r\\n]+)>/)?.[1] ?? raw.split(/\\s+/)[0] ?? '';\n  return candidate && candidate.includes('@') ? `<${candidate}>` : '';\n}\n\nfunction extractMessageIds(value) {\n  const raw = Array.isArray(value) ? value.join(' ') : text(value);\n  const bracketed = [...raw.matchAll(/<([^<>\\r\\n]+)>/g)]\n    .map((match) => normalizeMessageId(match[0]))\n    .filter(Boolean);\n  if (bracketed.length) return [...new Set(bracketed)];\n  return [...new Set(raw.split(/[\\s,]+/).map(normalizeMessageId).filter(Boolean))];\n}\n\nfunction normalizeHeaders(headers) {\n  const output = {};\n  if (Array.isArray(headers)) {\n    for (const entry of headers) {\n      const key = text(entry?.name ?? entry?.key).trim().toLowerCase();\n      if (!key) continue;\n      const value = text(entry?.value ?? entry?.line);\n      output[key] = [...(output[key] ?? []), value];\n    }\n    return output;\n  }\n  for (const [name, value] of Object.entries(headers ?? {})) {\n    const key = text(name).trim().toLowerCase();\n    if (!key) continue;\n    output[key] = (Array.isArray(value) ? value : [value]).map(text);\n  }\n  return output;\n}\n\nconst headers = normalizeHeaders(input.headers);\nconst header = (name) => headers[name.toLowerCase()]?.[0] ?? '';\nconst headerValues = (name) => headers[name.toLowerCase()] ?? [];\nconst body = text(\n  input.text ??\n    input.textPlain ??\n    input.plainText ??\n    input.body ??\n    input.html ??\n    '',\n).replace(/\\r\\n?/g, '\\n');\n\nfunction stripQuotedHistory(value) {\n  const lines = text(value).split('\\n');\n  const kept = [];\n  for (let index = 0; index < lines.length; index += 1) {\n    const line = lines[index];\n    const trimmed = line.trim();\n    let wrappedOnHeader = false;\n    if (/^On\\b/i.test(trimmed)) {\n      let joined = '';\n      for (\n        let offset = 0;\n        offset < 4 && index + offset < lines.length;\n        offset += 1\n      ) {\n        const next = lines[index + offset].trim();\n        if (offset > 0 && /^>/.test(next)) break;\n        joined = `${joined} ${next}`.trim();\n        if (/\\bwrote:\\s*$/i.test(joined)) {\n          wrappedOnHeader = true;\n          break;\n        }\n      }\n    }\n    const quotedHeader =\n      wrappedOnHeader ||\n      /^-{2,}\\s*(?:Original Message|Forwarded message)\\s*-{2,}$/i.test(trimmed) ||\n      /^Begin forwarded message:\\s*$/i.test(trimmed) ||\n      (/^From:\\s+.+/i.test(trimmed) &&\n        lines\n          .slice(index + 1, index + 5)\n          .some((next) => /^(?:Sent|Date|To|Subject):\\s+/i.test(next.trim())));\n    if (quotedHeader) break;\n    if (/^>/.test(trimmed)) continue;\n    if (/^--\\s*$/.test(trimmed) || /^Sent from my (?:iPhone|iPad|Android)/i.test(trimmed)) {\n      break;\n    }\n    kept.push(line);\n  }\n  return kept.join('\\n').replace(/\\n{3,}/g, '\\n\\n').trim();\n}\n\nconst dsnContainers = [\n  input.dsn,\n  input.deliveryStatus,\n  input.delivery_status,\n  input.deliveryStatuses,\n  input.delivery_statuses,\n];\nconst rawMessage = payloadText(input.raw ?? input.rawMessage ?? input.source);\nconst dsnSource = [\n  ...dsnContainers.map((value) => payloadText(value)),\n  rawMessage,\n  body,\n]\n  .filter(Boolean)\n  .join('\\n');\nconst firstStructuredDsnValue = (aliases) => {\n  for (const container of dsnContainers) {\n    const candidate = structuredValue(container, aliases);\n    if (candidate) return candidate;\n  }\n  return '';\n};\n\nfunction dsnField(field) {\n  const escaped = field.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');\n  return (\n    dsnSource.match(new RegExp(`^${escaped}:\\\\s*(.+)$`, 'im'))?.[1]?.trim() ?? ''\n  );\n}\n\nconst contentType = [\n  text(input.contentType),\n  text(input.content_type),\n  ...headerValues('content-type'),\n].join('; ').toLowerCase();\nconst dsnAction = text(\n  firstStructuredDsnValue(['action']) || dsnField('Action'),\n)\n  .trim()\n  .toLowerCase();\nconst dsnStatus = text(\n  firstStructuredDsnValue(['status']) || dsnField('Status'),\n).trim();\nconst bounceRecipient = normalizeEmail(\n  text(\n    firstStructuredDsnValue([\n      'finalRecipient',\n      'final_recipient',\n      'originalRecipient',\n      'original_recipient',\n      'recipient',\n    ]) ||\n      dsnField('Final-Recipient') ||\n      dsnField('Original-Recipient') ||\n      header('x-failed-recipients'),\n  ).replace(/^rfc822\\s*;\\s*/i, ''),\n);\nconst originalMessageId = normalizeMessageId(\n  firstStructuredDsnValue([\n    'originalMessageId',\n    'original_message_id',\n    'original-message-id',\n    'x-original-message-id',\n  ]) ||\n    dsnField('Original-Message-ID') ||\n    dsnField('X-Original-Message-ID') ||\n    header('original-message-id'),\n);\nconst structuralDsn =\n  (/multipart\\/report/.test(contentType) &&\n    /report-type\\s*=\\s*[\"']?delivery-status/.test(contentType)) ||\n  Boolean(\n    dsnAction &&\n      dsnStatus &&\n      bounceRecipient &&\n      ['failed', 'delayed', 'delivered', 'relayed', 'expanded'].includes(dsnAction),\n  ) ||\n  Boolean(dsnStatus && bounceRecipient && /^[245]\\./.test(dsnStatus));\n\nconst autoSubmitted = header('auto-submitted').trim().toLowerCase();\nconst autoReply =\n  (autoSubmitted && autoSubmitted !== 'no') ||\n  ['x-autoreply', 'x-autorespond', 'x-auto-response-suppress', 'x-autoreply-from'].some(\n    (name) => headerValues(name).some((value) => text(value).trim()),\n  ) ||\n  /\\b(?:automatic reply|auto[- ]?reply|out of office)\\b/i.test(\n    text(input.subject ?? header('subject')),\n  );\n\nconst cleanBody = stripQuotedHistory(body);\nconst normalizedBody = cleanBody\n  .toLowerCase()\n  .replace(/[’‘]/g, \"'\")\n  .replace(/\\s+/g, ' ')\n  .trim();\nconst optOut = [\n  /\\bunsubscribe\\b/,\n  /\\bopt[\\s-]?out\\b/,\n  /\\bremove\\s+(?:me|us|my email|this email)\\b/,\n  /\\btake\\s+(?:me|us)\\s+off\\b/,\n  /\\bstop\\s+(?:emailing|contacting|messaging|sending)\\b/,\n  /\\bdo\\s+not\\s+(?:email|contact|message)\\b/,\n  /\\bdon't\\s+(?:email|contact|message)\\b/,\n  /\\bnot\\s+interested\\b/,\n  /\\bno\\s+thanks?\\b/,\n  /^(?:no|stop)\\W*$/,\n].some((pattern) => pattern.test(normalizedBody));\nconst interested = [\n  /\\byes\\b.{0,80}\\binterested\\b/,\n  /\\bi(?:'m| am)\\s+interested\\b/,\n  /\\bplease\\s+send\\b.{0,80}\\b(?:assessment|details|information|info)\\b/,\n  /\\bsend\\b.{0,40}\\b(?:assessment|details|information|info)\\b/,\n  /\\btell\\s+me\\s+more\\b/,\n  /\\blet(?:'s| us)\\s+(?:talk|schedule|discuss)\\b/,\n  /\\bopen\\s+to\\s+(?:a\\s+)?(?:call|chat|discussion)\\b/,\n  /^(?:yes|interested)\\W*$/,\n].some((pattern) => pattern.test(normalizedBody));\n\nlet eventType = 'HUMAN_REPLY';\nlet replyIntent = 'OTHER';\nlet classificationMethod = 'RULES';\nlet classificationConfidence = 0.8;\nif (structuralDsn) {\n  classificationMethod = 'HEADERS';\n  classificationConfidence = 0.99;\n  replyIntent = 'NONE';\n  if (/^5\\./.test(dsnStatus)) eventType = 'HARD_BOUNCE';\n  else if (/^4\\./.test(dsnStatus)) eventType = 'SOFT_BOUNCE';\n  else eventType = 'UNKNOWN_BOUNCE';\n} else if (autoReply) {\n  eventType = 'AUTO_REPLY';\n  replyIntent = 'NONE';\n  classificationMethod = 'HEADERS';\n  classificationConfidence = 0.98;\n} else if (optOut) {\n  eventType = 'OPT_OUT';\n  replyIntent = 'NEGATIVE';\n  classificationConfidence = 0.98;\n} else if (interested) {\n  eventType = 'INTERESTED';\n  replyIntent = 'INTERESTED';\n  classificationConfidence = 0.92;\n} else if (/\\?|\\b(?:price|pricing|cost|how|what|when|where|assessment)\\b/i.test(cleanBody)) {\n  eventType = 'HUMAN_REPLY';\n  replyIntent = 'QUESTION';\n} else if (/\\b(?:later|not now|next month|next quarter)\\b/i.test(cleanBody)) {\n  replyIntent = 'NOT_NOW';\n} else if (/\\b(?:no|decline|not a fit)\\b/i.test(cleanBody)) {\n  replyIntent = 'NEGATIVE';\n}\n\nconst fromEmail = normalizeEmail(input.from ?? input.fromEmail ?? header('from'));\nconst toEmail = normalizeEmail(input.to ?? input.toEmail ?? header('to'));\nconst messageId = normalizeMessageId(\n  input.messageId ?? input.message_id ?? header('message-id'),\n);\nconst inReplyToIds = extractMessageIds(\n  input.inReplyTo ?? input.in_reply_to ?? headerValues('in-reply-to'),\n);\nconst referenceIds = extractMessageIds(\n  input.references ?? headerValues('references'),\n);\nconst correlationIds = [\n  ...inReplyToIds,\n  originalMessageId,\n  ...referenceIds.slice().reverse(),\n].filter(Boolean);\nconst lookupProviderMessageId =\n  correlationIds[0] ?? `__NO_PROVIDER_MATCH__:${messageId || fromEmail || $execution.id}`;\nconst lookupEmail =\n  eventType.includes('BOUNCE') && bounceRecipient ? bounceRecipient : fromEmail;\n\nconst receivedAtRaw = input.date ?? input.receivedAt ?? header('date');\nconst receivedAtDate = new Date(receivedAtRaw || Date.now());\nconst receivedAt = Number.isFinite(receivedAtDate.getTime())\n  ? receivedAtDate.toISOString()\n  : new Date().toISOString();\nconst mailbox = 'outreach@example.com';\nconst folder = text(input.folder ?? input.mailboxFolder ?? 'INBOX').trim() || 'INBOX';\nconst uidValidity = text(\n  input.uidValidity ??\n    input.uid_validity ??\n    input.uidvalidity ??\n    input.attributes?.uidValidity ??\n    input.attributes?.uid_validity,\n).trim();\nconst imapUid = text(\n  input.uid ??\n    input.imapUid ??\n    input.imap_uid ??\n    input.attributes?.uid ??\n    input.attributes?.imapUid,\n).trim();\nconst fallbackSource = [\n  mailbox,\n  folder,\n  fromEmail,\n  toEmail,\n  text(input.subject ?? header('subject')).trim(),\n  text(receivedAtRaw).trim(),\n  body,\n  dsnSource,\n  Object.keys(headers)\n    .sort()\n    .map((name) => `${name}:${headers[name].join('\\n')}`)\n    .join('\\n'),\n].join('\\n');\nconst bodyFingerprint = sha256(body);\nconst eventId = messageId\n  ? `${mailbox}::mid:${messageId}`\n  : uidValidity && imapUid\n    ? `${mailbox}::imap:${uidValidity}:${imapUid}`\n    : `${mailbox}::sha256:${sha256(fallbackSource)}`;\nconst allowlistedHeaders = {};\nfor (const name of [\n  'message-id',\n  'in-reply-to',\n  'references',\n  'auto-submitted',\n  'content-type',\n  'original-message-id',\n  'x-failed-recipients',\n]) {\n  if (headers[name]?.length) allowlistedHeaders[name] = headers[name].slice(0, 10);\n}\n\nreturn [{\n  json: {\n    event_id: eventId,\n    dedupe_key: eventId,\n    mailbox,\n    folder,\n    uid_validity: uidValidity,\n    imap_uid: imapUid,\n    message_id: messageId,\n    in_reply_to: inReplyToIds[0] ?? '',\n    references_json: JSON.stringify(referenceIds.slice(0, 20)),\n    correlation_ids: correlationIds,\n    lookup_provider_message_id: lookupProviderMessageId,\n    lookup_email: lookupEmail,\n    from_email: fromEmail,\n    to_email: toEmail,\n    subject: text(input.subject ?? header('subject')).trim().slice(0, 500),\n    received_at: receivedAt,\n    body_excerpt: cleanBody.slice(0, 500),\n    body_fingerprint: bodyFingerprint,\n    headers_json: JSON.stringify(allowlistedHeaders).slice(0, 5000),\n    event_type: eventType,\n    reply_intent: replyIntent,\n    classification_method: classificationMethod,\n    classification_confidence: classificationConfidence,\n    dsn_action: dsnAction,\n    dsn_status: dsnStatus,\n    dsn_diagnostic: text(\n      firstStructuredDsnValue(['diagnosticCode', 'diagnostic_code']) ||\n        dsnField('Diagnostic-Code'),\n    ).slice(0, 500),\n    bounce_recipient: bounceRecipient,\n    execution_id: String($execution.id),\n    created_at: new Date().toISOString(),\n    updated_at: new Date().toISOString(),\n  },\n}];\n"
    },
    position: [240, 0]
  },
  output: [{
    event_id: 'outreach@example.com::mid:<inbound@example.com>',
    dedupe_key: 'outreach@example.com::mid:<inbound@example.com>',
    lookup_provider_message_id: '<outbound@iawebdev.com>',
    lookup_email: 'clinic@example.com',
    event_type: 'INTERESTED'
  }]
});

const newEventOnly = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'New Event Only',
    parameters: {
      resource: 'row',
      operation: 'rowNotExists',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_4", cachedResultName: "outreach_inbound_events_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "dedupe_key", condition: 'eq', keyValue: expr('{{ $json.dedupe_key }}') }] }
    },
    position: [480, 0]
  },
  output: [{ event_id: 'outreach@example.com::mid:<inbound@example.com>' }]
});

const startAudit = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Start Event Audit',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_4", cachedResultName: "outreach_inbound_events_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "dedupe_key", condition: 'eq', keyValue: expr('{{ $json.dedupe_key }}') }] },
      columns: { mappingMode: 'defineBelow', value: {
  event_id: expr('{{ $json.event_id }}'),
  dedupe_key: expr('{{ $json.dedupe_key }}'),
  mailbox: expr('{{ $json.mailbox }}'),
  folder: expr('{{ $json.folder }}'),
  uid_validity: expr('{{ $json.uid_validity }}'),
  imap_uid: expr('{{ $json.imap_uid }}'),
  message_id: expr('{{ $json.message_id }}'),
  in_reply_to: expr('{{ $json.in_reply_to }}'),
  references_json: expr('{{ $json.references_json }}'),
  from_email: expr('{{ $json.from_email }}'),
  to_email: expr('{{ $json.to_email }}'),
  subject: expr('{{ $json.subject }}'),
  received_at: expr('{{ $json.received_at }}'),
  body_excerpt: expr('{{ $json.body_excerpt }}'),
  body_fingerprint: expr('{{ $json.body_fingerprint }}'),
  headers_json: expr('{{ $json.headers_json }}'),
  event_type: expr('{{ $json.event_type }}'),
  reply_intent: expr('{{ $json.reply_intent }}'),
  classification_method: expr('{{ $json.classification_method }}'),
  classification_confidence: expr('{{ $json.classification_confidence }}'),
  dsn_action: expr('{{ $json.dsn_action }}'),
  dsn_status: expr('{{ $json.dsn_status }}'),
  dsn_diagnostic: expr('{{ $json.dsn_diagnostic }}'),
  bounce_recipient: expr('{{ $json.bounce_recipient }}'),
  processing_status: 'PROCESSING',
  notification_status: 'PENDING',
  execution_id: expr('{{ $execution.id }}'),
  last_error_code: '',
  last_error_message: '',
  created_at: expr('{{ $json.created_at }}'),
  updated_at: expr('{{ $now.toISO() }}')
}, matchingColumns: [] },
      options: {}
    },
    position: [720, 0]
  },
  output: [{ event_id: 'outreach@example.com::mid:<inbound@example.com>' }]
});

const readCandidates = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read Candidate Delivery Items',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_3", cachedResultName: "outreach_batch_items_v3" },
      matchType: 'anyCondition', filters: { conditions: [{ keyName: "provider_message_id", condition: 'eq', keyValue: expr("{{ $('Normalize and Classify').item.json.lookup_provider_message_id }}") }, { keyName: "send_to", condition: 'eq', keyValue: expr("{{ $('Normalize and Classify').item.json.lookup_email }}") }] },
      returnAll: true
    },
    alwaysOutputData: true,
    position: [960, 0]
  },
  output: [{ item_key: 'BATCH::1', batch_id: 'BATCH', provider_message_id: '<outbound@iawebdev.com>' }]
});

const hasCandidates = ifElse({
  version: 2.3,
  config: {
    name: 'Candidates Found?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          leftValue: expr('{{ Boolean($json.item_key) }}'),
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true }
        }]
      },
      options: {}
    },
    position: [1200, 0]
  }
});

const candidatesPresent = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Candidate Rows Present',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: 'return $input.all();' },
    position: [1440, -96]
  },
  output: [{ item_key: 'BATCH::1' }]
});

const noCandidates = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'No Candidate Rows',
    parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: 'return [{ json: { no_candidates: true } }];' },
    position: [1440, 96]
  },
  output: [{ no_candidates: true }]
});

const readBatches = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read Batch Ledger',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_2", cachedResultName: "outreach_batches_v3" },
      returnAll: true
    },
    alwaysOutputData: true,
    executeOnce: true,
    position: [1680, 0]
  },
  output: [{ batch_id: 'BATCH', send_mode: 'TEST', status: 'COMPLETE' }]
});

const hasBatches = ifElse({
  version: 2.3,
  config: {
    name: 'Batches Found?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          leftValue: expr('{{ Boolean($json.batch_id) }}'),
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true }
        }]
      },
      options: {}
    },
    position: [1920, 0]
  }
});

const correlate = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Correlate and Plan',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const event = $('Normalize and Classify').first().json;\nconst candidateRows = $('Read Candidate Delivery Items')\n  .all()\n  .map((item) => item.json ?? {})\n  .filter((row) => row.item_key);\nconst batches = $input\n  .all()\n  .map((item) => item.json ?? {})\n  .filter((row) => row.batch_id);\nconst text = (value) => String(value ?? '');\nconst normalizeEmail = (value) => {\n  const raw = text(value).trim().toLowerCase();\n  const bracketed = raw.match(/<([^<>\\s]+@[^<>\\s]+)>/);\n  return (bracketed?.[1] ?? raw.match(/[^\\s<>,;]+@[^\\s<>,;]+/)?.[0] ?? '')\n    .replace(/[)>.,;]+$/g, '');\n};\nconst normalizeMessageId = (value) => {\n  const raw = text(value).trim();\n  const candidate = raw.match(/<([^<>\\r\\n]+)>/)?.[1] ?? raw.split(/\\s+/)[0] ?? '';\n  return candidate && candidate.includes('@') ? `<${candidate}>` : '';\n};\n\nconst batchById = new Map(batches.map((row) => [text(row.batch_id), row]));\nconst correlationIds = new Set(\n  (Array.isArray(event.correlation_ids) ? event.correlation_ids : [])\n    .map(normalizeMessageId)\n    .filter(Boolean),\n);\nconst exactMatches = candidateRows.filter((row) => {\n  const providerId = normalizeMessageId(row.provider_message_id);\n  return providerId && correlationIds.has(providerId);\n});\nlet matchedItem = null;\nlet matchMethod = 'UNMATCHED';\nlet matchConfidence = 0;\nlet authoritative = false;\nif (exactMatches.length === 1) {\n  matchedItem = exactMatches[0];\n  matchMethod = 'PROVIDER_MESSAGE_ID';\n  matchConfidence = 1;\n  authoritative = true;\n} else if (!exactMatches.length && event.lookup_email) {\n  const fallbackMatches = candidateRows\n    .filter((row) => {\n      const batch = batchById.get(text(row.batch_id));\n      const sentAt = Date.parse(row.sent_at);\n      const recent =\n        Number.isFinite(sentAt) && Date.now() - sentAt <= 30 * 24 * 60 * 60 * 1000;\n      return (\n        recent &&\n        text(row.status).toUpperCase() === 'SENT' &&\n        normalizeEmail(row.send_to) === normalizeEmail(event.lookup_email) &&\n        batch\n      );\n    })\n    .sort((left, right) => Date.parse(right.sent_at) - Date.parse(left.sent_at));\n  if (fallbackMatches.length === 1) {\n    matchedItem = fallbackMatches[0];\n    matchMethod = 'UNIQUE_RECENT_SENDER';\n    matchConfidence = 0.7;\n  } else if (fallbackMatches.length > 1) {\n    matchMethod = 'AMBIGUOUS_RECENT_SENDER';\n  }\n}\n\nconst matchedBatch = matchedItem\n  ? batchById.get(text(matchedItem.batch_id)) ?? null\n  : null;\nconst sendMode = text(matchedBatch?.send_mode).toUpperCase();\nconst intendedRecipient = normalizeEmail(matchedItem?.intended_recipient);\nconst actualSendTo = normalizeEmail(matchedItem?.send_to);\nconst replySender = normalizeEmail(event.from_email);\nconst dsnRecipient = normalizeEmail(event.bounce_recipient);\nconst isBounceEvent = ['HARD_BOUNCE', 'SOFT_BOUNCE', 'UNKNOWN_BOUNCE'].includes(\n  text(event.event_type).toUpperCase(),\n);\nconst recipientFieldsMatch = Boolean(\n  intendedRecipient &&\n    actualSendTo &&\n    intendedRecipient === actualSendTo,\n);\nconst inboundIdentityMatches = Boolean(\n  intendedRecipient &&\n    (isBounceEvent\n      ? dsnRecipient && dsnRecipient === intendedRecipient\n      : replySender && replySender === intendedRecipient),\n);\nconst isTest =\n  sendMode === 'TEST' ||\n  Boolean(\n    matchedItem &&\n      !recipientFieldsMatch,\n  );\nconst liveAuthoritative =\n  Boolean(matchedItem && matchedBatch) &&\n  authoritative &&\n  sendMode === 'LIVE' &&\n  text(matchedItem.status).toUpperCase() === 'SENT' &&\n  ['SENDING', 'COMPLETE'].includes(\n    text(matchedBatch.status).toUpperCase(),\n  ) &&\n  recipientFieldsMatch &&\n  inboundIdentityMatches;\nconst controlEmail = liveAuthoritative ? intendedRecipient : '';\n\nlet eventType = event.event_type;\nif (!matchedItem && !['AUTO_REPLY', 'HARD_BOUNCE', 'SOFT_BOUNCE', 'UNKNOWN_BOUNCE'].includes(eventType)) {\n  eventType = 'UNMATCHED';\n}\n\nlet controlType = '';\nlet reasonCode = '';\nlet permanent = false;\nif (['INTERESTED', 'HUMAN_REPLY'].includes(eventType)) {\n  controlType = 'HOLD';\n  reasonCode = 'HUMAN_REPLY_REVIEW';\n} else if (eventType === 'OPT_OUT') {\n  controlType = 'SUPPRESS';\n  reasonCode = 'OPT_OUT';\n  permanent = true;\n} else if (eventType === 'HARD_BOUNCE') {\n  controlType = 'SUPPRESS';\n  reasonCode = 'HARD_BOUNCE';\n  permanent = true;\n}\n\nconst shadowMode = false;\nconst wantsControl = Boolean(controlType);\nconst applyControl = wantsControl && liveAuthoritative && !shadowMode;\nconst updateEngagement =\n  Boolean(matchedItem) &&\n  liveAuthoritative &&\n  !isTest &&\n  !shadowMode &&\n  ['INTERESTED', 'HUMAN_REPLY', 'OPT_OUT', 'HARD_BOUNCE', 'SOFT_BOUNCE', 'AUTO_REPLY'].includes(eventType);\nconst shouldNotify = eventType !== 'AUTO_REPLY';\nconst mutationRoute = applyControl ? 0 : updateEngagement ? 1 : 2;\nconst notificationRoute = shouldNotify ? 0 : 1;\nconst plannedAction = wantsControl\n  ? controlType\n  : updateEngagement\n    ? 'UPDATE_ENGAGEMENT'\n    : 'NONE';\nlet processingStatus = 'NEEDS_REVIEW';\nif (isTest) processingStatus = 'IGNORED_TEST';\nelse if (eventType === 'AUTO_REPLY') processingStatus = 'APPLIED';\nelse if (applyControl || updateEngagement) processingStatus = 'PROCESSING';\n\nconst statusLabel = isTest\n  ? 'TEST — no mutation'\n  : matchedItem && (!recipientFieldsMatch || !inboundIdentityMatches)\n    ? 'IDENTITY MISMATCH — manual review'\n  : shadowMode\n    ? 'SHADOW — no mutation'\n    : applyControl\n      ? `${controlType} planned`\n      : 'review';\nconst company = text(matchedItem?.company_name_snapshot).trim();\nconst excerpt = text(event.body_excerpt).replace(/\\s+/g, ' ').slice(0, 300);\nconst slackMessage = [\n  `*Inbound outreach: ${eventType}*`,\n  `Status: ${statusLabel}`,\n  `From: ${event.from_email || 'unknown'}`,\n  `Subject: ${event.subject || '(no subject)'}`,\n  company ? `Contact: ${company}` : '',\n  matchedItem ? `Intended: ${matchedItem.intended_recipient}` : '',\n  matchedBatch ? `Batch: ${matchedBatch.batch_id} (${sendMode})` : '',\n  `Match: ${matchMethod}`,\n  excerpt ? `Reply: ${excerpt}` : '',\n].filter(Boolean).join('\\n');\n\nconst engagementStatus =\n  eventType === 'INTERESTED'\n    ? 'INTERESTED'\n    : eventType === 'OPT_OUT'\n      ? 'OPTED_OUT'\n      : eventType;\nconst now = new Date().toISOString();\nreturn [{\n  json: {\n    ...event,\n    event_type: eventType,\n    match_method: matchMethod,\n    match_confidence: matchConfidence,\n    authoritative_match: authoritative,\n    review_id: text(matchedItem?.review_id),\n    contact_key: text(matchedItem?.contact_key),\n    campaign_version: text(matchedItem?.campaign_version),\n    batch_id: text(matchedItem?.batch_id),\n    item_key: text(matchedItem?.item_key),\n    company_name: company,\n    outbound_provider_message_id: text(matchedItem?.provider_message_id),\n    send_mode: sendMode,\n    intended_recipient: intendedRecipient,\n    actual_send_to: actualSendTo,\n    control_email: controlEmail,\n    recipient_fields_match: recipientFieldsMatch,\n    inbound_identity_match: inboundIdentityMatches,\n    mutation_authorized: liveAuthoritative,\n    is_test: isTest,\n    control_type: controlType,\n    reason_code: reasonCode,\n    permanent,\n    planned_action: plannedAction,\n    action_applied: false,\n    processing_status: processingStatus,\n    notification_status: shouldNotify ? 'PENDING' : 'NOT_REQUIRED',\n    mutation_route: mutationRoute,\n    notification_route: notificationRoute,\n    shadow_mode: shadowMode,\n    engagement_status: engagementStatus,\n    slack_message: slackMessage,\n    updated_at: now,\n  },\n}];\n"
    },
    position: [2160, 0]
  },
  output: [{
    event_id: 'outreach@example.com::mid:<inbound@example.com>',
    event_type: 'INTERESTED',
    mutation_route: 2,
    notification_route: 0,
    processing_status: 'IGNORED_TEST'
  }]
});

const persistPlan = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Persist Correlation Plan',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_4", cachedResultName: "outreach_inbound_events_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "dedupe_key", condition: 'eq', keyValue: expr("{{ $('Correlate and Plan').item.json.dedupe_key }}") }] },
      columns: { mappingMode: 'defineBelow', value: {
  event_id: expr("{{ $('Correlate and Plan').item.json.event_id }}"),
  dedupe_key: expr("{{ $('Correlate and Plan').item.json.dedupe_key }}"),
  event_type: expr("{{ $('Correlate and Plan').item.json.event_type }}"),
  reply_intent: expr("{{ $('Correlate and Plan').item.json.reply_intent }}"),
  match_method: expr("{{ $('Correlate and Plan').item.json.match_method }}"),
  match_confidence: expr("{{ $('Correlate and Plan').item.json.match_confidence }}"),
  review_id: expr("{{ $('Correlate and Plan').item.json.review_id }}"),
  contact_key: expr("{{ $('Correlate and Plan').item.json.contact_key }}"),
  campaign_version: expr("{{ $('Correlate and Plan').item.json.campaign_version }}"),
  batch_id: expr("{{ $('Correlate and Plan').item.json.batch_id }}"),
  item_key: expr("{{ $('Correlate and Plan').item.json.item_key }}"),
  outbound_provider_message_id: expr("{{ $('Correlate and Plan').item.json.outbound_provider_message_id }}"),
  send_mode: expr("{{ $('Correlate and Plan').item.json.send_mode }}"),
  intended_recipient: expr("{{ $('Correlate and Plan').item.json.intended_recipient }}"),
  actual_send_to: expr("{{ $('Correlate and Plan').item.json.actual_send_to }}"),
  is_test: expr("{{ $('Correlate and Plan').item.json.is_test }}"),
  planned_action: expr("{{ $('Correlate and Plan').item.json.planned_action }}"),
  action_applied: expr("{{ $('Correlate and Plan').item.json.action_applied }}"),
  processing_status: expr("{{ $('Correlate and Plan').item.json.processing_status }}"),
  notification_status: expr("{{ $('Correlate and Plan').item.json.notification_status }}"),
  execution_id: expr('{{ $execution.id }}'),
  updated_at: expr('{{ $now.toISO() }}')
}, matchingColumns: [] },
      options: {}
    },
    position: [2400, 0]
  },
  output: [{ event_id: 'outreach@example.com::mid:<inbound@example.com>' }]
});

const routeMutation = switchCase({
  version: 3.4,
  config: {
    name: 'Route Mutation',
    parameters: {
      mode: 'expression',
      numberOutputs: 3,
      output: expr("{{ $('Correlate and Plan').item.json.mutation_route }}"),
      looseTypeValidation: false
    },
    position: [2640, 0]
  }
});

const readExistingControl = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read Existing Contact Control',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_5", cachedResultName: "outreach_suppressions_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "suppression_key", condition: 'eq', keyValue: expr("{{ 'email:' + $('Correlate and Plan').item.json.control_email }}") }] },
      returnAll: true
    },
    alwaysOutputData: true,
    position: [2880, -384]
  },
  output: [{
    suppression_key: 'email:clinic@example.com',
    active: true,
    control_type: 'SUPPRESS',
    permanent: true
  }]
});

const resolveControl = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Resolve Control Precedence',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const plan = $('Correlate and Plan').first().json;\nconst rows = $input.all().map((item) => item.json ?? {});\nconst existing = rows.find((row) => row.suppression_key) ?? {};\nconst text = (value) => String(value ?? '').trim();\nconst asBoolean = (value) =>\n  value === true || ['true', '1', 'yes'].includes(text(value).toLowerCase());\n\nconst controlEmail = text(plan.control_email).toLowerCase();\nif (!controlEmail || !controlEmail.includes('@')) {\n  throw new Error('CONTROL_EMAIL_NOT_VERIFIED');\n}\n\nconst rank = (row) => {\n  if (!asBoolean(row.active)) return 0;\n  const type = text(row.control_type).toUpperCase();\n  if (type === 'SUPPRESS' && asBoolean(row.permanent)) return 3;\n  if (type === 'SUPPRESS') return 2;\n  if (type === 'HOLD') return 1;\n  return 0;\n};\n\nconst proposed = {\n  control_type: text(plan.control_type).toUpperCase(),\n  permanent: asBoolean(plan.permanent),\n  reason_code: text(plan.reason_code),\n  reason_detail: `${text(plan.event_type)} via ${text(plan.match_method)}`,\n};\nconst existingRank = rank(existing);\nconst proposedRank = rank({ ...proposed, active: true });\nconst preserveExisting = existingRank >= proposedRank && existingRank > 0;\nconst chosen = preserveExisting\n  ? {\n      control_type: text(existing.control_type).toUpperCase(),\n      permanent: asBoolean(existing.permanent),\n      reason_code: text(existing.reason_code),\n      reason_detail: text(existing.reason_detail),\n    }\n  : proposed;\n\nlet audit = [];\ntry {\n  const parsed = JSON.parse(text(existing.audit_json) || '[]');\n  if (Array.isArray(parsed)) audit = parsed;\n} catch {}\n\nconst now = new Date().toISOString();\naudit = [\n  ...audit.slice(-49),\n  {\n    action: preserveExisting ? 'CONTROL_PRESERVED' : 'CONTROL_UPSERTED',\n    proposed_control_type: proposed.control_type,\n    effective_control_type: chosen.control_type,\n    event_id: text(plan.event_id),\n    at: now,\n  },\n];\n\nreturn [\n  {\n    json: {\n      ...plan,\n      suppression_key: `email:${controlEmail}`,\n      control_email: controlEmail,\n      effective_control_type: chosen.control_type,\n      effective_permanent: chosen.permanent,\n      effective_reason_code: chosen.reason_code,\n      effective_reason_detail: chosen.reason_detail,\n      control_created_by: text(existing.created_by) || 'n8n:inbound-v3',\n      control_created_at: text(existing.created_at) || now,\n      control_audit_json: JSON.stringify(audit),\n      control_precedence_result: preserveExisting\n        ? 'EXISTING_CONTROL_PRESERVED'\n        : 'PROPOSED_CONTROL_APPLIED',\n      updated_at: now,\n    },\n  },\n];\n"
    },
    position: [3120, -384]
  },
  output: [{
    suppression_key: 'email:clinic@example.com',
    effective_control_type: 'SUPPRESS'
  }]
});

const upsertControl = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Upsert Contact Control',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_5", cachedResultName: "outreach_suppressions_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "suppression_key", condition: 'eq', keyValue: expr("{{ $('Resolve Control Precedence').item.json.suppression_key }}") }] },
      columns: { mappingMode: 'defineBelow', value: {
        suppression_key: expr("{{ $('Resolve Control Precedence').item.json.suppression_key }}"),
        scope: 'EMAIL',
        normalized_email: expr("{{ $('Resolve Control Precedence').item.json.control_email }}"),
        normalized_domain: expr("{{ $('Resolve Control Precedence').item.json.control_email.split('@')[1] || '' }}"),
        control_type: expr("{{ $('Resolve Control Precedence').item.json.effective_control_type }}"),
        reason_code: expr("{{ $('Resolve Control Precedence').item.json.effective_reason_code }}"),
        reason_detail: expr("{{ $('Resolve Control Precedence').item.json.effective_reason_detail }}"),
        active: true,
        permanent: expr("{{ $('Resolve Control Precedence').item.json.effective_permanent }}"),
        source_event_id: expr("{{ $('Correlate and Plan').item.json.event_id }}"),
        source_review_id: expr("{{ $('Correlate and Plan').item.json.review_id }}"),
        created_by: expr("{{ $('Resolve Control Precedence').item.json.control_created_by }}"),
        created_at: expr("{{ $('Resolve Control Precedence').item.json.control_created_at }}"),
        updated_by: 'n8n:inbound-v3',
        updated_at: expr('{{ $now.toISO() }}'),
        released_by: '',
        released_at: null,
        release_reason: '',
        audit_json: expr("{{ $('Resolve Control Precedence').item.json.control_audit_json }}")
      }, matchingColumns: [] },
      options: {}
    },
    position: [3360, -384]
  },
  output: [{ suppression_key: 'email:clinic@example.com', active: true }]
});

const mirrorControl = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Mirror Control to Queue',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_1", cachedResultName: "outreach_review_queue_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "review_id", condition: 'eq', keyValue: expr("{{ 'CONTROL::' + $('Resolve Control Precedence').item.json.control_email }}") }] },
      columns: { mappingMode: 'defineBelow', value: {
        review_id: expr("{{ 'CONTROL::' + $('Resolve Control Precedence').item.json.control_email }}"),
        contact_key: expr("{{ 'CONTROL::' + $('Resolve Control Precedence').item.json.control_email }}"),
        campaign_version: 'GLOBAL-CONTROL',
        company_name: 'Global contact control',
        email: expr("{{ $('Resolve Control Precedence').item.json.control_email }}"),
        intended_recipient: expr("{{ $('Resolve Control Precedence').item.json.control_email }}"),
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
        suppressed_reason: expr("{{ $('Resolve Control Precedence').item.json.effective_reason_code }}"),
        decision_reason: expr("{{ $('Resolve Control Precedence').item.json.effective_reason_code }}"),
        updated_by: 'n8n:inbound-v3',
        audit_json: expr("{{ JSON.stringify([{ action: 'CONTROL_MIRROR_UPSERTED', event_id: $('Correlate and Plan').item.json.event_id, at: $now.toISO() }]) }}"),
        created_at: expr('{{ $now.toISO() }}'),
        updated_at: expr('{{ $now.toISO() }}')
      }, matchingColumns: [] },
      options: {}
    },
    position: [3600, -384]
  },
  output: [{ review_id: 'CONTROL::clinic@example.com', send_status: 'SUPPRESSED' }]
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
      matchType: 'allConditions', filters: { conditions: [{ keyName: "email", condition: 'eq', keyValue: expr("{{ $('Resolve Control Precedence').item.json.control_email }}") }, { keyName: "send_status", condition: 'eq', keyValue: 'UNSENT' }, { keyName: "batch_status", condition: 'eq', keyValue: 'UNBATCHED' }] },
      columns: { mappingMode: 'defineBelow', value: {
        approval_status: 'BLOCKED',
        send_status: 'SUPPRESSED',
        batch_status: 'CANCELLED',
        suppressed_reason: expr("{{ $('Resolve Control Precedence').item.json.effective_reason_code }}"),
        decision_reason: expr("{{ $('Resolve Control Precedence').item.json.effective_reason_code }}"),
        updated_by: 'n8n:inbound-v3',
        updated_at: expr('{{ $now.toISO() }}')
      }, matchingColumns: [] },
      options: {}
    },
    alwaysOutputData: true,
    position: [3840, -384]
  },
  output: [{ review_id: 'future-review', send_status: 'SUPPRESSED' }]
});

const pendingFound = ifElse({
  version: 2.3,
  config: {
    name: 'Pending Rows Found?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          leftValue: expr('{{ Boolean($json.review_id) }}'),
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true }
        }]
      },
      options: {}
    },
    position: [4080, -384]
  }
});

const updateEngagement = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Update Delivered Engagement',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_1", cachedResultName: "outreach_review_queue_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "review_id", condition: 'eq', keyValue: expr("{{ $('Correlate and Plan').item.json.review_id }}") }, { keyName: "send_status", condition: 'eq', keyValue: 'SENT' }] },
      columns: { mappingMode: 'defineBelow', value: {
        engagement_status: expr("{{ $('Correlate and Plan').item.json.engagement_status }}"),
        last_inbound_type: expr("{{ $('Correlate and Plan').item.json.event_type }}"),
        last_inbound_event_id: expr("{{ $('Correlate and Plan').item.json.event_id }}"),
        last_inbound_at: expr("{{ $('Correlate and Plan').item.json.received_at }}"),
        last_inbound_from: expr("{{ $('Correlate and Plan').item.json.from_email }}"),
        last_reply_preview: expr("{{ $('Correlate and Plan').item.json.body_excerpt }}"),
        engagement_updated_at: expr('{{ $now.toISO() }}'),
        engagement_updated_by: 'n8n:inbound-v3',
        updated_at: expr('{{ $now.toISO() }}')
      }, matchingColumns: [] },
      options: {}
    },
    alwaysOutputData: true,
    position: [4320, -144]
  },
  output: [{ review_id: 'review', send_status: 'SENT', engagement_status: 'INTERESTED' }]
});

const projectionFound = ifElse({
  version: 2.3,
  config: {
    name: 'Projection Updated?',
    parameters: {
      conditions: {
        combinator: 'and',
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          leftValue: expr('{{ Boolean($json.review_id) }}'),
          rightValue: true,
          operator: { type: 'boolean', operation: 'true', singleValue: true }
        }]
      },
      options: {}
    },
    position: [4560, -144]
  }
});

const confirmMutation = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Confirm Mutation Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const plan = $('Correlate and Plan').first().json;\nconst rows = $input.all().map((item) => item.json ?? {});\nconst route = Number(plan.mutation_route);\nconst projectionUpdated = rows.some(\n  (row) =>\n    String(row.review_id ?? '') === String(plan.review_id ?? '') &&\n    String(row.last_inbound_event_id ?? '') === String(plan.event_id ?? ''),\n);\n\nlet actionApplied = false;\nlet failureCode = '';\nlet failureMessage = '';\n\nif (route === 1) {\n  actionApplied = projectionUpdated;\n  if (!actionApplied) {\n    failureCode = 'ENGAGEMENT_PROJECTION_NOT_CONFIRMED';\n    failureMessage = 'The delivered queue row was not confirmed updated.';\n  }\n} else if (route === 0) {\n  const controlRows = $('Upsert Contact Control')\n    .all()\n    .map((item) => item.json ?? {});\n  const mirrorRows = $('Mirror Control to Queue')\n    .all()\n    .map((item) => item.json ?? {});\n  const controlConfirmed = controlRows.some(\n    (row) =>\n      String(row.suppression_key ?? '') ===\n        String($('Resolve Control Precedence').first().json.suppression_key ?? '') &&\n      row.active !== false,\n  );\n  const mirrorConfirmed = mirrorRows.some(\n    (row) =>\n      String(row.review_id ?? '') ===\n        `CONTROL::${String(plan.control_email ?? '')}` &&\n      String(row.send_status ?? '').toUpperCase() === 'SUPPRESSED',\n  );\n  actionApplied = controlConfirmed && mirrorConfirmed && projectionUpdated;\n  if (!actionApplied) {\n    failureCode = 'CONTROL_MUTATION_NOT_CONFIRMED';\n    failureMessage =\n      'One or more required control, compatibility, or engagement writes were not confirmed.';\n  }\n}\n\nreturn [\n  {\n    json: {\n      ...plan,\n      action_applied: actionApplied,\n      processing_status: actionApplied ? 'APPLIED' : 'NEEDS_REVIEW',\n      last_error_code: failureCode,\n      last_error_message: failureMessage,\n      updated_at: new Date().toISOString(),\n    },\n  },\n];\n"
    },
    position: [4800, -144]
  },
  output: [{
    event_id: 'fixture',
    action_applied: true,
    processing_status: 'APPLIED'
  }]
});

const selectFinalPlan = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Select Final Plan',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const planned = $('Correlate and Plan').first().json;\nconst current = $input.first().json ?? {};\nreturn [\n  {\n    json: {\n      ...planned,\n      ...current,\n      slack_message: planned.slack_message,\n      updated_at: new Date().toISOString(),\n    },\n  },\n];\n"
    },
    position: [5040, 0]
  },
  output: [{
    event_id: 'fixture',
    action_applied: false,
    notification_route: 0
  }]
});

const routeNotification = switchCase({
  version: 3.4,
  config: {
    name: 'Route Notification',
    parameters: {
      mode: 'expression',
      numberOutputs: 2,
      output: expr("{{ $('Correlate and Plan').item.json.notification_route }}"),
      looseTypeValidation: false
    },
    position: [5280, 0]
  }
});

const notifySlack = node({
  type: 'n8n-nodes-base.slack',
  version: 2.5,
  config: {
    name: 'Notify Slack',
    parameters: {
      resource: 'message',
      operation: 'post',
      authentication: 'accessToken',
      select: 'channel',
      channelId: {
        __rl: true,
        mode: 'list',
        value: 'EXAMPLE_SLACK_CHANNEL',
        cachedResultName: 'logs'
      },
      messageType: 'text',
      text: expr("{{ $('Select Final Plan').item.json.slack_message }}"),
      otherOptions: {
        includeLinkToWorkflow: true,
        mrkdwn: true,
        unfurl_links: false,
        unfurl_media: true
      }
    },
    credentials: { slackApi: newCredential('Slack account') },
    onError: 'continueRegularOutput',
    position: [5520, -96]
  },
  output: [{ ok: true, channel: 'EXAMPLE_SLACK_CHANNEL', message_timestamp: '0' }]
});

const markNotification = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Mark Notification Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const plan = $('Select Final Plan').first().json;\nconst response = $input.first().json ?? {};\nconst failed = Boolean(\n  response.error ||\n    response.errorMessage ||\n    response.message === 'error' ||\n    response.ok === false,\n);\nreturn [{\n  json: {\n    ...plan,\n    notification_status: failed ? 'FAILED' : 'SENT',\n    notified_at: failed ? '' : new Date().toISOString(),\n    processing_status: failed ? 'NEEDS_REVIEW' : plan.processing_status,\n    last_error_code: failed ? 'SLACK_NOTIFICATION_FAILED' : '',\n    last_error_message: failed\n      ? String(response.error?.message ?? response.errorMessage ?? response.message ?? 'Slack notification failed').slice(0, 500)\n      : '',\n    updated_at: new Date().toISOString(),\n  },\n}];\n"
    },
    position: [5760, -96]
  },
  output: [{ notification_status: 'SENT', processing_status: 'IGNORED_TEST' }]
});

const markSilent = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Mark Silent Result',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const plan = $('Select Final Plan').first().json;\nreturn [{\n  json: {\n    ...plan,\n    notification_status: 'NOT_REQUIRED',\n    notified_at: '',\n    updated_at: new Date().toISOString(),\n  },\n}];\n"
    },
    position: [5520, 144]
  },
  output: [{ notification_status: 'NOT_REQUIRED', processing_status: 'APPLIED' }]
});

const finalizeNotified = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Finalize Notified Event',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_4", cachedResultName: "outreach_inbound_events_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "dedupe_key", condition: 'eq', keyValue: expr('{{ $json.dedupe_key }}') }] },
      columns: { mappingMode: 'defineBelow', value: {
  event_id: expr('{{ $json.event_id }}'),
  dedupe_key: expr('{{ $json.dedupe_key }}'),
  event_type: expr('{{ $json.event_type }}'),
  reply_intent: expr('{{ $json.reply_intent }}'),
  match_method: expr('{{ $json.match_method }}'),
  match_confidence: expr('{{ $json.match_confidence }}'),
  review_id: expr('{{ $json.review_id }}'),
  contact_key: expr('{{ $json.contact_key }}'),
  campaign_version: expr('{{ $json.campaign_version }}'),
  batch_id: expr('{{ $json.batch_id }}'),
  item_key: expr('{{ $json.item_key }}'),
  outbound_provider_message_id: expr('{{ $json.outbound_provider_message_id }}'),
  send_mode: expr('{{ $json.send_mode }}'),
  intended_recipient: expr('{{ $json.intended_recipient }}'),
  actual_send_to: expr('{{ $json.actual_send_to }}'),
  is_test: expr('{{ $json.is_test }}'),
  planned_action: expr('{{ $json.planned_action }}'),
  action_applied: expr('{{ $json.action_applied }}'),
  processing_status: expr('{{ $json.processing_status }}'),
  notification_status: expr('{{ $json.notification_status }}'),
  notified_at: expr('{{ $json.notified_at || null }}'),
  execution_id: expr('{{ $execution.id }}'),
  last_error_code: expr('{{ $json.last_error_code || "" }}'),
  last_error_message: expr('{{ $json.last_error_message || "" }}'),
  updated_at: expr('{{ $now.toISO() }}')
}, matchingColumns: [] },
      options: {}
    },
    position: [6000, -96]
  },
  output: [{ event_id: 'outreach@example.com::mid:<inbound@example.com>', processing_status: 'IGNORED_TEST' }]
});

const finalizeSilent = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Finalize Silent Event',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'list', value: "EXAMPLE_TABLE_4", cachedResultName: "outreach_inbound_events_v3" },
      matchType: 'allConditions', filters: { conditions: [{ keyName: "dedupe_key", condition: 'eq', keyValue: expr('{{ $json.dedupe_key }}') }] },
      columns: { mappingMode: 'defineBelow', value: {
  event_id: expr('{{ $json.event_id }}'),
  dedupe_key: expr('{{ $json.dedupe_key }}'),
  event_type: expr('{{ $json.event_type }}'),
  reply_intent: expr('{{ $json.reply_intent }}'),
  match_method: expr('{{ $json.match_method }}'),
  match_confidence: expr('{{ $json.match_confidence }}'),
  review_id: expr('{{ $json.review_id }}'),
  contact_key: expr('{{ $json.contact_key }}'),
  campaign_version: expr('{{ $json.campaign_version }}'),
  batch_id: expr('{{ $json.batch_id }}'),
  item_key: expr('{{ $json.item_key }}'),
  outbound_provider_message_id: expr('{{ $json.outbound_provider_message_id }}'),
  send_mode: expr('{{ $json.send_mode }}'),
  intended_recipient: expr('{{ $json.intended_recipient }}'),
  actual_send_to: expr('{{ $json.actual_send_to }}'),
  is_test: expr('{{ $json.is_test }}'),
  planned_action: expr('{{ $json.planned_action }}'),
  action_applied: expr('{{ $json.action_applied }}'),
  processing_status: expr('{{ $json.processing_status }}'),
  notification_status: expr('{{ $json.notification_status }}'),
  notified_at: expr('{{ $json.notified_at || null }}'),
  execution_id: expr('{{ $execution.id }}'),
  last_error_code: expr('{{ $json.last_error_code || "" }}'),
  last_error_message: expr('{{ $json.last_error_message || "" }}'),
  updated_at: expr('{{ $now.toISO() }}')
}, matchingColumns: [] },
      options: {}
    },
    position: [5760, 144]
  },
  output: [{ event_id: 'outreach@example.com::mid:<inbound@example.com>', processing_status: 'APPLIED' }]
});

const activationNote = sticky(
  '## LIVE enforcement\nZoho IMAP is connected and the real TEST reply passed. `shadowMode=false` is enabled for exact, authoritative LIVE matches only.\n\nTEST batches, identity mismatches, ambiguous matches, and unsent items never mutate production state. Monitor every pilot execution; downstream write failures require manual reconciliation.',
  [inbox, normalize, newEventOnly, startAudit],
  { color: 5 }
);

const candidateFlow = hasCandidates
  .onTrue(candidatesPresent.to(readBatches))
  .onFalse(noCandidates.to(readBatches));
const batchFlow = hasBatches
  .onTrue(correlate)
  .onFalse(correlate);
const notificationFlow = routeNotification
  .onCase(0, notifySlack.to(markNotification).to(finalizeNotified))
  .onCase(1, markSilent.to(finalizeSilent));
const finalPlanFlow = selectFinalPlan.to(notificationFlow);
const confirmedMutationFlow = confirmMutation.to(finalPlanFlow);
const projectionFlow = updateEngagement.to(
  projectionFound
    .onTrue(confirmedMutationFlow)
    .onFalse(confirmedMutationFlow)
);
const controlFlow = readExistingControl
  .to(resolveControl)
  .to(upsertControl)
  .to(mirrorControl)
  .to(blockPending)
  .to(
    pendingFound
      .onTrue(projectionFlow)
      .onFalse(projectionFlow)
  );
const mutationFlow = routeMutation
  .onCase(0, controlFlow)
  .onCase(1, projectionFlow)
  .onCase(2, finalPlanFlow);

export default workflow('nunoon-inbound-v3', 'Nunoon - Inbound Reply & Bounce Guard v3')
  .add(inbox)
  .to(normalize)
  .to(newEventOnly)
  .to(startAudit)
  .to(readCandidates)
  .to(candidateFlow)
  .add(readBatches)
  .to(batchFlow)
  .add(correlate)
  .to(persistPlan)
  .to(mutationFlow)
  .add(activationNote);
