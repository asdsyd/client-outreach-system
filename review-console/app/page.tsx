import ReviewConsole from "@/app/review-console";
import {
  chatGPTSignOutPath,
  requireChatGPTUser,
} from "@/app/chatgpt-auth";
import type { ReviewQueueResponse } from "@/lib/contracts/review";
import { ReviewError } from "@/lib/server/errors";
import { getReviewQueue } from "@/lib/server/review-service";

export const dynamic = "force-dynamic";

export default async function Home() {
  let initialQueue: ReviewQueueResponse | null = null;
  let initialError: { message: string; code: string } | null = null;
  const demoMode = process.env.OUTREACH_DEMO_MODE === "true";

  if (!demoMode) {
    await requireChatGPTUser("/");
  }

  try {
    initialQueue = await getReviewQueue();
  } catch (error) {
    initialError =
      error instanceof ReviewError
        ? { message: error.message, code: error.code }
        : {
            message: "The review service could not load the queue.",
            code: "REVIEW_SERVICE_FAILURE",
          };
  }

  return (
    <ReviewConsole
      initialQueue={initialQueue}
      initialError={initialError}
      signOutHref={demoMode ? null : chatGPTSignOutPath("/signed-out")}
    />
  );
}
