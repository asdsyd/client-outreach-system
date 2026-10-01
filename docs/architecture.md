# Architecture

## Review boundary

The browser calls the review console's API routes. Those routes authenticate the reviewer, validate inputs, and use either the in-memory demo store or the server-side n8n adapter.

The console does not hold SMTP credentials or send email. Its job is to record human decisions and confirm the exact ordered batch. The n8n sender holds delivery authority.

## Data and approval

Five n8n Data Tables hold review drafts, batches, immutable batch items, inbound events, and contact suppressions. The public schema is in `workflows/v3/canonical-data-table-schema.json`.

Each draft has a revision and content hash. Approval commits to that revision and hash. An edit clears approval. Live batch confirmation freezes the exact rendered HTML and its separate text alternative, hashes both, and includes them in the item and batch manifests.

Before sending, the sender claims the batch and re-reads current state. It checks the manifest, ordered item count, recipient, revision, approval hash, template identity, content hashes, lock, send configuration, and active contact controls. It checks suppression again immediately before SMTP.

## Research and copy

Website normalization converts fetched HTML to bounded text. Research validators check evidence and identity. Draft composition uses deterministic JavaScript with the validated research. A shared fixed renderer escapes the resulting plain text and produces branded HTML. The preview runs in a sandboxed iframe.

## Delivery and replies

The sender records an authoritative provider message ID and reconciles item and queue state. Ambiguous acceptance requires reconciliation rather than an automatic resend.

Inbound code parses email addresses and quote history, matches replies to sent items, classifies replies and delivery notices, and plans hold or suppression controls. Unsubscribe GET and HEAD requests do not change state; a validated POST can record suppression.

## Demo versus live

Demo mode uses fictional records and in-memory decisions. It does not call n8n or send mail. It does not simulate every live delivery invariant.

Live mode needs your own n8n Data Tables and server-only credentials. The supplied identity adapter assumes a trusted ChatGPT Sites gateway. Standalone production hosting requires an authentication integration that verifies identity before granting access.

The committed `live-resources.example.json` and hosting metadata contain placeholders. Workflow generators target those example identifiers, and the sender export starts inactive.
