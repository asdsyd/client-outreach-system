import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  EMAIL_TEMPLATE_CONTRACT,
  EMAIL_TEMPLATE_HASH,
  EMAIL_TEMPLATE_VERSION,
  IAWEBDEVELOPMENT_LOGO_URL,
  NUNOON_RIBBON_LOGO_URL,
  NUNOON_WORDMARK_URL,
  renderBrandedEmail,
} from "../lib/email-template.ts";

const BODY = [
  "Hello Clinic Manager,",
  "",
  "While reviewing Pearl & Co.’s website, its family dental care stood out.",
  "",
  "IAWebDevelopment × Nunoon would be glad to prepare a complimentary assessment of your follow-up and booking workflows.",
  "",
  "If this is relevant, reply to this email and I’ll send the free assessment tailored to Pearl & Co.",
  "",
  "Best,",
  "Demo Sender",
  "IAWebDevelopment × Nunoon",
].join("\n");

test("exports a stable version identity and its SHA-256 hash", () => {
  assert.equal(EMAIL_TEMPLATE_VERSION, "iawebdev-nunoon-outreach.v2");
  assert.match(EMAIL_TEMPLATE_CONTRACT, /^iawebdev-nunoon-outreach\.v2\n/);
  assert.match(EMAIL_TEMPLATE_CONTRACT, /layout:table-600/);
  assert.equal(
    createHash("sha256")
      .update(EMAIL_TEMPLATE_CONTRACT, "utf8")
      .digest("hex"),
    EMAIL_TEMPLATE_HASH,
  );
  assert.match(EMAIL_TEMPLATE_HASH, /^[a-f0-9]{64}$/);
});

test("renders deterministic, email-safe co-branded HTML below 50 KB", () => {
  const input = {
    subject: "  Booking\u202e review\u0000  ",
    body: `${BODY}\n\n<script>alert("no")</script>`,
    mode: "PREVIEW",
    unsubscribeUrl: "https://example.com/should-never-appear",
  };
  const first = renderBrandedEmail(input);
  const second = renderBrandedEmail(input);

  assert.deepEqual(first, second);
  assert.equal(first.subject, "Booking review");
  assert.equal(first.mode, "PREVIEW");
  assert.equal(first.unsubscribeUrl, null);
  assert.equal(first.templateVersion, EMAIL_TEMPLATE_VERSION);
  assert.equal(first.templateHash, EMAIL_TEMPLATE_HASH);

  assert.match(first.html, /^<!doctype html>/);
  assert.match(first.html, /role="presentation"/);
  assert.match(first.html, /max-width:600px/);
  assert.match(first.html, /font-family:Arial, Helvetica, sans-serif/);
  assert.match(first.html, /#3c83f6/);
  assert.match(first.html, /#006171/);
  assert.match(first.html, /#49b74f/);
  assert.match(first.html, new RegExp(escapeRegExp(IAWEBDEVELOPMENT_LOGO_URL)));
  assert.match(first.html, new RegExp(escapeRegExp(NUNOON_RIBBON_LOGO_URL)));
  assert.match(first.html, new RegExp(escapeRegExp(NUNOON_WORDMARK_URL)));
  assert.match(first.html, />IAWebDevelopment</);
  assert.match(first.html, /alt="Nunoon"/);
  assert.match(first.html, /Hello Clinic Manager,/);
  assert.match(first.html, /font-weight:700[^>]*>.*reply to this email/s);
  assert.match(first.html, /Demo Sender/);
  assert.match(first.html, /&lt;script&gt;alert\(&quot;no&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(first.html, /<script\b/i);
  assert.doesNotMatch(first.html, /<iframe\b/i);
  assert.doesNotMatch(first.html, /<form\b/i);
  assert.doesNotMatch(first.html, /javascript:/i);
  assert.doesNotMatch(first.html, /should-never-appear/);
  assert.match(first.html, /href="#unsubscribe"[^>]*>Unsubscribe<\/a>/);
  assert.doesNotMatch(first.html, /Preview only|Internal TEST|LIVE send/);
  assert.doesNotMatch(first.html, new RegExp(escapeRegExp(EMAIL_TEMPLATE_VERSION)));
  assert.ok(Buffer.byteLength(first.html, "utf8") < 50_000);
});

test("normalizes control and bidi characters without turning text into markup", () => {
  const render = renderBrandedEmail({
    subject: "A\u0007 safe\u2066 subject",
    body: `Hello Team,\r\n\r\nA\u0000B\u202eC & <strong>literal</strong>\ttext.`,
    mode: "TEST",
  });

  assert.equal(render.subject, "A safe subject");
  assert.equal(
    render.body,
    "Hello Team,\n\nABC & <strong>literal</strong> text.",
  );
  assert.match(render.html, /ABC &amp; &lt;strong&gt;literal&lt;\/strong&gt; text/);
  assert.doesNotMatch(render.html, /\u0000|\u0007|\u202e|\u2066/);
  assert.match(render.text, /ABC & <strong>literal<\/strong> text\./);
  assert.doesNotMatch(render.text, /\u0000|\u0007|\u202e|\u2066/);
});

test("keeps PREVIEW and TEST unsubscribe controls non-operative", () => {
  for (const mode of ["PREVIEW", "TEST"]) {
    const hiddenUrl = `https://example.com/unsubscribe/${mode.toLowerCase()}`;
    const render = renderBrandedEmail({
      subject: "Review",
      body: BODY,
      mode,
      unsubscribeUrl: hiddenUrl,
    });

    assert.equal(render.unsubscribeUrl, null);
    assert.doesNotMatch(render.html, new RegExp(escapeRegExp(hiddenUrl)));
    assert.doesNotMatch(render.text, new RegExp(escapeRegExp(hiddenUrl)));
    assert.match(render.html, /href="#unsubscribe"[^>]*>Unsubscribe<\/a>/i);
    assert.match(render.text, /\nUnsubscribe$/);
    assert.doesNotMatch(render.html, /Preview only|Internal TEST|LIVE send/);
    assert.doesNotMatch(render.text, /Preview only|Internal TEST|LIVE send/);
  }
});

test("puts the exact secure unsubscribe URL in LIVE HTML and plain text", () => {
  const unsubscribeUrl =
    "https://nunoon.com/outreach/unsubscribe/token-123?source=email&v=1";
  const render = renderBrandedEmail({
    subject: "Review",
    body: BODY,
    mode: "LIVE",
    unsubscribeUrl,
  });

  assert.equal(render.unsubscribeUrl, unsubscribeUrl);
  assert.match(
    render.html,
    /href="https:\/\/nunoon\.com\/outreach\/unsubscribe\/token-123\?source=email&amp;v=1"[^>]*>Unsubscribe<\/a>/,
  );
  assert.match(render.text, new RegExp(`Unsubscribe: ${escapeRegExp(unsubscribeUrl)}`));
});

test("fails closed when a LIVE unsubscribe URL is absent or unsafe", () => {
  assert.throws(
    () =>
      renderBrandedEmail({
        subject: "Review",
        body: BODY,
        mode: "LIVE",
      }),
    /secure unsubscribe URL is required/i,
  );
  assert.throws(
    () =>
      renderBrandedEmail({
        subject: "Review",
        body: BODY,
        mode: "LIVE",
        unsubscribeUrl: "http://nunoon.com/unsubscribe/token-123",
      }),
    /must use HTTPS/i,
  );
  assert.throws(
    () =>
      renderBrandedEmail({
        subject: "Review",
        body: BODY,
        mode: "LIVE",
        unsubscribeUrl: "https://user:secret@nunoon.com/unsubscribe/token-123",
      }),
    /must not contain credentials/i,
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
