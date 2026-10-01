import type {
  BatchCreateInput,
  DraftDecisionInput,
  DraftUpdateInput,
  ReviewMode,
} from "@/lib/contracts/review";
import { ReviewError } from "@/lib/server/errors";

export function parseDraftUpdate(value: unknown): DraftUpdateInput {
  const object = asObject(value);
  return {
    revision: positiveInteger(object.revision, "revision"),
    subject: requiredString(object.subject, "subject", 1, 160),
    body: requiredString(object.body, "body", 1, 4_000),
  };
}

export function parseDraftDecision(value: unknown): DraftDecisionInput {
  const object = asObject(value);
  const action = String(object.action ?? "");
  if (!["approve", "skip", "block", "restore"].includes(action)) {
    throw invalid("action");
  }
  const draftHash = requiredString(object.draftHash, "draftHash", 64, 64);
  if (!/^[a-f0-9]{64}$/i.test(draftHash)) throw invalid("draftHash");
  return {
    action: action as DraftDecisionInput["action"],
    revision: positiveInteger(object.revision, "revision"),
    draftHash,
    reason:
      object.reason === undefined
        ? undefined
        : requiredString(object.reason, "reason", 1, 500),
  };
}

export function parseBatchCreate(value: unknown): BatchCreateInput {
  const object = asObject(value);
  const mode = String(object.mode ?? "").toUpperCase();
  if (mode !== "TEST" && mode !== "LIVE") throw invalid("mode");
  if (!Array.isArray(object.items)) throw invalid("items");

  return {
    mode: mode as ReviewMode,
    items: object.items.map((item, index) => {
      const candidate = asObject(item, `items[${index}]`);
      return {
        reviewId: requiredString(
          candidate.reviewId,
          `items[${index}].reviewId`,
          1,
          160,
        ),
        revision: positiveInteger(
          candidate.revision,
          `items[${index}].revision`,
        ),
        draftHash: validHash(
          requiredString(
            candidate.draftHash,
            `items[${index}].draftHash`,
            64,
            64,
          ),
          `items[${index}].draftHash`,
        ),
      };
    }),
  };
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ReviewError(
      "Request body must be valid JSON.",
      400,
      "INVALID_JSON",
    );
  }
}

export async function readDraftUpdate(
  request: Request,
): Promise<DraftUpdateInput> {
  return parseDraftUpdate(await readBody(request));
}

export async function readDraftDecision(
  request: Request,
): Promise<DraftDecisionInput> {
  return parseDraftDecision(await readBody(request));
}

export async function readBatchCreate(
  request: Request,
): Promise<BatchCreateInput> {
  return parseBatchCreate(await readBody(request));
}

function asObject(
  value: unknown,
  field = "request",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(field);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw invalid(field);
  return number;
}

function requiredString(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string") throw invalid(field);
  const string = value.trim();
  if (string.length < minimum || string.length > maximum) throw invalid(field);
  return string;
}

function invalid(field: string): ReviewError {
  return new ReviewError(
    `Invalid ${field}.`,
    400,
    "INVALID_REVIEW_REQUEST",
  );
}

function validHash(value: string, field: string): string {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw invalid(field);
  return value;
}
