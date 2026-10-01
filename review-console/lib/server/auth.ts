import { getChatGPTUser } from "@/app/chatgpt-auth";
import type { ConnectionMode, ReviewOperator } from "@/lib/contracts/review";
import { ReviewError } from "@/lib/server/errors";

export type ReviewContext = {
  connection: ConnectionMode;
  operator: ReviewOperator;
};

export async function requireReviewer(): Promise<ReviewContext> {
  if (process.env.OUTREACH_DEMO_MODE === "true") {
    return {
      connection: "demo",
      operator: {
        displayName: process.env.OUTREACH_DEMO_USER_NAME?.trim() || "Demo reviewer",
        email:
          process.env.OUTREACH_DEMO_USER_EMAIL?.trim().toLowerCase() ||
          "demo@local.invalid",
      },
    };
  }

  const user = await getChatGPTUser();
  if (!user) {
    throw new ReviewError(
      "Sign in with ChatGPT to open the outreach review queue.",
      401,
      "AUTH_REQUIRED",
    );
  }

  const allowed = new Set(
    String(process.env.OUTREACH_REVIEWER_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );

  if (allowed.size === 0) {
    throw new ReviewError(
      "No outreach reviewers are configured.",
      503,
      "REVIEWERS_NOT_CONFIGURED",
    );
  }

  if (!allowed.has(user.email.toLowerCase())) {
    throw new ReviewError(
      "Your account is not allowed to review outreach.",
      403,
      "REVIEWER_NOT_ALLOWED",
    );
  }

  return {
    connection: "live",
    operator: {
      displayName: user.displayName,
      email: user.email.toLowerCase(),
    },
  };
}

export function requireSameOrigin(request: Request): void {
  if (process.env.OUTREACH_DEMO_MODE === "true") return;

  const origin = request.headers.get("origin");
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host")?.trim();
  const protocol =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    new URL(request.url).protocol.replace(":", "");

  if (!origin || !host) {
    throw new ReviewError(
      "A same-origin browser request is required.",
      403,
      "ORIGIN_REQUIRED",
    );
  }

  let actualOrigin: string;
  let expectedOrigin: string;
  try {
    actualOrigin = new URL(origin).origin;
    expectedOrigin = new URL(`${protocol}://${host}`).origin;
  } catch {
    throw new ReviewError(
      "The request origin is invalid.",
      403,
      "ORIGIN_INVALID",
    );
  }

  if (actualOrigin !== expectedOrigin) {
    throw new ReviewError(
      "Cross-origin review mutations are not allowed.",
      403,
      "ORIGIN_MISMATCH",
    );
  }
}
