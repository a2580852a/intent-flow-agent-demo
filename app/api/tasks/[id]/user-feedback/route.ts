import { NextResponse } from "next/server";
import { submitUserFeedback } from "@/lib/store";
import type { UserFeedbackInput } from "@/lib/types";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as Partial<UserFeedbackInput>;

    const task = await submitUserFeedback(id, {
      action: body.action ?? "revise",
      note: body.note?.trim() ?? "",
      draft: body.draft
    });

    return NextResponse.json(task);
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : "Unable to submit feedback", {
      status: 400
    });
  }
}
