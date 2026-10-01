const input = $input.first().json ?? {};
let upstream = {};
try {
  upstream = $('Assert Research Claim').first().json ?? {};
} catch {}
const hasDirectContext = Boolean(String(input.contact_key ?? '').trim());
const source = hasDirectContext ? input : upstream;
const response =
  input.website_fetch_response ?? (hasDirectContext ? {} : input);
const {
  website_fetch_response: _discardedResponse,
  error: sourceError,
  ...base
} = source;
if (!String(base.contact_key ?? '').trim()) {
  throw new Error('WEBSITE_CONTEXT_MISSING');
}
const body =
  typeof response === 'string'
    ? response
    : typeof response.body === 'string'
      ? response.body
      : typeof response.data === 'string'
        ? response.data
        : '';
const fetchError =
  input.error?.message ??
  sourceError?.message ??
  response.error?.message ??
  response.statusMessage ??
  input.message ??
  '';

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    hellip: '…',
    ldquo: '“',
    lsquo: '‘',
    nbsp: ' ',
    quot: '"',
    rdquo: '”',
    rsquo: '’',
  };
  return String(value ?? '').replace(
    /&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi,
    (entity, token) => {
      if (token[0] !== '#') return named[token.toLowerCase()] ?? entity;
      const hexadecimal = token[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(
        token.slice(hexadecimal ? 2 : 1),
        hexadecimal ? 16 : 10,
      );
      if (
        !Number.isInteger(codePoint) ||
        codePoint < 0 ||
        codePoint > 0x10ffff
      ) {
        return entity;
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return entity;
      }
    },
  );
}

function websiteText(value) {
  const raw = String(value ?? '').slice(0, 500000);
  if (!/[<>]/.test(raw)) {
    return decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim();
  }

  const metaDescriptions = [];
  const metaPattern = /<meta\b[^>]*>/gi;
  for (const tag of raw.match(metaPattern) ?? []) {
    if (
      !/\b(?:name|property)\s*=\s*["'](?:description|og:description|twitter:description)["']/i.test(
        tag,
      )
    ) {
      continue;
    }
    const content = tag.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i)?.[2];
    if (content) metaDescriptions.push(content);
  }

  const visible = raw
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(
      /<(?:script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg|template)\s*>/gi,
      ' ',
    )
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(
      /<\/(?:address|article|aside|blockquote|div|footer|h[1-6]|header|li|main|nav|p|section|table|tr)\s*>/gi,
      '\n',
    )
    .replace(/<[^>]+>/g, ' ');

  return decodeHtmlEntities([...metaDescriptions, visible].join('\n'))
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 50000);
}

const normalizedWebsiteText = websiteText(body);

return [
  {
    json: {
      ...base,
      research_status: 'RESEARCHING',
      website_text: normalizedWebsiteText,
      website_fetch_error: body
        ? ''
        : String(
            fetchError ||
              (base.website ? 'WEBSITE_UNAVAILABLE' : 'NO_WEBSITE'),
          ).slice(0, 500),
    },
    pairedItem: { item: 0 },
  },
];
