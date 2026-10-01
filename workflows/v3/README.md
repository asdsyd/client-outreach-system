# Outreach workflow code

This folder contains the v3 contracts and guards used by the review console and n8n workflows. The public copy uses placeholder resource IDs in `live-resources.example.json`.

## Start here

| File | What it demonstrates |
| --- | --- |
| `canonical-data-table-schema.json` | Review, batch, inbound, and suppression table contracts |
| `normalize-website-result.js` | Bounded website text and preservation of the current clinic record |
| `validate-research.js` / `validate-draft.js` | Evidence, identity, language, and copy validation |
| `build-draft.js` | Deterministic personalized draft composition |
| `research-to-review-upsert.js` | Content hashes, revisioning, and invalidation of stale approvals |
| `fail-closed-send-gate.js` | Exact manifest, recipient, approval, lock, and immutable content checks |
| `pre-smtp-control-gate.js` | Last suppression and hold check before delivery |
| `build-sender-v3.mjs` | Inactive importable sender graph |
| `inbound-classifier.mjs` | Reply, auto-reply, bounce, and opt-out classification |
| `unsubscribe-*.js` / `unsubscribe-*.html` | Non-mutating confirmation and validated suppression flow |
| `test-*.mjs` | Offline regression fixtures |

## Validate the sender offline

From the repository root:

```bash
node workflows/v3/check-sender-release.mjs
```

This checks preflight configuration, frozen email snapshots, suppression controls, finalization, runtime integrity fixtures, Code-node compilation, and graph structure. It does not call n8n or send mail.

## Generate an import file

```bash
node workflows/v3/build-sender-v3.mjs > /tmp/sender-v3.workflow.json
```

An already-generated example is in `workflows/examples/`. It starts inactive. Replace the example identifiers and configure your own credentials before deploying it.

Some research patch and graph tests require an input workflow JSON argument. The historical private workflow backups are excluded from this public repository.

## Live operation

The `patch-live-*` and `--live` utilities are operator tools, not part of the local demo. Do not run them against an instance without configuring and reviewing its resources and credentials.

Hashes use ordered JSON, normalized addresses and copy, UTF-8, LF line endings, and SHA-256. Confirmed content must not be changed or re-rendered after approval.
