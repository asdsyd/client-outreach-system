"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type {
  BatchCreateInput,
  DraftDecisionInput,
  DraftUpdateInput,
  ReviewBatch,
  ReviewDraft,
  ReviewQueueResponse,
  ReviewStatus,
} from "@/lib/contracts/review";
import { validateDraftContent } from "@/lib/contracts/review";
import {
  defaultBatchSelection,
  toggleAllBatchSelection,
  toggleBatchItemSelection,
} from "@/lib/batch-selection";
import { renderBrandedEmail } from "@/lib/email-template";
import {
  draftMatchesQueueFilter,
  filterQueueDrafts,
  type QueueFilter,
} from "@/lib/queue-view";
import { encodeRouteId } from "@/lib/route-id";

type DraftView = "content" | "preview";
type LocalEdit = { subject: string; body: string };
type Notice = {
  message: string;
  tone: "success" | "error" | "info";
};
type ReviewConsoleProps = {
  initialQueue: ReviewQueueResponse | null;
  initialError: { message: string; code: string } | null;
  signOutHref: string | null;
};

const EMPTY_DRAFTS: ReviewDraft[] = [];

const filters: { id: QueueFilter; label: string }[] = [
  { id: "review", label: "To review" },
  { id: "approved", label: "Approved" },
  { id: "completed", label: "Completed" },
  { id: "all", label: "All" },
];

const AUTO_REFRESH_MS = 30_000;

export default function ReviewConsole({
  initialQueue,
  initialError,
  signOutHref,
}: ReviewConsoleProps) {
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(initialQueue);
  const [loadError, setLoadError] = useState(initialError?.message ?? "");
  const [loadErrorCode, setLoadErrorCode] = useState(initialError?.code ?? "");
  const [selectedId, setSelectedId] = useState(
    initialQueue?.drafts[0]?.reviewId ?? "",
  );
  const [filter, setFilter] = useState<QueueFilter>(() =>
    initialQueue?.drafts.some((draft) =>
      ["PENDING_APPROVAL", "NEEDS_ATTENTION", "BLOCKED"].includes(
        draft.status,
      ),
    )
      ? "review"
      : "all",
  );
  const [draftView, setDraftView] = useState<DraftView>("preview");
  const [edits, setEdits] = useState<Record<string, LocalEdit>>({});
  const [busy, setBusy] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() =>
    initialQueue ? Date.parse(initialQueue.syncedAt) : null,
  );
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showBatch, setShowBatch] = useState(false);
  const [batchSelection, setBatchSelection] = useState<Set<string>>(new Set());
  const refreshInFlight = useRef(false);
  const allowExit = useRef(false);

  const loadQueue = useCallback(async (announce = false) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    setLoadError("");
    setLoadErrorCode("");
    try {
      const response = await apiRequest<ReviewQueueResponse>(
        "/api/review/queue",
        { cache: "no-store" },
      );
      setQueue(response);
      setSelectedId((current) =>
        response.drafts.some((draft) => draft.reviewId === current)
          ? current
          : response.drafts[0]?.reviewId ?? "",
      );
      setFilter((current) =>
        current === "all" || filterQueueDrafts(response.drafts, current).length > 0
          ? current
          : "all",
      );
      setLastSyncedAt(Date.parse(response.syncedAt));
      if (announce) {
        setNotice({
          message: `Queue refreshed. ${response.drafts.length} total drafts loaded.`,
          tone: "success",
        });
      }
    } catch (error) {
      const details = errorDetails(error);
      setLoadError(details.message);
      setLoadErrorCode(details.code);
      setNotice({ message: details.message, tone: "error" });
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, []);

  const drafts = queue?.drafts ?? EMPTY_DRAFTS;
  const approved = useMemo(
    () => drafts.filter((draft) => draft.status === "APPROVED"),
    [drafts],
  );
  const approvedIds = useMemo(
    () => approved.map((draft) => draft.reviewId),
    [approved],
  );
  const reviewedCount = drafts.filter((draft) =>
    ["APPROVED", "SKIPPED", "BLOCKED", "QUEUED", "SENDING", "SENT"].includes(
      draft.status,
    ),
  ).length;
  const attentionCount = drafts.filter((draft) =>
    ["PENDING_APPROVAL", "NEEDS_ATTENTION", "BLOCKED"].includes(draft.status),
  ).length;

  const visibleDrafts = useMemo(
    () => filterQueueDrafts(drafts, filter),
    [drafts, filter],
  );

  const selected =
    visibleDrafts.find((draft) => draft.reviewId === selectedId) ??
    visibleDrafts[0] ??
    drafts.find((draft) => draft.reviewId === selectedId) ??
    drafts[0] ??
    null;
  const selectedEdit = selected ? edits[selected.reviewId] : undefined;
  const subject = selectedEdit?.subject ?? selected?.subject ?? "";
  const body = selectedEdit?.body ?? selected?.body ?? "";
  const dirty =
    Boolean(selected) &&
    (subject !== selected?.subject || body !== selected?.body);
  const hasUnsavedEdits = Object.keys(edits).length > 0;
  const validation = validateDraftContent(subject, body);
  const emailPreview = useMemo(
    () =>
      renderBrandedEmail({
        subject,
        body,
        mode: "PREVIEW",
      }),
    [body, subject],
  );

  const replaceDraft = useCallback((nextDraft: ReviewDraft) => {
    setQueue((current) =>
      current
        ? {
            ...current,
            drafts: current.drafts.map((draft) =>
              draft.reviewId === nextDraft.reviewId ? nextDraft : draft,
            ),
          }
        : current,
    );
    setEdits((current) => {
      const next = { ...current };
      delete next[nextDraft.reviewId];
      return next;
    });
  }, []);

  const selectNext = useCallback(
    (currentId: string) => {
      if (dirty) {
        setNotice({
          message: "Save or discard this edit before opening another draft.",
          tone: "info",
        });
        return;
      }
      if (!visibleDrafts.length) return;
      const index = visibleDrafts.findIndex(
        (draft) => draft.reviewId === currentId,
      );
      const next = visibleDrafts[(index + 1) % visibleDrafts.length];
      if (next) setSelectedId(next.reviewId);
    },
    [dirty, visibleDrafts],
  );

  const saveCurrent = useCallback(async () => {
    if (!selected || !dirty || !validation.valid) return;
    setBusy(`save:${selected.reviewId}`);
    setNotice(null);
    try {
      const response = await apiRequest<{ draft: ReviewDraft }>(
        `/api/review/drafts/${encodeRouteId(selected.reviewId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            revision: selected.revision,
            subject,
            body,
          } satisfies DraftUpdateInput),
        },
      );
      replaceDraft(response.draft);
      setNotice({
        message: `${selected.clinic} saved as revision ${response.draft.revision}.`,
        tone: "success",
      });
    } catch (error) {
      setNotice({ message: errorMessage(error), tone: "error" });
    } finally {
      setBusy("");
    }
  }, [body, dirty, replaceDraft, selected, subject, validation.valid]);

  const decideCurrent = useCallback(
    async (action: DraftDecisionInput["action"]) => {
      if (!selected) return;
      if (action === "approve" && selected.status === "APPROVED") return;
      if (
        action === "block" &&
        !window.confirm(
          `Block ${selected.recipient}? This prevents sending until suppression is removed.`,
        )
      ) {
        return;
      }
      if (dirty) {
        setNotice({
          message: "Save changes before recording a decision.",
          tone: "info",
        });
        return;
      }
      const key = `${action}:${selected.reviewId}`;
      setBusy(key);
      setNotice(null);
      try {
        const response = await apiRequest<{ draft: ReviewDraft }>(
          `/api/review/drafts/${encodeRouteId(selected.reviewId)}/decision`,
          {
            method: "POST",
            body: JSON.stringify({
              action,
              revision: selected.revision,
              draftHash: selected.draftHash,
              reason:
                action === "block"
                  ? "Blocked during final human review"
                  : undefined,
            } satisfies DraftDecisionInput),
          },
        );
        replaceDraft(response.draft);
        if (
          filter !== "all" &&
          visibleDrafts.length <= 1 &&
          !draftMatchesQueueFilter(response.draft, filter)
        ) {
          setFilter("all");
        }
        const verb =
          action === "approve"
            ? "approved"
            : action === "skip"
              ? "skipped"
              : action === "block"
                ? "blocked"
                : "returned to review";
        setNotice({
          message: `${selected.clinic} ${verb}.`,
          tone: "success",
        });
        if (action !== "restore") selectNext(selected.reviewId);
      } catch (error) {
        setNotice({ message: errorMessage(error), tone: "error" });
      } finally {
        setBusy("");
      }
    },
    [dirty, filter, replaceDraft, selectNext, selected, visibleDrafts.length],
  );

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape" && showBatch && busy !== "batch") {
        event.preventDefault();
        setShowBatch(false);
        return;
      }
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, button, a")) return;
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        void decideCurrent("approve");
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void decideCurrent("skip");
      }
      if (event.key === "ArrowDown" && selected) {
        event.preventDefault();
        selectNext(selected.reviewId);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [busy, decideCurrent, selectNext, selected, showBatch]);

  useEffect(() => {
    if (!showBatch) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showBatch]);

  useEffect(() => {
    if (!hasUnsavedEdits && busy === "") return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowExit.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [busy, hasUnsavedEdits]);

  useEffect(() => {
    const refreshIfSafe = () => {
      if (
        document.visibilityState !== "visible" ||
        busy !== "" ||
        showBatch ||
        hasUnsavedEdits
      ) {
        return;
      }
      void loadQueue();
    };
    const interval = window.setInterval(refreshIfSafe, AUTO_REFRESH_MS);
    window.addEventListener("focus", refreshIfSafe);
    document.addEventListener("visibilitychange", refreshIfSafe);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfSafe);
      document.removeEventListener("visibilitychange", refreshIfSafe);
    };
  }, [busy, hasUnsavedEdits, loadQueue, showBatch]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function updateEdit(field: keyof LocalEdit, value: string) {
    if (!selected) return;
    setEdits((current) => {
      const nextEdit = {
        subject: current[selected.reviewId]?.subject ?? selected.subject,
        body: current[selected.reviewId]?.body ?? selected.body,
        [field]: value,
      };
      const next = { ...current };
      if (
        nextEdit.subject === selected.subject &&
        nextEdit.body === selected.body
      ) {
        delete next[selected.reviewId];
      } else {
        next[selected.reviewId] = nextEdit;
      }
      return next;
    });
    setNotice(null);
  }

  function chooseDraft(reviewId: string) {
    if (dirty && selected && reviewId !== selected.reviewId) {
      setNotice({
        message: "Save or discard this edit before opening another draft.",
        tone: "info",
      });
      return;
    }
    setSelectedId(reviewId);
  }

  function chooseFilter(nextFilter: QueueFilter) {
    if (
      dirty &&
      selected &&
      !draftMatchesQueueFilter(selected, nextFilter)
    ) {
      setNotice({
        message: "Save or discard this edit before leaving its queue view.",
        tone: "info",
      });
      return;
    }
    if (
      nextFilter !== "all" &&
      filterQueueDrafts(drafts, nextFilter).length === 0
    ) {
      setNotice({
        message: `There are no drafts in ${filters.find((item) => item.id === nextFilter)?.label.toLowerCase() ?? "that view"}.`,
        tone: "info",
      });
      return;
    }
    setFilter(nextFilter);
  }

  function refreshQueue() {
    if (hasUnsavedEdits) {
      setNotice({
        message: "Save or discard your edit before refreshing the queue.",
        tone: "info",
      });
      return;
    }
    void loadQueue(true);
  }

  function discardCurrentEdit() {
    if (!selected || !edits[selected.reviewId]) return;
    if (!window.confirm(`Discard unsaved changes to ${selected.clinic}?`)) return;
    setEdits((current) => {
      const next = { ...current };
      delete next[selected.reviewId];
      return next;
    });
    setNotice({ message: "Unsaved changes discarded.", tone: "info" });
  }

  function handleExit(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (busy !== "") {
      event.preventDefault();
      setNotice({
        message: "Wait for the current action to finish before exiting review.",
        tone: "info",
      });
      return;
    }
    if (
      hasUnsavedEdits &&
      !window.confirm("Exit review and discard your unsaved changes?")
    ) {
      event.preventDefault();
      return;
    }
    allowExit.current = true;
  }

  function closeBatch() {
    if (busy === "batch") return;
    setShowBatch(false);
  }

  function openBatchReview() {
    if (!queue) return;
    setBatchSelection(
      defaultBatchSelection(approvedIds, queue.config.maxBatchSize),
    );
    setShowBatch(true);
  }

  function toggleBatchItem(reviewId: string) {
    if (!queue) return;
    setBatchSelection((current) =>
      toggleBatchItemSelection(
        current,
        reviewId,
        queue.config.maxBatchSize,
      ),
    );
  }

  function toggleAllBatchItems() {
    if (!queue) return;
    setBatchSelection((current) =>
      toggleAllBatchSelection(
        approvedIds,
        current,
        queue.config.maxBatchSize,
      ),
    );
  }

  async function releaseBatch() {
    if (!queue || batchSelection.size === 0) return;
    const items = approved
      .filter((draft) => batchSelection.has(draft.reviewId))
      .map((draft) => ({
        reviewId: draft.reviewId,
        revision: draft.revision,
        draftHash: draft.draftHash,
      }));
    setBusy("batch");
    setNotice(null);
    try {
      const response = await apiRequest<{
        connection: "live" | "demo";
        batch: ReviewBatch;
      }>("/api/review/batches", {
        method: "POST",
        body: JSON.stringify({
          mode: queue.config.mode,
          items,
        } satisfies BatchCreateInput),
      });
      const selectedIds = new Set(items.map((item) => item.reviewId));
      setQueue((current) =>
        current
          ? {
              ...current,
              drafts: current.drafts.map((draft) =>
                selectedIds.has(draft.reviewId)
                  ? {
                      ...draft,
                      status: "QUEUED",
                      batchId: response.batch.batchId,
                    }
                  : draft,
              ),
            }
          : current,
      );
      setShowBatch(false);
      setNotice({
        message:
          response.connection === "demo"
            ? `Demo batch ${response.batch.batchId} created locally; n8n was not contacted.`
            : `Batch ${response.batch.batchId} confirmed in n8n.`,
        tone: "success",
      });
    } catch (error) {
      setNotice({ message: errorMessage(error), tone: "error" });
    } finally {
      setBusy("");
    }
  }

  if (!queue) {
    return (
      <main className="app-shell state-shell">
        <section className="state-card" aria-live="polite">
          <span className="brand-mark">N</span>
          <p className="eyebrow">Nunoon Outreach</p>
          <h1>{loadError ? "Review queue unavailable" : "Loading review queue"}</h1>
          <p>
            {loadError ||
              "Checking reviewer access and reading the canonical n8n queue."}
          </p>
          {loadError && (
            <div className="state-actions">
              <button
                className="primary-button"
                onClick={() => void loadQueue()}
                disabled={refreshing}
              >
                {refreshing ? "Retrying…" : "Retry"}
              </button>
              {loadErrorCode === "AUTH_REQUIRED" && (
                <a
                  className="secondary-link"
                  href="/signin-with-chatgpt?return_to=%2F"
                >
                  Sign in
                </a>
              )}
              {signOutHref && loadErrorCode !== "AUTH_REQUIRED" && (
                <a className="secondary-link" href={signOutHref}>
                  Exit review
                </a>
              )}
            </div>
          )}
        </section>
      </main>
    );
  }

  if (!selected) {
    return (
      <main className="app-shell state-shell">
        <section className="state-card">
          <span className="brand-mark">N</span>
          <p className="eyebrow">{queue.config.mode} mode</p>
          <h1>No drafts waiting</h1>
          <p>
            The review queue is connected. New validated drafts will appear here.
          </p>
          <div className="state-actions">
            <button
              className="primary-button"
              onClick={() => void loadQueue(true)}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            {signOutHref && (
              <a className="secondary-link" href={signOutHref}>
                Exit review
              </a>
            )}
          </div>
        </section>
      </main>
    );
  }

  const visualStatus = statusVisual(selected.status, dirty);
  const selectedLocked = [
    "SKIPPED",
    "BLOCKED",
    "QUEUED",
    "SENDING",
    "SENT",
  ].includes(selected.status);
  const selectedApproved = selected.status === "APPROVED";
  const selectionCount = batchSelection.size;
  const batchSelectionTarget = queue
    ? Math.min(approved.length, queue.config.maxBatchSize)
    : 0;
  const allBatchSlotsSelected =
    batchSelectionTarget > 0 && selectionCount === batchSelectionTarget;
  const someBatchSlotsSelected =
    selectionCount > 0 && selectionCount < batchSelectionTarget;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">N</span>
          <div>
            <p className="brand-name">Nunoon Outreach</p>
            <p className="brand-section">Review console</p>
          </div>
        </div>

        <div className="topbar-meta">
          <span className="connection-badge">
            {queue.connection === "demo" ? "DEMO DATA" : "N8N CONNECTED"}
          </span>
          <span className={`mode-badge ${queue.config.mode.toLowerCase()}`}>
            {queue.config.mode} MODE
          </span>
          <span className="operator">{queue.operator.displayName}</span>
          <span className="operator-avatar" aria-hidden="true">
            {initials(queue.operator.displayName)}
          </span>
          {signOutHref && (
            <a
              className="sign-out-link"
              href={signOutHref}
              onClick={handleExit}
              title="End this review session"
            >
              Exit review
            </a>
          )}
        </div>
      </header>

      {notice && (
        <div
          className={`notice-toast ${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </div>
      )}

      <section className="workspace" aria-label="Outreach review workspace">
        <aside className="queue-panel">
          <div className="queue-heading">
            <div>
              <p className="eyebrow">Current queue</p>
              <h1>Outreach review</h1>
            </div>
            <span
              className="queue-total"
              aria-label={`${visibleDrafts.length} shown of ${drafts.length} total drafts`}
              title={`${visibleDrafts.length} shown of ${drafts.length} total`}
            >
              {visibleDrafts.length}/{drafts.length}
            </span>
          </div>

          <div className="batch-summary">
            <span>{attentionCount} need attention</span>
            <span>{approved.length} approved</span>
          </div>

          <div className="queue-sync-row">
            <span aria-live="polite">
              {refreshing
                ? "Syncing with n8n…"
                : lastSyncedAt
                  ? `Synced ${formatSyncTime(lastSyncedAt)}`
                  : "Not synced yet"}
              {hasUnsavedEdits ? " · Auto-sync paused" : " · Auto-sync on"}
            </span>
            <button
              className="refresh-button"
              type="button"
              onClick={refreshQueue}
              disabled={refreshing || busy !== ""}
              aria-label="Refresh review queue"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          <div className="filter-row" role="tablist" aria-label="Filter drafts">
            {filters.map((item) => (
              <button
                className={filter === item.id ? "filter-button active" : "filter-button"}
                key={item.id}
                onClick={() => chooseFilter(item.id)}
                role="tab"
                aria-selected={filter === item.id}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="queue-list" aria-live="polite">
            {visibleDrafts.length === 0 && (
              <div className="filter-empty">
                <p>No drafts match this view.</p>
                <button type="button" onClick={() => chooseFilter("all")}>
                  Show all drafts
                </button>
              </div>
            )}
            {visibleDrafts.map((draft) => {
              const hasEdit = Boolean(edits[draft.reviewId]);
              const visual = statusVisual(draft.status, hasEdit);
              return (
                <button
                  key={draft.reviewId}
                  className={
                    draft.reviewId === selected.reviewId
                      ? "queue-item selected"
                      : "queue-item"
                  }
                  onClick={() => chooseDraft(draft.reviewId)}
                >
                  <span className="queue-item-topline">
                    <span className="queue-clinic">{draft.clinic}</span>
                    <span className={`status-dot ${visual.className}`} aria-hidden="true" />
                  </span>
                  <span className="queue-subject">
                    {edits[draft.reviewId]?.subject ?? draft.subject}
                  </span>
                  <span className="queue-item-meta">
                    <span>{draft.city}</span>
                    <span className={`status-text ${visual.className}`}>
                      {visual.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="draft-panel" aria-label={`Review ${selected.clinic}`}>
          <div className="draft-header">
            <div>
              <div className="draft-title-row">
                <h2>{selected.clinic}</h2>
                <span className={`status-pill ${visualStatus.className}`}>
                  {visualStatus.label}
                </span>
              </div>
              <p>
                {selected.role} · {selected.city} · {selected.specialty}
              </p>
            </div>
            <span className="revision">Rev {selected.revision}</span>
          </div>

          {selected.status === "BLOCKED" && (
            <div className="blocked-banner" role="status">
              This recipient is suppressed. Remove the suppression before restoring it.
            </div>
          )}

          <div className="field-group">
            <label>To</label>
            <div className="recipient-field">
              <span>{selected.recipient}</span>
              <span
                className={
                  selected.emailSource === "Verified" ? "verified" : "inferred"
                }
              >
                {selected.emailSource}
              </span>
            </div>
          </div>

          <div className="field-group">
            <label htmlFor="subject">Subject</label>
            <input
              id="subject"
              value={subject}
              onChange={(event) => updateEdit("subject", event.target.value)}
              disabled={selectedLocked || busy !== ""}
            />
          </div>

          <div
            className="draft-view-tabs"
            role="tablist"
            aria-label="Draft presentation"
          >
            <button
              id="content-tab"
              className={draftView === "content" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={draftView === "content"}
              aria-controls="draft-content-panel"
              onClick={() => setDraftView("content")}
            >
              Content
            </button>
            <button
              id="preview-tab"
              className={draftView === "preview" ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={draftView === "preview"}
              aria-controls="draft-preview-panel"
              onClick={() => setDraftView("preview")}
            >
              HTML preview
            </button>
          </div>

          {draftView === "content" ? (
            <div
              id="draft-content-panel"
              className="field-group body-field draft-view-panel"
              role="tabpanel"
              aria-labelledby="content-tab"
            >
              <div className="field-label-row">
                <label htmlFor="body">Personalized message</label>
                <span>{validation.wordCount} words</span>
              </div>
              <textarea
                id="body"
                value={body}
                onChange={(event) => updateEdit("body", event.target.value)}
                disabled={selectedLocked || busy !== ""}
              />
              {dirty && !validation.valid && (
                <p className="validation-copy">{validation.errors[0]}</p>
              )}
            </div>
          ) : (
            <div
              id="draft-preview-panel"
              className="draft-view-panel"
              role="tabpanel"
              aria-labelledby="preview-tab"
            >
              <div className="preview-meta">
                <span>Final email preview</span>
              </div>
              <div className="email-preview-stage">
                <iframe
                  className="email-preview-frame"
                  title={`Branded HTML email preview for ${selected.clinic}`}
                  srcDoc={emailPreview.html}
                  sandbox=""
                  referrerPolicy="no-referrer"
                />
              </div>
              {!validation.valid && (
                <p className="validation-copy preview-validation">
                  {validation.errors[0]}
                </p>
              )}
            </div>
          )}

          <div className="draft-actions">
            {selected.status === "SKIPPED" ? (
              <button
                className="secondary-button"
                onClick={() => void decideCurrent("restore")}
                disabled={busy !== ""}
              >
                Return to review
              </button>
            ) : ["QUEUED", "SENDING", "SENT"].includes(selected.status) ? (
              <span className="queued-note">
                {selected.status === "SENT"
                  ? "Sent"
                  : `Locked${selected.batchId ? ` · ${selected.batchId}` : ""}`}
              </span>
            ) : (
              <>
                <button
                  className="danger-button"
                  onClick={() => void decideCurrent("block")}
                  disabled={selected.status === "BLOCKED" || busy !== ""}
                >
                  {busy === `block:${selected.reviewId}` ? "Blocking…" : "Block"}
                </button>
                <button
                  className="secondary-button"
                  onClick={() => void decideCurrent("skip")}
                  disabled={selected.status === "BLOCKED" || busy !== ""}
                >
                  {busy === `skip:${selected.reviewId}` ? "Skipping…" : "Skip"}
                  <kbd>S</kbd>
                </button>
                {dirty && (
                  <>
                    <button
                      className="secondary-button"
                      onClick={discardCurrentEdit}
                      disabled={busy !== ""}
                    >
                      Discard changes
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => void saveCurrent()}
                      disabled={!validation.valid || busy !== ""}
                    >
                      {busy.startsWith("save:") ? "Saving…" : "Save changes"}
                    </button>
                  </>
                )}
                <button
                  className="primary-button"
                  onClick={() => void decideCurrent("approve")}
                  disabled={
                    selected.status === "BLOCKED" ||
                    selectedApproved ||
                    dirty ||
                    !validation.valid ||
                    busy !== ""
                  }
                >
                  {busy === `approve:${selected.reviewId}`
                    ? "Approving…"
                    : selectedApproved
                      ? "Approved"
                      : "Approve"}
                  <kbd>A</kbd>
                </button>
              </>
            )}
          </div>
        </section>

        <aside className="context-panel">
          <section className="context-section">
            <p className="eyebrow">Draft basis</p>
            <h3>Why this message</h3>
            <p className="context-copy">
              {selected.personalizationBasis || "No personalization note supplied."}
            </p>
          </section>

          <section className="context-section">
            <div className="context-title-row">
              <h3>Research</h3>
              <span className={`grounding ${selected.grounding.toLowerCase()}`}>
                {selected.grounding} grounding
              </span>
            </div>
            <p className="context-copy">
              {selected.researchSummary || "No research summary supplied."}
            </p>
            <div className="source-list">
              {selected.sources.map((source, index) => (
                <a
                  key={`${source.url}:${index}`}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{index + 1}</span>
                  {source.label}
                </a>
              ))}
            </div>
          </section>

          <section className="context-section">
            <h3>Checks</h3>
            <dl className="check-list">
              <div>
                <dt>Recipient</dt>
                <dd>{selected.emailSource}</dd>
              </div>
              <div>
                <dt>Suppression</dt>
                <dd
                  className={
                    selected.status === "BLOCKED" ? "danger-text" : "success-text"
                  }
                >
                  {selected.status === "BLOCKED" ? "Blocked" : "Clear"}
                </dd>
              </div>
              <div>
                <dt>Draft revision</dt>
                <dd>{selected.revision}</dd>
              </div>
              <div>
                <dt>Approval hash</dt>
                <dd className="hash-value">
                  {selected.approvedHash
                    ? selected.approvedHash.slice(0, 10)
                    : "Not approved"}
                </dd>
              </div>
            </dl>
            {selected.risks.length > 0 && (
              <div className="risk-list">
                {selected.risks.map((risk) => (
                  <span key={risk.label} className={`risk-tag ${risk.tone}`}>
                    {risk.label}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="shortcut-note">
            <span>↓ Next</span>
            <span>A Approve</span>
            <span>S Skip</span>
          </section>
        </aside>
      </section>

      <footer className="batch-bar">
        <div>
          <span className="progress-copy">
            <strong>
              {reviewedCount} of {drafts.length}
            </strong>{" "}
            reviewed
          </span>
          <span className="progress-track" aria-hidden="true">
            <span
              style={{
                width: `${drafts.length ? (reviewedCount / drafts.length) * 100 : 0}%`,
              }}
            />
          </span>
        </div>
        <div className="batch-bar-actions">
          <button
            className="batch-button"
            disabled={approved.length === 0 || busy !== ""}
            onClick={openBatchReview}
          >
            Review batch
            <span>{approved.length}</span>
          </button>
        </div>
      </footer>

      {showBatch && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={closeBatch}
        >
          <section
            className="batch-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Final confirmation</p>
                <h2 id="batch-title">
                  Release {selectionCount} approved{" "}
                  {selectionCount === 1 ? "email" : "emails"}
                </h2>
              </div>
              <button
                className="close-button"
                onClick={closeBatch}
                disabled={busy === "batch"}
                aria-label="Close batch review"
                autoFocus
              >
                Close <span aria-hidden="true">×</span>
              </button>
            </div>

            <div className="safety-grid">
              <div>
                <span>Mode</span>
                <strong>{queue.config.mode}</strong>
              </div>
              <div>
                <span>Sender</span>
                <strong>{queue.config.senderEmail}</strong>
              </div>
              <div>
                <span>Pacing</span>
                <strong>{queue.config.pacingSeconds} seconds</strong>
              </div>
              <div>
                <span>Batch cap</span>
                <strong>{queue.config.maxBatchSize}</strong>
              </div>
            </div>

            <p className="selection-note">
              Select the exact manifest. {selectionCount} of{" "}
              {batchSelectionTarget} available slots selected.
            </p>
            <div className="select-all-control">
              <label>
                <input
                  ref={(input) => {
                    if (input) input.indeterminate = someBatchSlotsSelected;
                  }}
                  type="checkbox"
                  checked={allBatchSlotsSelected}
                  disabled={batchSelectionTarget === 0 || busy === "batch"}
                  onChange={toggleAllBatchItems}
                />
                <span>
                  <strong>Select all for this batch</strong>
                  <small>
                    {approved.length > queue.config.maxBatchSize
                      ? `${queue.config.maxBatchSize} now; the remaining ${approved.length - queue.config.maxBatchSize} stay approved for later batches.`
                      : "Every approved email fits in this batch."}
                  </small>
                </span>
              </label>
              <span>
                {selectionCount}/{batchSelectionTarget}
              </span>
            </div>
            <div className="recipient-list selectable">
              {approved.map((draft, index) => {
                const checked = batchSelection.has(draft.reviewId);
                const atCap =
                  !checked && batchSelection.size >= queue.config.maxBatchSize;
                return (
                  <label key={draft.reviewId}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={atCap || busy === "batch"}
                      onChange={() => toggleBatchItem(draft.reviewId)}
                    />
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{draft.clinic}</strong>
                      <small>{draft.recipient}</small>
                    </div>
                    <span>Rev {draft.revision}</span>
                  </label>
                );
              })}
            </div>

            <div className="modal-note">
              n8n receives this exact ordered manifest. The sender must re-read the
              current revision, hash, recipient, suppression state, and lock before
              SMTP.
            </div>

            <div className="modal-actions">
              <button
                className="secondary-button"
                onClick={closeBatch}
                disabled={busy === "batch"}
              >
                Keep reviewing
              </button>
              <button
                className="primary-button release-button"
                onClick={() => void releaseBatch()}
                disabled={selectionCount === 0 || busy === "batch"}
              >
                {busy === "batch"
                  ? "Confirming…"
                  : queue.connection === "demo"
                    ? "Create demo batch"
                    : `Release ${queue.config.mode.toLowerCase()} batch`}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

async function apiRequest<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new ReviewApiError(
      payload.error || "The review request failed.",
      payload.code || "REVIEW_REQUEST_FAILED",
    );
  }
  return payload as T;
}

class ReviewApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

function statusVisual(
  status: ReviewStatus,
  dirty = false,
): { label: string; className: string } {
  if (dirty) return { label: "Unsaved", className: "edited" };
  const values: Record<ReviewStatus, { label: string; className: string }> = {
    PENDING_APPROVAL: { label: "Ready", className: "ready" },
    NEEDS_ATTENTION: { label: "Check", className: "attention" },
    APPROVED: { label: "Approved", className: "approved" },
    SKIPPED: { label: "Skipped", className: "skipped" },
    BLOCKED: { label: "Blocked", className: "blocked" },
    QUEUED: { label: "Queued", className: "queued" },
    SENDING: { label: "Sending", className: "queued" },
    SENT: { label: "Sent", className: "approved" },
  };
  return values[status];
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "R";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatSyncTime(value: number): string {
  if (!Number.isFinite(value)) return "just now";
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Dubai",
  }).format(new Date(value));
  return `${time} GST`;
}

function errorMessage(error: unknown): string {
  return errorDetails(error).message;
}

function errorDetails(error: unknown): { message: string; code: string } {
  if (error instanceof ReviewApiError) {
    return { message: error.message, code: error.code };
  }
  if (error instanceof Error) {
    return { message: error.message, code: "REVIEW_REQUEST_FAILED" };
  }
  return {
    message: "The review request could not be completed.",
    code: "REVIEW_REQUEST_FAILED",
  };
}
