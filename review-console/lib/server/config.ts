import type { ReviewConfig, ReviewMode } from "@/lib/contracts/review";
import { ReviewError } from "@/lib/server/errors";

export function getReviewConfig(): ReviewConfig {
  const mode = readMode(process.env.OUTREACH_SEND_MODE);
  const pilotComplete = readBoolean(process.env.OUTREACH_PILOT_COMPLETE);
  const pacingSeconds = readInteger(
    process.env.OUTREACH_PACING_SECONDS,
    90,
    90,
    3_600,
  );
  const configuredLimit = readInteger(
    process.env.OUTREACH_MAX_BATCH_SIZE,
    mode === "TEST" ? 1 : 25,
    1,
    25,
  );
  const maxBatchSize =
    mode === "TEST"
      ? Math.min(configuredLimit, 1)
      : pilotComplete
        ? configuredLimit
        : Math.min(configuredLimit, 5);
  const senderName =
    process.env.OUTREACH_SENDER_NAME?.trim() || "Demo Sender";
  const senderEmail =
    process.env.OUTREACH_SENDER_EMAIL?.trim().toLowerCase() ||
    "outreach@example.com";
  const replyTo =
    process.env.OUTREACH_REPLY_TO?.trim().toLowerCase() || senderEmail;
  const testRecipient =
    mode === "TEST"
      ? process.env.OUTREACH_TEST_RECIPIENT?.trim().toLowerCase() || null
      : null;

  if (mode === "TEST" && !testRecipient) {
    throw new ReviewError(
      "OUTREACH_TEST_RECIPIENT is required in TEST mode.",
      503,
      "TEST_RECIPIENT_NOT_CONFIGURED",
    );
  }
  if (replyTo !== senderEmail) {
    throw new ReviewError(
      "The reply-to address must match the authenticated sender.",
      503,
      "SENDER_CONFIG_INVALID",
    );
  }

  return {
    mode,
    provider: "smtp",
    senderName,
    senderEmail,
    replyTo,
    pacingSeconds,
    maxBatchSize,
    testRecipient,
    senderDomainAuthenticated: readBoolean(
      process.env.OUTREACH_SENDER_DOMAIN_AUTHENTICATED,
    ),
    pilotComplete,
  };
}

function readMode(value: string | undefined): ReviewMode {
  const normalized = String(value ?? "TEST").trim().toUpperCase();
  if (normalized !== "TEST" && normalized !== "LIVE") {
    throw new ReviewError(
      "OUTREACH_SEND_MODE must be TEST or LIVE.",
      503,
      "SEND_MODE_INVALID",
    );
  }
  return normalized;
}

function readInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new ReviewError(
      `Expected an integer between ${minimum} and ${maximum}.`,
      503,
      "OUTREACH_CONFIG_INVALID",
    );
  }
  return number;
}

function readBoolean(value: string | undefined): boolean {
  return ["true", "yes", "1"].includes(String(value ?? "").trim().toLowerCase());
}
