import { NextResponse } from "next/server";

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "REVIEW_ERROR",
  ) {
    super(message);
  }
}
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ReviewError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  console.error("Review API failure", error);
  return NextResponse.json(
    {
      error: "The review service could not complete the request.",
      code: "REVIEW_SERVICE_FAILURE",
    },
    { status: 500 },
  );
}
