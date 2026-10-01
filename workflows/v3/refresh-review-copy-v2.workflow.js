import {
  workflow,
  node,
  trigger,
  expr
} from '@n8n/workflow-sdk';

const manualCopyRefresh = trigger({
  type: 'n8n-nodes-base.manualTrigger',
  version: 1,
  config: {
    name: 'Manual Copy Refresh',
    parameters: {},
    position: [0, 0]
  },
  output: [{}]
});

const readReviewQueue = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Read Review Queue',
    parameters: {
      resource: 'row',
      operation: 'get',
      dataTableId: {
        __rl: true,
        mode: 'list',
        value: 'EXAMPLE_TABLE_1',
        cachedResultName: 'outreach_review_queue_v3'
      },
      returnAll: true
    },
    executeOnce: true,
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    position: [240, 0]
  },
  output: [{
    review_id: 'rvw_example',
    research_status: 'RESEARCHED',
    approval_status: 'PENDING_APPROVAL',
    batch_status: 'UNBATCHED',
    send_status: 'UNSENT'
  }]
});

const prepareSafeCopyRefresh = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Prepare Safe Copy Refresh',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: "const DRAFT_HASH_SCHEMA = 'outreach-draft-hash.v1';\nconst UPDATED_BY = 'n8n:copy-refresh-v2';\nconst FALLBACK_SENDER = 'Demo Sender | IAWebDevelopment × Nunoon';\n\nfunction text(value) {\n  return String(value ?? '');\n}\n\nfunction normalizeEmail(value) {\n  return text(value).trim().toLowerCase();\n}\n\nfunction normalizeSubject(value) {\n  return text(value).replace(/\\s+/g, ' ').trim();\n}\n\nfunction normalizeBody(value) {\n  return text(value)\n    .replace(/\\r\\n?/g, '\\n')\n    .split('\\n')\n    .map((line) => line.replace(/[ \\t]+$/g, ''))\n    .join('\\n')\n    .trim();\n}\n\nfunction cleanDetails(values) {\n  return (Array.isArray(values) ? values : [])\n    .map((value) => text(value).trim())\n    .filter(Boolean);\n}\n\nfunction parseJson(value, fallback) {\n  if (value && typeof value === 'object') return value;\n  try {\n    return JSON.parse(text(value));\n  } catch {\n    return fallback;\n  }\n}\n\nfunction selectDetail(row) {\n  const evidence = parseJson(row.research_sources_json, {});\n  const services = cleanDetails(evidence.services);\n  const personalizationPoints = cleanDetails(evidence.personalization_points);\n  const shortestFirst = (values) =>\n    [...values].sort((left, right) => left.length - right.length);\n  const concisePersonalization = shortestFirst(\n    personalizationPoints.filter(\n      (value) => value.length >= 20 && value.length <= 140,\n    ),\n  );\n  const fallbackPersonalization = shortestFirst(\n    personalizationPoints.filter((value) => value.length <= 220),\n  );\n  const detail =\n    concisePersonalization[0] ??\n    fallbackPersonalization[0] ??\n    shortestFirst(services)[0];\n\n  return {\n    detail,\n    usesPersonalization: personalizationPoints.includes(detail),\n  };\n}\n\nfunction senderFor(row) {\n  const body = normalizeBody(row.draft_body);\n  const match =\n    body.match(/(?:^|\\n)Best,\\s*\\n([\\s\\S]+)$/i) ??\n    body.match(/(?:^|\\n)مع التحية،?\\s*\\n([\\s\\S]+)$/u);\n  const sender = text(match?.[1]).trim();\n  return sender.includes('IAWebDevelopment × Nunoon')\n    ? sender\n    : FALLBACK_SENDER;\n}\n\nfunction buildDraft(row) {\n  const company = text(row.company_name).trim();\n  const { detail, usesPersonalization } = selectDetail(row);\n  if (!company || !detail) return null;\n\n  const sender = senderFor(row);\n  const isArabic = text(row.language).trim().toLowerCase() === 'ar';\n  const hasClinicWebsite = Boolean(text(row.website).trim());\n  const quotedDetail = usesPersonalization\n    ? detail.replace(/[.!?…؟。]+$/u, '').trim()\n    : detail;\n  const draftSubject = isArabic\n    ? `تقييم مجاني لـ ${company}`\n    : `Free assessment for ${company}`;\n  const englishHook = usesPersonalization\n    ? `While reviewing ${company}’s ${hasClinicWebsite ? 'website' : 'online presence'}, this stood out: “${quotedDetail}.” It gave us a useful sense of how your team presents its care.`\n    : `While reviewing ${company}’s ${hasClinicWebsite ? 'website' : 'online presence'}, “${quotedDetail}” stood out among the services you offer. It gave us a useful sense of how your team presents its care.`;\n  const englishPositioning =\n    'IAWebDevelopment × Nunoon would be glad to prepare a complimentary assessment of your follow-up, billing, collections, and revenue-cycle workflows—focused on practical opportunities without assuming any gaps already exist.';\n  const arabicContext = hasClinicWebsite\n    ? `لموقع ${company}`\n    : `لحضور ${company} الرقمي`;\n  const arabicHook = usesPersonalization\n    ? `أثناء مراجعتنا ${arabicContext}، لفت انتباهنا هذا الجانب: «${quotedDetail}». وقد أعطانا ذلك صورة واضحة عن طريقة عرض فريقكم للرعاية.`\n    : `أثناء مراجعتنا ${arabicContext}، لفتت انتباهنا خدمة «${quotedDetail}» ضمن الخدمات التي تقدمونها. وقد أعطانا ذلك صورة واضحة عن طريقة عرض فريقكم للرعاية.`;\n  const arabicPositioning =\n    'يسر IAWebDevelopment × Nunoon إعداد تقييم مجاني لعمليات المتابعة والفوترة والتحصيل ودورة الإيرادات لديكم، مع التركيز على الفرص العملية من دون افتراض وجود أي فجوات حالية.';\n  const draftBody = isArabic\n    ? `مرحباً فريق ${company}،\n\n${arabicHook}\n\n${arabicPositioning}\n\nإذا كان ذلك مناسباً، يرجى الرد على هذه الرسالة وسأرسل لكم التقييم المجاني لاسترداد الإيرادات والمخصص لـ ${company}.\n\nمع التحية،\n${sender}`\n    : `Hello ${company} team,\n\n${englishHook}\n\n${englishPositioning}\n\nIf this is relevant, reply to this email and I’ll send the free revenue-recovery assessment tailored to ${company}.\n\nBest,\n${sender}`;\n\n  return {\n    draft_subject: draftSubject,\n    draft_body: draftBody,\n  };\n}\n\nfunction sha256(input) {\n  const bytes = new TextEncoder().encode(input);\n  const bitLength = bytes.length * 8;\n  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;\n  const padded = new Uint8Array(paddedLength);\n  padded.set(bytes);\n  padded[bytes.length] = 0x80;\n  const view = new DataView(padded.buffer);\n  view.setUint32(\n    paddedLength - 8,\n    Math.floor(bitLength / 0x100000000),\n    false,\n  );\n  view.setUint32(paddedLength - 4, bitLength >>> 0, false);\n\n  const k = [\n    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,\n    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,\n    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,\n    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,\n    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,\n    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,\n    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,\n    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,\n    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,\n    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,\n    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,\n    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,\n    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,\n    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,\n    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,\n    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,\n  ];\n  const h = [\n    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,\n    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,\n  ];\n  const w = new Uint32Array(64);\n  const rotr = (value, bits) =>\n    (value >>> bits) | (value << (32 - bits));\n\n  for (let offset = 0; offset < paddedLength; offset += 64) {\n    for (let index = 0; index < 16; index++) {\n      w[index] = view.getUint32(offset + index * 4, false);\n    }\n    for (let index = 16; index < 64; index++) {\n      const s0 =\n        rotr(w[index - 15], 7) ^\n        rotr(w[index - 15], 18) ^\n        (w[index - 15] >>> 3);\n      const s1 =\n        rotr(w[index - 2], 17) ^\n        rotr(w[index - 2], 19) ^\n        (w[index - 2] >>> 10);\n      w[index] =\n        (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;\n    }\n\n    let [a, b, c, d, e, f, g, hh] = h;\n    for (let index = 0; index < 64; index++) {\n      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);\n      const choice = (e & f) ^ (~e & g);\n      const temp1 = (hh + s1 + choice + k[index] + w[index]) >>> 0;\n      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);\n      const majority = (a & b) ^ (a & c) ^ (b & c);\n      const temp2 = (s0 + majority) >>> 0;\n      hh = g;\n      g = f;\n      f = e;\n      e = (d + temp1) >>> 0;\n      d = c;\n      c = b;\n      b = a;\n      a = (temp1 + temp2) >>> 0;\n    }\n\n    h[0] = (h[0] + a) >>> 0;\n    h[1] = (h[1] + b) >>> 0;\n    h[2] = (h[2] + c) >>> 0;\n    h[3] = (h[3] + d) >>> 0;\n    h[4] = (h[4] + e) >>> 0;\n    h[5] = (h[5] + f) >>> 0;\n    h[6] = (h[6] + g) >>> 0;\n    h[7] = (h[7] + hh) >>> 0;\n  }\n\n  return h\n    .map((value) => value.toString(16).padStart(8, '0'))\n    .join('');\n}\n\nfunction appendAudit(value, entry) {\n  const parsed = parseJson(value, []);\n  const entries = Array.isArray(parsed)\n    ? parsed\n    : parsed && typeof parsed === 'object'\n      ? [parsed]\n      : [];\n  return JSON.stringify([...entries, entry].slice(-50));\n}\n\nconst now = new Date().toISOString();\nconst oldCopyPattern =\n  /your public information|i noticed your clinic highlights|reply no|prefer not to receive|إيقاف/iu;\nconst allowedApprovals = new Set(['PENDING_APPROVAL', 'APPROVED']);\nconst output = [];\n\nfor (const item of $input.all()) {\n  const row = item.json ?? {};\n  const approvalStatus = text(row.approval_status).trim().toUpperCase();\n  const batchStatus =\n    text(row.batch_status).trim().toUpperCase() || 'UNBATCHED';\n  const sendStatus =\n    text(row.send_status).trim().toUpperCase() || 'UNSENT';\n  const researchStatus = text(row.research_status).trim().toUpperCase();\n  const currentBody = normalizeBody(row.draft_body);\n\n  if (\n    !text(row.review_id).trim() ||\n    researchStatus !== 'RESEARCHED' ||\n    !allowedApprovals.has(approvalStatus) ||\n    batchStatus !== 'UNBATCHED' ||\n    sendStatus !== 'UNSENT' ||\n    !oldCopyPattern.test(currentBody)\n  ) {\n    continue;\n  }\n\n  const draft = buildDraft(row);\n  if (!draft) continue;\n  const canonical = {\n    schema: DRAFT_HASH_SCHEMA,\n    campaign_version: text(row.campaign_version).trim(),\n    contact_key: text(row.contact_key).trim(),\n    intended_recipient: normalizeEmail(\n      row.intended_recipient ?? row.email,\n    ),\n    draft_subject: normalizeSubject(draft.draft_subject),\n    draft_body: normalizeBody(draft.draft_body),\n  };\n  if (\n    !canonical.campaign_version ||\n    !canonical.contact_key ||\n    !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(\n      canonical.intended_recipient,\n    )\n  ) {\n    continue;\n  }\n\n  const draftHash = sha256(JSON.stringify(canonical));\n  const currentRevision = Number(row.draft_revision || 0);\n  if (!Number.isInteger(currentRevision) || currentRevision < 0) {\n    throw new Error(\n      `COPY_REFRESH_INVALID_REVISION: review_id=${row.review_id}`,\n    );\n  }\n\n  const {\n    id: _id,\n    createdAt: _createdAt,\n    updatedAt: _updatedAt,\n    ...stored\n  } = row;\n  output.push({\n    json: {\n      ...stored,\n      draft_subject: canonical.draft_subject,\n      draft_body: canonical.draft_body,\n      draft_revision: currentRevision + 1,\n      draft_hash: draftHash,\n      draft_hash_schema: DRAFT_HASH_SCHEMA,\n      approval_status: 'PENDING_APPROVAL',\n      approved_revision: 0,\n      approved_hash: '',\n      approved_by: '',\n      approved_at: null,\n      decision_reason: '',\n      batch_id: '',\n      batch_position: 0,\n      batch_status: 'UNBATCHED',\n      batch_confirmed_by: '',\n      batch_confirmed_at: null,\n      send_status: 'UNSENT',\n      provider: '',\n      provider_message_id: '',\n      lock_token: '',\n      locked_at: null,\n      execution_id: text($execution.id),\n      last_error_code: '',\n      last_error_message: '',\n      updated_by: UPDATED_BY,\n      audit_json: appendAudit(row.audit_json, {\n        event: 'DRAFT_COPY_REFRESH',\n        from_revision: currentRevision,\n        to_revision: currentRevision + 1,\n        previous_approval_status: approvalStatus,\n        changed_at: now,\n        changed_by: UPDATED_BY,\n      }),\n      updated_at: now,\n    },\n  });\n}\n\nreturn output;\n"
    },
    position: [480, 0]
  },
  output: [{
    review_id: 'rvw_example',
    draft_revision: 2,
    approval_status: 'PENDING_APPROVAL',
    batch_status: 'UNBATCHED',
    send_status: 'UNSENT',
    updated_by: 'n8n:copy-refresh-v2'
  }]
});

const updateReviewRows = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Update Review Rows',
    parameters: {
      resource: 'row',
      operation: 'update',
      dataTableId: {
        __rl: true,
        mode: 'list',
        value: 'EXAMPLE_TABLE_1',
        cachedResultName: 'outreach_review_queue_v3'
      },
      matchType: 'allConditions',
      filters: {
        conditions: [{
          keyName: 'review_id',
          condition: 'eq',
          keyValue: expr('{{ $json.review_id }}')
        }]
      },
      columns: {
        mappingMode: 'autoMapInputData',
        value: {},
        matchingColumns: [],
        schema: []
      },
      options: {
        dryRun: true
      }
    },
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    position: [720, 0]
  },
  output: [{
    review_id: 'rvw_example',
    draft_revision: 2,
    approval_status: 'PENDING_APPROVAL',
    updated_by: 'n8n:copy-refresh-v2'
  }]
});

export default workflow(
  'nunoon-review-copy-refresh-v2',
  'Nunoon - One-Time Review Copy Refresh v2'
)
  .add(manualCopyRefresh)
  .to(readReviewQueue)
  .to(prepareSafeCopyRefresh)
  .to(updateReviewRows);
