export const EMAIL_TEMPLATE_VERSION = "iawebdev-nunoon-outreach.v2";

/**
 * Stable identity input for the template-version hash. Exact rendered HTML and
 * text are hashed separately when a batch is created.
 */
export const EMAIL_TEMPLATE_CONTRACT = [
  EMAIL_TEMPLATE_VERSION,
  "layout:table-600",
  "ia-logo:https://horizons-cdn.hostinger.com/64332dc1-ff9e-450a-a74f-addf9533030e/41719e3c0f694332c366d6c793d15b88.png|96",
  "nunoon-ribbon:https://nunoon.com/assets/nunoon-ribbon-mark-alpha.png|70",
  "nunoon-wordmark:https://nunoon.com/assets/nunoon-text-only-logo.png|100",
  "palette:#f4fbfb,#063a46,#31535a,#3c83f6,#006171,#49b74f",
  "font:Arial, Helvetica, sans-serif",
  "mobile:ia-mark-78;hide-ia-name;hide-ribbon;nunoon-wordmark-88",
  "modes:preview-test-visible-inert-unsubscribe;live-exact-https-unsubscribe",
  "footer:no-internal-mode-copy;no-visible-template-id",
].join("\n");
export const EMAIL_TEMPLATE_HASH =
  "ef68eb3c2ca3e5652eed80ec724c665a24ae705e13ca7086e53641b195a2f59b";

export const IAWEBDEVELOPMENT_URL = "https://iawebdev.com/";
export const NUNOON_URL = "https://nunoon.com/";
export const IAWEBDEVELOPMENT_LOGO_URL =
  "https://horizons-cdn.hostinger.com/64332dc1-ff9e-450a-a74f-addf9533030e/41719e3c0f694332c366d6c793d15b88.png";
export const NUNOON_RIBBON_LOGO_URL =
  "https://nunoon.com/assets/nunoon-ribbon-mark-alpha.png";
export const NUNOON_WORDMARK_URL =
  "https://nunoon.com/assets/nunoon-text-only-logo.png";

export type EmailTemplateMode = "PREVIEW" | "TEST" | "LIVE";

export type BrandedEmailInput = {
  subject: string;
  body: string;
  mode: EmailTemplateMode;
  unsubscribeUrl?: string | null;
};

export type BrandedEmailRender = {
  subject: string;
  body: string;
  html: string;
  text: string;
  mode: EmailTemplateMode;
  unsubscribeUrl: string | null;
  templateVersion: typeof EMAIL_TEMPLATE_VERSION;
  templateHash: typeof EMAIL_TEMPLATE_HASH;
};

const BRAND_NAME = "IAWebDevelopment × Nunoon";
const FONT_STACK = "Arial, Helvetica, sans-serif";
const CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const BIDI_CONTROL_CHARACTERS =
  /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const GREETING_PATTERN =
  /^(?:hi|hello|dear|good (?:morning|afternoon|evening)|greetings)\b/i;
const SIGNATURE_PATTERN =
  /^(?:best|best regards|regards|kind regards|warm regards|sincerely|thank you|thanks)[,!]?(?:\n|$)/i;
const OPT_OUT_PATTERN =
  /\b(?:opt[\s-]?out|unsubscribe|not interested|do not wish|reply (?:no|stop))\b|عدم التواصل|إيقاف|غير مهتم/i;

export function renderBrandedEmail(
  input: BrandedEmailInput,
): BrandedEmailRender {
  const subject = normalizeSubject(input.subject);
  const body = normalizeBody(input.body);
  const mode = normalizeMode(input.mode);
  const unsubscribeUrl = resolveUnsubscribeUrl(mode, input.unsubscribeUrl);
  const sections = classifyBody(body);

  return {
    subject,
    body,
    html: renderHtml({
      subject,
      sections,
      mode,
      unsubscribeUrl,
    }),
    text: renderText({ body, mode, unsubscribeUrl }),
    mode,
    unsubscribeUrl,
    templateVersion: EMAIL_TEMPLATE_VERSION,
    templateHash: EMAIL_TEMPLATE_HASH,
  };
}

export function normalizeEmailTemplateSubject(value: string): string {
  return normalizeSubject(value);
}

export function normalizeEmailTemplateBody(value: string): string {
  return normalizeBody(value);
}

type ClassifiedBody = {
  greeting: string | null;
  content: Array<{ text: string; kind: "body" | "cta" | "opt-out" }>;
  signature: string | null;
};

function classifyBody(body: string): ClassifiedBody {
  const blocks = body
    .split(/\n[ \t]*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  let greeting: string | null = null;
  let signature: string | null = null;

  if (blocks[0] && GREETING_PATTERN.test(blocks[0])) {
    greeting = blocks.shift() ?? null;
  }

  if (blocks.at(-1) && SIGNATURE_PATTERN.test(blocks.at(-1) ?? "")) {
    signature = blocks.pop() ?? null;
  }

  let ctaIndex = -1;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (
      (blocks[index].includes("?") ||
        /\breply to (?:this|the) email\b/i.test(blocks[index]) ||
        /يرجى الرد على هذه الرسالة/u.test(blocks[index])) &&
      !OPT_OUT_PATTERN.test(blocks[index])
    ) {
      ctaIndex = index;
      break;
    }
  }

  return {
    greeting,
    content: blocks.map((text, index) => ({
      text,
      kind: OPT_OUT_PATTERN.test(text)
        ? "opt-out"
        : index === ctaIndex
          ? "cta"
          : "body",
    })),
    signature,
  };
}

function renderHtml(input: {
  subject: string;
  sections: ClassifiedBody;
  mode: EmailTemplateMode;
  unsubscribeUrl: string | null;
}): string {
  const title = escapeHtml(input.subject || BRAND_NAME);
  const preheader = escapeHtml(buildPreheader(input.sections));
  const greeting = input.sections.greeting
    ? `<tr>
                    <td dir="auto" style="padding:0 0 18px 0;color:#063a46;font-family:${FONT_STACK};font-size:24px;font-weight:700;line-height:1.3;text-align:left;">${formatMultiline(input.sections.greeting)}</td>
                  </tr>`
    : "";
  const content = input.sections.content
    .map((section) => renderContentSection(section))
    .join("\n");
  const signature = input.sections.signature
    ? renderSignature(input.sections.signature)
    : "";
  const modeFooter = renderModeFooter(input.mode, input.unsubscribeUrl);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${title}</title>
    <style>
      @media only screen and (max-width:620px) {
        .email-shell { width:100% !important; }
        .email-pad { padding-left:24px !important; padding-right:24px !important; }
        .brand-pad { padding-left:18px !important; padding-right:18px !important; }
        .brand-name { display:none !important; }
        .ia-logo { width:78px !important; }
        .nunoon-ribbon { display:none !important; }
        .nunoon-wordmark { width:88px !important; }
        .footer-link { display:block !important; padding:4px 0 !important; }
        .footer-separator { display:none !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:#f4fbfb;color:#31535a;font-family:${FONT_STACK};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:#f4fbfb;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4fbfb" style="width:100%;border-collapse:collapse;background-color:#f4fbfb;">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" class="email-shell" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;border:1px solid #cfe4e5;border-radius:14px;">
            <tr>
              <td class="email-pad brand-pad" style="padding:22px 34px 20px 34px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td align="left" valign="middle" style="width:55%;padding:0 12px 0 0;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                        <tr>
                          <td valign="middle" style="padding:0 8px 0 0;">
                            <img src="${IAWEBDEVELOPMENT_LOGO_URL}" width="96" alt="IAWebDevelopment logo" class="ia-logo" style="display:block;width:96px;height:auto;border:0;outline:none;text-decoration:none;">
                          </td>
                          <td valign="middle" class="brand-name" style="color:#070a13;font-family:${FONT_STACK};font-size:16px;font-weight:700;line-height:1.2;white-space:nowrap;">IAWebDevelopment</td>
                        </tr>
                      </table>
                    </td>
                    <td width="1" bgcolor="#cfe4e5" style="width:1px;background-color:#cfe4e5;font-size:0;line-height:0;">&nbsp;</td>
                    <td align="right" valign="middle" style="width:45%;padding:0 0 0 14px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right" style="border-collapse:collapse;">
                        <tr>
                          <td align="right" style="padding:0;">
                            <img src="${NUNOON_RIBBON_LOGO_URL}" width="70" alt="Nunoon ribbon logo" class="nunoon-ribbon" style="display:block;width:70px;height:auto;margin:0 0 4px auto;border:0;outline:none;text-decoration:none;">
                            <img src="${NUNOON_WORDMARK_URL}" width="100" alt="Nunoon" class="nunoon-wordmark" style="display:block;width:100px;height:auto;margin:0 0 0 auto;border:0;outline:none;text-decoration:none;">
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td width="34%" height="3" bgcolor="#3c83f6" style="width:34%;height:3px;background-color:#3c83f6;font-size:0;line-height:0;">&nbsp;</td>
                    <td width="33%" height="3" bgcolor="#006171" style="width:33%;height:3px;background-color:#006171;font-size:0;line-height:0;">&nbsp;</td>
                    <td width="33%" height="3" bgcolor="#49b74f" style="width:33%;height:3px;background-color:#49b74f;font-size:0;line-height:0;">&nbsp;</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-pad" style="padding:38px 42px 34px 42px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
                  ${greeting}
                  ${content}
                  ${signature}
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-pad" bgcolor="#f4fbfb" style="padding:22px 34px 24px 34px;background-color:#f4fbfb;border-top:1px solid #cfe4e5;">
                <p style="margin:0 0 9px 0;color:#527078;font-family:${FONT_STACK};font-size:12px;line-height:1.55;text-align:center;">Sent by ${BRAND_NAME} about business services for your organization.</p>
                <p style="margin:0 0 9px 0;color:#527078;font-family:${FONT_STACK};font-size:12px;line-height:1.55;text-align:center;">
                  <a href="${IAWEBDEVELOPMENT_URL}" target="_blank" rel="noopener noreferrer" class="footer-link" style="color:#006171;text-decoration:underline;">iawebdev.com</a>
                  <span class="footer-separator" aria-hidden="true" style="padding:0 7px;color:#91aaae;">·</span>
                  <a href="${NUNOON_URL}" target="_blank" rel="noopener noreferrer" class="footer-link" style="color:#006171;text-decoration:underline;">nunoon.com</a>
                  ${modeFooter}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderContentSection(section: {
  text: string;
  kind: "body" | "cta" | "opt-out";
}): string {
  if (section.kind === "cta") {
    return `<tr>
                    <td dir="auto" style="padding:4px 0 22px 0;color:#063a46;font-family:${FONT_STACK};font-size:16px;font-weight:700;line-height:1.65;text-align:left;">${formatMultiline(section.text)}</td>
                  </tr>`;
  }

  if (section.kind === "opt-out") {
    return `<tr>
                    <td dir="auto" style="padding:0 0 22px 0;color:#527078;font-family:${FONT_STACK};font-size:14px;line-height:1.65;text-align:left;">${formatMultiline(section.text)}</td>
                  </tr>`;
  }

  return `<tr>
                    <td dir="auto" style="padding:0 0 22px 0;color:#31535a;font-family:${FONT_STACK};font-size:16px;line-height:1.7;text-align:left;">${formatMultiline(section.text)}</td>
                  </tr>`;
}

function renderSignature(signature: string): string {
  const lines = signature.split("\n").filter(Boolean);
  const signOff = lines.shift() ?? "";
  const signer = lines.shift() ?? "";
  const organization = lines.join("\n");

  return `<tr>
                    <td style="padding:2px 0 0 0;border-top:1px solid #dff5f3;">
                      <p dir="auto" style="margin:18px 0 5px 0;color:#527078;font-family:${FONT_STACK};font-size:14px;line-height:1.5;">${formatMultiline(signOff)}</p>
                      ${signer ? `<p dir="auto" style="margin:0;color:#063a46;font-family:${FONT_STACK};font-size:16px;font-weight:700;line-height:1.5;">${formatMultiline(signer)}</p>` : ""}
                      ${organization ? `<p dir="auto" style="margin:2px 0 0 0;color:#006171;font-family:${FONT_STACK};font-size:13px;font-weight:700;line-height:1.5;">${formatMultiline(organization)}</p>` : ""}
                    </td>
                  </tr>`;
}

function renderModeFooter(
  mode: EmailTemplateMode,
  unsubscribeUrl: string | null,
): string {
  const separator =
    '<span class="footer-separator" aria-hidden="true" style="padding:0 7px;color:#91aaae;">·</span>';

  if (mode === "LIVE" && unsubscribeUrl) {
    return `${separator}<a href="${escapeHtml(unsubscribeUrl)}" target="_blank" rel="noopener noreferrer" class="footer-link" style="color:#006171;text-decoration:underline;">Unsubscribe</a>`;
  }

  return `${separator}<a href="#unsubscribe" class="footer-link" style="color:#006171;text-decoration:underline;">Unsubscribe</a>`;
}

function renderText(input: {
  body: string;
  mode: EmailTemplateMode;
  unsubscribeUrl: string | null;
}): string {
  const footer = [
    BRAND_NAME,
    IAWEBDEVELOPMENT_URL,
    NUNOON_URL,
    input.mode === "LIVE" && input.unsubscribeUrl
      ? `Unsubscribe: ${input.unsubscribeUrl}`
      : "Unsubscribe",
  ];

  return `${input.body}\n\n—\n${footer.join("\n")}`;
}

function buildPreheader(sections: ClassifiedBody): string {
  const firstContent = sections.content.find(
    (section) => section.kind !== "opt-out",
  )?.text;
  const value = firstContent || sections.greeting || BRAND_NAME;
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > 140 ? `${oneLine.slice(0, 137)}…` : oneLine;
}

function normalizeMode(value: EmailTemplateMode): EmailTemplateMode {
  if (value !== "PREVIEW" && value !== "TEST" && value !== "LIVE") {
    throw new Error("Email template mode must be PREVIEW, TEST, or LIVE.");
  }
  return value;
}

function resolveUnsubscribeUrl(
  mode: EmailTemplateMode,
  value: string | null | undefined,
): string | null {
  if (mode !== "LIVE") return null;
  const candidate = normalizeSecurityText(value ?? "").trim();
  if (!candidate) {
    throw new Error("A secure unsubscribe URL is required for LIVE email.");
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("The LIVE unsubscribe URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(
      "The LIVE unsubscribe URL must use HTTPS and must not contain credentials.",
    );
  }
  return candidate;
}

function normalizeSubject(value: string): string {
  return normalizeSecurityText(value)
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBody(value: string): string {
  return normalizeSecurityText(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2028\u2029]/g, "\n")
    .replace(/\t/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSecurityText(value: string): string {
  return value
    .normalize("NFC")
    .replace(CONTROL_CHARACTERS, "")
    .replace(BIDI_CONTROL_CHARACTERS, "");
}

function formatMultiline(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
