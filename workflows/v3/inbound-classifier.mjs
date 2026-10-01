import { createHash } from 'node:crypto';

const DEFAULT_FALLBACK_MAX_AGE_DAYS = 30;

function text(value) {
  return String(value ?? '');
}

function payloadText(value, depth = 0) {
  if (value === null || value === undefined || depth > 6) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return text(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8');
  }
  if (
    typeof value === 'object' &&
    value.type === 'Buffer' &&
    Array.isArray(value.data)
  ) {
    return Buffer.from(value.data).toString('utf8');
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

export function normalizeEmail(value) {
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
  const candidate = bracketed?.[1] ?? raw.match(/[^\s<>,;]+@[^\s<>,;]+/)?.[0] ?? '';
  return candidate
    .replace(/^mailto:/i, '')
    .replace(/[)>.,;]+$/g, '')
    .trim()
    .toLowerCase();
}

export function normalizeMessageId(value) {
  const candidate = text(value).trim().match(/<([^<>\r\n]+)>/)?.[1] ??
    text(value).trim().split(/\s+/)[0] ??
    '';
  if (!candidate || !candidate.includes('@')) return '';
  return `<${candidate}>`;
}

export function extractMessageIds(value) {
  const raw = Array.isArray(value) ? value.join(' ') : text(value);
  const bracketed = [...raw.matchAll(/<([^<>\r\n]+)>/g)]
    .map((match) => normalizeMessageId(match[0]))
    .filter(Boolean);
  if (bracketed.length) return [...new Set(bracketed)];

  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map(normalizeMessageId)
        .filter(Boolean),
    ),
  ];
}

function normalizeHeaders(headers) {
  const output = new Map();

  if (Array.isArray(headers)) {
    for (const entry of headers) {
      const key = text(entry?.name ?? entry?.key).trim().toLowerCase();
      if (!key) continue;
      const value = entry?.value ?? entry?.line ?? '';
      output.set(key, [...(output.get(key) ?? []), text(value)]);
    }
    return output;
  }

  for (const [name, value] of Object.entries(headers ?? {})) {
    const key = text(name).trim().toLowerCase();
    if (!key) continue;
    const values = Array.isArray(value) ? value : [value];
    output.set(key, values.map(text));
  }
  return output;
}

function headerValues(message, name) {
  return normalizeHeaders(message?.headers).get(name.toLowerCase()) ?? [];
}

function firstHeader(message, name) {
  return headerValues(message, name)[0] ?? '';
}

function messageBody(message) {
  return text(
    message?.text ||
      message?.textPlain ||
      message?.body ||
      message?.plainText ||
      message?.html ||
      '',
  );
}

function stableHeaderString(headers) {
  return [...normalizeHeaders(headers).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, values]) => `${name}:${values.join('\n')}`)
    .join('\n');
}

export function buildEventKey(message) {
  const mailbox =
    normalizeEmail(message?.mailbox) ||
    text(message?.mailbox).trim().toLowerCase();
  if (!mailbox) throw new Error('INBOUND_MAILBOX_REQUIRED');
  const messageId = normalizeMessageId(
    message?.messageId || message?.message_id || firstHeader(message, 'message-id'),
  );
  if (messageId) return `${mailbox}::mid:${messageId}`;

  const uidValidity = text(
    message?.uidValidity ??
      message?.uid_validity ??
      message?.uidvalidity ??
      message?.attributes?.uidValidity ??
      message?.attributes?.uid_validity,
  ).trim();
  const imapUid = text(
    message?.uid ??
      message?.imapUid ??
      message?.imap_uid ??
      message?.attributes?.uid ??
      message?.attributes?.imapUid,
  ).trim();
  if (uidValidity && imapUid) {
    return `${mailbox}::imap:${uidValidity}:${imapUid}`;
  }

  const raw = payloadText(message?.raw ?? message?.rawMessage ?? message?.source);
  const hashSource =
    raw ||
    [
      text(message?.folder ?? message?.mailboxFolder ?? 'INBOX').trim() || 'INBOX',
      normalizeEmail(message?.from || firstHeader(message, 'from')),
      text(message?.to || firstHeader(message, 'to')).trim(),
      text(message?.subject || firstHeader(message, 'subject')).trim(),
      text(message?.date || firstHeader(message, 'date')).trim(),
      messageBody(message),
      [
        message?.dsn,
        message?.deliveryStatus,
        message?.delivery_status,
        message?.deliveryStatuses,
        message?.delivery_statuses,
      ]
        .map((value) => payloadText(value))
        .filter(Boolean)
        .join('\n'),
      stableHeaderString(message?.headers),
    ].join('\n---\n');
  const digest = createHash('sha256').update(hashSource).digest('hex');
  return `${mailbox}::sha256:${digest}`;
}

export function stripQuotedHistory(value) {
  const lines = text(value).replace(/\r\n?/g, '\n').split('\n');
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

    if (
      wrappedOnHeader ||
      /^-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}$/i.test(trimmed) ||
      /^_{5,}$/.test(trimmed) ||
      /^Begin forwarded message:\s*$/i.test(trimmed) ||
      /^From:\s+.+/i.test(trimmed) &&
        lines.slice(index + 1, index + 5).some((next) =>
          /^(?:Sent|Date|To|Subject):\s+/i.test(next.trim()),
        )
    ) {
      break;
    }

    if (/^>/.test(trimmed)) continue;
    if (/^--\s*$/.test(trimmed) || /^Sent from my (?:iPhone|iPad|Android)/i.test(trimmed)) {
      break;
    }
    kept.push(line);
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseDsnField(source, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text(source).match(new RegExp(`^${escaped}:\\s*(.+)$`, 'im'))?.[1]?.trim() ?? '';
}

export function extractDsn(message) {
  const headers = normalizeHeaders(message?.headers);
  const contentType = [
    text(message?.contentType),
    text(message?.content_type),
    ...(headers.get('content-type') ?? []),
  ]
    .join('; ')
    .toLowerCase();
  const dsnContainers = [
    message?.dsn,
    message?.deliveryStatus,
    message?.delivery_status,
    message?.deliveryStatuses,
    message?.delivery_statuses,
  ];
  const structured = (aliases) => {
    for (const container of dsnContainers) {
      const candidate = structuredValue(container, aliases);
      if (candidate) return candidate;
    }
    return '';
  };
  const source = [
    ...dsnContainers.map((value) => payloadText(value)),
    payloadText(message?.raw ?? message?.rawMessage ?? message?.source),
    messageBody(message),
  ].filter(Boolean).join('\n');

  const action = text(structured(['action']) || parseDsnField(source, 'Action'))
    .trim()
    .toLowerCase();
  const status = text(structured(['status']) || parseDsnField(source, 'Status')).trim();
  const finalRecipientRaw = text(
    structured([
      'finalRecipient',
      'final_recipient',
      'originalRecipient',
      'original_recipient',
      'recipient',
    ]) ||
      parseDsnField(source, 'Final-Recipient'),
  ).trim();
  const finalRecipient = normalizeEmail(finalRecipientRaw.replace(/^rfc822\s*;\s*/i, ''));
  const originalMessageId = normalizeMessageId(
    structured([
      'originalMessageId',
      'original_message_id',
      'original-message-id',
      'x-original-message-id',
    ]) ||
      parseDsnField(source, 'Original-Message-ID') ||
      parseDsnField(source, 'X-Original-Message-ID'),
  );
  const structural =
    /multipart\/report/.test(contentType) &&
      /report-type\s*=\s*["']?delivery-status/.test(contentType) ||
    Boolean(
      action &&
        status &&
        finalRecipient &&
        ['failed', 'delayed', 'delivered', 'relayed', 'expanded'].includes(action),
    ) ||
    Boolean(status && finalRecipient && /^[245]\./.test(status));

  return {
    structural,
    action,
    status,
    final_recipient: finalRecipient,
    original_message_id: originalMessageId,
    diagnostic_code: text(
      structured(['diagnosticCode', 'diagnostic_code']) ||
        parseDsnField(source, 'Diagnostic-Code'),
    ).trim(),
  };
}

function isAutoReply(message) {
  const autoSubmitted = firstHeader(message, 'auto-submitted').trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return true;

  return [
    'x-autoreply',
    'x-autorespond',
    'x-auto-response-suppress',
    'x-autoreply-from',
  ].some((name) => headerValues(message, name).some((value) => text(value).trim())) ||
    /\b(?:automatic reply|auto[- ]?reply|out of office)\b/i.test(
      text(message?.subject || firstHeader(message, 'subject')),
    );
}

function isOptOut(body) {
  const normalized = text(body)
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;

  return [
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
  ].some((pattern) => pattern.test(normalized));
}

function isInterested(body) {
  const normalized = text(body).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  return [
    /\byes\b.{0,80}\binterested\b/,
    /\bi(?:'m| am)\s+interested\b/,
    /\bplease\s+send\b.{0,80}\b(?:assessment|details|information|info)\b/,
    /\bsend\b.{0,40}\b(?:assessment|details|information|info)\b/,
    /\btell\s+me\s+more\b/,
    /\blet(?:'s| us)\s+(?:talk|schedule|discuss)\b/,
    /\bopen\s+to\s+(?:a\s+)?(?:call|chat|discussion)\b/,
    /^(?:yes|interested)\W*$/,
  ].some((pattern) => pattern.test(normalized));
}

export function classifyInboundContent(message) {
  const dsn = extractDsn(message);
  if (dsn.structural) {
    if (/^5\./.test(dsn.status)) {
      return { classification: 'BOUNCE_HARD', clean_body: '', dsn };
    }
    if (/^4\./.test(dsn.status)) {
      return { classification: 'BOUNCE_SOFT', clean_body: '', dsn };
    }
    return { classification: 'BOUNCE_OTHER', clean_body: '', dsn };
  }

  if (isAutoReply(message)) {
    return {
      classification: 'AUTO_REPLY',
      clean_body: '',
      dsn,
    };
  }

  const cleanBody = stripQuotedHistory(messageBody(message));
  if (isOptOut(cleanBody)) {
    return { classification: 'OPTOUT', clean_body: cleanBody, dsn };
  }
  if (isInterested(cleanBody)) {
    return { classification: 'INTERESTED', clean_body: cleanBody, dsn };
  }
  return { classification: 'HUMAN_OTHER', clean_body: cleanBody, dsn };
}

function inboundCorrelationIds(message, dsn) {
  const inReplyTo = extractMessageIds(
    message?.inReplyTo || message?.in_reply_to || headerValues(message, 'in-reply-to'),
  );
  const references = extractMessageIds(
    message?.references || headerValues(message, 'references'),
  );
  const original = [
    ...extractMessageIds(
      message?.originalMessageId ||
        message?.original_message_id ||
        headerValues(message, 'original-message-id'),
    ),
    ...extractMessageIds(dsn?.original_message_id),
  ];
  return { inReplyTo, references, original };
}

function isRecent(row, now, maxAgeDays) {
  const sentAt = Date.parse(text(row?.sent_at ?? row?.sentAt));
  if (!Number.isFinite(sentAt)) return false;
  const age = now.getTime() - sentAt;
  return age >= 0 && age <= maxAgeDays * 24 * 60 * 60 * 1000;
}

function correlationSummary(row) {
  if (!row) return null;
  return {
    review_id: text(row.review_id),
    contact_key: text(row.contact_key),
    batch_id: text(row.batch_id),
    item_key: text(row.item_key),
    campaign_version: text(row.campaign_version),
    company_name: text(row.company_name ?? row.company_name_snapshot),
    intended_recipient: normalizeEmail(row.intended_recipient ?? row.email),
    send_to: normalizeEmail(row.send_to),
    send_mode: text(row.send_mode).trim().toUpperCase(),
    provider_message_id: normalizeMessageId(row.provider_message_id),
    sent_at: text(row.sent_at),
    batch_status: text(row.batch_status),
    send_status: text(row.send_status ?? row.status),
  };
}

function correlationAuthorization(message, dsn, outbound) {
  const intendedRecipient = normalizeEmail(outbound?.intended_recipient);
  const actualSendTo = normalizeEmail(outbound?.send_to);
  const replySender = normalizeEmail(message?.from || firstHeader(message, 'from'));
  const dsnRecipient = normalizeEmail(dsn?.final_recipient);
  const isStructuralDsn = Boolean(dsn?.structural);
  const recipientFieldsMatch = Boolean(
    intendedRecipient &&
      actualSendTo &&
      intendedRecipient === actualSendTo,
  );
  const inboundIdentityMatches = Boolean(
    intendedRecipient &&
      (isStructuralDsn
        ? dsnRecipient && dsnRecipient === intendedRecipient
        : replySender && replySender === intendedRecipient),
  );
  return {
    matched_intended_recipient: intendedRecipient,
    control_email:
      recipientFieldsMatch && inboundIdentityMatches ? intendedRecipient : '',
    recipient_fields_match: recipientFieldsMatch,
    inbound_identity_match: inboundIdentityMatches,
  };
}

function correlationResult({
  message,
  dsn,
  method,
  authoritative,
  outbound,
}) {
  const summary = correlationSummary(outbound);
  const authorization = correlationAuthorization(message, dsn, summary);
  if (!authoritative || summary?.send_mode !== 'LIVE') {
    authorization.control_email = '';
  }
  return {
    matched: Boolean(summary),
    method,
    authoritative,
    ambiguous: false,
    outbound: summary,
    ...authorization,
  };
}

export function correlateOutbound(
  message,
  outboundRows,
  {
    dsn = extractDsn(message),
    now = new Date(),
    fallbackMaxAgeDays = DEFAULT_FALLBACK_MAX_AGE_DAYS,
  } = {},
) {
  const ids = inboundCorrelationIds(message, dsn);
  const ordered = [
    ['IN_REPLY_TO_PROVIDER_MESSAGE_ID', ids.inReplyTo],
    ['ORIGINAL_PROVIDER_MESSAGE_ID', ids.original],
    ['REFERENCES_PROVIDER_MESSAGE_ID', ids.references],
  ];

  for (const [method, candidates] of ordered) {
    if (!candidates.length) continue;
    const matches = (outboundRows ?? []).filter((row) => {
      const providerId = normalizeMessageId(row?.provider_message_id);
      return providerId && candidates.includes(providerId);
    });
    if (matches.length === 1) {
      return correlationResult({
        message,
        dsn,
        method,
        authoritative: true,
        outbound: matches[0],
      });
    }
    if (matches.length > 1) {
      return {
        matched: false,
        method: 'AMBIGUOUS_PROVIDER_MESSAGE_ID',
        authoritative: false,
        ambiguous: true,
        outbound: null,
        control_email: '',
        recipient_fields_match: false,
        inbound_identity_match: false,
      };
    }
  }

  const fallbackIdentity =
    normalizeEmail(dsn?.final_recipient) ||
    normalizeEmail(message?.from || firstHeader(message, 'from'));
  if (fallbackIdentity) {
    const matches = (outboundRows ?? []).filter(
      (row) =>
        isRecent(row, now, fallbackMaxAgeDays) &&
        text(row?.send_status ?? row?.status).trim().toUpperCase() === 'SENT' &&
        [normalizeEmail(row?.send_to), normalizeEmail(row?.intended_recipient)]
          .filter(Boolean)
          .includes(fallbackIdentity),
    );
    if (matches.length === 1) {
      return correlationResult({
        message,
        dsn,
        method: 'SENDER_EMAIL_UNIQUE_RECENT',
        authoritative: false,
        outbound: matches[0],
      });
    }
    if (matches.length > 1) {
      return {
        matched: false,
        method: 'AMBIGUOUS_SENDER_EMAIL',
        authoritative: false,
        ambiguous: true,
        outbound: null,
        control_email: '',
        recipient_fields_match: false,
        inbound_identity_match: false,
      };
    }
  }

  return {
    matched: false,
    method: 'NONE',
    authoritative: false,
    ambiguous: false,
    outbound: null,
    control_email: '',
    recipient_fields_match: false,
    inbound_identity_match: false,
  };
}

function notificationFor(classification, correlation, executionMode) {
  if (classification === 'AUTO_REPLY' || classification === 'DUPLICATE') {
    return { should_notify: false, kind: 'NONE', severity: 'NONE', prefix: '' };
  }

  const outboundMode = correlation?.outbound?.send_mode;
  const test = executionMode === 'TEST' || outboundMode === 'TEST';
  const prefix = test ? '[TEST] ' : '';
  const mapping = {
    INTERESTED: ['INTERESTED_REPLY', 'INFO'],
    OPTOUT: ['OPTOUT', 'INFO'],
    BOUNCE_HARD: ['HARD_BOUNCE', 'WARNING'],
    BOUNCE_SOFT: ['SOFT_BOUNCE', 'WARNING'],
    BOUNCE_OTHER: ['BOUNCE_REVIEW', 'WARNING'],
    HUMAN_OTHER: ['MANUAL_REPLY_REVIEW', 'INFO'],
    UNMATCHED: ['UNMATCHED_INBOUND', 'WARNING'],
  };
  const [kind, severity] = mapping[classification] ?? ['MANUAL_REVIEW', 'WARNING'];
  return { should_notify: true, kind, severity, prefix };
}

function suppressionReason(classification, status) {
  if (classification === 'OPTOUT') return 'INBOUND_OPTOUT';
  return `HARD_BOUNCE_${text(status).trim() || '5XX'}`;
}

function planAction({
  classification,
  correlation,
  executionMode,
  dsn,
  processedAt,
  shadowMode,
}) {
  let controlType = '';
  let reasonCode = '';
  let permanent = false;
  if (['INTERESTED', 'HUMAN_OTHER'].includes(classification)) {
    controlType = 'HOLD';
    reasonCode = 'HUMAN_REPLY_REVIEW';
  } else if (classification === 'OPTOUT') {
    controlType = 'SUPPRESS';
    reasonCode = 'OPT_OUT';
    permanent = true;
  } else if (classification === 'BOUNCE_HARD') {
    controlType = 'SUPPRESS';
    reasonCode = 'HARD_BOUNCE';
    permanent = true;
  }

  const canUpdateEngagement = [
    'INTERESTED',
    'HUMAN_OTHER',
    'OPTOUT',
    'BOUNCE_HARD',
    'BOUNCE_SOFT',
    'AUTO_REPLY',
  ].includes(classification);
  const plannedAction = controlType || (canUpdateEngagement ? 'UPDATE_ENGAGEMENT' : 'NONE');
  const noMutation = (reason, planned = plannedAction) => ({
    planned_action: planned,
    control_type: controlType,
    control_email: correlation.control_email ?? '',
    permanent,
    action_applied: false,
    reason,
    queue_patch: null,
    control_record: null,
    engagement_patch: null,
    mutation_route: 2,
  });

  if (!correlation.matched) {
    if (classification === 'AUTO_REPLY') return noMutation('AUTO_REPLY_NO_ACTION', 'NONE');
    return noMutation(
      correlation.ambiguous ? 'AMBIGUOUS_OUTBOUND' : 'UNMATCHED_OUTBOUND',
      'MANUAL_REVIEW',
    );
  }
  if (!correlation.authoritative) {
    return noMutation('NON_AUTHORITATIVE_CORRELATION', 'MANUAL_REVIEW');
  }

  const outbound = correlation.outbound ?? {};
  const outboundMode = text(outbound.send_mode).trim().toUpperCase();
  if (executionMode !== 'LIVE' || outboundMode !== 'LIVE') {
    return noMutation('TEST_MODE_NO_MUTATION');
  }
  if (!correlation.recipient_fields_match || !correlation.inbound_identity_match) {
    return noMutation('RECIPIENT_IDENTITY_MISMATCH', 'MANUAL_REVIEW');
  }
  if (
    text(outbound.send_status).trim().toUpperCase() !== 'SENT' ||
    text(outbound.batch_status).trim().toUpperCase() !== 'COMPLETE'
  ) {
    return noMutation('DELIVERY_NOT_LIVE_COMPLETE', 'MANUAL_REVIEW');
  }
  if (shadowMode) {
    return noMutation('SHADOW_MODE_NO_MUTATION');
  }

  if (!canUpdateEngagement) {
    return {
      ...noMutation('NON_MUTATING_CLASS'),
      planned_action: 'NONE',
    };
  }

  return {
    planned_action: plannedAction,
    control_type: controlType,
    control_email: correlation.control_email,
    permanent,
    action_applied: false,
    reason: 'MUTATION_PLANNED',
    queue_patch: null,
    mutation_route: controlType ? 0 : 1,
    control_record: controlType
      ? {
          email: correlation.control_email,
          control_type: controlType,
          reason_code:
            classification === 'BOUNCE_HARD'
              ? suppressionReason(classification, dsn?.status)
              : reasonCode,
          permanent,
          source: 'INBOUND',
          updated_by: 'n8n:inbound-v3',
          updated_at: processedAt,
        }
      : null,
    engagement_patch: {
      review_id: outbound.review_id,
      engagement_status:
        classification === 'OPTOUT'
          ? 'OPTED_OUT'
          : classification === 'BOUNCE_HARD'
            ? 'HARD_BOUNCE'
            : classification,
      last_inbound_type: classification,
      engagement_updated_by: 'n8n:inbound-v3',
      engagement_updated_at: processedAt,
    },
  };
}

function duplicateAction() {
  return {
    planned_action: 'NONE',
    control_type: '',
    control_email: '',
    permanent: false,
    action_applied: false,
    reason: 'DUPLICATE_EVENT',
    queue_patch: null,
    control_record: null,
    engagement_patch: null,
    mutation_route: 2,
  };
}

export function evaluateInbound(
  message,
  {
    outboundRows = [],
    existingEventKeys = new Set(),
    executionMode = 'TEST',
    processedAt = '1970-01-01T00:00:00.000Z',
    now = new Date(processedAt),
    fallbackMaxAgeDays = DEFAULT_FALLBACK_MAX_AGE_DAYS,
    shadowMode = true,
  } = {},
) {
  const mode = text(executionMode).trim().toUpperCase();
  if (!['TEST', 'LIVE'].includes(mode)) {
    throw new Error('INBOUND_MODE_INVALID');
  }

  const eventKey = buildEventKey(message);
  if (existingEventKeys.has(eventKey)) {
    return {
      event_key: eventKey,
      duplicate: true,
      classification: 'DUPLICATE',
      content_classification: 'DUPLICATE',
      clean_body: '',
      dsn: { structural: false, action: '', status: '', final_recipient: '', original_message_id: '' },
      correlation: {
        matched: false,
        method: 'NOT_EVALUATED_DUPLICATE',
        authoritative: false,
        ambiguous: false,
        outbound: null,
        control_email: '',
        recipient_fields_match: false,
        inbound_identity_match: false,
      },
      notification: notificationFor('DUPLICATE', null, mode),
      action: duplicateAction(),
    };
  }

  const content = classifyInboundContent(message);
  const correlation = correlateOutbound(message, outboundRows, {
    dsn: content.dsn,
    now,
    fallbackMaxAgeDays,
  });
  const classification =
    correlation.matched ||
    content.dsn.structural ||
    content.classification === 'AUTO_REPLY'
    ? content.classification
    : 'UNMATCHED';
  const action = planAction({
    classification,
    correlation,
    executionMode: mode,
    dsn: content.dsn,
    processedAt,
    shadowMode: Boolean(shadowMode),
  });

  return {
    event_key: eventKey,
    duplicate: false,
    classification,
    content_classification: content.classification,
    clean_body: content.clean_body,
    dsn: content.dsn,
    correlation,
    notification: notificationFor(classification, correlation, mode),
    action,
  };
}

export function evaluateInboundBatch(
  messages,
  {
    outboundRows = [],
    existingEventKeys = [],
    executionMode = 'TEST',
    processedAt = '1970-01-01T00:00:00.000Z',
    now = new Date(processedAt),
    fallbackMaxAgeDays = DEFAULT_FALLBACK_MAX_AGE_DAYS,
    shadowMode = true,
  } = {},
) {
  const seen = new Set(existingEventKeys);
  const results = [];
  const ledgerEntries = [];

  for (const message of messages ?? []) {
    const result = evaluateInbound(message, {
      outboundRows,
      existingEventKeys: seen,
      executionMode,
      processedAt,
      now,
      fallbackMaxAgeDays,
      shadowMode,
    });
    results.push(result);
    if (!result.duplicate) {
      seen.add(result.event_key);
      ledgerEntries.push({
        event_key: result.event_key,
        classification: result.classification,
        match_method: result.correlation.method,
        action_applied: result.action.action_applied,
        processed_at: processedAt,
      });
    }
  }

  return { results, ledgerEntries };
}
