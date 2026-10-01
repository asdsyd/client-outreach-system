const DRAFT_HASH_SCHEMA = 'outreach-draft-hash.v1';
const UPDATED_BY = 'n8n:copy-refresh-v2';
const FALLBACK_SENDER = 'Demo Sender | IAWebDevelopment × Nunoon';

function text(value) {
  return String(value ?? '');
}

function normalizeEmail(value) {
  return text(value).trim().toLowerCase();
}

function normalizeSubject(value) {
  return text(value).replace(/\s+/g, ' ').trim();
}

function normalizeBody(value) {
  return text(value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

function cleanDetails(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => text(value).trim())
    .filter(Boolean);
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(text(value));
  } catch {
    return fallback;
  }
}

function selectDetail(row) {
  const evidence = parseJson(row.research_sources_json, {});
  const services = cleanDetails(evidence.services);
  const personalizationPoints = cleanDetails(evidence.personalization_points);
  const shortestFirst = (values) =>
    [...values].sort((left, right) => left.length - right.length);
  const concisePersonalization = shortestFirst(
    personalizationPoints.filter(
      (value) => value.length >= 20 && value.length <= 140,
    ),
  );
  const fallbackPersonalization = shortestFirst(
    personalizationPoints.filter((value) => value.length <= 220),
  );
  const detail =
    concisePersonalization[0] ??
    fallbackPersonalization[0] ??
    shortestFirst(services)[0];

  return {
    detail,
    usesPersonalization: personalizationPoints.includes(detail),
  };
}

function senderFor(row) {
  const body = normalizeBody(row.draft_body);
  const match =
    body.match(/(?:^|\n)Best,\s*\n([\s\S]+)$/i) ??
    body.match(/(?:^|\n)مع التحية،?\s*\n([\s\S]+)$/u);
  const sender = text(match?.[1]).trim();
  return sender.includes('IAWebDevelopment × Nunoon')
    ? sender
    : FALLBACK_SENDER;
}

function buildDraft(row) {
  const company = text(row.company_name).trim();
  const { detail, usesPersonalization } = selectDetail(row);
  if (!company || !detail) return null;

  const sender = senderFor(row);
  const isArabic = text(row.language).trim().toLowerCase() === 'ar';
  const hasClinicWebsite = Boolean(text(row.website).trim());
  const quotedDetail = usesPersonalization
    ? detail.replace(/[.!?…؟。]+$/u, '').trim()
    : detail;
  const draftSubject = isArabic
    ? `تقييم مجاني لـ ${company}`
    : `Free assessment for ${company}`;
  const englishHook = usesPersonalization
    ? `While reviewing ${company}’s ${hasClinicWebsite ? 'website' : 'online presence'}, this stood out: “${quotedDetail}.” It gave us a useful sense of how your team presents its care.`
    : `While reviewing ${company}’s ${hasClinicWebsite ? 'website' : 'online presence'}, “${quotedDetail}” stood out among the services you offer. It gave us a useful sense of how your team presents its care.`;
  const englishPositioning =
    'IAWebDevelopment × Nunoon would be glad to prepare a complimentary assessment of your follow-up, billing, collections, and revenue-cycle workflows—focused on practical opportunities without assuming any gaps already exist.';
  const arabicContext = hasClinicWebsite
    ? `لموقع ${company}`
    : `لحضور ${company} الرقمي`;
  const arabicHook = usesPersonalization
    ? `أثناء مراجعتنا ${arabicContext}، لفت انتباهنا هذا الجانب: «${quotedDetail}». وقد أعطانا ذلك صورة واضحة عن طريقة عرض فريقكم للرعاية.`
    : `أثناء مراجعتنا ${arabicContext}، لفتت انتباهنا خدمة «${quotedDetail}» ضمن الخدمات التي تقدمونها. وقد أعطانا ذلك صورة واضحة عن طريقة عرض فريقكم للرعاية.`;
  const arabicPositioning =
    'يسر IAWebDevelopment × Nunoon إعداد تقييم مجاني لعمليات المتابعة والفوترة والتحصيل ودورة الإيرادات لديكم، مع التركيز على الفرص العملية من دون افتراض وجود أي فجوات حالية.';
  const draftBody = isArabic
    ? `مرحباً فريق ${company}،

${arabicHook}

${arabicPositioning}

إذا كان ذلك مناسباً، يرجى الرد على هذه الرسالة وسأرسل لكم التقييم المجاني لاسترداد الإيرادات والمخصص لـ ${company}.

مع التحية،
${sender}`
    : `Hello ${company} team,

${englishHook}

${englishPositioning}

If this is relevant, reply to this email and I’ll send the free revenue-recovery assessment tailored to ${company}.

Best,
${sender}`;

  return {
    draft_subject: draftSubject,
    draft_body: draftBody,
  };
}

function sha256(input) {
  const bytes = new TextEncoder().encode(input);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(
    paddedLength - 8,
    Math.floor(bitLength / 0x100000000),
    false,
  );
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Uint32Array(64);
  const rotr = (value, bits) =>
    (value >>> bits) | (value << (32 - bits));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++) {
      w[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index++) {
      const s0 =
        rotr(w[index - 15], 7) ^
        rotr(w[index - 15], 18) ^
        (w[index - 15] >>> 3);
      const s1 =
        rotr(w[index - 2], 17) ^
        rotr(w[index - 2], 19) ^
        (w[index - 2] >>> 10);
      w[index] =
        (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let index = 0; index < 64; index++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + choice + k[index] + w[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  return h
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('');
}

function appendAudit(value, entry) {
  const parsed = parseJson(value, []);
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? [parsed]
      : [];
  return JSON.stringify([...entries, entry].slice(-50));
}

const now = new Date().toISOString();
const oldCopyPattern =
  /your public information|i noticed your clinic highlights|reply no|prefer not to receive|إيقاف/iu;
const allowedApprovals = new Set(['PENDING_APPROVAL', 'APPROVED']);
const output = [];

for (const item of $input.all()) {
  const row = item.json ?? {};
  const approvalStatus = text(row.approval_status).trim().toUpperCase();
  const batchStatus =
    text(row.batch_status).trim().toUpperCase() || 'UNBATCHED';
  const sendStatus =
    text(row.send_status).trim().toUpperCase() || 'UNSENT';
  const researchStatus = text(row.research_status).trim().toUpperCase();
  const currentBody = normalizeBody(row.draft_body);

  if (
    !text(row.review_id).trim() ||
    researchStatus !== 'RESEARCHED' ||
    !allowedApprovals.has(approvalStatus) ||
    batchStatus !== 'UNBATCHED' ||
    sendStatus !== 'UNSENT' ||
    !oldCopyPattern.test(currentBody)
  ) {
    continue;
  }

  const draft = buildDraft(row);
  if (!draft) continue;
  const canonical = {
    schema: DRAFT_HASH_SCHEMA,
    campaign_version: text(row.campaign_version).trim(),
    contact_key: text(row.contact_key).trim(),
    intended_recipient: normalizeEmail(
      row.intended_recipient ?? row.email,
    ),
    draft_subject: normalizeSubject(draft.draft_subject),
    draft_body: normalizeBody(draft.draft_body),
  };
  if (
    !canonical.campaign_version ||
    !canonical.contact_key ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      canonical.intended_recipient,
    )
  ) {
    continue;
  }

  const draftHash = sha256(JSON.stringify(canonical));
  const currentRevision = Number(row.draft_revision || 0);
  if (!Number.isInteger(currentRevision) || currentRevision < 0) {
    throw new Error(
      `COPY_REFRESH_INVALID_REVISION: review_id=${row.review_id}`,
    );
  }

  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...stored
  } = row;
  output.push({
    json: {
      ...stored,
      draft_subject: canonical.draft_subject,
      draft_body: canonical.draft_body,
      draft_revision: currentRevision + 1,
      draft_hash: draftHash,
      draft_hash_schema: DRAFT_HASH_SCHEMA,
      approval_status: 'PENDING_APPROVAL',
      approved_revision: 0,
      approved_hash: '',
      approved_by: '',
      approved_at: null,
      decision_reason: '',
      batch_id: '',
      batch_position: 0,
      batch_status: 'UNBATCHED',
      batch_confirmed_by: '',
      batch_confirmed_at: null,
      send_status: 'UNSENT',
      provider: '',
      provider_message_id: '',
      lock_token: '',
      locked_at: null,
      execution_id: text($execution.id),
      last_error_code: '',
      last_error_message: '',
      updated_by: UPDATED_BY,
      audit_json: appendAudit(row.audit_json, {
        event: 'DRAFT_COPY_REFRESH',
        from_revision: currentRevision,
        to_revision: currentRevision + 1,
        previous_approval_status: approvalStatus,
        changed_at: now,
        changed_by: UPDATED_BY,
      }),
      updated_at: now,
    },
  });
}

return output;
