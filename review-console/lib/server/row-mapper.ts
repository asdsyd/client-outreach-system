import type {
  DraftRisk,
  DraftSource,
  EmailSource,
  GroundingLevel,
  ReviewDraft,
  ReviewStatus,
} from "@/lib/contracts/review";
import type { DataTableRow } from "@/lib/server/n8n";

export function rowToDraft(row: DataTableRow): ReviewDraft {
  const sources = parseSources(row.research_sources_json ?? row.sources_json);
  const emailSource = parseEmailSource(row);
  const status = deriveStatus(row, emailSource, sources.length);
  const grounding = parseGrounding(stringValue(row.grounding), sources.length);
  const evidence = parseResearchEvidence(
    row.research_sources_json ?? row.sources_json,
  );

  return {
    reviewId: stringValue(row.review_id),
    contactKey: stringValue(row.contact_key),
    campaignVersion: stringValue(row.campaign_version),
    clinic: stringValue(row.company_name) || "Unnamed clinic",
    city: stringValue(row.location ?? row.city) || "UAE",
    specialty:
      stringValue(row.specialty) ||
      evidence.services[0] ||
      "Clinic",
    recipient: stringValue(row.intended_recipient ?? row.email ?? row.recipient),
    role: stringValue(row.role) || "Clinic team",
    subject: stringValue(row.draft_subject ?? row.subject),
    body: stringValue(row.draft_body ?? row.body),
    researchSummary: stringValue(row.research_summary),
    personalizationBasis:
      stringValue(row.personalization_basis) ||
      evidence.personalizationPoints[0] ||
      stringValue(row.research_summary),
    sources,
    emailSource,
    grounding,
    status,
    revision: numberValue(row.draft_revision, 1),
    draftHash: stringValue(row.draft_hash),
    approvedRevision: nullableNumber(row.approved_revision),
    approvedHash: nullableString(row.approved_hash),
    batchId: nullableString(row.batch_id),
    risks: deriveRisks(row, emailSource, grounding),
    updatedAt:
      nullableString(row.updatedAt) ?? nullableString(row.updated_at) ?? null,
  };
}

export function appendAudit(
  row: DataTableRow,
  event: Record<string, unknown>,
): Record<string, unknown>[] {
  const existing = parseJsonArray(row.audit_json);
  return [...existing.slice(-49), event];
}

function parseSources(value: unknown): DraftSource[] {
  const parsed = parseJson(value);
  if (Array.isArray(parsed)) {
    return parsed
      .map((item, index) => {
        if (typeof item === "string") {
          return /^https?:\/\//i.test(item)
            ? { label: `Source ${index + 1}`, url: item }
            : null;
        }
        if (!item || typeof item !== "object") return null;
        const source = item as Record<string, unknown>;
        const url = stringValue(source.url);
        if (!/^https?:\/\//i.test(url)) return null;
        return {
          label: stringValue(source.label) || `Source ${index + 1}`,
          url,
        };
      })
      .filter((item): item is DraftSource => Boolean(item));
  }

  if (parsed && typeof parsed === "object") {
    const sourceObject = parsed as Record<string, unknown>;
    const urls = Array.isArray(sourceObject.source_urls)
      ? sourceObject.source_urls
      : [];
    return urls
      .map((url, index) => {
        const value = stringValue(url);
        return /^https?:\/\//i.test(value)
          ? { label: `Source ${index + 1}`, url: value }
          : null;
      })
      .filter((item): item is DraftSource => Boolean(item));
  }

  return [];
}

function parseResearchEvidence(value: unknown): {
  services: string[];
  personalizationPoints: string[];
} {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { services: [], personalizationPoints: [] };
  }
  const evidence = parsed as Record<string, unknown>;
  return {
    services: stringArray(evidence.services),
    personalizationPoints: stringArray(evidence.personalization_points),
  };
}

function parseRisks(value: unknown): DraftRisk[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const risk = item as Record<string, unknown>;
      const label = stringValue(risk.label);
      if (!label) return null;
      return {
        label,
        tone: stringValue(risk.tone) === "red" ? "red" : "amber",
      } satisfies DraftRisk;
    })
    .filter((item): item is DraftRisk => Boolean(item));
}

function parseGrounding(value: string, sourceCount: number): GroundingLevel {
  const normalized = value.toLowerCase();
  if (normalized === "strong") return "Strong";
  if (normalized === "low") return "Low";
  if (normalized === "medium") return "Medium";
  if (sourceCount >= 2) return "Strong";
  if (sourceCount === 1) return "Medium";
  return "Low";
}

function deriveStatus(
  row: DataTableRow,
  emailSource: EmailSource,
  sourceCount: number,
): ReviewStatus {
  const approval = stringValue(row.approval_status).toUpperCase();
  const send = stringValue(row.send_status).toUpperCase();
  const batch = stringValue(row.batch_status).toUpperCase();

  if (send === "SENT" || batch === "SENT") return "SENT";
  if (
    send === "SENDING" ||
    ["LOCKED", "SENDING", "NEEDS_RECONCILIATION"].includes(batch)
  ) {
    return "SENDING";
  }
  if (send === "SUPPRESSED" || approval === "BLOCKED") return "BLOCKED";
  if (["CONFIRMED", "RESERVED"].includes(batch)) return "QUEUED";
  if (approval === "APPROVED") return "APPROVED";
  if (
    ["REJECTED", "SKIPPED"].includes(approval) ||
    send === "SKIPPED"
  ) {
    return "SKIPPED";
  }
  if (emailSource === "Inferred" || sourceCount === 0) {
    return "NEEDS_ATTENTION";
  }
  return "PENDING_APPROVAL";
}

function parseEmailSource(row: DataTableRow): EmailSource {
  const explicit = stringValue(row.email_source).toLowerCase();
  if (explicit === "inferred") return "Inferred";
  if (explicit === "verified") return "Verified";
  return stringValue(row.email_validation_status).toUpperCase() === "RECEIVING"
    ? "Verified"
    : "Inferred";
}

function deriveRisks(
  row: DataTableRow,
  emailSource: EmailSource,
  grounding: GroundingLevel,
): DraftRisk[] {
  const explicit = parseRisks(row.risks_json);
  if (explicit.length) return explicit;
  const risks: DraftRisk[] = [];
  if (emailSource === "Inferred") {
    risks.push({ label: "Recipient is not verified", tone: "amber" });
  }
  if (grounding === "Low") {
    risks.push({ label: "Limited source evidence", tone: "amber" });
  }
  if (
    stringValue(row.send_status).toUpperCase() === "SUPPRESSED" ||
    stringValue(row.approval_status).toUpperCase() === "BLOCKED"
  ) {
    risks.push({
      label: stringValue(row.suppressed_reason) || "Recipient suppressed",
      tone: "red",
    });
  }
  return risks;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseJsonArray(value: unknown): Record<string, unknown>[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
  );
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function numberValue(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nullableString(value: unknown): string | null {
  const string = stringValue(value);
  return string || null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(stringValue).filter(Boolean)
    : [];
}
