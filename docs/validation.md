# Validation

Checked on 1 October 2026 against this sanitized public copy.

| Check | Result |
| --- | --- |
| Frontend production build (`npm run build`) | Passed |
| Frontend regression tests (`node --test tests/*.test.mjs`) | 16 passed |
| Frontend lint (`npm run lint`) | Passed |
| Offline sender release gate | Passed |
| Website normalization and research validators | Passed |
| Review-copy refresh regression fixtures | Passed |
| Inbound classification, control guards, and runtime code | Passed |
| Unsubscribe runtime fixtures | Passed |
| Browser title, meaningful content, and demo / TEST indicators | Passed |
| Content tab and sandboxed HTML preview | Passed |
| Approve draft -> review exact one-item TEST batch -> create demo batch | Passed |
| Browser console and uncaught runtime errors during that flow | None observed |

The frontend build and all 16 existing tests passed together after the README was added. The sender release gate compiles the generated Code nodes and checks graph, snapshot, suppression, finalization, and runtime integrity fixtures without contacting n8n.

The screenshots were captured at 1600 × 1000 (draft editor) and 1600 × 1450 (preview and confirmation) desktop viewports with an already-installed Playwright Chromium browser. The Chrome extension blocked local preview URLs, so the browser check used the installed Playwright runtime. No live queue, mailbox, or credentials were used.

The corrected screenshots wait for the iframe greeting, message, signature, and unsubscribe footer, all three logo images, fonts, and entrance animations before capture. Both email previews were checked for internal clipping, and all three screenshots were inspected visually before publication.

The confirmed demo batch displayed: TEST mode, one recipient, a batch cap of one, and 90-second pacing. The resulting UI confirmed that the batch was created locally and n8n was not contacted.

## Limits

This validation did not execute production sending, test real mailbox delivery, connect to live n8n, verify production authentication, or run a complete mobile and cross-browser audit. Historical research graph tests that require private workflow export inputs were not run.

The public example uses placeholder resource identifiers. It demonstrates the implementation and its offline checks; it is not a configured production deployment.
