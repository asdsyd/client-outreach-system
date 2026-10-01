# Nunoon Outreach Review

Human-in-the-loop review console for the n8n clinic outreach pipeline.

## Boundary

The console:

- reads the canonical n8n review queue
- validates and saves a new immutable draft revision
- renders the personalized plain-text copy through the shared, deterministic
  IAWebDevelopment × Nunoon HTML template
- previews that exact email-safe HTML in a sandboxed frame
- records approve, skip, and block decisions with the reviewer identity
- confirms an exact ordered batch manifest containing byte-hashed HTML and
  plain-text snapshots

The console does not hold SMTP credentials or send email. The n8n sender must
re-read the current queue row, approved revision and hash, recipient,
suppression state, batch manifest, template identity, rendered snapshot hashes,
mode, and lock immediately before SMTP.

## Email rendering boundary

Groq researches public clinic evidence; it does not produce HTML. Validated,
personalized copy remains plain text until `renderBrandedEmail()` safely escapes
it and applies the fixed co-brand header, typography, colors, disclosure, and
mode-aware unsubscribe treatment. LIVE batch confirmation freezes the exact
HTML and independently generated plain-text fallback. The separate n8n sender
can only send those verified snapshots as `multipart/alternative`.

## Runtime

The live adapter uses server-only n8n credentials and three Data Tables:

- `outreach_review_queue_v3`
- `outreach_batches_v3`
- `outreach_batch_items_v3`

The browser receives neither the n8n API key nor table credentials. Live access
also requires a ChatGPT-authenticated email listed in
`OUTREACH_REVIEWER_EMAILS`.

For a local demo, run `npm ci`, copy `.env.example` to `.dev.vars`, and run `npm run dev`. The committed example enables demo mode. For live hosting, configure the runtime environment. Prefer a dedicated n8n API key
limited to Data Table read/create/update/upsert scopes.

## Local preview

```bash
OUTREACH_DEMO_MODE=true \
OUTREACH_TEST_RECIPIENT=internal-test@example.com \
npm run dev
```

Demo batches are stored only in the local process and the UI states explicitly
that n8n was not contacted.

## Validation

```bash
npm run lint
npm run test
```
