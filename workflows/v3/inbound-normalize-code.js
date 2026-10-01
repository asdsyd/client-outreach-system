const input = $input.first().json ?? {};
const text = (value) => String(value ?? '');

function utf8Bytes(value) {
  const bytes = [];
  for (const character of text(value)) {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

function sha256(value) {
  const bytes = utf8Bytes(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (const shift of [24, 16, 8, 0]) bytes.push((high >>> shift) & 0xff);
  for (const shift of [24, 16, 8, 0]) bytes.push((low >>> shift) & 0xff);

  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const rotateRight = (number, bits) =>
    (number >>> bits) | (number << (32 - bits));

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array(64).fill(0);
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] =
        ((bytes[start] << 24) |
          (bytes[start + 1] << 16) |
          (bytes[start + 2] << 8) |
          bytes[start + 3]) >>>
        0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rotateRight(words[index - 15], 7) ^
        rotateRight(words[index - 15], 18) ^
        (words[index - 15] >>> 3);
      const s1 =
        rotateRight(words[index - 2], 17) ^
        rotateRight(words[index - 2], 19) ^
        (words[index - 2] >>> 10);
      words[index] =
        (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function decodeBytes(bytes) {
  let output = '';
  for (let index = 0; index < bytes.length; ) {
    const first = Number(bytes[index++]) & 0xff;
    if (first < 0x80) {
      output += String.fromCodePoint(first);
      continue;
    }
    const length = first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4;
    let codePoint = first & (0x7f >> length);
    let valid = true;
    for (let count = 1; count < length; count += 1) {
      const next = Number(bytes[index++]) & 0xff;
      if ((next & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    output += String.fromCodePoint(valid ? codePoint : 0xfffd);
  }
  return output;
}

function payloadText(value, depth = 0) {
  if (value === null || value === undefined || depth > 6) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return text(value);
  if (
    typeof value === 'object' &&
    value.type === 'Buffer' &&
    Array.isArray(value.data)
  ) {
    return decodeBytes(value.data);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => payloadText(entry, depth + 1)).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entry]) => {
        const rendered = payloadText(entry, depth + 1);
        return rendered ? `${key}: ${rendered}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return text(value);
}

function structuredValue(value, aliases, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6) return '';
  const normalizedAliases = new Set(
    aliases.map((alias) => alias.toLowerCase().replace(/[^a-z0-9]/g, '')),
  );
  const entries = Array.isArray(value)
    ? value.map((entry, index) => [text(index), entry])
    : Object.entries(value);
  for (const [key, entry] of entries) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      normalizedAliases.has(normalizedKey) &&
      entry !== null &&
      entry !== undefined &&
      typeof entry !== 'object'
    ) {
      const candidate = text(entry).trim();
      if (candidate) return candidate;
    }
  }
  for (const [, entry] of entries) {
    const nested = structuredValue(entry, aliases, depth + 1);
    if (nested) return nested;
  }
  return '';
}

function normalizeEmail(value) {
  function addressText(candidate, depth = 0) {
    if (candidate === null || candidate === undefined || depth > 5) return '';
    if (typeof candidate === 'string') return candidate;
    if (Array.isArray(candidate)) {
      return candidate
        .map((entry) => addressText(entry, depth + 1))
        .filter(Boolean)
        .join(' ');
    }
    if (typeof candidate === 'object') {
      for (const key of ['address', 'email']) {
        const direct = candidate[key];
        if (typeof direct === 'string' && direct.trim()) return direct;
      }
      for (const key of ['value', 'text', 'html']) {
        const nested = addressText(candidate[key], depth + 1);
        if (nested) return nested;
      }
      return '';
    }
    return text(candidate);
  }

  const raw = addressText(value).trim();
  const bracketed = raw.match(/<([^<>\s]+@[^<>\s]+)>/);
  const candidate =
    bracketed?.[1] ?? raw.match(/[^\s<>,;]+@[^\s<>,;]+/)?.[0] ?? '';
  return candidate.replace(/^mailto:/i, '').replace(/[)>.,;]+$/g, '').trim().toLowerCase();
}

function normalizeMessageId(value) {
  const raw = text(value).trim();
  const candidate = raw.match(/<([^<>\r\n]+)>/)?.[1] ?? raw.split(/\s+/)[0] ?? '';
  return candidate && candidate.includes('@') ? `<${candidate}>` : '';
}

function extractMessageIds(value) {
  const raw = Array.isArray(value) ? value.join(' ') : text(value);
  const bracketed = [...raw.matchAll(/<([^<>\r\n]+)>/g)]
    .map((match) => normalizeMessageId(match[0]))
    .filter(Boolean);
  if (bracketed.length) return [...new Set(bracketed)];
  return [...new Set(raw.split(/[\s,]+/).map(normalizeMessageId).filter(Boolean))];
}

function normalizeHeaders(headers) {
  const output = {};
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      const key = text(entry?.name ?? entry?.key).trim().toLowerCase();
      if (!key) continue;
      const value = text(entry?.value ?? entry?.line);
      output[key] = [...(output[key] ?? []), value];
    }
    return output;
  }
  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = text(name).trim().toLowerCase();
    if (!key) continue;
    output[key] = (Array.isArray(value) ? value : [value]).map(text);
  }
  return output;
}

const headers = normalizeHeaders(input.headers);
const header = (name) => headers[name.toLowerCase()]?.[0] ?? '';
const headerValues = (name) => headers[name.toLowerCase()] ?? [];
const body = text(
  input.text ??
    input.textPlain ??
    input.plainText ??
    input.body ??
    input.html ??
    '',
).replace(/\r\n?/g, '\n');

function stripQuotedHistory(value) {
  const lines = text(value).split('\n');
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    let wrappedOnHeader = false;
    if (/^On\b/i.test(trimmed)) {
      let joined = '';
      for (
        let offset = 0;
        offset < 4 && index + offset < lines.length;
        offset += 1
      ) {
        const next = lines[index + offset].trim();
        if (offset > 0 && /^>/.test(next)) break;
        joined = `${joined} ${next}`.trim();
        if (/\bwrote:\s*$/i.test(joined)) {
          wrappedOnHeader = true;
          break;
        }
      }
    }
    const quotedHeader =
      wrappedOnHeader ||
      /^-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}$/i.test(trimmed) ||
      /^Begin forwarded message:\s*$/i.test(trimmed) ||
      (/^From:\s+.+/i.test(trimmed) &&
        lines
          .slice(index + 1, index + 5)
          .some((next) => /^(?:Sent|Date|To|Subject):\s+/i.test(next.trim())));
    if (quotedHeader) break;
    if (/^>/.test(trimmed)) continue;
    if (/^--\s*$/.test(trimmed) || /^Sent from my (?:iPhone|iPad|Android)/i.test(trimmed)) {
      break;
    }
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const dsnContainers = [
  input.dsn,
  input.deliveryStatus,
  input.delivery_status,
  input.deliveryStatuses,
  input.delivery_statuses,
];
const rawMessage = payloadText(input.raw ?? input.rawMessage ?? input.source);
const dsnSource = [
  ...dsnContainers.map((value) => payloadText(value)),
  rawMessage,
  body,
]
  .filter(Boolean)
  .join('\n');
const firstStructuredDsnValue = (aliases) => {
  for (const container of dsnContainers) {
    const candidate = structuredValue(container, aliases);
    if (candidate) return candidate;
  }
  return '';
};

function dsnField(field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    dsnSource.match(new RegExp(`^${escaped}:\\s*(.+)$`, 'im'))?.[1]?.trim() ?? ''
  );
}

const contentType = [
  text(input.contentType),
  text(input.content_type),
  ...headerValues('content-type'),
].join('; ').toLowerCase();
const dsnAction = text(
  firstStructuredDsnValue(['action']) || dsnField('Action'),
)
  .trim()
  .toLowerCase();
const dsnStatus = text(
  firstStructuredDsnValue(['status']) || dsnField('Status'),
).trim();
const bounceRecipient = normalizeEmail(
  text(
    firstStructuredDsnValue([
      'finalRecipient',
      'final_recipient',
      'originalRecipient',
      'original_recipient',
      'recipient',
    ]) ||
      dsnField('Final-Recipient') ||
      dsnField('Original-Recipient') ||
      header('x-failed-recipients'),
  ).replace(/^rfc822\s*;\s*/i, ''),
);
const originalMessageId = normalizeMessageId(
  firstStructuredDsnValue([
    'originalMessageId',
    'original_message_id',
    'original-message-id',
    'x-original-message-id',
  ]) ||
    dsnField('Original-Message-ID') ||
    dsnField('X-Original-Message-ID') ||
    header('original-message-id'),
);
const structuralDsn =
  (/multipart\/report/.test(contentType) &&
    /report-type\s*=\s*["']?delivery-status/.test(contentType)) ||
  Boolean(
    dsnAction &&
      dsnStatus &&
      bounceRecipient &&
      ['failed', 'delayed', 'delivered', 'relayed', 'expanded'].includes(dsnAction),
  ) ||
  Boolean(dsnStatus && bounceRecipient && /^[245]\./.test(dsnStatus));

const autoSubmitted = header('auto-submitted').trim().toLowerCase();
const autoReply =
  (autoSubmitted && autoSubmitted !== 'no') ||
  ['x-autoreply', 'x-autorespond', 'x-auto-response-suppress', 'x-autoreply-from'].some(
    (name) => headerValues(name).some((value) => text(value).trim()),
  ) ||
  /\b(?:automatic reply|auto[- ]?reply|out of office)\b/i.test(
    text(input.subject ?? header('subject')),
  );

const cleanBody = stripQuotedHistory(body);
const normalizedBody = cleanBody
  .toLowerCase()
  .replace(/[’‘]/g, "'")
  .replace(/\s+/g, ' ')
  .trim();
const optOut = [
  /\bunsubscribe\b/,
  /\bopt[\s-]?out\b/,
  /\bremove\s+(?:me|us|my email|this email)\b/,
  /\btake\s+(?:me|us)\s+off\b/,
  /\bstop\s+(?:emailing|contacting|messaging|sending)\b/,
  /\bdo\s+not\s+(?:email|contact|message)\b/,
  /\bdon't\s+(?:email|contact|message)\b/,
  /\bnot\s+interested\b/,
  /\bno\s+thanks?\b/,
  /^(?:no|stop)\W*$/,
].some((pattern) => pattern.test(normalizedBody));
const interested = [
  /\byes\b.{0,80}\binterested\b/,
  /\bi(?:'m| am)\s+interested\b/,
  /\bplease\s+send\b.{0,80}\b(?:assessment|details|information|info)\b/,
  /\bsend\b.{0,40}\b(?:assessment|details|information|info)\b/,
  /\btell\s+me\s+more\b/,
  /\blet(?:'s| us)\s+(?:talk|schedule|discuss)\b/,
  /\bopen\s+to\s+(?:a\s+)?(?:call|chat|discussion)\b/,
  /^(?:yes|interested)\W*$/,
].some((pattern) => pattern.test(normalizedBody));

let eventType = 'HUMAN_REPLY';
let replyIntent = 'OTHER';
let classificationMethod = 'RULES';
let classificationConfidence = 0.8;
if (structuralDsn) {
  classificationMethod = 'HEADERS';
  classificationConfidence = 0.99;
  replyIntent = 'NONE';
  if (/^5\./.test(dsnStatus)) eventType = 'HARD_BOUNCE';
  else if (/^4\./.test(dsnStatus)) eventType = 'SOFT_BOUNCE';
  else eventType = 'UNKNOWN_BOUNCE';
} else if (autoReply) {
  eventType = 'AUTO_REPLY';
  replyIntent = 'NONE';
  classificationMethod = 'HEADERS';
  classificationConfidence = 0.98;
} else if (optOut) {
  eventType = 'OPT_OUT';
  replyIntent = 'NEGATIVE';
  classificationConfidence = 0.98;
} else if (interested) {
  eventType = 'INTERESTED';
  replyIntent = 'INTERESTED';
  classificationConfidence = 0.92;
} else if (/\?|\b(?:price|pricing|cost|how|what|when|where|assessment)\b/i.test(cleanBody)) {
  eventType = 'HUMAN_REPLY';
  replyIntent = 'QUESTION';
} else if (/\b(?:later|not now|next month|next quarter)\b/i.test(cleanBody)) {
  replyIntent = 'NOT_NOW';
} else if (/\b(?:no|decline|not a fit)\b/i.test(cleanBody)) {
  replyIntent = 'NEGATIVE';
}

const fromEmail = normalizeEmail(input.from ?? input.fromEmail ?? header('from'));
const toEmail = normalizeEmail(input.to ?? input.toEmail ?? header('to'));
const messageId = normalizeMessageId(
  input.messageId ?? input.message_id ?? header('message-id'),
);
const inReplyToIds = extractMessageIds(
  input.inReplyTo ?? input.in_reply_to ?? headerValues('in-reply-to'),
);
const referenceIds = extractMessageIds(
  input.references ?? headerValues('references'),
);
const correlationIds = [
  ...inReplyToIds,
  originalMessageId,
  ...referenceIds.slice().reverse(),
].filter(Boolean);
const lookupProviderMessageId =
  correlationIds[0] ?? `__NO_PROVIDER_MATCH__:${messageId || fromEmail || $execution.id}`;
const lookupEmail =
  eventType.includes('BOUNCE') && bounceRecipient ? bounceRecipient : fromEmail;

const receivedAtRaw = input.date ?? input.receivedAt ?? header('date');
const receivedAtDate = new Date(receivedAtRaw || Date.now());
const receivedAt = Number.isFinite(receivedAtDate.getTime())
  ? receivedAtDate.toISOString()
  : new Date().toISOString();
const mailbox = 'outreach@example.com';
const folder = text(input.folder ?? input.mailboxFolder ?? 'INBOX').trim() || 'INBOX';
const uidValidity = text(
  input.uidValidity ??
    input.uid_validity ??
    input.uidvalidity ??
    input.attributes?.uidValidity ??
    input.attributes?.uid_validity,
).trim();
const imapUid = text(
  input.uid ??
    input.imapUid ??
    input.imap_uid ??
    input.attributes?.uid ??
    input.attributes?.imapUid,
).trim();
const fallbackSource = [
  mailbox,
  folder,
  fromEmail,
  toEmail,
  text(input.subject ?? header('subject')).trim(),
  text(receivedAtRaw).trim(),
  body,
  dsnSource,
  Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name].join('\n')}`)
    .join('\n'),
].join('\n');
const bodyFingerprint = sha256(body);
const eventId = messageId
  ? `${mailbox}::mid:${messageId}`
  : uidValidity && imapUid
    ? `${mailbox}::imap:${uidValidity}:${imapUid}`
    : `${mailbox}::sha256:${sha256(fallbackSource)}`;
const allowlistedHeaders = {};
for (const name of [
  'message-id',
  'in-reply-to',
  'references',
  'auto-submitted',
  'content-type',
  'original-message-id',
  'x-failed-recipients',
]) {
  if (headers[name]?.length) allowlistedHeaders[name] = headers[name].slice(0, 10);
}

return [{
  json: {
    event_id: eventId,
    dedupe_key: eventId,
    mailbox,
    folder,
    uid_validity: uidValidity,
    imap_uid: imapUid,
    message_id: messageId,
    in_reply_to: inReplyToIds[0] ?? '',
    references_json: JSON.stringify(referenceIds.slice(0, 20)),
    correlation_ids: correlationIds,
    lookup_provider_message_id: lookupProviderMessageId,
    lookup_email: lookupEmail,
    from_email: fromEmail,
    to_email: toEmail,
    subject: text(input.subject ?? header('subject')).trim().slice(0, 500),
    received_at: receivedAt,
    body_excerpt: cleanBody.slice(0, 500),
    body_fingerprint: bodyFingerprint,
    headers_json: JSON.stringify(allowlistedHeaders).slice(0, 5000),
    event_type: eventType,
    reply_intent: replyIntent,
    classification_method: classificationMethod,
    classification_confidence: classificationConfidence,
    dsn_action: dsnAction,
    dsn_status: dsnStatus,
    dsn_diagnostic: text(
      firstStructuredDsnValue(['diagnosticCode', 'diagnostic_code']) ||
        dsnField('Diagnostic-Code'),
    ).slice(0, 500),
    bounce_recipient: bounceRecipient,
    execution_id: String($execution.id),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
}];
