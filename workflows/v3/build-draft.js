const base = $input.first().json ?? {};
const config = $('Preflight Research Config').first().json;

let evidence;
try {
  evidence = JSON.parse(String(base.research_sources_json ?? '{}'));
} catch {
  throw new Error('DRAFT_RESEARCH_EVIDENCE_MALFORMED');
}
const cleanDetails = (values) =>
  (Array.isArray(values) ? values : [])
  .map((value) => String(value).trim())
  .filter(Boolean);
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
if (!detail) throw new Error('DRAFT_MISSING_VERIFIED_DETAIL');

const company = String(base.company_name ?? '').trim();
const sender = String(config.sender_name ?? '').trim();
if (!company || !sender) throw new Error('DRAFT_CONTEXT_MISSING');
const usesPersonalization = personalizationPoints.includes(detail);
const isArabic = String(base.language).toLowerCase() === 'ar';
const hasClinicWebsite = Boolean(String(base.website ?? '').trim());
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
const arabicHook = usesPersonalization
  ? `أثناء مراجعتنا ${hasClinicWebsite ? `لموقع ${company}` : `لحضور ${company} الرقمي`}، لفت انتباهنا هذا الجانب: «${quotedDetail}». وقد أعطانا ذلك صورة واضحة عن طريقة عرض فريقكم للرعاية.`
  : `أثناء مراجعتنا ${hasClinicWebsite ? `لموقع ${company}` : `لحضور ${company} الرقمي`}، لفتت انتباهنا خدمة «${quotedDetail}» ضمن الخدمات التي تقدمونها. وقد أعطانا ذلك صورة واضحة عن طريقة عرض فريقكم للرعاية.`;
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

return [
  {
    json: {
      output: {
        draft_subject: draftSubject,
        draft_body: draftBody,
      },
    },
    pairedItem: { item: 0 },
  },
];
