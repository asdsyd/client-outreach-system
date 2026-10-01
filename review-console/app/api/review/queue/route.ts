import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/server/errors";
import { getReviewQueue } from "@/lib/server/review-service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await getReviewQueue(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
