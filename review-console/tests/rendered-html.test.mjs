import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.OUTREACH_DEMO_MODE = "true";
process.env.OUTREACH_TEST_RECIPIENT = "internal-test@example.com";
process.env.OUTREACH_SEND_MODE = "TEST";
process.env.OUTREACH_MAX_BATCH_SIZE = "1";

const previewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

let workerPromise;

async function worker() {
  if (!workerPromise) {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
    workerPromise = import(workerUrl.href).then((module) => module.default);
  }
  return workerPromise;
}

async function request(path, init = {}) {
  const app = await worker();
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: {
        accept: "application/json",
        host: "localhost",
        ...init.headers,
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

function encodeRouteId(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

test("server-renders the authenticated review surface in explicit demo mode", async () => {
  const response = await request("/", {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Nunoon Outreach Review<\/title>/i);
  assert.match(html, /Outreach review/);
  assert.match(html, /To review/);
  assert.match(html, /Completed/);
  assert.match(html, /Auto-sync on/);
  assert.match(html, /Refresh/);
  assert.match(html, /Review batch/);
  assert.match(html, /HTML preview/);
  assert.match(html, /Final email preview/);
  assert.doesNotMatch(html, /Template v1|iawebdev-nunoon-outreach\.v2/);
  assert.match(html, /DEMO DATA/);
  assert.match(html, /TEST(?:<!-- -->)? MODE/);
  assert.doesNotMatch(html, previewMeta);
  assert.doesNotMatch(html, /react-loading-skeleton/);

  const signedOutResponse = await request("/signed-out", {
    headers: { accept: "text/html" },
  });
  assert.equal(signedOutResponse.status, 200);
  const signedOutHtml = await signedOutResponse.text();
  assert.match(signedOutHtml, /Signed out/);
  assert.match(signedOutHtml, /Sign in with ChatGPT/);
});

test("persists a revision, rejects stale approval, and confirms one exact TEST item", async () => {
  const queueResponse = await request("/api/review/queue");
  assert.equal(queueResponse.status, 200);
  const queue = await queueResponse.json();
  assert.equal(queue.connection, "demo");
  assert.equal(queue.config.maxBatchSize, 1);

  const original = queue.drafts.find(
    (draft) => draft.status === "PENDING_APPROVAL",
  );
  assert.ok(original);
  assert.match(original.reviewId, /%0A/);

  const genericBrandResponse = await request(
    `/api/review/drafts/${encodeRouteId(original.reviewId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        revision: original.revision,
        subject: original.subject,
        body: original.body.replace("IAWebDevelopment × Nunoon", "Nunoon"),
      }),
    },
  );
  assert.equal(genericBrandResponse.status, 422);

  const updateResponse = await request(
    `/api/review/drafts/${encodeRouteId(original.reviewId)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        revision: original.revision,
        subject: `${original.subject} — review`,
        body: original.body,
      }),
    },
  );
  assert.equal(updateResponse.status, 200);
  const updated = (await updateResponse.json()).draft;
  assert.equal(updated.revision, original.revision + 1);
  assert.notEqual(updated.draftHash, original.draftHash);
  assert.equal(updated.approvedHash, null);

  const staleApproval = await request(
    `/api/review/drafts/${encodeRouteId(original.reviewId)}/decision`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        revision: original.revision,
        draftHash: original.draftHash,
      }),
    },
  );
  assert.equal(staleApproval.status, 409);

  const approvalResponse = await request(
    `/api/review/drafts/${encodeRouteId(updated.reviewId)}/decision`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        revision: updated.revision,
        draftHash: updated.draftHash,
      }),
    },
  );
  assert.equal(approvalResponse.status, 200);
  const approved = (await approvalResponse.json()).draft;
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.approvedRevision, updated.revision);
  assert.equal(approved.approvedHash, updated.draftHash);

  const batchResponse = await request("/api/review/batches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "TEST",
      items: [
        {
          reviewId: approved.reviewId,
          revision: approved.revision,
          draftHash: approved.draftHash,
        },
      ],
    }),
  });
  assert.equal(batchResponse.status, 201);
  const batchPayload = await batchResponse.json();
  assert.equal(batchPayload.batch.itemCount, 1);
  assert.equal(batchPayload.batch.status, "CONFIRMED");

  const refreshed = await (await request("/api/review/queue")).json();
  const queued = refreshed.drafts.find(
    (draft) => draft.reviewId === approved.reviewId,
  );
  assert.equal(queued.status, "QUEUED");
  assert.equal(queued.batchId, batchPayload.batch.batchId);
});

test("keeps auth, n8n, and SMTP authority outside the browser bundle", async () => {
  const [
    client,
    homePage,
    decisionRoute,
    updateRoute,
    liveStore,
    readme,
    packageJson,
  ] = await Promise.all([
    readFile(new URL("../app/review-console.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../app/api/review/drafts/[reviewId]/decision/route.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../app/api/review/drafts/[reviewId]/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/server/live-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(client, /exact ordered manifest|exact manifest/i);
  assert.match(client, /renderBrandedEmail/);
  assert.match(client, /sandbox=""/);
  assert.match(client, /HTML preview/);
  assert.match(client, /signOutHref/);
  assert.match(homePage, /chatGPTSignOutPath\("\/signed-out"\)/);
  assert.match(decisionRoute, /decodeRouteId/);
  assert.match(updateRoute, /decodeRouteId/);
  assert.match(liveStore, /approved_hash/);
  assert.match(liveStore, /item_manifest_hash/);
  assert.match(liveStore, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(liveStore, /unsubscribe_token_hash/);
  assert.match(liveStore, /email_template_version/);
  assert.match(liveStore, /email_html_snapshot/);
  assert.match(liveStore, /email_text_snapshot/);
  assert.match(liveStore, /email_html_hash/);
  assert.match(liveStore, /email_text_hash/);
  assert.match(liveStore, /sender_domain_authenticated_snapshot/);
  assert.match(readme, /does not hold SMTP credentials or send email/i);
  assert.match(packageJson, /"name": "nunoon-outreach-review"/);
  assert.doesNotMatch(
    client,
    /N8N_API_KEY|N8N_REVIEW_API_KEY|SMTP_PASSWORD|ZOHO_PASSWORD/i,
  );
});
